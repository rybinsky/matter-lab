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

Use temporary directories or `.cache/` for diagnostics. Do not commit personal projects, tokens, media exports, runtime binaries, absolute machine paths or dependencies. Copy `.env.example` to `.env` only for local configuration; `.env` is ignored.

Source licensing has not been selected by the owner. Do not add an open-source grant or publish binaries on their behalf.
