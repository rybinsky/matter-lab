// Export metadata only. No solver imports, allocations, forces or clock changes.
const copy=value=>value===undefined?undefined:structuredClone(value);
const definitions={
 'surface-motion':{name:'Driven point mass on an axisymmetric surface',implementation:['src/surface-motion.js','src/surface-motion-scene.js'],limitations:['Constrained point-mass mechanics on a static y=h(r) profile with a shared traction limit and bounded drive force/power; not calibrated human biomechanics.','Body contact colliders are disabled during constrained motion. Free edges or loss of support transfer the computed position and velocity to ordinary rigid dynamics; no launch impulse is added.','The optional running figure is render-only illustration. It does not supply balance, gait forces or sustained walking after release.','The contact energy/work ledger stops at rigid-body handoff; subsequent impacts and rotation are solved by Rapier.']},
 rigid:{name:'Rapier 0.21',implementation:['src/physics.js','@dimforge/rapier3d-compat'],limitations:['Rigid contacts and joints do not by themselves model heat, fluids, material fracture or device damage.','Material names are presets, not evidence of experimental calibration.']},
 orbit:{name:'Central gravity / velocity Verlet',implementation:['src/phenomena.js'],limitations:['Spherical central body and point-particle trajectory in vacuum; no atmospheric drag, terrain or non-spherical gravity.','Display coordinates and projectile size are scaled separately from SI orbital calculations.']},
 thermal:{name:'Lumped heat balance / melt enthalpy',implementation:['src/phenomena.js'],limitations:['Lumped finite heat capacity and prescribed effective heat transfer; not a resolved 3D heat or fluid calculation.','Effective contact coefficients are assumptions unless independently calibrated.']},
 flow:{name:'Clavet-style Double Density Relaxation',implementation:['src/physics.js'],limitations:['Particle approximation with prepared chute/basin and one-way collision boundaries.','No general two-way fluid–rigid coupling, boiling, combustion or calibrated splashing.']},
 penetration:{name:'1D Poncelet resistance / finite-heat contact melting',implementation:['src/penetration.js','src/penetration-scene.js'],limitations:['Phenomenological axial model for an effective flat-ended cylinder; not calibrated ice-impact data.','Projectile pose follows the 1D controller; the normal rigid projectile–target contact is disabled.','The cavity uses local axial cells of equivalent melted volume, not 3D fracture, water flow or resolved heat conduction.','Strength, drag and heat-transfer coefficients are model assumptions, not measured material guarantees.']},
 atmosphere:{name:'Uniform-gas Archimedes buoyancy / quadratic drag',implementation:['src/atmosphere.js'],limitations:['Only declared closed rigid displacement volumes in a uniform constant-density gas; constant volume and drag coefficient.','Gas/envelope mass must already be included in the ordinary body mass. No gas expansion, leaks, stratification, wake shielding or liquid submergence.']},
 breakables:{name:'Threshold bonds / approximate contact-graph loads',implementation:['src/breakable-assemblies.js'],limitations:['External contact, gravity and user loads are distributed approximately through a bond graph; these are not measured fixed-joint reactions.','Authored force or strength×area thresholds are not calibrated continuum fracture, crack propagation or a real-material failure prediction.']},
 'soft-fem':{name:'Rapier 0.21 corotational soft bodies / FEM',implementation:['src/deformable-assets.js','src/physics.js'],limitations:['Corotational volume discretization with authored/preset elastic and plastic parameters; not calibrated behavior of a named real object.','No implicit watertight union of overlapping asset parts; detached decorative details are not attached FEM cells.','Topology validation does not certify every geometric self-intersection; deformation does not imply actual device/fruit damage.']},
 'soft-constraints':{name:'Rapier 0.21 corotational soft bodies / constraint solver',implementation:['src/physics.js'],limitations:['Corotational cuboid soft body with constraint solver and preset material parameters.','Not the FEM solver used for continuous deformable assets, and not calibrated real-material failure.']},
 'soft-unspecified':{name:'Rapier soft body / solver not recorded',implementation:['src/physics.js'],limitations:['Legacy capture contains an unclassified soft mesh. Its solver and effective parameters were not recorded; do not infer FEM or calibration.']},
 wind:{name:'Phenomenological legacy wind force',implementation:['src/physics.js'],limitations:['Volume-estimated force for eligible ordinary bodies; not aerodynamic CFD. Declared buoyant bodies use their separate atmosphere drag route.']},
};
const model=(id,parameters)=>({id,...copy(definitions[id]),...(parameters===undefined?{}:{parameters:copy(parameters)})});

