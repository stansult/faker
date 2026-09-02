const tests = globalThis.__fakerTestRegistry || [];
globalThis.__fakerTestRegistry = tests;

export function test(name, fn) {
  tests.push({ name, fn });
}

export function getTests() {
  return tests;
}
