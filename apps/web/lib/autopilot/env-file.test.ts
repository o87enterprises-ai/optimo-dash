import assert from "node:assert/strict";
import { test } from "node:test";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseEnv } = require("../env-file");

test("env file: a hint comment after an empty value is not the value", () => {
  const v = parseEnv(
    [
      "# comment",
      "NVIDIA_API_KEY=                 # build.nvidia.com (nvapi-...)",
      "GROQ_API_KEY=",
      "GOOGLE_AI_API_KEY=   # Gemini; answers are web-grounded",
      "PORT=4000   # api port",
      'QUOTED="a # b"   # note',
      "export TOKEN=abc#123",
      "DATABASE_URL=postgresql://u:p@localhost:5432/db",
    ].join("\n")
  );
  assert.equal(v.NVIDIA_API_KEY, "");
  assert.equal(v.GROQ_API_KEY, "");
  assert.equal(v.GOOGLE_AI_API_KEY, "");
  assert.equal(v.PORT, "4000");
  assert.equal(v.QUOTED, "a # b");
  assert.equal(v.TOKEN, "abc#123");
  assert.equal(v.DATABASE_URL, "postgresql://u:p@localhost:5432/db");
});
