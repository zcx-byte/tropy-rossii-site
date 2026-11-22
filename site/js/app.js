

let SUPABASE_URL = "";
let SUPABASE_ANON_KEY = "";

// Состояние каталога и фильтров.
const APP_STATE = {
  allRoutes: [],
  filteredRoutes: [],
  visibleCount: 12,
  activeTags: new Set(),
  activeDifficulty: null
};

window.APP_STATE = APP_STATE;

const UI_ICONS = {
  distance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  time: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  elevation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 18L12 9l4 9"/><path d="M4 18h16"/></svg>`
};

function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeTags(tags) {
  if (tags == null || tags === "") return [];
  if (Array.isArray(tags)) {
    return tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
  }
  return String(tags)
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map(t => t.trim().replace(/^"|"$/g, "").toLowerCase())
    .filter(Boolean);
}

// Читаем настройки подключения.
async function loadConfigFromFile() {
  try {
    const response = await fetch("/api/public-config", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const config = await response.json();
    SUPABASE_URL = (config.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
    SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY || "";
    return config;
  } catch (error) {
    console.warn("[Тропы] Не удалось загрузить настройки Supabase:", error.message);
    return null;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Не удалось загрузить скрипт: ${src}`));
    document.head.appendChild(script);
  });
}

function showLoadError(message) {
  const statusEl = document.getElementById("load-status");
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.textContent = `Ошибка загрузки данных: ${message}`;
  }
}

// Получаем маршруты из базы данных.
async function loadRoutesFromDatabase() {
  await loadConfigFromFile();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_PROJECT")) {
    const msg = "Укажите корректные SUPABASE_URL и SUPABASE_ANON_KEY в настройках сервера";
    console.error("[Тропы]", msg);
    showLoadError(msg);
    return [];
  }

  try {
    if (!window.supabase) {
      await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    }

    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data: routes, error: routesError } = await client.from("routes").select("*").order("id");

    if (routesError) {
      console.error("[Supabase] Ошибка загрузки маршрутов:", routesError);
      showLoadError(routesError.message || "Ошибка подключения к базе данных");
      return [];
    }

    if (!routes || routes.length === 0) {
      showLoadError("Маршруты не найдены. Проверьте таблицу 'routes' и настройки RLS (политики SELECT для роли 'anon').");
      return [];
    }

    let regionMap = {};
    const { data: regions, error: regionsError } = await client.from("regions").select("id, name");

    if (!regionsError && regions) {
      regions.forEach(reg => { regionMap[reg.id] = reg.name; });
    } else {
      console.warn("[Supabase] Не удалось загрузить регионы:", regionsError?.message);
    }

    return routes.map(route => ({
      ...route,
      region_name: regionMap[route.region_id] || "Россия",
      tags: normalizeTags(route.tags)
    }));

  } catch (error) {
    console.error("[Тропы] Критическая ошибка:", error);
    showLoadError(String(error.message || error));
    return [];
  }
}

function loadRoutes() {
  if (!window.TRAIL_ROUTES_PROMISE) {
    window.TRAIL_ROUTES_PROMISE = loadRoutesFromDatabase()
      .then(routes => {
        const list = Array.isArray(routes) ? routes : [];
        if (window.APP_STATE) window.APP_STATE.allRoutes = list;
        window.dispatchEvent(new CustomEvent("trail-routes-loaded", { detail: { routes: list } }));
        return list;
      })
      .catch(error => {
        console.error("[Тропы] Не удалось подготовить каталог маршрутов:", error);
        window.dispatchEvent(new CustomEvent("trail-routes-loaded", { detail: { routes: [] } }));
        return [];
      });
  }
  return window.TRAIL_ROUTES_PROMISE;
}
window.loadTrailRoutes = loadRoutes;

function collectAllTags(routes) {
  const uniqueTags = new Set();
  routes.forEach(route => {
    normalizeTags(route.tags).forEach(tag => uniqueTags.add(tag));
  });
  return Array.from(uniqueTags).sort();
}

// Выводим доступные теги для фильтра.
function renderTagChips(tags) {
  const container = document.getElementById("tag-chips");
  if (!container) return;

  if (!tags.length) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:0.9rem">Нет доступных тегов</span>';
    return;
  }

  container.innerHTML = tags.map(tag =>
    `<button type="button" class="chip" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  ).join("");

  container.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const tag = chip.dataset.tag;
      if (APP_STATE.activeTags.has(tag)) {
        APP_STATE.activeTags.delete(tag);
        chip.classList.remove("active");
      } else {
        APP_STATE.activeTags.add(tag);
        chip.classList.add("active");
      }
      applyFilters();
    });
  });
}

