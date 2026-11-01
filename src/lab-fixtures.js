// Appearance only. These parts must never be supplied to collider generation.
// Inspired by universal testing frames and machined compression fixtures;
// this is an unbranded studio machine, not a calibrated instrument replica.
const COLORS = {
  shell: '#B7BEBA', edge: '#D1D6D1', graphite: '#354149', recess: '#202B31',
  steel: '#A7B4B7', polished: '#C9D0CD', darkSteel: '#59686D', rubber: '#2A3033',
  engraving: '#697A7E', indicator: '#ABAD88', stop: '#934D3C',
};
const FINISHES = {
  powder: { roughness: .65, metalness: .08 },
  brushed: { roughness: .29, metalness: .83 },
  polished: { roughness: .22, metalness: .88 },
  dark: { roughness: .46, metalness: .65 },
  rubber: { roughness: .86, metalness: 0 },
};
const part = (shape, d, p, color = COLORS.steel, finish = 'brushed', r) => ({
  shape, d, p, color, finish, ...FINISHES[finish], ...(r ? { r } : {}),
});
const box = (d, p, color, finish) => part('box', d, p, color, finish);
const cylinder = (radius, height, p, color, finish, r) => part('cylinder', [radius, height], p, color, finish, r);
const ring = (radius, tube, p, color = COLORS.engraving) => part('torus', [radius, tube], p, color, 'dark');

function socket(parts, p, { radius = .028, front = false, finish = 'dark' } = {}) {
  const rotation = front ? [Math.PI / 2, 0, 0] : undefined;
  parts.push(cylinder(radius * 1.35, .009, p, COLORS.darkSteel, 'brushed', rotation));
  const outward = front ? [0, 0, .007] : [0, .007, 0];
  const face = p.map((value, axis) => value + outward[axis]);
  parts.push(cylinder(radius, .014, face, COLORS.steel, finish, rotation));
  const inset = face.map((value, axis) => value + outward[axis] * 1.12);
  parts.push(cylinder(radius * .44, .002, inset, COLORS.recess, 'dark', rotation));
}

function tableParts() {
  const parts = [
    box([3.97, .185, 3.32], [0, -.0125, 0], COLORS.graphite, 'powder'),
    box([3.91, .05, 3.27], [0, .105, 0], COLORS.shell, 'powder'),
    box([3.99, .035, 3.35], [0, -.105, 0], COLORS.recess, 'powder'),
    box([2.54, .025, 2.54], [0, .1375, 0], COLORS.polished, 'brushed'),
    box([2.44, .009, 2.44], [0, .146, 0], '#BFC8C6', 'brushed'),
    box([3.55, .084, .018], [0, -.005, 1.672], COLORS.recess, 'powder'),
    box([1.52, .05, .02], [-.78, -.004, 1.685], COLORS.graphite, 'powder'),
    box([.32, .057, .025], [1.14, -.002, 1.689], '#536568', 'rubber'),
    box([.21, .032, .006], [1.14, .003, 1.704], '#A4B8B2', 'powder'),
    cylinder(.028, .016, [1.53, -.002, 1.702], COLORS.stop, 'rubber', [Math.PI / 2, 0, 0]),
  ];
  // Etched centering rings sit on the unchanged y=.31 contact plane.
  for (const radius of [1.04, 1.135]) parts.push(ring(radius, .0024, [0, .1512, 0]));
  for (const x of [-1.73, 1.73]) for (const z of [-1.37, 1.37]) {
    parts.push(cylinder(.12, .044, [x, -.124, z], COLORS.rubber, 'rubber'));
    socket(parts, [x, .132, z], { radius: .025 });
  }
  for (const x of [-1.69, 1.69]) socket(parts, [x, -.003, 1.688], { radius: .018, front: true });
  // Small front-face vents and panel seams, deliberately away from the test.
  for (let index = 0; index < 10; index++) parts.push(box([.006, .034, .005], [-1.38 + index * .075, -.004, 1.699], '#73817F', 'dark'));
  for (const x of [-1.91, 1.91]) parts.push(box([.013, .122, 2.8], [x, -.007, 0], COLORS.recess, 'powder'));
  return parts;
}

function pressParts() {
  const parts = [
    // The layered edge is a restrained bevel; both contact faces remain at
    // +/- .12, matching the original 2.5 x .24 x 2.5 collider exactly.
    box([2.5, .16, 2.5], [0, 0, 0], COLORS.steel, 'brushed'),
    box([2.43, .039, 2.43], [0, .1005, 0], COLORS.polished, 'brushed'),
    box([2.43, .039, 2.43], [0, -.1005, 0], '#C5CECC', 'brushed'),
    box([2.49, .012, .012], [0, -.015, 1.25], COLORS.darkSteel, 'dark'),
    box([.012, .012, 2.49], [1.25, -.015, 0], COLORS.darkSteel, 'dark'),
    cylinder(.31, .052, [0, .145, 0], COLORS.darkSteel, 'brushed'),
    cylinder(.235, .135, [0, .225, 0], COLORS.polished, 'brushed'),
    cylinder(.16, .068, [0, .322, 0], COLORS.recess, 'dark'),
    // A long moving rod telescopes inside the fixed barrel, including the
    // full existing 1.55 m stroke. No decorative part drives the solver.
    cylinder(.112, 1.66, [0, .995, 0], COLORS.polished, 'polished'),
    ring(.117, .007, [0, .39, 0], COLORS.darkSteel),
    box([3.64, .245, .32], [0, .15, -1.17], COLORS.graphite, 'powder'),
    box([3.47, .075, .022], [0, .15, -.998], COLORS.shell, 'powder'),
  ];
  for (const x of [-.65, .65]) for (const z of [-.65, .65]) socket(parts, [x, .126, z], { radius: .032 });
  for (const x of [-1.65, 1.65]) {
    parts.push(box([.43, .42, .46], [x, .15, -1.2], COLORS.shell, 'powder'));
    parts.push(box([.27, .24, .021], [x, .15, -.957], COLORS.darkSteel, 'brushed'));
    for (const dx of [-.115, .115]) socket(parts, [x + dx, .15, -.94], { radius: .02, front: true });
  }
  for (const x of [-.13, .13]) socket(parts, [x, .302, 0], { radius: .017 });
  return parts;
}

