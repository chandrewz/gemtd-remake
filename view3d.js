// Gem TD Remastered: the 3D board. Loaded on demand when the player turns on 3D view.
// It only reads the game's state (S, DEFS, the map constants) and draws it; every rule, tick and replay stays in index.html.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const G = window.GemGame;   // the game's live bindings, published by index.html
const { GW, GH, PORTAL, CASTLE, CPS, NOBUILD, IDX, DEFS, GT, ARMOR, QN } = G.consts;
const wx = x => x - GW/2 + .5, wz = y => y - GH/2 + .5;   // tile index -> world
const px = x => x - GW/2, pz = y => y - GH/2;              // continuous tile coords (centres at +.5) -> world

function mkRng(a){ a >>>= 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash3 = (x,y,z) => { const s = Math.sin(x*127.1 + y*311.7 + z*74.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x,y,z){ const xi=Math.floor(x), yi=Math.floor(y), zi=Math.floor(z), xf=x-xi, yf=y-yi, zf=z-zi;
  const u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf), w=zf*zf*(3-2*zf), L=(a,b,t)=>a+(b-a)*t, c=(i,j,k)=>hash3(xi+i,yi+j,zi+k);
  return L(L(L(c(0,0,0),c(1,0,0),u), L(c(0,1,0),c(1,1,0),u), v), L(L(c(0,0,1),c(1,0,1),u), L(c(0,1,1),c(1,1,1),u), v), w); }
const fbm = (x,y,z) => vnoise(x,y,z)*.55 + vnoise(x*2.1,y*2.1,z*2.1)*.3 + vnoise(x*4.3,y*4.3,z*4.3)*.15;

let renderer, scene, camera, controls, composer, bloom, envTex, canvas, host, labels, running = false, raf = 0;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

/* ================= textures ================= */
function canvasTex(w, h, draw, repeat){ const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); } return t; }
let grassTex, stoneTex, glowTex, dashTex, frameTex;
function makeTextures(){
  grassTex = canvasTex(512, 512, (g,w,h) => { const r = mkRng(3); g.fillStyle = '#41722f'; g.fillRect(0,0,w,h);
    for (let i=0;i<9000;i++){ g.fillStyle = `hsla(${88+r()*30},${40+r()*25}%,${24+r()*22}%,${.25+r()*.35})`; g.fillRect(r()*w, r()*h, 1+r()*2, 2+r()*5); } }, 46);
  stoneTex = canvasTex(256, 256, (g,w,h) => { const r = mkRng(9); g.fillStyle = '#8b8c88'; g.fillRect(0,0,w,h);
    for (let i=0;i<2600;i++){ const v = 110+r()*70|0; g.fillStyle = `rgba(${v},${v-3},${v-8},${.18+r()*.3})`; g.fillRect(r()*w, r()*h, 1+r()*3, 1+r()*3); }
    g.strokeStyle = 'rgba(40,38,34,.3)'; g.lineWidth = 1.2;
    for (let i=0;i<7;i++){ g.beginPath(); let x=r()*w, y=r()*h; g.moveTo(x,y); for (let k=0;k<5;k++){ x+=(r()-.5)*60; y+=(r()-.5)*60; g.lineTo(x,y); } g.stroke(); } });
  glowTex = canvasTex(128, 128, (g,w) => { const gr = g.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);
    gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.25,'rgba(255,255,255,.5)'); gr.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0,0,w,w); });
  dashTex = canvasTex(64, 8, (g,w,h) => { g.clearRect(0,0,w,h); g.fillStyle = '#fff'; g.fillRect(0,0,w*.55,h); }); dashTex.wrapS = THREE.RepeatWrapping;
  frameTex = canvasTex(64, 64, (g,w) => { g.clearRect(0,0,w,w); g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3; g.strokeRect(3,3,w-6,w-6); });
}
// a dark studio with a few softboxes: gems and gold get crisp light and dark facets
function studio(){ const sc = new THREE.Scene(); sc.background = new THREE.Color(0x10131c);
  const box = (w,h,x,y,z,c,i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({color:new THREE.Color(c).multiplyScalar(i), side:THREE.DoubleSide})); m.position.set(x,y,z); m.lookAt(0,0,0); sc.add(m); };
  box(6,3, 0,8,0, 0xffffff, 2.2); box(3,6, -8,3,2, 0xfff1dc, 2.2); box(3,6, 8,2,-3, 0xdfe9ff, 1.8); box(5,1.2, 2,1,8, 0xffffff, 1.6); box(2,2, -3,-6,-5, 0x99aacc, .8);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(40,40), new THREE.MeshBasicMaterial({color:0x2a2a24})); fl.rotation.x = -Math.PI/2; fl.position.y = -6; sc.add(fl);
  return sc; }

/* ================= shared helpers ================= */
const glowSprite = (color, size, opacity=.8) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, color, blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity}));
  s.scale.set(size, size, 1); return s; };
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
const pool = (color, r, op) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({map:glowTex, color, transparent:true, opacity:op, blending:THREE.AdditiveBlending, depthWrite:false}));
  m.rotation.x = -Math.PI/2; m.position.y = .012; return m; };
