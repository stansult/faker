const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const builder = path.join(__dirname, "build_itch.mjs");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("builds an upload-ready Itch archive with production API URLs", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "faker-itch-build-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const temporaryDirectory = path.join(directory, "tmp");
  fs.mkdirSync(temporaryDirectory);

  const fixtures = {
    "index.html": '<link rel="icon" href="/favicon.svg"><script src="./app.js"></script>\n',
    "app.js": 'const endpoint = "/.netlify/functions/createRoom";\n',
    "styles.css": "body { color: black; }\n",
    "favicon.svg": "<svg></svg>\n",
    "validationConstants.js": "window.VALIDATION_CONSTANTS = { VOTE_TOTAL_SECONDS: 300, VOTE_FINAL_SECONDS: 10 };\n",
    "uiErrors.js": "window.UI_ERRORS = {};\n"
  };
  for (const [name, contents] of Object.entries(fixtures)) {
    fs.writeFileSync(path.join(directory, name), contents);
  }

  run(process.execPath, [builder], {
    cwd: directory,
    env: { ...process.env, TMPDIR: temporaryDirectory }
  });

  const archive = path.join(directory, "dist", "faker-itch.zip");
  assert.equal(fs.existsSync(archive), true);
  assert.equal(fs.existsSync(path.join(directory, "itch")), false);
  assert.deepEqual(fs.readdirSync(temporaryDirectory), []);

  const entries = run("unzip", ["-Z1", archive]).trim().split("\n").sort();
  assert.deepEqual(entries, Object.keys(fixtures).sort());

  const indexHtml = run("unzip", ["-p", archive, "index.html"]);
  assert.match(indexHtml, /href="\.\/favicon\.svg"/);

  const appJs = run("unzip", ["-p", archive, "app.js"]);
  assert.match(appJs, /https:\/\/play-faker\.us\/\.netlify\/functions\/createRoom/);
  assert.doesNotMatch(appJs, /["']\/\.netlify\/functions\//);

  const constants = run("unzip", ["-p", archive, "validationConstants.js"]);
  assert.match(constants, /"VOTE_TOTAL_SECONDS": 30/);
  assert.match(constants, /"VOTE_FINAL_SECONDS": 5/);
  assert.doesNotMatch(constants, /"VOTE_TOTAL_SECONDS": 300/);
});
