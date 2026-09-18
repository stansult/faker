import assert from "node:assert/strict";

import { retryAutoPortStartup } from "./helpers/netlifyDev.mjs";
import { test } from "./helpers/testHarness.mjs";

test("retries automatic-port startup after a bind collision", async () => {
  let attempts = 0;
  const result = await retryAutoPortStartup(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Address already in use");
    return "ready";
  });

  assert.equal(result, "ready");
  assert.equal(attempts, 2);
});

test("does not retry explicit ports or unrelated startup failures", async () => {
  for (const testCase of [
    { error: new Error("EADDRINUSE"), hasExplicitPorts: true },
    { error: new Error("Netlify configuration failed"), hasExplicitPorts: false }
  ]) {
    let attempts = 0;
    await assert.rejects(
      retryAutoPortStartup(async () => {
        attempts += 1;
        throw testCase.error;
      }, { hasExplicitPorts: testCase.hasExplicitPorts }),
      testCase.error
    );
    assert.equal(attempts, 1);
  }
});
