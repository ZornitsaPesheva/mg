import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  onSnapshot,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, ADMIN_UID, TIMELINE_DEFAULT_START } from "./firebase-config.js";
import { seedCars } from "./seed-data.js";
import { daysBetween, formatISODate, getSofiaDate, isValidISODate, monthName } from "./date-utils.js";

const COLORS = [
  { id: "dover-white", name: "Dover White", hex: "#F3F1EA" },
  { id: "pebble-black", name: "Pebble Black", hex: "#252729" },
  { id: "medal-silver", name: "Medal Silver", hex: "#B9BEC2" },
  { id: "piccadilly-blue", name: "Piccadilly Blue", hex: "#315A83" },
  { id: "andes-grey", name: "Andes Grey", hex: "#777B7D" },
  { id: "diamond-red", name: "Diamond Red", hex: "#B52D3C" },
  { id: "stone-green", name: "Stone Green", hex: "#758477" },
  { id: "red", name: "Червен — неуточнен нюанс", hex: "#B52D3C" },
];
const MODELS = new Set(["Basic", "Comfort", "Premium"]);
const TRACKER_REF_PATH = ["tracker", "data"];
const DAY_WIDTH = 14;
const axisStorageKey = "mg4-urban-timeline-start";
const els = Object.fromEntries([
  "connection-pill", "connection-text", "login-button", "logout-button", "admin-actions", "seed-button", "add-car-button",
  "today-label", "visible-count", "count-label", "model-filter", "color-filter", "clear-filters", "notice", "empty-state",
  "empty-title", "empty-description", "timeline-wrap", "timeline", "selected-detail", "axis-start", "footer-year",
  "login-dialog", "login-form", "login-error", "car-dialog", "car-form", "car-form-title", "car-color-select",
  "order-date-help", "approximate-preserve", "car-form-error",
].map((id) => [id, document.getElementById(id)]));

let db = null;
let auth = null;
let currentUser = null;
let cars = [];
let hasTrackerDocument = false;
let readFailed = false;
let today = getSofiaDate();
let axisStart = loadAxisStart();
let unsubscribeCars = null;

function configuredFirebase() {
  const required = ["apiKey", "authDomain", "projectId", "messagingSenderId", "appId"];
  return required.every((key) => {
    const value = firebaseConfig[key];
    return typeof value === "string" && value.length > 0 && !/^(PASTE_|YOUR_)/.test(value);
  });
}

function loadAxisStart() {
  try {
    const stored = localStorage.getItem(axisStorageKey);
    if (stored && isValidISODate(stored) && stored <= getSofiaDate()) return stored;
  } catch { /* local storage may be disabled */ }
  return TIMELINE_DEFAULT_START;
}

function showNotice(message, type = "info", timeout = 0) {
  els.notice.textContent = message;
  els.notice.className = `notice${type === "info" ? "" : ` ${type}`}`;
  if (timeout) {
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => { els.notice.className = "notice hidden"; }, timeout);
  }
}

