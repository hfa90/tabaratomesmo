// Datas especiais: aparência de cada tema e a cena 3D (three.js, sem arquivos de modelo: tudo desenhado em código).
// Cada tema tem cores, um objeto 3D que flutua (etiqueta, presente, abóbora, estrela, coração, gravata)
// e partículas (neon, neve, brasas, fogos, pétalas, confete). A cena segue o dedo/mouse e a inclinação do
// celular; tocar num objeto solta uma explosão de partículas. Sem WebGL ou com "reduzir movimento": fundo estático.
import { reduceMotion } from './core.js';

export const THEMES = {
  blackfriday: { name: 'Black Friday', object: 'tag', particles: 'neon', title: 'Black Friday do Tá Barato', subtitle: 'Os maiores descontos do ano nos supermercados de Manaus.', banner: 'Black Friday: descontos de verdade, comparados',
    c: { bg1: '#05060A', bg2: '#22103A', acc: '#FFD43B', acc2: '#FF2E63', ink: '#FFFFFF', card: 'rgba(255,255,255,.06)' } },
  natal: { name: 'Natal', object: 'gift', particles: 'snow', title: 'Natal no Tá Barato', subtitle: 'A ceia completa pelo menor preço, perto de você.', banner: 'Ceia de Natal mais barata: veja as ofertas',
    c: { bg1: '#06281C', bg2: '#0E4A33', acc: '#E3B341', acc2: '#D7263D', ink: '#FFFFFF', card: 'rgba(255,255,255,.07)' } },
  halloween: { name: 'Halloween', object: 'pumpkin', particles: 'embers', title: 'Halloween do Tá Barato', subtitle: 'Doces, fantasias e festa com preço que não assusta.', banner: 'Halloween: doces com preço que não assusta',
    c: { bg1: '#120A1F', bg2: '#2E1240', acc: '#FF8A00', acc2: '#9B5DE5', ink: '#FFFFFF', card: 'rgba(255,255,255,.06)' } },
  reveillon: { name: 'Réveillon', object: 'star', particles: 'fireworks', title: 'Réveillon do Tá Barato', subtitle: 'Tudo para a virada: bebidas, petiscos e a ceia.', banner: 'Réveillon: a festa da virada mais barata',
    c: { bg1: '#040B1F', bg2: '#0E1F4D', acc: '#F5C451', acc2: '#7FDBFF', ink: '#FFFFFF', card: 'rgba(255,255,255,.07)' } },
  maes: { name: 'Dia das Mães', object: 'heart', particles: 'petals', title: 'Dia das Mães', subtitle: 'O almoço especial e os mimos que ela merece, pelo melhor preço.', banner: 'Dia das Mães: o almoço especial mais barato',
    c: { bg1: '#3B0A2A', bg2: '#7A1E52', acc: '#FFB3D1', acc2: '#FFD43B', ink: '#FFFFFF', card: 'rgba(255,255,255,.08)' } },
  pais: { name: 'Dia dos Pais', object: 'tie', particles: 'confetti', title: 'Dia dos Pais', subtitle: 'O churrasco e os presentes do pai, sem pesar no bolso.', banner: 'Dia dos Pais: churrasco com preço de verdade',
    c: { bg1: '#071A2E', bg2: '#123A5E', acc: '#5BC0EB', acc2: '#FFD43B', ink: '#FFFFFF', card: 'rgba(255,255,255,.07)' } },
  namorados: { name: 'Dia dos Namorados', object: 'heart', particles: 'hearts', title: 'Dia dos Namorados', subtitle: 'Jantar a dois, chocolates e vinho com o menor preço.', banner: 'Dia dos Namorados: jantar a dois mais barato',
    c: { bg1: '#2A0612', bg2: '#6E0F2D', acc: '#FF4D6D', acc2: '#FFC2D1', ink: '#FFFFFF', card: 'rgba(255,255,255,.08)' } },
};

