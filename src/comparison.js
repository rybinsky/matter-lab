import { buildLayout } from './layouts.js';
import { DEFAULT_SETTINGS } from './catalog.js';

/** Scene-independent comparison metadata. No physics or playback is changed here. */
export const COMPARISON_FIELDS = [
  { id: 'speed', name: 'Начальная скорость', unit: 'м/с', min: 0, max: 3000, step: .25, defaults: [3, 6, 10, 15], hint: 'Направление броска сохраняется. Меняется только величина скорости.' },
  { id: 'mass', name: 'Масса предмета', unit: 'кг', min: .01, max: 10000, step: .01, defaults: [.5, 2, 8, 20], hint: 'Форма, материал и начальная скорость предмета остаются прежними.' },
  { id: 'material', name: 'Материал предмета', unit: '', defaults: ['wood', 'rubber', 'metal', 'cork'], hint: 'Пресет контакта: трение и отскок. Масса предмета сохраняется.' },
  { id: 'gravity', name: 'Гравитация мира', unit: 'м/с²', min: 0, max: 100, step: .01, defaults: [0, 1.62, 3.71, 9.81], hint: 'Одинаковое ускорение действует на весь мир. Остальные условия повторяются.' },
  { id: 'elevation', name: 'Угол броска вверх', unit: '°', min: -90, max: 90, step: 1, defaults: [0, 15, 30, 60], hint: 'Скорость и азимут сохраняются. Меняется угол к горизонту.' },
];
export const COMPARISON_MATERIALS = [
  { id: 'wood', name: 'Дерево' }, { id: 'rubber', name: 'Резина' },
  { id: 'metal', name: 'Сталь' }, { id: 'cork', name: 'Пробка' },
  { id: 'ceramic', name: 'Керамика' }, { id: 'ice', name: 'Скользкий лёд' },
];

const clean = (value, max = 64) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const number = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  if (typeof value === 'string' && !value.trim()) return NaN;
  return Number(typeof value === 'string' ? value.trim().replace(',', '.') : value);
};
const fieldById = id => COMPARISON_FIELDS.find(f => f.id === id) || COMPARISON_FIELDS[0];
const displayValue = (field, value) => field.id === 'material'
  ? COMPARISON_MATERIALS.find(m => m.id === value)?.name || String(value)
  : `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}${field.unit === '°' ? '' : ' '}${field.unit}`;

/** Always returns four finite, bounded values. Does not mutate its input. */
export function normalizeComparison(input = {}) {
  const spec = input && typeof input === 'object' ? input : {};
  const field = fieldById(spec.field || spec.parameter);
  const values = Array.from({ length: 4 }, (_, i) => {
    const candidate = spec.values?.[i];
    if (field.id === 'material') return COMPARISON_MATERIALS.some(m => m.id === candidate) ? candidate : field.defaults[i];
    const n = number(candidate);
    return Number.isFinite(n) ? clamp(n, field.min, field.max) : field.defaults[i];
  });
  return {
    version: 1, enabled: spec.enabled === true, field: field.id,
    targetId: clean(spec.targetId || spec.heroId, 160), values,
    labels: Array.from({ length: 4 }, (_, i) => clean(spec.labels?.[i])),
  };
}

/** The caller owns resetting the scene and applying field/value to its target. */
export function comparisonVariants(input = {}) {
  const spec = normalizeComparison(input);
  if (!spec.enabled) return [];
  const field = fieldById(spec.field);
  return spec.values.map((value, i) => ({
    label: spec.labels[i] || displayValue(field, value),
    detail: `${field.name}: ${displayValue(field, value)} · остальные условия одинаковые`,
    field: spec.field, value, targetId: spec.targetId,
  }));
}

/** A fully authored free scene built with the same reusable layout as the UI. */
export function createComparisonDemo() {
  const generator = {
    id: 'comparison-crate-wall', name: 'Стена · 36 ящиков', pattern: 'grid',
    count: [6, 6, 1], step: [1.04, 1, 1], origin: [-2.6, .48, -1],
    rotation: [0, 0, 0], turn: [0, 0, 0], extent: [6, 6, 1], radius: 3,
    turns: 2, jitter: 0, angleJitter: 0, scaleJitter: 0, seed: 42,
    align: false, fixed: false, velocity: [0, 0, 0],
    sources: [{ asset: 'crate', name: 'Деревянный ящик', material: 'wood', scale: 1, mass: 1.2, rotation: [0, 0, 0], offset: [0, 0, 0] }],
  };
  const heroId = 'comparison-hero-ball';
  return {
    version: 1, name: 'Одна стена. Четыре скорости.', edits: {},
    settings: {
      ...DEFAULT_SETTINGS, experiment: 'blank', variant: 0, connections: [], emitters: [],
      focusId: heroId, autoLaunch: true, speed: 3, azimuth: 180, elevation: 0,
      gravity: 9.81, generators: [generator],
      comparison: normalizeComparison({ enabled: true, field: 'speed', targetId: heroId,values:[3,6,15,20] }),
      story: {
        enabled: true, title: 'Сколько ящиков сдвинет шар?', hook: 'Одна стена. Четыре скорости.',
        question: 'Меняем только скорость шара', takeaway: '', heroId, duration: 60,
        metric: 'moved', theme: 'contrast', accent: '#D8FF5F', camera: 'auto', tempo: 'fast', opening: 'event',
        labels: { setup: '36 ящиков. Один стальной шар.', action: 'Смотрим на движение стены', result: 'Сколько ящиков сдвинулось?' },
        effects: { slowMotion: true, heroOutline: true, eventPulse: true, trail: true, reference: true },
      },
    },
    objects: [
      ...buildLayout(generator, generator.sources),
      { id: heroId, name: 'Стальной шар', asset: 'ball', material: 'metal', color: '#B4C7C9', scale: 1.05, mass: 12, position: [0, .55, 3.7], rotation: [0, 0, 0], velocity: [0, 0, 0], fixed: false },
    ],
  };
}
