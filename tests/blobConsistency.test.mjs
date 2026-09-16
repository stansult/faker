import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { getRoomStore } from "../netlify/functions/_roomStore.js";
import { test } from "./helpers/testHarness.mjs";

function eventFor(url, overrides = {}) {
  const context = Buffer.from(JSON.stringify({ url, token: "runtime-token" })).toString("base64");
  return {
    blobs: context,
    headers: { "x-nf-site-id": "site-id" },
    ...overrides
  };
}

test("room store uses the Netlify Dev sandbox locally", () => {
  const calls = [];
  const store = { source: "local" };
  const event = eventFor("http://127.0.0.1:9999");

  const result = getRoomStore(event, {
    connectLambda(value) {
      calls.push(["connectLambda", value]);
    },
    getStore(value) {
      calls.push(["getStore", value]);
      return store;
    }
  });

  assert.equal(result, store);
  assert.deepEqual(calls, [
    ["connectLambda", event],
    ["getStore", "faker-rooms"]
  ]);
});

test("room store uses strongly consistent API access when deployed", () => {
  const calls = [];
  const store = { source: "deployed" };

  const result = getRoomStore(eventFor("https://edge.example"), {
    connectLambda() {
      calls.push(["connectLambda"]);
    },
    getStore(value) {
      calls.push(["getStore", value]);
      return store;
    }
  });

  assert.equal(result, store);
  assert.deepEqual(calls, [["getStore", {
    name: "faker-rooms",
    siteID: "site-id",
    token: "runtime-token",
    consistency: "strong"
  }]]);
});

test("room store fails closed when deployed credentials are incomplete", () => {
  assert.throws(
    () => getRoomStore(eventFor("https://edge.example", { headers: {} })),
    /Missing deployed Netlify Blobs credentials/
  );
  assert.throws(() => getRoomStore({}), /Missing Netlify Blobs context/);
});

test("every room function uses the centralized room store adapter", async () => {
  const functionsDir = join(process.cwd(), "netlify", "functions");
  const files = (await readdir(functionsDir)).filter(name => name.endsWith(".js"));
  const roomFunctions = [];

  for (const file of files) {
    const source = await readFile(join(functionsDir, file), "utf8");
    assert.equal(
      source.includes('getStore("faker-rooms"'),
      false,
      `${file} must not access the room store directly`
    );
    if (file !== "_roomStore.js" && source.includes("getRoomStore(event)")) roomFunctions.push(file);
  }

  assert.equal(roomFunctions.length, 15, "expected all current room Functions to use the adapter");
});
