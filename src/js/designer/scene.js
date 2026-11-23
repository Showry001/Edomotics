// Design your cinema: the 3D room, built entirely in code with three.js (no model files). Walls,
// risers, recliners, screen, speakers and ceiling follow the design and the rules in options.js.
// Walls between the camera and the room are cut away, so from outside it reads like a model.
// It draws only when something changes, pauses off screen and lets go of everything on dispose().
import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Group, Mesh, InstancedMesh, Points, Object3D, Vector3,
  BoxGeometry, PlaneGeometry, CylinderGeometry, BufferGeometry, Float32BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial, PointsMaterial, HemisphereLight, PointLight,
  CanvasTexture, DataTexture, TextureLoader, RepeatWrapping, SRGBColorSpace, ACESFilmicToneMapping,
  PMREMGenerator, MathUtils, Plane,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gsap, EASE, reduced } from '../core.js';
import { pick, layout, RULES } from './options.js';

const BASE = import.meta.env.BASE_URL;
const T = 0.1; // wall, floor and ceiling thickness

// Lighting scenes: how bright each layer is (0–1). Pressing a key tweens all of them together.
const SCENES = {
  film: { env: 0.1, hemi: 0.06, sconce: 0, cove: 0.12, stars: 1, steps: 0.9, screen: 1 },
  interval: { env: 0.5, hemi: 0.4, sconce: 0.7, cove: 0.7, stars: 0.6, steps: 1, screen: 0.75 },
  up: { env: 0.95, hemi: 0.85, sconce: 1, cove: 1, stars: 0.25, steps: 0.5, screen: 0.45 },
};

