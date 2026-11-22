// Поиск в верхнем блоке использует фильтры каталога.
const heroSearchForm = document.getElementById("hero-search-form");

heroSearchForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const heroInput = document.getElementById("hero-search-input");
  const catalogInput = document.getElementById("filter-search");

  if (!heroInput || !catalogInput) {
    return;
  }

  catalogInput.value = heroInput.value;
  catalogInput.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("routes")?.scrollIntoView({ behavior: "smooth" });
});
