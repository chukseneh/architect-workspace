import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "./app";

test("GET /health returns 200 with a status payload", async () => {
  const response = await request(createApp()).get("/health");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok" });
});
