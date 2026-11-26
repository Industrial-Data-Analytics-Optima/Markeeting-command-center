import test from "node:test";
import assert from "node:assert/strict";
import {
  dateKey,
  toCsv,
  validatePost,
  weekStart,
} from "./fixtures/workspace-model.ts";

test("calendar dates use Kuala Lumpur at the UTC day boundary", () => {
  assert.equal(dateKey(new Date("2026-11-18T16:00:00Z")), "2026-11-19");
  assert.equal(dateKey(new Date("2026-11-18T15:59:59Z")), "2026-11-18");
});
test("planning interprets the selected time as UTC+8, not the server timezone", () => {
  const now = Date.parse("2026-11-18T02:00:00Z");
  assert.match(
    validatePost(
      "Hello",
      "LinkedIn",
      "2026-11-18",
      "09:59",
      "",
      "Planned",
      now,
    ),
    /future/,
  );
  assert.equal(
    validatePost(
      "Hello",
      "LinkedIn",
      "2026-11-18",
      "10:01",
      "",
      "Planned",
      now,
    ),
    "",
  );
});
test("drafts can retain past dates, but invalid dates cannot be submitted", () => {
  assert.equal(
    validatePost("Hello", "LinkedIn", "2020-01-01", "10:00", "", "Draft"),
    "",
  );
  assert.match(
    validatePost("Hello", "LinkedIn", "invalid", "10:00", "", "Draft"),
    /valid date/,
  );
});
test("Instagram plans require media and respect channel caption limits", () => {
  const now = Date.parse("2026-01-01");
  assert.match(
    validatePost(
      "Hello",
      "Instagram",
      "2027-01-01",
      "10:00",
      "",
      "Planned",
      now,
    ),
    /image/,
  );
  assert.equal(
    validatePost(
      "Hello",
      "Instagram",
      "2027-01-01",
      "10:00",
      "/home.jpg",
      "Planned",
      now,
    ),
    "",
  );
  assert.match(
    validatePost(
      "a".repeat(2201),
      "Instagram",
      "2027-01-01",
      "10:00",
      "/home.jpg",
      "Draft",
      now,
    ),
    /limit/,
  );
  assert.match(
    validatePost("  ", "LinkedIn", "2027-01-01", "10:00", "", "Draft", now),
    /caption/,
  );
});
test("CSV exports escape quotes, commas, newlines and spreadsheet formula prefixes", () => {
  const csv = toCsv([
    {
      name: 'A, "B"',
      note: "line 1\nline 2",
      formula: '  =HYPERLINK("bad")',
      phone: "+601234",
    },
  ]);
  assert.ok(csv.includes('"A, ""B"""'));
  assert.ok(csv.includes('"line 1\nline 2"'));
  assert.ok(csv.includes('"\'  =HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"\'+601234"'));
  assert.equal(toCsv([]), "");
});

test("week navigation starts Monday in Kuala Lumpur even near Sunday UTC midnight", () => {
  const monday = weekStart(new Date("2026-11-22T17:00:00Z"));
  assert.equal(dateKey(monday), "2026-11-23");
  assert.equal(monday.getUTCDay(), 1);
});
