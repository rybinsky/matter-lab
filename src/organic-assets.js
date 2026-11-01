// Original, modelled-in-code CGI props. No textures, external models or licensed assets.
// Primitive dimensions: ellipsoid radii XYZ; cylinder/cone radius and full height.
// Every compound is centred on its actual bounds and uniformly sized for the editor.
const E = (d, p = [0, 0, 0], tint, r) => ({ shape: 'ellipsoid', d, p, ...(tint ? { color: tint } : {}), ...(r ? { r } : {}) });
const S = (radius, p, tint) => ({ shape: 'sphere', d: [radius], p, color: tint });
const Y = (radius, height, p, tint, r) => ({ shape: 'cylinder', d: [radius, height], p, color: tint, ...(r ? { r } : {}) });
const N = (radius, height, p, tint, r) => ({ shape: 'cone', d: [radius, height], p, color: tint, ...(r ? { r } : {}) });
const B = (d, p, tint, r) => ({ shape: 'box', d, p, color: tint, ...(r ? { r } : {}) });
const C = {
  stem: '#65513a', leaf: '#496d43', leafLight: '#698448', cream: '#e6d1a0',
  apple: '#b94c3c', appleLight: '#c95641', pear: '#adb45d', pearLight: '#bac16d',
  orange: '#d7943e', orangeLight: '#e2a04b', lemon: '#dfc45e', banana: '#dfbd58',
  berry: '#b64742', seed: '#d9bd83', darkSeed: '#3e352c',
};

function bananaParts() {
  const parts = [];
  const count = 9;
  for (let i = 0; i < count; i++) {
    const a = -1.10 + i * 2.20 / (count - 1);
    const taper = .70 + .30 * Math.cos(a * 1.15);
    parts.push(E([.108 * taper, .172, .111 * taper],
      [.49 * Math.sin(a), -.49 * Math.cos(a) + .20, 0],
      i === 0 || i === count - 1 ? '#c6a24c' : C.banana, [0, 0, a - Math.PI / 2]));
  }
  const a = -1.26;
  parts.push(E([.037, .09, .04], [.49 * Math.sin(a) - .02, -.49 * Math.cos(a) + .22, 0], C.stem, [0, 0, a + Math.PI / 2]));
  parts.push(E([.047, .045, .04], [.49 * Math.sin(1.27), -.49 * Math.cos(1.27) + .20, 0], '#77613a', [0, 0, 1.27 - Math.PI / 2]));
  return parts;
}

function strawberryParts() {
  const body = [
    E([.24, .28, .22], [0, -.05, 0], C.berry),
    E([.28, .14, .24], [0, .12, 0], '#c34d42'),
    E([.10, .13, .10], [0, -.26, 0], C.berry),
  ];
  const leaves = Array.from({ length: 5 }, (_, i) => {
    const a = i * Math.PI * 2 / 5;
    return E([.15, .018, .048], [.105 * Math.cos(a), .262, .105 * Math.sin(a)],
      i % 2 ? C.leaf : C.leafLight, [0, -a, .12]);
  });
  const seeds = [[-.11, .12], [.11, .12], [-.10, -.03], [.10, -.03], [-.045, -.18], [.045, -.18]].map(([x, y]) => {
    let z = 0;
    for (const part of body) {
      const t = 1 - (x / part.d[0]) ** 2 - ((y - part.p[1]) / part.d[1]) ** 2;
      if (t > 0) z = Math.max(z, part.d[2] * Math.sqrt(t));
    }
    return E([.009, .018, .008], [x, y, z + .003], C.seed, [0, 0, x * -.6]);
  });
  return [...body, ...leaves, Y(.018, .11, [0, .315, 0], C.stem, [0, 0, -.16]), ...seeds];
}

function watermelonParts() {
  const parts = [
    E([.50, .43, .16], [0, 0, 0], '#3f6849'),
    E([.474, .404, .145], [0, 0, .04], '#c0c58a'),
    E([.440, .370, .13], [0, 0, .074], '#cd6c5c'),
  ];
  for (let i = 0; i < 8; i++) {
    const a = .23 + i * Math.PI * 2 / 8;
    const x = .28 * Math.cos(a), y = .23 * Math.sin(a);
    const z = .074 + .13 * Math.sqrt(1 - (x / .44) ** 2 - (y / .37) ** 2) + .004;
    parts.push(E([.014, .027, .009], [x, y, z], C.darkSeed, [0, 0, a - Math.PI / 2]));
  }
  parts.push(Y(.018, .12, [-.49, .055, -.015], '#5f6940', [0, 0, Math.PI / 2]));
  return parts;
}