function setConnection(message, state = "") {
  els["connection-text"].textContent = message;
  els["connection-pill"].className = `connection-pill${state ? ` is-${state}` : ""}`;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function getColor(colorId) {
  return COLORS.find((color) => color.id === colorId) || null;
}

function populateColorOptions() {
  for (const color of COLORS) {
    const filterOption = document.createElement("option");
    filterOption.value = color.id;
    filterOption.textContent = color.name;
    els["color-filter"].append(filterOption);

    const formOption = document.createElement("option");
    formOption.value = color.id;
    formOption.textContent = color.name;
    els["car-color-select"].append(formOption);
  }
  const unknownFilter = document.createElement("option");
  unknownFilter.value = "none";
  unknownFilter.textContent = "Не е посочено";
  els["color-filter"].append(unknownFilter);
}

function displayedDate(car) {
  if (car.orderDate) return formatISODate(car.orderDate);
  if (car.orderDateApproximate) return car.orderDateNote || "Приблизителна дата";
  return "Не е посочено";
}

function orderSortDate(car) {
  return car.orderDate || car.orderDateRangeStart || "9999-12-31";
}

function formatDuration(car, endDate = car.deliveryDate || today) {
  if (car.orderDateApproximate && car.orderDateRangeStart && car.orderDateRangeEnd) {
    const min = Math.max(0, daysBetween(car.orderDateRangeEnd, endDate) ?? 0);
    const max = Math.max(min, daysBetween(car.orderDateRangeStart, endDate) ?? min);
    return min === max ? `около ${min} дни` : `около ${min}–${max} дни`;
  }
  const start = car.orderDate || car.orderDateRangeStart;
  if (!start) return "Продължителността е неизвестна";
  const duration = Math.max(0, daysBetween(start, endDate) ?? 0);
  return `${duration} ${duration === 1 ? "ден" : "дни"}`;
}

function safeCars(value) {
  if (!Array.isArray(value)) throw new Error("Полето cars в Firestore не е масив.");
  return value.filter((car) => car && typeof car === "object" && typeof car.id === "string" && typeof car.name === "string")
    .map((car) => ({
      id: car.id,
      name: car.name,
      model: MODELS.has(car.model) ? car.model : null,
      color: COLORS.some(({ id }) => id === car.color) ? car.color : null,
      orderDate: isValidISODate(car.orderDate) ? car.orderDate : null,
      deliveryDate: isValidISODate(car.deliveryDate) ? car.deliveryDate : null,
      ...(car.orderDateApproximate === true ? {
        orderDateApproximate: true,
        orderDateNote: typeof car.orderDateNote === "string" ? car.orderDateNote : "Приблизителна дата",
        orderDateRangeStart: isValidISODate(car.orderDateRangeStart) ? car.orderDateRangeStart : null,
        orderDateRangeEnd: isValidISODate(car.orderDateRangeEnd) ? car.orderDateRangeEnd : null,
      } : {}),
    }));
}

function filteredCars() {
  const modelValue = els["model-filter"].value;
  const colorValue = els["color-filter"].value;
  return cars.filter((car) => {
    const modelMatches = modelValue === "all" || (modelValue === "none" ? !car.model : car.model === modelValue);
    const colorMatches = colorValue === "all" || (colorValue === "none" ? !car.color : car.color === colorValue);
    return modelMatches && colorMatches;
  }).sort((left, right) => orderSortDate(left).localeCompare(orderSortDate(right)) || left.name.localeCompare(right.name, "bg"));
}

function updateCount(count) {
  els["visible-count"].textContent = String(count);
  els["count-label"].textContent = count === 1 ? "автомобил" : "автомобила";
}

function rowDetailText(car) {
  const color = getColor(car.color)?.name || "Не е посочено";
  const model = car.model || "Не е посочено";
  const orderText = displayedDate(car);
  const deliveryText = car.deliveryDate ? formatISODate(car.deliveryDate) : "Очаква доставка";
  const duration = formatDuration(car);
  return `${car.name}. Оборудване: ${model}. Цвят: ${color}. Поръчка: ${orderText}. Доставка: ${deliveryText}. ${car.deliveryDate ? "Доставена за " : "Чака "}${duration}.`;
}

function showSelectedDetail(car) {
  els["selected-detail"].replaceChildren();
  els["selected-detail"].append(makeElement("span", "detail-icon", "i"), makeElement("span", "", rowDetailText(car)));
}

function renderTimelineAxis(start, end, timelineDays, timelineWidth) {
  const header = makeElement("div", "timeline-header");
  header.append(makeElement("div", "header-label", "АВТОМОБИЛ"));
  const axis = makeElement("div", "axis");
  axis.style.width = `${timelineWidth}px`;
  axis.style.setProperty("--day-width", `${DAY_WIDTH}px`);
  axis.style.setProperty("--week-width", `${DAY_WIDTH * 7}px`);

  const startDate = new Date(`${start}T00:00:00Z`);
  const endMonth = new Date(`${end}T00:00:00Z`);
  const monthCursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  if (monthCursor < startDate) monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  while (monthCursor <= endMonth) {
    const dateKey = monthCursor.toISOString().slice(0, 10);
    const offset = daysBetween(start, dateKey);
    const label = makeElement("span", "month-label", monthName(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1));
    label.style.left = `${Math.max(0, offset) * DAY_WIDTH + 7}px`;
    axis.append(label);
    monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  }
  const todayOffset = Math.max(0, timelineDays - 1);
  const todayMarker = makeElement("span", "axis-today", `ДНЕС · ${formatISODate(end)}`);
  todayMarker.style.left = `${Math.max(0, timelineWidth - Math.min(150, timelineWidth))}px`;
  axis.append(todayMarker);
  header.append(axis);
  return header;
}

function appendCarRow(car, start, timelineDays, timelineWidth) {
  const row = makeElement("div", "timeline-row");
  const label = makeElement("div", "car-label");
  const initials = car.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
  label.append(makeElement("span", "car-avatar", initials || "MG"));
  const info = makeElement("div", "car-info");
  info.append(makeElement("span", "car-name", car.name));

  const subline = makeElement("span", "car-subline");
  const color = getColor(car.color);
  const status = makeElement("span", `car-status ${car.deliveryDate ? "delivered" : "waiting"}`, car.deliveryDate ? "Доставена" : "Очаква доставка");
  const model = makeElement("span", "", car.model || "Не е посочено");
  const colorDot = makeElement("span", "color-dot");
  if (color) colorDot.style.backgroundColor = color.hex;
  else colorDot.style.backgroundColor = "#d8e0e0";
  const colorName = makeElement("span", "", color?.name || "Не е посочено");
  subline.append(model, makeElement("span", "", "·"), colorDot, colorName);
  info.append(subline, status);
  label.append(info);

  if (currentUser?.uid === ADMIN_UID) {
    const actions = makeElement("span", "row-actions");
    const edit = makeElement("button", "icon-button", "✎");
    edit.type = "button";
    edit.title = `Редактирай ${car.name}`;
    edit.setAttribute("aria-label", `Редактирай ${car.name}`);
    edit.addEventListener("click", () => openCarForm(car));
    const remove = makeElement("button", "icon-button", "×");
    remove.type = "button";
    remove.title = `Изтрий ${car.name}`;
    remove.setAttribute("aria-label", `Изтрий ${car.name}`);
    remove.addEventListener("click", () => deleteCar(car));
    actions.append(edit, remove);
    label.append(actions);
  }

  const chart = makeElement("div", "chart-cell");
  chart.style.width = `${timelineWidth}px`;
  chart.style.setProperty("--day-width", `${DAY_WIDTH}px`);
  chart.style.setProperty("--week-width", `${DAY_WIDTH * 7}px`);
  const orderStart = car.orderDate || car.orderDateRangeStart;
  const orderEnd = car.deliveryDate || today;
  const track = makeElement("div", "bar-track");
  track.style.width = `${timelineWidth}px`;
  const rawStartOffset = orderStart ? daysBetween(start, orderStart) : 0;
  const rawEndOffset = orderEnd ? daysBetween(start, orderEnd) : timelineDays - 1;
  const leftDay = Math.max(0, rawStartOffset ?? 0);
  const rightDay = Math.min(timelineDays - 1, Math.max(leftDay, rawEndOffset ?? timelineDays - 1));
  const left = Math.min(timelineWidth, leftDay * DAY_WIDTH);
  const spanDays = Math.max(0, (daysBetween(orderStart, orderEnd) ?? 0));
  const clippedWidth = Math.max(0, (rightDay - leftDay) * DAY_WIDTH);
  const visibleWidth = rawStartOffset < 0 ? Math.max(0, rightDay * DAY_WIDTH) : clippedWidth;
  const isSameDay = Boolean(car.deliveryDate && spanDays === 0);
  const bar = makeElement("button", `bar ${car.deliveryDate ? "delivered" : "waiting"}${car.orderDateApproximate ? " approximate" : ""}${rawStartOffset < 0 ? " pre-start" : ""}${isSameDay ? " same-day" : ""}`);
  bar.type = "button";
  bar.style.left = `${left}px`;
  bar.style.width = `${isSameDay ? 3 : Math.max(visibleWidth, orderStart === today ? 3 : 0)}px`;
  const details = rowDetailText(car);
  bar.setAttribute("aria-label", details);
  bar.setAttribute("aria-describedby", `tooltip-${car.id}`);
  bar.addEventListener("click", () => showSelectedDetail(car));
  bar.addEventListener("focus", () => showSelectedDetail(car));
  bar.addEventListener("mouseenter", () => showSelectedDetail(car));
  if (car.orderDateApproximate && car.orderDateRangeStart && car.orderDateRangeEnd) {
    const approximateWidthRaw = (daysBetween(car.orderDateRangeStart, car.orderDateRangeEnd) + 1) * DAY_WIDTH;
    const approximateOffset = daysBetween(start, car.orderDateRangeStart);
    const visibleApproxStart = Math.max(0, approximateOffset) * DAY_WIDTH;
    const visibleApproxEnd = Math.min(timelineWidth, (Math.max(0, approximateOffset) + approximateWidthRaw / DAY_WIDTH) * DAY_WIDTH);
    const visibleApproximate = Math.max(0, visibleApproxEnd - Math.max(left, visibleApproxStart));
    bar.style.setProperty("--uncertain-width", `${visibleApproximate}px`);
  }
  const tooltip = makeElement("span", "bar-tooltip", details);
  tooltip.id = `tooltip-${car.id}`;
  tooltip.setAttribute("role", "tooltip");
  const durationText = car.deliveryDate ? `Доставена за ${formatDuration(car, car.deliveryDate)}` : `Чака ${formatDuration(car, today)}`;
  const caption = makeElement("span", `bar-caption${car.deliveryDate ? " is-delivered" : ""}`, `${durationText}${car.orderDateApproximate ? " · приблизително" : ""}`);
  caption.style.left = `${left + Math.max(isSameDay ? 3 : visibleWidth, 0) + 9}px`;
  track.append(bar, tooltip, caption);
  chart.append(track);
  row.append(label, chart);
  return row;
}

function render() {
  const visible = filteredCars();
  updateCount(visible.length);
  els["admin-actions"].classList.toggle("hidden", currentUser?.uid !== ADMIN_UID);
  els["seed-button"].classList.toggle("hidden", currentUser?.uid !== ADMIN_UID || hasTrackerDocument);
  els["empty-state"].classList.toggle("hidden", visible.length > 0);
  els["timeline-wrap"].classList.toggle("hidden", visible.length === 0);
  if (!cars.length) {
    els["empty-title"].textContent = "Все още няма записи";
    els["empty-description"].textContent = currentUser?.uid === ADMIN_UID && !hasTrackerDocument
      ? "Импортирайте началните данни или добавете първата кола."
      : "Когато бъдат добавени поръчки, ще се появят тук.";
  } else if (!visible.length) {
    els["empty-title"].textContent = "Няма резултати";
    els["empty-description"].textContent = "Няма автомобили, които да отговарят на избраните филтри.";
  }

  if (!visible.length) {
    els.timeline.replaceChildren();
    return;
  }
  const end = today;
  if (!isValidISODate(axisStart) || axisStart > end) axisStart = TIMELINE_DEFAULT_START;
  const timelineDays = Math.max(1, (daysBetween(axisStart, end) ?? 0) + 1);
  const timelineWidth = timelineDays * DAY_WIDTH;
  els.timeline.style.setProperty("--label-width", window.matchMedia("(max-width: 620px)").matches ? "228px" : "290px");
  els.timeline.style.setProperty("--timeline-width", `${timelineWidth}px`);
  els.timeline.replaceChildren(renderTimelineAxis(axisStart, end, timelineDays, timelineWidth));
  const fragment = document.createDocumentFragment();
  for (const car of visible) fragment.append(appendCarRow(car, axisStart, timelineDays, timelineWidth));
  els.timeline.append(fragment);
}

function updateToday() {
  const latest = getSofiaDate();
  if (latest !== today) {
    today = latest;
    els["today-label"].textContent = formatISODate(today);
    if (axisStart > today) axisStart = TIMELINE_DEFAULT_START;
    render();
  }
}

function initTimelineControls() {
  els["today-label"].textContent = formatISODate(today);
  els["footer-year"].textContent = today.slice(0, 4);
  els["axis-start"].value = axisStart;
  els["axis-start"].addEventListener("change", () => {
    const value = els["axis-start"].value;
    if (!isValidISODate(value) || value > today) {
      showNotice("Началната дата трябва да е валидна и да не е в бъдещето.", "error", 5000);
      els["axis-start"].value = axisStart;
      return;
    }
    axisStart = value;
    try { localStorage.setItem(axisStorageKey, axisStart); } catch { /* local storage may be disabled */ }
    render();
  });
  window.setInterval(updateToday, 60_000);
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function populateFormColors(selected = "") {
  els["car-color-select"].value = selected || "";
}

function openCarForm(car = null) {
  els["car-form"].reset();
  els["car-form-error"].textContent = "";
  els["approximate-preserve"].classList.add("hidden");
  els["car-form-title"].textContent = car ? "Редактирай кола" : "Добави кола";
  els["order-date-help"].textContent = car?.orderDateApproximate
    ? "Оставете празно, за да запазите приблизителната дата, или въведете точна дата."
    : "Задължителна за нов запис.";
  const form = els["car-form"];
  form.elements.id.value = car?.id || "";
  form.elements.name.value = car?.name || "";
  form.elements.model.value = car?.model || "";
  populateFormColors(car?.color || "");
  form.elements.orderDate.value = car?.orderDate || "";
  form.elements.deliveryDate.value = car?.deliveryDate || "";
  if (car?.orderDateApproximate) {
    els["approximate-preserve"].textContent = `Съществуваща приблизителна дата: „${car.orderDateNote}“ (${formatISODate(car.orderDateRangeStart)} – ${formatISODate(car.orderDateRangeEnd)}). Ако оставите датата на поръчката празна, този диапазон ще бъде запазен.`;
    els["approximate-preserve"].classList.remove("hidden");
  }
  openDialog(els["car-dialog"]);
  form.elements.name.focus();
}

function validateCarForm(formData, existing) {
  const name = String(formData.get("name") || "").trim().replace(/\s+/g, " ");
  const modelValue = String(formData.get("model") || "");
  const colorValue = String(formData.get("color") || "");
  const orderDateValue = String(formData.get("orderDate") || "");
  const deliveryDateValue = String(formData.get("deliveryDate") || "");
  if (!name) throw new Error("Въведете име или псевдоним.");
  if (name.length > 80) throw new Error("Името може да е най-много 80 знака.");
  if (modelValue && !MODELS.has(modelValue)) throw new Error("Изберете валидно ниво на оборудване.");
  if (colorValue && !COLORS.some(({ id }) => id === colorValue)) throw new Error("Изберете валиден цвят.");

  let orderDate;
  let approximateFields = {};
  if (orderDateValue) {
    if (!isValidISODate(orderDateValue)) throw new Error("Въведете реална дата на поръчката.");
    if (orderDateValue > today) throw new Error("Датата на поръчката не може да е в бъдещето.");
    orderDate = orderDateValue;
  } else if (existing?.orderDateApproximate) {
    orderDate = null;
    approximateFields = {
      orderDateApproximate: true,
      orderDateNote: existing.orderDateNote,
      orderDateRangeStart: existing.orderDateRangeStart,
      orderDateRangeEnd: existing.orderDateRangeEnd,
    };
  } else {
    throw new Error("Въведете точна дата на поръчката.");
  }

  let deliveryDate = null;
  if (deliveryDateValue) {
    if (!isValidISODate(deliveryDateValue)) throw new Error("Въведете реална дата на доставка.");
    if (deliveryDateValue > today) throw new Error("Датата на доставка не може да е в бъдещето.");
    if (orderDate && deliveryDateValue < orderDate) throw new Error("Доставката не може да е преди поръчката.");
    if (approximateFields.orderDateApproximate && deliveryDateValue < approximateFields.orderDateRangeStart) {
      throw new Error("Доставката не може да е преди най-ранната приблизителна дата на поръчката.");
    }
    deliveryDate = deliveryDateValue;
  }

  return {
    id: existing?.id || crypto.randomUUID(),
    name,
    model: modelValue || null,
    color: colorValue || null,
    orderDate,
    deliveryDate,
    ...approximateFields,
  };
}

async function transactCars(mutator) {
  if (!db) throw new Error("Firebase не е настроен. Попълнете конфигурацията в public/firebase-config.js.");
  const reference = doc(db, ...TRACKER_REF_PATH);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists() ? snapshot.data().cars : [];
    if (!Array.isArray(current)) throw new Error("Полето cars в Firestore не е масив; записът е прекъснат.");
    const updated = mutator(current);
    transaction.set(reference, { cars: updated });
    return updated;
  });
}

