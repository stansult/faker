const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const repository = path.join(__dirname, "..");
const writer = path.join(__dirname, "write_build_info.sh");

test("writes UTC build metadata for the explicitly supplied commit", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "faker-build-info-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const commit = "0123456789abcdef0123456789abcdef01234567";
  const result = spawnSync("bash", [writer], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, COMMIT_REF: commit }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    fs.readFileSync(path.join(directory, "build.txt"), "utf8"),
    new RegExp(`^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC  ${commit.slice(0, 7)}\\n$`)
  );
});

test("refuses to guess build identity when no commit is supplied", () => {
  const result = spawnSync("bash", [writer], {
    encoding: "utf8",
    env: { ...process.env, COMMIT_REF: "" }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /COMMIT_REF must be set/);
});

test("rejects an invalid commit identity", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "faker-build-info-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const result = spawnSync("bash", [writer], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, COMMIT_REF: "not-a-commit" }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /COMMIT_REF must be a full commit SHA/);
  assert.equal(fs.existsSync(path.join(directory, "build.txt")), false);
});

test("deployment owns build metadata generation and live verification", () => {
  const hook = fs.readFileSync(path.join(repository, ".githooks", "pre-commit"), "utf8");
  const ignore = fs.readFileSync(path.join(repository, ".gitignore"), "utf8");
  const workflow = fs.readFileSync(
    path.join(repository, ".github", "workflows", "test.yml"),
    "utf8"
  );

  assert.doesNotMatch(hook, /write_build_info|update_build/);
  assert.match(ignore, /^build\.txt$/m);
  assert.match(
    workflow,
    /name: Generate build metadata[\s\S]*?COMMIT_REF: \$\{\{ github\.sha \}\}/
  );
  assert.match(
    workflow,
    /name: Verify live production build metadata[\s\S]*?DEPLOY_SHA: \$\{\{ github\.sha \}\}/
  );
});
