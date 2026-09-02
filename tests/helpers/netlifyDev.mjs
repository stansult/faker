import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, logs, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (logs().includes("Local dev server ready:")) return;
    try {
      const status = await new Promise((resolve, reject) => {
        const request = http.get(baseUrl, response => {
          response.resume();
          response.on("end", () => resolve(response.statusCode || 0));
        });
        request.once("error", reject);
        request.setTimeout(1000, () => {
          request.destroy(new Error("Readiness probe timed out"));
        });
      });
      if (status < 500) return;
    } catch {
      // Keep waiting until Netlify and the static file server are ready.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Netlify dev at ${baseUrl}\n\n${logs()}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("Failed to allocate a free port"));
      });
    });
  });
}

export async function startNetlifyDev(options = {}) {
  const repoRoot = options.cwd || process.cwd();
  const projectDir = await mkdtemp(join(tmpdir(), "faker-netlify-dev-"));
  const links = [
    "index.html",
    "app.js",
    "styles.css",
    "uiErrors.js",
    "validationConstants.js",
    "build.txt",
    "netlify",
    "shared",
    "node_modules",
    "package.json",
    "netlify.toml"
  ];

  for (const name of links) {
    try {
      await symlink(join(repoRoot, name), join(projectDir, name));
    } catch {
      // Some optional files may not exist in every checkout.
    }
  }

  const port = String(options.port || process.env.FAKER_TEST_PORT || await getFreePort());
  const targetPort = String(
    options.targetPort || process.env.FAKER_TEST_TARGET_PORT || await getFreePort()
  );
  const functionsPort = String(
    options.functionsPort || process.env.FAKER_TEST_FUNCTIONS_PORT || await getFreePort()
  );
  const baseUrl = `http://localhost:${port}`;

  const args = [
    "dev",
    "--offline",
    "--no-open",
    "--command",
    `python3 -m http.server ${targetPort}`,
    "--target-port",
    targetPort,
    "--functions",
    "netlify/functions",
    "--functions-port",
    functionsPort,
    "--port",
    port
  ];

  let output = "";
  const child = spawn("netlify", args, {
    cwd: projectDir,
    env: {
      ...process.env,
      ...options.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", chunk => {
    output += chunk.toString();
  });
  child.stderr.on("data", chunk => {
    output += chunk.toString();
  });

  const exitPromise = new Promise((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`Netlify dev exited early with code ${code} signal ${signal}\n\n${output}`));
    });
  });

  await Promise.race([
    waitForServer(baseUrl, () => output),
    exitPromise
  ]);

  return {
    baseUrl,
    logs: () => output,
    async stop() {
      if (child.exitCode == null && child.signalCode == null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise(resolve => child.once("exit", resolve)),
          sleep(3000).then(() => {
            if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
          })
        ]);
      }
      await rm(projectDir, { recursive: true, force: true });
    }
  };
}
