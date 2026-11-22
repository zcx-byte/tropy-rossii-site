
// Избранное и план походов в личном кабинете.
(function () {
  const root = document.getElementById('account-content');
  let routes = [];
  let activeTab = location.hash === '#plan' ? 'plan' : 'favorites';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function getRoute(id) {
    return routes.find(route => String(route.id) === String(id));
  }
  // Переключаем раздел личного кабинета.
  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll('[data-account-tab]').forEach(button => button.classList.toggle('active', button.dataset.accountTab === tab));
    document.querySelectorAll('[data-account-panel]').forEach(panel => panel.hidden = panel.dataset.accountPanel !== tab);
    history.replaceState(null, '', tab === 'plan' ? '#plan' : '#favorites');
  }

  // Собираем небольшую карточку маршрута.
  function routeMiniCard(route, actionButton) {
    const image = route.photo_url
      ? `<img src="${escapeHtml(route.photo_url)}" alt="${escapeHtml(route.title)}" loading="lazy">`
      : '<div class="account-route-placeholder">🏞</div>';
    return `<article class="account-route-card">
      <a class="account-route-image" href="route.html?slug=${encodeURIComponent(route.slug || '')}">${image}</a>
      <div class="account-route-body"><div class="account-route-region">${escapeHtml(route.region_name || 'Россия')}</div>
        <a class="account-route-title" href="route.html?slug=${encodeURIComponent(route.slug || '')}">${escapeHtml(route.title || 'Маршрут')}</a>
        <p>${escapeHtml(route.short_announcement || '')}</p>
        <div class="account-route-meta"><span>${escapeHtml(route.difficulty || '—')}</span><span>${route.distance_km ?? '—'} км</span><span>${escapeHtml(route.duration_text || '—')}</span></div>
        <div class="account-route-actions"><a href="route.html?slug=${encodeURIComponent(route.slug || '')}" class="account-open-link">Открыть маршрут →</a>${actionButton}</div>
      </div>
    </article>`;
  }

  // Обновляем содержимое личного кабинета.
  function render() {
    const user = window.TrailAuth.getUser();
    if (!user) {
      window.TrailAuth.renderAccountSignedOut();
      return;
    }
    const favorites = window.TrailAuth.getFavorites();
    const plan = window.TrailAuth.getPlan();
    const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'путешественник';
    document.getElementById('account-greeting').textContent = `Рады видеть вас, ${name}! Здесь собраны ваши маршруты и планы.`;
    root.innerHTML = `
      <div class="account-stats">
        <div class="account-stat"><span>В избранном</span><strong>${favorites.length}</strong><small>сохранённых маршрутов</small></div>
        <div class="account-stat"><span>В моём плане</span><strong>${plan.length}</strong><small>запланированных походов</small></div>
        <div class="account-stat"><span>Аккаунт</span><strong class="account-stat-email">${escapeHtml(user.email || '')}</strong><small>ваш профиль</small></div>
      </div>
      <div class="account-tabs" role="tablist">
        <button type="button" data-account-tab="favorites" class="${activeTab === 'favorites' ? 'active' : ''}">♡ Избранное <span>${favorites.length}</span></button>
        <button type="button" data-account-tab="plan" class="${activeTab === 'plan' ? 'active' : ''}">▤ Мой план <span>${plan.length}</span></button>
      </div>
      <section class="account-panel" data-account-panel="favorites" ${activeTab !== 'favorites' ? 'hidden' : ''}>
        <div class="account-panel-heading"><div><h2>Избранные маршруты</h2><p>Места, к которым хочется вернуться.</p></div><a href="index.html" class="account-secondary-link">Найти ещё →</a></div>
        <div class="account-route-list">${favorites.length ? favorites.map(id => {
      const route = getRoute(id);
      if (!route) return '';
      return routeMiniCard(route, `<button type="button" class="account-remove-button" data-remove-fav="${escapeHtml(id)}">Убрать из избранного</button>`);
    }).join('') : '<div class="account-empty"><div>♡</div><h3>Пока ничего не сохранено</h3><p>Нажимайте на сердечко у понравившихся маршрутов, и они появятся здесь.</p><a href="index.html" class="btn btn-primary">Перейти к маршрутам</a></div>'}</div>
      </section>
      <section class="account-panel" data-account-panel="plan" ${activeTab !== 'plan' ? 'hidden' : ''}>
        <div class="account-panel-heading"><div><h2>Мой план походов</h2><p>Добавляйте даты, заметки и отмечайте пройденные маршруты.</p></div><a href="index.html" class="account-secondary-link">Подобрать маршрут →</a></div>
        <div class="account-plan-list">${plan.length ? plan.map(row => {
      const route = getRoute(row.route_id);
      if (!route) return '';
      return `<article class="account-plan-card" data-plan-card="${escapeHtml(row.id)}">
            <div class="account-plan-top"><div><div class="account-route-region">${escapeHtml(route.region_name || 'Россия')}</div><a class="account-route-title" href="route.html?slug=${encodeURIComponent(route.slug || '')}">${escapeHtml(route.title)}</a><p class="account-plan-meta">${route.distance_km ?? '—'} км · ${escapeHtml(route.duration_text || 'время не указано')}</p></div><button type="button" class="account-remove-button" data-remove-plan="${escapeHtml(row.id)}">Удалить</button></div>
            <div class="account-plan-fields"><label>Дата похода<input type="date" data-plan-date value="${escapeHtml(row.planned_date || '')}"></label><label>Статус<select data-plan-status><option value="planned" ${row.status === 'planned' ? 'selected' : ''}>Планируется</option><option value="completed" ${row.status === 'completed' ? 'selected' : ''}>Пройден</option></select></label></div>
            <label class="account-note-label">Личная заметка<textarea data-plan-note rows="2" maxlength="1500" placeholder="Например: уточнить трансфер, взять дождевик…">${escapeHtml(row.note || '')}</textarea></label>
            <div class="account-plan-footer"><span>${row.status === 'completed' ? '✓ Маршрут пройден' : 'Можно изменить дату или добавить заметку'}</span><button type="button" class="btn btn-primary account-save-button" data-save-plan="${escapeHtml(row.id)}">Сохранить</button></div>
          </article>`;
    }).join('') : '<div class="account-empty"><div>▤</div><h3>Ваш план пока пуст</h3><p>Добавьте маршрут на его странице, чтобы подготовить будущий поход.</p><a href="index.html" class="btn btn-primary">Выбрать маршрут</a></div>'}</div>
      </section>`;

    root.querySelectorAll('[data-account-tab]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.accountTab)));
    root.querySelectorAll('[data-remove-fav]').forEach(button => button.addEventListener('click', async () => {
      const route = getRoute(button.dataset.removeFav);
      if (route) { await window.TrailAuth.toggleFavorite(route); render(); }
    }));
    root.querySelectorAll('[data-remove-plan]').forEach(button => button.addEventListener('click', async () => {
      if (await window.TrailAuth.removeFromPlan(button.dataset.removePlan)) render();
    }));
    root.querySelectorAll('[data-save-plan]').forEach(button => button.addEventListener('click', async () => {
      const card = button.closest('[data-plan-card]');
      const ok = await window.TrailAuth.updatePlan(button.dataset.savePlan, {
        planned_date: card.querySelector('[data-plan-date]').value,
        status: card.querySelector('[data-plan-status]').value,
        note: card.querySelector('[data-plan-note]').value
      });
      if (ok) render();
    }));
  }

  // Загружаем данные при открытии страницы.
  async function init() {
    await window.TrailAuth.ready();
    if (!window.TrailAuth.getUser()) { window.TrailAuth.renderAccountSignedOut(); return; }
    try {
      routes = await window.loadRoutes();
    } catch (error) {
      console.error(error);
    }
    render();
  }
  let started = false;
  // Не запускаем загрузку страницы повторно.
  function startOnce() {
    if (started) return;
    started = true;
    init();
  }
  window.addEventListener('trail-auth-ready', startOnce, { once: true });
  if (window.TrailAuth) window.TrailAuth.ready().then(startOnce).catch(console.error);
  window.addEventListener('trail-auth-change', async () => {
    if (!window.TrailAuth.getUser()) {
      window.TrailAuth.renderAccountSignedOut();
      return;
    }
    if (!routes.length) {
      try {
        routes = await window.loadRoutes();
      } catch (error) {
        console.error(error);
      }
    }
    render();
  });
})();
