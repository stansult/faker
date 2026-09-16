import { expect } from "@playwright/test";

export async function postFunction(request, functionName, payload, label = functionName) {
  const response = await request.post(`/.netlify/functions/${functionName}`, {
    data: payload
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  expect(
    response.status(),
    `${label} expected 200, got ${response.status()}: ${JSON.stringify(data)}`
  ).toBe(200);
  return data;
}