function boulder(r, seed, {flat=.62, lump=.42, moss=.55, sink=.3, rough=false} = {}){
  let g = new THREE.IcosahedronGeometry(1, 3); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position, o = seed*13.7, cols = new Float32Array(p.count*3), base = new THREE.Color(), mossC = new THREE.Color();
  for (let i=0;i<p.count;i++){ let x=p.getX(i), y=p.getY(i), z=p.getZ(i);
    const n = fbm(x*1.6+o, y*1.6, z*1.6-o), d = 1 + (n-.5)*lump*2 + (rough ? (vnoise(x*7+o,y*7,z*7)-.5)*.12 : 0);
    x*=d*r; y*=d*r*flat; z*=d*r; if (y < -r*flat*sink) y = -r*flat*sink + (y + r*flat*sink)*.15;
    p.setXYZ(i, x, y, z);
    const up = Math.max(0, y/(r*flat)), m = THREE.MathUtils.smoothstep(up + (fbm(x*3+o,y*3,z*3)-.5)*.8, .35, .75)*moss, shade = .82 + vnoise(x*5-o,y*5,z*5)*.3;
    base.setRGB(.24*shade, .225*shade, .2*shade); mossC.setRGB(.1, .2, .04); base.lerp(mossC, m); cols[i*3]=base.r; cols[i*3+1]=base.g; cols[i*3+2]=base.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals(); g.translate(0, r*flat*sink, 0); return g; }
function crystal(r, h, {n=6, tip='point', tipH=r*1.6, taper=.85, jit=.12, seed=1} = {}){
  const R = mkRng(seed), v = [], f = [], ring = (y, rr) => { const s = v.length; for (let i=0;i<n;i++){ const a = i/n*Math.PI*2 + (R()-.5)*jit, q = rr*(1+(R()-.5)*jit*1.5); v.push([Math.cos(a)*q, y, Math.sin(a)*q]); } return s; };
  const b0 = ring(-r*.6, r*.9), b1 = ring(0, r), t1 = ring(h, r*taper);
  for (let i=0;i<n;i++){ const j=(i+1)%n; f.push([b0+i,b0+j,b1+j],[b0+i,b1+j,b1+i],[b1+i,b1+j,t1+j],[b1+i,t1+j,t1+i]); }
  const cap = (top, base, dir) => { if (top==='flat'){ const t2 = ring(h + dir*r*.12, r*taper*.72); for (let i=0;i<n;i++){ const j=(i+1)%n; f.push([base+i,base+j,t2+j],[base+i,t2+j,t2+i]); }
      const c = v.length; v.push([0, h + dir*r*.12, 0]); for (let i=0;i<n;i++) f.push(dir>0 ? [t2+i,t2+(i+1)%n,c] : [t2+(i+1)%n,t2+i,c]); return; }
    const c = v.length, off = top==='wedge' ? r*.45 : 0; v.push([off*(R()-.5)*2, (dir>0 ? h : -r*.6) + dir*tipH*(.8+R()*.4), off*(R()-.5)]);
    for (let i=0;i<n;i++) f.push(dir>0 ? [base+i,base+(i+1)%n,c] : [base+(i+1)%n,base+i,c]); };
  cap(tip, t1, 1); cap('point', b0, -1);
  const pos = []; for (const tri of f) for (const k of tri) pos.push(...v[k]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; }

/* ================= materials ================= */
let M = {};
function makeMaterials(){
  M.rock = new THREE.MeshStandardMaterial({vertexColors:true, roughness:.92});
  M.silver = new THREE.MeshStandardMaterial({color:0xdfe5f0, metalness:1, roughness:.22, envMap:envTex});
  M.gold = new THREE.MeshStandardMaterial({color:0xe7b84c, metalness:1, roughness:.26, envMap:envTex});
  M.iron = new THREE.MeshStandardMaterial({color:0x5a606b, metalness:.85, roughness:.42, envMap:envTex});
  M.bronze = new THREE.MeshStandardMaterial({color:0xb37b40, metalness:1, roughness:.34, envMap:envTex});
  M.polish = new THREE.MeshPhysicalMaterial({color:0x262a35, roughness:.22, clearcoat:.9, clearcoatRoughness:.1, envMap:envTex, envMapIntensity:.7});
  M.marble = new THREE.MeshPhysicalMaterial({color:0xf2eee8, roughness:.18, clearcoat:.8, envMap:envTex, envMapIntensity:.6});
  M.glass = new THREE.MeshPhysicalMaterial({envMap:envTex, color:0x14111c, roughness:.03, metalness:.1, clearcoat:1, clearcoatRoughness:0, envMapIntensity:2.6, flatShading:true, sheen:1, sheenColor:new THREE.Color(0x5544aa)});
}
const matCache = {};
function shellMat(t, q){ const k = 's'+t+q; if (matCache[k]) return matCache[k];
  const c = new THREE.Color(GT[t].color), dull = q<=2, deep = c.clone().multiplyScalar(t==='D' ? .85 : t==='O' ? .9 : .5);
  const m = new THREE.MeshPhysicalMaterial({ color:deep, flatShading:t!=='O', roughness: dull ? .35 : .05, metalness:0,
    transmission: dull ? .15 : (t==='D' ? .6 : .45), thickness:.8, ior: t==='D' ? 2.4 : 1.7, attenuationColor:c, attenuationDistance:.4,
    clearcoat: dull ? .3 : 1, clearcoatRoughness:.05, envMap:envTex, envMapIntensity: dull ? .8 : 2.2,
    emissive:c, emissiveIntensity: t==='D' ? .05 : dull ? .05 : .14 });
  if (t==='O'){ m.iridescence = 1; m.iridescenceIOR = 2.0; m.iridescenceThicknessRange = [250, 1200]; m.roughness = .12; m.color.set('#a99cc4'); m.transmission = .2; m.emissive.set('#ff9ad0'); m.emissiveIntensity = .08; }
  return matCache[k] = m; }
function coreMat(t, q){ const k = 'c'+t+q; if (matCache[k]) return matCache[k];
  const c = new THREE.Color(GT[t].color); if (t==='D') c.setRGB(.85,.92,1);
  return matCache[k] = new THREE.MeshBasicMaterial({color:c.multiplyScalar(q<=2 ? .5 : 1.1 + q*.12), transparent:true, opacity:q<=2 ? .5 : .85, blending:THREE.AdditiveBlending, depthWrite:false}); }

/* ================= basic gems: one silhouette per level, bigger every level ================= */
const HABIT = {
  A:{n:6, tip:'point', slim:.9,  tipK:1.9}, Q:{n:6, tip:'point', slim:.55, tipK:1.2}, D:{n:4, tip:'octa', slim:1.1, tipK:1}, E:{n:6, tip:'flat', slim:.8, tipK:0},
  O:{n:0, tip:'node', slim:1, tipK:0}, R:{n:6, tip:'point', slim:1.15, tipK:.8}, S:{n:6, tip:'point', slim:.95, tipK:2.4}, T:{n:8, tip:'wedge', slim:.8, tipK:1.1} };
const LEVEL = { h:[0,.22,.3,.4,.52,.66,.84], r:[0,.05,.056,.064,.072,.082,.098], sides:[0,0,1,2,3,4,6] };
function habitGeo(t, r, h, seed, rough){
  if (t==='D'){ const g = new THREE.OctahedronGeometry(r*1.7, 0); g.scale(1, 1.3, 1); g.translate(0, h*.5, 0); return g; }
  if (t==='O'){ let g = new THREE.IcosahedronGeometry(r*1.6, 2); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
    const p = g.attributes.position; for (let k=0;k<p.count;k++){ const d = 1 + (fbm(p.getX(k)*6+seed, p.getY(k)*6, p.getZ(k)*6)-.5)*.2; p.setXYZ(k, p.getX(k)*d, p.getY(k)*d*1.15, p.getZ(k)*d); }
    g.computeVertexNormals(); g.translate(0, r*1.6 + h*.25, 0); return g.toNonIndexed(); }
  const H = HABIT[t]; return crystal(r, h, {n:H.n, tip:H.tip, tipH:r*H.tipK, taper: t==='R' ? 1.05 : .82, seed, jit: rough ? .28 : .06}); }
function gemCluster(t, q){
  const H = HABIT[t], shells = [], cores = [], height = LEVEL.h[q], n = LEVEL.sides[q] + 1;
  for (let i=0;i<n;i++){
    const main = i===0, ang = main ? 0 : (i-1)/(n-1)*Math.PI*2 + .6, dist = main ? 0 : LEVEL.r[q]*1.7;
    const h = main ? height : height*(i%2 ? .6 : .5), r = LEVEL.r[q]*H.slim*(main ? 1 : .72);
    const g = habitGeo(t, r, h, 11 + i, q===1);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(main ? 0 : -.42).premultiply(new THREE.Matrix4().makeRotationY(-ang)).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(ang)*dist, 0, Math.sin(ang)*dist)));
    if (q===1){ const p = g.attributes.position, cut = height*.62; for (let k=0;k<p.count;k++) if (p.getY(k) > cut) p.setY(k, cut + (p.getY(k)-cut)*.25); g.computeVertexNormals(); }
    shells.push(g);
    const core = g.clone(), c = new THREE.Vector3(); core.computeBoundingBox(); core.boundingBox.getCenter(c); core.translate(-c.x,-c.y,-c.z); core.scale(.55,.7,.55); core.translate(c.x,c.y,c.z); cores.push(core);
  }
  const ni = g => g.index ? g.toNonIndexed() : g;
  return {shell:mergeGeometries(shells.map(ni)), core:mergeGeometries(cores.map(ni)), height}; }
// worked bases following the 2D ladder: round iron, bronze triangle, slate diamond, silver hexagon, gold octagon, marble and gold
function socket(q){ const g = new THREE.Group(); let y = 0;
  const tier = (rt, rb, h, n, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, n), mat); m.position.y = y + h/2; if (n===4) m.rotation.y = Math.PI/4; if (n===3) m.rotation.y = Math.PI/6; g.add(m); y += h; return m; };
  const rim = (r, n, mat) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, .016, 5, n), mat); m.rotation.x = Math.PI/2; m.rotation.z = n===4 ? Math.PI/4 : n===3 ? Math.PI/6 + Math.PI/2 : Math.PI/n; m.position.y = y; g.add(m); };
  const prongs = (k, r, len, mat) => { for (let i=0;i<k;i++){ const a = i/k*Math.PI*2 + .3, p = new THREE.Mesh(new THREE.CylinderGeometry(.01, .018, len, 5), mat);
    p.position.set(Math.cos(a)*r*.75, y + len*.42, Math.sin(a)*r*.75); p.lookAt(0, y + len*1.6, 0); p.rotateX(Math.PI/2); g.add(p); } };
  if (q===1){ tier(.16, .19, .06, 16, M.iron); }
  if (q===2){ tier(.24, .28, .09, 3, M.bronze); }
  if (q===3){ tier(.27, .31, .1, 4, M.polish); rim(.29, 4, M.iron); tier(.17, .21, .06, 4, M.iron); }
  if (q===4){ tier(.3, .34, .1, 6, M.polish); rim(.32, 6, M.silver); tier(.22, .27, .12, 6, M.polish); rim(.245, 6, M.silver); prongs(3, .22, .22, M.silver); }
  if (q===5){ tier(.33, .37, .11, 8, M.polish); rim(.35, 8, M.gold); tier(.25, .3, .14, 8, M.polish); rim(.275, 8, M.gold); tier(.17, .19, .05, 8, M.gold); prongs(4, .2, .3, M.gold); }
  if (q===6){ tier(.38, .42, .11, 40, M.marble); rim(.4, 40, M.gold); tier(.3, .35, .14, 40, M.marble); rim(.325, 40, M.gold); tier(.21, .25, .08, 40, M.gold); prongs(6, .22, .38, M.gold); }
  return {g, top:y}; }