/** próximo período de cada data (para preencher o formulário da administração) */
export function nextDates(theme, now = new Date()) {
  const y = now.getFullYear();
  const nthSunday = (yy, m, n) => { const d = new Date(yy, m, 1); const off = (7 - d.getDay()) % 7; return new Date(yy, m, 1 + off + (n - 1) * 7); };
  const lastFriday = (yy, m) => { const d = new Date(yy, m + 1, 0); return new Date(yy, m, d.getDate() - ((d.getDay() + 2) % 7)); };
  const make = (yy) => ({
    blackfriday: () => { const f = lastFriday(yy, 10); return [new Date(yy, 10, f.getDate() - 7), new Date(yy, 10, 30, 23, 59)]; },
    natal: () => [new Date(yy, 11, 1), new Date(yy, 11, 25, 23, 59)],
    halloween: () => [new Date(yy, 9, 20), new Date(yy, 9, 31, 23, 59)],
    reveillon: () => [new Date(yy, 11, 26), new Date(yy + 1, 0, 1, 23, 59)],
    maes: () => { const d = nthSunday(yy, 4, 2); return [new Date(yy, 4, d.getDate() - 10), new Date(yy, 4, d.getDate(), 23, 59)]; },
    pais: () => { const d = nthSunday(yy, 7, 2); return [new Date(yy, 7, d.getDate() - 10), new Date(yy, 7, d.getDate(), 23, 59)]; },
    namorados: () => [new Date(yy, 5, 2), new Date(yy, 5, 12, 23, 59)],
  })[theme]();
  let r = make(y); if (r[1] < now) r = make(y + 1);
  return r;
}

// ================================================================ cena 3D
let THREE = null;
async function three() {
  if (!THREE) THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  return THREE;
}
function webgl() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

function shapeOf(T, kind) {
  const s = new T.Shape();
  if (kind === 'tag') {
    s.moveTo(-1.1, 0); s.lineTo(-0.55, 0.62); s.lineTo(1.0, 0.62); s.quadraticCurveTo(1.2, 0.62, 1.2, 0.42);
    s.lineTo(1.2, -0.42); s.quadraticCurveTo(1.2, -0.62, 1.0, -0.62); s.lineTo(-0.55, -0.62); s.closePath();
    const h = new T.Path(); h.absarc(-0.55, 0, 0.14, 0, Math.PI * 2, true); s.holes.push(h);
  } else if (kind === 'heart') {
    s.moveTo(0, -0.9); s.bezierCurveTo(-0.2, -0.65, -1.2, -0.2, -1.05, 0.38); s.bezierCurveTo(-0.95, 0.85, -0.3, 1.0, 0, 0.55);
    s.bezierCurveTo(0.3, 1.0, 0.95, 0.85, 1.05, 0.38); s.bezierCurveTo(1.2, -0.2, 0.2, -0.65, 0, -0.9);
  } else if (kind === 'star') {
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.45 : 1.05; const a = (i / 10) * Math.PI * 2 + Math.PI / 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    s.closePath();
  } else if (kind === 'tie') {
    s.moveTo(-0.28, 1.0); s.lineTo(0.28, 1.0); s.lineTo(0.16, 0.72); s.lineTo(0.42, -0.6); s.lineTo(0, -1.05); s.lineTo(-0.42, -0.6); s.lineTo(-0.16, 0.72); s.closePath();
  }
  return s;
}

