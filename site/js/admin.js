(function () {
  const state = {
    routes: [],
    regions: [],
    editingId: null
  };

  // Поля формы редактирования маршрута.
  const FIELDS = [
    { key: 'title', label: 'Название', type: 'text', required: true },
    { key: 'slug', label: 'Slug (URL)', type: 'text', required: true, hint: 'латиница, через дефис; если пусто — сгенерируется из названия' },
    { key: 'region_id', label: 'Регион', type: 'region' },
    { key: 'difficulty', label: 'Сложность', type: 'text', placeholder: 'лёгкая / средняя / сложная' },
    { key: 'route_type', label: 'Тип маршрута', type: 'text', placeholder: 'однодневный / кольцевой / ...' },
    { key: 'distance_km', label: 'Длина (км)', type: 'number', step: '0.1' },
    { key: 'duration_text', label: 'Время в пути', type: 'text', placeholder: '6–8 часов' },
    { key: 'elevation_m', label: 'Набор высоты (м)', type: 'number' },
    { key: 'photo_url', label: 'URL фото', type: 'text' },
    { key: 'short_announcement', label: 'Краткое описание', type: 'textarea' },
    { key: 'description', label: 'Полное описание', type: 'textarea' },
    { key: 'tags', label: 'Теги', type: 'text', hint: 'через запятую' },
    { key: 'best_months', label: 'Лучший сезон', type: 'text' },
    { key: 'how_to_get', label: 'Как добраться', type: 'textarea' },
    { key: 'rest_and_sleep', label: 'Ночёвки / отдых', type: 'textarea' },
    { key: 'recommendations', label: 'Рекомендации', type: 'textarea' },
    { key: 'dangers', label: 'Опасности', type: 'textarea' },
    { key: 'water_info', label: 'Вода', type: 'textarea' },
    { key: 'gear_list', label: 'Снаряжение', type: 'textarea' },
    { key: 'map_data', label: 'Данные карты (JSON / URL / iframe)', type: 'textarea' }
  ];

  function $(sel, root = document) {

    return root.querySelector(sel);

  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  // Готовим короткий адрес для маршрута.
  function slugify(text) {
    const map = {
      а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
      к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
      х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
    };
    return String(text || '')
      .toLowerCase()
      .replace(/[а-яё]/g, ch => map[ch] || ch)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function normalizeTagsForSave(value) {
    if (Array.isArray(value)) return value;
    return String(value || '').split(',').map(t => t.trim()).filter(Boolean);
  }

  function tagsToInput(tags) {
    if (Array.isArray(tags)) return tags.join(', ');
    if (typeof tags === 'string') {
      try {
        const parsed = JSON.parse(tags);
        if (Array.isArray(parsed)) return parsed.join(', ');
      } catch (_) { }
      return tags;
    }
    return '';
  }

  function notify(message, type = 'success') {
    if (window.TrailAuth && typeof TrailAuth.notify === 'function') {
      TrailAuth.notify(message, type);
      return;
    }
    alert(message);
  }

  function regionName(id) {
    const reg = state.regions.find(r => String(r.id) === String(id));
    return reg ? reg.name : '—';
  }

  // Проверяем права перед загрузкой панели.
  async function ensureAdmin() {
    await TrailAuth.ready();
    if (!TrailAuth.isAdmin()) {
      $('#admin-root').innerHTML = `
        <div class="admin-locked">
          <h2>Нет прав доступа</h2>
        </div>`;
      return false;
    }
    return true;
  }

  // Получаем маршруты и регионы для панели.
  async function loadData() {
    const client = await TrailAuth.getClient();
    const [routesRes, regionsRes] = await Promise.all([
      client.from('routes').select('*').order('id', { ascending: false }),
      client.from('regions').select('id, name').order('name')
    ]);
    if (routesRes.error) throw routesRes.error;
    if (regionsRes.error) console.warn('regions:', regionsRes.error);
    state.routes = routesRes.data || [];
    state.regions = regionsRes.data || [];
  }

  function renderList() {
    const list = $('#admin-list');
    if (!list) return;
    if (!state.routes.length) {
      list.innerHTML = '<div class="admin-empty">Маршрутов пока нет. Добавьте первый.</div>';
      return;
    }
    list.innerHTML = state.routes.map(route => `
      <article class="admin-route-row" data-id="${escapeHtml(route.id)}">
        <div class="admin-route-main">
          <strong>${escapeHtml(route.title || 'Без названия')}</strong>
          <span class="admin-meta">${escapeHtml(regionName(route.region_id))} · ${escapeHtml(route.difficulty || '—')} · ${route.distance_km ?? '—'} км</span>
          <span class="admin-slug">/${escapeHtml(route.slug || '')}</span>
        </div>
        <div class="admin-route-actions">
          <a class="btn btn-ghost" href="route.html?slug=${encodeURIComponent(route.slug || '')}" target="_blank" rel="noopener">Открыть</a>
          <button type="button" class="btn btn-ghost" data-edit="${escapeHtml(route.id)}">Изменить</button>
          <button type="button" class="btn btn-danger" data-delete="${escapeHtml(route.id)}">Удалить</button>
        </div>
      </article>
    `).join('');

    list.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openEditor(btn.getAttribute('data-edit')));
    });
    list.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteRoute(btn.getAttribute('data-delete')));
    });
  }

  // Открываем форму добавления или изменения маршрута.
  function openEditor(id = null) {
    state.editingId = id;
    const route = id ? state.routes.find(r => String(r.id) === String(id)) : null;
    const panel = $('#admin-editor');
    panel.hidden = false;
    $('#admin-editor-title').textContent = route ? 'Редактирование маршрута' : 'Новый маршрут';

    const form = $('#admin-form');
    form.innerHTML = FIELDS.map(field => {
      let value = route ? route[field.key] : '';
      if (field.key === 'tags') value = tagsToInput(value);
      if (value == null) value = '';

      if (field.type === 'region') {
        const options = ['<option value="">— не выбран —</option>']
          .concat(state.regions.map(r => {
            const selected = String(route?.region_id ?? '') === String(r.id) ? 'selected' : '';
            return `<option value="${escapeHtml(r.id)}" ${selected}>${escapeHtml(r.name)}</option>`;
          }));
        return `<label class="admin-field"><span>${escapeHtml(field.label)}</span><select name="${field.key}">${options.join('')}</select></label>`;
      }

      if (field.type === 'textarea') {
        return `<label class="admin-field admin-field-wide"><span>${escapeHtml(field.label)}${field.hint ? ` <small>${escapeHtml(field.hint)}</small>` : ''}</span><textarea name="${field.key}" rows="4">${escapeHtml(value)}</textarea></label>`;
      }

      return `<label class="admin-field"><span>${escapeHtml(field.label)}${field.hint ? ` <small>${escapeHtml(field.hint)}</small>` : ''}</span><input name="${field.key}" type="${field.type}" ${field.step ? `step="${field.step}"` : ''} ${field.required ? 'required' : ''} ${field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : ''} value="${escapeHtml(value)}"></label>`;
    }).join('') + `
      <div class="admin-form-actions">
        <button type="submit" class="btn btn-primary">${route ? 'Сохранить' : 'Добавить маршрут'}</button>
        <button type="button" class="btn btn-ghost" id="admin-cancel">Отмена</button>
      </div>`;

    $('#admin-cancel').onclick = closeEditor;

    const titleInput = form.querySelector('[name="title"]');
    const slugInput = form.querySelector('[name="slug"]');
    if (titleInput && slugInput && !route) {
      titleInput.addEventListener('input', () => {
        if (!slugInput.dataset.touched) slugInput.value = slugify(titleInput.value);
      });
      slugInput.addEventListener('input', () => { slugInput.dataset.touched = '1'; });
    }

    form.onsubmit = handleSave;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeEditor() {
    state.editingId = null;
    $('#admin-editor').hidden = true;
    $('#admin-form').innerHTML = '';
  }

  // Собираем данные из формы.
  function collectPayload(form) {
    const data = new FormData(form);
    const payload = {};
    FIELDS.forEach(field => {
      let value = data.get(field.key);
      if (typeof value === 'string') value = value.trim();
      if (field.key === 'tags') {
        payload.tags = normalizeTagsForSave(value);
        return;
      }
      if (field.key === 'distance_km' || field.key === 'elevation_m') {
        payload[field.key] = value === '' || value == null ? null : Number(value);
        return;
      }
      if (field.key === 'region_id') {
        payload.region_id = value === '' || value == null ? null : value;
        return;
      }
      payload[field.key] = value === '' ? null : value;
    });
    if (!payload.slug && payload.title) payload.slug = slugify(payload.title);
    return payload;
  }

  // Сохраняем изменения маршрута.
  async function handleSave(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      const payload = collectPayload(form);
      if (!payload.title) throw new Error('Укажите название маршрута');
      if (!payload.slug) throw new Error('Укажите slug');

      const client = await TrailAuth.getClient();
      let error;
      if (state.editingId) {
        ({ error } = await client.from('routes').update(payload).eq('id', state.editingId));
      } else {
        ({ error } = await client.from('routes').insert(payload));
      }
      if (error) throw error;

      window.TRAIL_ROUTES_PROMISE = null;
      notify(state.editingId ? 'Маршрут сохранён' : 'Маршрут добавлен');
      closeEditor();
      await loadData();
      renderList();
      $('#admin-count').textContent = String(state.routes.length);
    } catch (error) {
      console.error(error);
      notify(error.message || 'Не удалось сохранить', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  }

  // Удаляем маршрут после подтверждения.
  async function deleteRoute(id) {
    const route = state.routes.find(r => String(r.id) === String(id));
    const title = route?.title || id;
    if (!confirm(`Удалить маршрут «${title}»? Это действие нельзя отменить.`)) return;
    try {
      const client = await TrailAuth.getClient();
      const { error } = await client.from('routes').delete().eq('id', id);
      if (error) throw error;
      window.TRAIL_ROUTES_PROMISE = null;
      notify('Маршрут удалён');
      if (String(state.editingId) === String(id)) closeEditor();
      await loadData();
      renderList();
      $('#admin-count').textContent = String(state.routes.length);
    } catch (error) {
      console.error(error);
      notify(error.message || 'Не удалось удалить', 'error');
    }
  }

  async function init() {
    const root = $('#admin-root');
    if (!root) return;

    const ok = await ensureAdmin();
    if (!ok) {
      window.addEventListener('trail-auth-change', async () => {
        if (await ensureAdmin()) startPanel();
      });
      return;
    }
    await startPanel();
  }

  async function startPanel() {
    const root = $('#admin-root');
    root.innerHTML = `
      <div class="admin-toolbar">
        <div>
          <h1>Панель администратора</h1>
          <p class="admin-subtitle">Маршрутов в базе: <strong id="admin-count">…</strong></p>
        </div>
        <button type="button" class="btn btn-primary" id="admin-add">+ Добавить маршрут</button>
      </div>
      <section id="admin-editor" class="admin-editor" hidden>
        <h2 id="admin-editor-title">Редактор</h2>
        <form id="admin-form" class="admin-form"></form>
      </section>
      <section class="admin-list-section">
        <h2>Все маршруты</h2>
        <div id="admin-list" class="admin-list">Загрузка…</div>
      </section>`;

    $('#admin-add').onclick = () => openEditor(null);

    try {
      await loadData();
      $('#admin-count').textContent = String(state.routes.length);
      renderList();
    } catch (error) {
      console.error(error);
      $('#admin-list').innerHTML = `<div class="admin-empty">Ошибка загрузки: ${escapeHtml(error.message || error)}</div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
