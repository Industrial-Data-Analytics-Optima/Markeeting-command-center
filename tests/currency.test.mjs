import test from "node:test";
import assert from "node:assert/strict";
import {
  sampleMetrics,
  reportRows,
  summarize,
  countryReport,
} from "./fixtures/analytics-model.ts";
import { currencyFactor, formatMoney } from "../app/currency.ts";
const rows = sampleMetrics("2026-11-18");
const filter = {
  brand: "All brands",
  platform: "All platforms",
  days: 7,
  kind: "Paid",
  endDate: "2026-11-18",
};
test("account metadata carries currency independently of browser locale", () => {
  assert.deepEqual([...new Set(rows.map((r) => r.currency))].sort(), [
    "USD",
    "ZAR",
  ]);
  const account = reportRows(rows, {
    ...filter,
    accountId: "sample-account-2",
  });
  assert.equal(account.length, 7);
  assert.ok(account.every((r) => r.currency === "USD"));
});
test("ZAR and USD filters isolate real amounts rather than relabeling or converting them", () => {
  const zar = reportRows(rows, { ...filter, currency: "ZAR" }),
    usd = reportRows(rows, { ...filter, currency: "USD" });
  assert.equal(zar.length, 14);
  assert.equal(usd.length, 14);
  assert.ok(zar.every((r) => r.currency === "ZAR"));
  assert.ok(usd.every((r) => r.currency === "USD"));
  assert.throws(() => summarize([...zar, ...usd]), /currency/);
  assert.throws(() => countryReport([...zar, ...usd]), /currency/);
  assert.equal(
    reportRows(rows, {
      ...filter,
      accountId: "sample-account-2",
      currency: "ZAR",
    }).length,
    0,
  );
});
test("money labels are unambiguous and respect the currency minor unit", () => {
  assert.match(formatMoney(123.45, "ZAR"), /ZAR.*123\.45/);
  assert.match(formatMoney(123.45, "USD"), /USD.*123\.45/);
  assert.equal(currencyFactor("JPY"), 1);
  assert.equal(currencyFactor("KWD"), 1000);
  assert.equal(
    summarize([
      { ...rows[0], currency: "JPY", spendCents: 123, budgetCents: 200 },
    ]).spend,
    123,
  );
  assert.equal(
    summarize([
      { ...rows[0], currency: "KWD", spendCents: 1234, budgetCents: 2000 },
    ]).spend,
    1.234,
  );
  assert.throws(() => formatMoney(1, ""), /currency/);
});
