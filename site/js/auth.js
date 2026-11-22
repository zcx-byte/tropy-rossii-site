
(function () {
  // Данные текущего пользователя.
  const state = {
    client: null,
    user: null,
    role: null,
    favorites: new Set(),
    plan: [],
    readyPromise: null,
    modal: null,
    mode: 'login'
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function notify(message, type = 'success') {
    let toast = document.querySelector('.trail-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'trail-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add('visible');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('visible'), 3400);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve();
      const existing = document.querySelector('script[data-supabase-client]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.supabaseClient = 'true';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Не удалось загрузить Supabase JS.'));
      document.head.appendChild(script);
    });
  }

  async function getClient() {
    if (state.client) return state.client;
    const response = await fetch('/api/public-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить настройки Supabase.');
    const config = await response.json();
    const url = (config.SUPABASE_URL || '').replace(/\/$/, '');
    const key = config.SUPABASE_ANON_KEY || '';
    if (!url || !key) throw new Error('Не заданы публичные настройки Supabase на сервере.');
    await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    state.client = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return state.client;
  }

  function dispatchAuthEvent(name = 'trail-auth-change') {
    window.dispatchEvent(new CustomEvent(name, { detail: { user: state.user } }));
  }

  // Загружаем профиль вошедшего пользователя.
  async function loadProfile() {
    state.role = null;
    if (!state.user) return;
    try {
      const client = await getClient();
      const { data, error } = await client
        .from('profiles')
        .select('role, full_name, email')
        .eq('id', state.user.id)
        .maybeSingle();
      if (error) {
        console.error('[Тропы] Не удалось загрузить профиль:', error);
        state.role = 'user';
        return;
      }
      if (!data) {
        console.warn('[Тропы] Профиль не найден в public.profiles для', state.user.id, state.user.email);
        state.role = 'user';
        return;
      }
      state.role = data.role || 'user';
      console.info('[Тропы] Профиль загружен, role =', state.role);
    } catch (error) {
      console.error('[Тропы] Ошибка профиля:', error);
      state.role = 'user';
    }
  }

  // Загружаем избранное и планы пользователя.
  async function loadCollections() {
    state.favorites.clear();
    state.plan = [];
    if (!state.user) return;
    const client = await getClient();
    const [favoriteResult, planResult] = await Promise.all([
      client.from('favorites').select('route_id').eq('user_id', state.user.id),
      client.from('trip_plan').select('id, route_id, planned_date, status, note, created_at').eq('user_id', state.user.id).order('created_at', { ascending: false })
    ]);
    if (favoriteResult.error) {
      console.error('[Тропы] Не удалось загрузить избранное:', favoriteResult.error);
    } else {
      (favoriteResult.data || []).forEach(row => state.favorites.add(String(row.route_id)));
    }
    if (planResult.error) {
      console.error('[Тропы] Не удалось загрузить мой план:', planResult.error);
    } else {
      state.plan = planResult.data || [];
    }
  }

  // Обновляем кнопки в шапке сайта.
  function updateHeader() {
    document.querySelectorAll('[data-auth-control]').forEach(button => {
      button.textContent = state.user ? 'Выйти' : 'Войти';
      button.setAttribute('aria-label', state.user ? 'Выйти из аккаунта' : 'Войти или зарегистрироваться');
      button.onclick = state.user ? signOut : () => openAuthModal('login');
    });
    document.querySelectorAll('[data-account-link]').forEach(link => {
      link.textContent = state.user ? 'Мой профиль' : 'Мой план';
      link.href = state.user ? 'account.html' : 'account.html#login';
    });
    document.querySelectorAll('[data-admin-link]').forEach(link => {
      const isAdmin = state.role === 'admin';
      link.hidden = !isAdmin;
      link.style.display = isAdmin ? '' : 'none';
    });
    const hasStaticAdminLink = Boolean(document.querySelector('[data-admin-link]'));
    let adminNav = document.querySelector('[data-admin-nav]');
    if (state.role === 'admin' && !hasStaticAdminLink) {
      if (!adminNav) {
        const nav = document.querySelector('.nav');
        if (nav) {
          adminNav = document.createElement('a');
          adminNav.href = 'admin.html';
          adminNav.setAttribute('data-admin-nav', 'true');
          adminNav.textContent = 'Панель администратора';
          nav.appendChild(adminNav);
        }
      } else {
        adminNav.hidden = false;
      }
    } else if (adminNav) {
      adminNav.hidden = true;
    }
  }

  // Создаём окно входа при первом открытии.
  function ensureModal() {
    if (state.modal) return state.modal;
    const modal = document.createElement('div');
    modal.className = 'auth-overlay';
    modal.hidden = true;
    modal.innerHTML = `
      <section class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" class="auth-close" aria-label="Закрыть">×</button>
        <div class="auth-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 19 L8.5 9 L11 13.5 L14.5 6 L21 19" />
            <path d="M3 19 H21" />
            <path d="M9.5 19 C11 15.5 12 13.5 13 13 C14 12.5 14.8 14.2 16 17" />
          </svg>
        </div>
        <p class="auth-eyebrow">ТРОПЫ РОССИИ</p>
        <h2 id="auth-title">С возвращением!</h2>
        <p class="auth-subtitle">Войдите, чтобы сохранять маршруты и собирать свой план походов.</p>
        <div class="auth-switch">
          <button type="button" data-auth-mode="login" class="active">Войти</button>
          <button type="button" data-auth-mode="signup">Создать аккаунт</button>
        </div>
        <form class="auth-form" novalidate>
          <label class="auth-name-field" hidden>Имя<input name="name" type="text" autocomplete="name" maxlength="60" placeholder="Как к вам обращаться"></label>
          <label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
          <label>Пароль<input name="password" type="password" autocomplete="current-password" required minlength="8" placeholder="Не менее 8 символов"></label>
          <p class="auth-message" role="status" aria-live="polite"></p>
          <button class="btn btn-primary auth-submit" type="submit">Войти</button>
        </form>
        <p class="auth-terms">Создавая аккаунт, вы соглашаетесь использовать сайт в соответствии с его правилами и политикой конфиденциальности.</p>
      </section>`;
    document.body.appendChild(modal);
    state.modal = modal;
    modal.querySelector('.auth-close').addEventListener('click', closeAuthModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeAuthModal(); });
    modal.querySelectorAll('[data-auth-mode]').forEach(button => {
      button.addEventListener('click', () => setAuthMode(button.dataset.authMode));
    });
    modal.querySelector('.auth-form').addEventListener('submit', handleAuthSubmit);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.hidden) closeAuthModal();
    });
    return modal;
  }

  // Переключаем вход и регистрацию.
  function setAuthMode(mode) {
    state.mode = mode === 'signup' ? 'signup' : 'login';
    const modal = ensureModal();
    modal.querySelector('#auth-title').textContent = state.mode === 'signup' ? 'Создайте аккаунт' : 'С возвращением!';
    modal.querySelector('.auth-subtitle').textContent = state.mode === 'signup'
      ? 'Сохраняйте понравившиеся маршруты и планируйте будущие походы.'
      : 'Войдите, чтобы открыть своё избранное и план походов.';
    modal.querySelector('.auth-name-field').hidden = state.mode !== 'signup';
    modal.querySelector('[name="password"]').autocomplete = state.mode === 'signup' ? 'new-password' : 'current-password';
    modal.querySelector('.auth-submit').textContent = state.mode === 'signup' ? 'Зарегистрироваться' : 'Войти';
    modal.querySelectorAll('[data-auth-mode]').forEach(button => button.classList.toggle('active', button.dataset.authMode === state.mode));
    modal.querySelector('.auth-message').textContent = '';
  }

  function openAuthModal(mode = 'login') {
    const modal = ensureModal();
    setAuthMode(mode);
    modal.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => modal.querySelector('[name="email"]').focus(), 20);
  }

  function closeAuthModal() {
    if (!state.modal) return;
    state.modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  // Обрабатываем вход и регистрацию.
  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('.auth-submit');
    const message = form.querySelector('.auth-message');
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const name = form.elements.name.value.trim();
    if (!email || password.length < 8) {
      message.textContent = 'Укажите корректный email и пароль не короче 8 символов.';
      message.dataset.type = 'error';
      return;
    }
    button.disabled = true;
    button.textContent = 'Пожалуйста, подождите…';
    message.textContent = '';
    try {
      const client = await getClient();
      let result;
      if (state.mode === 'signup') {
        result = await client.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } }
        });
      } else {
        result = await client.auth.signInWithPassword({ email, password });
      }
      if (result.error) throw result.error;
      if (state.mode === 'signup' && !result.data.session) {
        message.textContent = 'Аккаунт создан. Проверьте почту и подтвердите адрес, затем войдите.';
        message.dataset.type = 'success';
        return;
      }
      state.user = result.data.user || result.data.session?.user || null;
      await loadProfile();
      await loadCollections();
      updateHeader();
      dispatchAuthEvent();
      closeAuthModal();
      notify(state.mode === 'signup' ? 'Аккаунт создан. Добро пожаловать!' : 'Вы успешно вошли.');
    } catch (error) {
      message.textContent = error.message || 'Не удалось выполнить вход. Проверьте данные и настройки Supabase.';
      message.dataset.type = 'error';
    } finally {
      button.disabled = false;
      button.textContent = state.mode === 'signup' ? 'Зарегистрироваться' : 'Войти';
    }
  }

  // Выходим из аккаунта и обновляем страницу.
  async function signOut() {
    try {
      const client = await getClient();
      const { error } = await client.auth.signOut();
      if (error) throw error;
      state.user = null;
      state.role = null;
      state.favorites.clear();
      state.plan = [];
      updateHeader();
      dispatchAuthEvent();
      notify('Вы вышли из аккаунта.');
      if (location.pathname.endsWith('/account.html') || location.pathname.endsWith('account.html')) renderAccountSignedOut();
    } catch (error) {
      notify(error.message || 'Не удалось выйти из аккаунта.', 'error');
    }
  }

  async function toggleFavorite(route) {
    if (!state.user) { openAuthModal('login'); return false; }
    const routeId = String(route.id);
    const client = await getClient();
    if (state.favorites.has(routeId)) {
      const { error } = await client.from('favorites').delete().eq('user_id', state.user.id).eq('route_id', route.id);
      if (error) {
        notify(error.message || 'Не удалось удалить из избранного.', 'error');
        return false;
      }
      state.favorites.delete(routeId);
      notify('Маршрут удалён из избранного.');
    } else {
      const { error } = await client.from('favorites').upsert(
        { user_id: state.user.id, route_id: route.id },
        { onConflict: 'user_id,route_id', ignoreDuplicates: true }
      );
      if (error) {
        notify('Не удалось сохранить маршрут. Проверьте, что SQL установлен в Supabase.', 'error');
        console.error(error);
        return false;
      }
      state.favorites.add(routeId);
      notify('Маршрут добавлен в избранное.');
    }
    dispatchAuthEvent();
    return true;
  }

  async function addToPlan(route) {
    if (!state.user) { openAuthModal('login'); return false; }
    const routeId = String(route.id);
    const existing = state.plan.find(row => String(row.route_id) === routeId);

    if (existing) {
      const client = await getClient();
      const { error } = await client.from('trip_plan').delete().eq('id', existing.id).eq('user_id', state.user.id);
      if (error) {
        notify(error.message || 'Не удалось удалить маршрут из плана.', 'error');
        return false;
      }
      state.plan = state.plan.filter(row => row.id !== existing.id);
      dispatchAuthEvent();
      notify('Маршрут удалён из вашего плана.');
      return true;
    }

    const client = await getClient();
    const { data, error } = await client.from('trip_plan').insert({
      user_id: state.user.id,
      route_id: route.id,
      status: 'planned'
    }).select('id, route_id, planned_date, status, note, created_at').single();
    if (error) {
      notify('Не удалось добавить маршрут. Проверьте, что SQL установлен в Supabase.', 'error');
      console.error(error);
      return false;
    }
    state.plan.unshift(data);
    dispatchAuthEvent();
    notify('Маршрут добавлен в ваш план.');
    return true;
  }

  async function removeFromPlan(id) {
    if (!state.user) return false;
    const client = await getClient();
    const { error } = await client.from('trip_plan').delete().eq('id', id).eq('user_id', state.user.id);
    if (error) {
      notify(error.message || 'Не удалось удалить запись.', 'error');
      return false;
    }
    state.plan = state.plan.filter(row => row.id !== id);
    dispatchAuthEvent();
    notify('Запись удалена из плана.');
    return true;
  }

  async function updatePlan(id, updates) {
    if (!state.user) return false;
    const safeUpdates = {
      planned_date: updates.planned_date || null,
      status: updates.status === 'completed' ? 'completed' : 'planned',
      note: String(updates.note || '').slice(0, 1500)
    };
    const client = await getClient();
    const { data, error } = await client.from('trip_plan').update(safeUpdates)
      .eq('id', id).eq('user_id', state.user.id)
      .select('id, route_id, planned_date, status, note, created_at').single();
    if (error) {
      notify(error.message || 'Не удалось сохранить изменения.', 'error');
      return false;
    }
    state.plan = state.plan.map(row => row.id === id ? data : row);
    dispatchAuthEvent();
    notify('Изменения сохранены.');
    return true;
  }

  function isFavorite(id) {
    return state.favorites.has(String(id));
  }

  function isPlanned(id) {
    return state.plan.some(row => String(row.route_id) === String(id));
  }

  // Подключаем кнопки избранного и плана походов.
  function bindRouteActions(root, route) {
    const favButtons = root.querySelectorAll('.btn-fav');
    const planButtons = root.querySelectorAll('.btn-plan');

    const sync = () => {
      const favorite = isFavorite(route.id);
      const planned = isPlanned(route.id);

      favButtons.forEach(button => {
        button.innerHTML = favorite ? '♥ В избранном' : '♡ В избранное';
        button.classList.toggle('is-favorite', favorite);
        button.setAttribute('aria-pressed', favorite ? 'true' : 'false');
      });

      planButtons.forEach(button => {
        button.textContent = planned ? '✓ В моём плане' : 'Добавить в мой план';
        button.classList.toggle('is-added', planned);
        button.setAttribute('aria-pressed', planned ? 'true' : 'false');
      });
    };

    const runButtonAction = async (button, action) => {
      if (button.disabled) return;

      button.disabled = true;
      button.classList.add('is-loading');
      button.setAttribute('aria-busy', 'true');

      try {
        const success = await action();
        if (success) sync();
      } catch (error) {
        console.error('[Тропы] Не удалось изменить состояние маршрута:', error);
        notify('Не удалось сохранить изменение. Попробуйте ещё раз.', 'error');
      } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
        sync();
      }
    };

    favButtons.forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        runButtonAction(button, () => toggleFavorite(route));
      });
    });

    planButtons.forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        runButtonAction(button, () => addToPlan(route));
      });
    });

    sync();
    window.addEventListener('trail-auth-change', sync);
  }

  function renderAccountSignedOut() {
    const root = document.getElementById('account-content');
    if (!root) return;
    root.innerHTML = `
      <div class="account-locked">
        <div class="account-empty-icon">🔐</div>
        <h2>Войдите в свой аккаунт</h2>
        <p>После входа здесь появятся сохранённые маршруты и ваш личный план походов.</p>
        <button class="btn btn-primary" type="button" data-account-login>Войти или зарегистрироваться</button>
      </div>`;
    root.querySelector('[data-account-login]').addEventListener('click', () => openAuthModal('login'));
  }

  async function init() {
    ensureModal();
    updateHeader();
    try {
      const client = await getClient();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      state.user = data.session?.user || null;
      await loadProfile();
      await loadCollections();
      client.auth.onAuthStateChange((_event, session) => {
        state.user = session?.user || null;
        Promise.resolve().then(async () => {
          try {
            await loadProfile();
            await loadCollections();
          } catch (error) { console.error(error); }
          updateHeader();
          dispatchAuthEvent();
        });
      });
    } catch (error) {
      console.error('[Тропы] Инициализация аккаунта:', error);
    }
    updateHeader();
    dispatchAuthEvent('trail-auth-ready');
  }

  state.readyPromise = init();

  window.TrailAuth = {
    ready: () => state.readyPromise,
    getClient,
    getUser: () => state.user,
    getRole: () => state.role,
    isAdmin: () => state.role === 'admin',
    getFavorites: () => Array.from(state.favorites),
    getPlan: () => state.plan.slice(),
    isFavorite,
    isPlanned,
    toggleFavorite,
    addToPlan,
    removeFromPlan,
    updatePlan,
    bindRouteActions,
    openAuthModal,
    notify,
    renderAccountSignedOut
  };
})();
