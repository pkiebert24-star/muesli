import test from "node:test";
import assert from "node:assert/strict";
import { hasBlobToken, isGoogleEnabled } from "../lib/config.ts";

test("Google is on when both vars are set", () => {
  assert.equal(isGoogleEnabled({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }), true);
});

test("Google is off when only the client id is set", () => {
  assert.equal(isGoogleEnabled({ GOOGLE_CLIENT_ID: "id" }), false);
  assert.equal(isGoogleEnabled({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "" }), false);
});

test("Google is off when only the client secret is set", () => {
  assert.equal(isGoogleEnabled({ GOOGLE_CLIENT_SECRET: "secret" }), false);
  assert.equal(isGoogleEnabled({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "secret" }), false);
});

test("Google is off when both vars are empty strings", () => {
  assert.equal(isGoogleEnabled({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }), false);
});

test("Google is off when both vars are whitespace", () => {
  assert.equal(isGoogleEnabled({ GOOGLE_CLIENT_ID: "  ", GOOGLE_CLIENT_SECRET: "\t\n" }), false);
});

test("Google is off when both vars are undefined", () => {
  assert.equal(isGoogleEnabled({}), false);
  assert.equal(isGoogleEnabled({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined }), false);
});

test("the server key counts only when it is non-blank", async () => {
  const { hasServerOpenAIKey } = await import("../lib/config.ts");
  assert.equal(hasServerOpenAIKey({ OPENAI_API_KEY: "sk-test" }), true);
  assert.equal(hasServerOpenAIKey({ OPENAI_API_KEY: "" }), false);
  assert.equal(hasServerOpenAIKey({ OPENAI_API_KEY: "  " }), false);
  assert.equal(hasServerOpenAIKey({}), false);
});

test("a Blob read-write token means the older client-token upload", () => {
  assert.equal(hasBlobToken({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" }), true);
});

test("a store with only a store ID uses presigned uploads", () => {
  assert.equal(hasBlobToken({ BLOB_STORE_ID: "store_x", BLOB_WEBHOOK_PUBLIC_KEY: "key" }), false);
  assert.equal(hasBlobToken({ BLOB_READ_WRITE_TOKEN: "  " }), false);
  assert.equal(hasBlobToken({}), false);
});