function guideParts(side) {
  const parts = [
    box([.335, 3.51, .36], [0, -.025, -.016], COLORS.shell, 'powder'),
    box([.115, 3.39, .02], [0, -.015, .174], COLORS.recess, 'powder'),
    box([.04, 3.39, .012], [-.113, -.015, .179], COLORS.darkSteel, 'brushed'),
    box([.04, 3.39, .012], [.113, -.015, .179], COLORS.darkSteel, 'brushed'),
    cylinder(.022, 3.37, [-.073, -.015, .207], COLORS.polished, 'polished'),
    cylinder(.022, 3.37, [.073, -.015, .207], COLORS.polished, 'polished'),
    box([.41, .13, .43], [0, -1.72, -.005], COLORS.graphite, 'powder'),
    box([.41, .11, .43], [0, 1.745, -.005], COLORS.graphite, 'powder'),
    box([.027, 2.97, .01], [-side * .136, -.025, .197], '#D2D6D0', 'brushed'),
    box([.012, 3.3, .023], [side * .176, -.01, .09], COLORS.recess, 'dark'),
    box([.012, 3.3, .023], [side * .176, -.01, -.095], COLORS.recess, 'dark'),
  ];
  for (const y of [-1.72, 1.745]) for (const x of [-.12, .12]) socket(parts, [x, y, .218], { radius: .02, front: true });
  for (let index = 0; index <= 30; index++) {
    const long = index % 5 === 0;
    parts.push(box([long ? .035 : .019, long ? .007 : .004, .003], [-side * .133, -1.38 + index * .09, .204], COLORS.engraving, 'dark'));
  }
  // Recessed slot on the outer extrusion face and unobtrusive end fasteners.
  for (const y of [-1.51, 1.52]) parts.push(box([.012, .09, .10], [side * .178, y, -.02], COLORS.darkSteel, 'dark'));
  return parts;
}

function beamParts() {
  const parts = [
    box([3.68, .325, .49], [0, -.004, 0], COLORS.shell, 'powder'),
    box([3.47, .115, .022], [0, -.016, .257], COLORS.graphite, 'powder'),
    box([3.62, .036, .47], [0, .171, 0], COLORS.edge, 'powder'),
    box([.73, .29, 1.57], [0, .016, .59], COLORS.graphite, 'powder'),
    box([.63, .039, 1.51], [0, .178, .59], COLORS.shell, 'powder'),
    cylinder(.237, 1.48, [0, -.315, 1.2], COLORS.graphite, 'powder'),
    cylinder(.26, .105, [0, .4775, 1.2], COLORS.darkSteel, 'brushed'),
    cylinder(.219, .06, [0, .56, 1.2], COLORS.shell, 'powder'),
    cylinder(.193, .19, [0, -1.15, 1.2], COLORS.steel, 'brushed'),
    cylinder(.205, .055, [0, -1.2725, 1.2], COLORS.recess, 'dark'),
    cylinder(.157, .038, [0, -1.319, 1.2], COLORS.darkSteel, 'brushed'),
    ring(.238, .008, [0, -.94, 1.2], COLORS.darkSteel),
    box([.21, .052, .012], [.98, -.015, .274], COLORS.indicator, 'powder'),
  ];
  for (const x of [-1.5, -1.23, 1.23, 1.5]) socket(parts, [x, -.009, .274], { radius: .027, front: true });
  for (const x of [-.29, .29]) for (const z of [.1, 1.1]) socket(parts, [x, .205, z], { radius: .026 });
  for (let index = 0; index < 9; index++) parts.push(box([.24, .012, .016], [0, .35 - index * .105, 1.44], '#5C6A70', 'dark'));
  return parts;
}

/** Coordinates are local to the existing table/press/guide/beam bodies. */
export function compressionFixtureParts(role, { side = 1 } = {}) {
  const result = role === 'table' ? tableParts() : role === 'press' ? pressParts()
    : role === 'guide' ? guideParts(side < 0 ? -1 : 1) : role === 'beam' ? beamParts() : null;
  if (!result) throw new Error(`Неизвестная деталь испытательной машины: ${role}`);
  return result;
}

/** Appearance overrides, independent of SoftBodyMaterial and solver presets. */
export function specimenAppearance(material) {
  const appearances = {
    jelly: { color: '#3F7D7A', roughness: .31, metalness: 0, clearcoat: .12 },
    clay: { color: '#B56D52', roughness: .72, metalness: 0, clearcoat: .015 },
    foam: { color: '#C9C0A7', roughness: .88, metalness: 0, clearcoat: 0 },
  };
  return appearances[material] ? { ...appearances[material] } : null;
}
