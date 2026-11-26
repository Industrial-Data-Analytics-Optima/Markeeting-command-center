import test from "node:test";
import assert from "node:assert/strict";
import {
  demoReporting,
  organicRows,
  paidRows,
  performance,
  moneyGroups,
  exportOrganic,
  periodRange,
  previousRange,
  change,
  audienceCountries,
} from "./fixtures/reporting-model.ts";
const data = demoReporting("2026-11-18");
const f = {
  brand: "All brands",
  platform: "All platforms",
  ...periodRange("2026-11-18", 30),
};
test("organic reporting spans brands without carrying currency or spend", () => {
  const rows = organicRows(data.organic, f);
  assert.equal(rows.length, 120);
  assert.ok(performance(rows).engagements > 0);
  assert.ok(new Set(rows.map((r) => r.brand)).size > 1);
  for (const row of exportOrganic(rows)) {
    assert.equal("currency" in row, false);
    assert.equal("spend" in row, false);
    assert.equal("accountId" in row, false);
  }
});
test("paid results remain available across currencies while money is grouped", () => {
  const rows = paidRows(data.paid, f);
  assert.ok(performance(rows).impressions > 0);
  const groups = moneyGroups(rows);
  assert.deepEqual(
    groups.map((g) => g.currency),
    ["USD", "ZAR"],
  );
  for (const g of groups)
    assert.equal(
      g.spend,
      rows
        .filter((r) => r.currency === g.currency)
        .reduce((s, r) => s + r.spendCents, 0) / 100,
    );
});
test("90-day comparisons have full non-overlapping preceding history", () => {
  const range = periodRange("2026-11-18", 90),
    prior = previousRange(range.start, range.end);
  assert.ok(prior.end < range.start);
  assert.equal(organicRows(data.organic, { ...f, ...range }).length, 360);
  assert.equal(organicRows(data.organic, { ...f, ...prior }).length, 360);
  assert.equal(change(10, 0), null);
  assert.equal(change(120, 100), 20);
});
test("audience contains impression counts and no monetary data", () => {
  const rows = organicRows(data.organic, f),
    countries = audienceCountries(rows);
  assert.ok(countries.length > 0);
  assert.ok(
    countries.every(
      (r) => Object.keys(r).sort().join(",") === "impressions,name",
    ),
  );
  assert.equal(performance([]).engagementRate, null);
});
test("brand, channel, account and date filters isolate reports", () => {
  assert.ok(
    organicRows(data.organic, {
      ...f,
      brand: "IDAO",
      platform: "LinkedIn",
    }).every((r) => r.brand === "IDAO" && r.platform === "LinkedIn"),
  );
  assert.equal(paidRows(data.paid, { ...f, currency: "EUR" }).length, 0);
  assert.equal(
    organicRows(data.organic, { ...f, search: "missing-brand" }).length,
    0,
  );
});
