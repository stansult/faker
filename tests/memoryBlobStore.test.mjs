import assert from "node:assert/strict";
import { MemoryBlobStore } from "./helpers/memoryBlobStore.mjs";
import { test } from "./helpers/testHarness.mjs";

test("cleanup Blob fixture returns detached JSON, exact text, and missing reads", async () => {
  const store = new MemoryBlobStore({ alpha: { word: "ёж" } });
  const read = await store.getWithMetadata("alpha", { type: "json" });
  read.data.word = "changed";
  assert.equal((await store.getWithMetadata("alpha", { type: "text" })).data, '{"word":"ёж"}');
  assert.equal(await store.getWithMetadata("missing", { type: "json" }), null);
});

test("cleanup Blob fixture enforces conditional writes and changes ETags", async () => {
  const store = new MemoryBlobStore();
  const first = await store.setJSON("state", { value: 1 }, { onlyIfNew: true });
  assert.equal(first.modified, true);
  assert.equal((await store.setJSON("state", {}, { onlyIfNew: true })).modified, false);
  assert.equal((await store.setJSON("state", {}, { onlyIfMatch: "wrong" })).modified, false);
  const second = await store.setJSON("state", { value: 2 }, { onlyIfMatch: first.etag });
  assert.equal(second.modified, true);
  assert.notEqual(second.etag, first.etag);
  assert.equal((await store.setJSON("state", {}, { onlyIfMatch: first.etag })).modified, false);
  assert.equal((await store.getWithMetadata("state", { type: "json" })).data.value, 2);
});

test("cleanup Blob fixture lists every key across pages and really deletes records", async () => {
  const store = new MemoryBlobStore({ alpha: {}, bravo: {}, charlie: {} });
  const pages = [];
  for await (const page of store.list({ paginate: true })) pages.push(page.blobs.map(blob => blob.key));
  assert.deepEqual(pages, [["alpha", "bravo"], ["charlie"]]);
  await store.delete("bravo");
  await store.delete("missing");
  assert.equal(await store.getWithMetadata("bravo", { type: "json" }), null);
  const keys = [];
  for await (const page of store.list({ paginate: true })) keys.push(...page.blobs.map(blob => blob.key));
  assert.deepEqual(keys, ["alpha", "charlie"]);
  assert.ok(await store.getWithMetadata("alpha", { type: "json" }));
});