function glowTexture(size, inner, outer) {
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

// A faint fibre so the carpet doesn't read as flat plastic.
function carpetTexture() {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const v = 226 + Math.floor(Math.random() * 29);
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new DataTexture(data, n, n);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createScene(stage, initial, { lite = false, sceneId = 'interval', viewId = 'overview', onReady, onView } = {}) {
  let state = initial;
  let lay = layout(state);
  let view = viewId;

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true; // the motorised screen is revealed as it unrolls
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);

  const scene = new Scene();
  scene.background = new Color('#12110E');
  const pmrem = new PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envTarget = pmrem.fromScene(envScene, 0.04);
  envScene.dispose();
  scene.environment = envTarget.texture;

  const camera = new PerspectiveCamera(lite ? 46 : 38, 16 / 10, 0.05, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false; // the wheel scrolls the page; pinch zooms (below)
  controls.rotateSpeed = 0.55;

  // ---------- Materials and textures (made once; colours change in place) ----------
  const carpet = carpetTexture();
  const dot = glowTexture(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  const blob = glowTexture(128, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  const mats = {
    seat: new MeshStandardMaterial({ roughness: 0.55 }),
    plinth: new MeshStandardMaterial({ color: '#141311', roughness: 0.8 }),
    floor: new MeshStandardMaterial({ roughness: 1, map: carpet }),
    shell: new MeshStandardMaterial({ color: '#2a2825', roughness: 0.92 }),
    cut: new MeshStandardMaterial({ color: '#d8cebf', roughness: 0.9 }),
    slat: new MeshStandardMaterial({ roughness: 0.62 }),
    fabric: new MeshStandardMaterial({ roughness: 0.96 }),
    front: new MeshStandardMaterial({ color: '#24221f', roughness: 0.96 }),
    speaker: new MeshStandardMaterial({ color: '#121110', roughness: 0.45 }),
    grille: new MeshStandardMaterial({ color: '#262522', roughness: 0.9 }),
    frame: new MeshStandardMaterial({ color: '#0a0a09', roughness: 0.6 }),
    screen: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    sconce: new MeshStandardMaterial({ color: '#000000', emissive: '#ffc58e' }),
    cove: new MeshStandardMaterial({ color: '#000000', emissive: '#ffcf9e' }),
    steps: new MeshStandardMaterial({ color: '#000000', emissive: '#ffb469' }),
    stars: new PointsMaterial({ color: '#fff3d9', size: 0.05, map: dot, transparent: true, depthWrite: false }),
    shadow: new MeshBasicMaterial({ color: '#000000', map: blob, transparent: true, depthWrite: false, opacity: 0.62 }),
  };
  let screenTex = null;
  let disposed = false;
  const screenTint = new Color('#ffffff'); // the screen surface's own colour
  new TextureLoader().load(`${BASE}media/designer/screen.webp`, (tex) => {
    if (disposed) { tex.dispose(); return; }
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    screenTex = tex;
    mats.screen.map = tex;
    fitScreenTexture();
    mats.screen.needsUpdate = true;
    applyLevels();
    request();
  });
  function fitScreenTexture() {
    if (!screenTex) return;
    const r = lay.screen.w / lay.screen.h;
    screenTex.repeat.set(1, Math.min(1, (16 / 9) / r));
    screenTex.offset.set(0, (1 - screenTex.repeat.y) / 2);
  }

  // A recliner, in parts, seen from the screen: plinth, seat, back, headrest, closed footrest;
  // arms stand between seats. Geometry is shared by every seat (instanced).
  const SG = {
    plinth: new BoxGeometry(0.66, 0.14, 0.8),
    cushion: new RoundedBoxGeometry(0.64, 0.2, 0.62, 3, 0.06),
    back: new RoundedBoxGeometry(0.64, 0.66, 0.2, 3, 0.07),
    head: new RoundedBoxGeometry(0.56, 0.2, 0.17, 3, 0.07),
    foot: new RoundedBoxGeometry(0.6, 0.3, 0.09, 2, 0.04),
    arm: new RoundedBoxGeometry(0.15, 0.5, 0.86, 3, 0.05),
  };
  const PARTS = [
    ['plinth', 'plinth', [0, 0.07, 0.05], 0],
    ['cushion', 'seat', [0, 0.36, -0.02], 0],
    ['back', 'seat', [0, 0.74, 0.36], 0.2],
    ['head', 'seat', [0, 1.1, 0.45], 0.2],
    ['foot', 'seat', [0, 0.21, -0.36], 0],
  ];

  // ---------- Lights (a fixed set, so changing a scene never recompiles shaders) ----------
  const hemi = new HemisphereLight('#fff1e2', '#2a2520', 0);
  const sconceL = new PointLight('#ffb878', 0, 0, 2);
  const sconceR = new PointLight('#ffb878', 0, 0, 2);
  const coveLight = new PointLight('#ffcf9e', 0, 0, 2);
  const screenLight = new PointLight('#dfe6ff', 0, 0, 2);
  scene.add(hemi, sconceL, sconceR, coveLight, screenLight);
  const levels = { ...(SCENES[sceneId] || SCENES.interval) };

  // ---------- The room ----------
  let room = null;
  let owned = [];
  let walls = [];
  const dummy = new Object3D();

  function colours() {
    mats.seat.color.set(pick('seat', state.seat).color);
    mats.floor.color.set(pick('floor', state.floor).color);
    const wall = pick('walls', state.walls);
    (wall.kind === 'slats' ? mats.slat : mats.fabric).color.set(wall.color);
  }

  // The motorised screen: `deploy` runs from 0 (rolled up in its cassette) to 1 (fully down). The
  // projected picture is fixed on the wall, so the unrolling surface reveals it from the top down;
  // a clipping plane at the surface's lower edge does that, and the weighted bar rides on the edge.
  const rollPlane = new Plane(new Vector3(0, 1, 0), 0);
  let drop = null;
  let deploy = 1;
  let rollTween = null;
  function roll() {
    if (!drop) return;
    const edge = drop.top - drop.h * Math.max(0.004, deploy);
    rollPlane.constant = -edge;
    drop.bar.position.y = edge - 0.015;
  }
  function setRoll(down) {
    rollTween?.kill();
    const to = down ? 1 : 0;
    if (reduced || !drop) { deploy = to; roll(); request(); return; }
    // About the pace of a real screen: a full drop takes a few seconds.
    rollTween = gsap.to({ v: deploy }, { v: to, duration: 1.2 + 2.4 * Math.abs(to - deploy), ease: 'power1.inOut',
      onUpdate() { deploy = this.targets()[0].v; roll(); request(); }, onComplete: () => { rollTween = null; } });
  }

  function build() {
    if (room) { scene.remove(room); room.traverse((o) => { if (o.isInstancedMesh) o.dispose(); }); owned.forEach((g) => g.dispose()); }
    owned = [];
    walls = [];
    lay = layout(state);
    const { W, L, H, rows, screen, mlp } = lay;
    const geo = (g) => { owned.push(g); return g; };
    room = new Group();

    carpet.repeat.set(W * 2, L * 2);
    const floor = new Mesh(geo(new BoxGeometry(W + 2 * T, T, L + 2 * T)), [mats.shell, mats.shell, mats.floor, mats.shell, mats.shell, mats.shell]);
    floor.position.set(0, -T / 2, L / 2);
    room.add(floor);

    // Walls: each is cut away when the camera is outside it (axis, inner face, inward sign).
    const wall = (w, d, x, z, axis, value, sign) => {
      const g = new Group();
      const body = new Mesh(geo(new BoxGeometry(w, H, d)), [mats.shell, mats.shell, mats.cut, mats.shell, mats.shell, mats.shell]);
      body.position.set(x, H / 2, z);
      g.add(body);
      room.add(g);
      walls.push({ obj: g, axis, value, sign });
      return g;
    };
    const left = wall(T, L + 2 * T, -W / 2 - T / 2, L / 2, 'x', -W / 2, 1);
    const right = wall(T, L + 2 * T, W / 2 + T / 2, L / 2, 'x', W / 2, -1);
    const front = wall(W, T, 0, -T / 2, 'z', 0, 1);
    const back = wall(W, T, 0, L + T / 2, 'z', L, -1);

    // Wall finish on the side and back walls; the screen wall is always dark fabric.
    const kind = pick('walls', state.walls).kind;
    const finish = (g, length, place) => {
      const slats = kind === 'slats';
      const pitch = slats ? 0.07 : 0.6;
      const n = Math.max(1, Math.floor((length - 0.3) / pitch));
      const mesh = slats
        ? new InstancedMesh(geo(new BoxGeometry(0.045, H - 0.24, 0.025)), mats.slat, n)
        : new InstancedMesh(geo(new RoundedBoxGeometry(0.585, H - 0.3, 0.04, 2, 0.012)), mats.fabric, n);
      const c = new Color();
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) * pitch;
        place(dummy, t);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (slats) mesh.setColorAt(i, c.setScalar(0.9 + Math.random() * 0.18));
      }
      g.add(mesh);
    };
    finish(left, L, (d, t) => { d.position.set(-W / 2 + 0.02, H / 2, L / 2 + t); d.rotation.set(0, Math.PI / 2, 0); });
    finish(right, L, (d, t) => { d.position.set(W / 2 - 0.02, H / 2, L / 2 + t); d.rotation.set(0, Math.PI / 2, 0); });
    finish(back, W, (d, t) => { d.position.set(t, H / 2, L - 0.02); d.rotation.set(0, 0, 0); });
    const panelsN = Math.max(1, Math.floor((W - 0.2) / 0.6));
    const frontPanels = new InstancedMesh(geo(new RoundedBoxGeometry(0.585, H - 0.3, 0.04, 2, 0.012)), mats.front, panelsN);
    for (let i = 0; i < panelsN; i++) {
      dummy.position.set((i - (panelsN - 1) / 2) * 0.6, H / 2, 0.02);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      frontPanels.setMatrixAt(i, dummy.matrix);
    }
    front.add(frontPanels);

    // Wall lights ride with their walls.
    [[left, -1], [right, 1]].forEach(([g, s]) => {
      [0.42, 0.76].forEach((f) => {
        const m = new Mesh(geo(new BoxGeometry(0.07, 0.26, 0.12)), mats.sconce);
        m.position.set(s * (W / 2 - 0.035), 1.95, L * f);
        g.add(m);
      });
    });

    // Surround speakers, from the sound system: sides beside the main seat (5), rears on the back
    // wall (7) and wides between the screen and the seats (9). Visible ones stand off the wall,
    // built-in ones sit flush as grilles, concealed ones are hidden behind the wall finish.
    const sound = pick('sound', state.sound);
    const style = state.spk;
    const surround = (g, x, z, along) => {
      if (style === 'hidden') return;
      const deep = style === 'visible' ? 0.2 : 0.012;
      const size = along === 'x' ? [deep, 0.34, 0.24] : [0.24, 0.34, deep];
      const m = new Mesh(geo(new BoxGeometry(...size)), style === 'visible' ? mats.speaker : mats.grille);
      m.position.set(x, 1.35, z);
      g.add(m);
    };
    [[left, -1], [right, 1]].forEach(([g, s]) => {
      const x = s * (W / 2 - (style === 'visible' ? 0.1 : 0.03));
      surround(g, x, mlp.z, 'x');
      if (sound.ear >= 9) surround(g, x, Math.max(0.9, mlp.z * 0.5), 'x');
    });
    if (sound.ear >= 7) [-1, 1].forEach((s) => surround(back, s * W * 0.22, L - (style === 'visible' ? 0.1 : 0.03), 'z'));
    sconceL.position.set(-W / 2 + 0.45, 1.95, L * 0.6);
    sconceR.position.set(W / 2 - 0.45, 1.95, L * 0.6);

    // Risers: every row behind the first steps up, carpeted, with a line of step light.
    rows.forEach((row, i) => {
      if (!i) return;
      const zFront = row.z - RULES.rowSpacing / 2;
      const riser = new Mesh(geo(new BoxGeometry(W, row.y, L - zFront)), mats.floor);
      riser.position.set(0, row.y / 2, (zFront + L) / 2);
      room.add(riser);
      const strip = new Mesh(geo(new BoxGeometry(W - 0.2, 0.014, 0.012)), mats.steps);
      strip.position.set(0, row.y - 0.035, zFront - 0.007);
      room.add(strip);
    });

    // Recliners and the arms between them.
    const total = rows.reduce((a, r) => a + r.xs.length, 0);
    const arms = rows.reduce((a, r) => a + r.xs.length + 1, 0);
    const parts = PARTS.map(([g, m]) => new InstancedMesh(SG[g], mats[m], total));
    const armMesh = new InstancedMesh(SG.arm, mats.seat, arms);
    let si = 0;
    let ai = 0;
    rows.forEach((row) => {
      row.xs.forEach((x) => {
        PARTS.forEach(([, , [px, py, pz], tilt], p) => {
          dummy.position.set(x + px, row.y + py, row.z + pz);
          dummy.rotation.set(tilt, 0, 0);
          dummy.updateMatrix();
          parts[p].setMatrixAt(si, dummy.matrix);
        });
        si++;
      });
      for (let k = 0; k <= row.xs.length; k++) {
        dummy.position.set(row.xs[0] - RULES.seatWidth / 2 + k * RULES.seatWidth, row.y + 0.35, row.z + 0.04);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        armMesh.setMatrixAt(ai++, dummy.matrix);
      }
      const shadow = new Mesh(geo(new PlaneGeometry(row.xs.length * RULES.seatWidth + 0.5, 1.3)), mats.shadow);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, row.y + 0.004, row.z + 0.05);
      room.add(shadow);
    });
    room.add(...parts, armMesh);

    // The picture: a television on a low console, or a projection screen (fixed to the wall, or
    // motorised: it unrolls from a ceiling cassette) lit by a projector.
    const box = (w, h, d, mat, x, y, z, parent = room) => {
      const m = new Mesh(geo(new BoxGeometry(w, h, d)), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const top = screen.y + screen.h / 2;
    const foot = screen.y - screen.h / 2;
    let picZ = 0.081;
    drop = null;
    if (screen.tv) {
      picZ = 0.085;
      box(screen.w + 0.03, screen.h + 0.03, 0.045, mats.frame, 0, screen.y, 0.06);
      box(Math.min(W - 0.6, screen.w + 0.5), 0.42, 0.4, mats.speaker, 0, 0.21, 0.26);
    } else if (state.stype === 'drop') {
      picZ = 0.13;
      box(screen.w + 0.3, 0.12, 0.16, mats.frame, 0, Math.min(H - 0.08, top + 0.08), 0.13);
      drop = { top, h: screen.h, bar: box(screen.w, 0.03, 0.02, mats.frame, 0, foot - 0.015, picZ) };
    } else {
      box(screen.w + 0.08, screen.h + 0.08, 0.04, mats.frame, 0, screen.y, 0.06);
    }
    const pic = new Mesh(geo(new PlaneGeometry(screen.w, screen.h)), mats.screen);
    pic.position.set(0, screen.y, picZ);
    room.add(pic);
    mats.screen.clippingPlanes = drop ? [rollPlane] : null;
    mats.screen.needsUpdate = true;
    roll();
    fitScreenTexture();
    screenLight.position.set(0, screen.y, 0.9);

    // The projector, at the distance its throw needs: on the ceiling for long and short throw,
    // on a low console just in front of the screen for ultra short throw.
    if (!screen.tv) {
      const t = pick('throw', state.throw);
      const d = screen.w * t.ratio;
      if (t.id === 'ust') {
        const z = Math.max(0.42, d);
        box(Math.min(W - 0.6, screen.w * 0.6), 0.38, 0.46, mats.speaker, 0, 0.19, z);
        box(0.6, 0.13, 0.38, mats.frame, 0, 0.445, z);
      } else {
        const z = MathUtils.clamp(d, 1.2, L - 0.45);
        box(0.05, 0.2, 0.05, mats.frame, 0, H - 0.1, z);
        box(0.44, 0.17, 0.48, mats.frame, 0, H - 0.285, z);
        const lens = new Mesh(geo(new CylinderGeometry(0.06, 0.06, 0.05, 24)), mats.speaker);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0.08, H - 0.285, z - 0.26);
        room.add(lens);
      }
    }

    // Front speakers (left, centre, right) and subwoofers, fitted as chosen: visible cabinets,
    // grilles built into the screen wall, or concealed behind it.
    const tx = Math.min(screen.w / 2 + 0.32, W / 2 - 0.22);
    if (style === 'visible') {
      [-tx, tx].forEach((x) => {
        box(0.26, 1.12, 0.3, mats.speaker, x, 0.56, 0.26);
        box(0.22, 1.0, 0.01, mats.grille, x, 0.58, 0.415);
      });
      const cy = screen.tv ? 0.42 + 0.1 : Math.max(0.12, foot - 0.16);
      box(0.62, 0.19, 0.26, mats.speaker, 0, cy, screen.tv ? 0.26 : 0.2);
    }
    if (style !== 'hidden') {
      const subs = sound.subs === 1 ? [-1] : [-1, 1];
      subs.forEach((s) => {
        const x = s * (W / 2 - 0.4);
        if (style === 'visible') box(0.45, 0.45, 0.45, mats.speaker, x, 0.225, 0.42);
        else box(0.4, 0.4, 0.012, mats.grille, x, 0.35, 0.046, front);
      });
    }

    // Ceiling: plain, cove-lit or starlit, with the overhead speakers of the sound system.
    const ceiling = new Group();
    const slab = new Mesh(geo(new BoxGeometry(W + 2 * T, T, L + 2 * T)), mats.shell);
    slab.position.set(0, H + T / 2, L / 2);
    ceiling.add(slab);
    const overhead = { 0: [], 2: [0], 4: [-1.1, 1.1], 6: [-1.4, 0, 1.4] }[sound.over] || [];
    if (style !== 'hidden') overhead.forEach((dz) => [-1, 1].forEach((sx) => {
      const spk = new Mesh(geo(new CylinderGeometry(0.1, 0.1, 0.012, 24)), mats.grille);
      spk.position.set(sx * W * 0.22, H - 0.006, MathUtils.clamp(mlp.z + dz, 0.6, L - 0.4));
      ceiling.add(spk);
    }));
    if (state.ceiling === 'cove') {
      [[W - 0.1, 0.05, 0, 0.05], [W - 0.1, 0.05, 0, L - 0.05], [0.05, L - 0.1, -W / 2 + 0.05, L / 2], [0.05, L - 0.1, W / 2 - 0.05, L / 2]].forEach(([w, d, x, z]) => {
        const s = new Mesh(geo(new BoxGeometry(w, 0.03, d)), mats.cove);
        s.position.set(x, H - 0.05, z);
        ceiling.add(s);
      });
    }
    coveLight.position.set(0, H - 0.35, L / 2);
    if (state.ceiling === 'stars') {
      const n = Math.round((lite ? 40 : 90) * W * L / 10);
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * (W - 0.3), H - 0.012, 0.15 + Math.random() * (L - 0.3)], i * 3);
      const g = geo(new BufferGeometry());
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      ceiling.add(new Points(g, mats.stars));
    }
    room.add(ceiling);
    walls.push({ obj: ceiling, axis: 'y', value: H, sign: -1 });

    scene.add(room);
  }

  function applyLevels() {
    const v = levels;
    const cove = state.ceiling === 'cove';
    scene.environmentIntensity = v.env;
    hemi.intensity = v.hemi * 1.4;
    sconceL.intensity = sconceR.intensity = v.sconce * 2.4;
    mats.sconce.emissiveIntensity = 0.1 + v.sconce * 2.6;
    mats.cove.emissiveIntensity = 0.15 + v.cove * 3;
    coveLight.intensity = cove ? v.cove * 5 : 0;
    mats.stars.opacity = v.stars;
    mats.steps.emissiveIntensity = v.steps * 2.4;
    mats.screen.color.setScalar(screenTex ? 0.18 + v.screen * 0.82 : 0.05).multiply(screenTint); // dark until its picture arrives
    screenLight.intensity = v.screen * 3.2;
  }

  // ---------- Camera views ----------
  function poseFor(name) {
    const { W, L, H, screen, mlp } = lay;
    const vf = MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    if (name === 'seat' || name === 'ceiling') {
      // 'ceiling' is the seat looking up and forward, shown when the ceiling changes.
      const pos = new Vector3(mlp.x, mlp.y, mlp.z);
      const look = name === 'seat' ? new Vector3(0, screen.y - 0.05, 0) : new Vector3(0, H * 0.68, 0);
      const target = pos.clone().add(look.sub(pos).setLength(0.25));
      return { pos, target, min: 0.25, max: 0.25, polar: [0.15 * Math.PI, 0.7 * Math.PI], az: [-1, 1] };
    }
    if (name === 'top') {
      const d = Math.max((L / 2) / Math.tan(vf / 2), (W / 2) / Math.tan(hf / 2)) * 1.12 + H;
      const target = new Vector3(0, 0, L / 2);
      return { pos: new Vector3(0, d, L / 2 + d * 0.02), target, min: d * 0.7, max: d * 1.4, polar: [0, 0.3 * Math.PI] };
    }
    if (name === 'front') {
      const target = new Vector3(0, 0.7, L * 0.62);
      const pos = new Vector3(W * 0.3, Math.min(H - 0.3, 1.9), 0.6);
      const d = pos.distanceTo(target);
      return { pos, target, min: d * 0.7, max: d * 1.5, polar: [0.2 * Math.PI, 0.49 * Math.PI] };
    }
    const r = 0.5 * Math.sqrt(W * W + L * L + H * H);
    const d = (r / Math.sin(Math.min(vf, hf) / 2)) * (lite ? 0.86 : 0.74);
    const target = new Vector3(0, H * 0.3, L * 0.5);
    const pos = target.clone().add(new Vector3(-0.58, 0.62, 0.53).normalize().multiplyScalar(d));
    // Frame the room up and away from the lighting console in the corner (full width on phones).
    const fwd = target.clone().sub(pos).normalize();
    const right = fwd.clone().cross(camera.up).normalize();
    const up = right.clone().cross(fwd);
    const h = 2 * d * Math.tan(vf / 2);
    const shift = right.multiplyScalar(h * camera.aspect * (lite ? 0 : 0.07)).add(up.multiplyScalar(-h * (lite ? 0.13 : 0.06)));
    pos.add(shift);
    target.add(shift);
    return { pos, target, min: d * 0.55, max: d * 1.5, polar: [0.12 * Math.PI, 0.47 * Math.PI] };
  }
  function limitsFor(p) {
    controls.minDistance = p ? p.min : 0;
    controls.maxDistance = p ? p.max : Infinity;
    controls.minPolarAngle = p ? p.polar[0] : 0;
    controls.maxPolarAngle = p ? p.polar[1] : Math.PI;
    controls.minAzimuthAngle = p?.az ? p.az[0] : -Infinity;
    controls.maxAzimuthAngle = p?.az ? p.az[1] : Infinity;
  }
  let tween = null;
  function setView(name, { instant = false } = {}) {
    view = name;
    const p = poseFor(name);
    tween?.kill();
    limitsFor(null);
    const done = () => { tween = null; limitsFor(p); controls.enabled = true; controls.update(); request(); };
    if (instant || reduced) {
      camera.position.copy(p.pos);
      controls.target.copy(p.target);
      done();
      return;
    }
    controls.enabled = false;
    tween = gsap.timeline({ onUpdate: request, onComplete: done })
      .to(camera.position, { x: p.pos.x, y: p.pos.y, z: p.pos.z, duration: 1.5, ease: EASE.io }, 0)
      .to(controls.target, { x: p.target.x, y: p.target.y, z: p.target.z, duration: 1.5, ease: EASE.io }, 0);
  }
  controls.addEventListener('start', () => { if (view) { view = null; onView?.(null); } });
  controls.addEventListener('change', () => request());

  // Pinch to zoom: trackpads send it as ctrl + wheel, phones as two fingers. A plain wheel
  // is left alone, so the page keeps scrolling over the room.
  const zoomBy = (k) => {
    const off = camera.position.clone().sub(controls.target);
    off.setLength(MathUtils.clamp(off.length() * k, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(off);
    controls.update();
    request();
  };
  const onWheel = (e) => { if (!e.ctrlKey) return; e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.01)); };
  let pinch = 0;
  const gap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouch = (e) => {
    if (e.touches.length !== 2) { pinch = 0; return; }
    const d = gap(e.touches);
    if (pinch) zoomBy(pinch / d);
    pinch = d;
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchmove', onTouch, { passive: true });
  canvas.addEventListener('touchend', onTouch, { passive: true });

  // ---------- Drawing ----------
  let raf = 0;
  let visible = true;
  let ready = false;
  const cam = camera.position;
  function frame() {
    raf = 0;
    const moving = controls.update();
    walls.forEach((w) => { w.obj.visible = w.sign * (cam[w.axis] - w.value) > 0; });
    renderer.render(scene, camera);
    if (!ready) { ready = true; onReady?.(); }
    if (moving || tween) request();
  }
  function request() { if (!raf && visible && !disposed) raf = requestAnimationFrame(frame); }

  const resize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (view) setView(view, { instant: true });
    request();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) request(); });
  io.observe(stage);

  colours();
  build();
  applyLevels();
  resize();
  setView(view, { instant: true });

  let levelTween = null;
  return {
    update(next) {
      const prev = state;
      state = next;
      colours();
      const kindChanged = pick('walls', prev.walls).kind !== pick('walls', next.walls).kind;
      const structural = kindChanged || ['room', 'rows', 'seats', 'ceiling', 'screen', 'shape', 'display', 'tv', 'stype', 'throw', 'sound', 'spk'].some((k) => prev[k] !== next[k]);
      // Choosing a motorised screen shows it coming down from its cassette.
      const motorised = (x) => x.display === 'screen' && x.stype === 'drop';
      const lower = motorised(next) && !motorised(prev);
      if (structural) {
        if (lower) { rollTween?.kill(); deploy = 0; }
        build();
        // The ceiling is cut away from outside, so a new ceiling is shown from the seat, looking up.
        if (prev.ceiling !== next.ceiling) { setView('ceiling'); onView?.(null); }
        else if (view) setView(view);
        else if (prev.room !== next.room) { setView('overview'); onView?.('overview'); }
      }
      applyLevels();
      request();
      if (lower) setRoll(true);
    },
    // Raise (false) or lower (true) a motorised screen; returns whether it ends up down.
    setRoll(down) { setRoll(down); return down; },
    setScene(id) {
      const to = SCENES[id];
      if (!to) return;
      levelTween?.kill();
      if (reduced) { Object.assign(levels, to); applyLevels(); request(); return; }
      levelTween = gsap.to(levels, { ...to, duration: 2.2, ease: 'sine.inOut', onUpdate: () => { applyLevels(); request(); } });
    },
    setView(name) { setView(name); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      tween?.kill();
      levelTween?.kill();
      rollTween?.kill();
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchmove', onTouch);
      canvas.removeEventListener('touchend', onTouch);
      controls.dispose();
      if (room) room.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      owned.forEach((g) => g.dispose());
      Object.values(SG).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      [carpet, dot, blob, screenTex].forEach((t) => t?.dispose());
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
