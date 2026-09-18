import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const AUTO_PORT_START_ATTEMPTS = 3;

function isPortCollision(error) {
  const message = String(error?.message || error || "");
  return message.includes("Address already in use") || message.includes("EADDRINUSE");
}

export async function retryAutoPortStartup(startAttempt, options = {}) {
  const hasExplicitPorts = !!options.hasExplicitPorts;
  const maxAttempts = options.maxAttempts || AUTO_PORT_START_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await startAttempt(attempt);
    } catch (error) {
      const canRetry =
        !hasExplicitPorts && attempt < maxAttempts && isPortCollision(error);
      if (!canRetry) throw error;
      await sleep(50);
    }
  }

  throw new Error("Netlify dev startup attempts exhausted");
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

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

async function stopChild(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    sleep(3000).then(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    })
  ]);
}

async function getFreePorts(count, excluded = []) {
  const servers = [];
  const ports = [];
  const unavailable = new Set(excluded.map(String));

  try {
    while (ports.length < count) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      if (!port) {
        await closeServer(server);
        throw new Error("Failed to allocate a free port");
      }
      if (unavailable.has(String(port))) {
        await closeServer(server);
        continue;
      }
      unavailable.add(String(port));
      servers.push(server);
      ports.push(port);
    }
    return ports;
  } finally {
    await Promise.all(servers.map(closeServer));
  }
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

  const configuredPorts = [
    options.port || process.env.FAKER_TEST_PORT || null,
    options.targetPort || process.env.FAKER_TEST_TARGET_PORT || null,
    options.functionsPort || process.env.FAKER_TEST_FUNCTIONS_PORT || null
  ];
  const explicitPorts = configuredPorts.filter(Boolean).map(String);
  if (new Set(explicitPorts).size !== explicitPorts.length) {
    throw new Error("Netlify dev ports must be distinct");
  }
  try {
    return await retryAutoPortStartup(async () => {
      const allocatedPorts = await getFreePorts(
        configuredPorts.filter(port => !port).length,
        explicitPorts
      );
      let allocatedIndex = 0;
      const [port, targetPort, functionsPort] = configuredPorts.map(configured =>
        String(configured || allocatedPorts[allocatedIndex++])
      );
      if (new Set([port, targetPort, functionsPort]).size !== 3) {
        throw new Error("Netlify dev ports must be distinct");
      }
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
          reject(new Error(
            `Netlify dev exited early with code ${code} signal ${signal}\n\n${output}`
          ));
        });
      });

      try {
        await Promise.race([
          waitForServer(baseUrl, () => output),
          exitPromise
        ]);
      } catch (error) {
        await stopChild(child);
        throw error;
      }

      return {
        baseUrl,
        logs: () => output,
        async stop() {
          await stopChild(child);
          await rm(projectDir, { recursive: true, force: true });
        }
      };
    }, { hasExplicitPorts: explicitPorts.length > 0 });
  } catch (error) {
    await rm(projectDir, { recursive: true, force: true });
    throw error;
  }
}
