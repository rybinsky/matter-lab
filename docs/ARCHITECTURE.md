# Architecture

Matter Lab is a local authoring application. It does not require a generative-video service.

## Boundaries

- `src/catalog.js`, `household-assets.js`: reusable geometry and material defaults. Catalogue models are passive rigid props unless a specialised solver is explicitly used.
- `src/physics.js`: the Rapier world, contacts, joints, launch actions and the shared application of saved object edits. The atmosphere, deformable assets, breakable assemblies and axial penetration modules have explicit integration points; no film-specific outcome belongs in the solver. `phenomena.js` contains separate central-gravity and heat-balance models.
- `src/atmosphere.js`: opt-in uniform-gas buoyancy and relative-air quadratic drag for declared rigid volumes. `deformable-assets.js` builds FEM bodies from supported closed skins. `breakable-assemblies.js` manages physical bonds with an approximate contact-graph load criterion. `penetration.js` owns the one-dimensional material model; `penetration-scene.js` adapts it to authored scene bodies and the cutaway rendering.
- `src/visuals.js`: the interactive Three.js scene. `lab-fixtures.js` supplies optional visual detail. `parts` define collisions; `visualParts` may supply a more detailed rendering without changing dynamics.
- `src/camera-rig.js`: independent movie and simulation clocks. Recorded/keyframe camera routes can pause simulation, move around it, or replay a moment. Per-key attention references one body or a group independently of the coordinate anchor. Baked attention recipes retain target weights through trim, split and repeated edits.
- `src/film.js`, `film-editing.js`: independent scene clips, retiming, trimming and splitting. A film cannot contain nested films.
- `src/storyboard.js`, `timed-captions.js`: authored text and numeric observations. Text cues use the clip's movie clock; adding or removing text does not change the physics or camera. `measurement-readouts.js` exposes available physical-time, temperature, penetration-depth and model-speed observations. Text substitution reads those observations and does not infer a scientific conclusion.
- `src/graphics-style.js`, `caption-layout.js`: shared presentation tokens and text layout for live, rehearsal and native output. Studio, poster and technical presets control typography, placement, tone and backdrop, not simulated state. Captured frames carry the resolved graphics tokens to the renderer.
- `src/scene-annotations.js`, `scene-annotation-editor.js`: validated author-owned spatial labels. A label has a world position or resolves an object anchor plus an offset; a missing anchor omits the label. Capture and playback consume the same resolved world data.
- `scripts/capture.mjs`, `capture-film.mjs`: deterministic simulation snapshots and assembly of camera, geometry, measurements and editorial metadata.
- `scripts/render-native.swift`: SceneKit/Metal frame rendering. It consumes captured geometry and poses; it does not resimulate outcomes.
- `scripts/soundtrack.mjs`: procedural original music and sparse contact cues. FFmpeg creates the MP4/AAC delivery.
- `export-queue.mjs`, `export-job-journal.mjs`: immutable queued project snapshots, FIFO execution, durable export metadata and explicit interrupted state. Web and render worker use the same queue.
- `src/project-templates.js`: manifest-driven saved projects and their poster images, using the same import and editing path as authored projects. The manifest resolves bundled same-origin `/projects/` resources. The gallery in `main.js` presents export status, portrait previews, downloads and reopening of saved export projects; it does not generate substitute footage for missing media.
- `src/connection-editor.js`, `connection-authoring.js`: independent draft editing and compilation of authored joint data. A rope is a unilateral maximum-distance constraint with local anchors, distinct from a spring's rest length. `connection-visuals.js` renders optional connections without changing constraints.
- `src/interaction-editor.js`, `interaction-authoring.js`: independent drafts for deformation, penetration, breakable bonds and atmosphere. The compiler clones project data, and the host validates a new world before replacing the current scene. `layouts.js` repeats and scales objects and connected assemblies rather than baking outcomes into trajectories.
- `project-store.mjs`: atomic local JSON project storage with prior versions retained in history.
- `server.mjs`: same-origin local API, media and UI. `scripts/render-worker.mjs` provides the authenticated Mac renderer endpoint for the container distribution.

## Scene data

A project contains `version`, `settings`, `objects`, `edits`, and optionally `film`. Values are validated before import, persistence and rendering. A film stores up to 48 ordinary projects and a total movie duration of 180 seconds. A scene currently permits 150 added objects; specialised prepared scenes may also contain their own bodies. The limit is a practical budget, not a claim that an arbitrary physical process can be solved.

Physics snapshots use a fixed 120 Hz solver. Sampling rates divide that clock; interpolated poses use shortest-path quaternion rotation. Discrete observations remain discrete. Camera trimming bakes the original route at its delivery FPS so Hermite tangents and cuts do not silently change.

Scene geometry, model parameters and presentation are separate inputs. Rigid-body `parts` determine collisions while `visualParts` may add render-only detail. A deformable closed skin is an input to the FEM volume mesh and therefore is physical geometry. Materials provide defaults, not an implicit combination of every available solver. An ordinary rigid prop does not acquire melting, gas contents, fracture or an engine from its catalogue name.

## Physical model domains

### Uniform atmosphere

