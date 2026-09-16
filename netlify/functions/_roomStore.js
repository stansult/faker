import { connectLambda, getStore } from "@netlify/blobs";

const ROOM_STORE_NAME = "faker-rooms";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function getRoomStore(event, dependencies = { connectLambda, getStore }) {
  const context = decodeBlobContext(event?.blobs);
  const edgeUrl = new URL(context.url);

  if (LOCAL_HOSTS.has(edgeUrl.hostname)) {
    dependencies.connectLambda(event);
    return dependencies.getStore(ROOM_STORE_NAME);
  }

  const siteID = event?.headers?.["x-nf-site-id"];
  if (!siteID || !context.token) {
    throw new Error("Missing deployed Netlify Blobs credentials");
  }

  return dependencies.getStore({
    name: ROOM_STORE_NAME,
    siteID,
    token: context.token,
    consistency: "strong"
  });
}

export function decodeBlobContext(encoded) {
  if (!encoded) throw new Error("Missing Netlify Blobs context");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}
