import { DEFAULT_SETTINGS, assetParts } from './catalog.js';
import { buildLayout } from './layouts.js';

// Authored starting points, not new simulation modes. Every kit is an ordinary
// editable project: rigid bodies, saved layout recipes and normal launch edits.
export const SCENARIO_KITS = Object.freeze([
  {
    id: 'banana-avalanche', title: 'Банановый таран',
    hook: 'Мебель выдержит 60 бананов?',
    description: '60 бананов стартуют на рампе со скоростью 10 м/с. Внизу — три перегородки и два кресла. Красная полоса за ними показывает, прорвался ли поток.',
    assetPreview: ['banana', 'room-divider', 'armchair'], icon: 'banana',
    countHint: '60 бананов · старт 10 м/с', accent: '#FFD34E',
    tags: ['Массовый удар', 'Мебель', 'Лавина'], duration: 26,
    goal: 'Пробить мебельный заслон и добраться до красной полосы.',
  },
  {
    id: 'duck-relay', title: 'Уточка запускает эстафету',
    hook: 'Одна уточка. Две башни на финише.',
    description: 'Уточка толкает домино. Широкий щит передаёт движение двум цепочкам, которые заканчиваются башнями из стаканов. Все звенья можно переставлять.',
    assetPreview: ['rubber-duck', 'domino', 'cup'], icon: 'git-fork',
    countHint: '39 звеньев · 2 башни', accent: '#70DBE8',
    tags: ['Цепная реакция', 'Развилка', 'Баланс'], duration: 28,
    goal: 'Передать движение от уточки до обеих башен.',
  },
  {
    id: 'armchair-bowling', title: 'Боулинг в гостиной',
    hook: 'Пятнадцать кресел. Один шар.',
    description: 'Кресла стоят пятью рядами, как кегли. Тяжёлый шар врезается в первый ряд, а дальше предметы сталкиваются друг с другом. Меняйте массу, скорость и расстановку.',
    assetPreview: ['armchair', 'ball', 'safety-cone'], icon: 'armchair',
    countHint: '15 кресел · шар 70 кг', accent: '#F385B5',
    tags: ['Массовая конструкция', 'Импульс', 'Боулинг'], duration: 24,
    goal: 'Сдвинуть как можно больше кресел одним запуском.',
  },
]);

const radians = degrees => degrees * Math.PI / 180;
const box = (dimensions, color) => [{ shape: 'box', d: dimensions, p: [0, 0, 0], color }];
const clone = value => structuredClone(value);

function projectFor(kit, heroId, direction) {
  return {
    version: 1, name: kit.title, objects: [], edits: {},
    settings: {
      ...clone(DEFAULT_SETTINGS), experiment: 'blank', variant: 0,
      gravity: 9.81, showGrid: false, showTrails: true, autoLaunch: false,
      connections: [], emitters: [], generators: [], focusId: heroId,
      simulationDuration: 10, musicTrack: 'pulse-2', audioPreset: 'auto',
      cameraHints: { viewDirection: direction, hero: heroId, context: [], actionAxis: [0, 0, -1], lockHorizon: true },
      scenarioKit: { id: kit.id, targetIds: [], initiatorIds: [], goal: kit.goal },
      story: {
        enabled: true, title: kit.title, hook: kit.hook, question: kit.goal,
        heroId, duration: kit.duration, tempo: 'fast', camera: 'auto',
        opening: 'event', theme: 'contrast', accent: kit.accent, metric: 'moved',
        autoTrim: true, movementThreshold: .2,
        labels: { setup: kit.goal, action: 'Следим за передачей движения', result: 'Что изменилось после запуска?' },
        effects: { slowMotion: true, heroOutline: true, eventPulse: true, trail: true, reference: true },
      },
    },
  };
}

function addLayout(project, spec, source) {
  const recipe = {
    pattern: 'grid', count: [1, 1, 1], step: [1, 1, 1], origin: [0, 0, 0],
    rotation: [0, 0, 0], turn: [0, 0, 0], extent: [6, 6, 6], radius: 3,
    turns: 2, jitter: 0, angleJitter: 0, scaleJitter: 0, seed: 42,
    align: false, fixed: false, ...spec, sources: [source],
  };
  project.settings.generators.push(recipe);
  const objects = buildLayout(recipe, recipe.sources);
  project.objects.push(...objects);
  return objects.map(object => object.id);
}

function marker(project, id, position, dimensions, color, name) {
  project.objects.push({ id, name, asset: 'custom', position, parts: box(dimensions, color), fixed: true, material: 'wood' });
}

