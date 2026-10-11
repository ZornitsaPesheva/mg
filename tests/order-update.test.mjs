import test from "node:test";
import assert from "node:assert/strict";
import { prepareOrderUpdates } from "../public/order-update-utils.js";

test("matches normalized full names and proposes only extracted differences", () => {
  const current = {
    id: "order-1",
    name: "Димитър Иванов",
    model: "43 kWh Comfort",
    dealer: "София",
    color: "red",
    orderDate: "2026-06-16",
    deliveryDate: null,
    status: "waiting",
    note: null,
    deliveryTerm: null,
  };
  const [update] = prepareOrderUpdates([{
    name: "  ДИМИТЪР   Иванов! ",
    model: "54 kWh Comfort",
    dealer: null,
    color: null,
    orderDate: null,
    deliveryDate: null,
    status: null,
    note: null,
    deliveryTerm: "Октомври",
  }], [current]);

  assert.equal(update.match, "matched");
  assert.deepEqual(update.changes.map(({ field }) => field), ["model", "deliveryTerm"]);
});

test("matches exact Bulgarian names written in Cyrillic or Latin letters", () => {
  const [update] = prepareOrderUpdates(
    [{ name: "Йордан Христов", model: null }],
    [{ id: "order-1", name: "Yordan Hristov" }],
  );

  assert.equal(update.match, "matched");
});

test("does not guess approximate names and marks duplicate names as ambiguous", () => {
  const current = [{ id: "order-1", name: "Васил Ников" }];
  const [nearMiss, duplicate] = prepareOrderUpdates([
    { name: "Васил Николов" },
    { name: "Васил Ников" },
    { name: " Васил   Ников " },
  ], current);

  assert.equal(nearMiss.match, "unmatched");
  assert.equal(duplicate.match, "ambiguous");
});

test("uses an actual delivery date to mark a record delivered", () => {
  const current = {
    id: "order-1",
    name: "Васил Ников",
    deliveryDate: null,
    status: "waiting",
  };
  const [update] = prepareOrderUpdates([{
    name: "Васил Ников",
    deliveryDate: "2026-10-10",
    status: "waiting",
  }], [current]);

  assert.equal(update.order.status, "delivered");
  assert.deepEqual(update.changes.map(({ field }) => field), ["deliveryDate", "status"]);
});
