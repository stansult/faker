import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeValidationConstants } from "./build_constants.mjs";

const OUT_DIR = "dist";
const ARCHIVE_NAME = "faker-itch.zip";
const API_BASE = "https://play-faker.us";
const FUNCTIONS_PREFIX = "/.netlify/functions/";

const filesToCopy = [
  "styles.css",
  "favicon.svg",
  "uiErrors.js"
];
const generatedFiles = ["validationConstants.js"];

const outDir = resolve(OUT_DIR);
const archive = resolve(outDir, ARCHIVE_NAME);
const stagingDir = mkdtempSync(join(tmpdir(), "faker-itch-"));
mkdirSync(outDir, { recursive: true });
rmSync(archive, { force: true });

try {
  const indexHtml = readFileSync(resolve("index.html"), "utf8")
    .replace('href="/favicon.svg"', 'href="./favicon.svg"');
  writeFileSync(resolve(stagingDir, "index.html"), indexHtml, "utf8");

  const appJs = readFileSync(resolve("app.js"), "utf8")
    .replaceAll(FUNCTIONS_PREFIX, `${API_BASE}${FUNCTIONS_PREFIX}`);
  writeFileSync(resolve(stagingDir, "app.js"), appJs, "utf8");

  for (const file of filesToCopy) {
    copyFileSync(resolve(file), resolve(stagingDir, file));
  }

  writeValidationConstants(resolve(stagingDir, "validationConstants.js"), {});

  const files = ["index.html", "app.js", ...filesToCopy, ...generatedFiles];
  const result = spawnSync("zip", ["-q", "-X", archive, ...files], {
    cwd: stagingDir,
    encoding: "utf8"
  });
  if (result.error) {
    throw new Error(`Unable to create Itch archive: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Unable to create Itch archive: ${result.stderr || result.stdout}`);
  }
} catch (error) {
  rmSync(archive, { force: true });
  throw error;
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}

console.log(`Itch upload ready in ./${OUT_DIR}/${ARCHIVE_NAME}`);