function pineappleParts() {
  const body = E([.30, .39, .30], [0, -.10, 0], '#b99a4d');
  const leaves = Array.from({ length: 7 }, (_, i) => {
    const a = i * Math.PI * 2 / 7;
    return E([.037, .235, .058], [.10 * Math.cos(a), .435, .10 * Math.sin(a)],
      i % 2 ? '#557443' : '#6f884d', [-Math.sin(a) * .48, 0, Math.cos(a) * .48]);
  });
  const eyes = [-.25, -.05, .15].flatMap(y => [-.10, .10].map(x => {
    const z = .30 * Math.sqrt(Math.max(0, 1 - (x / .3) ** 2 - ((y + .1) / .39) ** 2));
    return E([.038, .040, .017], [x, y, z + .004], '#d1ac5c', [0, 0, Math.PI / 4]);
  }));
  return [body, ...leaves, ...eyes];
}

function pumpkinParts() {
  return [
    E([.25, .28, .25], [0, -.025, 0], '#bd8043'),
    ...Array.from({ length: 7 }, (_, i) => {
      const a = i * Math.PI * 2 / 7;
      return E([.17, .30, .17], [.20 * Math.sin(a), -.025, .20 * Math.cos(a)],
        i % 2 ? '#cb8a49' : '#d59650');
    }),
    Y(.045, .18, [.015, .345, 0], '#6b6441', [0, 0, -.12]),
    E([.14, .018, .06], [.12, .36, .015], C.leaf, [.12, .15, -.20]),
  ];
}

function croissantParts() {
  return Array.from({ length: 9 }, (_, i) => {
    const a = -1.27 + i * 2.54 / 8;
    const fullness = .42 + .58 * Math.cos(a * 1.1);
    return E([.145 * fullness, .142, .165 * fullness],
      [.36 * Math.sin(a), -.36 * Math.cos(a) + .14, 0],
      i % 2 ? '#cb9658' : '#bd864c', [0, 0, a - Math.PI / 2]);
  });
}

