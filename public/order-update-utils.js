const cyrillicToLatin = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht",
  ъ: "a", ь: "y", ю: "yu", я: "ya",
};

export function normalizeMatchName(name) {
  if (typeof name !== "string") return "";
  return name.toLocaleLowerCase("bg")
    .replace(/[а-я]/g, (letter) => cyrillicToLatin[letter])
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function prepareOrderUpdates(orders, cars) {
  const byName = new Map();
  for (const car of cars) {
    const key = normalizeMatchName(car.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(car);
  }

  const inputCounts = new Map();
  for (const order of orders) {
    const key = normalizeMatchName(order.name);
    inputCounts.set(key, (inputCounts.get(key) || 0) + 1);
  }

  const usedIds = new Set();
  return orders.map((sourceOrder) => {
    const order = {
      ...sourceOrder,
      ...(sourceOrder.deliveryDate ? { status: "delivered" } : {}),
    };
    const key = normalizeMatchName(order.name);
    const matches = byName.get(key) || [];
    if (matches.length !== 1 || inputCounts.get(key) !== 1) {
      return { order, match: matches.length || inputCounts.get(key) > 1 ? "ambiguous" : "unmatched" };
    }

    const current = matches[0];
    if (usedIds.has(current.id)) return { order, match: "ambiguous" };
    usedIds.add(current.id);
    const fields = ["orderDate", "deliveryDate", "model", "dealer", "color", "status", "note", "deliveryTerm"];
    const changes = fields
      .filter((field) => order[field] !== null && order[field] !== undefined && order[field] !== current[field])
      .map((field) => {
        let blockedReason = null;
        if (field === "status" && order.status === "delivered" && !order.deliveryDate && !current.deliveryDate) {
          blockedReason = "липсва действителна дата на доставка";
        } else if (field === "status" && order.status !== "delivered" && current.deliveryDate && !order.deliveryDate) {
          blockedReason = "съществува действителна дата на доставка";
        }
        return { field, from: current[field] ?? null, to: order[field], blockedReason };
      });
    return { order, match: "matched", current, changes };
  });
}
