import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeColor,
  normalizeModel,
  todayInSofia,
  validateOrdersForSaving,
  validateParsedOrders,
} from "../functions/domain.js";

test("normalizes only supported model and color names", () => {
  assert.equal(normalizeModel("Comfort"), "Comfort");
  assert.equal(normalizeModel("премиум"), "Premium");
  assert.equal(normalizeModel("Luxury"), null);
  assert.equal(normalizeColor("Stone Green"), "stone-green");
  assert.equal(normalizeColor("червен"), "red");
  assert.equal(normalizeColor("зелен"), null);
});

test("keeps unknown facts null and separates delivery terms from delivery dates", () => {
  const [order] = validateParsedOrders([{
    name: "Мария",
    model: "Comfort",
    color: "red",
    orderDate: "2026-06-20",
    deliveryDate: null,
    status: null,
    note: null,
    deliveryTerm: "210 дни",
  }], "2026-10-08");

  assert.equal(order.deliveryDate, null);
  assert.equal(order.deliveryTerm, "210 дни");
  assert.equal(order.color, "red");
});

test("handles several extracted comments and leaves missing facts null", () => {
  const orders = validateParsedOrders([
    {
      name: "Иван",
      model: "Comfort",
      color: "Stone Green",
      orderDate: "2026-06-20",
      deliveryDate: null,
      status: null,
      note: null,
      deliveryTerm: "210 дни",
    },
    {
      name: "Не е посочено",
      model: null,
      color: null,
      orderDate: null,
      deliveryDate: null,
      status: null,
      note: null,
      deliveryTerm: null,
    },
  ], "2026-10-08");

  assert.equal(orders.length, 2);
  assert.equal(orders[0].deliveryDate, null);
  assert.equal(orders[0].deliveryTerm, "210 дни");
  assert.equal(orders[1].model, null);
  assert.equal(orders[1].color, null);
  assert.equal(orders[1].orderDate, null);
});

test("rejects impossible dates, future dates, and delivery before order", () => {
  const base = {
    name: "Тест",
    model: null,
    color: null,
    orderDate: "2026-06-20",
    deliveryDate: null,
    status: null,
    note: null,
    deliveryTerm: null,
  };
  assert.throws(() => validateParsedOrders([{ ...base, orderDate: "2026-02-30" }], "2026-10-08"));
  assert.throws(() => validateParsedOrders([{ ...base, orderDate: "2026-12-01" }], "2026-10-08"));
  assert.throws(() => validateParsedOrders([{ ...base, deliveryDate: "2026-06-19" }], "2026-10-08"));
});

test("saving requires a name and exact order date, creates server IDs, and drops unsupported fields", () => {
  const [order] = validateOrdersForSaving([{
    name: " Иван   Петров ",
    model: "Premium",
    color: "stone-green",
    orderDate: "2026-06-20",
    deliveryDate: null,
    status: null,
    note: "  Батерия 54 kWh  ",
    deliveryTerm: "210 дни",
  }], "2026-10-08");

  assert.match(order.id, /^[\da-f-]{36}$/i);
  assert.equal(order.name, "Иван Петров");
  assert.equal(order.note, "Батерия 54 kWh");
  assert.equal("deliveryTerm" in order, false);
  assert.throws(() => validateOrdersForSaving([{ ...order, orderDate: null }], "2026-10-08"));
});

test("uses Sofia's calendar date", () => {
  assert.equal(todayInSofia(new Date("2026-01-01T22:30:00.000Z")), "2026-01-02");
});
