/* Real-time 3D: procedurally modelled gym equipment in black lacquer and polished gold.
   Every element with data-scene="dumbbell|kettlebell|plates" gets its own canvas. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const containers = [...document.querySelectorAll('[data-scene]')];

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ textures & materials

function knurlTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#7a7a7a';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.2;
  for (let i = -size; i < size * 2; i += 10) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + size, size);
    g.stroke();
    g.beginPath();
    g.moveTo(i + size, 0);
    g.lineTo(i, size);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 8);
  return tex;
}

function dotSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,205,1)');
  grad.addColorStop(0.35, 'rgba(241,220,167,0.55)');
  grad.addColorStop(1, 'rgba(241,220,167,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMaterials() {
  return {
    gold: new THREE.MeshPhysicalMaterial({ color: 0xe0b866, metalness: 1, roughness: 0.16, clearcoat: 0.5, clearcoatRoughness: 0.12 }),
    goldSatin: new THREE.MeshStandardMaterial({ color: 0xc9a058, metalness: 1, roughness: 0.34 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc4c4c8, metalness: 1, roughness: 0.28, bumpMap: knurlTexture(), bumpScale: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd8d8dc, metalness: 1, roughness: 0.12 }),
  };
}

// ------------------------------------------------------------------ geometry helpers

/** A flat ring (annulus) with bevelled edges, centred on the origin, facing +Z. */
function ringGeometry(outer, inner, depth, bevel = 0.02, segments = 96) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: segments,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function zCylinder(radius, length, material, segments = 64) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** Black lacquered weight plate with gold rim and hub. Thickness runs along Z. */
function plate(m, outer, depth) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(ringGeometry(outer, 0.15, depth, 0.03), m.black));
  g.add(new THREE.Mesh(ringGeometry(outer - 0.05, outer - 0.1, depth + 0.05, 0.01), m.gold));
  g.add(new THREE.Mesh(ringGeometry(outer * 0.55, outer * 0.52, depth + 0.03, 0.006), m.goldSatin));
  g.add(new THREE.Mesh(ringGeometry(0.3, 0.15, depth + 0.09, 0.02), m.gold));
  return g;
}

function dumbbell(m) {
  const g = new THREE.Group();
  g.add(zCylinder(0.105, 3.1, m.steel));

  const plates = [
    [0.95, 0.22],
    [0.8, 0.19],
    [0.64, 0.16],
  ];
  for (const side of [-1, 1]) {
    let z = 0.66;
    const collar = zCylinder(0.19, 0.12, m.gold);
    collar.position.z = side * (z - 0.06);
    g.add(collar);
    for (const [r, d] of plates) {
      const p = plate(m, r, d);
      const thickness = d + 0.06;
      p.position.z = side * (z + thickness / 2 + 0.03);
      g.add(p);
      z += thickness + 0.03;
    }
    const lock = zCylinder(0.17, 0.12, m.chrome);
    lock.position.z = side * (z + 0.08);
    g.add(lock);
    const cap = zCylinder(0.13, 0.06, m.gold);
    cap.position.z = side * 1.56;
    g.add(cap);
  }
  return g;
}

function kettlebell(m) {
  const g = new THREE.Group();
  const pts = [new THREE.Vector2(0, -0.92), new THREE.Vector2(0.34, -0.92)];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const a = -1.17 + (i / steps) * 2.35;
    pts.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
  }
  pts.push(new THREE.Vector2(0.18, 0.99), new THREE.Vector2(0, 1.0));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 96), m.black));

  const band = new THREE.Mesh(new THREE.TorusGeometry(1.004, 0.022, 16, 160), m.gold);
  band.rotation.x = Math.PI / 2;
  band.position.y = -0.08;
  g.add(band);

  // Wide, flat-topped handle whose horns sink into the bell, like a competition kettlebell.
  const path = new THREE.CatmullRomCurve3(
    [
      [-0.66, 0.6], [-0.78, 0.95], [-0.74, 1.22], [-0.52, 1.42], [-0.2, 1.5], [0.2, 1.5],
      [0.52, 1.42], [0.74, 1.22], [0.78, 0.95], [0.66, 0.6],
    ].map(([x, y]) => new THREE.Vector3(x, y, 0)),
    false,
    'centripetal'
  );
  g.add(new THREE.Mesh(new THREE.TubeGeometry(path, 160, 0.105, 32, false), m.gold));
  g.position.y = -0.3;
  return g;
}

function plates(m) {
  const g = new THREE.Group();
  const layout = [
    { r: 1.25, d: 0.24, pos: [0.4, 0.25, 0], rot: [0.35, -0.55, 0.2] },
    { r: 0.85, d: 0.2, pos: [-0.75, -1.45, -1.4], rot: [-0.4, 0.7, -0.1] },
    { r: 0.6, d: 0.16, pos: [1.9, -1.35, -0.6], rot: [0.9, 0.3, 0.4] },
  ];
  layout.forEach(({ r, d, pos, rot }, i) => {
    const p = plate(m, r, d);
    p.position.set(...pos);
    p.rotation.set(...rot);
    p.userData.float = { phase: i * 1.7, base: pos[1], spin: 0.12 + i * 0.05 };
    g.add(p);
  });
  return g;
}