`settings.atmosphere` enables a constant-density gas and an optional uniform wind. A rigid object's `buoyancy` declares displaced volume, local displacement centre, drag coefficient and reference area. Volume, area and centre use SI units after object scaling; the author supplies the actual total object mass, including gas and envelope when applicable. Neither a material nor a volume field silently changes that mass. Assembly scaling propagates volume by the cube, area by the square and anchors, centres and rope lengths linearly.

The module applies Archimedes' force `F = −ρVg` at the declared centre, so an offset can produce torque. Only its own temporary forces and torques are removed after the rigid solver step; external forces are preserved. Relative-air quadratic drag uses symmetric energy-stable half impulses. An eligible body uses one atmosphere aerodynamic route rather than receiving both that drag and the legacy wind force. When an atmosphere wind vector is omitted, it inherits the existing wind-speed setting; an explicit zero vector means still air.

This is a rigid, constant-volume, uniform-gas model. It does not solve liquid submergence, pressure-dependent envelope expansion, leaks, altitude stratification, wake shielding, turbulence or wing lift. Density and drag coefficients are declared assumptions. Numerical timestep checks are still required for the complete constrained scene.

### Connections and breakable assemblies

Rope anchors are local physical coordinates after geometry scaling. A rope limits maximum separation and supplies no compressive spring force; it is massless and has no simulated cable sag. A visible line is presentation geometry. A spring instead has an independent rest length, stiffness and damping. Ordinary hinge, ball and fixed joints remain separate connection types.

Breakable assemblies consist of ordinary rigid bodies and fixed bonds. A threshold crossing removes an actual bond, after which Rapier continues the unconstrained motion; the module does not impose a destruction trajectory or edit velocities to manufacture an outcome. The `contact-graph` criterion estimates the distribution of external contact and gravitational loads over the intact graph. It is not a measurement of exact joint forces or a stress/FEM fracture solution. Existing bodies separate; arbitrary geometry is not cut into new fragments. The schema limits a project to 32 assemblies and 200 bonds involving at most 150 bodies.

### Deformable volumes

The shared FEM path supports banana, ball and ellipsoid skins, supported single sphere/ellipsoid parts, or one authored closed triangular surface. Rapier creates a tetrahedral volume with corotational FEM, configurable elasticity, damping and plasticity; skin collision is enabled when the skin is preserved. Arbitrary overlapping compound prop parts are not automatically converted to a watertight soft body. Detached decorative details do not become attached FEM cells.

Custom input receives connected, oriented, closed-surface topology checks, but these do not certify the absence of every geometric self-intersection; meshing may still reject it. Mesh budgets bound cost. Material presets are illustrative parameters rather than calibrated specimens, and the solver does not add tearing, melting or fluid flow by itself.

### Penetration, thermal and fluid models

The axial `MaterialPenetration` model advances a flat-ended rigid cylinder along a declared axis through a target. It combines effective Poncelet-type mechanical resistance with a finite thermal-energy budget and enthalpy-priced contact melting. The scene adapter uses that model to place the projectile; it is not a simultaneous unrestricted three-dimensional Rapier impact calculation for that body. The physical clock is explicit and distinct from movie retiming.

The visible channel uses local axial cells of equivalent melted volume, including side melting over the wetted cylinder length. It is a geometric approximation rather than a solution of three-dimensional heat conduction, meltwater flow, vapour-film dynamics, target cracking or projectile deformation. Default resistance and heat-transfer coefficients are assumptions, not calibrated ice-impact measurements. The separate sphere/ice heat-balance model in `phenomena.js` has its own narrower domain.

The particle-liquid model uses Double Density Relaxation and prepared channel/reservoir boundaries. It does not provide general two-way coupling to arbitrary props, liquid buoyancy, chemistry or heat transfer. Uniform gas buoyancy does not extend this liquid solver. Central gravity is also a separate vacuum model rather than an automatic addition of atmosphere, surface contact and orbital mechanics to every scene.

## Verification and presentation

Module checks cover validation, conservation or analytic cases where applicable, timestep comparisons, authoring round-trips and model-specific behaviour. They establish numerical behaviour within the declared domain; they do not replace experiments or calibrate material constants. Render-only art changes can be checked by comparing complete body poses against an unchanged baseline. That comparison does not apply to changes of physical mesh, mass, anchors or solver parameters.

Capture packages the observed geometry, poses, measurements, camera and authored graphics. Native rendering consumes that capture without resimulating or changing outcomes. A passing CPU projection check does not establish absence of occlusion, readable typography, appealing camera motion, a good sound mix or photorealism. Native stills, moving footage and audio require their own review before a film is accepted.

## Development and release

The development server uses Vite. A production checkout must run the Vite build before `npm start`. The Docker image contains the built UI and production dependencies only. User data lives in a writable directory, separate from an immutable application snapshot. Heavy exports are serialised by a render lock.

Node.js 24 is recommended, with 22.12 as the minimum. Editing, CPU simulation and sound rehearsal can run on Linux. Final MP4 rendering requires macOS, Swift Command Line Tools, Metal and FFmpeg, either locally or through the authenticated Mac render worker. The web container does not supply a Linux native-video renderer. Recorded offline audio assets and their licence/provenance files are source resources; generated captures, user projects, native binaries and export caches are not.

The current distribution is a local workstation tool, not a hosted multi-tenant service. Each producer can use a separate data directory or installation. Remote accounts, shared permissions and concurrent collaborative editing would need their own service layer; a loopback server must not be presented as that service.
