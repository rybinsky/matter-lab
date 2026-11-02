# Development

Use Node.js 24 (22.12 or later is supported) and the committed lockfile.

```sh
npm ci
npm run dev
```

For a production build:

```sh
npm run build
npm start
```

Run `npm test` before proposing a change. It checks syntax and the model, camera, montage, project-store, text and audio regressions without requiring Metal or FFmpeg. A separate macOS CI job type-checks the native renderer. Browser and visual checks are still necessary for UI, materials and camera composition: numeric tests do not establish artistic quality.

Keep new interactions parameterised. Catalogue entries and example projects may be specific; physics, camera and montage code must not force outcomes for a named demonstration. Maintain separation between collision geometry and render detail. Do not fix a shot by modifying an experiment's result.

## Model and presentation checks

New authored demonstrations should start at real-time playback. Use an explicit source clock for slow motion, acceleration, replay or a hold, and label the change. Do not stretch a short physical event to meet a target film length. Uniform playback controls must preserve source times, scene data and author text; variable clocks and freezes stay editable through camera keys.

For principal-axis rotation, test the actual compound inertia and orientation, a nonzero perturbation and both extreme-axis controls. Check spatial angular-momentum vectors as well as energy, not only their magnitudes or a stationary centre of mass. Report errors over the source interval being shown; a correct first flip does not establish accurate later periods. Spin-only motion must not be classified as an inactive comparison merely because the body's centre is stationary.

For surface motion, retain the `h'`/`h''` normal-force terms, one shared `μN` budget and the force/positive-power caps. Verify an analytic circular or angular-momentum case, work/energy accounting and timestep behaviour. Test free edges and support loss, effective body mass/world gravity, and the adapter's transition after `world.step`: restore colliders and mass properties, transfer the already advanced state once, then stop controlling it. Do not continue the point ledger across rigid impacts or add an unmodelled balance controller to make a character stand.

For visual rigs and decorations, compare physical root poses and velocities with and without the art. Internal rig helpers and `renderOnly` props must have zero colliders and must not become editable physical targets or inflate movement counts. Include all visible rig parts in framing checks; an invisible proxy's bounds do not establish that shoes or hands fit. CPU bounds and ray tests support, but do not replace, native-frame, motion and sound review.

Relevant focused checks are `verify-rotation-authoring.mjs`, `verify-scene-analysis.mjs`, `verify-surface-motion.mjs`, `verify-surface-motion-scene.mjs`, `verify-motion-rig.mjs`, `verify-surface-authoring.mjs`, `verify-surface-capture.mjs` and `verify-clip-tempo.mjs` in `scripts/`. They also run in the common test command. Capture provenance must retain effective model parameters and limitations; example-specific numeric tolerances or calibrated-material claims must not be inferred from a passing suite.

Use temporary directories or `.cache/` for diagnostics. Do not commit personal projects, tokens, media exports, runtime binaries, absolute machine paths or dependencies. Copy `.env.example` to `.env` only for local configuration; `.env` is ignored.

Source licensing has not been selected by the owner. Do not add an open-source grant or publish binaries on their behalf.