function goldDust(count, spread) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread.x;
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread.y;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread.z - 1;
    speeds[i] = 0.05 + Math.random() * 0.12;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.05,
    map: dotSprite(),
    color: 0xf1dca7,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = { speeds, spreadY: spread.y };
  return points;
}

// ------------------------------------------------------------------ scene setup

const PRESETS = {
  dumbbell: { build: dumbbell, camZ: 8.2, scale: 1.02, rotation: [0.42, 0.75, -0.42], dust: 520, spin: 0.22 },
  kettlebell: { build: kettlebell, camZ: 7.2, scale: 1.15, rotation: [0.12, -0.5, 0.05], dust: 220, spin: 0.3 },
  plates: { build: plates, camZ: 8.5, scale: 1, rotation: [0, 0, 0], dust: 260, spin: 0 },
};

function initScene(container) {
  const preset = PRESETS[container.dataset.scene];
  if (!preset) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.85;
  envScene.dispose?.();
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, preset.camZ);

  const key = new THREE.DirectionalLight(0xffe0ad, 2.4);
  key.position.set(4, 5, 6);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 1.4);
  rim.position.set(-6, 2, -5);
  const glow = new THREE.PointLight(0xd4af6a, 18, 14, 1.6);
  glow.position.set(0, -2.5, 3);
  scene.add(key, rim, glow);

  const m = makeMaterials();
  const model = preset.build(m);
  model.scale.setScalar(preset.scale);
  const pivot = new THREE.Group();
  pivot.rotation.set(...preset.rotation);
  pivot.add(model);
  scene.add(pivot);

  const dust = goldDust(preset.dust, { x: 14, y: 9, z: 6 });
  scene.add(dust);

  // ---------------------------------------------------------------- sizing
  let width = 0;
  let height = 0;
  function resize() {
    width = container.clientWidth;
    height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Pull the camera back on tall/narrow layouts so the model always fits.
    camera.position.z = preset.camZ * Math.max(1, 1.05 / camera.aspect);
    camera.updateProjectionMatrix();
    if (!running) render(0);
  }
  new ResizeObserver(resize).observe(container);

  // ---------------------------------------------------------------- interaction
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener(
    'pointermove',
    (e) => {
      pointer.tx = e.clientX / window.innerWidth - 0.5;
      pointer.ty = e.clientY / window.innerHeight - 0.5;
    },
    { passive: true }
  );

  // ---------------------------------------------------------------- render loop
  const clock = new THREE.Clock();
  let elapsed = 0;
  let spin = 0;
  let intro = reduceMotion ? 1 : 0;
  let visible = true;
  let running = false;

  function render(dt) {
    elapsed += dt;
    intro = Math.min(1, intro + dt * 0.55);
    const ease = 1 - Math.pow(1 - intro, 4);

    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;

    const rect = container.getBoundingClientRect();
    const scroll = Math.max(-1, Math.min(1, -rect.top / Math.max(1, window.innerHeight)));

    spin += dt * preset.spin;
    pivot.rotation.x = preset.rotation[0] + pointer.y * 0.35 + scroll * 0.4;
    pivot.rotation.y = preset.rotation[1] + spin + pointer.x * 0.7 + scroll * 1.2;
    pivot.rotation.z = preset.rotation[2];
    model.position.y = Math.sin(elapsed * 0.9) * 0.08;
    model.scale.setScalar(preset.scale * (0.82 + 0.18 * ease));

    if (container.dataset.scene === 'plates') {
      model.children.forEach((p) => {
        const f = p.userData.float;
        p.position.y = f.base + Math.sin(elapsed * 0.7 + f.phase) * 0.12;
        p.rotation.y += dt * f.spin;
      });
    }

    glow.position.x = pointer.x * 6;
    glow.position.y = -2.5 - pointer.y * 3;

    const pos = dust.geometry.attributes.position;
    const { speeds, spreadY } = dust.userData;
    for (let i = 0; i < speeds.length; i++) {
      let y = pos.array[i * 3 + 1] + speeds[i] * dt;
      if (y > spreadY / 2) y = -spreadY / 2;
      pos.array[i * 3 + 1] = y;
    }
    pos.needsUpdate = true;
    dust.rotation.y = elapsed * 0.02 + pointer.x * 0.15;
    dust.material.opacity = 0.85 * ease;

    renderer.render(scene, camera);
  }

  function frame() {
    if (!running) return;
    render(Math.min(clock.getDelta(), 0.05));
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduceMotion || !visible || document.hidden) return;
    running = true;
    clock.getDelta();
    requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
  }

  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      visible ? start() : stop();
    },
    { rootMargin: '100px' }
  ).observe(container);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stop();
  });

  resize();
  render(0);
  container.classList.add('is-ready');
  start();
}

if (containers.length && webglAvailable()) containers.forEach(initScene);