function makeObject(T, kind, c) {
  const g = new T.Group();
  const mat = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.25, ...o });
  if (['tag', 'heart', 'star', 'tie'].includes(kind)) {
    const geo = new T.ExtrudeGeometry(shapeOf(T, kind), { depth: 0.28, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 4, curveSegments: 24 });
    geo.center();
    const m = new T.Mesh(geo, mat(kind === 'tag' ? c.acc : kind === 'star' ? c.acc : c.acc, kind === 'tag' ? { emissive: new T.Color(c.acc2), emissiveIntensity: 0.15 } : kind === 'star' ? { metalness: 0.8, roughness: 0.2 } : {}));
    g.add(m);
    if (kind === 'tag') { const ring = new T.Mesh(new T.TorusGeometry(0.17, 0.04, 12, 32), mat('#ffffff', { metalness: 0.9, roughness: 0.15 })); ring.position.set(-0.55, 0, 0.2); g.add(ring); }
    if (kind === 'tie') { const knot = new T.Mesh(new T.BoxGeometry(0.42, 0.3, 0.42), mat(c.acc2)); knot.position.y = 0.95; g.add(knot); }
  } else if (kind === 'gift') {
    const box = new T.Mesh(new T.BoxGeometry(1.2, 1.0, 1.2), mat(c.acc2));
    const r1 = new T.Mesh(new T.BoxGeometry(1.24, 1.02, 0.2), mat(c.acc, { metalness: 0.7, roughness: 0.25 }));
    const r2 = new T.Mesh(new T.BoxGeometry(0.2, 1.02, 1.24), r1.material);
    const lid = new T.Mesh(new T.BoxGeometry(1.32, 0.22, 1.32), box.material); lid.position.y = 0.58;
    const bow1 = new T.Mesh(new T.TorusGeometry(0.22, 0.07, 12, 32), r1.material); bow1.position.set(-0.18, 0.82, 0); bow1.rotation.y = Math.PI / 2;
    const bow2 = bow1.clone(); bow2.position.x = 0.18;
    g.add(box, r1, r2, lid, bow1, bow2); g.scale.setScalar(0.85);
  } else if (kind === 'pumpkin') {
    const geo = new T.SphereGeometry(1, 48, 32); const p = geo.attributes.position; const v = new T.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const a = Math.atan2(v.z, v.x); const k = 1 + 0.08 * Math.cos(a * 8); v.x *= k; v.z *= k; v.y *= 0.78; p.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals();
    const body = new T.Mesh(geo, mat(c.acc, { roughness: 0.55 }));
    const stem = new T.Mesh(new T.CylinderGeometry(0.08, 0.13, 0.4, 12), mat('#3D6B2A')); stem.position.y = 0.88; stem.rotation.z = 0.25;
    g.add(body, stem); g.scale.setScalar(0.8);
  }
  return g;
}

/**
 * Monta a cena 3D dentro de `host`. Devolve { stop, burst } ou null (sem WebGL).
 * opts: { count: objetos, interactive: true }
 */
