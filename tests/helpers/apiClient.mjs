import http from "node:http";
import https from "node:https";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function requestJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        }
      },
      response => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", chunk => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode || 0,
            text
          });
        });
      }
    );

    request.once("error", reject);
    request.end(body);
  });
}

export async function postFunction(baseUrl, functionName, payload = {}) {
  const url = new URL(`/.netlify/functions/${functionName}`, baseUrl);
  if (!LOCAL_HOSTS.has(url.hostname) && process.env.ALLOW_NON_LOCAL_TEST_API !== "1") {
    throw new Error(`Refusing to run API smoke test against non-local host: ${url.hostname}`);
  }

  const response = await requestJson(url, payload);
  const text = response.text;
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  return {
    status: response.status,
    data,
    text
  };
}

export function assertOk(assert, result, label) {
  assert.equal(
    result.status,
    200,
    `${label} expected 200, got ${result.status}: ${JSON.stringify(result.data)}`
  );
}
