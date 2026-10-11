const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const updater = path.join(__dirname, "update_cache_busters.sh");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("refreshes browser cache keys when shared constants change", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "faker-cache-busters-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "shared"));
  fs.writeFileSync(
    path.join(directory, "index.html"),
    [
      '<link rel="stylesheet" href="./styles.css?v=old">',
      '<script src="./validationConstants.js?v=old"></script>',
      '<script src="./uiErrors.js?v=old"></script>',
      '<script src="./app.js?v=old"></script>'
    ].join("\n")
  );
  for (const file of ["styles.css", "app.js", "uiErrors.js"]) {
    fs.writeFileSync(path.join(directory, file), `${file}\n`);
  }
  fs.writeFileSync(path.join(directory, "shared", "validationConstants.cjs"), "module.exports = {};\n");

  run("git", ["init", "-q"], { cwd: directory });
  run("git", ["config", "user.email", "tests@example.com"], { cwd: directory });
  run("git", ["config", "user.name", "Faker Tests"], { cwd: directory });
  run("git", ["add", "."], { cwd: directory });
  run("git", ["commit", "-qm", "fixture"], { cwd: directory });
  const revision = run("git", ["rev-parse", "--short", "HEAD"], { cwd: directory });

  fs.appendFileSync(path.join(directory, "shared", "validationConstants.cjs"), "// changed\n");
  run("git", ["add", "shared/validationConstants.cjs"], { cwd: directory });
  run("sh", [updater], { cwd: directory });

  const indexHtml = fs.readFileSync(path.join(directory, "index.html"), "utf8");
  for (const asset of ["styles.css", "validationConstants.js", "uiErrors.js", "app.js"]) {
    assert.match(indexHtml, new RegExp(`${asset.replace(".", "\\.")}\\?v=${revision}`));
  }
  assert.match(run("git", ["diff", "--cached", "--name-only"], { cwd: directory }), /index\.html/);
});
