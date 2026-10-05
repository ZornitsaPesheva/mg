export function parseISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function isValidISODate(value) {
  return parseISODate(value) !== null;
}

export function daysBetween(start, end) {
  const first = parseISODate(start);
  const last = parseISODate(end);
  if (!first || !last) return null;
  return Math.round((last.getTime() - first.getTime()) / 86_400_000);
}

export function formatISODate(value) {
  const date = parseISODate(value);
  if (!date) return "Не е посочено";
  return new Intl.DateTimeFormat("bg-BG", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function getSofiaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(value, amount) {
  const date = parseISODate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function monthName(year, month) {
  return new Intl.DateTimeFormat("bg-BG", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 15)));
}