function buildGem(t, q){
  const g = new THREE.Group(), col = new THREE.Color(GT[t].color), sock = socket(q); g.add(sock.g);
  const cl = gemCluster(t, q), lift = sock.top - .02;
  const shell = new THREE.Mesh(cl.shell, shellMat(t, q)); shell.position.y = lift; g.add(shell);
  const core = new THREE.Mesh(cl.core, coreMat(t, q)); core.position.y = lift; g.add(core);
  g.add(pool(col, .45 + q*.08, q<=2 ? .05 : .06 + q*.02));
  g.add(at(glowSprite(col, .25 + q*.13, q<=2 ? .08 : .1 + q*.025), 0, lift + cl.height*.5, 0));
  return {g, top:lift + cl.height*.8};
}

/* ================= special towers ================= */
// the gallery's own models (Tower3D meshes, already in tile units with y up) turned into real geometry
const t3dMats = new WeakMap();
function t3dMat(m){ if (t3dMats.has(m)) return t3dMats.get(m); let out;
  const c3 = a => new THREE.Color(a[0], a[1], a[2]);
  if (m.kind==='metal') out = new THREE.MeshStandardMaterial({color:c3(m.tint), metalness:1, roughness:.28, envMap:envTex, side:THREE.DoubleSide});
  else if (m.kind==='stone') out = new THREE.MeshStandardMaterial({color:c3(m.col), roughness:Math.max(.25, .85 - (m.spec||0)*.5), envMap:envTex, envMapIntensity:.4, flatShading:true, side:THREE.DoubleSide});
  else if (m.kind==='emissive') out = new THREE.MeshStandardMaterial({color:c3(m.col), emissive:c3(m.col), emissiveIntensity:1.2, roughness:.6, flatShading:true, side:THREE.DoubleSide});
  else if (m.kind==='rainbow') out = new THREE.MeshPhysicalMaterial({color:0xffffff, roughness:0, transmission:.6, thickness:.6, iridescence:1, iridescenceIOR:2, iridescenceThicknessRange:[250,1200], envMap:envTex, envMapIntensity:2.4, flatShading:true, side:THREE.DoubleSide});
  else { const col = c3(m.col), glow = c3(m.glow || m.col);
    out = new THREE.MeshPhysicalMaterial({color:col.clone().multiplyScalar(.6), roughness:.04, transmission:.4, thickness:.6, ior:1.75, attenuationColor:col, attenuationDistance:.4, clearcoat:1,
      envMap:envTex, envMapIntensity:2.2, emissive:glow, emissiveIntensity:.18, flatShading:true, side:THREE.DoubleSide}); }
  t3dMats.set(m, out); return out; }
function t3dMesh(m){ const pos = [];
  for (const f of m.f) for (let i=1;i<f.length-1;i++) for (const k of [f[0], f[i], f[i+1]]) pos.push(...m.v[k]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; }
const FXCOL = {frost:'#bff7ff', fireflash:'#ffb050', asterism:'#fff4d0', opal:'#ffc8f0', nebula:'#c08cff', fire:'#ff8a30', inferno:'#ff6a20', phoenix:'#ffb050', beams:'#ffe08a', blood:'#ff3050'};
function buildDesign(key, d){
  const {m, fx} = G.Tower3D.design(key, d), g = new THREE.Group(), byMat = new Map(), S = .95;
  for (const x of m){ if (!byMat.has(x.mat)) byMat.set(x.mat, []); byMat.get(x.mat).push(t3dMesh(x)); }
  let top = 0;
  for (const [mat, geos] of byMat){ const geo = mergeGeometries(geos); geo.scale(S, S, S); geo.computeBoundingBox(); top = Math.max(top, geo.boundingBox.max.y); g.add(new THREE.Mesh(geo, t3dMat(mat))); }
  let embers = false;
  for (const f of fx){ const [kind, y, r, col] = f; if (typeof y !== 'number') continue;
    const c = new THREE.Color(typeof col === 'string' && col[0]==='#' ? col : FXCOL[kind] || d.color || '#ffffff');
    if (kind==='fire' || kind==='inferno' || kind==='phoenix') embers = true;
    const size = typeof r === 'number' ? Math.min(1.2, r*3.2) : .5;
    g.add(at(glowSprite(c, size, kind==='pool' ? .25 : .32), 0, y*S, 0)); }
  g.add(pool(new THREE.Color(d.color || '#ffffff'), .75, .16));
  return {g, top:top*.8, embers}; }
function buildGreat(){
  const g = new THREE.Group(), keys = Object.keys(GT);
  let y = 0; const tier = (rt, rb, h, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 48), mat); m.position.y = y + h/2; g.add(m); y += h; };
  const rim = r => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, .02, 6, 64), M.gold); m.rotation.x = Math.PI/2; m.position.y = y; g.add(m); };
  tier(.47, .5, .1, M.marble); rim(.485); tier(.38, .43, .12, M.marble); rim(.4); tier(.27, .31, .07, M.gold);
  keys.forEach((k,i) => { const a = i/8*Math.PI*2 + Math.PI/8, x = Math.cos(a)*.43, z = Math.sin(a)*.43;
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(.025, .03, .34, 8), M.gold); pil.position.set(x, .27, z); g.add(pil);
    const orb = new THREE.Mesh(habitGeo(k, .03, .07, 5, false), shellMat(k, 6)); orb.position.set(x, .44, z); g.add(orb);
    g.add(at(glowSprite(new THREE.Color(GT[k].color), .2, .3), x, .48, z)); });
  const spire = new THREE.Group(); spire.position.y = .78; g.add(spire);
  const white = new THREE.MeshPhysicalMaterial({envMap:envTex, color:0xdfe6ff, roughness:0, transmission:.6, thickness:1.2, ior:2.4, iridescence:1, iridescenceIOR:2.0, iridescenceThicknessRange:[300,1200], clearcoat:1, envMapIntensity:1.6, flatShading:true, emissive:0xffffff, emissiveIntensity:.02});
  const mainG = crystal(.12, .7, {n:6, tipH:.22, seed:3, jit:.04}); mainG.translate(0, -.3, 0);
  const bottom = mainG.clone(); bottom.rotateX(Math.PI); bottom.translate(0, -.15, 0); bottom.scale(.8,.55,.8);
  spire.add(new THREE.Mesh(mergeGeometries([mainG, bottom]), white));
  spire.add(new THREE.Mesh(mainG.clone().scale(.5,.75,.5), new THREE.MeshBasicMaterial({color:new THREE.Color(.35,.38,.48), transparent:true, opacity:.5, blending:THREE.AdditiveBlending, depthWrite:false})));
  keys.forEach((k,i) => { const a = i/8*Math.PI*2, c = crystal(.045, .26, {n:6, seed:i+2, tipH:.08}); c.rotateZ(-.55); c.rotateY(-a); c.translate(Math.cos(a)*.12, -.18 + (i%2)*.06, Math.sin(a)*.12); spire.add(new THREE.Mesh(c, shellMat(k, 6))); });
  const orbits = new THREE.Group(); orbits.position.y = .95; g.add(orbits);
  for (const [r, tilt, n] of [[.55, .35, 14], [.7, -.25, 18]]){ const ring = new THREE.Group(); ring.rotation.set(tilt, 0, tilt*.6);
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, .006, 4, 96), M.gold); band.rotation.x = Math.PI/2; ring.add(band);
    for (let i=0;i<n;i++){ const a = i/n*Math.PI*2; ring.add(at(glowSprite(new THREE.Color(GT[keys[i%8]].color), .1, .55), Math.cos(a)*r, 0, Math.sin(a)*r)); }
    orbits.add(ring); }
  const beam = new THREE.ShaderMaterial({transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, uniforms:{t:{value:0}},
    vertexShader:`varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform float t; varying vec2 vU; void main(){ float a = (1.-vU.y)*(1.-vU.y)*.12*(.75+.25*sin(vU.y*20.-t*4.)); gl_FragColor = vec4(vec3(1.,.97,.9)*a, a); }`});
  const bm = new THREE.Mesh(new THREE.CylinderGeometry(.16, .3, 3.2, 32, 1, true), beam); bm.position.y = 1.9; g.add(bm);
  g.add(pool(0xfff4e0, 1.1, .18));
  g.scale.setScalar(1.2);
  return {g, top:1.2, anim:{spire, orbits, beam}, sparkle:true}; }