function fillRegionSelect(routes) {
  const select = document.getElementById("filter-region");
  if (!select) return;

  const uniqueRegions = [...new Set(routes.map(r => r.region_name).filter(Boolean))].sort();
  const currentValue = select.value;

  select.innerHTML = '<option value="">Все регионы</option>' +
    uniqueRegions.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");

  if (currentValue) select.value = currentValue;
}


function matchesDifficulty(route, targetDifficulty) {
  if (!targetDifficulty) return true;
  const difficulty = String(route.difficulty || "").toLowerCase().replace(/ё/g, "е");

  if (targetDifficulty === "easy" && !difficulty.includes("легк")) return false;
  if (targetDifficulty === "medium" && !difficulty.includes("средн")) return false;
  if (targetDifficulty === "hard" && !difficulty.includes("сложн")) return false;

  return true;
}

function matchesType(route, targetType) {
  if (!targetType) return true;
  const routeType = String(route.route_type || "").toLowerCase().replace(/ё/g, "е");
  return routeType.includes(targetType.toLowerCase().replace(/ё/g, "е"));
}

// Проверяем длину маршрута.
function matchesDistance(route, distanceRange) {
  if (!distanceRange) return true;
  const km = Number(route.distance_km) || 0;

  if (distanceRange === "0-20" && km > 20) return false;
  if (distanceRange === "20-50" && (km < 20 || km > 50)) return false;
  if (distanceRange === "50+" && km < 50) return false;

  return true;
}

function matchesSearch(route, query) {
  if (!query) return true;
  const searchContext = `${route.title || ""} ${route.short_announcement || ""} ${route.tags.join(" ")}`.toLowerCase();
  return searchContext.includes(query);
}

function matchesTags(route, activeTagsSet) {
  if (activeTagsSet.size === 0) return true;
  const routeTags = normalizeTags(route.tags);

  for (const tag of activeTagsSet) {
    if (!routeTags.includes(tag)) return false;
  }
  return true;
}

// Применяем выбранные фильтры к маршрутам.
function applyFilters() {
  const region = document.getElementById("filter-region")?.value || "";
  const distance = document.getElementById("filter-distance")?.value || "";
  const type = document.getElementById("filter-type")?.value || "";
  const search = (document.getElementById("filter-search")?.value || "").toLowerCase().trim();
  const sort = document.getElementById("sort-select")?.value || "default";

  APP_STATE.filteredRoutes = APP_STATE.allRoutes.filter(route => {
    if (region && !(route.region_name || "").includes(region)) return false;
    if (!matchesDifficulty(route, APP_STATE.activeDifficulty)) return false;
    if (!matchesType(route, type)) return false;
    if (!matchesDistance(route, distance)) return false;
    if (!matchesSearch(route, search)) return false;
    if (!matchesTags(route, APP_STATE.activeTags)) return false;

    return true;
  });

  if (sort === "distance-asc") {
    APP_STATE.filteredRoutes.sort((a, b) => (Number(a.distance_km) || 0) - (Number(b.distance_km) || 0));
  } else if (sort === "distance-desc") {
    APP_STATE.filteredRoutes.sort((a, b) => (Number(b.distance_km) || 0) - (Number(a.distance_km) || 0));
  } else if (sort === "elevation-desc") {
    APP_STATE.filteredRoutes.sort((a, b) => (Number(b.elevation_m) || 0) - (Number(a.elevation_m) || 0));
  }

  APP_STATE.visibleCount = 4; // Сброс пагинации при изменении фильтров
  renderRoutes();
}

function getDifficultyClass(difficulty) {
  if (!difficulty) return "medium";
  const diff = String(difficulty).toLowerCase().replace(/ё/g, "е");
  if (diff.includes("легк")) return "easy";
  if (diff.includes("сложн")) return "hard";
  return "medium";
}

// Формируем карточку маршрута.
function createRouteCardHtml(route) {
  const diffClass = getDifficultyClass(route.difficulty);
  const imageHtml = route.photo_url
    ? `<img src="${escapeHtml(route.photo_url)}" alt="${escapeHtml(route.title)}" loading="lazy" />`
    : `<div class="placeholder">🏞</div>`;

  return `
    <article class="route-card" data-slug="${escapeHtml(route.slug)}" role="link" tabindex="0">
      <div class="route-card-img">
        ${imageHtml}
        <button type="button" class="route-fav-button ${window.TrailAuth?.isFavorite(route.id) ? "is-favorite" : ""}" data-favorite-route="${escapeHtml(route.id)}" aria-label="Добавить в избранное" aria-pressed="${window.TrailAuth?.isFavorite(route.id) ? "true" : "false"}">${window.TrailAuth?.isFavorite(route.id) ? "♥" : "♡"}</button>
        <span class="route-card-badge">${escapeHtml(route.route_type || "маршрут")}</span>
      </div>
      <div class="route-card-body">
        <div class="route-card-region">${escapeHtml(route.region_name || "Россия")}</div>
        <h3>${escapeHtml(route.title)}</h3>
        <p class="short">${escapeHtml(route.short_announcement || "")}</p>
        <div class="route-card-meta">
          <span class="difficulty ${diffClass}">${escapeHtml(route.difficulty || "—")}</span>
          <span class="meta-item">${UI_ICONS.distance} ${route.distance_km ?? "—"} км</span>
          <span class="meta-item">${UI_ICONS.time} ${escapeHtml(route.duration_text || "—")}</span>
          <span class="meta-item">${UI_ICONS.elevation} ${route.elevation_m ?? "—"} м</span>
        </div>
      </div>
    </article>
  `;
}

