import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = "itch";
const API_BASE = "https://play-faker.us";
const FUNCTIONS_PREFIX = "/.netlify/functions/";

const filesToCopy = [
  "styles.css",
  "favicon.svg",
  "validationConstants.js",
  "uiErrors.js"
];

const outDir = resolve(OUT_DIR);
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

const indexHtml = readFileSync(resolve("index.html"), "utf8")
  .replace('href="/favicon.svg"', 'href="./favicon.svg"');
writeFileSync(resolve(outDir, "index.html"), indexHtml, "utf8");

const appJs = readFileSync(resolve("app.js"), "utf8")
  .replaceAll(FUNCTIONS_PREFIX, `${API_BASE}${FUNCTIONS_PREFIX}`);
writeFileSync(resolve(outDir, "app.js"), appJs, "utf8");

for (const file of filesToCopy) {
  copyFileSync(resolve(file), resolve(outDir, file));
}

console.log(`Itch build ready in ./${OUT_DIR}`);
