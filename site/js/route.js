

(function () {

  // Экранируем текст перед вставкой в HTML.
  function escapeHtml(value) {
    if (value == null) return "";
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function textOrDash(value) {
    if (value == null || String(value).trim() === "") return "—";
    return String(value);
  }

  function renderParagraph(text) {
    if (!text || !String(text).trim()) {
      return "<p>Информация появится после заполнения в базе данных.</p>";
    }
    return "<p>" + escapeHtml(text) + "</p>";
  }

  function renderMapPlaceholder() {
    return `
      <div class="map-placeholder" data-map-host="1">
        <div class="map-icon">🗺</div>
        <strong>Интерактивная карта (OpenStreetMap)</strong>
        <span>Загрузка данных…</span>
      </div>`;
  }

  // Проверяем и разбираем данные карты.
  function parseMapData(raw) {
    if (raw == null || raw === "") return null;
    if (typeof raw === "object") return raw;

    const str = String(raw).trim();
    if (!str) return null;

    if (str.includes("<iframe")) return { type: "iframe", html: str };
    if (/^https?:\/\//i.test(str)) return { type: "url", url: str };

    try {
      return JSON.parse(str);
    } catch (e) {
    }

    const coordMatch = str.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordMatch) {
      return {
        type: "geojson",
        center: [parseFloat(coordMatch[1]), parseFloat(coordMatch[2])],
        zoom: 13,
        points: [{ lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]), label: "Точка маршрута", kind: "start" }]
      };
    }

    return { type: "text", text: str };
  }

  // Подключаем библиотеку карты при необходимости.
  function ensureLeaflet() {
    return new Promise((resolve, reject) => {
      if (window.L) return resolve(window.L);

      const cdnUrls = [
        "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
        "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
      ];

      let attempt = 0;
      function tryLoad() {
        if (attempt >= cdnUrls.length) {
          return reject(new Error("Не удалось загрузить библиотеку карт. Проверьте подключение к интернету."));
        }
        const script = document.createElement("script");
        script.src = cdnUrls[attempt];
        script.async = true;
        script.onload = () => window.L ? resolve(window.L) : tryLoad();
        script.onerror = () => { script.remove(); attempt++; tryLoad(); };
        document.head.appendChild(script);
      }
      tryLoad();
    });
  }

  // Рисуем маршрут на карте.
  function renderTrailMap(hostElement, rawData) {
    const data = parseMapData(rawData);

    if (!data) {
      hostElement.className = "map-placeholder";
      hostElement.innerHTML = `
        <div class="map-icon">🗺</div>
        <strong>Карта недоступна</strong>
        <span>Добавьте данные в поле map_data в базе данных (GeoJSON, координаты или ссылку).</span>`;
      return;
    }

    if (data.type === "iframe" && data.html) {
      hostElement.className = "map-placeholder has-map";
      hostElement.innerHTML = data.html;
      return;
    }

    if (data.type === "url" && !/\.(gpx|geojson|json)/i.test(data.url)) {
      hostElement.className = "map-placeholder has-map";
      hostElement.innerHTML = `<iframe src="${escapeHtml(data.url)}" loading="lazy" allowfullscreen style="width:100%;height:360px;border:0;border-radius:12px"></iframe>`;
      return;
    }

    if (data.type === "text") {
      hostElement.className = "map-placeholder";
      hostElement.innerHTML = `<div class="map-icon">🗺</div><strong>${escapeHtml(data.text)}</strong>`;
      return;
    }

    hostElement.className = "map-placeholder has-map";
    hostElement.innerHTML = '<div class="map-live"></div>';
    const mapContainer = hostElement.querySelector(".map-live");

    ensureLeaflet().then(L => {
      const center = data.center || [61.5, 34.0];
      const map = L.map(mapContainer, { scrollWheelZoom: true }).setView(center, data.zoom || 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      let bounds = null;

      function addGeoJSON(gj) {
        const layer = L.geoJSON(gj, {
          style: () => ({ color: "#2D6A4F", weight: 4, opacity: 0.9 }),
          pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
            radius: 7, color: "#1B4332", fillColor: "#40916C", fillOpacity: 0.9, weight: 2
          }),
          onEachFeature: (feature, layer) => {
            const name = feature.properties?.name || feature.properties?.label;
            if (name) layer.bindPopup(String(name));
          }
        }).addTo(map);

        try {
          const b = layer.getBounds();
          if (b && b.isValid()) bounds = bounds ? bounds.extend(b) : b;
        } catch (e) { /* Игнорируем невалидные границы */ }
      }

      if (data.geojson) addGeoJSON(data.geojson);
      if (data.type === "Feature" || data.type === "FeatureCollection") addGeoJSON(data);
      if (data.features) addGeoJSON(data);

      (data.points || []).forEach(p => {
        const lat = p.lat != null ? p.lat : p[0];
        const lng = p.lng != null ? p.lng : p[1];
        if (lat == null || lng == null) return;

        const marker = L.marker([lat, lng]).addTo(map);
        if (p.label) marker.bindPopup(String(p.label));

        if (!bounds) bounds = L.latLngBounds([lat, lng], [lat, lng]);
        else bounds.extend([lat, lng]);
      });

      if (data.type === "url" && data.url) {
        fetch(data.url)
          .then(res => res.text())
          .then(text => {
            if (/<gpx/i.test(text)) {
              const coords = [];
              const re = /<(?:trkpt|rtept)([^>]+)>/gi;
              let match;
              while ((match = re.exec(text))) {
                const attrs = match[1];
                const la = attrs.match(/\blat=["']([^"']+)["']/i);
                const lo = attrs.match(/\blon=["']([^"']+)["']/i);
                if (la && lo) coords.push([parseFloat(lo[1]), parseFloat(la[1])]); // Leaflet требует [lng, lat] для LineString
              }

              if (coords.length > 0) {
                const optimizedCoords = coords.length > 2000
                  ? coords.filter((_, i) => i % Math.ceil(coords.length / 1500) === 0)
                  : coords;

                addGeoJSON({
                  type: "Feature",
                  geometry: { type: "LineString", coordinates: optimizedCoords },
                  properties: { name: "Трек маршрута" }
                });

                L.marker([coords[0][1], coords[0][0]])
                  .addTo(map)
                  .bindPopup("<b>Начало маршрута</b>");

                const lastCoord = coords[coords.length - 1];
                L.marker([lastCoord[1], lastCoord[0]])
                  .addTo(map)
                  .bindPopup("<b>Конец маршрута</b>");
              }
            } else {
              try {
                addGeoJSON(JSON.parse(text));
              } catch (e) {
              }
            }

            if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28] });
            setTimeout(() => map.invalidateSize(), 100);
          })
          .catch(err => {
            console.warn("[Карта] Не удалось загрузить файл трека:", data.url, err);
            if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28] });
          });
      } else if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [28, 28] });
      }

      hostElement._trailMap = map;
      setTimeout(() => map.invalidateSize(), 50);

    }).catch(err => {
      hostElement.className = "map-placeholder";
      hostElement.innerHTML = `
        <div class="map-icon">🗺</div>
        <strong>Не удалось загрузить карту</strong>
        <span>${escapeHtml(err.message || err)}</span>`;
    });
  }

  // Создаём карты в блоках маршрута.
  function initMaps(rootElement, mapData) {
    rootElement.querySelectorAll("[data-map-host]").forEach(host => {
      renderTrailMap(host, mapData);
    });
  }

  // Настраиваем вкладки страницы.
  function setupTabs(rootElement) {
    const tabs = rootElement.querySelectorAll(".route-tab");
    const panels = rootElement.querySelectorAll(".route-panel");

    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const targetId = tab.getAttribute("data-tab");

        tabs.forEach(t => t.classList.toggle("active", t === tab));
        panels.forEach(p => p.classList.toggle("active", p.getAttribute("data-panel") === targetId));

        if (targetId === "map" || targetId === "desc") {
          setTimeout(() => {
            rootElement.querySelectorAll("[data-map-host]").forEach(host => {
              if (host._trailMap) host._trailMap.invalidateSize();
            });
          }, 80);
        }
      });
    });
  }

  // Загружаем содержимое страницы маршрута.
  async function initRoutePage() {
    const root = document.getElementById("route-root");
    const slug = new URLSearchParams(location.search).get("slug");

    if (!slug) {
      root.innerHTML = `<div class="route-error"><h2>Маршрут не указан</h2><p><a href="index.html" style="color:#2D6A4F;font-weight:600">← Вернуться к списку</a></p></div>`;
      return;
    }

    if (typeof loadRoutes !== "function") {
      root.innerHTML = `<div class="route-error"><h2>Ошибка инициализации</h2><p>Не удалось загрузить базовый скрипт приложения.</p></div>`;
      return;
    }

    const routes = await loadRoutes();
    const route = routes.find(r => r.slug === slug);

    if (!route) {
      root.innerHTML = `<div class="route-error"><h2>Маршрут не найден</h2><p>Проверьте ссылку или вернитесь к <a href="index.html" style="color:#2D6A4F;font-weight:600">каталогу</a>.</p></div>`;
      return;
    }

    document.title = `${route.title} — Тропы России`;

    const tags = typeof normalizeTags === "function" ? normalizeTags(route.tags) : (route.tags || []);
    const diffLabel = route.difficulty || "";
    const typeLabel = route.route_type || "";

    const photoHtml = route.photo_url
      ? `<img src="${escapeHtml(route.photo_url)}" alt="${escapeHtml(route.title)}" />`
      : `<div class="route-photo-placeholder">
           <svg viewBox="0 0 64 64" fill="none">
             <path d="M8 48L24 28l12 14 8-10 12 16H8z" fill="rgba(255,255,255,0.25)"/>
             <path d="M32 12l8 14H24l8-14z" fill="rgba(255,255,255,0.45)"/>
             <circle cx="48" cy="18" r="5" fill="rgba(255,255,255,0.35)"/>
           </svg>
         </div>`;

    let sidebarTagsHtml = "";
    if (diffLabel) sidebarTagsHtml += `<span class="sidebar-tag">${escapeHtml(diffLabel)}</span>`;
    if (typeLabel) sidebarTagsHtml += `<span class="sidebar-tag muted">${escapeHtml(typeLabel)}</span>`;

    tags.slice(0, 4).forEach(t => {
      const label = String(t);
      if (label.toLowerCase() === String(diffLabel).toLowerCase()) return;
      if (label.toLowerCase() === String(typeLabel).toLowerCase()) return;
      sidebarTagsHtml += `<span class="sidebar-tag muted">${escapeHtml(label)}</span>`;
    });

    root.innerHTML = `
      <div class="route-hero">
        <div class="route-photo">
          ${photoHtml}
          <span class="route-photo-badge">+ фото</span>
        </div>
        <div class="route-hero-info">
          <div class="route-region">${escapeHtml(route.region_name || "Россия")}</div>
          <h1 class="route-title">${escapeHtml(route.title)}</h1>
          <div class="route-stats-grid">
            <div class="route-stat-card"><span>Длина</span><strong>${route.distance_km != null ? route.distance_km + " км" : "—"}</strong></div>
            <div class="route-stat-card"><span>Время</span><strong>${escapeHtml(textOrDash(route.duration_text))}</strong></div>
            <div class="route-stat-card"><span>Набор высоты</span><strong>${route.elevation_m != null ? route.elevation_m + " м" : "—"}</strong></div>
            <div class="route-stat-card"><span>Тип</span><strong>${escapeHtml(textOrDash(route.route_type))}</strong></div>
          </div>
          <div class="route-hero-actions">
            <button type="button" class="btn-plan">Добавить в мой план</button>
            <button type="button" class="btn-fav">♡ В избранное</button>
          </div>
        </div>
      </div>

      <nav class="route-tabs" aria-label="Разделы маршрута">
        <a class="route-tab active" href="#desc" data-tab="desc">Описание</a>
        <a class="route-tab" href="#map" data-tab="map">Карта и профиль</a>
        <a class="route-tab" href="#rest" data-tab="rest">Места для отдыха</a>
        <a class="route-tab" href="#howto" data-tab="howto">Как добраться</a>
        <a class="route-tab" href="#tips" data-tab="tips">Рекомендации</a>
      </nav>

      <div class="route-body">
        <div class="route-main">
          <section class="route-panel active" id="desc" data-panel="desc">
            <div class="route-card-detail">
              <h2>Описание маршрута</h2>
              ${renderParagraph(route.description || route.short_announcement)}
            </div>
          </section>

          <section class="route-panel" id="map" data-panel="map">
            <div class="route-card-detail">
              <h2><span class="emoji">🗺</span> Карта и профиль</h2>
              ${renderMapPlaceholder()}
            </div>
          </section>

          <section class="route-panel" id="rest" data-panel="rest">
            <div class="route-card-detail">
              <h2>Места для отдыха</h2>
              ${renderParagraph(route.rest_and_sleep)}
            </div>
          </section>

          <section class="route-panel" id="howto" data-panel="howto">
            <div class="route-card-detail">
              <h2>Как добраться до старта</h2>
              ${renderParagraph(route.how_to_get)}
            </div>
          </section>

          <section class="route-panel" id="tips" data-panel="tips">
            <div class="route-card-detail">
              <h2>Рекомендации</h2>
              ${renderParagraph(route.recommendations)}
            </div>
            ${route.dangers ? `<div class="route-card-detail"><h2>Опасности</h2>${renderParagraph(route.dangers)}</div>` : ""}
            ${route.water_info ? `<div class="route-card-detail"><h2>Вода</h2>${renderParagraph(route.water_info)}</div>` : ""}
            ${route.gear_list ? `<div class="route-card-detail"><h2>Снаряжение</h2>${renderParagraph(route.gear_list)}</div>` : ""}
          </section>
        </div>

        <aside class="route-sidebar">
          <div class="sidebar-card">
            <h3>Краткая информация</h3>
            ${sidebarTagsHtml ? `<div class="sidebar-tags">${sidebarTagsHtml}</div>` : ""}
            <div class="sidebar-rows">
              <div class="sidebar-row"><span>Длина</span><strong>${route.distance_km != null ? route.distance_km + " км" : "—"}</strong></div>
              <div class="sidebar-row"><span>Время в пути</span><strong>${escapeHtml(textOrDash(route.duration_text))}</strong></div>
              <div class="sidebar-row"><span>Набор высоты</span><strong>${route.elevation_m != null ? route.elevation_m + " м" : "—"}</strong></div>
              <div class="sidebar-row"><span>Лучший сезон</span><strong>${escapeHtml(textOrDash(route.best_months))}</strong></div>
            </div>
            <button type="button" class="btn-plan">Добавить в мой план</button>
            <button type="button" class="btn-map-outline" data-goto-map>Открыть карту</button>
          </div>
          <div class="sidebar-card">
            <h3>Полезные контакты</h3>
            <div class="contact-row"><span>МЧС</span><strong>112</strong></div>
            <p class="contact-note">Перед выходом в лес рекомендуется сообщить маршрут близким или зарегистрироваться в приложении «МЧС России».</p>
          </div>
        </aside>
      </div>
    `;

    setupTabs(root);

    const mapData = typeof resolveTrailMapData === "function"
      ? resolveTrailMapData(route)
      : route.map_data;
    initMaps(root, mapData);

    if (window.TrailAuth) {
      window.TrailAuth.ready()
        .then(() => window.TrailAuth.bindRouteActions(root, route))
        .catch(error => console.error("[Тропы] Не удалось подключить действия аккаунта:", error));
    }

    const mapBtn = root.querySelector("[data-goto-map]");
    if (mapBtn) {
      mapBtn.addEventListener("click", () => {
        const tab = root.querySelector('.route-tab[data-tab="map"]');
        if (tab) tab.click();

        const panel = root.querySelector('.route-panel[data-panel="map"]');
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRoutePage);
  } else {
    initRoutePage();
  }
})();
