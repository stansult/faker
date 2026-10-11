const fs = require("node:fs");

const DOCUMENTATION_ASSET_EXTENSION = /\.(?:png|jpe?g|webp|gif|svg)$/;

function isDocumentationPath(filePath) {
  if (typeof filePath !== "string") return false;
  if (filePath.endsWith(".md")) return true;
  if (!filePath.startsWith("docs/")) return false;

  const segments = filePath.slice("docs/".length).split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    return false;
  }
  return DOCUMENTATION_ASSET_EXTENSION.test(filePath);
}

function isDocumentationOnly(paths) {
  return Array.isArray(paths) &&
    paths.length > 0 &&
    paths.every(isDocumentationPath);
}

function shouldRunTests(paths, { uncertain = false } = {}) {
  return uncertain || !isDocumentationOnly(paths);
}

function shouldRunTestsForPush(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return true;
  return refs.some(ref => shouldRunTests(ref?.paths, { uncertain: !!ref?.uncertain }));
}

if (require.main === module) {
  const paths = fs.readFileSync(0)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  process.exitCode = isDocumentationOnly(paths) ? 0 : 1;
}

module.exports = { isDocumentationOnly, shouldRunTests, shouldRunTestsForPush };