async function saveCar(event) {
  event.preventDefault();
  els["car-form-error"].textContent = "";
  if (currentUser?.uid !== ADMIN_UID) {
    els["car-form-error"].textContent = "Нямате права за редактиране.";
    return;
  }
  const formData = new FormData(els["car-form"]);
  const id = String(formData.get("id") || "");
  const existing = cars.find((car) => car.id === id) || null;
  let record;
  try {
    record = validateCarForm(formData, existing);
  } catch (error) {
    els["car-form-error"].textContent = error.message;
    return;
  }
  try {
    showNotice("Записване на промените…", "info");
    await transactCars((current) => {
      const currentIndex = current.findIndex((car) => car.id === record.id);
      if (id && currentIndex === -1) throw new Error("Записът вече не съществува. Обновете страницата и опитайте отново.");
      if (!id && current.some((car) => car.id === record.id)) throw new Error("Генерирано е дублирано ID; опитайте отново.");
      const next = [...current];
      if (currentIndex >= 0) next[currentIndex] = record;
      else next.push(record);
      if (new Set(next.map((car) => car.id)).size !== next.length) throw new Error("ID на автомобилите трябва да са уникални.");
      return next;
    });
    closeDialog(els["car-dialog"]);
    showNotice("Промените са записани успешно.", "success", 4500);
  } catch (error) {
    els["car-form-error"].textContent = error.message || "Записът не беше успешен.";
    showNotice(`Грешка при записване: ${error.message || "неизвестна грешка"}`, "error");
  }
}

