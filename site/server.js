const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(ROOT, "chat-history");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".gpx": "application/gpx+xml"
};

// Загружаем настройки из .env.
function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  });
}
loadEnv();

// Используем системные корневые сертификаты и доверенные сертификаты GigaChat.
const tls = require("tls");
const caBundlePath = path.join(ROOT, "certs", "russian_trusted_ca_bundle.pem");
const trustedCerts = [...tls.rootCertificates];
if (fs.existsSync(caBundlePath)) {
  trustedCerts.push(fs.readFileSync(caBundlePath, "utf8"));
}
const gigaChatAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: true,
  ca: trustedCerts
});

// Отправляем HTTPS-запрос к внешнему сервису.
function httpsRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: options.headers || {},
      agent: gigaChatAgent
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(body); } catch (_) { }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => json || {},
          text: async () => body
        });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
// Читаем данные входящего запроса.
function readBody(req) {
  if (req.body !== undefined) {
    try {
      return Promise.resolve(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
    } catch (error) {
      return Promise.reject(new Error("Некорректный JSON"));
    }
  }
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Слишком большой запрос"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch (_) { reject(new Error("Некорректный JSON")); }
    });
    req.on("error", reject);
  });
}
function safeSession(id) {
  return typeof id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : null;
}
// Находим файл истории по идентификатору.
function historyPath(id) {
  return path.join(DATA_DIR, id + ".json");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    res.writeHead(204);
    return res.end();
  }

  // Отдаём браузеру только публичные настройки Supabase.
  if (req.method === "GET" && url.pathname === "/api/public-config") {
    const config = {};
    const configFile = path.join(ROOT, "config.txt");
    if (!process.env.VERCEL && fs.existsSync(configFile)) {
      for (const line of fs.readFileSync(configFile, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
        const index = trimmed.indexOf("=");
        if (index < 0) continue;
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        if (key === "SUPABASE_URL" || key === "SUPABASE_ANON_KEY") config[key] = value;
      }
    }
    return send(res, 200, {
      SUPABASE_URL: process.env.SUPABASE_URL || config.SUPABASE_URL || "",
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || config.SUPABASE_ANON_KEY || ""
    });
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/history") {
    try {
      const body = await readBody(req);
      const id = safeSession(body.sessionId);
      if (!id) return send(res, 400, { error: "Некорректный идентификатор сессии." });
      if (process.env.VERCEL) {
        // На Vercel история сохраняется в браузере, без записи в файловую систему функции.
        return send(res, 200, { saved: true, storage: "browser" });
      }
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const messages = Array.isArray(body.messages) ? body.messages : [];
      fs.writeFileSync(historyPath(id), JSON.stringify({ updatedAt: new Date().toISOString(), messages }, null, 2), "utf8");
      return send(res, 200, { saved: true });
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const body = await readBody(req);
      if (!process.env.GIGACHAT_AUTH_KEY) {
        return send(res, 500, { error: "Не найден GIGACHAT_AUTH_KEY. Добавь переменную окружения в настройках Vercel." });
      }
      const id = safeSession(body.sessionId);
      if (!id) return send(res, 400, { error: "Некорректный идентификатор сессии." });

      const messages = Array.isArray(body.messages) ? body.messages : [];
      const routes = Array.isArray(body.routes) ? body.routes : [];
      const system = [
        "Ты — ИИ-помощник сайта «Тропы России» по подбору пеших маршрутов. Всегда отвечай только на русском языке.",
        "Твоя ЕДИНСТВЕННАЯ роль: помогать находить, сравнивать и планировать пешие маршруты по России из переданного каталога.",
        "Жёсткие ограничения:",
        "- Не решай задачи по программированию, математике, C++, Python и любым другим темам вне туризма и маршрутов.",
        "- Не пиши код, не объясняй алгоритмы, не выполняй учебные задания.",
        "- Если пользователь спрашивает не про маршруты/походы/снаряжение/безопасность троп — вежливо откажи и верни разговор к подбору маршрута.",
        "- Не придумывай маршруты, километраж, время, цены, пропуска, координаты и условия, которых нет в каталоге.",
        "Как работать:",
        "1) Сначала изучи каталог маршрутов (JSON ниже).",
        "2) Для новичков предлагай в первую очередь лёгкие и короткие маршруты.",
        "3) Учитывай регион, дистанцию, длительность, сезон, тип похода и пожелания пользователя.",
        "4) Предлагай до 3 подходящих маршрутов с названием, регионом, сложностью, расстоянием и длительностью — только если эти поля есть в данных.",
        "5) Если данных мало — задай один-два коротких уточняющих вопроса (регион, опыт, сколько дней).",
        "6) Если подходящих маршрутов нет — скажи об этом честно и предложи расширить критерии.",
        "7) Не утверждай, что погода, состояние тропы или безопасность актуальны в реальном времени.",
        "8) Не повторяй приветствие в каждом ответе. Отвечай компактно: короткие абзацы и списки.",
        "Каталог маршрутов (JSON):",
        JSON.stringify(routes).slice(0, 45000)
      ].join("\n\n");

      const recent = messages.filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string").slice(-30);

      const tokenResponse = await httpsRequest("https://ngw.devices.sberbank.ru:9443/api/v2/oauth", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + process.env.GIGACHAT_AUTH_KEY,
          "RqUID": require("crypto").randomUUID(),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "scope=" + encodeURIComponent(process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS")
      });
      const tokenResult = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenResult.access_token) {
        const detail = tokenResult.message || tokenResult.error_description || tokenResult.error || "Не удалось получить OAuth-токен.";
        console.error("GigaChat OAuth:", tokenResponse.status, detail);
        return send(res, tokenResponse.status || 502, { error: "Ошибка авторизации GigaChat: " + detail });
      }

      const apiResponse = await httpsRequest("https://api.giga.chat/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + tokenResult.access_token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.GIGACHAT_MODEL || "GigaChat-2",
          messages: [{ role: "system", content: system }, ...recent],
          temperature: 0.6,
          max_tokens: 3000
        })
      });

      const result = await apiResponse.json();
      if (!apiResponse.ok) {
        const detail = result.message || (result.error && result.error.message) || "GigaChat API вернул ошибку.";
        console.error("GigaChat API:", apiResponse.status, detail);
        return send(res, apiResponse.status, { error: "Ошибка GigaChat API (" + apiResponse.status + "): " + detail });
      }
      const choice = result.choices && result.choices[0];
      const answer = choice && choice.message && choice.message.content;
      if (!answer) {
        return send(res, 502, { error: "Модель не вернула текст ответа. Проверь журнал сервера." });
      }
      if (choice.finish_reason === "length") {
        console.warn("GigaChat: ответ достиг лимита токенов; max_tokens=3000.");
      }

      if (!process.env.VERCEL) {
        const fullHistory = [...recent, { role: "assistant", content: answer }];
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(historyPath(id), JSON.stringify({ updatedAt: new Date().toISOString(), messages: fullHistory }, null, 2), "utf8");
      }
      return send(res, 200, { answer });
    } catch (error) {
      console.error(error);
      return send(res, 500, { error: "Ошибка локального сервера: " + error.message });
    }
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/database' || pathname.startsWith('/database/')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const privatePaths = new Set(['.env', '.gitignore', 'config.txt', 'supabase_setup.sql']);
  const requestedParts = pathname.split('/').filter(Boolean);
  if (requestedParts.some(part => part.startsWith('.') || privatePaths.has(part)) ||
    ['chat-history', 'certs', 'node_modules'].includes(requestedParts[0])) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const filePath = path.resolve(ROOT, "." + pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Файл не найден");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(content);
  });
});

// Vercel вызывает обработчик напрямую, локально сервер запускается обычной командой.
module.exports = (req, res) => server.emit("request", req, res);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log("Сайт запущен: http://localhost:" + PORT);
    console.log("История чата сохраняется в папке chat-history.");
  });
}
