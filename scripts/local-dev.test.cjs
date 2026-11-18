const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repository = path.join(__dirname, "..");

test("supported local servers use isolated Netlify Dev ports and offline storage", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repository, "package.json"), "utf8")
  );
  const liveScript = fs.readFileSync(path.join(__dirname, "dev_live.sh"), "utf8");
  const netlifyConfig = fs.readFileSync(path.join(repository, "netlify.toml"), "utf8");

  for (const command of [packageJson.scripts.dev, packageJson.scripts["dev:lan"], liveScript]) {
    assert.match(command, /netlify dev --offline --no-open/);
    assert.match(command, /--command "python3 -m http\.server 3999"/);
    assert.match(command, /--target-port 3999/);
    assert.match(command, /--functions-port 9999/);
    assert.match(command, /--port 8888/);
  }

  assert.doesNotMatch(netlifyConfig, /^\[dev\]$/m);
});
