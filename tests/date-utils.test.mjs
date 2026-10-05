import test from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, formatISODate, getSofiaDate, isValidISODate, parseISODate } from "../public/date-utils.js";

test("accepts only real YYYY-MM-DD calendar dates", () => {
  assert.equal(isValidISODate("2026-02-28"), true);
  assert.equal(isValidISODate("2024-02-29"), true);
  assert.equal(isValidISODate("2026-02-29"), false);
  assert.equal(isValidISODate("2026-13-01"), false);
  assert.equal(isValidISODate("26-02-01"), false);
  assert.equal(parseISODate(null), null);
});

test("counts calendar days without DST or local timezone shifts", () => {
  assert.equal(daysBetween("2026-03-28", "2026-03-29"), 1);
  assert.equal(daysBetween("2026-10-24", "2026-10-25"), 1);
  assert.equal(daysBetween("2026-06-01", "2026-06-01"), 0);
  assert.equal(daysBetween("2026-06-02", "2026-06-01"), -1);
  assert.equal(daysBetween("bad", "2026-06-01"), null);
});

test("adds days using calendar arithmetic", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("formats date-only values as Bulgarian DD.MM.YYYY", () => {
  assert.equal(formatISODate("2026-10-05"), "05.10.2026 г.");
  assert.equal(formatISODate("not a date"), "Не е посочено");
});

test("derives Sofia's calendar day from an instant", () => {
  assert.equal(getSofiaDate(new Date("2026-10-04T21:30:00.000Z")), "2026-10-05");
  assert.equal(getSofiaDate(new Date("2026-10-04T20:30:00.000Z")), "2026-10-04");
});