// Показываем карточки подходящих маршрутов.
function renderRoutes() {
  const grid = document.getElementById("routes-grid");
  const countEl = document.getElementById("routes-count");
  const loadMoreWrap = document.getElementById("load-more-wrap");

  if (!grid) return;

  const visibleRoutes = APP_STATE.filteredRoutes.slice(0, APP_STATE.visibleCount);
  if (countEl) countEl.textContent = APP_STATE.filteredRoutes.length;

  if (APP_STATE.filteredRoutes.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>Ничего не найдено</h3>
        <p>Попробуйте сбросить фильтры или проверьте консоль браузера (F12) на наличие ошибок загрузки.</p>
      </div>`;
    if (loadMoreWrap) loadMoreWrap.style.display = "none";
    return;
  }

  grid.innerHTML = visibleRoutes.map(createRouteCardHtml).join("");

  grid.querySelectorAll(".route-card").forEach(card => {
    const navigate = () => {
      window.location.href = `route.html?slug=${encodeURIComponent(card.dataset.slug)}`;
    };
    card.addEventListener("click", navigate);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        navigate();
      }
    });
  });

  grid.querySelectorAll("[data-favorite-route]").forEach(button => {
    button.addEventListener("click", async event => {
      event.stopPropagation();
      const route = APP_STATE.allRoutes.find(item => String(item.id) === String(button.dataset.favoriteRoute));
      if (!route || !window.TrailAuth) return;
      await window.TrailAuth.toggleFavorite(route);
      const favorite = window.TrailAuth.isFavorite(route.id);
      button.classList.toggle("is-favorite", favorite);
      button.textContent = favorite ? "♥" : "♡";
      button.setAttribute("aria-pressed", favorite ? "true" : "false");
    });
  });

  if (loadMoreWrap) {
    loadMoreWrap.style.display = APP_STATE.visibleCount >= APP_STATE.filteredRoutes.length ? "none" : "flex";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("load-status");
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.textContent = "Загрузка маршрутов...";
  }

  APP_STATE.allRoutes = await loadRoutes();
  APP_STATE.filteredRoutes = [...APP_STATE.allRoutes];

  if (statusEl && APP_STATE.allRoutes.length > 0) {
    statusEl.style.display = "none";
  }

  renderTagChips(collectAllTags(APP_STATE.allRoutes));
  fillRegionSelect(APP_STATE.allRoutes);
  renderRoutes();

  document.querySelectorAll("#difficulty-chips .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const value = chip.dataset.value;
      if (APP_STATE.activeDifficulty === value) {
        APP_STATE.activeDifficulty = null;
        chip.classList.remove("active");
      } else {
        APP_STATE.activeDifficulty = value;
        document.querySelectorAll("#difficulty-chips .chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
      }
      applyFilters();
    });
  });

  document.getElementById("btn-apply")?.addEventListener("click", applyFilters);

  document.getElementById("btn-reset")?.addEventListener("click", () => {
    ["filter-region", "filter-distance", "filter-type", "filter-search", "sort-select"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = id === "sort-select" ? "default" : "";
    });

    APP_STATE.activeDifficulty = null;
    APP_STATE.activeTags.clear();
    document.querySelectorAll("#difficulty-chips .chip, #tag-chips .chip").forEach(c => c.classList.remove("active"));

    applyFilters();
  });

  ["filter-search", "filter-region", "filter-distance", "filter-type", "sort-select"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const eventType = id === "filter-search" ? "input" : "change";
      el.addEventListener(eventType, applyFilters);
    }
  });

  document.getElementById("btn-load-more")?.addEventListener("click", () => {
    APP_STATE.visibleCount += 4;
    renderRoutes();
  });
});
window.addEventListener("trail-auth-ready", () => { if (APP_STATE.allRoutes.length) renderRoutes(); });
window.addEventListener("trail-auth-change", () => { if (APP_STATE.allRoutes.length) renderRoutes(); });
