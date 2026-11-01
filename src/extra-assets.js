// Original procedural assets. Dimensions are metres; local origins are at mid-height.
// Every entry is a compound of supported solid primitives, including hollow vessels.
const C = {
  ink: '#354c48', sage: '#879b8b', linen: '#dedccf', clay: '#c18b70',
  oak: '#b99a74', darkOak: '#8d7153', steel: '#a3b0ac', brass: '#baa46e',
  charcoal: '#3c4543', chalk: '#e8e4d9', moss: '#627e70', paper: '#c9c7b9',
};
const B = (d, p = [0, 0, 0], extra = {}) => ({ shape: 'box', d, p, ...extra });
const Y = (radius, height, p = [0, 0, 0], extra = {}) => ({ shape: 'cylinder', d: [radius, height], p, ...extra });
const S = (radius, p = [0, 0, 0], extra = {}) => ({ shape: 'sphere', d: [radius], p, ...extra });
const color = hex => ({ color: hex });

function legs(xs, zs, y, height, width = .10, tint = C.darkOak) {
  return xs.flatMap(x => zs.map(z => B([width, height, width], [x, y, z], color(tint))));
}

function eulerFromBasis(x, y, z) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, z[0])));
  if (Math.abs(z[0]) < .9999999) return [Math.atan2(-z[1], z[2]), pitch, Math.atan2(-y[0], x[0])];
  return [Math.atan2(y[2], y[1]), pitch, 0];
}

function rod(a, b, radius = .055, tint = C.steel) {
  const delta = b.map((v, i) => v - a[i]);
  const length = Math.hypot(...delta);
  const y = delta.map(v => v / length);
  let x = Math.abs(y[2]) < .95 ? [y[1], -y[0], 0] : [1, 0, 0];
  const xl = Math.hypot(...x); x = x.map(v => v / xl);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return Y(radius, length, a.map((v, i) => (v + b[i]) / 2), { r: eulerFromBasis(x, y, z), color: tint });
}

function vessel(radius, height, thickness = .055, tint = C.linen, count = 12) {
  const result = [Y(radius, thickness, [0, -height / 2 + thickness / 2, 0], color(tint))];
  for (let i = 0; i < count; i++) {
    const a = i * Math.PI * 2 / count;
    result.push(B([2 * radius * Math.tan(Math.PI / count) * 1.03, height, thickness],
      [(radius - thickness / 2) * Math.sin(a), 0, (radius - thickness / 2) * Math.cos(a)],
      { r: [0, a, 0], color: tint }));
  }
  return result;
}

function frustumWalls(bottomRadius, topRadius, height, centerY, thickness, tint, count = 12) {
  const dr = topRadius - bottomRadius;
  const length = Math.hypot(dr, height);
  const middleRadius = (bottomRadius + topRadius) / 2;
  return Array.from({ length: count }, (_, i) => {
    const a = i * Math.PI * 2 / count;
    const x = [Math.cos(a), 0, -Math.sin(a)];
    const y = [Math.sin(a) * dr / length, height / length, Math.cos(a) * dr / length];
    const z = [Math.sin(a) * height / length, -dr / length, Math.cos(a) * height / length];
    return B([2 * Math.max(bottomRadius, topRadius) * Math.tan(Math.PI / count) * 1.03, length, thickness],
      [middleRadius * Math.sin(a), centerY, middleRadius * Math.cos(a)],
      { r: eulerFromBasis(x, y, z), color: tint });
  });
}