/** Runtime observations are plain data, supplied by capture before disposal.
 * Settings remain the fallback for older takes; runtime effective parameters
 * take precedence over authored values (notably penetration mass and gravity).
 */
export function takeModelProvenance(take={},runtime={}){
 const s=take.settings||{},experiment=s.experiment||take.experiment||'blank',models=[model('rigid',runtime.rigidStep===undefined?undefined:{stepSeconds:runtime.rigidStep})];
 if(experiment==='orbit')models.push(model('orbit',{planet:s.planet||'moon',altitude:s.altitude??100000,initialSpeed:s.speed??1633.504,timeScale:s.timeScale||1000}));
 if(experiment==='thermal')models.push(model('thermal',{material:s.material,mass:s.mass,temperature:s.temperature,contactH:s.contactH,thermalTimeScale:s.thermalTimeScale||40}));
 if(experiment==='flow')models.push(model('flow',{material:s.material,slope:s.slope,gravity:s.gravity}));
 if(s.surfaceMotion||runtime.surfaceMotion)models.push(model('surface-motion',{parametersSource:runtime.surfaceMotion?'effective-runtime':'authored-settings',config:runtime.surfaceMotion?.config||s.surfaceMotion,handoff:runtime.surfaceMotion?.handoff||null}));
 if(s.penetration||runtime.penetration){
  const p=runtime.penetration||{},authored=s.penetration||{};
  models.push(model('penetration',{parametersSource:p.parameters?'effective-runtime':'authored-settings; omitted values use implementation defaults',parameters:p.parameters||authored.parameters||{},projectileId:authored.projectileId,targetId:authored.targetId,axis:p.axis||authored.axis,entry:p.entry||authored.entry,leadDistance:p.leadDistance??authored.leadDistance??0,physicalClock:p.clock||authored.clock||[{time:0,elapsed:0},{time:20,elapsed:20}],geometryApproximation:p.geometryApproximation}));
 }
 const atmosphere=runtime.atmosphere||s.atmosphere;
 if(atmosphere&&atmosphere.enabled!==false)models.push(model('atmosphere',{density:atmosphere.density??1.204,wind:atmosphere.wind||[s.windSpeed||0,0,0],...(runtime.atmosphere?.volumes?{volumes:runtime.atmosphere.volumes}:{volumes:'Not recorded in this legacy take; buoyancy applies only to declared object volumes.'})}));
 if(Array.isArray(s.assemblies)&&s.assemblies.some(a=>a?.bonds?.length))models.push(model('breakables',{loadModel:'contact-graph',assemblies:s.assemblies}));
 const softs=runtime.softBodies;
 if(Array.isArray(softs)){
  for(const solver of ['fem','constraints']){const bodies=softs.filter(b=>b.solver===solver);if(bodies.length)models.push(model(solver==='fem'?'soft-fem':'soft-constraints',{bodies}));}
 }else if(experiment==='soft')models.push(model('soft-constraints',{materialPreset:s.material,source:'prepared compression specimen'}));
 else if((take.meshes||[]).some(m=>!m.kind))models.push(model('soft-unspecified'));
 if(s.windSpeed&&experiment!=='orbit')models.push(model('wind',{windSpeed:s.windSpeed}));
 return{version:1,basis:'resolved take settings and available runtime model observations',experiment,units:'SI; temperatures in degrees Celsius',models};
}

/** Aggregate by model identity while retaining every take's own parameters. */
export function captureModelProvenance(takes=[]){
 const entries=takes.map((take,index)=>({...copy(take.modelProvenance||takeModelProvenance(take)),takeIndex:index,...(take.clipId===undefined?{}:{clipId:take.clipId}),...(take.clipIndex===undefined?{}:{clipIndex:take.clipIndex})}));
 const unique=new Map();
 for(const entry of entries)for(const m of entry.models){
  if(!unique.has(m.id)){const {parameters,...definition}=m;unique.set(m.id,{...copy(definition),takeIndices:[]});}
  unique.get(m.id).takeIndices.push(entry.takeIndex);
 }
 return{models:[...unique.values()].map(m=>m.name),modelProvenance:{version:1,models:[...unique.values()],takes:entries}};
}
