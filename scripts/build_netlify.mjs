import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync
} from "node:fs";
import { basename, join, resolve } from "node:path";

const OUTPUT_ROOT = resolve("dist/netlify-deploy");
const SITE_DIR = join(OUTPUT_ROOT, "site");
const FUNCTIONS_DIR = join(OUTPUT_ROOT, "netlify/functions");
const SHARED_DIR = join(OUTPUT_ROOT, "shared");

const STATIC_FILES = [
  "app.js",
  "build.txt",
  "favicon.svg",
  "index.html",
  "styles.css",
  "uiErrors.js",
  "validationConstants.js"
];

const functionFiles = readdirSync(resolve("netlify/functions"), { withFileTypes: true });
for (const entry of functionFiles) {
  if (!entry.isFile() || (entry.name !== "package.json" && !entry.name.endsWith(".js"))) {
    throw new Error(`Unexpected Netlify Functions source entry: ${entry.name}`);
  }
}

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(SITE_DIR, { recursive: true });
mkdirSync(FUNCTIONS_DIR, { recursive: true });
mkdirSync(SHARED_DIR, { recursive: true });

for (const file of STATIC_FILES) {
  const source = resolve(file);
  if (!existsSync(source)) throw new Error(`Missing production file: ${file}`);
  cpSync(source, join(SITE_DIR, basename(file)));
}

for (const entry of functionFiles) {
  cpSync(resolve("netlify/functions", entry.name), join(FUNCTIONS_DIR, entry.name));
}
cpSync(resolve("shared/validationConstants.cjs"), join(SHARED_DIR, "validationConstants.cjs"));

const copiedStatic = readdirSync(SITE_DIR).sort();
if (JSON.stringify(copiedStatic) !== JSON.stringify([...STATIC_FILES].sort())) {
  throw new Error(`Unexpected static artifact contents: ${copiedStatic.join(", ")}`);
}

console.log(`Netlify artifact ready in ${OUTPUT_ROOT}`);
console.log(`Static files: ${copiedStatic.length}; function sources: ${functionFiles.length}`);
