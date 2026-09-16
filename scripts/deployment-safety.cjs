const environment = "netlify-production";

async function deploymentReadiness({ github, context }) {
  const { data: branch } = await github.rest.repos.getBranch({
    ...context.repo,
    branch: "main"
  });

  if (branch.commit.sha !== context.sha) {
    return {
      ready: false,
      reason: "Skipped: this tested commit is no longer the tip of main."
    };
  }

  return {
    ready: true,
    reason: "Ready: tests passed and this commit is the current tip of main."
  };
}

module.exports = { deploymentReadiness, environment };
