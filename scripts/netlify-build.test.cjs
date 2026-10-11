const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const repository = path.join(__dirname, "..");
const builder = path.join(__dirname, "build_netlify.mjs");

test("builds a production artifact without a generated working-tree file", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "faker-netlify-build-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  for (const file of ["app.js", "favicon.svg", "index.html", "styles.css", "uiErrors.js"]) {
    fs.copyFileSync(path.join(repository, file), path.join(directory, file));
  }
  fs.cpSync(path.join(repository, "netlify"), path.join(directory, "netlify"), {
    recursive: true
  });
  fs.cpSync(path.join(repository, "shared"), path.join(directory, "shared"), {
    recursive: true
  });

  const result = spawnSync(process.execPath, [builder], {
    cwd: directory,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(directory, "validationConstants.js")), false);

  const generated = fs.readFileSync(
    path.join(directory, "dist", "netlify-deploy", "site", "validationConstants.js"),
    "utf8"
  );
  assert.match(generated, /"VOTE_TOTAL_SECONDS": 30/);
  assert.match(generated, /"VOTE_FINAL_SECONDS": 5/);
});

test("configuration treats browser constants as ignored generated output", () => {
  const ignore = fs.readFileSync(path.join(repository, ".gitignore"), "utf8");
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repository, "package.json"), "utf8")
  );

  assert.match(ignore, /^validationConstants\.js$/m);
  assert.equal(packageJson.scripts["build:netlify"], "node scripts/build_netlify.mjs");
});
