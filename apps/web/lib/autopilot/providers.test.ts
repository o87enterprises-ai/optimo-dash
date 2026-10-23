import assert from "node:assert/strict";
import { test } from "node:test";
import { ask, listProviders } from "@llm/providers";

const nvidia = () => ({ ...listProviders({ NVIDIA_API_KEY: "k" } as unknown as NodeJS.ProcessEnv).find((p) => p.id === "nvidia")! });

test("providers: models that reject a system role are retried with the instructions in the user message", async () => {
  const real = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    if (body.messages.some((m: any) => m.role === "system")) {
      return new Response(JSON.stringify({ error: "System role not supported" }), { status: 400 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const a = await ask(nvidia(), "google/gemma-3-12b-it", "write a title", { system: "Be brief." });
    assert.equal(a.text, "ok");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].messages.length, 1);
    assert.match(bodies[1].messages[0].content, /Be brief\.[\s\S]*write a title/);
  } finally {
    globalThis.fetch = real;
  }
});

test("providers: other errors are not retried, and the NVIDIA default is a live model", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ detail: "gone" }), { status: 410 }); }) as typeof fetch;
  try {
    await assert.rejects(ask(nvidia(), "x", "p", { system: "s" }), /HTTP 410/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = real;
  }
  assert.notEqual(nvidia().model, "meta/llama-3.1-8b-instruct");
});
