import assert from "node:assert/strict";
import test from "node:test";

import { formatUsd, formatUsdCompact } from "../lib/money.ts";

test("formatUsd uses thousands separators and two decimals", () => {
  assert.equal(formatUsd(120000), "USD 1,200.00");
});

test("formatUsd renders a value below one dollar in cents", () => {
  assert.equal(formatUsd(5), "USD 0.05");
});

test("formatUsd renders zero", () => {
  assert.equal(formatUsd(0), "USD 0.00");
});

test("formatUsdCompact omits the decimals for whole limits", () => {
  assert.equal(formatUsdCompact(50000), "USD 500");
  assert.equal(formatUsdCompact(70000), "USD 700");
});
