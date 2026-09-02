import { pathToFileURL } from "node:url";

import { getTests } from "./helpers/testHarness.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node tests/run.mjs <test-file...>");
  process.exit(1);
}

for (const file of files) {
  await import(pathToFileURL(file).href);
}

let failed = 0;
const tests = getTests();

for (const { name, fn } of tests) {
  const cleanup = [];
  const t = {
    after(callback) {
      cleanup.push(callback);
    }
  };

  try {
    await fn(t);
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
  } finally {
    for (const callback of cleanup.reverse()) {
      try {
        await callback();
      } catch (error) {
        failed += 1;
        console.error(`not ok - cleanup after ${name}`);
        console.error(error?.stack || error);
      }
    }
  }
}

console.log(`${tests.length - failed}/${tests.length} tests passed`);

if (failed > 0) {
  process.exit(1);
}
