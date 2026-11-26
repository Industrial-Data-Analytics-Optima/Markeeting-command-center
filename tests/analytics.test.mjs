import test from "node:test";
import assert from "node:assert/strict";
import {
  sampleMetrics,
  reportRows,
  summarize,
  countryReport,
  ratio,
} from "./fixtures/analytics-model.ts";
const fixtures = sampleMetrics("2026-11-18");
const filter = {
  currency: "ZAR",
  brand: "All brands",
  platform: "All platforms",
  days: 7,
  kind: "Paid",
  endDate: "2026-11-18",
};
test("report filters use an inclusive date interval and independently isolate brand, channel and organic data", () => {
  const rows = reportRows(fixtures, {
    ...filter,
    brand: "IDAO",
    platform: "LinkedIn",
  });
  assert.equal(rows.length, 7);
  assert.equal(
    Math.min(...rows.map((r) => Date.parse(r.date))),
    Date.parse("2026-11-12"),
  );
  assert.ok(
    rows.every(
      (r) =>
        r.brand === "IDAO" && r.platform === "LinkedIn" && r.kind === "Paid",
    ),
  );
  const organic = summarize(
    reportRows(fixtures, { ...filter, kind: "Organic" }),
  );
  assert.equal(organic.spend, 0);
  assert.equal(organic.budget, 0);
  assert.equal(reportRows(fixtures, { ...filter, brand: "Brand 5" }).length, 0);
});
test("rates are computed from totals rather than averaged daily rates", () => {
  const first = fixtures[0];
  const rows = [
    { ...first, impressions: 100, clicks: 10, spendCents: 200, leads: 2 },
    { ...first, impressions: 900, clicks: 9, spendCents: 1800, leads: 0 },
  ];
  const t = summarize(rows);
  assert.equal(t.ctr, 1.9);
  assert.equal(t.cpc, 20 / 19);
  assert.equal(t.cpm, 20);
  assert.equal(t.cpl, 10);
});
test("country allocations reconcile to impressions, spend and clicks without inventing reach", () => {
  const rows = reportRows(fixtures, filter),
    t = summarize(rows),
    c = countryReport(rows);
  assert.equal(
    c.reduce((n, r) => n + r.impressions, 0),
    t.impressions,
  );
  assert.equal(
    c.reduce((n, r) => n + r.clicks, 0),
    t.clicks,
  );
  assert.ok(Math.abs(c.reduce((n, r) => n + r.spend, 0) - t.spend) < 0.000001);
  assert.equal("reach" in t, false);
});
test("no-data denominators return unavailable; mixed currencies must not silently aggregate", () => {
  assert.equal(ratio(3, 0), null);
  assert.equal(summarize([]).cpc, null);
  assert.throws(
    () => summarize([fixtures[0], { ...fixtures[1], currency: "USD" }]),
    /currency/,
  );
});
test("budget overspend remains explicit instead of becoming a negative remaining balance", () => {
  const t = summarize([
    { ...fixtures[0], budgetCents: 1000, spendCents: 1250 },
  ]);
  assert.equal(t.remaining, 0);
  assert.equal(t.overspend, 2.5);
  assert.equal(t.budgetUsed, 125);
});
