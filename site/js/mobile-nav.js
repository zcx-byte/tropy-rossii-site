// Мобильное меню на всех страницах.
(() => {
  const button = document.querySelector('.menu-btn');
  const nav = document.querySelector('.header .nav');
  if (!button || !nav) return;

  const close = () => {
    nav.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Открыть меню');
  };

  button.setAttribute('type', 'button');
  button.setAttribute('aria-controls', 'mobile-navigation');
  button.setAttribute('aria-expanded', 'false');
  nav.id = 'mobile-navigation';

  button.addEventListener('click', () => {
    const open = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  });

  nav.addEventListener('click', event => {
    if (event.target.closest('a')) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  document.addEventListener('click', event => {
    if (!nav.contains(event.target) && !button.contains(event.target)) close();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 800) close();
  });
})();
