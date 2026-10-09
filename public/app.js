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
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, ADMIN_UID, TIMELINE_DEFAULT_START } from "./firebase-config.js";
import { seedCars, seedUpdates } from "./seed-data.js";
import { daysBetween, formatISODate, getSofiaDate, isValidISODate, monthName } from "./date-utils.js";

const COLORS = [
  { id: "dover-white", name: "Dover White", hex: "#F3F1EA" },
  { id: "pebble-black", name: "Pebble Black", hex: "#252729" },
  { id: "medal-silver", name: "Medal Silver", hex: "#B9BEC2" },
  { id: "piccadilly-blue", name: "Piccadilly Blue", hex: "#315A83" },
  { id: "andes-grey", name: "Andes Grey", hex: "#777B7D" },
  { id: "diamond-red", name: "Diamond Red", hex: "#B52D3C" },
  { id: "stone-green", name: "Stone Green", hex: "#758477" },
  { id: "camden-grey", name: "Camden Grey", hex: "#6B6F72" },
  { id: "cosmic-silver", name: "Cosmic Silver", hex: "#A7ABAF" },
  { id: "red", name: "Червен — неуточнен нюанс", hex: "#B52D3C" },
  { id: "white", name: "Бял — неуточнен нюанс", hex: "#ECEDEE" },
  { id: "black", name: "Черен — неуточнен нюанс", hex: "#252729" },
];
const MODELS = new Set(["Basic", "Comfort", "Premium"]);
const STATUSES = new Set(["waiting", "delivered", "switched"]);
const STATUS_LABELS = { waiting: "Очаква доставка", delivered: "Доставена", switched: "Преминава към друг модел" };
const TRACKER_REF_PATH = ["tracker", "data"];
const ADMIN_REQUEST_TIMEOUT_MS = 35_000;
const axisStorageKey = "mg4-urban-timeline-start";
const els = Object.fromEntries([
  "connection-pill", "connection-text", "login-button", "logout-button", "admin-actions", "seed-button", "add-car-button", "import-dialog", "import-form", "import-preview", "import-error", "import-confirm",
  "order-import-panel", "parse-orders-text", "parse-orders-button", "parse-orders-status", "order-review",
  "today-label", "visible-count", "count-label", "model-filter", "color-filter", "clear-filters", "notice", "empty-state",
  "empty-title", "empty-description", "timeline-wrap", "timeline", "selected-detail", "axis-start", "footer-year",
  "login-dialog", "login-form", "login-error", "car-dialog", "car-form", "car-form-title", "car-color-select",
  "order-date-help", "approximate-preserve", "car-form-error", "zoom-out", "zoom-in", "fit-period",
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
let timelinePlotWidth = 0;
let timelineZoom = 1;
let fitFullPeriod = true;
let parsedOrders = [];
let ordersRequestInProgress = false;

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

// Без изричен статус той се извежда от deliveryDate, така старите записи работят без миграция.
function carStatus(car) {
  if (STATUSES.has(car.status)) return car.status;
  return car.deliveryDate ? "delivered" : "waiting";
}

function hasApproximateDelivery(car) {
  return !car.deliveryDate && car.deliveryDateApproximate === true && Boolean(car.deliveryDateRangeStart && car.deliveryDateRangeEnd);
}

function displayedDelivery(car) {
  if (car.deliveryDate) return formatISODate(car.deliveryDate);
  if (car.deliveryDateApproximate) return car.deliveryDateNote || "Приблизителна дата";
  return carStatus(car) === "switched" ? "Не е доставена" : "Очаква доставка";
}

function durationText(car, end) {
  const status = carStatus(car);
  if (status === "switched") return STATUS_LABELS.switched;
  if (status === "delivered") {
    if (car.deliveryDate || hasApproximateDelivery(car)) return `Доставена за ${formatDuration(car, car.deliveryDate)}`;
    return "Доставена";
  }
  return `Чака ${formatDuration(car, end)}`;
}

function formatDuration(car, endDate = car.deliveryDate || today) {
  if (hasApproximateDelivery(car)) {
    const orderStart = car.orderDate || car.orderDateRangeStart;
    const orderEnd = car.orderDate || car.orderDateRangeEnd || orderStart;
    if (!orderStart) return "Продължителността е неизвестна";
    const min = Math.max(0, daysBetween(orderEnd, car.deliveryDateRangeStart) ?? 0);
    const max = Math.max(min, daysBetween(orderStart, car.deliveryDateRangeEnd) ?? min);
    return min === max ? `около ${min} дни` : `около ${min}–${max} дни`;
  }
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
      ...(STATUSES.has(car.status) ? { status: car.status } : {}),
      ...(typeof car.note === "string" && car.note.trim() ? { note: car.note.trim() } : {}),
      ...(car.deliveryDateApproximate === true ? {
        deliveryDateApproximate: true,
        deliveryDateNote: typeof car.deliveryDateNote === "string" ? car.deliveryDateNote : "Приблизителна дата",
        deliveryDateRangeStart: isValidISODate(car.deliveryDateRangeStart) ? car.deliveryDateRangeStart : null,
        deliveryDateRangeEnd: isValidISODate(car.deliveryDateRangeEnd) ? car.deliveryDateRangeEnd : null,
      } : {}),
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
  const note = car.note ? ` Бележка: ${car.note.replace(/\.$/, "")}.` : "";
  return `${car.name}. Оборудване: ${model}. Цвят: ${color}. Поръчка: ${orderText}. Доставка: ${displayedDelivery(car)}. ${durationText(car, today)}.${note}`;
}

function showSelectedDetail(car) {
  els["selected-detail"].replaceChildren();
  els["selected-detail"].append(makeElement("span", "detail-icon", "i"), makeElement("span", "", rowDetailText(car)));
}

function monthMarkers(start, end, timelineWidth) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const totalDays = Math.max(1, daysBetween(start, end) ?? 1);
  const markers = [];
  const monthCursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  while (monthCursor <= endDate) {
    const dateKey = monthCursor.toISOString().slice(0, 10);
    const elapsed = Math.max(0, daysBetween(start, dateKey) ?? 0);
    markers.push({
      left: (elapsed / totalDays) * timelineWidth,
      label: monthName(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1),
    });
    monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  }
  return markers;
}

function appendMonthTicks(container, markers, className) {
  for (const marker of markers) {
    const tick = makeElement("span", className);
    tick.style.left = `${marker.left}px`;
    container.append(tick);
  }
}

function renderTimelineAxis(end, timelineWidth, markers) {
  const header = makeElement("div", "timeline-header");
  header.append(makeElement("div", "header-label", "АВТОМОБИЛ"));
  const scroll = makeElement("div", "timeline-scroll axis-scroll");
  scroll.addEventListener("scroll", () => syncTimelineScroll(scroll));
  const axis = makeElement("div", "axis");
  axis.style.width = `${timelineWidth}px`;
  const labelStride = Math.max(1, Math.ceil(markers.length / Math.max(1, Math.floor(timelineWidth / 82))));
  for (const [index, marker] of markers.entries()) {
    if (index % labelStride !== 0) continue;
    const label = makeElement("span", "month-label", marker.label);
    label.style.left = `${marker.left}px`;
    if (index === 0) label.classList.add("at-start");
    if (marker.left > timelineWidth - 72) label.classList.add("at-end");
    axis.append(label);
  }
  appendMonthTicks(axis, markers, "month-tick");
  const todayMarker = makeElement("span", "axis-today", `ДНЕС · ${formatISODate(end)}`);
  todayMarker.style.left = `${Math.max(0, timelineWidth - 150)}px`;
  axis.append(todayMarker);
  scroll.append(axis);
  header.append(scroll);
  return header;
}

function syncTimelineScroll(source) {
  for (const scroll of els.timeline.querySelectorAll(".timeline-scroll")) {
    if (scroll !== source && Math.abs(scroll.scrollLeft - source.scrollLeft) > 1) {
      scroll.scrollLeft = source.scrollLeft;
    }
  }
}

function appendCarRow(car, start, end, timelineWidth, markers) {
  const row = makeElement("div", "timeline-row");
  const label = makeElement("div", "car-label");
  const initials = car.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
  label.append(makeElement("span", "car-avatar", initials || "MG"));
  const info = makeElement("div", "car-info");
  info.append(makeElement("span", "car-name", car.name));

  const subline = makeElement("span", "car-subline");
  const color = getColor(car.color);
  const carState = carStatus(car);
  const status = makeElement("span", `car-status ${carState}`, STATUS_LABELS[carState]);
  const model = makeElement("span", "", car.model || "Не е посочено");
  const colorDot = makeElement("span", "color-dot");
  if (color) colorDot.style.backgroundColor = color.hex;
  else colorDot.style.backgroundColor = "#d8e0e0";
  const colorName = makeElement("span", "", color?.name || "Не е посочено");
  subline.append(model, makeElement("span", "", "·"), colorDot, colorName);
  info.append(subline, status);
  if (car.note) info.append(makeElement("span", "car-note", car.note));
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

  const chartScroll = makeElement("div", "timeline-scroll chart-scroll");
  chartScroll.addEventListener("scroll", () => syncTimelineScroll(chartScroll));
  const chart = makeElement("div", "chart-cell");
  chart.style.width = `${timelineWidth}px`;
  appendMonthTicks(chart, markers, "month-tick chart-month-tick");
  const orderStart = car.orderDate || car.orderDateRangeStart;
  const approximateDelivery = carStatus(car) === "delivered" && hasApproximateDelivery(car);
  const orderEnd = car.deliveryDate || (approximateDelivery ? car.deliveryDateRangeEnd : null) || end;
  const track = makeElement("div", "bar-track");
  track.style.width = `${timelineWidth}px`;
  const totalDays = Math.max(1, daysBetween(start, end) ?? 1);
  const rawStartOffset = orderStart ? daysBetween(start, orderStart) : 0;
  const rawEndOffset = orderEnd ? daysBetween(start, orderEnd) : totalDays;
  const left = Math.max(0, Math.min(Math.max(0, timelineWidth - 3), ((rawStartOffset ?? 0) / totalDays) * timelineWidth));
  const right = Math.max(left, Math.min(timelineWidth, ((rawEndOffset ?? totalDays) / totalDays) * timelineWidth));
  const spanDays = Math.max(0, (daysBetween(orderStart, orderEnd) ?? 0));
  const visibleWidth = Math.max(0, right - left);
  const isSameDay = Boolean(car.deliveryDate && spanDays === 0);
  const bar = makeElement("button", `bar ${carState}${car.orderDateApproximate ? " approximate" : ""}${approximateDelivery ? " delivery-approximate" : ""}${rawStartOffset < 0 ? " pre-start" : ""}${isSameDay ? " same-day" : ""}`);
  bar.type = "button";
  bar.style.left = `${left}px`;
  bar.style.width = `${Math.max(visibleWidth, 3)}px`;
  const details = rowDetailText(car);
  bar.setAttribute("aria-label", details);
  bar.setAttribute("aria-describedby", `tooltip-${car.id}`);
  bar.addEventListener("click", () => showSelectedDetail(car));
  bar.addEventListener("focus", () => showSelectedDetail(car));
  bar.addEventListener("mouseenter", () => showSelectedDetail(car));
  if (car.orderDateApproximate && car.orderDateRangeStart && car.orderDateRangeEnd) {
    const rangeStart = Math.max(0, Math.min(timelineWidth, ((daysBetween(start, car.orderDateRangeStart) ?? 0) / totalDays) * timelineWidth));
    const rangeEnd = Math.max(rangeStart, Math.min(timelineWidth, ((daysBetween(start, car.orderDateRangeEnd) ?? 0) / totalDays) * timelineWidth));
    const visibleApproximate = Math.max(0, rangeEnd - rangeStart);
    bar.style.setProperty("--uncertain-width", `${visibleApproximate}px`);
  }
  if (approximateDelivery) {
    const deliveryStartX = Math.max(0, Math.min(timelineWidth, ((daysBetween(start, car.deliveryDateRangeStart) ?? 0) / totalDays) * timelineWidth));
    bar.style.setProperty("--delivery-uncertain-width", `${Math.max(0, right - deliveryStartX)}px`);
  }
  const tooltip = makeElement("span", "bar-tooltip", details);
  tooltip.id = `tooltip-${car.id}`;
  tooltip.setAttribute("role", "tooltip");
  const captionText = durationText(car, end);
  const caption = makeElement("span", `bar-caption${carState === "delivered" ? " is-delivered" : ""}`, `${captionText}${car.orderDateApproximate || approximateDelivery ? " · приблизително" : ""}`);
  caption.style.left = `${left + Math.max(isSameDay ? 3 : visibleWidth, 0) + 9}px`;
  track.append(bar, tooltip, caption);
  chart.append(track);
  chartScroll.append(chart);
  const summary = makeElement("div", "car-summary", `Поръчка: ${displayedDate(car)} · Доставка: ${displayedDelivery(car)} · ${captionText}${car.note ? ` · Бележка: ${car.note}` : ""}`);
  row.append(label, chartScroll, summary);
  return row;
}

function timelineLabelWidth() {
  if (window.matchMedia("(max-width: 620px)").matches) return 0;
  return window.matchMedia("(max-width: 900px)").matches ? 228 : 290;
}

function measureTimelinePlotWidth() {
  const mobileInset = window.matchMedia("(max-width: 620px)").matches ? 20 : 0;
  return Math.max(1, els.timeline.clientWidth - timelineLabelWidth() - mobileInset);
}

function updateScaleControls() {
  els["fit-period"].classList.toggle("is-active", fitFullPeriod);
  els["fit-period"].setAttribute("aria-pressed", String(fitFullPeriod));
  els["zoom-out"].disabled = fitFullPeriod || timelineZoom <= 1;
}

function render() {
  const visible = filteredCars();
  updateCount(visible.length);
  els["admin-actions"].classList.toggle("hidden", currentUser?.uid !== ADMIN_UID);
  els["seed-button"].classList.toggle("hidden", currentUser?.uid !== ADMIN_UID);
  els["order-import-panel"].classList.toggle("hidden", currentUser?.uid !== ADMIN_UID);
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
  timelinePlotWidth = measureTimelinePlotWidth();
  const timelineWidth = timelinePlotWidth * (fitFullPeriod ? 1 : timelineZoom);
  const markers = monthMarkers(axisStart, end, timelineWidth);
  els.timeline.style.setProperty("--label-width", `${timelineLabelWidth()}px`);
  els.timeline.classList.toggle("is-zoomed", !fitFullPeriod && timelineZoom > 1);
  els.timeline.replaceChildren(renderTimelineAxis(end, timelineWidth, markers));
  const fragment = document.createDocumentFragment();
  for (const car of visible) fragment.append(appendCarRow(car, axisStart, end, timelineWidth, markers));
  els.timeline.append(fragment);
  updateScaleControls();
}

function initTimelineResizeObserver() {
  const observer = new ResizeObserver(() => {
    const nextWidth = measureTimelinePlotWidth();
    if (Math.abs(nextWidth - timelinePlotWidth) > 1) {
      timelinePlotWidth = nextWidth;
      render();
    }
  });
  observer.observe(els["timeline-wrap"]);
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
  els["fit-period"].addEventListener("click", () => {
    fitFullPeriod = true;
    timelineZoom = 1;
    render();
  });
  els["zoom-in"].addEventListener("click", () => {
    fitFullPeriod = false;
    timelineZoom = Math.min(4, timelineZoom * 1.25);
    render();
  });
  els["zoom-out"].addEventListener("click", () => {
    timelineZoom = Math.max(1, timelineZoom / 1.25);
    fitFullPeriod = timelineZoom === 1;
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
  form.elements.status.value = car?.status || "";
  form.elements.note.value = car?.note || "";
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
  const statusValue = String(formData.get("status") || "");
  const note = String(formData.get("note") || "").trim().replace(/\s+/g, " ");
  if (statusValue && !STATUSES.has(statusValue)) throw new Error("Изберете валиден статус.");
  if (note.length > 300) throw new Error("Бележката може да е най-много 300 знака.");
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
  if (deliveryDate && statusValue && statusValue !== "delivered") {
    throw new Error("Датата на доставка е възможна само за статус „Доставена“ или автоматичен статус.");
  }
  let deliveryApproximateFields = {};
  if (!deliveryDate && statusValue === "delivered") {
    if (!existing?.deliveryDateApproximate) throw new Error("За статус „Доставена“ въведете дата на доставка.");
    deliveryApproximateFields = {
      deliveryDateApproximate: true,
      deliveryDateNote: existing.deliveryDateNote,
      deliveryDateRangeStart: existing.deliveryDateRangeStart,
      deliveryDateRangeEnd: existing.deliveryDateRangeEnd,
    };
  }

  return {
    id: existing?.id || crypto.randomUUID(),
    name,
    model: modelValue || null,
    color: colorValue || null,
    orderDate,
    deliveryDate,
    ...(statusValue ? { status: statusValue } : {}),
    ...(note ? { note } : {}),
    ...deliveryApproximateFields,
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

const FIELD_LABELS = {
  name: "Име", model: "Оборудване", color: "Цвят", orderDate: "Дата на поръчката", deliveryDate: "Дата на доставка",
  status: "Статус", note: "Бележка", orderDateApproximate: "Приблизителна поръчка", orderDateNote: "Бележка за приблизителна поръчка",
  orderDateRangeStart: "Начало на диапазон на поръчката", orderDateRangeEnd: "Край на диапазон на поръчката",
  deliveryDateApproximate: "Приблизителна доставка", deliveryDateNote: "Бележка за приблизителна доставка",
  deliveryDateRangeStart: "Начало на диапазон на доставката", deliveryDateRangeEnd: "Край на диапазон на доставката",
};
let importState = null;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// Отпечатък на засегнатите записи: ако се промени след прегледа, записът се отказва.
function importFingerprint(current) {
  const ids = [...new Set([...seedCars.map((car) => car.id), ...seedUpdates.map((update) => update.id)])].sort();
  return stableStringify(ids.map((id) => current.find((car) => car?.id === id) ?? null));
}

function applyUpdate(car, update, useProposed = new Set()) {
  const next = { ...car, ...update.set };
  for (const field of update.remove || []) delete next[field];
  for (const [field, value] of Object.entries(update.conflicts || {})) {
    if (useProposed.has(`${car.id}.${field}`)) next[field] = value;
  }
  return next;
}

function buildImportPlan(current) {
  const byId = new Map(current.filter((car) => car && typeof car.id === "string").map((car) => [car.id, car]));
  const updatesById = new Map(seedUpdates.map((update) => [update.id, update]));
  const additions = [];
  for (const seed of seedCars) {
    if (byId.has(seed.id)) continue;
    const update = updatesById.get(seed.id);
    additions.push(update ? applyUpdate(seed, update) : { ...seed });
  }
  const changes = [];
  for (const update of seedUpdates) {
    const car = byId.get(update.id);
    if (!car) continue;
    const fields = [];
    for (const [field, value] of Object.entries(update.set)) {
      if (stableStringify(car[field]) !== stableStringify(value)) fields.push({ field, from: car[field], to: value });
    }
    for (const field of update.remove || []) if (field in car) fields.push({ field, from: car[field], to: undefined });
    const conflicts = [];
    for (const [field, value] of Object.entries(update.conflicts || {})) {
      if (car[field] !== value) conflicts.push({ key: `${car.id}.${field}`, field, from: car[field], to: value });
    }
    if (fields.length || conflicts.length) changes.push({ id: car.id, name: car.name, fields, conflicts });
  }
  return { additions, changes, skipped: seedCars.length - additions.length };
}

function previewValue(field, value) {
  if (value === undefined || value === null || value === "") return "—";
  if (field === "color") return getColor(value)?.name || String(value);
  if (field === "status") return STATUS_LABELS[value] || String(value);
  if (/Date$/.test(field)) return isValidISODate(value) ? formatISODate(value) : String(value);
  return String(value);
}

async function readRawCars() {
  const snapshot = await getDoc(doc(db, ...TRACKER_REF_PATH));
  const current = snapshot.exists() ? snapshot.data().cars : [];
  if (!Array.isArray(current)) throw new Error("Полето cars в Firestore не е масив; импортът е прекъснат.");
  return current;
}

function renderImportPreview(plan) {
  const container = els["import-preview"];
  container.replaceChildren();
  container.append(makeElement("p", "import-summary", `Нови записи: ${plan.additions.length} · Записи с промени: ${plan.changes.length} · Вече съществуват без промяна: ${plan.skipped}`));
  if (plan.additions.length) {
    container.append(makeElement("h3", "import-heading", "Нови записи"));
    const list = makeElement("ul", "import-list");
    for (const car of plan.additions) {
      list.append(makeElement("li", "", `${car.name} · ${previewValue("orderDate", car.orderDate)} · ${car.model || "—"} · ${previewValue("color", car.color)}${car.note ? ` · ${car.note}` : ""}`));
    }
    container.append(list);
  }
  if (plan.changes.length) container.append(makeElement("h3", "import-heading", "Променени полета"));
  for (const change of plan.changes) {
    const block = makeElement("div", "import-change");
    block.append(makeElement("strong", "", change.name));
    const list = makeElement("ul", "import-list");
    for (const item of change.fields) {
      list.append(makeElement("li", "", `${FIELD_LABELS[item.field] || item.field}: ${previewValue(item.field, item.from)} → ${item.to === undefined ? "(премахва се)" : previewValue(item.field, item.to)}`));
    }
    block.append(list);
    for (const conflict of change.conflicts) {
      const fieldset = makeElement("fieldset", "import-conflict");
      fieldset.append(makeElement("legend", "", `Конфликт — ${FIELD_LABELS[conflict.field] || conflict.field}`));
      for (const [value, text] of [["keep", `Запази съществуващата: ${previewValue(conflict.field, conflict.from)}`], ["use", `Използвай новата: ${previewValue(conflict.field, conflict.to)}`]]) {
        const label = makeElement("label", "import-choice");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `conflict:${conflict.key}`;
        input.value = value;
        input.checked = value === "keep";
        label.append(input, makeElement("span", "", text));
        fieldset.append(label);
      }
      block.append(fieldset);
    }
    container.append(block);
  }
  if (!plan.additions.length && !plan.changes.length) container.append(makeElement("p", "", "Няма нови записи или промени за прилагане."));
  els["import-confirm"].disabled = !plan.additions.length && !plan.changes.length;
}

async function openImportPreview() {
  if (currentUser?.uid !== ADMIN_UID || !db) return;
  els["import-error"].textContent = "";
  try {
    const current = await readRawCars();
    const plan = buildImportPlan(current);
    importState = { fingerprint: importFingerprint(current) };
    renderImportPreview(plan);
    if (!els["import-dialog"].open) openDialog(els["import-dialog"]);
  } catch (error) {
    showNotice(`Прегледът не беше зареден: ${error.message || "неизвестна грешка"}`, "error");
  }
}

async function confirmImport(event) {
  event.preventDefault();
  if (currentUser?.uid !== ADMIN_UID || !db || !importState) return;
  const useProposed = new Set(
    [...els["import-form"].querySelectorAll("input[type=radio]:checked")]
      .filter((input) => input.value === "use")
      .map((input) => input.name.slice("conflict:".length)),
  );
  const expected = importState.fingerprint;
  els["import-confirm"].disabled = true;
  try {
    const reference = doc(db, ...TRACKER_REF_PATH);
    const result = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      const exists = snapshot.exists();
      const current = exists ? snapshot.data().cars : [];
      if (!Array.isArray(current)) throw new Error("Полето cars в Firestore не е масив; импортът е прекъснат.");
      if (importFingerprint(current) !== expected) {
        const stale = new Error("stale");
        stale.stale = true;
        throw stale;
      }
      const plan = buildImportPlan(current);
      const updatesById = new Map(seedUpdates.map((update) => [update.id, update]));
      const changedIds = new Set(plan.changes.map((change) => change.id));
      const next = current.map((car) => (changedIds.has(car?.id) ? applyUpdate(car, updatesById.get(car.id), useProposed) : car));
      next.push(...plan.additions);
      if (new Set(next.map((car) => car?.id)).size !== next.length) throw new Error("ID на автомобилите трябва да са уникални.");
      if (plan.additions.length || plan.changes.length || !exists) transaction.set(reference, { cars: next });
      return { added: plan.additions.length, updated: plan.changes.length, skipped: plan.skipped, conflictsApplied: useProposed.size };
    });
    closeDialog(els["import-dialog"]);
    importState = null;
    showNotice(`Импортът приключи: добавени ${result.added}, актуализирани ${result.updated}, пропуснати ${result.skipped}, приложени конфликтни избори ${result.conflictsApplied}.`, "success", 8000);
  } catch (error) {
    if (error.stale) {
      els["import-error"].textContent = "Данните са променени след прегледа. Прегледът е опреснен — проверете го отново.";
      await openImportPreview();
      els["import-error"].textContent = "Данните са променени след прегледа. Прегледът е опреснен — проверете го отново.";
    } else {
      els["import-error"].textContent = `Импортът не беше изпълнен: ${error.message || "неизвестна грешка"}`;
      els["import-confirm"].disabled = false;
    }
  }
}

function reviewField(labelText, control) {
  const label = makeElement("label", "form-field order-review-field");
  label.append(makeElement("span", "", labelText), control);
  return label;
}

function createReviewSelect(value, options) {
  const select = document.createElement("select");
  for (const [optionValue, text] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = text;
    select.append(option);
  }
  select.value = value || "";
  return select;
}

function renderOrderReview(deliveryTermNotice = null) {
  const container = els["order-review"];
  container.replaceChildren();
  container.classList.toggle("hidden", !parsedOrders.length);
  if (!parsedOrders.length) return;

  container.append(makeElement("h3", "import-heading", "Преглед и редакция"));
  if (deliveryTermNotice) container.append(makeElement("p", "delivery-term-notice", deliveryTermNotice));

  parsedOrders.forEach((order, index) => {
    const card = makeElement("fieldset", "order-review-card");
    card.append(makeElement("legend", "", `Поръчка ${index + 1}`));
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 80;
    name.required = true;
    name.value = order.name || "";
    name.dataset.field = "name";
    card.append(reviewField("Име или псевдоним", name));

    const model = createReviewSelect(order.model, [["", "Не е посочено"], ["Basic", "Basic"], ["Comfort", "Comfort"], ["Premium", "Premium"]]);
    model.dataset.field = "model";
    const color = createReviewSelect(order.color, [["", "Не е посочено"], ...COLORS.map(({ id, name: colorName }) => [id, colorName])]);
    color.dataset.field = "color";
    const vehicleFields = makeElement("div", "order-review-grid");
    vehicleFields.append(reviewField("Оборудване", model), reviewField("Цвят", color));
    card.append(vehicleFields);

    const orderDate = document.createElement("input");
    orderDate.type = "date";
    orderDate.required = true;
    orderDate.value = order.orderDate || "";
    orderDate.dataset.field = "orderDate";
    const deliveryDate = document.createElement("input");
    deliveryDate.type = "date";
    deliveryDate.value = order.deliveryDate || "";
    deliveryDate.dataset.field = "deliveryDate";
    const dateFields = makeElement("div", "order-review-grid");
    dateFields.append(reviewField("Дата на поръчката (задължителна)", orderDate), reviewField("Реална дата на доставка", deliveryDate));
    card.append(dateFields);

    const status = createReviewSelect(order.status, [
      ["", "Автоматично"],
      ["waiting", "Очаква доставка"],
      ["delivered", "Доставена"],
      ["switched", "Преминава към друг модел"],
    ]);
    status.dataset.field = "status";
    card.append(reviewField("Статус", status));

    const note = document.createElement("textarea");
    note.rows = 2;
    note.maxLength = 300;
    note.value = order.note || "";
    note.dataset.field = "note";
    card.append(reviewField("Бележка", note));

    if (order.deliveryTerm) {
      card.append(makeElement("p", "delivery-term-notice", `Посочен срок за доставка: ${order.deliveryTerm}. Той не се записва, защото приложението няма отделно поле за срок.`));
    }

    const remove = makeElement("button", "text-button order-remove-button", "Премахни записа");
    remove.type = "button";
    remove.addEventListener("click", () => {
      parsedOrders.splice(index, 1);
      renderOrderReview(deliveryTermNotice);
      if (!parsedOrders.length) els["parse-orders-status"].textContent = "Всички извлечени записи са премахнати.";
    });
    card.append(remove);
    container.append(card);
  });

  const add = makeElement("button", "button button-primary", "Добави");
  add.type = "button";
  add.disabled = ordersRequestInProgress;
  add.addEventListener("click", saveParsedOrders);
  container.append(add);
}

async function postAdminRequest(path, body) {
  if (currentUser?.uid !== ADMIN_UID) throw new Error("Нямате права за това действие.");
  let token;
  try {
    token = await currentUser.getIdToken();
  } catch {
    throw new Error("Сесията е невалидна или е изтекла. Влезте отново.");
  }
  let response;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), ADMIN_REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Заявката отне твърде дълго. Проверете дали записът е добавен, преди да опитате отново.");
    }
    throw new Error("Сървърът не е достъпен. Проверете връзката и опитайте отново.");
  } finally {
    window.clearTimeout(timeoutId);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Сървърът върна невалиден отговор. Опитайте отново.");
  }
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : "Заявката не беше изпълнена.");
  }
  return result;
}

