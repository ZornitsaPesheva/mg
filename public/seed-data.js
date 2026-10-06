export const seedCars = [
  { id: "sunai-demirov", name: "Sunai Demirov", model: null, color: null, orderDate: "2026-08-25", deliveryDate: null },
  { id: "carkeys-sofia", name: "CarKeys Sofia", model: "Premium", color: "red", orderDate: "2026-06-11", deliveryDate: "2026-09-30" },
  { id: "konstantin-boiadjiev", name: "Konstantin Boiadjiev", model: null, color: null, orderDate: "2026-09-21", deliveryDate: null },
  { id: "slavi-dilov", name: "Слави Дилов", model: null, color: null, orderDate: "2026-09-30", deliveryDate: null },
  { id: "gabriela-cherganska", name: "Габриела Черганска", model: null, color: null, orderDate: "2026-09-03", deliveryDate: null },
  { id: "oleg-dimitrov", name: "Oleg Dimitrov", model: null, color: null, orderDate: "2026-06-01", deliveryDate: null },
  { id: "dimitar-jelev", name: "Dimitar Jelev", model: null, color: null, orderDate: "2026-06-15", deliveryDate: null },
  { id: "jason-brown", name: "Jason Brown", model: "Comfort", color: null, orderDate: "2026-06-01", deliveryDate: "2026-09-15" },
  { id: "vasil-nikov", name: "Vasil Nikov", model: "Comfort", color: null, orderDate: "2026-06-10", deliveryDate: null },
  { id: "vitan-vitov", name: "Vitan Vitov", model: null, color: null, orderDate: "2026-06-22", deliveryDate: null },
  { id: "georgi-yovchev", name: "Georgi Yovchev", model: null, color: "red", orderDate: null, deliveryDate: null, orderDateApproximate: true, orderDateNote: "Края на май 2026", orderDateRangeStart: "2026-05-21", orderDateRangeEnd: "2026-05-31" },
  { id: "stunning-pineapple4726", name: "StunningPineapple4726", model: null, color: null, orderDate: null, deliveryDate: null, status: "delivered", note: "Поръчана в края на май 2026; доставена за точно 3 месеца", orderDateApproximate: true, orderDateNote: "Края на май 2026 (условно)", orderDateRangeStart: "2026-05-21", orderDateRangeEnd: "2026-05-31", deliveryDateApproximate: true, deliveryDateNote: "Края на август 2026 (условно)", deliveryDateRangeStart: "2026-08-21", deliveryDateRangeEnd: "2026-08-31" },
  { id: "daikin-problem", name: "Daikin_problem", model: null, color: null, orderDate: "2026-09-24", deliveryDate: null, note: "Обявен срок за доставка 240 дни" },
  { id: "petko-chardakov", name: "Petko Chardakov", model: "Premium", color: "stone-green", orderDate: "2026-09-15", deliveryDate: null, note: "Пловдив. Очаквана доставка март 2027, възможно по-рано" },
  { id: "heartfelt-llama186", name: "HeartfeltLlama186", model: null, color: null, orderDate: "2026-06-10", deliveryDate: null, status: "switched", note: "Преминава към MGS5; запазена кола, чака обработка на документите" },
  { id: "marin-oresharov", name: "Marin Oresharov", model: "Premium", color: "camden-grey", orderDate: "2026-07-08", deliveryDate: null, note: "Дилърът няма информация за доставката" },
  { id: "georgi-hristov", name: "Георги Христов", model: "Comfort", color: null, orderDate: "2026-09-24", deliveryDate: null, note: "Батерия 54 kWh. Обявен срок за доставка 180 дни" },
  { id: "zornitsa-pesheva", name: "Zornitsa Pesheva", model: "Comfort", color: "stone-green", orderDate: "2026-06-29", deliveryDate: null, note: "Батерия 43 kWh" },
  { id: "lora-cholakova", name: "Лора Чолакова", model: null, color: "dover-white", orderDate: "2026-09-01", deliveryDate: null, note: "Срок по договор 5 месеца; устно обещана доставка през декември" },
  { id: "plamen-enchev", name: "Пламен Енчев", model: "Premium", color: "cosmic-silver", orderDate: "2026-06-20", deliveryDate: null },
  { id: "vasil-monev", name: "Васил Монев", model: "Comfort", color: "white", orderDate: "2026-05-22", deliveryDate: null, note: "Long Range" },
  {
  id: "zhenya-staikova",
  name: "Женя Стайкова",
  model: "Comfort",
  color: null,
  orderDate: "2026-08-11",
  deliveryDate: null,
  note: "Батерия 54 kWh. Срок за доставка 150 дни"
},
{
  id: "unknown-2026-08-07-stone-green",
  name: "Не е посочено",
  model: "Comfort",
  color: "stone-green",
  orderDate: "2026-08-07",
  deliveryDate: null,
  note: "Батерия 54 kWh"
},

];

// set/remove се прилагат след преглед; conflicts никога не се прилагат без избор на администратора.
export const seedUpdates = [
  { id: "oleg-dimitrov", set: { color: "black", note: "Посочен срок 120 дни" } },
  {
    id: "stunning-pineapple4726",
    set: { orderDate: "2026-05-23", deliveryDate: "2026-08-18", model: "Premium", status: "delivered" },
    remove: [
      "orderDateApproximate", "orderDateNote", "orderDateRangeStart", "orderDateRangeEnd",
      "deliveryDateApproximate", "deliveryDateNote", "deliveryDateRangeStart", "deliveryDateRangeEnd",
    ],
  },
  { id: "carkeys-sofia", set: { note: "Посочен срок 110 дни" }, conflicts: { orderDate: "2026-06-10" } },
  { id: "vasil-nikov", set: { color: "red" }, conflicts: { orderDate: "2026-06-11" } },
];
