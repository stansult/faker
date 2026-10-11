const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const generator = path.join(__dirname, "build_constants.mjs");

function generate(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "faker-constants-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, ...overrides };
  if (!("VOTE_TOTAL_SECONDS" in overrides)) delete env.VOTE_TOTAL_SECONDS;
  if (!("VOTE_FINAL_SECONDS" in overrides)) delete env.VOTE_FINAL_SECONDS;

  const result = spawnSync(process.execPath, [generator], {
    cwd: directory,
    env,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(directory, "validationConstants.js"), "utf8");
}

test("generates production browser constants by default", t => {
  const output = generate(t);
  assert.match(output, /"VOTE_TOTAL_SECONDS": 30/);
  assert.match(output, /"VOTE_FINAL_SECONDS": 5/);
});

test("generates explicit development and test timer overrides", t => {
  const output = generate(t, {
    VOTE_TOTAL_SECONDS: "300",
    VOTE_FINAL_SECONDS: "10"
  });
  assert.match(output, /"VOTE_TOTAL_SECONDS": 300/);
  assert.match(output, /"VOTE_FINAL_SECONDS": 10/);
});