const DEFINITIONS = [
  {
    id: 'apple', name: 'Красное яблоко', category: 'Фрукты', mat: 'wood', maxSize: 1.0,
    parts: [
      E([.385, .365, .35], [0, -.035, 0], C.apple),
      E([.235, .22, .32], [-.14, .17, 0], C.appleLight),
      E([.235, .22, .32], [.14, .17, 0], C.apple),
      Y(.024, .18, [0, .43, 0], C.stem, [0, 0, -.14]),
      E([.15, .018, .06], [.115, .49, .015], C.leaf, [.10, -.10, -.35]),
      E([.035, .012, .035], [0, -.394, 0], '#715142'),
    ],
  },
  {
    id: 'banana', name: 'Банан', category: 'Фрукты', mat: 'wood', maxSize: 1.15,
    parts: bananaParts(),
  },
  {
    id: 'pear', name: 'Зелёная груша', category: 'Фрукты', mat: 'wood', maxSize: 1.10,
    parts: [
      E([.325, .335, .30], [0, -.17, 0], C.pear),
      E([.185, .32, .18], [0, .20, 0], C.pearLight),
      E([.235, .22, .225], [0, .035, 0], C.pear),
      Y(.022, .15, [.015, .55, 0], C.stem, [0, 0, -.16]),
      E([.13, .017, .052], [.12, .595, 0], C.leaf, [.1, 0, -.32]),
      E([.025, .01, .025], [0, -.5, 0], '#79683c'),
    ],
  },
  {
    id: 'orange-fruit', name: 'Апельсин', category: 'Фрукты', mat: 'wood', maxSize: .9,
    parts: [
      E([.39, .365, .39], [0, 0, 0], C.orange),
      E([.053, .012, .053], [0, .363, 0], '#7d743c'),
      Y(.018, .065, [0, .389, 0], C.stem, [0, 0, -.12]),
      E([.14, .018, .052], [.13, .397, .015], C.leaf, [.15, -.1, -.20]),
      E([.029, .010, .029], [0, -.361, 0], '#ac7838'),
    ],
  },
  {
    id: 'lemon', name: 'Лимон', category: 'Фрукты', mat: 'wood', maxSize: 1.0,
    parts: [
      E([.40, .27, .27], [0, 0, 0], C.lemon),
      E([.105, .115, .115], [-.35, 0, 0], '#d2b650'),
      E([.105, .115, .115], [.35, 0, 0], C.lemon),
      E([.014, .03, .03], [-.452, 0, 0], '#817240'),
      Y(.018, .09, [-.34, .15, 0], C.stem, [0, 0, -.8]),
      E([.125, .017, .05], [-.245, .255, .005], C.leaf, [.10, 0, .25]),
    ],
  },
  {
    id: 'watermelon-half', name: 'Арбузная половинка', category: 'Фрукты', mat: 'wood', maxSize: 1.2,
    parts: watermelonParts(),
  },
  {
    id: 'strawberry', name: 'Клубника', category: 'Фрукты', mat: 'wood', maxSize: .82,
    parts: strawberryParts(),
  },
  {
    id: 'carrot', name: 'Морковь с ботвой', category: 'Предметы', mat: 'wood', maxSize: 1.2,
    parts: [
      N(.16, .8, [0, -.05, 0], '#cf8546', [0, 0, Math.PI]),
      E([.16, .095, .15], [0, .31, 0], '#d9954e'),
      E([.035, .075, .035], [0, -.45, 0], '#c67b40'),
      E([.035, .215, .045], [-.075, .54, 0], C.leaf, [0, .1, -.46]),
      E([.035, .235, .045], [.025, .57, 0], C.leafLight, [.12, 0, .12]),
      E([.035, .20, .045], [.10, .53, -.005], C.leaf, [-.10, 0, .52]),
      E([.035, .18, .045], [0, .51, .065], '#77914e', [.45, 0, -.1]),
    ],
  },
  {
    id: 'mushroom', name: 'Лесной гриб', category: 'Предметы', mat: 'wood', maxSize: .95,
    parts: [
      Y(.108, .55, [0, -.17, 0], '#ded3b5', [0, 0, -.07]),
      E([.14, .07, .14], [0, -.44, 0], '#d4c7a7'),
      E([.4, .18, .4], [0, .23, 0], '#927053'),
      E([.28, .07, .28], [0, .347, 0], '#a07b58'),
      E([.155, .033, .155], [0, -.035, 0], '#e4d9bd'),
      E([.035, .012, .045], [-.17, .37, .10], '#c0a37e'),
      E([.028, .012, .037], [.12, .36, .18], '#b99b77'),
    ],
  },
  {
    id: 'avocado-half', name: 'Половинка авокадо', category: 'Фрукты', mat: 'wood', maxSize: 1.05,
    parts: [
      E([.30, .31, .145], [0, -.12, 0], '#435d39'),
      E([.205, .30, .13], [0, .19, 0], '#435d39'),
      E([.275, .285, .125], [0, -.12, .035], '#9ead60'),
      E([.180, .27, .11], [0, .19, .03], '#a9b66a'),
      E([.24, .25, .10], [0, -.12, .075], '#d0ca83'),
      E([.153, .235, .09], [0, .19, .06], '#cfce8a'),
      S(.137, [0, -.10, .15], '#916044'),
      Y(.022, .09, [.015, .49, 0], C.stem, [0, 0, -.2]),
    ],
  },
  {
    id: 'bread-loaf', name: 'Ремесленный хлеб', category: 'Предметы', mat: 'wood', maxSize: 1.15,
    parts: [
      E([.46, .27, .26], [0, -.015, 0], '#b9834b'),
      B([.71, .065, .385], [0, -.235, 0], '#a16e3e'),
      E([.36, .075, .22], [0, .185, 0], '#cb985a'),
      ...[-.27, -.09, .09, .27].map(x => E([.020, .015, .16],
        [x, -.015 + .27 * Math.sqrt(1 - (x / .46) ** 2), 0], '#e6ca91', [0, -.28, 0])),
    ],
  },
  {
    id: 'rubber-duck', name: 'Игрушечная уточка', category: 'Предметы', mat: 'rubber', maxSize: 1.12,
    parts: [
      E([.37, .25, .43], [0, -.15, -.045], '#dfba50'),
      E([.16, .23, .16], [0, .13, .14], '#e6c55d'),
      E([.235, .23, .23], [0, .35, .22], '#e6c55d'),
      E([.19, .055, .12], [0, .30, .46], '#c88043'),
      ...[-.15, .15].map(x => S(.027, [x, .4, .393], '#303a35')),
      ...[-.15, .15].map(x => S(.008, [x - .006, .410, .414], '#f0e7d0')),
      ...[-1, 1].map(side => E([.065, .155, .235], [side * .315, -.105, -.06], '#d2a848', [0, 0, side * .15])),
      N(.11, .25, [0, -.055, -.46], '#d7b34c', [-Math.PI / 2, 0, 0]),
    ],
  },
  {
    id: 'cherries', name: 'Вишни на веточке', category: 'Фрукты', mat: 'wood', maxSize: 1.0,
    parts: [
      S(.22, [-.18, -.15, .04], '#a7443e'), S(.215, [.20, -.11, -.04], '#913e3a'),
      Y(.014, .425, [-.09, .23, .02], '#75824c', [0, 0, -.442]),
      Y(.014, .377, [.10, .26, -.02], '#6b7845', [0, 0, .559]),
      Y(.018, .12, [0, .47, 0], C.stem, [0, 0, -.1]),
      E([.14, .017, .06], [.12, .48, 0], C.leaf, [.12, -.1, -.25]),
      E([.105, .014, .045], [-.08, .52, -.015], C.leafLight, [0, .2, .4]),
    ],
  },
  {
    id: 'pineapple', name: 'Ананас', category: 'Фрукты', mat: 'wood', maxSize: 1.2,
    parts: pineappleParts(),
  },
  {
    id: 'pumpkin', name: 'Ребристая тыква', category: 'Предметы', mat: 'wood', maxSize: 1.0,
    parts: pumpkinParts(),
  },
  {
    id: 'croissant', name: 'Круассан', category: 'Предметы', mat: 'wood', maxSize: 1.0,
    parts: croissantParts(),
  },
];

