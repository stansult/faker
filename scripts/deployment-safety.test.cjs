const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  deploymentReadiness,
  environment
} = require("./deployment-safety.cjs");

function fixture(currentSha = "tested") {
  return {
    context: {
      repo: { owner: "owner", repo: "faker" },
      sha: "tested"
    },
    github: {
      rest: {
        repos: {
          getBranch: async () => ({ data: { commit: { sha: currentSha } } })
        }
      }
    }
  };
}

test("uses the production deployment environment", () => {
  assert.equal(environment, "netlify-production");

  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "test.yml"),
    "utf8"
  );
  assert.match(
    workflow,
    /\n  deploy:\n[\s\S]*?\n    environment: netlify-production\n/,
    "deploy job must bind the environment that owns the Netlify secrets"
  );
});

test("retains a Playwright HTML report without hiding terminal results", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "test.yml"),
    "utf8"
  );
  const playwrightConfig = fs.readFileSync(
    path.join(__dirname, "..", "playwright.config.mjs"),
    "utf8"
  );

  assert.match(playwrightConfig, /process\.env\.CI[\s\S]*?\[\["list"\], \["html", \{ open: "never" \}\]\]/);
  assert.match(
    workflow,
    /name: Upload Playwright HTML report[\s\S]*?uses: actions\/upload-artifact@v7[\s\S]*?if: \$\{\{ !cancelled\(\) \}\}[\s\S]*?name: playwright-report[\s\S]*?path: playwright-report\/[\s\S]*?retention-days: 30[\s\S]*?if-no-files-found: ignore/,
    "hosted browser tests should retain a downloadable report for 30 days"
  );
});

test("uses the deployed commit subject as the Netlify deploy message", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "test.yml"),
    "utf8"
  );

  assert.ok(
    workflow.includes('--message="$(git show -s --format=%s "$GITHUB_SHA")"'),
    "Netlify deploy history should show the exact deployed commit subject"
  );
  assert.doesNotMatch(workflow, /--message="GitHub Actions/);
});

test("allows the tested tip of main to deploy", async () => {
  const result = await deploymentReadiness(fixture());
  assert.equal(result.ready, true);
  assert.match(result.reason, /current tip/);
});

test("rejects a tested commit superseded on main", async () => {
  const result = await deploymentReadiness(fixture("newer"));
  assert.equal(result.ready, false);
  assert.match(result.reason, /no longer the tip/);
});

test("fails closed when GitHub branch lookup fails", async () => {
  const input = fixture();
  input.github.rest.repos.getBranch = async () => {
    throw new Error("GitHub unavailable");
  };
  await assert.rejects(deploymentReadiness(input), /GitHub unavailable/);
});
