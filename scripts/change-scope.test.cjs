const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const {
  isDocumentationOnly,
  shouldRunTests,
  shouldRunTestsForPush
} = require("./change-scope.cjs");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stdout || ""}${result.stderr || ""}`
  );
  return result;
}

function createHookFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "faker-change-scope-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, ".githooks"));
  fs.mkdirSync(path.join(directory, "scripts"));
  fs.mkdirSync(path.join(directory, "bin"));

  for (const hookName of ["pre-commit", "pre-push"]) {
    fs.copyFileSync(
      path.join(__dirname, "..", ".githooks", hookName),
      path.join(directory, ".githooks", hookName)
    );
  }
  fs.copyFileSync(
    path.join(__dirname, "change-scope.cjs"),
    path.join(directory, "scripts", "change-scope.cjs")
  );
  fs.writeFileSync(
    path.join(directory, "scripts", "update_cache_busters.sh"),
    "#!/bin/sh\nexit 0\n"
  );

  const npmLog = path.join(directory, "npm.log");
  fs.writeFileSync(
    path.join(directory, "bin", "npm"),
    "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$HOOK_NPM_LOG\"\n"
  );
  fs.chmodSync(path.join(directory, "bin", "npm"), 0o755);

  run("git", ["init", "-q"], { cwd: directory });
  run("git", ["config", "user.email", "tests@example.com"], { cwd: directory });
  run("git", ["config", "user.name", "Tests"], { cwd: directory });

  const env = {
    ...process.env,
    PATH: `${path.join(directory, "bin")}:${process.env.PATH}`,
    HOOK_NPM_LOG: npmLog
  };
  return { directory, env, npmLog };
}

function commitFixture(directory, message) {
  run("git", ["add", "-A"], { cwd: directory });
  run("git", ["-c", "core.hooksPath=/dev/null", "commit", "-qm", message], {
    cwd: directory
  });
  return run("git", ["rev-parse", "HEAD"], { cwd: directory }).stdout.trim();
}

test("recognizes non-empty documentation-only changes", () => {
  assert.equal(isDocumentationOnly([
    "README.md",
    "docs/deployment.md",
    "tests/README.md",
    "docs/images/example.png",
    "docs/images/example.jpg",
    "docs/images/example.jpeg",
    "docs/diagrams/example.svg",
    "docs/example.webp",
    "docs/example.gif"
  ]), true);
});

test("requires tests for empty, mixed, operational, or application-asset changes", () => {
  assert.equal(shouldRunTests([]), true);
  assert.equal(shouldRunTests(["README.md", "app.js"]), true);
  assert.equal(shouldRunTests(["package.json"]), true);
  assert.equal(shouldRunTests([".github/workflows/test.yml"]), true);
  assert.equal(shouldRunTests(["README.MD"]), true);
  assert.equal(shouldRunTests(["docs/run.sh"]), true);
  assert.equal(shouldRunTests(["docs/config.yml"]), true);
  assert.equal(shouldRunTests(["docs/data.json"]), true);
  assert.equal(shouldRunTests(["docs/unknown.asset"]), true);
  assert.equal(shouldRunTests(["docs/../app.jpg"]), true);
  assert.equal(shouldRunTests(["docs//example.jpg"]), true);
  assert.equal(shouldRunTests(["images/example.jpg"]), true);
});

test("requires tests when change detection is uncertain", () => {
  assert.equal(shouldRunTests(["README.md"], { uncertain: true }), true);
});

test("requires tests when any pushed ref contains a non-documentation change", () => {
  assert.equal(shouldRunTestsForPush([
    { paths: ["README.md", "docs/images/example.jpg"] },
    { paths: ["docs/deployment.md", "docs/example.png"] }
  ]), false);
  assert.equal(shouldRunTestsForPush([
    { paths: ["README.md"] },
    { paths: ["app.js"] }
  ]), true);
  assert.equal(shouldRunTestsForPush([]), true);
});

test("CLI accepts NUL-delimited documentation paths and fails closed otherwise", () => {
  const cli = path.join(__dirname, "change-scope.cjs");
  const documentation = spawnSync(process.execPath, [cli], {
    input: "README.md\0docs/testing.md\0docs/images/example.jpg\0"
  });
  assert.equal(documentation.status, 0);

  for (const input of [
    "",
    "README.md\0app.js\0",
    "docs/run.sh\0",
    "images/example.jpg\0",
    "deleted.js\0renamed.md\0"
  ]) {
    const result = spawnSync(process.execPath, [cli], { input });
    assert.equal(result.status, 1, `expected tests for ${JSON.stringify(input)}`);
  }
});

test("hooks disable rename detection so removed source paths remain visible", () => {
  for (const hookName of ["pre-commit", "pre-push"]) {
    const hook = fs.readFileSync(path.join(__dirname, "..", ".githooks", hookName), "utf8");
    assert.match(hook, /--no-renames/);
    assert.match(hook, /-z/);
    assert.match(hook, /scripts\/change-scope\.cjs/);
  }
});

test("push workflow ignores only supported documentation changes", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "test.yml"),
    "utf8"
  );
  for (const pattern of [
    "**/*.md",
    "docs/**/*.png",
    "docs/**/*.jpg",
    "docs/**/*.jpeg",
    "docs/**/*.webp",
    "docs/**/*.gif",
    "docs/**/*.svg"
  ]) {
    assert.match(workflow, new RegExp(`- "${pattern.replaceAll("*", "\\*").replace(".", "\\.")}"`));
  }
  assert.doesNotMatch(workflow, /- "docs\/\*\*"/);
});

test("pre-commit hook skips tests only for a documentation-only staged change", t => {
  const { directory, env, npmLog } = createHookFixture(t);
  fs.writeFileSync(path.join(directory, "README.md"), "initial\n");
  commitFixture(directory, "initial");

  fs.appendFileSync(path.join(directory, "README.md"), "documentation\n");
  run("git", ["add", "README.md"], { cwd: directory });
  const markdown = run("sh", [".githooks/pre-commit"], { cwd: directory, env });
  assert.match(markdown.stdout, /Documentation-only commit/);
  assert.equal(fs.existsSync(npmLog), false);

  fs.mkdirSync(path.join(directory, "docs", "images"), { recursive: true });
  fs.writeFileSync(path.join(directory, "docs", "images", "example.jpg"), "image fixture\n");
  run("git", ["add", "docs/images/example.jpg"], { cwd: directory });
  const image = run("sh", [".githooks/pre-commit"], { cwd: directory, env });
  assert.match(image.stdout, /Documentation-only commit/);
  assert.equal(fs.existsSync(npmLog), false);

  fs.writeFileSync(path.join(directory, "app.js"), "console.log('test');\n");
  run("git", ["add", "app.js"], { cwd: directory });
  run("sh", [".githooks/pre-commit"], { cwd: directory, env });
  assert.deepEqual(fs.readFileSync(npmLog, "utf8").trim().split("\n"), [
    "run check:syntax",
    "test"
  ]);
});

test("pre-push hook checks all pushed refs and skips only documentation-only ranges", t => {
  const { directory, env, npmLog } = createHookFixture(t);
  fs.writeFileSync(path.join(directory, "README.md"), "initial\n");
  const initial = commitFixture(directory, "initial");
  fs.appendFileSync(path.join(directory, "README.md"), "documentation\n");
  fs.mkdirSync(path.join(directory, "docs", "images"), { recursive: true });
  fs.writeFileSync(path.join(directory, "docs", "images", "example.jpg"), "image fixture\n");
  const documentation = commitFixture(directory, "documentation");
  fs.writeFileSync(path.join(directory, "app.js"), "console.log('test');\n");
  const executable = commitFixture(directory, "executable");

  const docsPush = run("sh", [".githooks/pre-push"], {
    cwd: directory,
    env,
    input: `refs/heads/main ${documentation} refs/heads/main ${initial}\n`
  });
  assert.match(docsPush.stdout, /Documentation-only push/);
  assert.equal(fs.existsSync(npmLog), false);

  run("sh", [".githooks/pre-push"], {
    cwd: directory,
    env,
    input: [
      `refs/heads/docs ${documentation} refs/heads/docs ${initial}`,
      `refs/heads/main ${executable} refs/heads/main ${documentation}`,
      ""
    ].join("\n")
  });
  assert.equal(fs.readFileSync(npmLog, "utf8").trim(), "run test:api");
});