function readReviewedOrders() {
  return [...els["order-review"].querySelectorAll(".order-review-card")].map((card) => {
    const values = Object.fromEntries(
      [...card.querySelectorAll("[data-field]")].map((field) => [field.dataset.field, field.value.trim() || null]),
    );
    return values;
  });
}

async function extractOrders() {
  if (ordersRequestInProgress || currentUser?.uid !== ADMIN_UID) return;
  const text = els["parse-orders-text"].value;
  els["parse-orders-status"].textContent = "";
  parsedOrders = [];
  renderOrderReview();
  ordersRequestInProgress = true;
  els["parse-orders-button"].disabled = true;
  els["parse-orders-button"].setAttribute("aria-busy", "true");
  els["parse-orders-status"].textContent = "Извличане на поръчките…";
  try {
    const result = await postAdminRequest("/api/parse-orders", { text });
    if (!Array.isArray(result.orders)) throw new Error("Сървърът върна невалиден списък с поръчки.");
    parsedOrders = result.orders;
    renderOrderReview(result.deliveryTermNotice);
    els["parse-orders-status"].textContent = parsedOrders.length
      ? `Извлечени записи: ${parsedOrders.length}. Проверете и редактирайте ги преди добавяне.`
      : "Не бяха открити поръчки.";
  } catch (error) {
    els["parse-orders-status"].textContent = error.message || "Извличането не беше успешно.";
  } finally {
    ordersRequestInProgress = false;
    els["parse-orders-button"].disabled = false;
    els["parse-orders-button"].removeAttribute("aria-busy");
  }
}