function rotationRows(r = [0, 0, 0]) {
  const [x, y, z] = r;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  return [[c * e, -c * f, d], [b * d * e + a * f, -b * d * f + a * e, -b * c], [-a * d * e + b * f, a * d * f + b * e, a * c]];
}

function partBounds(part) {
  const rows = rotationRows(part.r);
  const lo = [], hi = [];
  for (let axis = 0; axis < 3; axis++) {
    const row = rows[axis], origin = part.p[axis];
    let extent;
    if (part.shape === 'ellipsoid' || part.shape === 'sphere') {
      const radii = part.shape === 'sphere' ? [part.d[0], part.d[0], part.d[0]] : part.d;
      extent = Math.sqrt(row.reduce((sum, v, j) => sum + (v * radii[j]) ** 2, 0));
    } else if (part.shape === 'box') {
      extent = row.reduce((sum, v, j) => sum + Math.abs(v) * part.d[j] / 2, 0);
    } else if (part.shape === 'cylinder') {
      extent = Math.abs(row[1]) * part.d[1] / 2 + Math.hypot(row[0], row[2]) * part.d[0];
    } else if (part.shape === 'cone') {
      const baseCenter = origin - row[1] * part.d[1] / 2;
      const baseExtent = Math.hypot(row[0], row[2]) * part.d[0];
      const apex = origin + row[1] * part.d[1] / 2;
      lo[axis] = Math.min(baseCenter - baseExtent, apex);
      hi[axis] = Math.max(baseCenter + baseExtent, apex);
      continue;
    } else throw new Error(`Unsupported organic primitive: ${part.shape}`);
    lo[axis] = origin - extent; hi[axis] = origin + extent;
  }
  return { lo, hi };
}

function prepare(definition) {
  const bounds = definition.parts.map(partBounds);
  const lo = [0, 1, 2].map(i => Math.min(...bounds.map(b => b.lo[i])));
  const hi = [0, 1, 2].map(i => Math.max(...bounds.map(b => b.hi[i])));
  const size = hi.map((v, i) => v - lo[i]);
  const scale = definition.maxSize / Math.max(...size);
  const centre = lo.map((v, i) => (v + hi[i]) / 2);
  const parts = definition.parts.map(part => ({
    ...part,
    d: part.d.map(v => v * scale),
    p: part.p.map((v, i) => (v - centre[i]) * scale),
  }));
  return {
    item: { id: definition.id, name: definition.name, category: definition.category, mat: definition.mat, size: size.map(v => v * scale) },
    parts,
  };
}

const ASSETS = DEFINITIONS.map(prepare);
const PARTS = new Map(ASSETS.map(a => [a.item.id, a.parts]));

export const ORGANIC_CATALOG = ASSETS.map(a => a.item);

export function organicParts(id) {
  const parts = PARTS.get(id);
  return parts ? parts.map(p => ({ ...p, d: [...p.d], p: [...p.p], ...(p.r ? { r: [...p.r] } : {}) })) : null;
}