async function deleteCar(car) {
  if (currentUser?.uid !== ADMIN_UID) return;
  const confirmed = window.confirm(`Изтриване на „${car.name}“? Действието ще премахне само записа за колата.`);
  if (!confirmed) return;
  try {
    showNotice("Изтриване на записа…", "info");
    await transactCars((current) => {
      if (!current.some((item) => item.id === car.id)) throw new Error("Записът вече не съществува.");
      return current.filter((item) => item.id !== car.id);
    });
    showNotice("Записът е изтрит.", "success", 4500);
  } catch (error) {
    showNotice(`Грешка при изтриване: ${error.message || "неизвестна грешка"}`, "error");
  }
}

async function importSeedData() {
  if (currentUser?.uid !== ADMIN_UID || hasTrackerDocument) return;
  if (!window.confirm(`Ще се добавят ${seedCars.length} начални записа. Ако документът вече съществува, импортът ще бъде отказан без промяна. Продължаване?`)) return;
  try {
    showNotice("Импортиране на началните данни…", "info");
    const reference = doc(db, ...TRACKER_REF_PATH);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists()) throw new Error("Импортът е еднократен: документът вече съществува и не е променен.");
      transaction.set(reference, { cars: seedCars });
    });
    showNotice("Началните данни са импортирани успешно.", "success", 5000);
  } catch (error) {
    showNotice(`Импортът не беше изпълнен: ${error.message || "неизвестна грешка"}`, "error");
  }
}