function buildAgate(){
  const g = new THREE.Group(), col = new THREE.Color('#5fd3a8');
  let y = 0; const tier = (rt, rb, h, mat, n=24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, n), mat); m.position.y = y + h/2; g.add(m); y += h; };
  tier(.34, .38, .1, M.polish); tier(.24, .29, .1, M.polish); tier(.08, .11, .22, M.gold, 12);
  const slice = new THREE.Group(); slice.position.y = y + .36; g.add(slice);
  ['#0a5a2c','#10c450','#f5eef4','#1ec9c4','#0a7a3c','#f7d6e6','#3fe0d8','#c8fff0'].forEach((b,i) => {
    const m = new THREE.MeshPhysicalMaterial({envMap:envTex, color:b, roughness:.12, clearcoat:1, transmission:.25, thickness:.2, emissive:b, emissiveIntensity:.35, side:THREE.DoubleSide});
    if (b==='#f5eef4'||b==='#f7d6e6'){ m.iridescence = 1; m.iridescenceIOR = 1.7; }
    const R0 = .34 - i*.038, shape = new THREE.Shape();
    for (let k=0;k<=56;k++){ const a = k/56*Math.PI*2, w = R0*(1 + (vnoise(Math.cos(a)*1.7+i*.3, Math.sin(a)*1.7, 2)-.5)*.22); shape[k?'lineTo':'moveTo'](Math.cos(a)*w*.92, Math.sin(a)*w*1.12); }
    const geo = new THREE.ExtrudeGeometry(shape, {depth:.05 + i*.004, bevelEnabled:true, bevelThickness:.008, bevelSize:.006, bevelSegments:2, curveSegments:4}); geo.translate(0, 0, -(.025 + i*.002));
    slice.add(new THREE.Mesh(geo, m)); });
  const druse = []; for (let i=0;i<22;i++){ const a = i*2.4, rr = Math.sqrt(i/22)*.05; for (const s of [1,-1]){ const c = crystal(.01, .022, {n:6, seed:i}); c.rotateX(s*Math.PI/2); c.translate(Math.cos(a)*rr, Math.sin(a)*rr*1.2, s*.05); druse.push(c); } }
  slice.add(new THREE.Mesh(mergeGeometries(druse), new THREE.MeshPhysicalMaterial({envMap:envTex, color:0xe8fff8, transmission:.6, roughness:0, flatShading:true, emissive:0x9af5d5, emissiveIntensity:.9})));
  const frame = new THREE.Mesh(new THREE.TorusGeometry(.355, .022, 8, 64), M.gold); frame.scale.set(.93, 1.13, 1); slice.add(frame);
  g.add(pool(col, 1, .3)); g.add(at(glowSprite(col, 1.1, .22), 0, slice.position.y, 0));
  return {g, top:slice.position.y, anim:{slice}}; }
function buildObsidian(){
  const g = new THREE.Group(), col = new THREE.Color('#7a6cff');
  const pl = new THREE.Mesh(new THREE.CylinderGeometry(.3, .36, .14, 8), M.glass); pl.position.y = .07; g.add(pl);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.33, .016, 5, 8), M.gold); rim.rotation.x = Math.PI/2; rim.rotation.z = Math.PI/8; rim.position.y = .14; g.add(rim);
  const R = mkRng(9), sh = [];
  for (let i=0;i<8;i++){ const main = i===0, h = main ? .95 : .35 + R()*.4, r = main ? .085 : .05 + R()*.03, a = i*2.4;
    const c = crystal(r, h, {n:4, seed:9+i, tipH:r*3, taper:.6, jit:.35}); c.rotateZ(main ? .05 : -(.3 + R()*.5)); c.rotateY(a); c.translate(main?0:Math.cos(a)*.1, .14, main?0:Math.sin(a)*.1); sh.push(c); }
  g.add(new THREE.Mesh(mergeGeometries(sh), M.glass));
  [['S',-.07,.6,.07],['T',.08,.5,.06],['D',.01,.78,.05]].forEach(([k,x,y,z]) => { const b = new THREE.Mesh(new THREE.OctahedronGeometry(.045,0), shellMat(k,5)); b.position.set(x,y,z); g.add(b); g.add(at(glowSprite(new THREE.Color(GT[k].color), .3, .5), x,y,z)); });
  g.add(pool(col, .85, .2));
  return {g, top:.8}; }
function buildRock(seed){ const r = mkRng(seed), g = new THREE.Group(); g.rotation.y = r()*6;
  g.add(new THREE.Mesh(boulder(.34 + r()*.06, seed, {flat:.7 + r()*.2, lump:.45, moss:.22, sink:.25}), M.rock));
  for (let k=0;k<2;k++){ const p = new THREE.Mesh(boulder(.08 + r()*.05, seed+k+9, {flat:.7, lump:.4, moss:.3, sink:.2}), M.rock); p.position.set((r()-.5)*.7, 0, (r()-.5)*.7); g.add(p); }
  return {g, top:.3}; }

// prototypes are built once per key and cloned (clones share geometry and materials)
const protos = new Map();
function proto(key){
  if (protos.has(key)) return protos.get(key);
  const d = DEFS[key]; let p;
  try {
    if (key.startsWith('rock')) p = buildRock(+key.slice(4) || 1);
    else if (d.kind==='gem') p = buildGem(d.type, d.q);
    else if (key==='bryvx') p = buildGreat();
    else if (key==='agate') p = buildAgate();
    else if (key==='obsidian') p = buildObsidian();
    else p = buildDesign(key, d);
  } catch(err){ console.error('3D model failed for', key, err); p = buildRock(3); }
  p.g.traverse(o => { if (o.isMesh && !(o.material.blending === THREE.AdditiveBlending)){ o.castShadow = true; o.receiveShadow = true; } });
  protos.set(key, p); return p; }
function instance(key){ const p = proto(key), g = p.g.clone(true);
  const inst = {g, top:p.top, embers:p.embers, sparkle:p.sparkle, anim:null};
  if (p.anim){ inst.anim = {}; const names = Object.keys(p.anim); const idx = new Map(); let i = 0; p.g.traverse(o => idx.set(o, i++)); i = 0; const list = []; g.traverse(o => list.push(o));
    for (const n of names){ const o = p.anim[n]; if (o.isObject3D) inst.anim[n] = list[idx.get(o)]; else inst.anim[n] = o; } }
  return inst; }