export async function scene(host, themeKey, opts = {}) {
  const t = THEMES[themeKey]; if (!t || !host) return null;
  if (reduceMotion || !webgl()) return null;
  let T; try { T = await three(); } catch { return null; }
  const W = () => host.clientWidth || 360, H = () => host.clientHeight || 420;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(W(), H());
  renderer.domElement.className = 'esp-canvas'; host.append(renderer.domElement);
  const sc = new T.Scene();
  const cam = new T.PerspectiveCamera(50, W() / H(), 0.1, 100); cam.position.set(0, 0, 9);
  sc.add(new T.AmbientLight(0xffffff, 0.55));
  const key = new T.DirectionalLight(0xffffff, 1.1); key.position.set(3, 5, 6); sc.add(key);
  const rim = new T.PointLight(new T.Color(t.c.acc2), 18, 30); rim.position.set(-4, -2, 4); sc.add(rim);
  const warm = new T.PointLight(new T.Color(t.c.acc), 14, 30); warm.position.set(4, 3, 3); sc.add(warm);

  // objetos flutuando
  const n = opts.count || 7; const objs = [];
  for (let i = 0; i < n; i++) {
    const o = makeObject(T, t.object, t.c);
    const ang = (i / n) * Math.PI * 2;
    o.userData = { base: new T.Vector3(Math.cos(ang) * (2.2 + (i % 3) * 0.9), 1.4 + Math.sin(ang * 1.3) * 1.5, -1.5 - (i % 4) * 1.1), spin: 0.25 + Math.random() * 0.5, phase: Math.random() * 6, pop: 0 };
    o.scale.multiplyScalar(0.55 + Math.random() * 0.45);
    o.userData.s = o.scale.x; o.position.copy(o.userData.base); o.rotation.set(Math.random(), Math.random() * 6, Math.random() * 0.5);
    sc.add(o); objs.push(o);
  }
  // objeto principal (maior, na frente)
  const hero = makeObject(T, t.object, t.c); hero.scale.multiplyScalar(W() < 600 ? 1.2 : 1.5); hero.position.set(0, 1.9, 0.6); hero.userData = { spin: 0.4, phase: 0, pop: 0, hero: true, s: hero.scale.x }; sc.add(hero); objs.push(hero);

  // partículas de fundo
  const PN = t.particles === 'fireworks' ? 900 : 420;
  const pos = new Float32Array(PN * 3), vel = new Float32Array(PN * 3), col = new Float32Array(PN * 3), life = new Float32Array(PN);
  const cA = new T.Color(t.c.acc), cB = new T.Color(t.c.acc2), cW = new T.Color('#ffffff');
  const palette = t.particles === 'snow' ? [cW] : t.particles === 'confetti' ? [cA, cB, cW, new T.Color('#7BE0A8')] : [cA, cB];
  const reset = (i, top = false) => {
    pos[i * 3] = (Math.random() - 0.5) * 18; pos[i * 3 + 1] = top ? 7 + Math.random() * 3 : (Math.random() - 0.5) * 14; pos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
    const fall = ['snow', 'petals', 'hearts', 'confetti'].includes(t.particles);
    vel[i * 3] = (Math.random() - 0.5) * 0.01; vel[i * 3 + 1] = fall ? -(0.008 + Math.random() * 0.02) : 0.006 + Math.random() * 0.018; vel[i * 3 + 2] = 0;
    const cc = palette[(Math.random() * palette.length) | 0]; col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; life[i] = 1;
  };
  for (let i = 0; i < PN; i++) reset(i);
  if (t.particles === 'fireworks') for (let i = 0; i < PN; i++) { life[i] = 0; pos[i * 3 + 1] = -99; }
  const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(pos, 3)); pg.setAttribute('color', new T.BufferAttribute(col, 3));
  const dot = document.createElement('canvas'); dot.width = dot.height = 64; const dc = dot.getContext('2d');
  const grd = dc.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); dc.fillStyle = grd; dc.fillRect(0, 0, 64, 64);
  const pm = new T.PointsMaterial({ size: t.particles === 'snow' ? 0.14 : t.particles === 'fireworks' ? 0.12 : 0.1, map: new T.CanvasTexture(dot), vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
  const pts = new T.Points(pg, pm); sc.add(pts);

  let fwNext = 0; let cursor = 0;
  function burst(x = (Math.random() - 0.5) * 8, y = Math.random() * 3, z = -2, count = 120) {
    for (let k = 0; k < count; k++) {
      const i = cursor; cursor = (cursor + 1) % PN;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), sp = 0.04 + Math.random() * 0.06;
      vel[i * 3] = Math.sin(b) * Math.cos(a) * sp; vel[i * 3 + 1] = Math.sin(b) * Math.sin(a) * sp; vel[i * 3 + 2] = Math.cos(b) * sp * 0.5;
      const cc = [cA, cB, cW][(Math.random() * 3) | 0]; col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; life[i] = 1;
    }
  }

  // ponteiro e inclinação do celular
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => { const r = host.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; look.tx = ((p.clientX - r.left) / r.width - 0.5) * 2; look.ty = ((p.clientY - r.top) / r.height - 0.5) * 2; };
  const onTilt = (e) => { if (e.gamma == null) return; look.tx = Math.max(-1, Math.min(1, e.gamma / 30)); look.ty = Math.max(-1, Math.min(1, (e.beta - 40) / 30)); };
  host.addEventListener('pointermove', onMove); addEventListener('deviceorientation', onTilt);
  // tocar num objeto: explosão de partículas
  const ray = new T.Raycaster(); const ndc = new T.Vector2();
  const onTap = (e) => {
    const r = host.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(objs, true)[0];
    if (hit) { let o = hit.object; while (o.parent && !objs.includes(o)) o = o.parent; o.userData.pop = 1; burst(hit.point.x, hit.point.y, hit.point.z, 160); opts.onTap?.(); }
  };
  if (opts.interactive !== false) host.addEventListener('pointerdown', onTap);

  const onResize = () => { renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); };
  addEventListener('resize', onResize);

  let running = true, raf = 0; const clock = new T.Clock();
  const io = new IntersectionObserver((es) => { running = es[0].isIntersecting; if (running) loop(); }, { threshold: 0.01 });
  io.observe(host);
  function loop() {
    cancelAnimationFrame(raf);
    if (!running || document.hidden) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05); const el = clock.elapsedTime;
    look.x += (look.tx - look.x) * 0.05; look.y += (look.ty - look.y) * 0.05;
    cam.position.x = look.x * 1.2; cam.position.y = -look.y * 0.8; cam.lookAt(0, 0, 0);
    for (const o of objs) {
      const u = o.userData;
      o.rotation.y += u.spin * dt * (u.hero ? 0.8 : 1); o.rotation.x = Math.sin(el * 0.6 + u.phase) * 0.25;
      if (u.base) o.position.y = u.base.y + Math.sin(el * 0.9 + u.phase) * 0.25;
      else o.position.y = 1.9 + Math.sin(el * 1.2) * 0.12;
      if (u.pop > 0) { u.pop = Math.max(0, u.pop - dt * 1.8); const s = 1 + Math.sin(u.pop * Math.PI) * 0.35; o.scale.setScalar(u.s * s); o.rotation.y += u.pop * 0.3; }
    }
    // partículas
    for (let i = 0; i < PN; i++) {
      if (t.particles === 'fireworks') {
        if (life[i] <= 0) continue;
        vel[i * 3 + 1] -= 0.0009; pos[i * 3] += vel[i * 3]; pos[i * 3 + 1] += vel[i * 3 + 1]; pos[i * 3 + 2] += vel[i * 3 + 2];
        life[i] -= dt * 0.55; const f = Math.max(0, life[i]); col[i * 3] *= 0.995; col[i * 3 + 1] *= 0.995; col[i * 3 + 2] *= 0.995;
        if (f <= 0) pos[i * 3 + 1] = -99;
        continue;
      }
      pos[i * 3] += vel[i * 3] + (t.particles === 'snow' || t.particles === 'petals' ? Math.sin(el + i) * 0.003 : 0);
      pos[i * 3 + 1] += vel[i * 3 + 1];
      if (pos[i * 3 + 1] < -8 || pos[i * 3 + 1] > 8) reset(i, vel[i * 3 + 1] < 0);
    }
    if (t.particles === 'fireworks' && el > fwNext) { burst(undefined, undefined, undefined, 140); fwNext = el + 0.9 + Math.random() * 1.2; }
    if (t.particles === 'neon') pm.opacity = 0.75 + Math.sin(el * 6) * 0.2;
    pg.attributes.position.needsUpdate = true; pg.attributes.color.needsUpdate = true;
    renderer.render(sc, cam);
  }
  loop();
  return {
    burst: () => burst(0, 0.5, 1, 220),
    stop() {
      running = false; cancelAnimationFrame(raf); io.disconnect();
      host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerdown', onTap);
      removeEventListener('deviceorientation', onTilt); removeEventListener('resize', onResize);
      sc.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); }); });
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