function connectFirebase() {
  if (!configuredFirebase()) {
    setConnection("Нужна е настройка", "error");
    showNotice("Добавете Firebase Web конфигурацията и администраторския UID в public/firebase-config.js, след което презаредете страницата.", "warning");
    render();
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    const reference = doc(db, ...TRACKER_REF_PATH);
    setConnection("Зареждане на данните…");
    unsubscribeCars = onSnapshot(reference, (snapshot) => {
      readFailed = false;
      hasTrackerDocument = snapshot.exists();
      try {
        cars = hasTrackerDocument ? safeCars(snapshot.data().cars) : [];
        setConnection("На живо", "live");
        render();
      } catch (error) {
        cars = [];
        readFailed = true;
        setConnection("Грешка в данните", "error");
        showNotice(error.message, "error");
        render();
      }
    }, (error) => {
      readFailed = true;
      setConnection("Няма връзка", "error");
      showNotice(`Данните не могат да бъдат прочетени: ${error.message}`, "error");
      render();
    });
    setPersistence(auth, browserLocalPersistence).catch(() => {
      showNotice("Неуспешно запазване на сесията за вход в този браузър.", "warning");
    });
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      els["login-button"].classList.toggle("hidden", user?.uid === ADMIN_UID);
      els["logout-button"].classList.toggle("hidden", user?.uid !== ADMIN_UID);
      if (user && user.uid !== "Bsrl0QKJl8OGpJBDJzrN4jIC3ay2") {
        showNotice("Влезли сте с акаунт без администраторски права. Данните остават само за четене.", "warning");
      } else if (user?.uid === "Bsrl0QKJl8OGpJBDJzrN4jIC3ay2") {
        showNotice("Влезли сте като администратор.", "success", 4000);
      }
      render();
    });
    if (ADMIN_UID === "REPLACE_WITH_ADMIN_UID") {
      showNotice("Публичният тракер може да се зареди, но за администраторски функции трябва да зададете UID в public/firebase-config.js и същия UID във firestore.rules.", "warning");
    }
  } catch (error) {
    setConnection("Грешка при настройка", "error");
    showNotice(`Firebase не можа да се стартира: ${error.message}`, "error");
  }
}