/* ================= static world ================= */
let tilesMesh, pathMesh = null, pathKey = null, hoverPath = null, hoverPathKey = null, flyLine, hl, selFrame, rangeRing, auraRings = [], portal, arrows = [], castleFlag;
function buildWorld(){
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({ side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{top:{value:new THREE.Color('#4f86c9')}, mid:{value:new THREE.Color('#a9c8e6')}, bot:{value:new THREE.Color('#e8d6b4')}},
    vertexShader:`varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform vec3 top, mid, bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > .08 ? mix(mid, top, smoothstep(.08,.6,h)) : mix(bot, mid, smoothstep(-.05,.08,h)); gl_FragColor = vec4(c,1.); }` })));
  scene.fog = new THREE.Fog(0xb9c9d4, 55, 150);
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.7); sun.position.set(-18, 30, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
  Object.assign(sun.shadow.camera, {left:-24, right:24, top:24, bottom:-24, near:1, far:90}); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, .85));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({map:grassTex, roughness:.95}));
  ground.rotation.x = -Math.PI/2; ground.position.y = -.7; ground.receiveShadow = true; scene.add(ground);
  const plateau = new THREE.Mesh(new RoundedBoxGeometry(GW+1.2, .9, GH+1.2, 3, .25), new THREE.MeshStandardMaterial({color:0x6d6a63, map:stoneTex, roughness:.9}));
  plateau.position.y = -.58; plateau.receiveShadow = true; scene.add(plateau);
  for (const [w,dd,x,z] of [[GW+.9,.18,0,-(GH/2+.4)],[GW+.9,.18,0,GH/2+.4],[.18,GH+.9,-(GW/2+.4),0],[.18,GH+.9,GW/2+.4,0]]){
    const k = new THREE.Mesh(new THREE.BoxGeometry(w,.1,dd), M.gold); k.position.set(x,-.07,z); scene.add(k); }
  tilesMesh = new THREE.InstancedMesh(new RoundedBoxGeometry(.985, .16, .985, 2, .025), new THREE.MeshStandardMaterial({map:stoneTex, roughness:.85}), GW*GH);
  { const m = new THREE.Matrix4(), col = new THREE.Color(), r = mkRng(11);
    for (let y=0;y<GH;y++) for (let x=0;x<GW;x++){ const i = IDX(x,y); m.makeTranslation(wx(x), -.08 - r()*.012, wz(y)); tilesMesh.setMatrixAt(i, m);
      const chk = (x+y)%2 ? 0 : .025, base = NOBUILD[i] ? [.62,.5,.32] : [.53+chk,.49+chk,.42+chk], v = (r()-.5)*.08; col.setRGB(base[0]+v, base[1]+v, base[2]+v*1.2); tilesMesh.setColorAt(i, col); } }
  tilesMesh.receiveShadow = true; scene.add(tilesMesh);

  // trees and boulders around the arena
  { const r = mkRng(5), trees = [];
    for (let i=0; trees.length<340 && i<5000; i++){ const a = r()*Math.PI*2, d = 22 + Math.pow(r(),.8)*48, x = Math.cos(a)*d*1.05, z = Math.sin(a)*d; if (Math.abs(x) < 19.5 && Math.abs(z) < 19.5) continue; trees.push([x,z,.8+r()*.8,r()]); }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.12,.18,1,6), new THREE.MeshStandardMaterial({color:0x5a3d26, roughness:.9}), trees.length);
    const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0), new THREE.MeshStandardMaterial({roughness:.8, flatShading:true}), trees.length*3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    trees.forEach(([x,z,sc,h], i) => { m.compose(p.set(x, -.7 + .6*sc, z), q.identity(), s.set(sc,1.2*sc,sc)); trunk.setMatrixAt(i, m);
      for (let k=0;k<3;k++){ const ls = (.95 - k*.2)*sc*(.85+r()*.3); q.setFromEuler(new THREE.Euler(r(), r()*3, r()));
        m.compose(p.set(x+(r()-.5)*.7*sc, -.7 + 1.3*sc + k*.45*sc, z+(r()-.5)*.7*sc), q, s.set(ls, ls*.9, ls)); leaves.setMatrixAt(i*3+k, m);
        c.setHSL(.22 + h*.1 + (r()-.5)*.03, .45 + r()*.2, .22 + r()*.1 + k*.03); leaves.setColorAt(i*3+k, c); } });
    trunk.castShadow = leaves.castShadow = true; scene.add(trunk, leaves); }

  // portal
  portal = new THREE.Group(); portal.position.set(wx(PORTAL.x), 0, wz(PORTAL.y)); scene.add(portal);
  { const rune = canvasTex(256, 256, (g,w) => { g.clearRect(0,0,w,w); g.translate(w/2,w/2); g.strokeStyle = 'rgba(200,160,255,.95)'; g.lineWidth = 3;
      g.beginPath(); g.arc(0,0,118,0,Math.PI*2); g.stroke(); g.lineWidth = 1.5; g.beginPath(); g.arc(0,0,100,0,Math.PI*2); g.stroke();
      for (let i=0;i<12;i++){ g.save(); g.rotate(i/12*Math.PI*2); g.translate(0,-109); g.beginPath(); g.moveTo(-5,-5); g.lineTo(5,5); g.moveTo(5,-5); g.lineTo(0,5); g.stroke(); g.restore(); } });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 48), new THREE.MeshBasicMaterial({map:rune, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, color:0xb88cff}));
    disc.rotation.x = -Math.PI/2; disc.position.y = .012; portal.add(disc); portal.userData.rune = disc;
    for (let i=0;i<8;i++){ const a = i/8*Math.PI*2, st = new THREE.Mesh(boulder(.13, i+3, {flat:3.2 + (i%2)*1.2, lump:.3, moss:.5, sink:.1}), M.rock); st.position.set(Math.cos(a)*1.3, 0, Math.sin(a)*1.3); st.castShadow = true; portal.add(st); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.85, .09, 12, 48), new THREE.MeshStandardMaterial({color:0x2a1d44, metalness:.6, roughness:.3, emissive:0x8a4dff, emissiveIntensity:1.4}));
    ring.position.y = 1.05; ring.rotation.y = Math.PI/4; portal.add(ring);
    const swirl = canvasTex(256, 256, (g,w) => { g.clearRect(0,0,w,w); g.translate(w/2,w/2); const gr = g.createRadialGradient(0,0,0,0,0,w/2);
      gr.addColorStop(0,'rgba(255,240,255,1)'); gr.addColorStop(.35,'rgba(170,110,255,.85)'); gr.addColorStop(1,'rgba(60,20,140,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0,0,w/2,0,Math.PI*2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; for (let k=0;k<4;k++){ g.beginPath(); for (let t=0;t<1;t+=.01){ const a = k*Math.PI/2 + t*5, rr = t*w*.48; g.lineTo(Math.cos(a)*rr, Math.sin(a)*rr); } g.stroke(); } });
    const vortex = new THREE.Mesh(new THREE.CircleGeometry(.8, 48), new THREE.MeshBasicMaterial({map:swirl, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide}));
    vortex.position.y = 1.05; vortex.rotation.y = Math.PI/4; portal.add(vortex); portal.userData.vortex = vortex;
    portal.add(at(glowSprite(new THREE.Color('#a873ff'), 3.4, .6), 0, 1.05, 0));
    const pl = new THREE.PointLight(0xa873ff, 6, 6, 1.6); pl.position.y = 1.1; portal.add(pl); }
  // checkpoints
  { const shape = new THREE.Shape(); shape.moveTo(.32,0); shape.lineTo(-.18,.28); shape.lineTo(-.08,0); shape.lineTo(-.18,-.28); shape.closePath();
    const aGeo = new THREE.ExtrudeGeometry(shape, {depth:.06, bevelEnabled:true, bevelThickness:.02, bevelSize:.02, bevelSegments:2});
    const aMat = new THREE.MeshStandardMaterial({envMap:envTex, color:0xf2c35b, metalness:.7, roughness:.25, emissive:0xf2a020, emissiveIntensity:.9});
    const ROT = {R:0, U:Math.PI/2, L:Math.PI, D:-Math.PI/2};
    CPS.forEach((c, i) => { const g = new THREE.Group(); g.position.set(wx(c.x), 0, wz(c.y)); scene.add(g);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(.46,.5,.08,32), M.gold); pad.position.y = .04; pad.receiveShadow = true; g.add(pad);
      const num = canvasTex(128, 128, (x) => { x.fillStyle = '#2a2110'; x.beginPath(); x.arc(64,64,62,0,7); x.fill(); x.fillStyle = '#f7d77e'; x.font = '600 74px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(i+1), 64, 68); });
      const face = new THREE.Mesh(new THREE.CircleGeometry(.38, 32), new THREE.MeshStandardMaterial({map:num, roughness:.5, metalness:.3})); face.rotation.x = -Math.PI/2; face.rotation.z = ROT[c.dir] - Math.PI/2; face.position.y = .081; g.add(face);
      const arrow = new THREE.Mesh(aGeo, aMat); arrow.rotation.x = -Math.PI/2; arrow.castShadow = true;
      const holder = new THREE.Group(); holder.rotation.y = ROT[c.dir]; holder.add(arrow); arrow.position.set(0,.55,0); g.add(holder);
      g.add(at(glowSprite(0xf2c35b, 1.3, .45), 0, .55, 0)); arrows.push({arrow, phase:i}); }); }
  // castle
  { const castle = new THREE.Group(); castle.position.set(wx(CASTLE.x), 0, wz(CASTLE.y)); scene.add(castle);
    const wall = new THREE.MeshStandardMaterial({color:0xd8d0bf, map:stoneTex, roughness:.8}), roofM = new THREE.MeshStandardMaterial({color:0x2d4fa8, roughness:.55, metalness:.2});
    const win = new THREE.MeshStandardMaterial({color:0xffd27a, emissive:0xffb040, emissiveIntensity:2});
    const add = (m, x, y, z) => { m.position.set(x,y,z); m.castShadow = m.receiveShadow = true; castle.add(m); return m; };
    add(new THREE.Mesh(new RoundedBoxGeometry(2.7,.25,2.7,2,.06), M.polish), 0,.12,0);
    for (const [w,dd,x,z] of [[2.2,.22,0,-1.1],[2.2,.22,0,1.1],[.22,2.2,-1.1,0],[.22,2.2,1.1,0]]){ add(new THREE.Mesh(new THREE.BoxGeometry(w,.85,dd), wall), x,.66,z);
      for (let k=0;k<6;k++){ const t = (k+.5)/6 - .5; add(new THREE.Mesh(new THREE.BoxGeometry(w>dd?.2:.26,.16,w>dd?.26:.2), wall), x + (w>dd?t*w:0), 1.16, z + (w>dd?0:t*dd)); } }
    for (const [x,z] of [[-1.1,-1.1],[1.1,-1.1],[-1.1,1.1],[1.1,1.1]]){ add(new THREE.Mesh(new THREE.CylinderGeometry(.32,.36,1.5,12), wall), x,.95,z);
      add(new THREE.Mesh(new THREE.ConeGeometry(.42,.7,12), roofM), x,2.05,z); add(new THREE.Mesh(new THREE.SphereGeometry(.05,8,6), M.gold), x,2.43,z); }
    add(new THREE.Mesh(new THREE.BoxGeometry(1.1,1.9,1.1), wall), 0,1.2,0);
    add(new THREE.Mesh(new THREE.ConeGeometry(.88,1.0,4), roofM), 0,2.65,0).rotation.y = Math.PI/4;
    add(new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,.8,6), M.gold), 0,3.45,0);
    castleFlag = add(new THREE.Mesh(new THREE.PlaneGeometry(.45,.26,8,1), new THREE.MeshStandardMaterial({color:0xf2c35b, side:THREE.DoubleSide, emissive:0x5a3a00, emissiveIntensity:.3})), .24,3.7,0);
    for (const z of [.56,-.56]) for (const yy of [1.1,1.6]) add(new THREE.Mesh(new THREE.BoxGeometry(.12,.2,.02), win), 0, yy, z);
    add(new THREE.Mesh(new THREE.BoxGeometry(.5,.6,.05), new THREE.MeshStandardMaterial({color:0x3a2616, roughness:.8})), 0,.5,-1.22);
    const cl = new THREE.PointLight(0xffc070, 3, 5, 1.8); cl.position.set(0,1.4,-1.5); castle.add(cl); }

  // board overlays
  hl = new THREE.Mesh(new THREE.PlaneGeometry(.98,.98), new THREE.MeshBasicMaterial({color:0x5fd38d, transparent:true, opacity:.28, depthWrite:false}));
  hl.rotation.x = -Math.PI/2; hl.position.y = .006; hl.visible = false; scene.add(hl);
  const hlEdge = new THREE.Mesh(new THREE.PlaneGeometry(.98,.98), new THREE.MeshBasicMaterial({map:frameTex, color:0x5fd38d, transparent:true, depthWrite:false})); hlEdge.position.z = .001; hl.add(hlEdge); hl.userData.edge = hlEdge;
  selFrame = new THREE.Mesh(new THREE.PlaneGeometry(1,1), new THREE.MeshBasicMaterial({map:frameTex, color:0xf2c35b, transparent:true, depthWrite:false}));
  selFrame.rotation.x = -Math.PI/2; selFrame.position.y = .008; selFrame.visible = false; scene.add(selFrame);
  rangeRing = new THREE.Group(); rangeRing.visible = false; scene.add(rangeRing);
  rangeRing.add(new THREE.Mesh(new THREE.RingGeometry(.985, 1, 128), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.75, depthWrite:false, side:THREE.DoubleSide})));
  rangeRing.add(new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.07, depthWrite:false})));
  rangeRing.children.forEach(m => m.rotation.x = -Math.PI/2); rangeRing.position.y = .02;
}
function lineTube(pts, y, radius, color, opacity, dashed){
  const v = pts.map(p => new THREE.Vector3(px(p.x), y, pz(p.y))), path = new THREE.CurvePath();
  for (let i=0;i<v.length-1;i++) path.add(new THREE.LineCurve3(v[i], v[i+1]));
  const mat = new THREE.MeshBasicMaterial({color, transparent:true, opacity, depthWrite:false});
  if (dashed){ mat.map = dashTex.clone(); mat.map.needsUpdate = true; mat.map.repeat.set(v.length*1.6, 1); }
  const m = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(2, v.length*3), radius, 5, false), mat); m.renderOrder = 2; return m; }