export const EXTRA_CATALOG = [
  { id: 'sofa', name: 'Трёхместный диван', category: 'Интерьер', mat: 'wood', size: [2.8, 1.35, 1.1] },
  { id: 'bed', name: 'Кровать с изголовьем', category: 'Интерьер', mat: 'wood', size: [2.0, 1.3, 3.2] },
  { id: 'desk', name: 'Письменный стол', category: 'Интерьер', mat: 'wood', size: [2.6, 1.65, 1.35] },
  { id: 'wardrobe', name: 'Двухдверный шкаф', category: 'Интерьер', mat: 'wood', size: [2.2, 3.0, .9] },
  { id: 'nightstand', name: 'Прикроватная тумба', category: 'Интерьер', mat: 'wood', size: [1.0, 1.05, .8] },
  { id: 'coffee-table', name: 'Журнальный столик', category: 'Интерьер', mat: 'wood', size: [1.9, .85, 1.1] },
  { id: 'armchair', name: 'Кресло', category: 'Интерьер', mat: 'wood', size: [1.25, 1.45, 1.1] },
  { id: 'sideboard', name: 'Низкий комод', category: 'Интерьер', mat: 'wood', size: [2.8, 1.5, .8] },
  { id: 'room-divider', name: 'Реечная перегородка', category: 'Интерьер', mat: 'wood', size: [2.6, 2.6, .55] },
  { id: 'ottoman', name: 'Круглый пуф', category: 'Интерьер', mat: 'wood', size: [1.3, .9, 1.3] },
  { id: 'saucepan', name: 'Сотейник с ручкой', category: 'Ёмкости', mat: 'metal', size: [2.0, .65, 1.2] },
  { id: 'stockpot', name: 'Кастрюля', category: 'Ёмкости', mat: 'metal', size: [1.55, 1.15, 1.15] },
  { id: 'pitcher', name: 'Кувшин', category: 'Ёмкости', mat: 'ceramic', size: [1.25, 1.15, 1.0] },
  { id: 'vase', name: 'Ваза с узким горлом', category: 'Ёмкости', mat: 'ceramic', size: [.95, 1.5, .95] },
  { id: 'planter', name: 'Кашпо', category: 'Ёмкости', mat: 'ceramic', size: [1.3, 1.0, 1.3] },
  { id: 'toolbox', name: 'Открытый ящик для инструментов', category: 'Ёмкости', mat: 'wood', size: [1.8, 1.2, .85] },
  { id: 'mixing-trough', name: 'Прямоугольное корыто', category: 'Ёмкости', mat: 'metal', size: [2.6, .8, 1.5] },
  { id: 'funnel-bin', name: 'Бункер-воронка', category: 'Ёмкости', mat: 'metal', size: [1.7, 1.6, 1.7] },
  { id: 'pallet', name: 'Деревянный поддон', category: 'Детали', mat: 'wood', size: [2.2, .5, 1.6] },
  { id: 'road-barrier', name: 'Дорожное ограждение', category: 'Детали', mat: 'wood', size: [2.6, 1.3, .7] },
  { id: 'safety-cone', name: 'Сигнальный конус', category: 'Детали', mat: 'rubber', size: [.85, 1.25, .85] },
  { id: 'bollard', name: 'Оградительный столбик', category: 'Детали', mat: 'metal', size: [.6, 1.7, .6] },
  { id: 'screwdriver', name: 'Отвёртка', category: 'Детали', mat: 'metal', size: [.28, 1.65, .28] },
  { id: 'wrench', name: 'Рожковый ключ', category: 'Детали', mat: 'metal', size: [.6, 1.9, .16] },
  { id: 'clamp', name: 'Струбцина', category: 'Детали', mat: 'metal', size: [1.35, 1.65, .3] },
  { id: 'cinderblock', name: 'Пустотелый блок', category: 'Детали', mat: 'ceramic', size: [1.6, .65, .9] },
  { id: 'bridge', name: 'Мост с перилами', category: 'Механизмы', mat: 'wood', size: [3.8, 1.8, 1.6] },
  { id: 'arch', name: 'Сегментная арка', category: 'Механизмы', mat: 'ceramic', size: [2.65, 3.0, .55] },
  { id: 'roller-bed', name: 'Роликовая секция', category: 'Механизмы', mat: 'metal', size: [2.3, 1.15, 3.2] },
  { id: 'spiral-chute', name: 'Спиральная дорожка', category: 'Механизмы', mat: 'metal', size: [2.7, 2.15, 2.7] },
  { id: 'zigzag-chute', name: 'Каскадный желоб', category: 'Механизмы', mat: 'wood', size: [2.8, 3.4, 1.0] },
  { id: 'balance-frame', name: 'Опора для балансира', category: 'Механизмы', mat: 'metal', size: [1.4, 1.7, 1.3] },
  { id: 'launch-chute', name: 'Пусковой желоб', category: 'Механизмы', mat: 'metal', size: [1.1, 1.5, 3.0] },
  { id: 'pegboard', name: 'Поле штырей', category: 'Механизмы', mat: 'wood', size: [2.5, 3.0, .55] },
  { id: 'turnstile', name: 'Крестовой турникет', category: 'Механизмы', mat: 'metal', size: [2.7, 1.7, 2.7] },
  { id: 'chute-splitter', name: 'Разветвитель потока', category: 'Механизмы', mat: 'metal', size: [2.6, .9, 2.8] },
  { id: 'twist-column', name: 'Винтовая колонна', category: 'Формы', mat: 'wood', size: [1.7, 2.0, 1.7] },
  { id: 'tripod-frame', name: 'Тренога', category: 'Формы', mat: 'metal', size: [2.0, 2.6, 2.0] },
  { id: 'cross-jack', name: 'Шестилучевая деталь', category: 'Формы', mat: 'rubber', size: [1.7, 1.7, 1.7] },
  { id: 'pyramid-frame', name: 'Каркасная пирамида', category: 'Формы', mat: 'metal', size: [1.9, 2.1, 1.9] },
];

