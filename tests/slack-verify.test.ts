import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { isValidSlackRequest } from "../lib/slack-verify.ts";

const SECRET = "test-signing-secret";
const BODY = '{"type":"block_actions"}';

function sign(timestamp: string, body = BODY, secret = SECRET): string {
  const digest = createHmac("sha256", secret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex");

  return `v0=${digest}`;
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

test("accepts a correctly signed request", () => {
  const timestamp = nowSeconds();

  assert.equal(
    isValidSlackRequest({
      rawBody: BODY,
      timestamp,
      signature: sign(timestamp),
      signingSecret: SECRET,
    }),
    true
  );
});

test("rejects an altered signature", () => {
  const timestamp = nowSeconds();
  const signature = sign(timestamp);
  const altered =
    signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");

  assert.equal(
    isValidSlackRequest({
      rawBody: BODY,
      timestamp,
      signature: altered,
      signingSecret: SECRET,
    }),
    false
  );
});

test("rejects a request whose body was altered", () => {
  const timestamp = nowSeconds();

  assert.equal(
    isValidSlackRequest({
      rawBody: BODY + " ",
      timestamp,
      signature: sign(timestamp, BODY),
      signingSecret: SECRET,
    }),
    false
  );
});

test("rejects a timestamp older than five minutes", () => {
  const timestamp = String(Math.floor(Date.now() / 1000) - 6 * 60);

  assert.equal(
    isValidSlackRequest({
      rawBody: BODY,
      timestamp,
      signature: sign(timestamp),
      signingSecret: SECRET,
    }),
    false
  );
});

test("rejects a missing or non-integer timestamp", () => {
  const timestamp = nowSeconds();
  const fractional = `${timestamp}.5`;

  assert.equal(
    isValidSlackRequest({
      rawBody: BODY,
      timestamp: null,
      signature: sign(timestamp),
      signingSecret: SECRET,
    }),
    false
  );
  assert.equal(
    isValidSlackRequest({
      rawBody: BODY,
      timestamp: fractional,
      signature: sign(fractional),
      signingSecret: SECRET,
    }),
    false
  );
});

test("rejects a signature of a different length without throwing", () => {
  assert.equal(
    isValidSlackRequest({
      rawBody: BODY,
      timestamp: nowSeconds(),
      signature: "v0=abc",
      signingSecret: SECRET,
    }),
    false
  );
});
