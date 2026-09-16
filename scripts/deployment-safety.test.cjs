const assert = require("node:assert/strict");
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
