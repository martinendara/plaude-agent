import assert from "node:assert/strict";
import test from "node:test";

import {
  isAuthorizedApprover,
  parseApproverIds,
} from "../lib/approvers.ts";

test("authorizes an ID that is in the configured list", () => {
  const allowedIds = parseApproverIds("U123,U456");

  assert.deepEqual(allowedIds, ["U123", "U456"]);
  assert.equal(isAuthorizedApprover("U123", allowedIds), true);
});

test("refuses an ID outside the configured list", () => {
  assert.equal(
    isAuthorizedApprover("U999", parseApproverIds("U123,U456")),
    false
  );
});

test("refuses everyone when the list is empty", () => {
  assert.equal(isAuthorizedApprover("U123", []), false);
});

test("refuses everyone when the variable is missing", () => {
  const allowedIds = parseApproverIds(undefined);

  assert.deepEqual(allowedIds, []);
  assert.equal(isAuthorizedApprover("U123", allowedIds), false);
});