function bananaAvalanche(kit) {
  const hero = 'banana-wave-2-0';
  const project = projectFor(kit, hero, [1.2, .72, 1.55]);
  const angle = radians(23), length = 8.8, thickness = .16, centreZ = 3.2;
  const centreY = length / 2 * Math.sin(angle) - thickness / 2 * Math.cos(angle) + .06;
  const planeAt = z => centreY + Math.tan(angle) * (z - centreZ) + thickness / 2 / Math.cos(angle);
  project.objects.push({
    id: 'avalanche-ramp', name: 'Широкая рампа · 23°', asset: 'custom', fixed: true,
    position: [0, centreY, centreZ], rotation: [-angle, 0, 0], material: 'ice', friction: .08,
    parts: [
      { shape: 'box', d: [5.6, thickness, length], p: [0, 0, 0], color: '#596BA9' },
      ...[-2.76, 2.76].map(x => ({ shape: 'box', d: [.12, .46, length], p: [x, .25, 0], color: '#758BD5' })),
    ],
  });
  const bananas = addLayout(project, {
    id: 'banana-wave', name: 'Бананы · 6 × 10', count: [6, 1, 10], step: [.80, 0, .55],
    origin: [-2, planeAt(1.2) + .14, 1.2], rotation: [-23, 0, 0],
    velocity: [0, -Math.sin(angle) * 10, -Math.cos(angle) * 10], jitter: .008,
  }, {
    asset: 'banana', name: 'Банан', scale: .65, mass: .45, material: 'wood',
    friction: .16, restitution: .12, rotation: [Math.PI / 2, 0, 0], offset: [0, 0, 0],
    parts: assetParts('banana').map(part => ({ ...part, color: part.color === '#dfbd58' ? '#FFD34E' : part.color })),
  });
  const dividers = addLayout(project, {
    id: 'furniture-screen', name: 'Мебельный заслон', count: [3, 1, 1], step: [1.85, 0, 0], origin: [-1.85, .83, -1.9],
  }, { asset: 'room-divider', name: 'Перегородка', scale: .65, mass: 1.8, material: 'wood', friction: .4, restitution: .08, rotation: [0, 0, 0] });
  const chairs = addLayout(project, {
    id: 'furniture-chairs', name: 'Второй рубеж', count: [2, 1, 1], step: [2.3, 0, 0], origin: [-1.15, .58, -3.3],
  }, { asset: 'armchair', name: 'Кресло', scale: .85, mass: 4.5, material: 'wood', friction: .35, restitution: .08, rotation: [0, 0, 0] });
  marker(project, 'finish-line', [0, -.0125, -5.1], [5.8, .015, .45], '#F16C86', 'Финишная полоса');
  project.settings.simulationDuration = 10;
  project.settings.speed = 10; project.settings.mass = .45;
  project.settings.scenarioKit = { ...project.settings.scenarioKit, targetIds: [...dividers, ...chairs], initiatorIds: bananas, finishZ: -5.1 };
  project.settings.cameraHints.context = ['avalanche-ramp', ...dividers, ...chairs, 'finish-line'];
  project.settings.story.labels.action = 'Лавина встречает мебельный заслон';
  project.settings.story.labels.result = 'Удержала ли мебель поток?';
  return project;
}

function duckRelay(kit) {
  const hero = 'relay-duck', project = projectFor(kit, hero, [1.5, .95, 1.1]);
  const spine = addLayout(project, {
    id: 'relay-spine', name: 'Начало эстафеты · 14 звеньев', pattern: 'line',
    count: [14, 1, 1], step: [0, 0, -.52], origin: [0, .48, 3],
  }, { asset: 'domino', name: 'Домино · вход', scale: 1, mass: .18, material: 'ceramic', color: '#70DBE8', friction: .48, restitution: .04, rotation: [0, 0, 0] });
  project.objects.push({
    id: 'relay-splitter', name: 'Передаточный щит', asset: 'custom', material: 'wood', mass: .38,
    position: [0, .6075, -4.32], parts: box([2.4, 1.25, .14], '#F385B5'), friction: .4, restitution: .04,
  });
  const branches = [-.72, .72].flatMap((x, index) => [
    ...addLayout(project, {
      id: `relay-branch-${index}`, name: `${index ? 'Правая' : 'Левая'} ветка · 11 звеньев`, pattern: 'line',
      count: [11, 1, 1], step: [0, 0, -.52], origin: [x, .48, -4.97],
    }, { asset: 'domino', name: `Домино · ${index ? 'правая' : 'левая'} ветка`, scale: 1, mass: .18, material: 'ceramic', color: index ? '#BDA0F2' : '#F3B66B', friction: .48, restitution: .04, rotation: [0, 0, 0] }),
    ...addLayout(project, {
      id: `relay-striker-${index}`, name: `${index ? 'Правое' : 'Левое'} силовое звено`, origin: [x, .68, -10.69],
    }, { asset: 'domino', name: 'Силовое звено', scale: 1.4, mass: .8, material: 'ceramic', color: '#F385B5', friction: .48, restitution: .04, rotation: [0, 0, 0] }),
  ]);
  const cups = [-.72, .72].flatMap((x, index) => addLayout(project, {
    id: `relay-tower-${index}`, name: `${index ? 'Правая' : 'Левая'} башня`,
    count: [1, 3, 1], step: [0, .68, 0], origin: [x, .315, -11.55],
  }, { asset: 'cup', name: `Стакан · ${index ? 'правая' : 'левая'} башня`, scale: .8, mass: .12, material: 'ceramic', color: '#F6E5BF', friction: .55, restitution: .08, rotation: [0, 0, 0] }));
  project.objects.push({ id: hero, name: 'Уточка · инициатор', asset: 'rubber-duck', material: 'rubber', scale: .8, mass: 2.5, friction: .12, restitution: .12, kinematic: true, position: [0, .435, 5], rotation: [0, Math.PI, 0] });
  project.edits[hero] = { launch: { speed: 4.5, azimuth: 180, elevation: 0, delay: .45 } };
  marker(project, 'relay-start', [0, -.0125, 4.2], [1.5, .015, .15], '#70DBE8', 'Начало эстафеты');
  marker(project, 'relay-finish', [0, -.0125, -12], [3, .015, .18], '#F385B5', 'Финиш эстафеты');
  project.settings.simulationDuration = 12;
  project.settings.scenarioKit = { ...project.settings.scenarioKit, targetIds: cups, chainIds: [...spine, 'relay-splitter', ...branches], initiatorIds: [hero] };
  project.settings.cameraHints.context = [spine[0], spine.at(-1), 'relay-splitter', ...cups];
  project.settings.story.labels.action = 'Одно движение расходится на две ветки';
  project.settings.story.labels.result = 'Дошла ли эстафета до обеих башен?';
  return project;
}