async function saveParsedOrders() {
  if (ordersRequestInProgress || currentUser?.uid !== ADMIN_UID || !parsedOrders.length) return;
  const form = els["order-review"];
  const invalidField = form.querySelector(":invalid");
  if (invalidField) {
    invalidField.reportValidity();
    return;
  }
  ordersRequestInProgress = true;
  els["parse-orders-button"].disabled = true;
  form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  els["parse-orders-status"].textContent = "Записване на одобрените поръчки…";
  try {
    const result = await postAdminRequest("/api/add-orders", { orders: readReviewedOrders() });
    if (!Number.isInteger(result.added)) throw new Error("Сървърът върна невалиден резултат от записа.");
    parsedOrders = [];
    els["parse-orders-text"].value = "";
    renderOrderReview();
    els["parse-orders-status"].textContent = "";
    showNotice(`Добавени са ${result.added} поръчки.`, "success", 5000);
  } catch (error) {
    els["parse-orders-status"].textContent = error.message || "Записът не беше успешен.";
    renderOrderReview();
  } finally {
    ordersRequestInProgress = false;
    els["parse-orders-button"].disabled = false;
    form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
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
      if (user && user.uid !== ADMIN_UID) {
        showNotice("Влезли сте с акаунт без администраторски права. Данните остават само за четене.", "warning");
      } else if (user?.uid === ADMIN_UID) {
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
      if (credential.user.uid !== ADMIN_UID) {
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
  els["parse-orders-button"].addEventListener("click", extractOrders);
  els["seed-button"].addEventListener("click", openImportPreview);
  els["import-form"].addEventListener("submit", confirmImport);
  els["car-form"].addEventListener("submit", saveCar);
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(document.getElementById(button.dataset.close))));
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  }));
}

populateColorOptions();
initTimelineControls();
initTimelineResizeObserver();
installEvents();
render();
connectFirebase();

window.addEventListener("beforeunload", () => unsubscribeCars?.());