export function extraParts(id) {
  switch (id) {
    case 'sofa': return [
      B([2.8, .25, 1.1], [0, -.31, 0], color(C.darkOak)),
      B([2.62, .77, .22], [0, .22, -.43], color(C.ink)),
      ...[-1.29, 1.29].map(x => B([.22, .68, 1.08], [x, -.04, 0], color(C.ink))),
      ...[-.83, 0, .83].map(x => B([.79, .22, .77], [x, -.05, .075], color(C.sage))),
      ...[-.83, 0, .83].map(x => B([.77, .56, .16], [x, .25, -.27], { r: [-.10, 0, 0], color: C.sage })),
      ...legs([-1.1, 1.1], [-.36, .36], -.55, .25, .11),
    ];
    case 'bed': return [
      B([2, .24, 3.1], [0, -.32, 0], color(C.darkOak)),
      B([1.94, .35, 2.9], [0, -.04, .02], color(C.linen)),
      B([2.0, 1.15, .14], [0, -.01, -1.5], color(C.oak)),
      B([2.0, .42, .14], [0, -.36, 1.5], color(C.oak)),
      ...[-.47, .47].map(x => B([.82, .17, .62], [x, .2, -.94], color(C.chalk))),
      B([1.96, .08, 1.65], [0, .17, .49], color(C.moss)),
      ...legs([-.8, .8], [-1.25, 1.25], -.55, .2, .12),
    ];
    case 'desk': return [
      B([2.6, .14, 1.35], [0, .7, 0], color(C.oak)),
      ...legs([-1.08, 1.08], [-.51, .51], -.075, 1.42, .1, C.ink),
      B([.63, 1.1, 1.12], [.85, -.04, -.015], color(C.linen)),
      ...[-.33, .02, .37].map(y => B([.65, .31, .05], [.85, y, .57], color(C.paper))),
      ...[-.33, .02, .37].map(y => B([.24, .035, .035], [.85, y + .035, .61], color(C.ink))),
      B([1.55, .16, .08], [-.3, -.49, -.53], color(C.ink)),
    ];
    case 'wardrobe': return [
      B([2.2, .12, .9], [0, 1.43, 0]), B([2.2, .12, .9], [0, -1.33, 0]),
      B([.12, 2.7, .9], [-1.04, .05, 0]), B([.12, 2.7, .9], [1.04, .05, 0]),
      B([2.08, 2.7, .07], [0, .05, -.415], color(C.darkOak)),
      ...[-.52, .52].map(x => B([1.01, 2.63, .085], [x, .055, .43], color(C.linen))),
      ...[-.10, .10].map(x => B([.035, .38, .05], [x, .12, .50], color(C.brass))),
      B([2.05, .08, .8], [0, .52, 0]),
      ...legs([-.88, .88], [-.3, .3], -1.445, .11, .12),
    ];
    case 'nightstand': return [
      B([1, .09, .8], [0, .47, 0]), B([1, .08, .8], [0, -.33, 0]),
      ...[-.455, .455].map(x => B([.09, .75, .8], [x, .06, 0])),
      B([.9, .75, .06], [0, .06, -.37], color(C.darkOak)),
      ...[-.1, .27].map(y => B([.86, .32, .07], [0, y, .38], color(C.linen))),
      ...[-.1, .27].map(y => B([.25, .035, .04], [0, y, .435], color(C.brass))),
      ...legs([-.35, .35], [-.25, .25], -.43, .16, .10),
    ];
    case 'coffee-table': return [
      B([1.9, .14, 1.1], [0, .35, 0], color(C.linen)),
      B([1.65, .07, .85], [0, -.20, 0], color(C.oak)),
      ...legs([-.72, .72], [-.34, .34], -.025, .74, .09, C.ink),
    ];
    case 'armchair': return [
      B([1.2, .2, 1.05], [0, -.3, 0], color(C.darkOak)),
      B([1.1, .9, .21], [0, .22, -.43], { r: [-.08, 0, 0], color: C.moss }),
      ...[-.52, .52].map(x => B([.20, .65, 1.0], [x, -.04, .01], color(C.moss))),
      B([.8, .22, .76], [0, -.08, .08], color(C.sage)),
      B([.76, .60, .13], [0, .25, -.27], { r: [-.10, 0, 0], color: C.sage }),
      ...legs([-.42, .42], [-.34, .34], -.56, .28, .1),
    ];
    case 'sideboard': return [
      B([2.8, .12, .8], [0, .68, 0]), B([2.8, .1, .8], [0, -.48, 0]),
      ...[-1.35, 1.35].map(x => B([.1, 1.15, .8], [x, .1, 0])),
      B([2.7, 1.15, .06], [0, .1, -.37], color(C.darkOak)),
      ...[-.9, 0, .9].map(x => B([.85, 1.08, .06], [x, .1, .38], color(C.linen))),
      ...[-.9, 0, .9].map(x => Y(.035, .055, [x + .28, .18, .43], { r: [Math.PI / 2, 0, 0], color: C.brass })),
      ...legs([-1.12, 1.12], [-.25, .25], -.62, .22, .11),
    ];
    case 'room-divider': return [
      B([2.6, .12, .2], [0, -1.18, 0]), B([2.6, .12, .2], [0, 1.23, 0]),
      ...Array.from({ length: 9 }, (_, i) => B([.13, 2.35, .16], [-1.15 + i * .2875, .025, 0], color(i % 2 ? C.oak : C.darkOak))),
      ...[-1.03, 1.03].map(x => B([.32, .12, .55], [x, -1.24, 0], color(C.ink))),
    ];
    case 'ottoman': return [
      Y(.65, .48, [0, .12, 0], color(C.sage)),
      Y(.61, .10, [0, -.17, 0], color(C.darkOak)),
      ...legs([-.36, .36], [-.36, .36], -.33, .23, .09),
    ];
    case 'saucepan': return [
      ...vessel(.6, .6, .055, C.steel),
      B([.75, .13, .16], [.9, .14, 0], color(C.charcoal)),
      B([.20, .09, .2], [.60, .12, 0], color(C.steel)),
      ...[-.17, .17].map(z => Y(.025, .025, [.53, .18, z], { r: [0, 0, Math.PI / 2], color: C.brass })),
    ];
    case 'stockpot': return [
      ...vessel(.55, 1.1, .05, C.steel),
      ...[-1, 1].flatMap(side => [B([.25, .08, .08], [side * .64, .29, -.16], color(C.charcoal)), B([.25, .08, .08], [side * .64, .29, .16], color(C.charcoal)), B([.08, .08, .4], [side * .75, .29, 0], color(C.charcoal))]),
    ];
    case 'pitcher': return [
      ...vessel(.42, 1.05, .05, C.linen),
      B([.36, .07, .12], [.56, .4, 0]), B([.36, .07, .12], [.56, -.3, 0]),
      B([.07, .75, .12], [.72, .05, 0]),
      B([.30, .12, .12], [-.42, .45, .12], { r: [0, .4, -.2], color: C.linen }),
      B([.30, .12, .12], [-.42, .45, -.12], { r: [0, -.4, -.2], color: C.linen }),
    ];
    case 'vase': return [
      Y(.44, .06, [0, -.72, 0], color(C.clay)),
      ...frustumWalls(.44, .37, .8, -.32, .055, C.clay),
      ...frustumWalls(.37, .20, .65, .405, .055, C.linen),
    ];
    case 'planter': return [
      Y(.49, .07, [0, -.465, 0], color(C.clay)),
      ...frustumWalls(.49, .62, .92, -.005, .065, C.clay),
      ...frustumWalls(.62, .62, .12, .44, .09, C.linen),
    ];
    case 'toolbox': return [
      B([1.8, .1, .85], [0, -.54, 0]),
      ...[-.855, .855].map(x => B([.09, .65, .85], [x, -.23, 0], color(C.oak))),
      ...[-.38, .38].map(z => B([1.8, .65, .09], [0, -.23, z], color(C.oak))),
      ...[-.84, .84].map(x => B([.1, 1.0, .12], [x, .08, 0], color(C.ink))),
      Y(.07, 1.75, [0, .52, 0], { r: [0, 0, Math.PI / 2], color: C.ink }),
    ];
    case 'mixing-trough': return [
      B([2.2, .10, 1.1], [0, -.35, 0], color(C.steel)),
      ...[-1, 1].map(side => B([2.6, .72, .08], [0, .01, side * .63], { r: [side * .24, 0, 0], color: C.steel })),
      ...[-1, 1].map(side => B([.08, .72, 1.5], [side * 1.19, .01, 0], { r: [0, 0, -side * .24], color: C.steel })),
      ...[-1.0, 1.0].map(x => B([.16, .12, 1.0], [x, -.38, 0], color(C.ink))),
    ];
    case 'funnel-bin': return [
      ...frustumWalls(.22, .81, 1.15, .18, .055, C.steel),
      ...frustumWalls(.22, .22, .38, -.585, .055, C.ink),
    ];
    case 'pallet': return [
      ...Array.from({ length: 6 }, (_, i) => B([2.2, .10, .21], [0, .2, -.68 + i * .272])),
      ...[-.82, 0, .82].map(x => B([.18, .10, 1.6], [x, -.20, 0], color(C.darkOak))),
      ...[-.82, 0, .82].flatMap(x => [-.56, .56].map(z => B([.24, .27, .25], [x, -.015, z], color(C.oak)))),
    ];
    case 'road-barrier': return [
      ...[-1.05, 1.05].map(x => B([.12, 1.18, .13], [x, .035, 0], color(C.ink))),
      ...[-1.05, 1.05].map(x => B([.55, .10, .7], [x, -.59, 0], color(C.ink))),
      B([2.6, .35, .12], [0, .28, 0], color(C.linen)),
      ...[-.91, -.3, .31, .92].map(x => B([.19, .37, .025], [x, .28, .075], { r: [0, 0, -.35], color: C.clay })),
    ];
    case 'safety-cone': return [
      B([.85, .09, .85], [0, -.575, 0], color(C.charcoal)),
      { shape: 'cone', d: [.36, 1.12], p: [0, .02, 0], color: C.clay },
      Y(.245, .12, [0, -.1, 0], color(C.linen)), Y(.16, .095, [0, .20, 0], color(C.linen)),
    ];
    case 'bollard': return [
      B([.6, .10, .6], [0, -.80, 0], color(C.charcoal)),
      Y(.16, 1.43, [0, -.045, 0], color(C.ink)), S(.16, [0, .67, 0], color(C.ink)),
      Y(.17, .10, [0, .40, 0], color(C.brass)), Y(.17, .07, [0, .19, 0], color(C.brass)),
    ];
    case 'screwdriver': return [
      Y(.13, .65, [0, -.45, 0], color(C.ink)), Y(.105, .09, [0, -.79, 0], color(C.charcoal)),
      Y(.04, .82, [0, .25, 0], color(C.steel)),
      B([.13, .18, .035], [0, .71, 0], color(C.steel)),
      Y(.135, .07, [0, -.2, 0], color(C.clay)),
    ];
    case 'wrench': return [
      B([.17, 1.16, .12], [0, 0, 0], color(C.steel)),
      B([.22, .43, .15], [0, -.06, 0], color(C.ink)),
      ...[-1, 1].flatMap(side => [
        B([.40, .13, .12], [0, side * .64, 0], color(C.steel)),
        B([.12, .32, .12], [-.23, side * .75, 0], { r: [0, 0, -.20 * side], color: C.steel }),
        B([.12, .32, .12], [.23, side * .75, 0], { r: [0, 0, .20 * side], color: C.steel }),
      ]),
    ];
    case 'clamp': return [
      B([.16, 1.3, .24], [-.43, .06, 0], color(C.ink)),
      B([.95, .16, .24], [-.035, .64, 0], color(C.ink)),
      B([.95, .16, .24], [-.035, -.52, 0], color(C.ink)),
      Y(.055, 1.15, [.34, -.16, 0], color(C.steel)),
      Y(.17, .08, [.34, .36, 0], color(C.steel)),
      Y(.047, .68, [.34, -.75, 0], { r: [0, 0, Math.PI / 2], color: C.steel }),
      ...[.02, .66].map(x => S(.075, [x, -.75, 0], color(C.clay))),
    ];
    case 'cinderblock': return [
      ...[-.40, .40].map(z => B([1.6, .65, .10], [0, 0, z], color(C.paper))),
      ...[-.75, 0, .75].map(x => B([.10, .65, .90], [x, 0, 0], color(C.paper))),
    ];
    case 'bridge': return [
      B([3.8, .15, 1.6], [0, .20, 0], color(C.oak)),
      ...legs([-1.45, 1.45], [-.61, .61], -.35, .95, .14),
      ...[-1.65, 1.65].flatMap(x => [-.72, .72].map(z => B([.09, .72, .09], [x, .60, z], color(C.darkOak)))),
      ...[-.72, .72].map(z => B([3.8, .10, .10], [0, .93, z], color(C.darkOak))),
      rod([-1.45, -.78, -.61], [1.45, .1, -.61], .055, C.darkOak),
      rod([1.45, -.78, .61], [-1.45, .1, .61], .055, C.darkOak),
    ];
    case 'arch': return [
      ...[-1.15, 1.15].map(x => B([.3, 1.55, .55], [x, -.67, 0], color(C.linen))),
      ...Array.from({ length: 9 }, (_, i) => {
        const a = (i + .5) * Math.PI / 9;
        return B([.43, .30, .55], [1.15 * Math.cos(a), .12 + 1.15 * Math.sin(a), 0],
          { r: [0, 0, a - Math.PI / 2], color: i % 2 ? C.paper : C.linen });
      }),
      ...[-1.15, 1.15].map(x => B([.48, .1, .70], [x, -1.45, 0], color(C.darkOak))),
    ];
    case 'roller-bed': return [
      ...[-1.04, 1.04].map(x => B([.14, .3, 3.2], [x, -.13, 0], color(C.ink))),
      ...Array.from({ length: 8 }, (_, i) => Y(.155, 1.98, [0, .06, -1.32 + i * .377],
        { r: [0, 0, Math.PI / 2], color: i % 2 ? C.steel : C.paper })),
      ...legs([-.90, .90], [-1.25, 1.25], -.40, .35, .10, C.ink),
    ];
    case 'spiral-chute': return [
      ...Array.from({ length: 20 }, (_, i) => {
        const a = i * Math.PI * 2 / 20;
        const pitch = Math.atan(.085 / (.97 * Math.PI * 2 / 20));
        const x = [Math.cos(a), 0, Math.sin(a)];
        const y = [Math.sin(a) * Math.sin(pitch), Math.cos(pitch), -Math.cos(a) * Math.sin(pitch)];
        const z = [-Math.sin(a) * Math.cos(pitch), Math.sin(pitch), Math.cos(a) * Math.cos(pitch)];
        return B([.70, .11, .40], [.97 * Math.cos(a), -.80 + i * .085, .97 * Math.sin(a)],
          { r: eulerFromBasis(x, y, z), color: i % 5 === 0 ? C.clay : C.steel });
      }),
      Y(.065, 2.10, [0, 0, 0], color(C.ink)),
      Y(.42, .10, [0, -1.0, 0], color(C.ink)),
    ];
    case 'zigzag-chute': return [
      ...Array.from({ length: 4 }, (_, i) => {
        const sign = i % 2 ? 1 : -1;
        return B([2.4, .12, .78], [sign * .10, 1.15 - i * .77, 0], { r: [0, 0, sign * .22], color: C.oak });
      }),
      ...Array.from({ length: 4 }, (_, i) => [-.39, .39].map(z => {
        const sign = i % 2 ? 1 : -1;
        return B([2.4, .23, .065], [sign * .10, 1.25 - i * .77, z], { r: [0, 0, sign * .22], color: C.ink });
      })).flat(),
      ...legs([-1.27, 1.27], [-.39, .39], -.02, 3.22, .08, C.darkOak),
    ];
    case 'balance-frame': return [
      Y(.65, .13, [0, -.77, 0], color(C.ink)),
      Y(.10, 1.28, [0, -.07, 0], color(C.steel)),
      Y(.075, .90, [0, .61, 0], { r: [Math.PI / 2, 0, 0], color: C.brass }),
      ...[-.38, .38].map(z => rod([0, -.6, z], [0, .45, 0], .045, C.steel)),
      ...[-.5, .5].map(x => rod([x, -.68, 0], [0, .4, 0], .045, C.steel)),
    ];
    case 'launch-chute': return [
      B([.9, .11, 2.9], [0, 0, 0], { r: [.30, 0, 0], color: C.steel }),
      ...[-.47, .47].map(x => B([.065, .28, 2.9], [x, .15, 0], { r: [.30, 0, 0], color: C.ink })),
      B([1.1, .12, .65], [0, -.58, .85], color(C.ink)),
      B([.12, .42, .5], [0, -.35, .85], color(C.ink)),
      B([.12, 1.05, .5], [0, -.12, -1.0], color(C.ink)),
      B([1.1, .12, .65], [0, -.60, -1.0], color(C.ink)),
    ];
    case 'pegboard': return [
      B([2.5, 3, .10], [0, 0, -.20], color(C.darkOak)),
      ...Array.from({ length: 4 }, (_, row) => Array.from({ length: 5 }, (_, col) =>
        Y(.07, .40, [-.95 + col * .46 + (row % 2) * .13, 1.0 - row * .65, .04],
          { r: [Math.PI / 2, 0, 0], color: C.brass }))).flat(),
      ...[-1.21, 1.21].map(x => B([.08, 3, .30], [x, 0, -.05], color(C.ink))),
    ];
    case 'turnstile': return [
      B([1.05, .12, .45], [0, -.77, 0], color(C.ink)),
      B([.45, .12, 1.05], [0, -.77, 0], color(C.ink)),
      Y(.13, 1.36, [0, -.06, 0], color(C.steel)),
      Y(.23, .18, [0, .51, 0], color(C.brass)),
      ...Array.from({ length: 4 }, (_, i) => {
        const a = i * Math.PI / 2;
        return B([1.13, .12, .12], [.76 * Math.cos(a), .51, .76 * Math.sin(a)],
          { r: [0, -a, 0], color: C.ink });
      }),
      ...Array.from({ length: 4 }, (_, i) => {
        const a = i * Math.PI / 2;
        return S(.09, [1.30 * Math.cos(a), .51, 1.30 * Math.sin(a)], color(C.clay));
      }),
    ];
    case 'chute-splitter': return [
      B([2.6, .1, 2.8], [0, -.27, 0], color(C.steel)),
      ...[-1.26, 1.26].map(x => B([.08, .40, 2.8], [x, -.04, 0], color(C.ink))),
      B([2.6, .40, .08], [0, -.04, -1.36], color(C.ink)),
      B([.08, .40, 1.1], [0, -.04, .81], color(C.ink)),
      ...[-1, 1].map(sign => B([.08, .40, 1.25], [sign * .27, -.04, -.05], { r: [0, -sign * .48, 0], color: C.clay })),
      ...legs([-.96, .96], [-1.05, 1.05], -.39, .12, .13, C.ink),
    ];
    case 'twist-column': return [
      ...Array.from({ length: 10 }, (_, i) => B([1.65, .13, .40], [0, -.85 + i * .19, 0],
        { r: [0, i * Math.PI / 10, 0], color: i % 3 ? C.oak : C.ink })),
      Y(.07, 1.95, [0, 0, 0], color(C.brass)),
    ];
    case 'tripod-frame': {
      const feet = Array.from({ length: 3 }, (_, i) => {
        const a = i * Math.PI * 2 / 3;
        return [Math.cos(a) * .94, -1.21, Math.sin(a) * .94];
      });
      return [...feet.map(p => rod(p, [0, 1.13, 0], .055, C.steel)),
        ...feet.map(p => S(.09, p, color(C.ink))), S(.15, [0, 1.13, 0], color(C.brass))];
    }
    case 'cross-jack': return [
      Y(.11, 1.35, [0, 0, 0], color(C.moss)),
      Y(.11, 1.35, [0, 0, 0], { r: [0, 0, Math.PI / 2], color: C.moss }),
      Y(.11, 1.35, [0, 0, 0], { r: [Math.PI / 2, 0, 0], color: C.moss }),
      S(.21, [0, 0, 0], color(C.ink)),
      ...[[.68, 0, 0], [-.68, 0, 0], [0, .68, 0], [0, -.68, 0], [0, 0, .68], [0, 0, -.68]].map(p => S(.17, p, color(C.sage))),
    ];
    case 'pyramid-frame': {
      const corners = [[-.84, -.96, -.84], [.84, -.96, -.84], [.84, -.96, .84], [-.84, -.96, .84]];
      const top = [0, 1.0, 0];
      return [...corners.map((p, i) => rod(p, corners[(i + 1) % 4], .045, C.ink)),
        ...corners.map(p => rod(p, top, .045, C.steel)),
        ...corners.map(p => S(.075, p, color(C.brass))), S(.10, top, color(C.brass))];
    }
    default: return null;
  }
}
