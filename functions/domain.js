export const MODELS = ["Basic", "Comfort", "Premium"];
export const COLORS = [
  "dover-white",
  "pebble-black",
  "medal-silver",
  "piccadilly-blue",
  "andes-grey",
  "diamond-red",
  "stone-green",
  "camden-grey",
  "cosmic-silver",
  "red",
  "white",
  "black",
];
export const STATUSES = ["waiting", "delivered", "switched"];

const MODEL_ALIASES = new Map([
  ["basic", "Basic"],
  ["comfort", "Comfort"],
  ["комфорт", "Comfort"],
  ["premium", "Premium"],
  ["премиум", "Premium"],
]);
const COLOR_ALIASES = new Map([
  ["dover white", "dover-white"],
  ["dover-white", "dover-white"],
  ["pebble black", "pebble-black"],
  ["pebble-black", "pebble-black"],
  ["medal silver", "medal-silver"],
  ["medal-silver", "medal-silver"],
  ["piccadilly blue", "piccadilly-blue"],
  ["piccadilly-blue", "piccadilly-blue"],
  ["andes grey", "andes-grey"],
  ["andes gray", "andes-grey"],
  ["andes-grey", "andes-grey"],
  ["diamond red", "diamond-red"],
  ["diamond-red", "diamond-red"],
  ["stone green", "stone-green"],
  ["stone-green", "stone-green"],
  ["camden grey", "camden-grey"],
  ["camden gray", "camden-grey"],
  ["camden-grey", "camden-grey"],
  ["cosmic silver", "cosmic-silver"],
  ["cosmic-silver", "cosmic-silver"],
  ["red", "red"],
  ["червен", "red"],
  ["червена", "red"],
  ["white", "white"],
  ["бял", "white"],
  ["бяла", "white"],
  ["black", "black"],
  ["черен", "black"],
  ["черна", "black"],
]);

function normalized(value) {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}

export function normalizeModel(value) {
  if (typeof value !== "string") return null;
  const key = normalized(value);
  return MODEL_ALIASES.get(key) || null;
}

export function normalizeColor(value) {
  if (typeof value !== "string") return null;
  const key = normalized(value);
  return COLOR_ALIASES.get(key) || (COLORS.includes(key) ? key : null);
}

export function isValidISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function todayInSofia(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function optionalText(value, maxLength, field, index) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Запис ${index + 1}: невалидна стойност за „${field}“.`);
  }
  return value.trim().replace(/\s+/g, " ") || null;
}

function validateDate(value, field, index, today) {
  if (value === null) return null;
  if (!isValidISODate(value)) throw new Error(`Запис ${index + 1}: невалидна дата за „${field}“.`);
  if (value > today) throw new Error(`Запис ${index + 1}: датата за „${field}“ е в бъдещето.`);
  return value;
}

export function validateParsedOrders(value, today = todayInSofia()) {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error("Отговорът не съдържа валиден списък с поръчки.");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Запис ${index + 1}: невалиден формат.`);
    }

    const name = optionalText(entry.name, 80, "име", index);
    const orderDate = validateDate(entry.orderDate, "дата на поръчката", index, today);
    const deliveryDate = validateDate(entry.deliveryDate, "дата на доставката", index, today);
    if (orderDate && deliveryDate && deliveryDate < orderDate) {
      throw new Error(`Запис ${index + 1}: доставката е преди поръчката.`);
    }

    const rawModel = optionalText(entry.model, 80, "оборудване", index);
    const rawColor = optionalText(entry.color, 80, "цвят", index);
    const rawStatus = optionalText(entry.status, 30, "статус", index);
    const status = rawStatus && STATUSES.includes(rawStatus) ? rawStatus : null;
    if (rawStatus && !status) throw new Error(`Запис ${index + 1}: невалиден статус.`);

    return {
      name,
      model: normalizeModel(rawModel),
      color: normalizeColor(rawColor),
      orderDate,
      deliveryDate,
      status,
      note: optionalText(entry.note, 300, "бележка", index),
      deliveryTerm: optionalText(entry.deliveryTerm, 120, "срок за доставка", index),
    };
  });
}

export function validateOrdersForSaving(value, today = todayInSofia()) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error("Изберете между 1 и 50 поръчки за добавяне.");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Запис ${index + 1}: невалиден формат.`);
    }
    const name = optionalText(entry.name, 80, "име", index);
    if (!name) throw new Error(`Запис ${index + 1}: въведете име или псевдоним.`);

    const model = entry.model === null || entry.model === "" ? null : entry.model;
    if (model !== null && !MODELS.includes(model)) {
      throw new Error(`Запис ${index + 1}: изберете валидно ниво на оборудване.`);
    }
    const color = entry.color === null || entry.color === "" ? null : entry.color;
    if (color !== null && !COLORS.includes(color)) throw new Error(`Запис ${index + 1}: изберете валиден цвят.`);

    const orderDate = validateDate(entry.orderDate, "дата на поръчката", index, today);
    if (!orderDate) throw new Error(`Запис ${index + 1}: въведете точна дата на поръчката.`);
    const deliveryDate = validateDate(entry.deliveryDate, "дата на доставката", index, today);
    if (deliveryDate && deliveryDate < orderDate) {
      throw new Error(`Запис ${index + 1}: доставката е преди поръчката.`);
    }

    const status = entry.status === null || entry.status === "" ? null : entry.status;
    if (status !== null && !STATUSES.includes(status)) throw new Error(`Запис ${index + 1}: невалиден статус.`);
    if (deliveryDate && status && status !== "delivered") {
      throw new Error(`Запис ${index + 1}: датата на доставка е несъвместима със статуса.`);
    }
    if (!deliveryDate && status === "delivered") {
      throw new Error(`Запис ${index + 1}: за статус „Доставена“ въведете реална дата на доставка.`);
    }

    const note = optionalText(entry.note, 300, "бележка", index);
    return {
      id: crypto.randomUUID(),
      name,
      model,
      color,
      orderDate,
      deliveryDate,
      ...(status ? { status } : {}),
      ...(note ? { note } : {}),
    };
  });
}
