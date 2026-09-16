const fs = require("node:fs");

function isMarkdownOnly(paths) {
  return Array.isArray(paths) &&
    paths.length > 0 &&
    paths.every(filePath => typeof filePath === "string" && filePath.endsWith(".md"));
}

function shouldRunTests(paths, { uncertain = false } = {}) {
  return uncertain || !isMarkdownOnly(paths);
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
  process.exitCode = isMarkdownOnly(paths) ? 0 : 1;
}

module.exports = { isMarkdownOnly, shouldRunTests, shouldRunTestsForPush };