function armchairBowling(kit) {
  const hero = 'bowling-ball', project = projectFor(kit, hero, [1.15, .67, 1.8]);
  marker(project, 'bowling-stage', [0, .03, -1], [9, .1, 16], '#46536D', 'Дорожка гостиной');
  const chairs = [];
  const palette = ['#69C9D8', '#7B8FE1', '#B497DE', '#D987B0', '#E6A67C'];
  for (let row = 0; row < 5; row++) chairs.push(...addLayout(project, {
    id: `bowling-row-${row}`, name: `Ряд кресел ${row + 1}`, count: [row + 1, 1, 1], step: [1.28, 0, 0], origin: [-row * .64, .72, 1.3 - row * 1.25],
  }, {
    asset: 'armchair', name: 'Кресло', scale: .9, mass: 6, material: 'wood', friction: .75, restitution: .08, rotation: [0, 0, 0],
    parts: assetParts('armchair').map(part => ({ ...part, color: ['#627e70', '#879b8b'].includes(part.color) ? palette[row] : part.color })),
  }));
  project.objects.push({ id: hero, name: 'Шар · 70 кг', asset: 'ball', material: 'metal', color: '#F385B5', mass: 70, scale: 1.65, friction: .22, restitution: .12, kinematic: true, position: [0, .915, 5.8], rotation: [0, 0, 0] });
  project.edits[hero] = { launch: { speed: 10, azimuth: 180, elevation: 0, delay: .5 } };
  marker(project, 'bowling-start', [0, .073, 4.8], [6, .014, .15], '#AAB7D0', 'Линия запуска');
  marker(project, 'bowling-finish', [0, .073, -5.5], [6, .014, .25], '#F385B5', 'Контрольная линия');
  project.settings.simulationDuration = 9;
  project.settings.mass = 70; project.settings.speed = 10;
  project.settings.scenarioKit = { ...project.settings.scenarioKit, targetIds: chairs, initiatorIds: [hero], finishZ: -5.5 };
  project.settings.cameraHints.context = [...chairs, 'bowling-finish'];
  project.settings.story.labels.action = 'Кресла передают удар следующим рядам';
  project.settings.story.labels.result = 'Сколько кресел сдвинул один шар?';
  return project;
}

const builders = { 'banana-avalanche': bananaAvalanche, 'duck-relay': duckRelay, 'armchair-bowling': armchairBowling };

/** Each call returns independent JSON data; editing a kit never changes another. */
export function createScenarioKit(id) {
  const kit = SCENARIO_KITS.find(item => item.id === id);
  if (!kit) throw new Error(`Неизвестный набор сцены: ${String(id)}`);
  const project = builders[id](kit);
  if (project.objects.length > 150) throw new Error('В наборе сцены больше 150 предметов.');
  project.settings.measurement = {
    type: 'moved', objectIds: [...project.settings.scenarioKit.targetIds], threshold: .2,
    label: id === 'duck-relay' ? 'Стаканов сдвинуто' : id === 'armchair-bowling' ? 'Кресел сдвинуто' : 'Предметов мебели сдвинуто',
  };
  return project;
}
