const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "site");
const output = path.join(__dirname, "public");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

// Публикуем только страницы, стили, скрипты и изображения.
for (const name of fs.readdirSync(source)) {
  if (!name.endsWith(".html")) continue;
  fs.copyFileSync(path.join(source, name), path.join(output, name));
}
for (const directory of ["css", "js", "assets"]) {
  fs.cpSync(path.join(source, directory), path.join(output, directory), { recursive: true });
}
console.log("Статические файлы собраны в public/");
