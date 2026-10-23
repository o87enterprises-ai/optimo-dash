import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Provider } from "@llm/providers";
import { rankModels, settle } from "./server";

// A provider whose default model is "gone" (404) while only some listed models are served.
function mock(served: string[]) {
  const asked: string[] = [];
  const srv = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET") return res.end(JSON.stringify({ data: ["gone", "huge-405b-instruct", "text-embed-1", "unserved-8b-instruct", "good-8b-instruct"].map((id) => ({ id })) }));
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const model = JSON.parse(b).model;
      asked.push(model);
      if (!served.includes(model)) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ detail: `Function '${model}': Not found for account` }));
      }
      res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    });
  });
  return new Promise<{ provider: Provider; asked: string[]; close: () => void }>((resolve) =>
    srv.listen(0, () => {
      const provider: Provider = { id: "mock", label: "Mock", kind: "openai", baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, apiKey: "key-1234567890", model: "gone", keyRequired: true };
      resolve({ provider, asked, close: () => srv.close() });
    })
  );
}
const ready = (provider: Provider) => ({ provider, model: provider.model!, status: {} as any });

test("a default model that 404s is swapped for one that answers", async () => {
  const m = await mock(["good-8b-instruct"]);
  const r = await settle(ready(m.provider), false);
  assert.equal(r.model, "good-8b-instruct");
  assert.match(r.note!, /gone is not available/);
  assert.ok(!m.asked.includes("huge-405b-instruct") && !m.asked.includes("text-embed-1"));
  m.close();
});

test("a model the person typed is never swapped", async () => {
  const m = await mock([]);
  const r = await settle(ready(m.provider), true);
  assert.equal(r.model, "gone");
  assert.deepEqual(m.asked, []);
  m.close();
});

test("when nothing answers the original model is kept so the real error shows", async () => {
  const m = await mock([]);
  const p = { ...m.provider, apiKey: "key-abcdefghijkl" };
  const r = await settle(ready(p), false);
  assert.equal(r.model, "gone");
  assert.match(r.note!, /none of the \d+ other models tried answered/);
  m.close();
});

test("rankModels prefers small instruct models and drops huge ones", () => {
  assert.deepEqual(rankModels(["big-405b-instruct", "a-8b-instruct", "zzz", "gone", "granite-8b-code-instruct"], "gone"), ["a-8b-instruct", "zzz"]);
});