function installEvents() {
  els["model-filter"].addEventListener("change", render);
  els["color-filter"].addEventListener("change", render);
  els["clear-filters"].addEventListener("click", () => {
    els["model-filter"].value = "all";
    els["color-filter"].value = "all";
    render();
  });
  els["login-button"].addEventListener("click", () => {
    els["login-error"].textContent = "";
    openDialog(els["login-dialog"]);
  });
  els["logout-button"].addEventListener("click", async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      showNotice("Излязохте от администраторския акаунт.", "success", 3500);
    } catch (error) {
      showNotice(`Неуспешен изход: ${error.message}`, "error");
    }
  });
  els["login-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    els["login-error"].textContent = "";
    const form = new FormData(els["login-form"]);
    try {
      const credential = await signInWithEmailAndPassword(auth, String(form.get("email")).trim(), String(form.get("password")));
      if (credential.user.uid !== "Bsrl0QKJl8OGpJBDJzrN4jIC3ay2") {
        await signOut(auth);
        throw new Error("Този акаунт не е в предварително зададения администраторски списък.");
      }
      closeDialog(els["login-dialog"]);
      els["login-form"].reset();
    } catch (error) {
      els["login-error"].textContent = error.message || "Входът е неуспешен.";
    }
  });
  els["add-car-button"].addEventListener("click", () => openCarForm());
  els["seed-button"].addEventListener("click", importSeedData);
  els["car-form"].addEventListener("submit", saveCar);
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(document.getElementById(button.dataset.close))));
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  }));
}

populateColorOptions();
initTimelineControls();
installEvents();
render();
connectFirebase();

window.addEventListener("beforeunload", () => unsubscribeCars?.());