function disposeMesh(m){ if (!m) return; scene.remove(m); m.geometry.dispose(); if (m.material.map) m.material.map.dispose(); m.material.dispose(); }

/* ================= particles ================= */
const PMAX = 1600; let pGeo, pPos, pCol, pSize, pMat; const parts = [];
function makeParticles(){
  pGeo = new THREE.BufferGeometry(); pPos = new Float32Array(PMAX*3); pCol = new Float32Array(PMAX*3); pSize = new Float32Array(PMAX);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos,3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol,3)); pGeo.setAttribute('size', new THREE.BufferAttribute(pSize,1));
  pMat = new THREE.ShaderMaterial({ transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, vertexColors:true, uniforms:{map:{value:glowTex}, scale:{value:400}},
    vertexShader:`attribute float size; varying vec3 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*scale/-mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader:`uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC*t.a, t.a); }` });
  const pts = new THREE.Points(pGeo, pMat); pts.frustumCulled = false; scene.add(pts); }
function emit(pos, color, n, spd=2, life=.7, size=.18, up=1.2){ for (let i=0;i<n && parts.length<PMAX;i++){
  const a = Math.random()*Math.PI*2, e = Math.random()*spd;
  parts.push({p:pos.clone(), v:new THREE.Vector3(Math.cos(a)*e, Math.random()*up*spd, Math.sin(a)*e), c:color, life, t:0, size:size*(.6+Math.random()*.8)}); } }

/* ================= creeps ================= */
const eyeMat = new THREE.MeshBasicMaterial({color:0x111111}), barBg = new THREE.MeshBasicMaterial({color:0x0b0d15, transparent:true, opacity:.8, depthWrite:false});
const barGeo = new THREE.PlaneGeometry(1, 1); barGeo.translate(.5, 0, 0);
const creepGeo = {}; const creepMats = {};
function creepMat(type){ return creepMats[type] || (creepMats[type] = new THREE.MeshStandardMaterial({color:ARMOR[type] || '#cccccc', roughness:.6, flatShading:true, emissive:0xffffff, emissiveIntensity:0})); }
function makeCreep(e){
  const g = new THREE.Group(), mat = creepMat(e.type).clone(), size = e.boss ? 1.7 : 1;
  creepGeo.body = creepGeo.body || new THREE.IcosahedronGeometry(.22, 1); creepGeo.head = creepGeo.head || new THREE.IcosahedronGeometry(.13, 1);
  const body = new THREE.Mesh(creepGeo.body, mat); body.scale.set(1, .85, 1.2); body.position.y = .32; g.add(body);
  const head = new THREE.Mesh(creepGeo.head, mat); head.position.set(0, .42, .24); g.add(head);
  for (const s of [-1,1]){ const ey = new THREE.Mesh(new THREE.SphereGeometry(.025, 6, 4), eyeMat); ey.position.set(s*.06, .46, .35); g.add(ey); }
  const legs = [];
  if (e.fly){ body.position.y = 0; head.position.set(0,.06,.2); g.children.slice(2).forEach(o => o.position.y = .1);
    for (const s of [-1,1]){ const wing = new THREE.Mesh(new THREE.ConeGeometry(.24,.06,3), mat); wing.rotation.z = s*Math.PI/2; wing.position.set(s*.3, 0, 0); wing.scale.set(1,1,1.8); g.add(wing); legs.push(wing); } }
  else for (const [x,z] of [[-.12,.12],[.12,.12],[-.12,-.14],[.12,-.14]]){ const l = new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.2,5), mat); l.position.set(x,.1,z); g.add(l); legs.push(l); }
  if (e.boss){ const crown = new THREE.Mesh(new THREE.CylinderGeometry(.09,.11,.08,8,1,true), M.gold); crown.position.set(0,.56,.24); g.add(crown); }
  g.scale.setScalar(size); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const bar = new THREE.Group(), bg = new THREE.Mesh(barGeo, barBg), fg = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({color:0x5fd38d, depthWrite:false}));
  bg.scale.set(.62*size,.08,1); fg.scale.set(.58*size,.055,1); fg.position.set(.02*size,0,.001); bar.add(bg, fg); bg.renderOrder = fg.renderOrder = 10;
  scene.add(g, bar);
  return {g, bar, fg, legs, mat, size, phase:Math.random()*6}; }

/* ================= live sync with the game ================= */
const towerObjs = new Map(), creepObjs = new Map(), projObjs = new Map(), seenFx = new WeakSet(), floaters = [];
let lastS = null, shotGeo;
function clearDynamic(){
  for (const o of towerObjs.values()) scene.remove(o.g); towerObjs.clear();
  for (const o of creepObjs.values()) scene.remove(o.g, o.bar); creepObjs.clear();
  for (const o of projObjs.values()) scene.remove(o.m); projObjs.clear();
  parts.length = 0; for (const f of floaters) f.el.remove(); floaters.length = 0; }
function keyFor(t){ return t.key==='rock' ? 'rock' + (1 + t.id % 5) : t.key; }
function syncTowers(T){
  const S = G.state(), seen = new Set();
  for (const t of S.towers){
    seen.add(t.id); let o = towerObjs.get(t.id); const k = keyFor(t);
    if (!o || o.key !== k){ if (o) scene.remove(o.g); o = instance(k); o.key = k; o.g.position.set(wx(t.x), 0, wz(t.y)); o.g.userData.tid = t.id; o.g.traverse(m => m.userData.tid = t.id); scene.add(o.g); towerObjs.set(t.id, o); o.born = T; }
    const age = T - o.born, s = age < .25 ? .5 + age*2 : 1; o.g.scale.setScalar(s * (o.key==='bryvx' ? 1.2 : DEFS[t.key] && DEFS[t.key].kind==='gem' ? 1.15 : 1));
    o.t = t;
    // this round's gems: a thin grey frame; towers that can combine: a glint running round it
    if (t.draft || t.oneShot || t.flag){ if (!o.frame){ o.frame = new THREE.Mesh(new THREE.PlaneGeometry(.96,.96), new THREE.MeshBasicMaterial({map:frameTex, color:0xd6deec, transparent:true, opacity:.45, depthWrite:false})); o.frame.rotation.x = -Math.PI/2; o.frame.position.set(wx(t.x), .007, wz(t.y)); scene.add(o.frame); } o.frame.visible = !!t.draft; }
    else if (o.frame) o.frame.visible = false;
    const glint = t.oneShot || t.flag;
    if (glint && !o.glint){ o.glint = glowSprite(0xffffff, .28, 1); scene.add(o.glint); }
    if (o.glint){ o.glint.visible = !!glint; if (glint){ const u = ((T*.45 + t.id*.17) % 1 + 1) % 1, d = u*4, k2 = Math.floor(d), f = d - k2, h = .47;
      const [gx, gz] = k2===0 ? [-h + 2*h*f, -h] : k2===1 ? [h, -h + 2*h*f] : k2===2 ? [h - 2*h*f, h] : [-h, h - 2*h*f]; o.glint.position.set(wx(t.x)+gx, .05, wz(t.y)+gz); } }
    // idle animation
    if (o.anim){ if (o.anim.spire){ o.anim.spire.rotation.y += .006; o.anim.spire.position.y = .78 + Math.sin(T*1.2 + t.id)*.05; o.anim.orbits.children.forEach((r,i) => r.rotation.y += i ? -.008 : .011); o.anim.beam.uniforms.t.value = T; }
      if (o.anim.slice) o.anim.slice.rotation.y += .006; }
    if (o.embers && Math.random() < .2) emit(tmp.set(wx(t.x)+(Math.random()-.5)*.25, .7, wz(t.y)+(Math.random()-.5)*.25), new THREE.Color(1,.45+Math.random()*.3,.1), 1, .3, 1.1, .1, 3);
    if (o.sparkle && Math.random() < .08) emit(tmp.set(wx(t.x)+(Math.random()-.5)*.6, .4, wz(t.y)+(Math.random()-.5)*.6), new THREE.Color().setHSL(Math.random(), .8, .7), 1, .12, 1.6, .1, 6);
  }
  for (const [id, o] of towerObjs) if (!seen.has(id)){ scene.remove(o.g); if (o.frame) scene.remove(o.frame); if (o.glint) scene.remove(o.glint); towerObjs.delete(id); } }
function syncCreeps(T, dt){
  const S = G.state(), seen = new Set();
  for (const e of S.enemies){ if (e.dead) continue; seen.add(e.id); let o = creepObjs.get(e.id); if (!o){ o = makeCreep(e); creepObjs.set(e.id, o); }
    const x = px(e.x), z = pz(e.y); o.phase += dt*10*(S.paused ? 0 : 1);
    const y = e.fly ? 1.6 + Math.sin(o.phase*.4)*.1 : Math.abs(Math.sin(o.phase*.7))*.04;
    o.g.position.set(x, y, z); o.g.rotation.y = Math.atan2(Math.cos(e.ang), Math.sin(e.ang));
    if (e.fly) o.legs.forEach((w,i) => w.rotation.x = Math.sin(o.phase*1.4)*.6*(i?1:-1)); else o.legs.forEach((l,i) => l.rotation.x = Math.sin(o.phase + (i%2)*Math.PI)*.6);
    o.mat.emissiveIntensity = e.hitT > 0 ? .6 : 0;
    o.mat.emissive.set(e.frost && e.frost.t > 0 ? 0x8fd3ff : e.poison && e.poison.t > 0 ? 0x4fe08a : 0xffffff); if ((e.frost && e.frost.t > 0) || (e.poison && e.poison.t > 0)) o.mat.emissiveIntensity = Math.max(o.mat.emissiveIntensity, .35);
    o.bar.position.set(x - .31*o.size, y + (e.fly ? .45 : .75)*o.size, z); o.bar.quaternion.copy(camera.quaternion);
    const f = Math.max(0, e.hp / e.max); o.fg.scale.x = .58*o.size*f; o.fg.material.color.set(f > .5 ? 0x5fd38d : f > .25 ? 0xf2c35b : 0xff5d73); }
  for (const [id, o] of creepObjs) if (!seen.has(id)){ scene.remove(o.g, o.bar); o.mat.dispose(); creepObjs.delete(id); } }
function syncProjs(){
  const S = G.state(), seen = new Set();
  shotGeo = shotGeo || new THREE.SphereGeometry(.06, 10, 8);
  for (const p of S.projs){ seen.add(p); let o = projObjs.get(p);
    if (!o){ const c = new THREE.Color(p.color || '#ffffff'); const m = new THREE.Mesh(shotGeo, new THREE.MeshBasicMaterial({color:c.clone().multiplyScalar(2)})); m.add(glowSprite(c, .5, .9)); scene.add(m);
      const tw = p.t && towerObjs.get(p.t.id); o = {m, c, y0: tw ? tw.top * (tw.key==='bryvx' ? 1.2 : 1) : .8, sx:p.px ?? p.x, sy:p.py ?? p.y}; projObjs.set(p, o); }
    const e = p.tgt, ty = e ? (e.fly ? 1.6 : .35*(e.boss ? 1.7 : 1)) : .4;
    const d0 = Math.hypot(p.x - o.sx, p.y - o.sy), d1 = e ? Math.hypot(e.x - p.x, e.y - p.y) : 0, f = d0 + d1 > 0 ? d0/(d0+d1) : 1;
    o.m.position.set(px(p.x), o.y0 + (ty - o.y0)*f + Math.sin(f*Math.PI)*.25, pz(p.y));
    if (Math.random() < .5) emit(o.m.position, o.c, 1, .04, .22, .09, 0); }
  for (const [p, o] of projObjs) if (!seen.has(p)){ scene.remove(o.m); o.m.material.dispose(); projObjs.delete(p); } }
function syncFx(){
  const S = G.state();
  for (const f of S.fx){ if (seenFx.has(f)) continue; seenFx.add(f);
    const c = new THREE.Color(f.color || '#ffffff');
    if (f.kind==='spark'){ parts.length < PMAX && parts.push({p:new THREE.Vector3(px(f.x), .45, pz(f.y)), v:new THREE.Vector3(f.vx*.9, 1 + Math.random()*1.4, f.vy*.9), c, life:f.life, t:0, size:.16}); }
    else if (f.kind==='ring') emit(tmp.set(px(f.x), .3, pz(f.y)), c, 24, 2.6, .5, .18, .3);
    else if (f.kind==='text'){ const el = document.createElement('div'); el.className = 'fl3d'; el.textContent = f.s; el.style.color = f.color; labels.appendChild(el); floaters.push({el, x:px(f.x), z:pz(f.y), t:0, life:f.life || .9}); } } }

/* ================= input: the same actions as the 2D board ================= */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
function tileAt(ev){
  const r = canvas.getBoundingClientRect(); mouse.set((ev.clientX - r.left)/r.width*2 - 1, -((ev.clientY - r.top)/r.height)*2 + 1);
  ray.setFromCamera(mouse, camera);
  const objs = []; for (const o of towerObjs.values()) objs.push(o.g);
  const hit = ray.intersectObjects(objs, true).find(h => h.object.userData.tid != null && !(h.object.material && h.object.material.blending === THREE.AdditiveBlending));
  if (hit){ const t = G.state().towers.find(t => t.id === hit.object.userData.tid); if (t) return {x:t.x, y:t.y}; }
  const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, p)) return null;
  return {x:Math.floor(p.x + GW/2), y:Math.floor(p.z + GH/2)}; }
let down = null;
function onMove(ev){ const c = tileAt(ev); if (c) G.input.hover(c.x, c.y); else G.input.leave(); }
function onDown(ev){ if (ev.button === 0) down = {x:ev.clientX, y:ev.clientY, t:performance.now()}; }
function onUp(ev){ if (ev.button !== 0 || !down) return; const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y); const quick = performance.now() - down.t < 500; down = null;
  if (moved < 6 && quick){ const c = tileAt(ev); if (c) G.input.click(c.x, c.y); } }

/* ================= frame ================= */
const clock = new THREE.Clock(); let T = 0, viewSize = {w:0, h:0};
function fitCamera(){ camera.position.set(0, 38, 28); controls.target.set(0, 0, .6); controls.update(); }   // the whole board in view
function size(){ const w = host.clientWidth, h = host.clientHeight; if (!w || !h || (w===viewSize.w && h===viewSize.h)) return; viewSize = {w, h};
  renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w/h; camera.updateProjectionMatrix(); pMat.uniforms.scale.value = h*.5; }
function tick(){
  if (!running) return; raf = requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), .05); T += dt; size();
  controls.update();
  const lim = 20, cx = THREE.MathUtils.clamp(controls.target.x, -lim, lim), cz = THREE.MathUtils.clamp(controls.target.z, -lim, lim);
  if (cx !== controls.target.x || cz !== controls.target.z){ camera.position.x += cx - controls.target.x; camera.position.z += cz - controls.target.z; controls.target.x = cx; controls.target.z = cz; }
  const S = G.state();
  if (S !== lastS){ clearDynamic(); lastS = S; }
  arrows.forEach(a => a.arrow.position.y = .55 + Math.sin(T*2 + a.phase)*.08);
  portal.userData.vortex.rotation.z -= dt*1.8; portal.userData.rune.rotation.z += dt*.25;
  if (Math.random() < dt*30) emit(tmp.set(portal.position.x + (Math.random()-.5)*2, .1, portal.position.z + (Math.random()-.5)*2), new THREE.Color('#a873ff'), 1, .15, 1.6, .12, 6);
  { const p = castleFlag.geometry.attributes.position; for (let i=0;i<p.count;i++){ const x = p.getX(i) + .225; p.setZ(i, Math.sin(T*5 + x*9)*.05*x*2); } p.needsUpdate = true; }

  // route line (rebuilt only when the route changes)
  const route = S ? S.route : G.emptyRoute(), showPath = S ? (G.ui.showPath || S.phase !== 'wave') : true;
  if (route !== pathKey){ disposeMesh(pathMesh); pathMesh = route ? lineTube(route.pts, .06, .035, 0xffd27a, .85, true) : null; if (pathMesh) scene.add(pathMesh); pathKey = route; }
  if (pathMesh){ pathMesh.visible = !!showPath; pathMesh.material.map.offset.x -= dt*.6; }
  const nextW = S ? (S.phase === 'wave' ? S.waveCur : G.waveInfo(S.wave)) : null;
  if (!flyLine){ flyLine = lineTube(G.flyPts(), 1.6, .025, 0xff7cc0, .55, true); scene.add(flyLine); }
  flyLine.visible = !!(nextW && nextW.fly); flyLine.material.map.offset.x -= dt*.6;

  // hover preview while building
  const hv = G.hover();
  if (S && hv && S.phase === 'build'){ hl.visible = true; hl.position.set(wx(hv.x), .006, wz(hv.y)); const c = hv.ok ? 0x5fd38d : 0xff5d73; hl.material.color.set(c); hl.userData.edge.material.color.set(c); }
  else hl.visible = false;
  const hr = S && hv && hv.ok && S.phase === 'build' ? hv.route : null;
  if (hr !== hoverPathKey){ disposeMesh(hoverPath); hoverPath = hr ? lineTube(hr.pts, .08, .03, 0x5fd38d, .7, false) : null; if (hoverPath) scene.add(hoverPath); hoverPathKey = hr; }

  if (S){
    syncTowers(T); syncCreeps(T, dt); syncProjs(); syncFx();
    // selection, range and auras
    const sel = S.sel && S.towers.includes(S.sel) ? S.sel : null;
    selFrame.visible = !!sel; rangeRing.visible = false; auraRings.forEach(r => r.visible = false);
    if (sel){ selFrame.position.set(wx(sel.x), .008, wz(sel.y)); const d = DEFS[sel.key];
      if (sel.key !== 'rock' && d.dmg){ rangeRing.visible = true; rangeRing.position.set(wx(sel.x), .02, wz(sel.y)); rangeRing.scale.setScalar(G.U(d.range)); rangeRing.children.forEach(m => m.material.color.set(d.color)); }
      const auras = sel.key === 'rock' ? [] : [d.burn, d.radslow, d.spdAura, d.dmgAura, d.armorAura].filter(Boolean);
      auras.forEach((a, i) => { let r = auraRings[i]; if (!r){ r = new THREE.Mesh(new THREE.RingGeometry(.98, 1, 128), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.6, depthWrite:false, side:THREE.DoubleSide})); r.rotation.x = -Math.PI/2; scene.add(r); auraRings[i] = r; }
        r.visible = true; r.position.set(wx(sel.x), .025 + i*.002, wz(sel.y)); r.scale.setScalar(G.U(a.r)); r.material.color.set(d.color); }); }
  } else if (lastS === null && towerObjs.size) clearDynamic();

  // particles
  for (let i=parts.length-1;i>=0;i--){ const p = parts[i]; p.t += dt; if (p.t >= p.life){ parts.splice(i,1); continue; } p.v.y -= dt*.9; p.p.addScaledVector(p.v, dt); }
  for (let i=0;i<PMAX;i++){ const p = parts[i];
    if (p){ const k = 1 - p.t/p.life; pPos[i*3]=p.p.x; pPos[i*3+1]=p.p.y; pPos[i*3+2]=p.p.z; pCol[i*3]=p.c.r*k; pCol[i*3+1]=p.c.g*k; pCol[i*3+2]=p.c.b*k; pSize[i]=p.size; } else pSize[i] = 0; }
  pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = pGeo.attributes.size.needsUpdate = true;
  // floating numbers
  const r = canvas.getBoundingClientRect();
  for (let i=floaters.length-1;i>=0;i--){ const f = floaters[i]; f.t += dt; const k = f.t/f.life; if (k >= 1){ f.el.remove(); floaters.splice(i,1); continue; }
    tmp2.set(f.x, 1 + k*.8, f.z).project(camera); f.el.style.transform = `translate(${(tmp2.x*.5+.5)*r.width}px, ${(-tmp2.y*.5+.5)*r.height}px) translate(-50%,-50%)`; f.el.style.opacity = 1 - k*k; }
  composer.render();
}

/* ================= start / stop ================= */
let built = false;
export function start(el, anchor){
  host = el;
  if (!built){
    renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    canvas = renderer.domElement; canvas.className = 'board3d';
    scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer); envTex = pmrem.fromScene(studio(), .02).texture;
    makeTextures(); makeMaterials();
    camera = new THREE.PerspectiveCamera(42, 1, .1, 400);
    controls = new MapControls(camera, canvas);
    Object.assign(controls, {enableDamping:true, dampingFactor:.08, screenSpacePanning:false, minDistance:6, maxDistance:70, minPolarAngle:.15, maxPolarAngle:1.18, zoomSpeed:1.1, keyPanSpeed:22});
    controls.listenToKeyEvents(window);   // arrow keys pan; letters stay with the game's hotkeys
    composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .38, .45, .92); composer.addPass(bloom); composer.addPass(new OutputPass());
    makeParticles(); buildWorld(); fitCamera();
    labels = document.createElement('div'); labels.className = 'labels3d';
    canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerleave', () => G.input.leave());
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());
    built = true;
  }
  host.insertBefore(labels, anchor.nextSibling); host.insertBefore(canvas, anchor.nextSibling);
  viewSize = {w:0, h:0}; running = true; lastS = undefined; clock.getDelta(); tick();
}
export function stop(){ running = false; cancelAnimationFrame(raf); if (canvas && canvas.parentNode) canvas.remove(); if (labels && labels.parentNode) labels.remove(); clearDynamic(); lastS = undefined; }
export function resetView(){ if (built) fitCamera(); }
