
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const button = $("trail-chat-button");
  const win = $("trail-chat-window");
  const close = $("trail-chat-close");
  const messagesBox = $("trail-chat-messages");
  const form = $("trail-chat-input-area");
  const input = $("trail-chat-input");
  if (!button || !win || !messagesBox || !form || !input) return;

  // Ключи для сохранения истории чата.
  const HISTORY_KEY = "trail_chat_history_v1";
  const SESSION_KEY = "trail_chat_session_v1";
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  let history = [];
  let busy = false;

  function openChat() {
    win.classList.add("open");
    win.setAttribute("aria-hidden", "false");
    input.focus();
  }
  function closeChat() {
    win.classList.remove("open");
    win.setAttribute("aria-hidden", "true");
  }
  button.addEventListener("click", openChat);
  if (close) close.addEventListener("click", closeChat);
  function scrollBottom() {
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function formatMessage(value) {
    let html = escapeHtml(value);
    html = html.replace(/^###?\s+(.+)$/gm, '<strong class="trail-md-heading">$1</strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|\s)\*([^*\n]+)\*/g, "$1<em>$2</em>");
    html = html.replace(/route\.html\?slug=([a-zA-Z0-9%_-]+)/g, '<a href="route.html?slug=$1">Открыть маршрут</a>');
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<span class="trail-md-list-item">• $1</span>');
    html = html.replace(/\n/g, "<br>");
    return html;
  }
  // Создаём сообщение для окна чата.
  function createMessageElement(text, role) {
    const element = document.createElement("div");
    element.className = "trail-msg " + role;

    if (role === "bot") {
      element.innerHTML = formatMessage(text);
    } else {
      element.textContent = text;
    }

    return element;
  }

  function addText(text, role, save = true) {
    const el = createMessageElement(text, role);
    messagesBox.appendChild(el);
    scrollBottom();
    if (save && (role === "user" || role === "bot")) {
      history.push({ role: role === "user" ? "user" : "assistant", content: text });
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }
    return el;
  }
  // Восстанавливаем сообщения из истории.
  function renderHistory() {
    const saved = sessionStorage.getItem(HISTORY_KEY);
    if (!saved) return false;
    try {
      history = JSON.parse(saved);
      if (!Array.isArray(history)) {
        history = [];
      }
    } catch (_) {
      history = [];
    }
    if (!history.length) return false;
    messagesBox.innerHTML = "";
    history.forEach(item => {
      const role = item.role === "user" ? "user" : "bot";
      messagesBox.appendChild(createMessageElement(item.content, role));
    });
    scrollBottom();
    return true;
  }
  // Сохраняем переписку пользователя.
  async function saveHistory() {
    try {
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, messages: history }),
      });
    } catch (error) {
      console.warn("Не удалось сохранить историю на локальный сервер:", error);
    }
  }
  // Получаем маршруты для подсказок.
  async function getRoutes() {
    if (window.TRAIL_ROUTES_PROMISE) return await window.TRAIL_ROUTES_PROMISE;
    if (typeof window.loadTrailRoutes === "function") return await window.loadTrailRoutes();
    const list = window.APP_STATE && Array.isArray(window.APP_STATE.allRoutes) ? window.APP_STATE.allRoutes : [];
    return list;
  }
  // Проверяем простые вопросы без запроса к серверу.
  function quickAnswer(text) {
    const normalized = text.toLowerCase().replace(/ё/g, "е").replace(/[!.,?…]+/g, " ").replace(/\s+/g, " ").trim();
    if (/^(привет|здравствуй|здравствуйте|добрый день|доброе утро|добрый вечер|хай|хелло|hello|hi)$/.test(normalized)) {
      return "Привет! 👋 Рад помочь с выбором маршрута.\n\nМожешь рассказать, какой у тебя опыт, куда хочешь отправиться и на сколько дней планируешь поход.";
    }
    if (/^(кто ты|ты кто|что ты такое|представься)$/.test(normalized)) {
      return "Я — ИИ-помощник сайта «Тропы России». 🌲\n\nПомогаю подобрать пешие маршруты из каталога, разобраться со сложностью, подготовкой, снаряжением и логистикой. Стараюсь опираться на данные сайта и не выдумывать характеристики маршрутов.";
    }
    if (/^(спасибо|спс|благодарю|спасибо большое)$/.test(normalized)) {
      return "Пожалуйста! 😊 Если появятся вопросы по маршрутам или подготовке — обращайся.";
    }
    if (/^(пока|до свидания|до встречи)$/.test(normalized)) {
      return "До встречи! Хороших прогулок и безопасных походов! 🌿";
    }
    if (/^(помоги|что ты умеешь|чем поможешь)$/.test(normalized)) return "Могу подобрать маршрут по уровню подготовки, региону, расстоянию и длительности; подсказать по снаряжению, подготовке и дороге к началу маршрута.\n\nНапример, напиши: «Я новичок, хочу пройти 5–8 км за один день в Карелии».";
    return null;
  }
  // Готовим подсказку для начинающего туриста.
  async function beginnerAnswer() {
    const routes = await getRoutes();
    if (!routes.length) {
      return "Для первого похода лучше выбирать лёгкий маршрут на один день, без сложных участков и с понятным подъездом.\n\nСейчас каталог маршрутов ещё не загрузился или недоступен. Попробуй немного позже — тогда я смогу предложить конкретные варианты из каталога.\n\nКуда тебе интереснее отправиться: в лес, к озёрам, в горы или к морю?";
    }
    const easy = routes.filter(r => /легк|начина|простой/i.test(String(r.difficulty || "")) || Number(r.distance_km) > 0 && Number(r.distance_km) <= 10)
      .sort((a, b) => (Number(a.distance_km) || 9999) - (Number(b.distance_km) || 9999)).slice(0, 3);
    if (!easy.length) {
      return "В каталоге пока не нашёл маршрутов, которые явно отмечены как лёгкие или имеют небольшую дистанцию. Могу подобрать варианты после уточнения региона и желаемой длины прогулки.";
    }
    let answer = "Отлично! Для первого похода советую начать с короткого маршрута на один день и постепенно увеличивать нагрузку. 🌿\n\n**Вот несколько вариантов из каталога:**\n";
    easy.forEach((r, i) => {
      answer += `\n**${i + 1}. ${r.title || "Маршрут без названия"}**\n`;
      const details = [r.region_name, r.difficulty, r.distance_km != null ? `${r.distance_km} км` : null, r.duration_text].filter(Boolean);
      if (details.length) answer += details.join(" · ") + "\n";
      if (r.short_announcement || r.description) answer += String(r.short_announcement || r.description).slice(0, 220) + "\n";
      if (r.slug) answer += `Открыть маршрут: route.html?slug=${encodeURIComponent(r.slug)}\n`;
    });
    answer += "\nПодскажи, в каком регионе хочешь гулять и сколько километров комфортно пройти за день?";
    return answer;
  }
  function isBeginnerMessage(text) {
    const normalized = text.toLowerCase().replace(/ё/g, "е");
    return /\bя новичок\b|\bновичок\b|\bнович(е|ё)к\b|\bнет опыта\b|\bпервый поход\b/.test(normalized);
  }

  // Отправляем сообщение и показываем ответ.
  async function sendMessage(text) {
    const value = String(text || input.value).trim();
    if (!value || busy) {
      return;
    }
    addText(value, "user");
    input.value = "";

    const quick = quickAnswer(value);
    if (quick) {
      addText(quick, "bot");
      await saveHistory();
      return;
    }

    if (isBeginnerMessage(value)) {
      busy = true;
      const loadingQuick = createMessageElement("Загружаю маршруты из каталога...", "bot");
      messagesBox.appendChild(loadingQuick);
      scrollBottom();
      try {
        try {
          const answer = await beginnerAnswer();
          loadingQuick.remove();
          addText(answer, "bot");
        } catch (error) {
          loadingQuick.remove();
          addText("Не удалось получить маршруты из каталога. Попробуй ещё раз чуть позже.", "bot");
          console.error("[Помощник] Ошибка подбора маршрутов:", error);
        } finally {
          loadingQuick.remove();
        }

        await saveHistory();
      } finally {
        busy = false;
      }
      return;
    }

    busy = true;
    const loading = createMessageElement("Подбираю ответ...", "bot");
    messagesBox.appendChild(loading);
    scrollBottom();
    try {
      const loadedRoutes = await getRoutes();
      const routes = loadedRoutes.map(route => ({
        title: route.title,
        slug: route.slug,
        region_name: route.region_name,
        distance_km: route.distance_km,
        duration_text: route.duration_text,
        difficulty: route.difficulty,
        description: route.description,
        short_announcement: route.short_announcement,
        best_months: route.best_months,
        how_to_get: route.how_to_get,
        equipment: route.equipment,
        tags: route.tags,
        route_type: route.route_type,
        elevation_m: route.elevation_m,
      }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          messages: history.filter(m => m.role === "user" || m.role === "assistant").slice(-30),
          routes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      loading.remove();
      if (!response.ok) {
        addText(data.error || ("Ошибка сервера: " + response.status), "bot");
      } else if (data.answer) {
        addText(data.answer, "bot");
      } else {
        addText("Сервер не вернул ответ. Проверь настройки и журнал сервера.", "bot");
      }
      await saveHistory();
    } catch (error) {
      loading.remove();
      addText("Не удалось связаться с локальным сервером. Убедись, что он запущен командой npm start и открыт Live Server в VS Code.", "bot");
      await saveHistory();
    } finally {
      busy = false;
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    sendMessage(input.value);
  });
  messagesBox.addEventListener("click", event => {
    const prompt = event.target.closest("[data-prompt]");
    if (prompt) {
      sendMessage(prompt.dataset.prompt);
    }
  });
  renderHistory();
  if (!history.length) saveHistory();
})();
