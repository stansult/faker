import { startNetlifyDev } from "./netlifyDev.mjs";

const server = await startNetlifyDev({
  port: 4173,
  targetPort: 4174,
  functionsPort: 4175,
  env: {
    ROOM_ACTIVE_TTL_HOURS: "1",
    VOTE_TOTAL_SECONDS: "1",
    VOTE_FINAL_SECONDS: "1"
  }
});

console.log(`UI test server ready at ${server.baseUrl}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await new Promise(() => {});
