// Gem TD Remastered: the 3D board. Loaded on demand when the player turns on 3D view.
// It only reads the game's state (S, DEFS, the map constants) and draws it; every rule, tick and replay stays in index.html.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const G = window.GemGame;   // the game's live bindings, published by index.html
const { GW, GH, PORTAL, CASTLE, CPS, NOBUILD, IDX, DEFS, GT, ARMOR, QN, RECIPES } = G.consts;
const wx = x => x - GW/2 + .5, wz = y => y - GH/2 + .5;   // tile index -> world
const px = x => x - GW/2, pz = y => y - GH/2;              // continuous tile coords (centres at +.5) -> world

function mkRng(a){ a >>>= 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash3 = (x,y,z) => { const s = Math.sin(x*127.1 + y*311.7 + z*74.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x,y,z){ const xi=Math.floor(x), yi=Math.floor(y), zi=Math.floor(z), xf=x-xi, yf=y-yi, zf=z-zi;
  const u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf), w=zf*zf*(3-2*zf), L=(a,b,t)=>a+(b-a)*t, c=(i,j,k)=>hash3(xi+i,yi+j,zi+k);
  return L(L(L(c(0,0,0),c(1,0,0),u), L(c(0,1,0),c(1,1,0),u), v), L(L(c(0,0,1),c(1,0,1),u), L(c(0,1,1),c(1,1,1),u), v), w); }
const fbm = (x,y,z) => vnoise(x,y,z)*.55 + vnoise(x*2.1,y*2.1,z*2.1)*.3 + vnoise(x*4.3,y*4.3,z*4.3)*.15;

let sun, renderer, scene, camera, controls, composer, bloom, envTex, canvas, host, labels, running = false, raf = 0;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

/* ================= textures ================= */
function canvasTex(w, h, draw, repeat){ const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); } return t; }
let grassTex, stoneTex, glowTex, dashTex, frameTex, paintTex, dirtTex;
// map style: 'ruins' (stone plaza) or 'aoe' (painted grass, forests and a dirt road)
const AOE = (() => { try { return (window.GEM_STYLE || localStorage.getItem('gemtd.style')) === 'aoe'; } catch(e){ return window.GEM_STYLE === 'aoe'; } })();
function makeTextures(){
  stoneTex = canvasTex(256, 256, (g,w,h) => { const r = mkRng(9); g.fillStyle = '#b9b2a4'; g.fillRect(0,0,w,h);
    for (let i=0;i<40;i++){ const x=r()*w, y=r()*h, rr=10+r()*40, gr=g.createRadialGradient(x,y,0,x,y,rr); gr.addColorStop(0,`rgba(${r()<.5?'150,140,125':'205,198,185'},.12)`); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.fillRect(x-rr,y-rr,rr*2,rr*2); }
    for (let i=0;i<2600;i++){ const v = 140+r()*70|0; g.fillStyle = `rgba(${v},${v-4},${v-12},${.15+r()*.25})`; g.fillRect(r()*w, r()*h, 1+r()*3, 1+r()*3); }
    for (let i=0;i<60;i++){ const x = r()<.5 ? r()*14 : w - r()*14, y = r()*h; g.fillStyle = `rgba(${70+r()*30|0},${110+r()*40|0},${50+r()*20|0},${.25+r()*.3})`; g.fillRect(x, y, 2+r()*4, 2+r()*4); }
    g.strokeStyle = 'rgba(60,55,48,.28)'; g.lineWidth = 1.2;
    for (let i=0;i<7;i++){ g.beginPath(); let x=r()*w, y=r()*h; g.moveTo(x,y); for (let k=0;k<5;k++){ x+=(r()-.5)*60; y+=(r()-.5)*60; g.lineTo(x,y); } g.stroke(); } });
  grassTex = canvasTex(512, 512, (g,w,h) => { const r = mkRng(4); g.fillStyle = '#5a8a2e'; g.fillRect(0,0,w,h);
      for (let i=0;i<260;i++){ const x=r()*w, y=r()*h, rr=8+r()*46, gr=g.createRadialGradient(x,y,0,x,y,rr), k = r();
        gr.addColorStop(0, k<.4 ? 'rgba(70,110,30,.35)' : k<.75 ? 'rgba(150,175,70,.3)' : 'rgba(120,120,55,.22)'); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.fillRect(x-rr,y-rr,rr*2,rr*2); }
      for (let i=0;i<7000;i++){ g.fillStyle = `hsla(${70+r()*28},${40+r()*25}%,${26+r()*26}%,${.25+r()*.35})`; g.fillRect(r()*w, r()*h, 1+r()*2, 1+r()*3); }
      for (let i=0;i<90;i++){ g.fillStyle = r()<.5 ? 'rgba(240,230,140,.7)' : 'rgba(255,255,255,.6)'; g.fillRect(r()*w, r()*h, 2, 2); } }, 40);
  if (AOE){
    paintTex = canvasTex(256, 256, (g,w,h) => { const r = mkRng(12); g.fillStyle = '#d8d8d8'; g.fillRect(0,0,w,h);
      for (let i=0;i<70;i++){ const x=r()*w, y=r()*h, rr=10+r()*40, gr=g.createRadialGradient(x,y,0,x,y,rr); gr.addColorStop(0, r()<.5 ? 'rgba(150,150,150,.25)' : 'rgba(255,255,255,.3)'); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.fillRect(x-rr,y-rr,rr*2,rr*2); }
      for (let i=0;i<3200;i++){ const v = 170+r()*85|0; g.fillStyle = `rgba(${v},${v},${v},${.2+r()*.3})`; g.fillRect(r()*w, r()*h, 1+r()*2, 1+r()*3); } });
    dirtTex = canvasTex(256, 256, (g,w,h) => { const r = mkRng(21); g.fillStyle = '#a3804f'; g.fillRect(0,0,w,h);
      for (let i=0;i<80;i++){ const x=r()*w, y=r()*h, rr=8+r()*30, gr=g.createRadialGradient(x,y,0,x,y,rr); gr.addColorStop(0, r()<.5 ? 'rgba(120,90,50,.35)' : 'rgba(200,170,120,.3)'); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.fillRect(x-rr,y-rr,rr*2,rr*2); }
      for (let i=0;i<500;i++){ const v = 120+r()*90|0; g.fillStyle = `rgba(${v},${v*.85|0},${v*.65|0},.7)`; g.beginPath(); g.arc(r()*w, r()*h, .8+r()*2, 0, 7); g.fill(); } }, 1);
  }
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
  M.stone = new THREE.MeshStandardMaterial({vertexColors:true, roughness:.78, flatShading:true, map:stoneTex});
  M.silver = new THREE.MeshStandardMaterial({color:0xdfe5f0, metalness:1, roughness:.22, envMap:envTex});
  M.gold = new THREE.MeshStandardMaterial({color:0xe7b84c, metalness:1, roughness:.26, envMap:envTex});
  M.iron = new THREE.MeshStandardMaterial({color:0x5a606b, metalness:.85, roughness:.42, envMap:envTex});
  M.bronze = new THREE.MeshStandardMaterial({color:0xb37b40, metalness:1, roughness:.34, envMap:envTex});
  M.sand = new THREE.MeshStandardMaterial({color:0xe2cc98, roughness:.72, map:stoneTex});
  M.goldLit = new THREE.MeshStandardMaterial({color:0xffcc55, metalness:.5, roughness:.3, envMap:envTex, emissive:0x7a4e00, emissiveIntensity:.45});   // gold that stays bright away from the studio lights
  M.lapis = new THREE.MeshStandardMaterial({color:0x1f47b8, metalness:.35, roughness:.28, envMap:envTex, emissive:0x0b2066, emissiveIntensity:.35});
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
// Perfect and Great are a single big stone rather than a cluster
const LEVEL = { h:[0,.34,.4,.46,.55,.62,.8], r:[0,.08,.078,.076,.078,.13,.165], sides:[0,0,1,2,3,0,0] };
function habitGeo(t, r, h, seed, rough){
  if (t==='D'){ const g = new THREE.OctahedronGeometry(r*1.7, 0); g.scale(1, 1.3, 1); g.translate(0, h*.5, 0); return g; }
  if (t==='O'){ let g = new THREE.IcosahedronGeometry(r*1.6, 2); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
    const p = g.attributes.position; for (let k=0;k<p.count;k++){ const d = 1 + (fbm(p.getX(k)*6+seed, p.getY(k)*6, p.getZ(k)*6)-.5)*.2; p.setXYZ(k, p.getX(k)*d, p.getY(k)*d*1.15, p.getZ(k)*d); }
    g.computeVertexNormals(); g.translate(0, r*1.6 + h*.25, 0); return g.toNonIndexed(); }
  const H = HABIT[t]; return crystal(r, h, {n:H.n, tip:H.tip, tipH:r*H.tipK, taper: t==='R' ? 1.05 : .82, seed, jit: rough ? .28 : .06}); }
// Perfect and Great: a wide, faceted mass of crystal like a chunk of glacier, with big points breaking out of the top
function glacier(q){
  const W = q===6 ? .4 : .31, H = q===6 ? .5 : .36, peaks = q===6 ? 6 : 4, R = mkRng(q*31);
  let g = new THREE.IcosahedronGeometry(1, 1); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i=0;i<p.count;i++){ const x=p.getX(i), y=p.getY(i), z=p.getZ(i), n = .85 + R()*.3;
    const yy = y < -.2 ? 0 : (y + .2)/1.2 * H * (.75 + R()*.5);   // flat underside, jagged top
    p.setXYZ(i, x*W*n*(1 - Math.max(0,y)*.25), yy, z*W*n*(1 - Math.max(0,y)*.25)); }
  const body = g.toNonIndexed(); body.computeVertexNormals(); const parts = [body];
  for (let i=0;i<peaks;i++){ const main = i===0, a = i/peaks*Math.PI*2 + .4, d = main ? 0 : W*(.45 + R()*.15);
    const r = main ? W*.42 : W*(.26 + R()*.08), h = main ? H*1.15 : H*(.55 + R()*.35);
    const c = crystal(r, h, {n:5, tipH:r*1.3, taper:.7, jit:.2, seed:q*7+i}); c.rotateY(R()*6); if (!main) c.rotateZ(-(.25 + R()*.25));
    c.rotateY(-a); c.translate(Math.cos(a)*d, H*.35, Math.sin(a)*d); parts.push(c); }
  const geo = mergeGeometries(parts); geo.computeVertexNormals(); return {geo, height:H*1.15 + W*.42*1.3}; }
function gemCluster(t, q){
  if (q>=5){ const {geo, height} = glacier(q), core = geo.clone(); core.scale(.6,.62,.6); core.translate(0, height*.08, 0); return {shell:geo, core, height}; }
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
  if (q===1){ tier(.22, .26, .07, 16, M.iron); }
  if (q===2){ tier(.27, .31, .09, 3, M.bronze); }
  if (q===3){ tier(.27, .31, .1, 4, M.polish); rim(.29, 4, M.iron); tier(.17, .21, .06, 4, M.iron); }
  if (q===4){ tier(.3, .34, .1, 6, M.polish); rim(.32, 6, M.silver); tier(.22, .27, .12, 6, M.polish); rim(.245, 6, M.silver); prongs(3, .22, .22, M.silver); }
  if (q===5){ tier(.33, .37, .11, 8, M.polish); rim(.35, 8, M.gold); tier(.25, .3, .14, 8, M.polish); rim(.275, 8, M.gold); tier(.17, .19, .05, 8, M.gold); prongs(4, .2, .3, M.gold); }
  if (q===6){ tier(.38, .42, .11, 40, M.marble); rim(.4, 40, M.gold); tier(.3, .35, .14, 40, M.marble); rim(.325, 40, M.gold); tier(.21, .25, .08, 40, M.gold); prongs(6, .22, .38, M.gold); }
  return {g, top:y}; }
/* ================= glowing crystals: painted obelisks lit from inside ================= */
// per gem: deep shadow, body colour, hot inner light
const CRYS = { A:['#2a0860','#9b45ff','#ffc8ff'], Q:['#03383c','#22d8cc','#d0fff8'], D:['#3d4c70','#bcd2ff','#ffffff'], E:['#02361a','#1fcf5a','#d4ffc8'],
  O:['#5a2f60','#ffb8e0','#fff3dc'], R:['#3d000c','#ff2442','#ffd2a0'], S:['#06155a','#3566ff','#d4e2ff'], T:['#5a2200','#ffa514','#fff0a8'] };
const crysU = {time:{value:0}}, crysCache = {};
const CRYS_FRAG = `uniform vec3 cDeep, cBody, cHot; uniform float time, glow, rainbow;
varying float vH; varying vec3 vL; varying vec3 vW;
float h1(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(h1(i),h1(i+vec3(1,0,0)),f.x),mix(h1(i+vec3(0,1,0)),h1(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h1(i+vec3(0,0,1)),h1(i+vec3(1,0,1)),f.x),mix(h1(i+vec3(0,1,1)),h1(i+vec3(1,1,1)),f.x),f.y),f.z); }
vec3 hue(float h){ return clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.); }
void main(){
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW))), v = normalize(cameraPosition - vW);
  if (dot(n, v) < 0.) n = -n;
  vec3 L = normalize(vec3(-.45,.75,.5));
  float lit = dot(n, L)*.5 + .5;
  float facet = h1(floor(n*5.) + 3.)*.32;                 // every cut face a slightly different tone
  float fres = pow(1. - max(dot(n, v), 0.), 2.5);
  float base = pow(1. - clamp(vH, 0., 1.), 2.2);          // light pools low in the stone
  vec3 col = mix(cDeep, cBody, clamp(lit*.62 + facet, 0., 1.)) * .8;
  col = mix(col, cHot, base*base*.75*glow) + cBody*base*.5*glow;
  col *= .75 + .45*smoothstep(.55, 1., vH)*(1.-glow*.3);   // tips catch a little sky light
  float vein = 1. - smoothstep(0., .045, abs(n3(vL*7. + 3.) - .5));   // cracks inside
  col += cBody*vein*.28*glow;
  vec3 p = vL*34.; float hc = h1(floor(p)), d = length(fract(p) - .5), tw = .5 + .5*sin(time*2.5 + hc*60.);
  col += cHot*step(.955, hc)*smoothstep(.22, 0., d)*(1.1 + 1.4*tw)*glow;   // flecks of light
  col += cBody*fres*.55;                 // bright edges
  col += cHot*pow(max(dot(reflect(-L, n), v), 0.), 24.)*.5;
  if (rainbow > 0.) col = mix(col, col*(.55 + hue(dot(n, vec3(1.3,.7,2.1)) + vH*.7 + time*.03)), rainbow*.6);
  gl_FragColor = vec4(col, 1.);
}`;
function crysMat(deep, body, hot, {glow=1, rainbow=0, side=THREE.FrontSide} = {}){
  const k = [deep, body, hot, glow, rainbow, side].join(); if (crysCache[k]) return crysCache[k];
  return crysCache[k] = new THREE.ShaderMaterial({ side, uniforms:{ time:crysU.time, cDeep:{value:new THREE.Color(deep)}, cBody:{value:new THREE.Color(body)}, cHot:{value:new THREE.Color(hot)}, glow:{value:glow}, rainbow:{value:rainbow} },
    vertexShader:`attribute float aH; varying float vH; varying vec3 vL; varying vec3 vW; void main(){ vH = aH; vL = position; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader:CRYS_FRAG }); }
const gemCrys = (t, q) => { const [a,b,c] = CRYS[t]; return crysMat(a, b, c, {glow: q===1 ? .45 : q===2 ? .7 : 1, rainbow: t==='O' ? 1 : t==='D' ? .35 : 0}); };
// height from the stone's foot (0) to its tip (1), which the shader uses for the inner glow
function withH(g){ g.computeBoundingBox(); const b = g.boundingBox, p = g.attributes.position, a = new Float32Array(p.count), span = (b.max.y - b.min.y) || 1;
  for (let i=0;i<p.count;i++) a[i] = (p.getY(i) - b.min.y)/span; g.setAttribute('aH', new THREE.BufferAttribute(a, 1)); return g; }
function obelisk(r, h, seed, broken){ return withH(crystal(r, h, {n:6, tip: broken ? 'flat' : 'point', tipH:r*1.5, taper:.88, jit:.05, seed})); }
// the same arrangement for every gem at a level; each level is taller and fuller
const LV = { h:[0,.3,.42,.55,.7,.92,1.18], r:[0,.075,.08,.085,.095,.12,.15], sides:[0,1,1,2,3,5,7] };
// a crystal snapped off at a slant
function brokenObelisk(r, h, seed, cut=.3){ const g = obelisk(r, h, seed, false), p = g.attributes.position;
  for (let i=0;i<p.count;i++){ const lim = h*(1 - cut) + p.getX(i)*cut*1.6; if (p.getY(i) > lim) p.setY(i, lim); }
  g.computeVertexNormals(); return withH(g); }
function obeliskCluster(q){
  if (q===1){ // Chipped: a rough, cloudy lump of raw crystal with two small points breaking out
    let lump = new THREE.IcosahedronGeometry(.13, 0); lump.deleteAttribute('normal'); lump.deleteAttribute('uv'); lump = mergeVertices(lump);
    const p = lump.attributes.position, R = mkRng(5); for (let i=0;i<p.count;i++) p.setXYZ(i, p.getX(i)*(1 + (R()-.5)*.5), Math.max(-.02, p.getY(i)*(.8 + R()*.4)), p.getZ(i)*(1 + (R()-.5)*.5));
    lump = withH(lump.toNonIndexed()); lump.computeVertexNormals(); lump.translate(0, .07, 0);
    const a = xf(brokenObelisk(.05, .26, 3, .35), {x:.02, rz:-.12}), b = xf(brokenObelisk(.035, .16, 4, .4), {x:-.08, z:.04, rz:.4});
    return {geo:mergeGeometries([lump, a, b]), height:.28}; }
  if (q===2){ // Flawed: one crystal with its tip broken off at an angle, and a small shard beside it
    const a = brokenObelisk(.075, .42, 3, .22), b = xf(obelisk(.04, .2, 21, false), {x:.1, z:.03, rz:-.35}), c = xf(brokenObelisk(.03, .12, 22, .4), {x:-.09, z:-.05, rz:.45});
    return {geo:mergeGeometries([a, b, c]), height:.42}; }
  const parts = [], H = LV.h[q], R = LV.r[q], n = LV.sides[q], rnd = mkRng(q*13);
  parts.push(obelisk(R, H, 3, q===1));
  for (let i=0;i<n;i++){ const a = i/n*Math.PI*2 + .5, h = H*(.34 + ((i*.37)%1)*.3), r = R*(.55 + rnd()*.15), d = R*1.25 + r*.9;
    const g = obelisk(r, h, 20+i, q===1 && i===0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-(.14 + rnd()*.14)).premultiply(new THREE.Matrix4().makeRotationY(-a)).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a)*d, 0, Math.sin(a)*d)));
    parts.push(g); }
  // a scatter of small stubs at the foot
  const stubs = q>=3 ? 4 + q : 2;
  for (let i=0;i<stubs;i++){ const a = i*2.4 + 1, d = R*1.6 + .05 + rnd()*.08, r = .02 + rnd()*.015, g = obelisk(r, .04 + rnd()*.05, 60+i, false);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-(.4 + rnd()*.5)).premultiply(new THREE.Matrix4().makeRotationY(-a)).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a)*d, 0, Math.sin(a)*d)));
    parts.push(g); }
  return {geo:mergeGeometries(parts), height:H + R*1.5}; }
function buildGem(t, q){
  const g = new THREE.Group(), col = new THREE.Color(CRYS[t][1]), cl = obeliskCluster(q);
  g.add(new THREE.Mesh(cl.geo, gemCrys(t, q)));
  g.add(pool(col, .4 + q*.09, q<=2 ? .06 : .07 + q*.02));
  g.add(at(glowSprite(col, .3 + q*.12, q<=2 ? .03 : .04 + q*.008), 0, cl.height*.3, 0));
  return {g, top:cl.height*.8};
}

/* ================= special towers ================= */
// the gallery's own models (Tower3D meshes, already in tile units with y up) turned into real geometry
const t3dMats = new WeakMap();
function t3dMat(m){ if (t3dMats.has(m)) return t3dMats.get(m); let out;
  const c3 = a => new THREE.Color(a[0], a[1], a[2]);
  if (m.kind==='metal') out = new THREE.MeshStandardMaterial({color:c3(m.tint), metalness:1, roughness:.28, envMap:envTex, side:THREE.DoubleSide});
  else if (m.kind==='stone') out = new THREE.MeshStandardMaterial({color:c3(m.col), roughness:Math.max(.25, .85 - (m.spec||0)*.5), envMap:envTex, envMapIntensity:.4, flatShading:true, side:THREE.DoubleSide});
  else if (m.kind==='emissive') out = new THREE.MeshStandardMaterial({color:c3(m.col), emissive:c3(m.col), emissiveIntensity:1.2, roughness:.6, flatShading:true, side:THREE.DoubleSide});
  else if (m.kind==='rainbow') out = crysMat('#5a5a78', '#e8ecff', '#ffffff', {rainbow:1, side:THREE.DoubleSide});
  else { const hex = a => '#' + new THREE.Color().setRGB(...a.map(v => Math.min(1, Math.max(0, v))), THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace);
    const col = m.col, deep = m.deep || col.map(v => v*.2), hot = (m.glow || col).map(v => v*.5 + .5);
    out = crysMat(hex(deep), hex(col), hex(hot), {side:THREE.DoubleSide}); }
  t3dMats.set(m, out); return out; }
function t3dMesh(m){ const pos = [];
  for (const f of m.f) for (let i=1;i<f.length-1;i++) for (const k of [f[0], f[i], f[i+1]]) pos.push(...m.v[k]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return withH(g); }
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
// special towers in the same glowing-obelisk style: a worked plinth (bronze, silver, gold, then marble for ultimates),
// a tall stone in the tower's own colour, and a smaller stone for each gem in its recipe
const famOf = key => key.replace(/\d+$/, '');
function tierOf(d){ return d.tier >= 4 ? 4 : d.tier || 1; }
function accentTypes(key){
  const fam = famOf(key);
  let R = RECIPES.find(r => r.group==='special' && famOf(r.to)===fam) || RECIPES.find(r => r.group==='secret' && r.to===key);
  const fuse = RECIPES.find(r => r.group==='ultimate' && r.to===key);
  const types = [];
  for (const r of [R, fuse]) if (r) for (const p of r.parts){ const pd = DEFS[p]; if (pd && pd.kind==='gem' && !types.includes(pd.type)) types.push(pd.type); }
  return types.length ? types : ['D']; }
const hexOf = c => '#' + c.getHexString();
function colourMat(hex, opts){ const c = new THREE.Color(hex), deep = c.clone().multiplyScalar(.16), hot = c.clone().lerp(new THREE.Color(1,1,1), .65); return crysMat(hexOf(deep), hex, hexOf(hot), opts); }
function buildSpecial(key, d){
  const g = new THREE.Group(), T = tierOf(d), acc = accentTypes(key), rnd = mkRng(key.length*17 + T);
  const frost = !!(d.frost || (d.splash && d.splash.frost)), burn = !!d.burn, aura = !!(d.dmgAura || d.spdAura || d.spdAura2 || d.armorAura);
  // plinth
  const trim = [null, M.bronze, M.silver, M.gold, M.gold][T], slab = T===4 ? M.marble : M.polish;
  let y = 0; const tier = (rt, rb, h, n, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, n), mat); m.position.y = y + h/2; m.rotation.y = Math.PI/n; g.add(m); y += h; };
  const rim = (r, n) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, .016, 5, n), trim); m.rotation.x = Math.PI/2; m.rotation.z = Math.PI/n; m.position.y = y; g.add(m); };
  const sides = T===4 ? 40 : 8;
  tier(.4, .44, .07, sides, slab); rim(.42, sides);
  if (T>=3){ tier(.32, .36, .06, sides, slab); rim(.34, sides); }
  const foot = y;
  // stones
  const H = [0, .62, .82, 1.02, 1.3][T], R = [0, .1, .115, .13, .155][T];
  const main = new THREE.Group(); main.position.y = foot - .03; g.add(main);
  const mainMat = colourMat(d.color || '#ffffff', {glow: burn ? 1.25 : 1, rainbow: frost ? .3 : 0});
  const mainParts = [obelisk(R, H, 3, false)];
  const extra = T===1 ? 0 : T===2 ? 2 : T===3 ? 3 : 4;
  for (let i=0;i<extra;i++){ const a = i/extra*Math.PI*2 + .9, h = H*(.42 + rnd()*.18), r = R*.55, ob = obelisk(r, h, 40+i, false);
    ob.applyMatrix4(new THREE.Matrix4().makeRotationZ(-.2).premultiply(new THREE.Matrix4().makeRotationY(-a)).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a)*R*1.3, 0, Math.sin(a)*R*1.3)));
    mainParts.push(ob); }
  main.add(new THREE.Mesh(mergeGeometries(mainParts), mainMat));
  acc.forEach((t, i) => { const a = i/acc.length*Math.PI*2 + .2, h = H*(.34 + (i%2)*.1), r = R*.55, ob = obelisk(r, h, 70+i, false);
    const d0 = .25 + (T>=3 ? .03 : 0);
    ob.applyMatrix4(new THREE.Matrix4().makeRotationZ(-.12).premultiply(new THREE.Matrix4().makeRotationY(-a)).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a)*d0, 0, Math.sin(a)*d0)));
    main.add(new THREE.Mesh(ob, gemCrys(t, 5))); });
  const col = new THREE.Color(d.color || '#ffffff');
  g.add(pool(col, aura ? 1.3 : .8 + T*.1, aura ? .22 : .16));
  g.add(at(glowSprite(col, .5 + T*.12, .1), 0, foot + H*.3, 0));
  return {g, top: foot + H*.8, embers: burn}; }
/* ================= special towers as their own forms: rune stones, ice, fire, staffs, orbs, fountains ================= */
const VERT_H = `attribute float aH; varying float vH; varying vec3 vL; varying vec3 vW; varying vec2 vUv;
  void main(){ vH = aH; vL = position; vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const VERT_UV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const NOISE = `float h1(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(h1(i),h1(i+vec3(1,0,0)),f.x),mix(h1(i+vec3(0,1,0)),h1(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h1(i+vec3(0,0,1)),h1(i+vec3(1,0,1)),f.x),mix(h1(i+vec3(0,1,1)),h1(i+vec3(1,1,1)),f.x),f.y),f.z); }`;
const fxCache = {};
// carved stone with light leaking through its cracks
function glowStone(stone, glow, amt=1){ const k = 'gs'+stone+glow+amt; if (fxCache[k]) return fxCache[k];
  return fxCache[k] = new THREE.ShaderMaterial({ uniforms:{time:crysU.time, cStone:{value:C(stone)}, cGlow:{value:C(glow)}, amt:{value:amt}}, vertexShader:VERT_H,
    fragmentShader:`uniform vec3 cStone, cGlow; uniform float time, amt; varying float vH; varying vec3 vL; varying vec3 vW; ${NOISE}
    void main(){ vec3 n = normalize(cross(dFdx(vW), dFdy(vW))), v = normalize(cameraPosition - vW); if (dot(n,v) < 0.) n = -n;
      float lit = dot(n, normalize(vec3(-.45,.75,.5)))*.5 + .5, facet = h1(floor(n*5.) + 1.)*.2;
      vec3 col = cStone*(.4 + .75*lit + facet);
      float c1 = 1. - smoothstep(0., .035, abs(n3(vL*5.5 + 1.) - .5)), c2 = (1. - smoothstep(0., .025, abs(n3(vL*12. + 7.) - .5)))*.7;
      float crack = max(c1, c2)*(.8 + .2*sin(time*2. + vL.y*8.));
      col = mix(col, cGlow*1.8, crack*amt);
      col += cGlow*pow(1. - clamp(vH,0.,1.), 3.)*.45*amt + cGlow*pow(1. - max(dot(n,v),0.), 3.)*.25*amt;
      gl_FragColor = vec4(col, 1.); }` }); }
// additive light: ribbons that stream upward, flames and water jets
function ribbonMat(hex){ const k = 'rb'+hex; if (fxCache[k]) return fxCache[k];
  return fxCache[k] = Object.assign(new THREE.ShaderMaterial({ transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, uniforms:{time:crysU.time, c:{value:C(hex)}}, vertexShader:VERT_UV,
    fragmentShader:`uniform vec3 c; uniform float time; varying vec2 vUv;
    void main(){ float a = smoothstep(0., .2, vUv.x)*smoothstep(1., .55, vUv.x); a *= .55 + .45*sin(vUv.x*24. - time*5.); gl_FragColor = vec4(c*a*1.6, a); }` }), {isRibbon:true}); }
function flameMat(core, outer, seed=0){ const k = 'fl'+core+outer+seed; if (fxCache[k]) return fxCache[k];
  return fxCache[k] = new THREE.ShaderMaterial({ transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, uniforms:{time:crysU.time, c1:{value:C(core)}, c2:{value:C(outer)}, seed:{value:seed}}, vertexShader:VERT_UV,
    fragmentShader:`uniform vec3 c1, c2; uniform float time, seed; varying vec2 vUv; ${NOISE}
    void main(){ float x = (vUv.x - .5)*2., y = vUv.y, n = n3(vec3(x*2., y*3. - time*2.6 + seed, seed));
      float w = (1. - y)*.9*(.7 + .5*n), d = abs(x + (n - .5)*.35*y);
      float s = (1. - smoothstep(w*.5, w, d))*smoothstep(0., .1, y)*(1. - smoothstep(.65, 1., y + n*.25));
      vec3 col = mix(c2, c1, smoothstep(.35, .95, s*(1. - y*.6)));
      gl_FragColor = vec4(col*s*1.7, s); }` }); }
// glass orb: dark heart, glowing rim, bright core
function orbMat(deep, rim, core){ const k = 'ob'+deep+rim+core; if (fxCache[k]) return fxCache[k];
  return fxCache[k] = new THREE.ShaderMaterial({ transparent:true, uniforms:{time:crysU.time, cD:{value:C(deep)}, cR:{value:C(rim)}, cC:{value:C(core)}}, vertexShader:`varying vec3 vN; varying vec3 vW; varying vec3 vL; void main(){ vL = position; vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader:`uniform vec3 cD, cR, cC; uniform float time; varying vec3 vN; varying vec3 vW; varying vec3 vL; ${NOISE}
    void main(){ vec3 v = normalize(cameraPosition - vW); float f = 1. - max(dot(normalize(vN), v), 0.), core = pow(max(dot(normalize(vN), v), 0.), 6.);
      float swirl = n3(vL*9. + vec3(0., time*.6, 0.));
      vec3 col = mix(cD, cR, pow(f, 1.6)) + cC*core*.9 + cR*swirl*.25 + vec3(1.)*pow(max(dot(reflect(-normalize(vec3(-.45,.75,.5)), normalize(vN)), v), 0.), 40.)*.8;
      gl_FragColor = vec4(col, .82 + f*.18); }` }); }
function canvasRune(kind){ return canvasTex(256, 256, (g, w) => { g.clearRect(0,0,w,w); g.translate(w/2, w/2); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
  g.lineWidth = 4; g.beginPath(); g.arc(0,0,120,0,7); g.stroke(); g.lineWidth = 2; g.beginPath(); g.arc(0,0,104,0,7); g.stroke();
  for (let i=0;i<16;i++){ g.save(); g.rotate(i/16*Math.PI*2); g.translate(0,-112); g.beginPath(); if (i%2){ g.moveTo(-4,-4); g.lineTo(4,4); g.moveTo(4,-4); g.lineTo(-4,4); } else { g.moveTo(0,-5); g.lineTo(0,5); g.moveTo(-4,0); g.lineTo(4,0); } g.stroke(); g.restore(); }
  if (kind==='star'){ g.lineWidth = 3; g.beginPath(); for (let i=0;i<=16;i++){ const a = i/16*Math.PI*2 - Math.PI/2, r = i%2 ? 38 : 92; g.lineTo(Math.cos(a)*r, Math.sin(a)*r); } g.stroke(); g.beginPath(); g.arc(0,0,30,0,7); g.stroke(); }
  else { g.lineWidth = 2; for (let k=0;k<2;k++){ g.beginPath(); for (let i=0;i<=3;i++){ const a = i/3*Math.PI*2 + k*Math.PI/3 - Math.PI/2; g.lineTo(Math.cos(a)*84, Math.sin(a)*84); } g.stroke(); } g.beginPath(); g.arc(0,0,44,0,7); g.stroke(); } }); }
let RUNE = null;
function runeCircle(r, hex, kind='ring', op=.85){ RUNE = RUNE || {ring:canvasRune('ring'), star:canvasRune('star')};
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({map:RUNE[kind], color:C(hex), transparent:true, opacity:op, blending:THREE.AdditiveBlending, depthWrite:false}));
  m.rotation.x = -Math.PI/2; m.position.y = .015; return m; }
let STAR = null;
const starSprite = (hex, size, op=.9) => { STAR = STAR || canvasTex(128, 128, (g, w) => { g.translate(w/2, w/2); const gr = g.createRadialGradient(0,0,0,0,0,w/2); gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.15,'rgba(255,255,255,.6)'); gr.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-w/2,-w/2,w,w);
    g.fillStyle = '#fff'; for (const [len, wd, rot] of [[62,5,0],[62,5,Math.PI/2],[34,3,Math.PI/4],[34,3,-Math.PI/4]]){ g.save(); g.rotate(rot); g.beginPath(); g.moveTo(0,-len); g.lineTo(wd,0); g.lineTo(0,len); g.lineTo(-wd,0); g.closePath(); g.fill(); g.restore(); } });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map:STAR, color:C(hex), blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:op})); s.scale.set(size, size, 1); return s; };
const C = hex => new THREE.Color(hex);
function roughBlock(w, h, d, seed, amt=.12){ let g = new THREE.BoxGeometry(w, h, d, 2, 2, 2); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position, R = mkRng(seed); for (let i=0;i<p.count;i++) p.setXYZ(i, p.getX(i)*(1 + (R()-.5)*amt*2), p.getY(i)*(1 + (R()-.5)*amt), p.getZ(i)*(1 + (R()-.5)*amt*2));
  g = g.toNonIndexed(); g.computeVertexNormals(); g.translate(0, h/2, 0); return withH(g); }
const mesh = (geo, mat, x=0, y=0, z=0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const xf = (geo, {x=0,y=0,z=0,rx=0,ry=0,rz=0,s=1}={}) => { geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)), new THREE.Vector3(s,s,s))); return geo; };
// a ring of rough stones around the foot, lit by the tower's own glow
function stoneRing(r, n, size, stone, glow, seed){ const parts = []; const R = mkRng(seed);
  for (let i=0;i<n;i++){ const a = i/n*Math.PI*2 + R()*.3, s = size*(.75 + R()*.5); parts.push(xf(roughBlock(s*1.2, s*.8, s, seed+i, .2), {x:Math.cos(a)*r, z:Math.sin(a)*r, ry:-a + R()})); }
  return new THREE.Mesh(mergeGeometries(parts), glowStone(stone, glow, .6)); }
function flames(h, w, core, outer, seed=0){ const g = new THREE.Group(), geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h/2, 0);
  for (let i=0;i<2;i++){ const m = new THREE.Mesh(geo, flameMat(core, outer, seed + i*3.7)); m.rotation.y = i*Math.PI/2; m.renderOrder = 5; g.add(m); } return g; }
function helix(r, h, turns, phase, thick=.012){ const pts = []; for (let i=0;i<=48;i++){ const t = i/48, a = phase + t*turns*Math.PI*2, rr = r*(1 - t*.35); pts.push(new THREE.Vector3(Math.cos(a)*rr, t*h, Math.sin(a)*rr)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, thick, 5, false); }
function ribbons(r, h, n, hex, turns=1.2){ const g = new THREE.Group(); for (let i=0;i<n;i++) g.add(new THREE.Mesh(helix(r, h, turns, i/n*Math.PI*2), ribbonMat(hex))); return g; }
function brilliantGeo(r, segs=12){ const g = new THREE.LatheGeometry([new THREE.Vector2(0,-.62), new THREE.Vector2(1,0), new THREE.Vector2(.92,.08), new THREE.Vector2(.55,.32), new THREE.Vector2(0,.32)].map(v => v.multiplyScalar(r)), segs); return withH(g.toNonIndexed()); }
const colMat = (hex, o) => { const c = C(hex); return crysMat('#' + c.clone().multiplyScalar(.16).getHexString(), hex, '#' + c.clone().lerp(C('#ffffff'), .65).getHexString(), o); };
const ICE = () => crysMat('#3a6a96', '#bfe6ff', '#ffffff', {glow:.7, rainbow:.2});
function crystalFan(n, h, r, spread, mat, seed, tilt=.5){ const parts = []; const R = mkRng(seed);
  for (let i=0;i<n;i++){ const t = n===1 ? 0 : i/(n-1) - .5, hh = h*(1 - Math.abs(t)*.6)*(.85 + R()*.3); parts.push(xf(obelisk(r*(1 - Math.abs(t)*.4), hh, seed+i, false), {rz:-t*spread, ry:tilt*(R()-.5)})); }
  return new THREE.Mesh(mergeGeometries(parts), mat); }
function iceBlock(w, h){ const g = new THREE.Group(); const ice = ICE();
  g.add(mesh(roughBlock(w, h, w, 5, .06), ice));
  const ic = []; for (let i=0;i<14;i++){ const side = i%4, t = (Math.floor(i/4) + .5)/3.6 - .5, len = .06 + (i*.37%1)*.08, c = new THREE.ConeGeometry(.022, len, 5); c.rotateX(Math.PI); c.translate(0, h - len/2, 0);
    const [x, z] = side===0 ? [t*w, w/2] : side===1 ? [w/2, t*w] : side===2 ? [t*w, -w/2] : [-w/2, t*w]; c.translate(x*1.02, 0, z*1.02); ic.push(withH(c.toNonIndexed())); }
  g.add(new THREE.Mesh(mergeGeometries(ic), ice)); return g; }
function coins(n, r, seed){ const parts = [], R = mkRng(seed); for (let i=0;i<n;i++){ const a = R()*6.28, d = Math.sqrt(R())*r; parts.push(xf(new THREE.CylinderGeometry(.03, .03, .008, 10), {x:Math.cos(a)*d, y:.004 + R()*.03, z:Math.sin(a)*d, rx:(R()-.5)*.8, rz:(R()-.5)*.8})); }
  return new THREE.Mesh(mergeGeometries(parts), M.gold); }

const FORMS = {
  silver(t){ const g = new THREE.Group(), blue = '#6ab8ff', pale = '#d8ecff', anims = [];
    const steel = new THREE.MeshStandardMaterial({color:0xe4ecf8, metalness:.75, roughness:.3, envMap:envTex, envMapIntensity:1.5, emissive:0x1a2a44, emissiveIntensity:.35});
    const darkSteel = new THREE.MeshStandardMaterial({color:0x8a96aa, metalness:.8, roughness:.35, envMap:envTex, emissive:0x0c1424, emissiveIntensity:.3});
    const blueGem = crysMat('#06205a', '#3a8aff', '#e0f0ff', {glow:1.1}), teal = crysMat('#04302c', '#2ae0c8', '#e0fff8', {glow:1});
    const gemAt = (parent, mat, r, x, y, z, sy=1.5) => { const m = mesh(withH(new THREE.OctahedronGeometry(r, 0).toNonIndexed()), mat, x, y, z); m.scale.y = sy; parent.add(m); return m; };
    if (t<=2){ // Silver and Sterling Silver: a silver war-staff planted in a sturdy stepped plinth of dark stone banded in silver
      const stone = glowStone('#363c44', blue, .45), stone2 = glowStone('#4a525c', '#9fd8ff', .4);
      const P = (geo, mat, x, y, z) => { const m = mesh(withH(geo.toNonIndexed()), mat, x, y, z); m.rotation.y = Math.PI/8; g.add(m); return m; };
      const band = (r, y) => { const b = mesh(new THREE.TorusGeometry(r, .014, 5, 8), steel, 0, y, 0); b.rotation.x = Math.PI/2; b.rotation.z = Math.PI/8; g.add(b); };
      g.add(runeCircle(.42, blue, 'ring', .45));
      let y = 0;
      if (t===1){ P(new THREE.CylinderGeometry(.27, .3, .1, 8), stone, 0, .05, 0); band(.285, .1); P(new THREE.CylinderGeometry(.18, .23, .14, 8), stone2, 0, .17, 0); band(.2, .24); y = .24; }
      else { P(new THREE.CylinderGeometry(.3, .33, .1, 8), stone, 0, .05, 0); band(.315, .1); P(new THREE.CylinderGeometry(.22, .27, .14, 8), stone2, 0, .17, 0); band(.245, .24);
        P(new THREE.CylinderGeometry(.14, .18, .14, 8), stone, 0, .31, 0); band(.16, .38); y = .38;
        // rune plates glowing on the plinth faces
        for (let i=0;i<4;i++){ const a = i/4*Math.PI*2 + Math.PI/4, p = mesh(new THREE.PlaneGeometry(.07, .08), new THREE.MeshBasicMaterial({color:0x7ac8ff, transparent:true, opacity:.85}), Math.cos(a)*.248, .17, Math.sin(a)*.248); p.lookAt(Math.cos(a), .17, Math.sin(a)); g.add(p); } }
      // socket
      g.add(mesh(new THREE.CylinderGeometry(.05, .07, .06, 8), steel, 0, y + .03, 0)); gemAt(g, teal, .016, 0, y + .03, .062, 1);
      const st = new THREE.Group(); st.position.y = y + .04; g.add(st);
      const L = t===1 ? .52 : .6;
      st.add(mesh(withH(new THREE.CylinderGeometry(.024, .03, L, 8).toNonIndexed()), crysMat('#1a3a7a', '#5ab0ff', '#f0f8ff', {glow:1.15}), 0, L/2, 0));
      for (let i=0;i<2;i++){ const hx = new THREE.Mesh(helix(.032, L*.85, 2.5, i*Math.PI, .007), steel); hx.position.y = L*.05; st.add(hx); }
      for (let i=0;i<(t===1?1:2);i++){ const yy = L*(.35 + i*.25); st.add(mesh(new THREE.BoxGeometry(.06, .05, .06), steel, 0, yy, 0)); gemAt(st, blueGem, .02, 0, yy, .032, 1.6); }
      // crown: silver collar, flared prongs, and a tall sapphire
      st.add(mesh(new THREE.CylinderGeometry(.05, .032, .06, 8), steel, 0, L + .02, 0));
      for (const s of [-1,1]){ const p = mesh(new THREE.ConeGeometry(.018, .12, 4), steel, s*.075, L + .11, 0); p.rotation.z = -s*1.0; st.add(p);
        const f = mesh(new THREE.BoxGeometry(.016, .2, .03), steel, s*.052, L + .14, 0); f.rotation.z = s*.16; st.add(f); }
      gemAt(st, blueGem, t===1 ? .05 : .065, 0, L + .15, 0, 1.8);
      st.add(mesh(new THREE.ConeGeometry(.02, .1, 4), steel, 0, L + .3, 0));
      if (t===2){ // two great curved blades rising from the plinth either side of the staff
        const wing = new THREE.Shape(); wing.moveTo(0, 0); wing.quadraticCurveTo(.16, .04, .2, .34); wing.quadraticCurveTo(.12, .16, .03, .14); wing.lineTo(.05, .08); wing.quadraticCurveTo(.02, .05, 0, .07); wing.closePath();
        const low = new THREE.Shape(); low.moveTo(0, 0); low.quadraticCurveTo(.13, -.02, .17, -.16); low.quadraticCurveTo(.08, -.07, .015, -.05); low.closePath();
        const ex = sh => new THREE.ExtrudeGeometry(sh, {depth:.022, bevelEnabled:true, bevelThickness:.006, bevelSize:.006, bevelSegments:1, curveSegments:10});
        for (const s of [-1,1]){ const w = new THREE.Group(); w.position.set(0, L*.5, 0); w.scale.set(s, 1, 1); st.add(w);
          w.add(mesh(ex(wing), steel, .03, 0, -.011)); w.add(mesh(ex(low), darkSteel, .03, -.01, -.011)); gemAt(w, teal, .013, .08, .08, .017, 1); }
        // streams of light spiralling up the staff
        const wrap = new THREE.Group(); st.add(wrap); for (let i=0;i<2;i++) wrap.add(new THREE.Mesh(helix(.09, L*.9, 1.4, i*Math.PI, .012), ribbonMat('#bfe8ff')));
        anims.push({o:wrap, kind:'spin', speed:1.3}); }
      const topY = st.position.y + L + .15;
      g.add(at(starSprite(pale, t===1 ? .32 : .45, .7), 0, topY, 0)); g.add(at(glowSprite(C(blue), .6, .12), 0, topY - .1, 0));
      g.add(pool(C(blue), .8, .22)); return {g, top:topY, anims}; }
    // Silver Knight: a weathered stone knight statue, arms folded over his chest, on a stepped plinth with a great blue eye set in its column
    const statue = glowStone('#323c3e', '#6ac0ff', .35), trim = glowStone('#46524f', '#8ad8ff', .4), dk = glowStone('#22292b', '#5ab0ff', .3);
    const P = (geo, mat, x, y, z, rx=0, ry=0, rz=0) => { const m = mesh(withH(geo.toNonIndexed ? geo.toNonIndexed() : geo), mat, x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
    // stepped plinth
    P(new THREE.BoxGeometry(.66, .08, .66), dk, 0, .04, 0); P(new THREE.BoxGeometry(.56, .07, .56), statue, 0, .115, 0); P(new THREE.BoxGeometry(.48, .05, .48), trim, 0, .175, 0);
    // column, flaring into the body like a robe
    P(new THREE.CylinderGeometry(.13, .19, .32, 8), statue, 0, .36, 0); P(new THREE.CylinderGeometry(.15, .13, .05, 8), trim, 0, .53, 0);
    for (let i=0;i<8;i++){ const a = i/8*Math.PI*2 + Math.PI/8; P(new THREE.BoxGeometry(.03, .3, .02), trim, Math.cos(a)*.155, .35, Math.sin(a)*.155, 0, -a, 0).rotation.x = 0; }
    // the eye: a ringed blue orb set into the front of the column
    const ring = P(new THREE.TorusGeometry(.09, .025, 8, 24), trim, 0, .37, .15); ring.rotation.x = .15;
    const eye = mesh(new THREE.SphereGeometry(.08, 24, 16), orbMat('#0a0a6a', '#4a5aff', '#c8d8ff'), 0, .37, .15); g.add(eye);
    const pupil = mesh(new THREE.BoxGeometry(.012, .1, .01), new THREE.MeshBasicMaterial({color:0x10104a}), 0, .37, .23); pupil.rotation.z = .3; g.add(pupil);
    g.add(at(glowSprite(C('#5a6aff'), .35, .45), 0, .37, .2));
    // torso, pauldrons and crossed arms
    P(new THREE.CylinderGeometry(.14, .12, .2, 8), statue, 0, .65, 0).scale.z = .75;
    for (const s of [-1,1]){ for (let l=0;l<2;l++){ const pd = P(new THREE.SphereGeometry(.09 - l*.015, 10, 8, 0, Math.PI*2, 0, Math.PI/2), l ? trim : statue, s*(.15 + l*.01), .73 - l*.035, 0); pd.scale.set(1.2, .65, 1); pd.rotation.z = -s*(.35 + l*.2); }
      P(new THREE.CylinderGeometry(.035, .032, .15, 8), statue, s*.16, .64, .02);
      const fore = P(new THREE.CylinderGeometry(.033, .03, .2, 8), trim, s*.02, .62, .1, 0, 0, Math.PI/2); fore.rotation.y = s*.25; fore.position.y += s*.02;
      P(new THREE.BoxGeometry(.045, .045, .05), statue, -s*.09, .62 + s*.02, .1); }
    P(new THREE.BoxGeometry(.03, .14, .02), trim, 0, .66, .095);     // chest ridge
    // helm
    P(new THREE.CylinderGeometry(.065, .07, .1, 10), statue, 0, .82, 0); P(new THREE.SphereGeometry(.068, 12, 8, 0, Math.PI*2, 0, Math.PI/2), statue, 0, .87, 0);
    P(new THREE.BoxGeometry(.016, .09, .14), trim, 0, .9, 0);
    g.add(mesh(new THREE.BoxGeometry(.08, .012, .01), new THREE.MeshBasicMaterial({color:0x9fe0ff}), 0, .83, .066)); g.add(at(glowSprite(C('#7ad0ff'), .14, .5), 0, .83, .075));
    // a small bird of blue light perched on the shoulder
    const bird = new THREE.Group(); bird.position.set(-.17, .76, .02); g.add(bird);
    const birdM = orbMat('#1a2a7a', '#7a9aff', '#e0e8ff'); bird.add(mesh(new THREE.SphereGeometry(.03, 12, 8), birdM)); bird.add(mesh(new THREE.SphereGeometry(.02, 10, 8), birdM, .015, .03, .015));
    bird.add(mesh(new THREE.ConeGeometry(.007, .02, 4), M.gold, .025, .032, .035)).children; bird.children[2].rotation.x = Math.PI/2;
    bird.add(at(glowSprite(C('#7a9aff'), .12, .5), 0, .01, 0));
    g.add(runeCircle(.5, '#7ad0ff', 'ring', .35)); g.add(pool(C('#6a8aff'), 1, .22));
    g.scale.setScalar(1.12);
    return {g, top:.95, anims:[{o:bird, kind:'bob', amp:.006, speed:3}, {o:eye, kind:'spin', speed:.4}]}; },
  malachite(t){ const g = new THREE.Group(); g.add(stoneRing(.3, 7, .12, '#123a2a', '#4dffc0', 3));
    const mat = colMat('#2bd99b', {glow:.9}), n = [0,5,7,9][t], h = [0,.45,.62,.82][t];
    const f1 = crystalFan(n, h, .05, 1.9, mat, 4); g.add(f1);
    if (t>=2){ const f2 = crystalFan(n-2, h*.75, .045, 1.7, mat, 9); f2.rotation.y = Math.PI/2; g.add(f2); }
    g.add(pool(C('#4dffc0'), .8, .2)); return {g, top:h*.8}; },
  starruby(t){ const g = new THREE.Group(), core = ['','#ffd27a','#ff9a7a','#ffe08a'][t], outer = ['','#ff4d2a','#ff1a3a','#ff6a10'][t];
    if (t<3){ const n = t===1 ? 4 : 6, parts = [];
      for (let i=0;i<n;i++){ const a = i/n*Math.PI*2, b = roughBlock(.15, .58 + (i%2)*.12, .12, 40+i, .15); xf(b, {rz:.3, x:.2}); xf(b, {ry:-a}); parts.push(b); }
      g.add(new THREE.Mesh(mergeGeometries(parts), glowStone('#2a201c', outer, 1.1)));
      const fl = flames(t===1 ? .5 : .65, .34, core, outer, 1); g.add(fl);
      g.add(mesh(brilliantGeo(.06), gemCrys('R', 5), 0, .14, 0)); }
    else { g.add(stoneRing(.3, 8, .11, '#241a16', outer, 7)); const sp = mesh(roughBlock(.24, 1.0, .22, 77, .18), glowStone('#2a1d18', '#ff7a2b', 1.3)); g.add(sp);
      g.add(flames(.55, .4, core, outer, 2)); const top = flames(.4, .2, core, outer, 5); top.position.y = .95; g.add(top); }
    g.add(pool(C(outer), .9, .3)); return {g, top:t===3 ? 1 : .5, embers:true}; },
  jade(t){ const g = new THREE.Group(), jade = crysMat('#0c3a26', '#4fd39a', '#d8ffe8', {glow:.55}); const tiers = t + 1; let y = 0;
    for (let i=0;i<tiers;i++){ const r = .26 - i*.045, h = .14 - i*.012; g.add(mesh(withH(new THREE.CylinderGeometry(r*.8, r, h, 8).toNonIndexed()), jade, 0, y + h/2, 0)); y += h;
      const roof = mesh(withH(new THREE.CylinderGeometry(r*.55, r*1.15, .04, 8).toNonIndexed()), M.gold, 0, y + .02, 0); g.add(roof); y += .04; }
    const orb = mesh(new THREE.SphereGeometry(.07, 20, 14), orbMat('#0a4030', '#8effc4', t===3 ? '#ffe9a0' : '#e8fff4'), 0, y + .08, 0); g.add(orb);
    if (t===3){ g.add(coins(26, .38, 5)); g.add(at(starSprite('#ffe08a', .35, .7), 0, y + .08, 0)); }
    g.add(pool(C('#5ad19a'), .8, .18)); return {g, top:y + .08, anims:[{o:orb, kind:'bob', amp:.02}]}; },
  redcrystal(t){ const g = new THREE.Group(), mat = crysMat('#4a0a1e', ['','#ff6b8b','#ff8aa3','#ffb0c4'][t], '#fff0f4'), parts = [];
    const n = [0,6,8,10][t], h = [0,.34,.44,.56][t];
    for (let i=0;i<n;i++){ const a = i/n*Math.PI*2; parts.push(xf(obelisk(.045, h, 50+i, false), {rz:-.75})); xf(parts[i], {ry:-a}); }
    if (t>=2) for (let i=0;i<n;i++){ const a = (i+.5)/n*Math.PI*2; parts.push(xf(xf(obelisk(.04, h*.8, 70+i, false), {rz:-.35}), {ry:-a})); }
    parts.push(obelisk(.07, h*1.5, 90, false));
    g.add(new THREE.Mesh(mergeGeometries(parts), mat)); g.add(stoneRing(.3, 7, .09, '#3a2a2e', '#ff8aa3', 8));
    g.add(pool(C('#ff8aa3'), .9, .22)); return {g, top:h*1.3}; },
  darkemerald(t){ const g = new THREE.Group(); g.add(runeCircle(.42, '#3dff8a', 'ring', .55)); g.add(stoneRing(.18, 5, .09, '#1e2a20', '#3dff8a', 4));
    const wood = new THREE.MeshStandardMaterial({color:0x6a4426, roughness:.8}), h = t===1 ? .72 : .86;
    g.add(mesh(new THREE.CylinderGeometry(.022, .03, h, 8), wood, 0, h/2, 0));
    const cup = mesh(new THREE.CylinderGeometry(.07, .03, .08, 8), M.gold, 0, h, 0); g.add(cup);
    const gem = mesh(brilliantGeo(.11, 8), gemCrys('E', 5), 0, h + .1, 0); gem.rotation.x = Math.PI; g.add(gem);
    if (t===2){ const rb = ribbons(.16, .8, 3, '#5dff9a'); rb.position.y = .25; g.add(rb); g.add(at(starSprite('#9dffb0', .4, .7), 0, h + .1, 0)); }
    g.add(pool(C('#3dff8a'), .7, .22)); return {g, top:h + .1, anims:[{o:gem, kind:'spin', speed:.8}]}; },
  gold(t){ const g = new THREE.Group();
    if (t===1){ g.add(mesh(roughBlock(.5, .16, .42, 3, .05), glowStone('#5a4a36', '#ffcf4a', .5))); g.add(coins(20, .2, 9)).children; const c = crystalFan(5, .5, .06, 1.3, colMat('#ffcf4a'), 21); c.position.y = .16; g.add(c); g.add(pool(C('#ffcf4a'), .8, .22)); return {g, top:.5}; }
    // Egyptian Gold: a stepped pyramid of polished gold banded with lapis, on a sandstone dais with four gold-tipped obelisks, a glowing pyramidion on top
    g.add(mesh(new THREE.BoxGeometry(.68, .06, .68), M.sand, 0, .03, 0)); g.add(mesh(new THREE.BoxGeometry(.58, .05, .58), M.sand, 0, .085, 0));
    g.add(mesh(new THREE.BoxGeometry(.6, .012, .6), M.goldLit, 0, .062, 0));
    let y = .11;
    for (let i=0;i<5;i++){ const w = .5 - i*.085; g.add(mesh(new THREE.BoxGeometry(w, .08, w), M.goldLit, 0, y + .04, 0)); y += .08;
      if (i < 4){ g.add(mesh(new THREE.BoxGeometry(w - .03, .014, w - .03), M.lapis, 0, y + .007, 0)); y += .014; } }
    const capGeo = withH(new THREE.ConeGeometry(.1, .18, 4).toNonIndexed()); capGeo.rotateY(Math.PI/4);
    const cap = mesh(capGeo, colMat('#ffd24a', {glow:1.2}), 0, y + .09, 0); g.add(cap); g.add(at(starSprite('#fff0b0', .45, .7), 0, y + .18, 0));
    for (const [sx, sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]){ g.add(mesh(new THREE.BoxGeometry(.045, .2, .045), M.sand, sx*.29, .21, sz*.29));
      const tip = mesh(new THREE.ConeGeometry(.034, .05, 4), M.goldLit, sx*.29, .335, sz*.29); tip.rotation.y = Math.PI/4; g.add(tip); }
    g.add(coins(16, .42, 4)); g.add(pool(C('#ffdc73'), .9, .18)); return {g, top:y + .18, anims:[{o:cap, kind:'bob', amp:.02}]}; },
  uranium(t){ const g = new THREE.Group(), n = 10, parts = [], h = t===1 ? .2 : .3;
    for (let i=0;i<n;i++){ const a = i/n*Math.PI*2; parts.push(xf(roughBlock(.11, h, .13, 60+i, .08), {x:Math.cos(a)*.22, z:Math.sin(a)*.22, ry:-a})); }
    g.add(new THREE.Mesh(mergeGeometries(parts), glowStone('#22281e', '#9dff4a', 1)));
    g.add(flames(t===1 ? .5 : .75, .32, '#f0ffb0', '#6aff2a', 3)); if (t===2){ const rb = ribbons(.26, .8, 2, '#c2ff5c', 1.4); g.add(rb); }
    g.add(runeCircle(.45, '#9dff4a', 'ring', .45)); g.add(pool(C('#9dff4a'), 1, .3)); return {g, top:.4, embers:true}; },
  pinkdiamond(t){ const g = new THREE.Group(), r = t===1 ? .19 : .25;
    g.add(mesh(new THREE.CylinderGeometry(.24, .28, .1, 6), glowStone('#3a2a36', '#ff9ad5', .5), 0, .05, 0));
    for (let i=0;i<(t===1?3:6);i++){ const a = i/(t===1?3:6)*Math.PI*2, p = mesh(new THREE.CylinderGeometry(.012, .018, .3, 5), M.gold, Math.cos(a)*.15, .22, Math.sin(a)*.15); p.rotation.set(Math.sin(a)*.4, 0, -Math.cos(a)*.4); g.add(p); }
    const d = mesh(brilliantGeo(r, 8), crysMat('#5a1840', t===1 ? '#ff9ad5' : '#ffb8e3', '#fff2fa', {rainbow:.1}), 0, .5 + r*.4, 0); d.rotation.x = 1.05; g.add(d);
    g.add(at(starSprite('#ffd0ee', .4, .6), .06, .62, .06)); g.add(pool(C('#ff9ad5'), .8, .2)); return {g, top:.55, anims:[{o:d, kind:'spin', speed:.5}, {o:d, kind:'bob', amp:.03}]}; },
  paraiba(t){ const g = new THREE.Group(), water = crysMat('#06405a', '#33e0ff', '#e8ffff', {glow:.7});
    g.add(mesh(withH(new THREE.CylinderGeometry(.38, .32, .14, 24, 1, true).toNonIndexed()), glowStone('#3a4a52', '#33e0ff', .5), 0, .07, 0));
    const surf = mesh(new THREE.CircleGeometry(.36, 32), water, 0, .12, 0); surf.rotation.x = -Math.PI/2; withH(surf.geometry); g.add(surf);
    g.add(runeCircle(.33, '#7af4ff', 'ring', .5)).children; g.children[g.children.length-1].position.y = .125;
    const c = crystalFan(t===1 ? 3 : 5, t===1 ? .5 : .7, .055, 1.0, colMat('#33e0ff', {glow:1}), 8); c.position.y = .1; g.add(c);
    const jet = flames(t===1 ? .55 : .8, .26, '#f0ffff', '#33c8ff', 6); jet.position.y = .1; g.add(jet);
    g.add(pool(C('#33e0ff'), 1, .28)); return {g, top:.55}; },
  blackopal(t){ const g = new THREE.Group(), h = t===1 ? .7 : 1;
    g.add(runeCircle(.46, '#b07cff', 'star', .7)); g.add(stoneRing(.22, 6, .1, '#16121e', '#7a5cff', 2));
    const mono = mesh(roughBlock(.18, h, .16, 5, .06), glowStone('#121018', '#9b84ff', 1)); g.add(mono);
    const tip = mesh(withH(new THREE.ConeGeometry(.11, .16, 4).toNonIndexed()), glowStone('#121018', '#c8b0ff', 1), 0, h + .08, 0); tip.rotation.y = Math.PI/4; g.add(tip);
    const rb = ribbons(.2, h*.9, t===1 ? 2 : 4, t===1 ? '#9b84ff' : '#7af0ff', 1); rb.position.y = .05; g.add(rb);
    g.add(pool(C('#7a5cff'), 1.1, .28)); return {g, top:h, anims:[{o:rb, kind:'spin', speed:.9}]}; },
  bloodstone(t){ const g = new THREE.Group(); g.add(stoneRing(.26, 7, .1, '#1e2620', '#ff3050', 6));
    const st = mesh(roughBlock(.28, t===1 ? .5 : .78, .14, 9, .12), glowStone('#1f3a2c', '#ff2a4a', 1.1)); g.add(st);
    const rune = runeCircle(.1, '#ff4060', 'star', 1); rune.rotation.set(0, 0, 0); rune.position.set(0, t===1 ? .3 : .45, .075); g.add(rune);
    if (t===2) for (const s of [-1,1]){ const m = mesh(roughBlock(.12, .4, .1, 20+s, .15), glowStone('#1f3a2c', '#ff2a4a', .9), s*.24, 0, -.08); m.rotation.z = s*.12; g.add(m); }
    g.add(pool(C('#e0294d'), .9, .26)); return {g, top:t===1 ? .45 : .7}; },
  yellowsapphire(t){ const g = new THREE.Group(), h = t===1 ? .22 : .32;
    g.add(mesh(new THREE.CylinderGeometry(.18, .24, .06, 24), M.gold, 0, .03, 0)); g.add(mesh(new THREE.CylinderGeometry(.02, .03, h, 8), M.gold, 0, .06 + h/2, 0));
    const y = .06 + h + .2, frame = new THREE.Group(); frame.position.y = y; g.add(frame);
    frame.add(mesh(new THREE.TorusGeometry(.21, .014, 6, 48), M.gold)); const fr2 = mesh(new THREE.TorusGeometry(.21, .01, 6, 48), M.gold); fr2.rotation.y = Math.PI/2; frame.add(fr2);
    g.add(mesh(new THREE.SphereGeometry(.17, 28, 20), orbMat('#3a2a00', '#ffe066', '#fff6c0'), 0, y, 0)); g.add(at(starSprite('#fff2a0', t===1 ? .5 : .75, .95), 0, y, 0));
    g.add(pool(C('#ffe066'), .9, .25)); return {g, top:y, anims:[{o:frame, kind:'spin', speed:.6}]}; },
  // ---- ultimates ----
  kohinoor(){ const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(.44, .48, .08, 40), M.marble, 0, .04, 0)); g.add(mesh(new THREE.CylinderGeometry(.34, .38, .07, 40), M.marble, 0, .115, 0));
    for (let i=0;i<4;i++){ const a = i/4*Math.PI*2 + Math.PI/4; g.add(mesh(new THREE.CylinderGeometry(.03, .035, .5, 10), M.gold, Math.cos(a)*.34, .4, Math.sin(a)*.34)); g.add(at(glowSprite(C('#fff3cc'), .2, .4), Math.cos(a)*.34, .67, Math.sin(a)*.34)); }
    const d = mesh(brilliantGeo(.3, 10), crysMat('#6a5a40', '#fff3cc', '#ffffff', {rainbow:.2}), 0, .78, 0); d.rotation.x = 1.05; g.add(d);
    g.add(runeCircle(.5, '#ffe9a0', 'star', .5)); g.add(pool(C('#fff3cc'), 1.1, .3)); return {g, top:.8, sparkle:true, anims:[{o:d, kind:'spin', speed:.4}, {o:d, kind:'bob', amp:.03}]}; },
  starsapphire(){ const g = new THREE.Group(); g.add(stoneRing(.32, 8, .11, '#1a2236', '#6aa0ff', 3));
    const sp = crystalFan(7, .4, .04, 2.2, ICE(), 5); g.add(sp); const sp2 = crystalFan(7, .4, .04, 2.2, ICE(), 6); sp2.rotation.y = Math.PI/2; g.add(sp2);
    const o = mesh(new THREE.SphereGeometry(.22, 32, 22), orbMat('#050c30', '#6aa0ff', '#dfe8ff'), 0, .62, 0); g.add(o); g.add(at(starSprite('#ffe9a0', .7, 1), 0, .62, 0));
    g.add(pool(C('#6aa0ff'), 1.1, .3)); return {g, top:.62, anims:[{o, kind:'bob', amp:.03}]}; },
  crownprince(){ const g = new THREE.Group(); g.add(stoneRing(.3, 8, .11, '#2a1416', '#ff2e4d', 4));
    g.add(mesh(roughBlock(.2, .5, .2, 3, .05), glowStone('#3a2024', '#ff5a3a', .9)));
    const crown = new THREE.Group(); crown.position.y = .5; g.add(crown); crown.add(mesh(new THREE.CylinderGeometry(.16, .14, .08, 16, 1, true), M.gold, 0, .04, 0));
    for (let i=0;i<8;i++){ const a = i/8*Math.PI*2, sp = mesh(new THREE.ConeGeometry(.025, .1, 4), M.gold, Math.cos(a)*.15, .12, Math.sin(a)*.15); crown.add(sp); }
    crown.add(mesh(brilliantGeo(.13, 12), gemCrys('R', 6), 0, .2, 0)); const fl = flames(.6, .45, '#ffe08a', '#ff2e1a', 4); fl.position.y = .3; g.add(fl);
    g.add(pool(C('#ff2e4d'), 1.1, .32)); return {g, top:.75, embers:true}; },
  plutonium(){ const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(.4, .44, .08, 8), M.polish, 0, .04, 0));
    for (let i=0;i<4;i++){ const a = i/4*Math.PI*2 + Math.PI/4; g.add(mesh(new THREE.BoxGeometry(.06, .8, .06), M.iron, Math.cos(a)*.3, .48, Math.sin(a)*.3)); }
    for (const y of [.12, .86]){ const r = mesh(new THREE.TorusGeometry(.32, .025, 6, 32), M.iron, 0, y, 0); r.rotation.x = Math.PI/2; g.add(r); }
    const core = mesh(new THREE.SphereGeometry(.2, 28, 20), orbMat('#0c3000', '#b6ff2e', '#f6ffd0'), 0, .48, 0); g.add(core); g.add(at(glowSprite(C('#b6ff2e'), 1.0, .35), 0, .48, 0));
    const rb = ribbons(.24, .75, 3, '#d6ff6a', 1.6); rb.position.y = .1; g.add(rb);
    g.add(runeCircle(.5, '#b6ff2e', 'ring', .5)); g.add(pool(C('#b6ff2e'), 1.2, .32)); return {g, top:.5, embers:true, anims:[{o:rb, kind:'spin', speed:1.2}]}; },
  cullinan(){ const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(.42, .46, .08, 40), M.marble, 0, .04, 0));
    const mat = crysMat('#4a5a7a', '#f2f8ff', '#ffffff', {rainbow:.4}), parts = [obelisk(.16, 1.15, 3, false)];
    for (let i=0;i<7;i++){ const a = i/7*Math.PI*2; parts.push(xf(xf(obelisk(.08, .45 + (i%3)*.15, 10+i, false), {rz:-.3}), {ry:-a, x:Math.cos(a)*.15, z:Math.sin(a)*.15})); }
    const m = new THREE.Mesh(mergeGeometries(parts), mat); m.position.y = .06; g.add(m); g.add(runeCircle(.5, '#e8f4ff', 'star', .45));
    g.add(pool(C('#f5fbff'), 1.2, .3)); return {g, top:1.1, sparkle:true}; },
  opalnebula(){ const g = new THREE.Group(); g.add(runeCircle(.5, '#ff9ad5', 'star', .7)); g.add(stoneRing(.26, 7, .1, '#2a1a30', '#ffc6e6', 9));
    const o = mesh(new THREE.SphereGeometry(.24, 32, 22), orbMat('#200a30', '#ff9ad5', '#9af0ff'), 0, .7, 0); g.add(o);
    const rb = ribbons(.3, .9, 4, '#c08cff', 1); g.add(rb); const rb2 = ribbons(.22, .9, 3, '#7af0ff', -1); g.add(rb2);
    g.add(at(glowSprite(C('#ffc6e6'), 1.1, .3), 0, .7, 0)); g.add(pool(C('#ffc6e6'), 1.3, .32)); return {g, top:.7, anims:[{o:rb, kind:'spin', speed:.7}, {o:rb2, kind:'spin', speed:-.9}, {o, kind:'bob', amp:.03}]}; },
  wingsstone(){ const g = new THREE.Group(); g.add(stoneRing(.28, 7, .1, '#3a2a10', '#ffd84a', 5));
    const gold = colMat('#ffd84a', {glow:1.1}); const main = mesh(obelisk(.12, .85, 4, false), gold); g.add(main);
    for (const s of [-1,1]){ const w = crystalFan(7, .6, .03, 1.6, gold, 40 + s); w.rotation.set(0, 0, s*1.1); w.position.set(s*.05, .45, 0); g.add(w); }
    g.add(at(starSprite('#fff2a0', .5, .8), 0, .95, 0)); g.add(pool(C('#ffd84a'), 1.1, .3)); return {g, top:.9}; },
  starofadam(){ const g = new THREE.Group(); const plate = mesh(new THREE.CylinderGeometry(.42, .46, .05, 6), ICE(), 0, .025, 0); withH(plate.geometry); g.add(plate);
    const mat = colMat('#2fdc9a', {glow:1}), parts = []; for (let i=0;i<8;i++){ const a = i/8*Math.PI*2; parts.push(xf(xf(obelisk(.035, .3, 30+i, false), {rz:-Math.PI/2}), {ry:-a})); }
    for (const s of [1,-1]) parts.push(xf(obelisk(.045, .34, 40, false), {rx: s>0 ? 0 : Math.PI}));
    const star = new THREE.Mesh(mergeGeometries(parts), mat); star.position.y = .62; g.add(star);
    g.add(at(glowSprite(C('#2fdc9a'), .9, .3), 0, .62, 0)); g.add(pool(C('#2fdc9a'), 1.1, .3)); return {g, top:.62, anims:[{o:star, kind:'spin', speed:.5}, {o:star, kind:'bob', amp:.04}]}; },
  obsidian(){ const g = new THREE.Group(); g.add(runeCircle(.45, '#5af0ff', 'star', .7)); g.add(stoneRing(.24, 6, .1, '#0c0a12', '#5af0ff', 3));
    const mono = mesh(roughBlock(.2, .95, .18, 21, .05), glowStone('#0a0810', '#5af0ff', 1.1)); g.add(mono);
    const tip = mesh(withH(new THREE.ConeGeometry(.13, .22, 4).toNonIndexed()), glowStone('#0a0810', '#b07cff', 1.1), 0, 1.06, 0); tip.rotation.y = Math.PI/4; g.add(tip);
    const rb = ribbons(.22, .9, 3, '#b07cff', 1.1); g.add(rb); const rb2 = ribbons(.18, .8, 2, '#5af0ff', -1); g.add(rb2);
    g.add(pool(C('#6a5fa8'), 1.1, .3)); return {g, top:.9, anims:[{o:rb, kind:'spin', speed:.8}, {o:rb2, kind:'spin', speed:-1}]}; },
};
const NEWFORMS = {
  // Star Ruby: a mound of black rock heaped into a pyramid, molten cracks through it, fire rising from its peak
  starruby(t){ const g = new THREE.Group(), anims = [], rock = glowStone('#0e0a0a', '#ff4a12', 1.35);
    const layers = [0, 3, 4, 5][t], parts = [], R = mkRng(300 + t);
    for (let l=0;l<layers;l++){ const n = Math.max(1, 9 - l*2), r = .3 - l*.07, y = l*.13;
      for (let i=0;i<n;i++){ const a = i/n*Math.PI*2 + l*.6, b = roughBlock(.15 - l*.015, .18 + R()*.06, .13 - l*.012, 300 + l*20 + i + t*100, .3);
        xf(b, {rz:-(.1 + R()*.1), x:n > 1 ? r : 0, y}); xf(b, {ry:-a}); parts.push(b); } }
    const pg = new THREE.ConeGeometry(.1, .3 + t*.06, 5); pg.deleteAttribute('uv'); const peak = withH(pg.toNonIndexed()); peak.translate(0, .15 + t*.03, 0); xf(peak, {y:layers*.13}); parts.push(peak);
    g.add(mesh(mergeGeometries(parts), rock));
    // glowing pebbles scattered round the foot
    const peb = []; for (let i=0;i<10;i++){ const a = i*2.4, d = .36 + (i%3)*.05; peb.push(xf(roughBlock(.05, .03, .04, 400+i, .3), {x:Math.cos(a)*d, z:Math.sin(a)*d, ry:a})); }
    g.add(mesh(mergeGeometries(peb), glowStone('#120c0a', '#ff6a1a', .8)));
    const topY = layers*.13 + .2 + t*.05;
    const fl = flames(.35 + t*.2, .25 + t*.07, '#ffe08a', ['', '#ff6a10', '#ff2a3a', '#ff5a10'][t], t); fl.position.y = topY - .05; g.add(fl);
    if (t===3){ const fl2 = flames(.5, .5, '#ffc060', '#ff3a10', 7); fl2.position.y = .15; g.add(fl2); }
    g.add(at(glowSprite(C('#ff5a20'), .6 + t*.2, .25), 0, topY, 0));
    g.add(pool(C('#ff4a20'), .9 + t*.1, .3)); return {g, top:topY, embers:true, anims}; },
  // Jade: a green obelisk on a stepped plinth, a glowing diamond rune on its face, light swirling round it; Lucky Asian Jade adds a spill of gold
  jade(t){ const g = new THREE.Group(), anims = [], stone = glowStone('#123a24', '#5aff9a', .9), base = glowStone('#0e2a1a', '#5aff9a', .5);
    g.add(runeCircle(.46, '#6aff9a', 'ring', .55));
    let y = 0; for (let i=0;i<3;i++){ const w = .52 - i*.09, h = .06; g.add(mesh(withH(new THREE.BoxGeometry(w, h, w).toNonIndexed()), base, 0, y + h/2, 0)); y += h; }
    const H = [0, .55, .72, .9][t];
    const ob = mesh(withH(new THREE.CylinderGeometry(.07, .13, H, 4).toNonIndexed()), stone, 0, y + H/2, 0); ob.rotation.y = Math.PI/4; g.add(ob);
    const tip = mesh(withH(new THREE.ConeGeometry(.07*Math.SQRT2*.72, .16, 4).toNonIndexed()), stone, 0, y + H + .08, 0); tip.rotation.y = Math.PI/4; g.add(tip);
    for (const [rx, ry] of [[0,0],[0,Math.PI/2],[0,Math.PI],[0,-Math.PI/2]]){ const d = mesh(withH(new THREE.OctahedronGeometry(.055, 0).toNonIndexed()), crysMat('#02301a', '#3aff8a', '#f0fff4', {glow:1.3}), 0, y + H*.5, 0);
      d.scale.set(.6, 1.2, .25); d.position.x = Math.sin(ry)*.1; d.position.z = Math.cos(ry)*.1; d.rotation.y = ry; g.add(d); }
    g.add(at(starSprite('#9affc0', .35, .7), 0, y + H*.5, .11));
    if (t>=2){ const rb = ribbons(.24, H + .1, t===3 ? 4 : 2, '#7affa8', 1.3); rb.position.y = y; g.add(rb); anims.push({o:rb, kind:'spin', speed:1}); }
    if (t===3) g.add(coins(22, .36, 5));
    g.add(pool(C('#4aff8a'), .9, .26)); return {g, top:y + H*.8, anims}; },
  // Dark Emerald: a carved pillar of green stone in banded tiers, a glowing rune on each tier, standing in a pool of green light
  darkemerald(t){ const g = new THREE.Group(), anims = [], stone = glowStone('#12301e', '#4aff7a', .55), band = glowStone('#1a3a26', '#6aff9a', .45);
    g.add(runeCircle(.46, '#4aff7a', 'ring', .6));
    g.add(mesh(withH(new THREE.CylinderGeometry(.3, .34, .08, 8).toNonIndexed()), band, 0, .04, 0));
    const tiers = t===1 ? 3 : 4; let y = .08;
    for (let i=0;i<tiers;i++){ const h = .17;
      g.add(mesh(withH(new THREE.BoxGeometry(.15, h, .15).toNonIndexed()), stone, 0, y + h/2, 0));
      for (let k=0;k<4;k++){ const a = k/4*Math.PI*2, r = mesh(new THREE.PlaneGeometry(.08, .12), new THREE.MeshBasicMaterial({map:null, color:0x6aff9a, transparent:true, opacity:.9}), Math.sin(a)*.0755, y + h/2, Math.cos(a)*.0755); r.rotation.y = a; r.rotation.z = Math.PI/4; r.scale.set(.6, .6, 1); g.add(r); }
      y += h; g.add(mesh(withH(new THREE.BoxGeometry(.2, .045, .2).toNonIndexed()), band, 0, y + .022, 0)); y += .045; }
    g.add(at(glowSprite(C('#6aff9a'), .5, .3), 0, y + .05, 0));
    const rb = ribbons(.26, y + .1, t===1 ? 2 : 4, '#8affb0', 1.1); g.add(rb); anims.push({o:rb, kind:'spin', speed:.9});
    g.add(pool(C('#4aff7a'), .95, .28)); return {g, top:y, anims}; },
  // Bloodstone: a crown of red crystal bursting from black rock, blue lightning crackling round a pool at its foot
  bloodstone(t){ const g = new THREE.Group(), anims = [], red = crysMat('#3a0008', '#ff2438', '#ffe0d0', {glow:1.2});
    g.add(runeCircle(.46, '#6ac8ff', 'ring', .6)); g.add(runeCircle(.36, '#ff3a4a', 'ring', .4));
    const rocks = []; for (let i=0;i<9;i++){ const a = i/9*Math.PI*2, b = roughBlock(.12, .1 + (i%3)*.04, .1, 500+i, .3); xf(b, {rz:-.4, x:.17}); xf(b, {ry:-a}); rocks.push(b); }
    g.add(mesh(mergeGeometries(rocks), glowStone('#0c0a0e', '#ff3a4a', .5)));
    const k = t===1 ? 1 : 1.3, parts = [xf(obelisk(.1*k, .5*k, 510, false), {y:.06})];
    for (let i=0;i<(t===1 ? 4 : 6);i++){ const a = i/(t===1 ? 4 : 6)*Math.PI*2 + .4, o = obelisk(.06*k, .3*k, 520+i, false); xf(o, {rz:-.5, x:.06}); xf(o, {ry:-a, y:.06}); parts.push(o); }
    g.add(new THREE.Mesh(mergeGeometries(parts), red)); g.add(at(starSprite('#ffe0c0', .35, .7), 0, .3*k, .08));
    if (t===2){ const sh = new THREE.Group(); sh.position.y = .55; ; for (let i=0;i<6;i++){ const a = i/6*Math.PI*2, s = mesh(withH(new THREE.OctahedronGeometry(.025, 0).toNonIndexed()), red, Math.cos(a)*.3, (i%2)*.12, Math.sin(a)*.3); s.scale.y = 1.6; sh.add(s); } anims.push({o:sh, kind:'spin', speed:.5}); }
    for (let i=0;i<4;i++){ const a = i/4*Math.PI*2 + .3, b = new THREE.Mesh(lightningGeo(new THREE.Vector3(Math.cos(a)*.42, .02, Math.sin(a)*.42), new THREE.Vector3(Math.cos(a+.5)*.3, .32, Math.sin(a+.5)*.3), 540+i, .1, 7), ribbonMat('#8ad8ff')); g.add(b); anims.push({o:b, kind:'flicker', phase:i}); }
    g.add(pool(C('#ff2a40'), .95, .3)); return {g, top:.4*k, anims}; },
  // Koh-i-Noor: a tiered tower of dark stone ribbed with blue light, a white-blue crystal burning at its crown, violet lightning coiling round
  kohinoor(){ const g = new THREE.Group(), anims = [], stone = glowStone('#141428', '#5ab8ff', 1.1), rim = glowStone('#1c1c34', '#9a7aff', .6);
    g.add(mesh(withH(new THREE.CylinderGeometry(.44, .48, .07, 24).toNonIndexed()), rim, 0, .035, 0)); g.add(runeCircle(.5, '#8a7aff', 'ring', .6));
    let y = .07; [[.3, .34, .22], [.24, .28, .2], [.19, .22, .18], [.14, .17, .15]].forEach(([rt, rb, h]) => {
      const tier = mesh(withH(new THREE.CylinderGeometry(rt*.78, rb*.92, h, 10).toNonIndexed()), stone, 0, y + h/2, 0); g.add(tier);
      for (let k=0;k<10;k++){ const a = k/10*Math.PI*2, rib = mesh(new THREE.BoxGeometry(.022, h*.9, .03), rim, Math.cos(a)*rb*.86, y + h/2, Math.sin(a)*rb*.86); rib.rotation.y = -a; rib.rotation.z = (rb - rt*.78)/h*.8*0; g.add(rib); }
      const lip = mesh(new THREE.TorusGeometry(rt, .02, 5, 24), rim, 0, y + h, 0); lip.rotation.x = Math.PI/2; g.add(lip); y += h; });
    const cr = mesh(obelisk(.08, .22, 600, false), crysMat('#0a2a6a', '#8ad0ff', '#ffffff', {glow:1.3}), 0, y, 0); g.add(cr);
    g.add(at(starSprite('#d8f0ff', .45, .8), 0, y + .14, 0)); g.add(at(glowSprite(C('#7ab0ff'), .7, .3), 0, y + .1, 0));
    const rb = ribbons(.34, y + .1, 3, '#b08aff', 1.4); g.add(rb); anims.push({o:rb, kind:'spin', speed:.8});
    for (let i=0;i<3;i++){ const a = i/3*Math.PI*2, b = new THREE.Mesh(lightningGeo(new THREE.Vector3(Math.cos(a)*.35, .1, Math.sin(a)*.35), new THREE.Vector3(Math.cos(a+1.4)*.1, y + .15, Math.sin(a+1.4)*.1), 610+i, .14, 9), ribbonMat('#c8a0ff')); g.add(b); anims.push({o:b, kind:'flicker', phase:i*1.7}); }
    g.add(pool(C('#7a8aff'), 1.1, .3)); return {g, top:y + .1, sparkle:true, anims}; },
  // Wings of Topaz: two great wings of golden light rising out of a rippling rune on the ground, a topaz heart where they meet
  wingsstone(){ const g = new THREE.Group(), anims = [], gold = crysMat('#3a2400', '#ffc830', '#fff8d8', {glow:1.3});
    for (const [r, op] of [[.46, .7], [.34, .55], [.22, .45]]) g.add(runeCircle(r, '#ffd84a', 'ring', op));
    const w = new THREE.Group(); w.position.y = .45; g.add(w);
    for (const s of [-1,1]){ const feathers = [];
      for (let i=0;i<9;i++){ const t = i/8, len = .26 + Math.sin(t*Math.PI)*.22 + (1-t)*.12, o = obelisk(.018, len, 700 + i + (s>0 ? 20 : 0), false);
        xf(o, {rz:-s*(.15 + t*1.25)}); xf(o, {x:s*(.03 + t*.06), y:t*.12}); feathers.push(o); }
      const lower = []; for (let i=0;i<5;i++){ const o = obelisk(.014, .22 - i*.02, 740 + i + (s>0 ? 20 : 0), false); xf(o, {rz:-s*(2.4 + i*.15)}); xf(o, {x:s*.03}); lower.push(o); }
      w.add(new THREE.Mesh(mergeGeometries([...feathers, ...lower]), gold)); }
    const heart = mesh(withH(new THREE.OctahedronGeometry(.045, 0).toNonIndexed()), crysMat('#4a2a00', '#ffe060', '#ffffff', {glow:1.4})); heart.scale.y = 1.6; w.add(heart);
    w.add(at(starSprite('#fff2b0', .4, .9), 0, 0, .02));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.008, .03, .45, 8, 1, true), ribbonMat('#ffe08a')); stem.position.y = .22; g.add(stem);
    g.add(at(glowSprite(C('#ffd84a'), 1.1, .25), 0, .5, 0));
    w.scale.setScalar(1.35); w.position.y = .5;
    anims.push({o:w, kind:'bob', amp:.025, speed:1.1});
    g.add(pool(C('#ffc830'), 1.1, .3)); return {g, top:.55, anims}; },
  // Obsidian: a great shard of black glass split by a blue fissure, ringed with spikes, golden lightning breaking from it
  obsidian(){ const g = new THREE.Group(), anims = [], glass = glowStone('#14161e', '#5aa0ff', .35);
    g.add(runeCircle(.45, '#ffd27a', 'ring', .45));
    const body = new THREE.Group(); body.position.y = .55; g.add(body);
    const shard = mesh(withH(new THREE.OctahedronGeometry(.2, 0).toNonIndexed()), glass); shard.scale.set(1.1, 2.1, .85); body.add(shard);
    const core = mesh(withH(new THREE.OctahedronGeometry(.07, 0).toNonIndexed()), crysMat('#0a1a6a', '#4a8aff', '#e8f4ff', {glow:1.5}), 0, 0, .085); core.scale.set(.45, 4, .4); body.add(core);
    body.add(at(glowSprite(C('#4a8aff'), .45, .5), 0, 0, .1));
    const sp = []; for (let i=0;i<12;i++){ const a = i/12*Math.PI*2, o = withH(new THREE.ConeGeometry(.035, .16 + (i%2)*.08, 4).toNonIndexed()); xf(o, {rz:-Math.PI/2}); xf(o, {x:.2 + (i%2)*.03}); xf(o, {rz:a}); sp.push(o); }
    const ring = new THREE.Mesh(mergeGeometries(sp), glass); ring.scale.z = .5; body.add(ring);
    body.add(at(glowSprite(C('#ffc040'), 1.1, .22), 0, 0, -.08));
    for (let i=0;i<4;i++){ const a = i/4*Math.PI*2 + .6, b = new THREE.Mesh(lightningGeo(new THREE.Vector3(Math.cos(a)*.15, .55 + Math.sin(a)*.2, 0), new THREE.Vector3(Math.cos(a)*.6, .55 + Math.sin(a)*.5, .05), 800+i, .12, 7), ribbonMat('#ffd060')); g.add(b); anims.push({o:b, kind:'flicker', phase:i*1.3}); }
    anims.push({o:body, kind:'bob', amp:.03, speed:1}, {o:body, kind:'spin', speed:.2});
    g.add(pool(C('#4a7aff'), .9, .25)); return {g, top:.7, anims}; },
};
delete NEWFORMS.wingsstone;   // keep the earlier crystal-winged design
const NEWFORMS2 = {
  // Star Ruby: a mound of black rock with molten seams; each upgrade grows it toward a volcano with a burning crater
  starruby(t){ const g = new THREE.Group(), anims = [], rock = glowStone('#0e0a0a', '#ff4a12', 1.3), R = mkRng(300 + t);
    const layers = [0, 2, 3, 4][t], parts = [];
    for (let l=0;l<layers;l++){ const n = 10 - l*2, r = .3 - l*.065, y = l*.12;
      for (let i=0;i<n;i++){ const a = i/n*Math.PI*2 + l*.6, b = roughBlock(.15 - l*.015, .16 + R()*.05, .13 - l*.012, 300 + l*20 + i + t*100, .25);
        xf(b, {rz:-(.12 + R()*.08), x:r, y}); xf(b, {ry:-a}); parts.push(b); } }
    g.add(mesh(mergeGeometries(parts), rock));
    // the crater: a ring of jagged teeth round a pool of lava
    const cy = layers*.12 + .02, cr = [0, .1, .12, .14][t], teeth = [];
    for (let i=0;i<(t===1 ? 6 : 9);i++){ const a = i/(t===1 ? 6 : 9)*Math.PI*2, h = .06 + (i%3)*.03 + t*.015, c = new THREE.ConeGeometry(.035, h, 4); c.deleteAttribute('uv');
      const cg = withH(c.toNonIndexed()); xf(cg, {y:h/2}); xf(cg, {rz:-.25}); xf(cg, {x:cr, y:cy}); xf(cg, {ry:-a}); teeth.push(cg); }
    g.add(mesh(mergeGeometries(teeth), rock));
    const lava = mesh(new THREE.CircleGeometry(cr*.95, 20), new THREE.MeshBasicMaterial({color:new THREE.Color(2.2, .8, .15)}), 0, cy + .02, 0); lava.rotation.x = -Math.PI/2; g.add(lava);
    const fl = flames(.25 + t*.18, .18 + t*.06, '#ffe08a', ['', '#ff7a10', '#ff3a20', '#ff5a10'][t], t); fl.position.y = cy + .01; g.add(fl);
    if (t>=2){ // molten streams running down the sides
      for (let i=0;i<(t===2 ? 3 : 5);i++){ const a = i/(t===2 ? 3 : 5)*Math.PI*2 + .3, st = mesh(new THREE.BoxGeometry(.03, cy*.9, .02), new THREE.MeshBasicMaterial({color:new THREE.Color(1.8, .5, .1)}), Math.cos(a)*(cr + .1), cy*.45, Math.sin(a)*(cr + .1));
        st.lookAt(0, st.position.y, 0); st.rotateX(-.38); g.add(st); } }
    if (t===3){ const sh = new THREE.Group(); sh.position.y = cy + .3; ;
      for (let i=0;i<5;i++){ const a = i/5*Math.PI*2, b = mesh(roughBlock(.05, .05, .04, 380+i, .3), rock, Math.cos(a)*.3, (i%2)*.1, Math.sin(a)*.3); sh.add(b); }
      anims.push({o:sh, kind:'spin', speed:.5}); }
    g.add(at(glowSprite(C('#ff5a20'), .5 + t*.25, .25), 0, cy + .1, 0));
    g.add(pool(C('#ff4a20'), .8 + t*.15, .28)); return {g, top:cy + .1, embers:true, anims}; },
  // Jade: a pale, milky green obelisk on a stepped plinth, soft rune diamonds on its faces; Lucky Asian Jade adds a spill of gold
  jade(t){ const g = new THREE.Group(), stone = glowStone('#4a9a72', '#c8ffd8', .35), base = glowStone('#2e6a4c', '#a8f0c0', .25);
    g.add(runeCircle(.44, '#9af0b8', 'ring', .35));
    let y = 0; for (let i=0;i<3;i++){ const w = .52 - i*.09, h = .06; g.add(mesh(withH(new THREE.BoxGeometry(w, h, w).toNonIndexed()), base, 0, y + h/2, 0)); y += h; }
    const H = [0, .5, .66, .82][t];
    const ob = mesh(withH(new THREE.CylinderGeometry(.07, .13, H, 4).toNonIndexed()), stone, 0, y + H/2, 0); ob.rotation.y = Math.PI/4; g.add(ob);
    const tip = mesh(withH(new THREE.ConeGeometry(.07*Math.SQRT2*.72, .16, 4).toNonIndexed()), stone, 0, y + H + .08, 0); tip.rotation.y = Math.PI/4; g.add(tip);
    for (const ry of [0, Math.PI/2, Math.PI, -Math.PI/2]){ const d = mesh(new THREE.PlaneGeometry(.07, .1), new THREE.MeshBasicMaterial({color:0xb8ffd0, transparent:true, opacity:.8}), Math.sin(ry)*.081, y + H*.45, Math.cos(ry)*.081);
      d.rotation.y = ry; d.rotation.z = Math.PI/4; d.scale.set(.6, .6, 1); g.add(d); }
    if (t===3) g.add(coins(22, .36, 5));
    g.add(pool(C('#8af0b0'), .8, .16)); return {g, top:y + H*.8, anims:[]}; },
  // Dark Emerald: a tall carved pillar of deep, polished emerald, banded in dark stone, an emerald burning at its crown
  darkemerald(t){ const g = new THREE.Group(), anims = [], gem = crysMat('#001a08', '#0aa040', '#c8ffd8', {glow:.9}), band = glowStone('#0a1a10', '#1aff6a', .5);
    g.add(runeCircle(.5, '#1aff6a', 'ring', .5));
    g.add(mesh(withH(new THREE.CylinderGeometry(.34, .38, .09, 8).toNonIndexed()), band, 0, .045, 0));
    const tiers = t===1 ? 3 : 4; let y = .09;
    for (let i=0;i<tiers;i++){ const h = .2;
      const seg = mesh(withH(new THREE.CylinderGeometry(.1, .11, h, 6).toNonIndexed()), gem, 0, y + h/2, 0); g.add(seg);
      y += h; g.add(mesh(withH(new THREE.CylinderGeometry(.15, .14, .05, 6).toNonIndexed()), band, 0, y + .025, 0)); y += .05; }
    const crown = mesh(obelisk(.08, .22, 610, false), crysMat('#002a10', '#20ff70', '#f0fff4', {glow:1.3}), 0, y, 0); g.add(crown);
    g.add(at(starSprite('#a8ffc8', .35, .75), 0, y + .14, 0)); g.add(at(glowSprite(C('#1aff6a'), .6, .3), 0, y + .1, 0));
    if (t===2){ for (let i=0;i<4;i++){ const a = i/4*Math.PI*2 + Math.PI/4, o = mesh(obelisk(.035, .2, 620+i, false), gem, Math.cos(a)*.22, .09, Math.sin(a)*.22); o.rotation.z = -Math.cos(a)*.2; o.rotation.x = Math.sin(a)*.2; g.add(o); } }
    g.scale.setScalar(1.25);
    g.add(pool(C('#1aff6a'), .9, .26)); return {g, top:(y + .1)*1.25, anims}; },
  // Obsidian: a black glass obelisk on a stepped plinth, split by a blue fissure, spikes at its foot, gold lightning breaking from it
  obsidian(){ const g = new THREE.Group(), anims = [], glass = glowStone('#0a0b10', '#3a6aff', .12);
    g.add(runeCircle(.46, '#ffd27a', 'ring', .45));
    let y = 0; for (let i=0;i<3;i++){ const w = .56 - i*.1, h = .06; g.add(mesh(withH(new THREE.BoxGeometry(w, h, w).toNonIndexed()), glass, 0, y + h/2, 0)); y += h; }
    const H = .95, ob = mesh(withH(new THREE.CylinderGeometry(.06, .14, H, 4).toNonIndexed()), glass, 0, y + H/2, 0); ob.rotation.y = Math.PI/4; g.add(ob);
    const tip = mesh(withH(new THREE.ConeGeometry(.06*Math.SQRT2*.72, .18, 4).toNonIndexed()), glass, 0, y + H + .09, 0); tip.rotation.y = Math.PI/4; g.add(tip);
    const blue = new THREE.MeshBasicMaterial({color:new THREE.Color(.5, .9, 2.2)});
    for (const ry of [0, Math.PI]){ const f = new THREE.Mesh(lightningGeo(new THREE.Vector3(0, y + .05, 0), new THREE.Vector3(0, y + H, 0), 820 + ry, .04, 10), blue);
      f.position.z = Math.cos(ry)*.072; f.scale.set(1, 1, .01); g.add(f); }
    g.add(at(glowSprite(C('#4a8aff'), .5, .35), 0, y + H*.5, .1));
    const sp = []; for (let i=0;i<10;i++){ const a = i/10*Math.PI*2, c = new THREE.ConeGeometry(.03, .14 + (i%2)*.08, 4); c.deleteAttribute('uv'); const o = withH(c.toNonIndexed()); xf(o, {y:.07}); xf(o, {rz:-.6}); xf(o, {x:.16, y:y}); xf(o, {ry:-a}); sp.push(o); }
    g.add(mesh(mergeGeometries(sp), glass));
    g.add(at(glowSprite(C('#ffc040'), .9, .18), 0, y + H*.6, -.1));
    for (let i=0;i<4;i++){ const a = i/4*Math.PI*2 + .6, b = new THREE.Mesh(lightningGeo(new THREE.Vector3(Math.cos(a)*.08, y + .5 + i*.1, Math.sin(a)*.08), new THREE.Vector3(Math.cos(a)*.5, y + .7 + i*.12, Math.sin(a)*.5), 800+i, .12, 7), ribbonMat('#ffd060')); g.add(b); anims.push({o:b, kind:'flicker', phase:i*1.3}); }
    g.add(pool(C('#4a7aff'), .9, .25)); return {g, top:y + H*.8, anims}; },
};
Object.assign(FORMS, NEWFORMS, NEWFORMS2);
NEWFORMS2.obsidian = function(){
  // Obsidian: a tall crystal of black volcanic glass veined with cyan light, a crown of black shards splaying round its foot,
  // set in a cup of broken rock over rippling cyan water, glass splinters drifting and cyan arcs crackling round it
  const g = new THREE.Group(), anims = [];
  const black = crysMat('#020206', '#1c1a34', '#5af0ff', {glow:1.15}), shardM = crysMat('#010104', '#14122a', '#7a9aff', {glow:.9});
  for (const [r, op] of [[.5, .45], [.4, .55], [.3, .4]]) g.add(runeCircle(r, '#5af0ff', 'ring', op));
  const rocks = []; for (let i=0;i<11;i++){ const a = i/11*Math.PI*2, b = roughBlock(.11, .07 + (i%3)*.03, .09, 860+i, .3); xf(b, {rz:-.5, x:.2}); xf(b, {ry:-a}); rocks.push(b); }
  g.add(mesh(mergeGeometries(rocks), glowStone('#08080c', '#5af0ff', .45)));
  // the main crystal, faceted and leaning slightly, with a bright facet near its tip
  const main = obelisk(.12, .95, 870, false); xf(main, {rz:.04, y:.04});
  const crown = [];
  for (let i=0;i<9;i++){ const a = i/9*Math.PI*2 + .3, len = .28 + (i%3)*.1, o = obelisk(len*.16, len, 880+i, false); xf(o, {rz:-(.45 + (i%2)*.2)}); xf(o, {x:.08, y:.03}); xf(o, {ry:-a}); crown.push(o); }
  g.add(new THREE.Mesh(main, black)); g.add(new THREE.Mesh(mergeGeometries(crown), shardM));
  g.add(at(starSprite('#e8f8ff', .3, .8), .02, .98, .1));
  // cyan veins: a fissure of light up the front of the crystal
  const vein = new THREE.Mesh(lightningGeo(new THREE.Vector3(0, .12, .11), new THREE.Vector3(.01, .85, .07), 890, .04, 10), new THREE.MeshBasicMaterial({color:new THREE.Color(.4, 1.8, 2.2)})); g.add(vein);
  g.add(at(glowSprite(C('#3ae0ff'), .7, .3), 0, .2, 0));
  // splinters of glass drifting round it
  const drift = new THREE.Group(); drift.position.y = .55; ;
  for (let i=0;i<7;i++){ const a = i/7*Math.PI*2, s = mesh(withH(new THREE.OctahedronGeometry(.025, 0).toNonIndexed()), black, Math.cos(a)*.36, (i%3)*.15 - .1, Math.sin(a)*.36); s.scale.y = 2; drift.add(s); }
  anims.push({o:drift, kind:'spin', speed:.4});
  // cyan arcs crackling out from the crystal
  for (let i=0;i<4;i++){ const a = i/4*Math.PI*2 + .5, b = new THREE.Mesh(lightningGeo(new THREE.Vector3(Math.cos(a)*.08, .4 + i*.1, Math.sin(a)*.08), new THREE.Vector3(Math.cos(a)*.5, .65 + i*.1, Math.sin(a)*.5), 900+i, .12, 7), ribbonMat('#6af0ff')); g.add(b); anims.push({o:b, kind:'flicker', phase:i*1.3}); }
  g.add(pool(C('#2ad0ff'), 1, .3));
  return {g, top:.8, anims}; };
Object.assign(FORMS, {obsidian:NEWFORMS2.obsidian});
function buildForm(key, d){ const fam = famOf(key), t = (key.match(/(\d)$/) || [0, 1])[1] | 0, f = FORMS[fam] || FORMS[key];
  const r = f(t || 1, d); r.anims = r.anims || []; return r; }

function lightningGeo(a, b, seed, jag=.12, n=8){ const R = mkRng(seed), pts = [];
  for (let i=0;i<=n;i++){ const t = i/n, p = a.clone().lerp(b, t); if (i && i<n) p.add(new THREE.Vector3((R()-.5)*jag, (R()-.5)*jag*.6, (R()-.5)*jag)); pts.push(p); }
  const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0), 32, .008, 4, false); tg.userData.bolt = true; return tg; }
// a dark jewel whose every facet is a different deep colour, lit from inside and edged in light
function facetMat(){ return fxCache.facet || (fxCache.facet = new THREE.ShaderMaterial({ uniforms:{time:crysU.time}, vertexShader:`attribute vec3 fcol; attribute float aH; varying vec3 vC; varying float vH; varying vec3 vW; varying vec3 vL;
    void main(){ vC = fcol; vH = aH; vL = position; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader:`uniform float time; varying vec3 vC; varying float vH; varying vec3 vW; varying vec3 vL;
    float h1(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
    void main(){ vec3 n = normalize(cross(dFdx(vW), dFdy(vW))), v = normalize(cameraPosition - vW); if (dot(n,v) < 0.) n = -n;
      vec3 L = normalize(vec3(-.45,.75,.5)); float lit = dot(n, L)*.5 + .5, fres = pow(1. - max(dot(n,v),0.), 2.2);
      vec3 col = vC*vC*(.08 + 1.1*lit*lit);                                      // deep, dark facets
      float core = pow(1. - clamp(length(vL.xz)*2.4, 0., 1.), 2.)*smoothstep(.0, .5, vH)*(1. - smoothstep(.6, 1., vH));
      col += mix(vC, vec3(1.,.8,.4), .4)*core*.55;                          // light burning in the heart
      col += vC*fres*.7;                                  // bright facet edges
      col += mix(vC, vec3(1.,.95,.8), .5)*pow(max(dot(reflect(-L, n), v), 0.), 30.)*.6;
      vec3 p = vL*30.; float hc = h1(floor(p)); col += vec3(1.,.9,.7)*step(.97, hc)*smoothstep(.25, 0., length(fract(p)-.5))*(1. + sin(time*3. + hc*50.));
      gl_FragColor = vec4(col, 1.); }` })); }
function facetedJewel(r, h, seed){
  const pts = [[0,-h*.42],[r*.55,-h*.22],[r*.9,-h*.05],[r,h*.08],[r*.86,h*.24],[r*.6,h*.4],[r*.28,h*.54],[0,h*.64]].map(([x,y]) => new THREE.Vector2(x, y));
  let geo = new THREE.LatheGeometry(pts, 9); geo.deleteAttribute('uv'); geo.deleteAttribute('normal'); geo = mergeVertices(geo);
  const p = geo.attributes.position, R = mkRng(seed); for (let i=0;i<p.count;i++){ const y = p.getY(i); if (Math.abs(p.getX(i)) + Math.abs(p.getZ(i)) < 1e-4) continue; const k = 1 + (R()-.5)*.16; p.setXYZ(i, p.getX(i)*k, y + (R()-.5)*h*.05, p.getZ(i)*k); }
  geo = geo.toNonIndexed(); geo.computeVertexNormals(); withH(geo);
  // colour flows round the stone in broad bands (violet, teal, emerald, gold), each facet a little lighter or darker
  const PAL = ['#5a22c0','#1290b0','#1aa048','#d09a10'].map(h => C(h)), pos = geo.attributes.position, fc = new Float32Array(pos.count*3), R2 = mkRng(seed+7), c = new THREE.Color();
  for (let i=0;i<pos.count/3;i++){ let x = 0, y = 0, z = 0; for (let j=0;j<3;j++){ x += pos.getX(i*3+j); y += pos.getY(i*3+j); z += pos.getZ(i*3+j); }
    const u = ((Math.atan2(z, x)/(Math.PI*2) + 1) % 1)*PAL.length + y/h*1.2, k = Math.floor(u), f = u - k;
    c.copy(PAL[((k % 4) + 4) % 4]).lerp(PAL[(((k+1) % 4) + 4) % 4], THREE.MathUtils.smoothstep(f, .3, .7)).multiplyScalar(.7 + R2()*.6);
    for (let j=0;j<3;j++){ fc[i*9+j*3] = c.r; fc[i*9+j*3+1] = c.g; fc[i*9+j*3+2] = c.b; } }
  geo.setAttribute('fcol', new THREE.BufferAttribute(fc, 3)); return geo; }
// the great jewel: a deep magenta crown over a golden pavilion, a shard of blue light at its heart
function greatJewel(r, h){
  const pts = [[0,-h*.55],[r*.35,-h*.4],[r*.8,-h*.12],[r,0],[r*.92,h*.1],[r*.62,h*.26],[r*.28,h*.4],[0,h*.46]].map(([x,y]) => new THREE.Vector2(x, y));
  let geo = new THREE.LatheGeometry(pts, 8); geo.deleteAttribute('uv'); geo.deleteAttribute('normal'); geo = mergeVertices(geo);
  const p = geo.attributes.position, R = mkRng(17); for (let i=0;i<p.count;i++){ if (Math.abs(p.getX(i)) + Math.abs(p.getZ(i)) < 1e-4) continue; const k = 1 + (R()-.5)*.1; p.setXYZ(i, p.getX(i)*k, p.getY(i) + (R()-.5)*h*.03, p.getZ(i)*k); }
  geo = geo.toNonIndexed(); geo.computeVertexNormals(); withH(geo);
  const top = ['#b01870','#c82480','#a01a78','#d03a8a'].map(C), bot = ['#d08a10','#f0b020','#c06a10','#e8a030'].map(C);
  const pos = geo.attributes.position, fc = new Float32Array(pos.count*3), R2 = mkRng(29), c = new THREE.Color();
  for (let i=0;i<pos.count/3;i++){ let y = 0; for (let j=0;j<3;j++) y += pos.getY(i*3+j); y /= 3;
    const pal = y < -h*.02 ? bot : top; c.copy(pal[Math.floor(R2()*pal.length)]).multiplyScalar(.85 + R2()*.3);
    for (let j=0;j<3;j++){ fc[i*9+j*3] = c.r; fc[i*9+j*3+1] = c.g; fc[i*9+j*3+2] = c.b; } }
  geo.setAttribute('fcol', new THREE.BufferAttribute(fc, 3)); return geo; }
// a chunky faceted gem whose colour flows gold, green and violet round its faces
function heartGem(r, h){
  const pts = [[0,-h*.3],[r*.7,-h*.2],[r,0],[r*.95,h*.18],[r*.6,h*.42],[r*.2,h*.6],[0,h*.7]].map(([x,y]) => new THREE.Vector2(x, y));
  let geo = new THREE.LatheGeometry(pts, 7); geo.deleteAttribute('uv'); geo.deleteAttribute('normal'); geo = mergeVertices(geo);
  const p = geo.attributes.position, R = mkRng(33); for (let i=0;i<p.count;i++){ if (Math.abs(p.getX(i)) + Math.abs(p.getZ(i)) < 1e-4) continue; const k = 1 + (R()-.5)*.14; p.setXYZ(i, p.getX(i)*k, p.getY(i) + (R()-.5)*h*.04, p.getZ(i)*k); }
  geo = geo.toNonIndexed(); geo.computeVertexNormals(); withH(geo);
  const PAL = ['#e0a810','#22a848','#6a2ad0','#f0c020'].map(C), pos = geo.attributes.position, fc = new Float32Array(pos.count*3), R2 = mkRng(41), c = new THREE.Color();
  for (let i=0;i<pos.count/3;i++){ let x = 0, z = 0, y = 0; for (let j=0;j<3;j++){ x += pos.getX(i*3+j); y += pos.getY(i*3+j); z += pos.getZ(i*3+j); }
    const u = ((Math.atan2(z, x)/(Math.PI*2) + 1) % 1)*4, k = Math.floor(u), f = u - k;
    c.copy(PAL[k % 4]).lerp(PAL[(k+1) % 4], THREE.MathUtils.smoothstep(f, .35, .65)).multiplyScalar(.8 + R2()*.4);
    for (let j=0;j<3;j++){ fc[i*9+j*3] = c.r; fc[i*9+j*3+1] = c.g; fc[i*9+j*3+2] = c.b; } }
  geo.setAttribute('fcol', new THREE.BufferAttribute(fc, 3)); return geo; }
function buildGreat(){
  // The Great Stone: a burst of prismatic crystals rising from a cup of black rock, set on a round stone dais
  // ringed in gold, cyan and violet light, with shards of every colour drifting round it
  const g = new THREE.Group(), anims = [];
  // stone dais of fitted slabs
  const slabs = []; for (let ring=0; ring<2; ring++){ const n = ring ? 16 : 9, r = ring ? .44 : .25; for (let i=0;i<n;i++){ const a = (i + ring*.5)/n*Math.PI*2; slabs.push(xf(roughBlock(ring ? .17 : .17, .07, ring ? .14 : .15, 2100 + ring*20 + i, .05), {x:Math.cos(a)*r, z:Math.sin(a)*r, ry:-a})); } }
  g.add(mesh(mergeGeometries(slabs), glowStone('#3a3640', '#ffd27a', .35)));
  for (const [r, col, sp] of [[.54, '#ffd27a', .15], [.47, '#5ae8ff', -.22], [.4, '#b07cff', .3]]){ const ring = runeCircle(r, col, 'ring', .7); ring.position.y = .075; g.add(ring); anims.push({o:ring, kind:'spin', speed:sp, axis:'z'}); }
  // cup of black rock
  const cup = []; for (let i=0;i<11;i++){ const a = i/11*Math.PI*2, b = roughBlock(.12, .14 + (i%3)*.03, .09, 2150+i, .25); xf(b, {rz:-.55, x:.15}); xf(b, {ry:-a}); cup.push(b); }
  g.add(mesh(mergeGeometries(cup), glowStone('#0c0a12', '#c07cff', .55), 0, .06, 0));
  // the burst: prismatic centre, cyan and violet spires, amber and pink fanning out
  const PRISM = ['#0c0820','#9a7aff','#ffe8ff','R'], CY = ['#022a3a','#3ae0ff','#effeff'], VI = ['#120632','#8a4aff','#f0e4ff'], AM = ['#3a1a00','#ffaa20','#fff4c8'], PK = ['#3a0830','#ff5ac0','#ffe4f6'], GN = ['#022a14','#3aff9a','#eaffee'];
  const rnd = mkRng(2200), parts = [], add = (mat, len, w, r, tilt, a, seed) => { const o = obelisk(len*w, len, seed, false); xf(o, {rz:-(tilt + (rnd()-.5)*.15)}); xf(o, {x:r}); xf(o, {ry:-a}); parts.push({o, mat}); };
  add(PRISM, 1.05, .2, 0, 0, 0, 2201); add(['#1a0c00','#ff9a30','#fff0c0','R'], .72, .18, .08, .18, .4, 2202); add(['#021a2a','#3ab8ff','#e8f8ff','R'], .7, .18, .08, .18, Math.PI + .4, 2203);
  add(CY, .66, .15, .14, .3, Math.PI*.6, 2204); add(CY, .62, .15, .14, .3, -Math.PI*.4, 2205); add(VI, .58, .15, .14, .32, Math.PI*.1, 2206); add(VI, .56, .15, .14, .32, Math.PI*1.1, 2207);
  for (let i=0;i<12;i++){ const a = i/12*Math.PI*2 + .2; add([AM, PK, VI, CY, GN, AM][i%6], .4 + (i%3)*.06, .15, .18, .85 + (i%2)*.15, a, 2210+i); }
  const byMat = new Map(); for (const {o, mat} of parts){ const k = mat.join(); if (!byMat.has(k)) byMat.set(k, {mat, geos:[]}); byMat.get(k).geos.push(o); }
  const burst = new THREE.Group(); burst.position.y = .14; g.add(burst);
  for (const {mat, geos} of byMat.values()) burst.add(new THREE.Mesh(mergeGeometries(geos), crysMat(mat[0], mat[1], mat[2], mat[3] ? {glow:1.15, rainbow:1} : {glow:1.15})));
  burst.add(at(starSprite('#ffffff', .3, .5), .04, .95, .1));
  g.add(at(glowSprite(C('#c8a0ff'), 1.1, .16), 0, .5, 0));
  // shards of every colour drifting round it
  const drift = new THREE.Group(); drift.position.y = .55; ;
  ['#3ae0ff','#ffaa20','#ff5ac0','#8a4aff','#3aff9a','#ffe040','#5a8aff','#ff4a4a'].forEach((c, i) => { const a = i/8*Math.PI*2, cc = C(c);
    const s = mesh(withH(new THREE.OctahedronGeometry(.035, 0).toNonIndexed()), crysMat('#'+cc.clone().multiplyScalar(.15).getHexString(), c, '#ffffff', {glow:1.2}), Math.cos(a)*.52, Math.sin(a*2)*.18, Math.sin(a)*.52); s.scale.y = 1.7; drift.add(s); });
  anims.push({o:drift, kind:'spin', speed:.35});
  // golden arcs crackling out of the burst
  for (let i=0;i<4;i++){ const a = i/4*Math.PI*2 + .3, b = new THREE.Mesh(lightningGeo(new THREE.Vector3(Math.cos(a)*.1, .55, Math.sin(a)*.1), new THREE.Vector3(Math.cos(a)*.6, .8 + (i%2)*.25, Math.sin(a)*.6), 2250+i, .14, 8), ribbonMat('#ffd27a')); g.add(b); anims.push({o:b, kind:'flicker', phase:i*1.3}); }
  g.add(pool(C('#d0a8ff'), 1.4, .3));
  g.scale.setScalar(1.18);
  return {g, top:1.05, sparkle:true, anims}; }
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
// maze rock: hard, faceted grey stone with a little lichen, split into a few chunks
function rockGeo(r, seed, flat){
  let g = new THREE.IcosahedronGeometry(1, 1); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position, R = mkRng(seed);
  for (let i=0;i<p.count;i++){ const x=p.getX(i), y=p.getY(i), z=p.getZ(i), d = .78 + R()*.4 + (fbm(x*1.3+seed, y*1.3, z*1.3)-.5)*.5;
    let yy = y*d*r*flat; if (yy < -r*flat*.35) yy = -r*flat*.35; p.setXYZ(i, x*d*r, yy, z*d*r); }
  // cut a flat face or two, like split stone
  const nx = R()-.5, nz = R()-.5, k = Math.hypot(nx, nz) || 1;
  for (let i=0;i<p.count;i++){ const s = (p.getX(i)*nx + p.getZ(i)*nz)/k; if (s > r*.55) { p.setX(i, p.getX(i) - nx/k*(s - r*.55)); p.setZ(i, p.getZ(i) - nz/k*(s - r*.55)); } }
  g = g.toNonIndexed(); g.computeVertexNormals();
  const cols = new Float32Array(g.attributes.position.count*3), c = new THREE.Color(), pp = g.attributes.position, nn = g.attributes.normal;
  for (let i=0;i<pp.count;i+=3){ const v = .4 + R()*.12, up = nn.getY(i), lichen = up > .7 && R() < .25;
    c.setRGB(v*.98, v, v*1.04); if (lichen) c.lerp(new THREE.Color(.42,.46,.3), .5);
    for (let j=0;j<3;j++){ cols[(i+j)*3]=c.r; cols[(i+j)*3+1]=c.g; cols[(i+j)*3+2]=c.b; } }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.translate(0, r*flat*.35, 0); return g; }
function buildRock(seed){ const r = mkRng(seed*7+3), g = new THREE.Group(); g.rotation.y = r()*6;
  g.add(new THREE.Mesh(rockGeo(.32 + r()*.05, seed, .78 + r()*.2), M.stone));
  const n = 2 + (seed % 2);
  for (let k=0;k<n;k++){ const a = r()*6.28, d = .22 + r()*.12, p = new THREE.Mesh(rockGeo(.09 + r()*.06, seed*5+k, .8), M.stone); p.position.set(Math.cos(a)*d, 0, Math.sin(a)*d); p.rotation.y = r()*6; g.add(p); }
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
    else if (key==='obsidian' || FORMS[famOf(key)]) p = buildForm(key, d);
    else if (d.kind==='special') p = buildSpecial(key, d);
    else p = buildDesign(key, d);
  } catch(err){ console.error('3D model failed for', key, err); p = buildRock(3); }
  tame(key, p);
  p.g.traverse(o => { if (o.isMesh && !(o.material.blending === THREE.AdditiveBlending) && !o.material.transparent){ o.castShadow = true; o.receiveShadow = true; } });
  if (DEFS[key] && DEFS[key].kind==='special'){ const solid = []; p.g.traverse(o => { if (o.isMesh && o.geometry.attributes.normal && !o.material.transparent && o.material.blending !== THREE.AdditiveBlending && !(o.material.uniforms && o.material.uniforms.cDeep) && !(o.geometry.type || '').startsWith('Plane') && !(o.geometry.type || '').startsWith('Circle')) solid.push(o); });
    for (const o of solid){ const ol = new THREE.Mesh(o.geometry, OUTLINE); ol.renderOrder = -1; ol.castShadow = false; ol.userData.outline = true; o.add(ol); } }
  protos.set(key, p); return p; }
// effects are saved for the ultimates: no lightning on the Great Stone or Obsidian, and these specials lose their
// shine, halos and swirling auras; anything removed takes its animation with it
const NO_BOLTS = {bryvx:1, obsidian:1}, QUIET = {darkemerald1:1, darkemerald2:1, gold1:1, gold2:1, silver1:1, silver2:1, uranium1:1, uranium2:1, blackopal1:1, blackopal2:1, paraiba1:1, paraiba2:1};
function tame(key, p){
  const quiet = !!QUIET[key], drop = [];
  p.g.traverse(o => {
    if (NO_BOLTS[key] && o.isMesh && o.geometry.userData.bolt) drop.push(o);
    if (quiet && (o.isSprite || (o.isMesh && o.material.isRibbon && !o.geometry.userData.bolt))) drop.push(o);
    if (quiet && o.isMesh && o.material.map === glowTex) o.material = Object.assign(o.material.clone(), {opacity:o.material.opacity*.5});
  });
  for (const o of drop) if (o.parent) o.parent.remove(o);
  if (key==='silver2') p.anims = [];
  if (p.anims){ const live = new Set(); p.g.traverse(o => live.add(o)); p.anims = p.anims.filter(a => live.has(a.o)); }
  if (quiet || key==='silver2') p.sparkle = false; }
function instance(key){ const p = proto(key), g = p.g.clone(true);
  const inst = {g, top:p.top, embers:p.embers, sparkle:p.sparkle, anim:null, anims:[]};
  if (p.anims && p.anims.length){ const idx = new Map(); let i = 0; p.g.traverse(o => idx.set(o, i++)); const list = []; g.traverse(o => list.push(o));
    inst.anims = p.anims.map(a => { const o = list[idx.get(a.o)]; return {...a, o, y0:o.position.y}; }); }
  if (p.anim){ inst.anim = {}; const names = Object.keys(p.anim); const idx = new Map(); let i = 0; p.g.traverse(o => idx.set(o, i++)); i = 0; const list = []; g.traverse(o => list.push(o));
    for (const n of names){ const o = p.anim[n]; if (o.isObject3D) inst.anim[n] = list[idx.get(o)]; else inst.anim[n] = o; } }
  return inst; }

/* ================= static world ================= */
// selection rings: attack range is one green solid line, every aura one gold dashed line; both keep a thin, even width at any radius
const RANGE_COLOR = 0x5fd38d, AURA_COLOR = 0xf2c35b, RING_W = .045, ringCache = new Map();
function ringGeo(r, dashed){ const k = r.toFixed(2) + (dashed ? 'd' : 's'); if (ringCache.has(k)) return ringCache.get(k);
  let g; if (!dashed) g = new THREE.RingGeometry(r - RING_W, r, 160);
  else { const segs = [], n = Math.max(24, Math.round(r*2*Math.PI/.32)); for (let i=0;i<n;i++){ const s = new THREE.RingGeometry(r - RING_W, r, 3, 1, i/n*Math.PI*2, Math.PI*2/n*.55); s.deleteAttribute('uv'); segs.push(s); } g = mergeGeometries(segs); }
  ringCache.set(k, g); return g; }
let tilesMesh, pathMesh = null, pathKey = null, hoverPath = null, hoverPathKey = null, flyLine, hl, selFrame, rangeRing, auraRings = [], portal, arrows = [], castleFlag;
function buildWorld(){
  scene.add(skyMesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({ side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{top:{value:new THREE.Color('#2f6fd8')}, mid:{value:new THREE.Color('#7fb8f2')}, bot:{value:new THREE.Color('#e6f2ff')}},
    vertexShader:`varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform vec3 top, mid, bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > .08 ? mix(mid, top, smoothstep(.08,.6,h)) : mix(bot, mid, smoothstep(-.05,.08,h)); gl_FragColor = vec4(c,1.); }` })));
  scene.fog = new THREE.Fog(0xbcd6f0, 60, 170);
  sun = new THREE.DirectionalLight(0xfff0d4, 2.7); sun.position.set(-18, 30, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
  Object.assign(sun.shadow.camera, {left:-24, right:24, top:24, bottom:-24, near:1, far:90}); scene.add(sun);
  scene.add(hemi = new THREE.HemisphereLight(0xd6e8ff, 0x6a6048, .95));
  buildStars();

  if (AOE){ buildAoe(); return; }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({map:grassTex, roughness:.95}));
  ground.rotation.x = -Math.PI/2; ground.position.y = -.7; ground.receiveShadow = true; scene.add(ground);
  const plateau = new THREE.Mesh(new RoundedBoxGeometry(GW+1.2, .9, GH+1.2, 3, .25), new THREE.MeshStandardMaterial({color:0x9a9284, map:stoneTex, roughness:.9}));
  plateau.position.y = -.58; plateau.receiveShadow = true; scene.add(plateau);
  for (const [w,dd,x,z] of [[GW+.9,.18,0,-(GH/2+.4)],[GW+.9,.18,0,GH/2+.4],[.18,GH+.9,-(GW/2+.4),0],[.18,GH+.9,GW/2+.4,0]]){
    const k = new THREE.Mesh(new RoundedBoxGeometry(w + .3, .22, dd + .3, 2, .05), new THREE.MeshStandardMaterial({color:0xcfc6b4, map:stoneTex, roughness:.85})); k.position.set(x,-.05,z); k.castShadow = k.receiveShadow = true; scene.add(k); }
  for (const [w,dd,x,z] of [[GW+3,1.2,0,-(GH/2+1.3)],[GW+3,1.2,0,GH/2+1.3],[1.2,GH+3,-(GW/2+1.3),0],[1.2,GH+3,GW/2+1.3,0]]){
    const st = new THREE.Mesh(new THREE.BoxGeometry(w,.35,dd), new THREE.MeshStandardMaterial({color:0x9a9284, map:stoneTex, roughness:.9})); st.position.set(x,-.55,z); st.receiveShadow = true; scene.add(st); }
  tilesMesh = new THREE.InstancedMesh(new RoundedBoxGeometry(.97, .16, .97, 2, .04), new THREE.MeshStandardMaterial({map:stoneTex, roughness:.85}), GW*GH);
  { const m = new THREE.Matrix4(), col = new THREE.Color(), r = mkRng(11);
    for (let y=0;y<GH;y++) for (let x=0;x<GW;x++){ const i = IDX(x,y); m.makeTranslation(wx(x), -.08 - r()*.012, wz(y)); tilesMesh.setMatrixAt(i, m);
      const chk = (x+y)%2 ? 0 : .03, base = NOBUILD[i] ? [.36,.33,.3] : [.78+chk,.74+chk,.66+chk], v = (r()-.5)*.08; col.setRGB(base[0]+v, base[1]+v, base[2]+v*1.2); tilesMesh.setColorAt(i, col); } }
  tilesMesh.receiveShadow = true; scene.add(tilesMesh);
  buildRuins();

  outerGrass(-.7, 19);
  outerForest(-.7, (x,z) => ruinSpots.every(([cx,cz,rr]) => Math.hypot(x-cx, z-cz) > rr));
  buildCommon(); }
function buildCommon(){
  // portal
  portal = new THREE.Group(); portal.position.set(wx(PORTAL.x), 0, wz(PORTAL.y)); scene.add(portal);
  { const rune = canvasTex(256, 256, (g,w) => { g.clearRect(0,0,w,w); g.translate(w/2,w/2); g.strokeStyle = 'rgba(200,160,255,.95)'; g.lineWidth = 3;
      g.beginPath(); g.arc(0,0,118,0,Math.PI*2); g.stroke(); g.lineWidth = 1.5; g.beginPath(); g.arc(0,0,100,0,Math.PI*2); g.stroke();
      for (let i=0;i<12;i++){ g.save(); g.rotate(i/12*Math.PI*2); g.translate(0,-109); g.beginPath(); g.moveTo(-5,-5); g.lineTo(5,5); g.moveTo(5,-5); g.lineTo(0,5); g.stroke(); g.restore(); } });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 48), new THREE.MeshBasicMaterial({map:rune, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, color:0xb88cff}));
    disc.rotation.x = -Math.PI/2; disc.position.y = .012; disc.material.color.set(0x6ad8ff); portal.add(disc); portal.userData.rune = disc;
    for (let i=0;i<0;i++){ const a = i/8*Math.PI*2, st = new THREE.Mesh(boulder(.13, i+3, {flat:3.2 + (i%2)*1.2, lump:.3, moss:.5, sink:.1}), M.rock); st.position.set(Math.cos(a)*1.3, 0, Math.sin(a)*1.3); st.castShadow = true; portal.add(st); }
    const arch = new THREE.Group(); arch.rotation.y = Math.PI/4; portal.add(arch);
    const archStone = glowStone('#a49c8c', '#6ad8ff', .55);
    for (const s of [-1,1]){ arch.add(mesh(roughBlock(.3, 1.5, .34, 30 + s, .06), archStone, s*.95, 0, 0)); arch.add(mesh(roughBlock(.42, .14, .44, 40 + s, .04), archStone, s*.95, 0, 0)); }
    const arc = new THREE.Mesh(withH(new THREE.TorusGeometry(.95, .17, 6, 18, Math.PI).toNonIndexed()), archStone); arc.position.y = 1.5; arch.add(arc);
    arch.add(mesh(roughBlock(.3, .22, .38, 55, .05), glowStone('#a49c8c', '#9af0ff', 1.2), 0, 2.38, 0));
    const swirl = canvasTex(256, 256, (g,w) => { g.clearRect(0,0,w,w); g.translate(w/2,w/2); const gr = g.createRadialGradient(0,0,0,0,0,w/2);
      gr.addColorStop(0,'rgba(255,240,255,1)'); gr.addColorStop(.35,'rgba(170,110,255,.85)'); gr.addColorStop(1,'rgba(60,20,140,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0,0,w/2,0,Math.PI*2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; for (let k=0;k<4;k++){ g.beginPath(); for (let t=0;t<1;t+=.01){ const a = k*Math.PI/2 + t*5, rr = t*w*.48; g.lineTo(Math.cos(a)*rr, Math.sin(a)*rr); } g.stroke(); } });
    const vortex = new THREE.Mesh(new THREE.CircleGeometry(.8, 48), new THREE.MeshBasicMaterial({map:swirl, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide}));
    vortex.position.y = 1.15; vortex.rotation.y = Math.PI/4; vortex.scale.set(1.05, 1.35, 1); vortex.material.color.set(0x8ad8ff); portal.add(vortex); portal.userData.vortex = vortex;
    portal.add(at(glowSprite(new THREE.Color('#6ad8ff'), 2.6, .45), 0, 1.15, 0));
    const pl = new THREE.PointLight(0x6ad8ff, 5, 6, 1.6); pl.position.y = 1.1; portal.add(pl); }
  // checkpoints
  { const shape = new THREE.Shape(); shape.moveTo(.32,0); shape.lineTo(-.18,.28); shape.lineTo(-.08,0); shape.lineTo(-.18,-.28); shape.closePath();
    const aGeo = new THREE.ExtrudeGeometry(shape, {depth:.06, bevelEnabled:true, bevelThickness:.02, bevelSize:.02, bevelSegments:2});
    const aMat = new THREE.MeshStandardMaterial({envMap:envTex, color:0xf2c840, metalness:.6, roughness:.35, emissive:0xb88a10, emissiveIntensity:.35});
    const ROT = {R:0, U:Math.PI/2, L:Math.PI, D:-Math.PI/2};
    CPS.forEach((c, i) => { const g = new THREE.Group(); g.position.set(wx(c.x), 0, wz(c.y)); scene.add(g);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(.46,.5,.08,32), M.gold); pad.position.y = .04; pad.receiveShadow = true; g.add(pad);
      const num = canvasTex(128, 128, (x) => { x.fillStyle = '#2a2110'; x.beginPath(); x.arc(64,64,62,0,7); x.fill(); x.fillStyle = '#f7d77e'; x.font = '600 74px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(i+1), 64, 68); });
      const face = new THREE.Mesh(new THREE.CircleGeometry(.38, 32), new THREE.MeshStandardMaterial({map:num, roughness:.5, metalness:.3})); face.rotation.x = -Math.PI/2; face.rotation.z = ROT[c.dir] - Math.PI/2; face.position.y = .081; g.add(face);
      const arrow = new THREE.Mesh(aGeo, aMat); arrow.rotation.x = -Math.PI/2; arrow.castShadow = true;
      const holder = new THREE.Group(); holder.rotation.y = ROT[c.dir]; holder.add(arrow); arrow.position.set(0,.55,0); g.add(holder);
      g.add(at(glowSprite(0xf2c35b, .9, .12), 0, .55, 0)); arrows.push({arrow, phase:i}); }); }
  // castle
  { const castle = new THREE.Group(); castle.position.set(wx(CASTLE.x), 0, wz(CASTLE.y)); scene.add(castle);
    const wall = new THREE.MeshStandardMaterial({color:AOE ? 0xb0aa9c : 0xd8d0bf, map:stoneTex, roughness:.8}), roofM = new THREE.MeshStandardMaterial(AOE ? {color:0xa2442a, roughness:.75} : {color:0x2d4fa8, roughness:.55, metalness:.2});
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
  rangeRing.add(new THREE.Mesh(ringGeo(1, false), new THREE.MeshBasicMaterial({color:RANGE_COLOR, transparent:true, opacity:.8, depthWrite:false, side:THREE.DoubleSide})));
  rangeRing.add(new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({color:RANGE_COLOR, transparent:true, opacity:.06, depthWrite:false})));
  rangeRing.children.forEach(m => m.rotation.x = -Math.PI/2); rangeRing.position.y = .02;
}
// the world around the board: grass in the joints, broken columns and arches, cliffs and clouds
const ruinSpots = [];
function buildRuins(){
  const r = mkRng(77), stoneM = new THREE.MeshStandardMaterial({color:0xd8d0c0, map:stoneTex, roughness:.85}), mossy = new THREE.MeshStandardMaterial({color:0xb8b4a0, map:stoneTex, roughness:.9});
  // grass tufts between the flagstones
  { const blade = new THREE.ConeGeometry(.018, .1, 3); blade.translate(0, .05, 0);
    const n = 900, tufts = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({color:0x6fb04a, roughness:.8, flatShading:true}), n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let i=0;i<n;i++){ const gx = Math.floor(r()*GW), gy = Math.floor(r()*GH), side = r() < .5, x = wx(gx) + (side ? .49 : (r()-.5)*.9), z = wz(gy) + (side ? (r()-.5)*.9 : .49);
      q.setFromEuler(new THREE.Euler((r()-.5)*.6, r()*6, (r()-.5)*.6)); const sc = .5 + r()*.8; m.compose(new THREE.Vector3(x, -.01, z), q, new THREE.Vector3(sc, sc*(.7 + r()*.6), sc)); tufts.setMatrixAt(i, m);
      c.setHSL(.24 + r()*.06, .55, .45 + r()*.12); tufts.setColorAt(i, c); }
    scene.add(tufts); }
  // columns, some broken, and a few arches standing round the arena
  const col = (x, z, h, broken) => { const g = new THREE.Group(); g.position.set(x, -.38, z); scene.add(g);
    const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(.9, .25, .9), mossy, .12); add(new THREE.CylinderGeometry(.3, .34, h, 14), stoneM, .25 + h/2);
    if (!broken) add(new THREE.BoxGeometry(.8, .2, .8), stoneM, .25 + h + .1); else { const chunk = add(new THREE.CylinderGeometry(.3, .3, .6, 14), stoneM, .2); chunk.rotation.z = Math.PI/2; chunk.position.x = .9; } return g; };
  for (let i=0;i<26;i++){ const a = i/26*Math.PI*2 + r()*.1, d = 20.5 + r()*3.5, x = Math.cos(a)*d, z = Math.sin(a)*d; const broken = r() < .45, h = 1.5 + r()*2.5; if (Math.max(Math.abs(x), Math.abs(z)) < GW/2 + 3.4) continue;   // none touching the board
    col(x, z, h, broken); ruinSpots.push([x, z, 1.3]); }
  // cliffs and mesas on the horizon
  { const cliffM = new THREE.MeshStandardMaterial({vertexColors:true, roughness:.9, flatShading:true});
    for (let i=0;i<22;i++){ const a = i/22*Math.PI*2 + r()*.2, d = 55 + r()*35, h = 8 + r()*16, w = 6 + r()*8; const geo = rockGeo(1, 900 + i, 1); geo.scale(w, h, w*.8);
      const cols = geo.attributes.color; for (let k=0;k<cols.count;k++){ const y = geo.attributes.position.getY(k)/h; cols.setXYZ(k, .78 - y*.1 + r()*.04, .66 - y*.08, .52 - y*.02); }
      const m = new THREE.Mesh(geo, cliffM); m.position.set(Math.cos(a)*d, -.7, Math.sin(a)*d); m.rotation.y = r()*6; scene.add(m); } }
  // painted clouds
  { const cloud = canvasTex(256, 128, (g, w, h) => { g.clearRect(0,0,w,h); for (let i=0;i<14;i++){ const x = w*(.15 + r()*.7), y = h*(.45 + r()*.25), rr = 18 + r()*30, gr = g.createRadialGradient(x, y - rr*.3, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.7, 'rgba(245,248,255,.9)'); gr.addColorStop(1, 'rgba(220,230,250,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill(); } });
    for (let i=0;i<18;i++){ const a = r()*Math.PI*2, d = 90 + r()*60, s = new THREE.Sprite(new THREE.SpriteMaterial({map:cloud, transparent:true, depthWrite:false, fog:false, opacity:.95}));
      s.position.set(Math.cos(a)*d, 18 + r()*30, Math.sin(a)*d); s.scale.set(40 + r()*30, 18 + r()*12, 1); scene.add(s); } }
}

/* ================= Age-of-Empires style world: painted grass, a palisade, forests, mines and a dirt road ================= */
let roadTex = null;
function roadMesh(pts){
  if (!roadTex) roadTex = canvasTex(128, 128, (g,w) => { const r = mkRng(31); g.clearRect(0,0,w,w); const gr = g.createRadialGradient(w/2,w/2,w*.25,w/2,w/2,w*.5);
    gr.addColorStop(0,'rgba(132,108,72,1)'); gr.addColorStop(.55,'rgba(128,104,70,.92)'); gr.addColorStop(1,'rgba(120,100,66,0)'); g.fillStyle = gr; g.fillRect(0,0,w,w);
    g.globalCompositeOperation = 'source-atop';
    for (let i=0;i<260;i++){ const v = 110+r()*90|0; g.fillStyle = `rgba(${v},${v*.82|0},${v*.6|0},.55)`; g.beginPath(); g.arc(r()*w, r()*w, .6+r()*1.8, 0, 7); g.fill(); }
    for (let i=0;i<14;i++){ g.strokeStyle = 'rgba(110,82,48,.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(r()*w, 0); g.lineTo(r()*w, w); g.stroke(); } });
  const cells = new Set();
  for (let i=0;i<pts.length-1;i++){ const a = pts[i], b = pts[i+1], n = Math.max(1, Math.ceil(Math.hypot(b.x-a.x, b.y-a.y)*8));
    for (let k=0;k<=n;k++){ const x = a.x + (b.x-a.x)*k/n, y = a.y + (b.y-a.y)*k/n; cells.add(Math.floor(Math.min(GW-1, Math.max(0, x))) + ',' + Math.floor(Math.min(GH-1, Math.max(0, y)))); } }
  const geo = new THREE.PlaneGeometry(1.5, 1.5); geo.rotateX(-Math.PI/2);
  const mat = new THREE.MeshStandardMaterial({map:roadTex, transparent:true, depthWrite:false, roughness:1, polygonOffset:true, polygonOffsetFactor:-2});
  const m = new THREE.InstancedMesh(geo, mat, cells.size), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), r = mkRng(cells.size), v = new THREE.Vector3(), sc = new THREE.Vector3(); let i = 0;
  for (const c of cells){ const [x,y] = c.split(',').map(Number); q.setFromAxisAngle(v.set(0,1,0), Math.floor(r()*4)*Math.PI/2); const k = .95 + r()*.1;
    mx.compose(v.set(wx(x), .012, wz(y)), q, sc.set(k,1,k)); m.setMatrixAt(i++, mx); }
  m.receiveShadow = true; m.renderOrder = 1; return m; }

// grass tufts and a forest of oaks and pines round the arena (used by every map style)
function outerGrass(y0, clear){ const r = mkRng(8), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), col = new THREE.Color();
  // grass tufts and flowers off the board
  { const blade = new THREE.ConeGeometry(.03, .18, 3); blade.translate(0, .09, 0);
    const n = 2600, tufts = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({roughness:.9, flatShading:true}), n);
    for (let i=0;i<n;i++){ let x, z; do { x = (r()-.5)*80; z = (r()-.5)*80; } while (Math.abs(x) < clear && Math.abs(z) < clear);
      q.setFromEuler(new THREE.Euler((r()-.5)*.5, r()*6, (r()-.5)*.5)); const sc = .6 + r()*.9; m4.compose(p3.set(x, y0 - .005, z), q, s3.set(sc, sc*(.7+r()*.7), sc)); tufts.setMatrixAt(i, m4);
      col.setHSL(.2 + r()*.07, .5, .32 + r()*.14); tufts.setColorAt(i, col); }
    tufts.receiveShadow = true; scene.add(tufts); }
}
function outerForest(y0, ok = () => true){ const r = mkRng(5), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0,1,0);
  // forests: oaks and pines, thick past the fence like an AoE map edge
  { const oaks = [], pines = [], keep = (x,z) => !(Math.abs(x) < 19 && Math.abs(z) < 19) && ok(x,z);
    for (let i=0; i<12000 && oaks.length + pines.length < 1500; i++){ const x = (r()-.5)*130, z = (r()-.5)*130; if (!keep(x,z)) continue;
      const d = Math.max(Math.abs(x), Math.abs(z)); const dens = d < 21 ? .25 : d < 24 ? .7 : .95; if (r() > dens) continue;
      const cl = Math.sin(x*.21)*Math.cos(z*.17) + Math.sin((x+z)*.09); (cl > .3 ? pines : oaks).push([x, z, .85 + r()*.5]); }
    const near = ([x,z]) => Math.max(Math.abs(x), Math.abs(z)) < 27;   // only trees the sun's shadow box reaches cast shadows
    const build = (oaks, pines, close) => {
    const trunkGeo = new THREE.CylinderGeometry(.1,.16,1,6); trunkGeo.translate(0,.5,0);
    const trunkM = new THREE.MeshStandardMaterial({color:0x5c3f22, roughness:.9});
    const tr = new THREE.InstancedMesh(trunkGeo, trunkM, oaks.length + pines.length);
    const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, close ? 1 : 0), new THREE.MeshStandardMaterial({roughness:.85, flatShading:true}), oaks.length*4);
    const cone = new THREE.ConeGeometry(1, 1.4, 7); cone.translate(0,.7,0);
    const needles = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({roughness:.85, flatShading:true}), pines.length*3);
    oaks.forEach(([x,z,sc], i) => { m4.compose(p3.set(x,y0-.005,z), q.identity(), s3.set(sc, 1.1*sc, sc)); tr.setMatrixAt(i, m4);
      for (let k=0;k<4;k++){ const ls = (k ? .55 : .8)*sc*(.85+r()*.3), a = k*1.9 + r(); q.setFromEuler(new THREE.Euler(r(), r()*3, r()));
        m4.compose(p3.set(x + (k ? Math.cos(a)*.45*sc : 0), y0 + 1.35*sc + (k ? .15 + r()*.3 : .3)*sc, z + (k ? Math.sin(a)*.45*sc : 0)), q, s3.set(ls, ls*.85, ls)); leaves.setMatrixAt(i*4+k, m4);
        col.setHSL(.24 + r()*.07, .42 + r()*.15, .22 + r()*.08 + (k ? .03 : 0)); leaves.setColorAt(i*4+k, col); } });
    pines.forEach(([x,z,sc], j) => { const i = oaks.length + j; m4.compose(p3.set(x,y0-.005,z), q.identity(), s3.set(sc*.8, .9*sc, sc*.8)); tr.setMatrixAt(i, m4);
      for (let k=0;k<3;k++){ const w = (.75 - k*.2)*sc; q.setFromAxisAngle(up, r()*6); m4.compose(p3.set(x, y0 + (.6 + k*.62)*sc, z), q, s3.set(w, .8*sc, w)); needles.setMatrixAt(j*3+k, m4);
        col.setHSL(.33 + r()*.05, .4 + r()*.12, .17 + r()*.06 + k*.02); needles.setColorAt(j*3+k, col); } });
    tr.castShadow = leaves.castShadow = needles.castShadow = close; leaves.receiveShadow = needles.receiveShadow = true; scene.add(tr, leaves, needles); };
    build(oaks.filter(near), pines.filter(near), true); build(oaks.filter(t => !near(t)), pines.filter(t => !near(t)), false); }
}
function buildAoe(){
  const r = mkRng(5), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0,1,0);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({map:grassTex, roughness:1}));
  ground.rotation.x = -Math.PI/2; ground.position.y = -.025; ground.receiveShadow = true; scene.add(ground);
  // painted terrain tiles: grass to build on, packed earth where you cannot
  tilesMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.975, .1, .975), new THREE.MeshStandardMaterial({map:paintTex, roughness:1}), GW*GH);
  for (let y=0;y<GH;y++) for (let x=0;x<GW;x++){ const i = IDX(x,y); m4.makeTranslation(wx(x), -.05, wz(y)); tilesMesh.setMatrixAt(i, m4);
    const chk = (x+y)%2 ? 0 : .018, v = (r()-.5)*.05;
    if (NOBUILD[i]) col.setRGB(.52+v, .43+v, .3+v*.6); else col.setRGB(.34+chk+v*.6, .5+chk+v, .2+v*.4); tilesMesh.setColorAt(i, col); }
  tilesMesh.receiveShadow = true; scene.add(tilesMesh);
  outerGrass(-.025, 17.6);
  // a palisade of sharpened logs round the board, with gates by the portal and the castle
  { const H = GW/2 + .75, logs = [];
    const gate = (x, z) => (Math.hypot(x - wx(PORTAL.x), z - wz(PORTAL.y)) < 0 || false);
    for (const side of [0,1,2,3]) for (let t = -H; t <= H; t += .2){ const x = side===0 ? t : side===1 ? t : side===2 ? -H : H, z = side===0 ? -H : side===1 ? H : t;
      if ((side===2 || side===0) && Math.abs(t - wz(PORTAL.y)) < 1.2 && side===2) continue;   // west gate beside the portal
      if (side===3 && Math.abs(t - wz(CASTLE.y)) < 1.2) continue;                                // east gate beside the castle
      logs.push([x + (r()-.5)*.03, z + (r()-.5)*.03, .85 + r()*.3]); }
    const logGeo = new THREE.CylinderGeometry(.09, .1, 1, 6); logGeo.translate(0,.5,0); const tipGeo = new THREE.ConeGeometry(.09, .22, 6); tipGeo.translate(0,.11,0);
    const wood = new THREE.MeshStandardMaterial({color:0xffffff, roughness:.9, flatShading:true}), tipM = new THREE.MeshStandardMaterial({color:0xa89070, roughness:.9, flatShading:true});
    const L = new THREE.InstancedMesh(logGeo, wood, logs.length), T = new THREE.InstancedMesh(tipGeo, tipM, logs.length);
    logs.forEach(([x,z,h], i) => { q.setFromAxisAngle(up, r()*6); m4.compose(p3.set(x, -.03, z), q, s3.set(1, h, 1)); L.setMatrixAt(i, m4); m4.compose(p3.set(x, -.03 + h, z), q, s3.set(1,1,1)); T.setMatrixAt(i, m4);
      col.setHSL(.08, .22 + r()*.08, .3 + r()*.08); L.setColorAt(i, col); });
    L.castShadow = T.castShadow = L.receiveShadow = true; scene.add(L, T);
    // a ring of beaten earth just inside the fence
    const band = new THREE.Mesh(new THREE.RingGeometry(0, 1, 4, 1), new THREE.MeshStandardMaterial({map:dirtTex, roughness:1}));
    band.visible = false; }
  outerForest(-.025, (x,z) => Math.hypot(x+27, z-9) > 6.5);
  // a pond with a sandy shore and reeds
  { const cx = -27, cz = 9; const shore = new THREE.Mesh(new THREE.CircleGeometry(5.4, 40), new THREE.MeshStandardMaterial({color:0xd8c48e, roughness:1}));
    shore.rotation.x = -Math.PI/2; shore.position.set(cx, -.018, cz); shore.scale.set(1, .78, 1); shore.receiveShadow = true; scene.add(shore);
    const water = new THREE.Mesh(new THREE.CircleGeometry(4.6, 40), new THREE.MeshStandardMaterial({color:0x3f86b8, roughness:.12, metalness:.2, envMap:envTex, envMapIntensity:.8, transparent:true, opacity:.92}));
    water.rotation.x = -Math.PI/2; water.position.set(cx, -.01, cz); water.scale.set(1, .74, 1); scene.add(water);
    const reed = new THREE.CylinderGeometry(.015, .02, .5, 4); reed.translate(0,.25,0); const reeds = new THREE.InstancedMesh(reed, new THREE.MeshStandardMaterial({color:0x6f8a3a}), 120);
    for (let i=0;i<120;i++){ const a = r()*Math.PI*2, d = 4.4 + r()*.5; q.setFromEuler(new THREE.Euler((r()-.5)*.3, 0, (r()-.5)*.3)); m4.compose(p3.set(cx + Math.cos(a)*d, -.02, cz + Math.sin(a)*d*.76), q, s3.set(1, .6 + r()*.8, 1)); reeds.setMatrixAt(i, m4); }
    scene.add(reeds); }
  // gold and stone mines, berry bushes
  { const mine = (cx, cz, mat, n, seed) => { const rr = mkRng(seed); for (let i=0;i<n;i++){ const a = rr()*Math.PI*2, d = rr()*1.1, sz = .28 + rr()*.25;
      const g = new THREE.Mesh(rockGeo(sz, seed*10 + i, .7), mat); g.position.set(cx + Math.cos(a)*d, sz*.3 - .03, cz + Math.sin(a)*d); g.rotation.y = rr()*6; g.castShadow = g.receiveShadow = true; scene.add(g); } };
    const goldM = new THREE.MeshStandardMaterial({color:0xe8b83a, metalness:.55, roughness:.35, envMap:envTex, emissive:0x4a3000, emissiveIntensity:.25, flatShading:true});
    const stoneM2 = new THREE.MeshStandardMaterial({color:0x9a9890, roughness:.8, flatShading:true});
    mine(-20, -12, goldM, 9, 3); mine(21, 7, goldM, 8, 4); mine(-12, 21, stoneM2, 9, 5); mine(13, -20.5, stoneM2, 8, 6);
    const bush = new THREE.IcosahedronGeometry(.32, 1), berryG = new THREE.SphereGeometry(.05, 6, 4);
    const bushM = new THREE.MeshStandardMaterial({color:0x3f6e2a, roughness:.9, flatShading:true}), berM = new THREE.MeshStandardMaterial({color:0xc42a3a, roughness:.5});
    for (const [bx,bz] of [[20.5,-6],[21.3,-5.2],[20.2,-4.4],[21.6,-6.6],[20.9,-3.6]]){ const b = new THREE.Mesh(bush, bushM); b.position.set(bx, .2, bz); b.scale.set(1,.8,1); b.castShadow = true; scene.add(b);
      for (let k=0;k<7;k++){ const be = new THREE.Mesh(berryG, berM); const a = r()*6, e = r()*1.2; be.position.set(bx + Math.cos(a)*Math.cos(e)*.3, .2 + Math.sin(e)*.24, bz + Math.sin(a)*Math.cos(e)*.3); scene.add(be); } } }
  // sheep by the pond and deer at the forest edge
  { const wool = new THREE.MeshStandardMaterial({color:0xf2eee4, roughness:.95, flatShading:true}), dark = new THREE.MeshStandardMaterial({color:0x2a2420, roughness:.8}), deerM = new THREE.MeshStandardMaterial({color:0x9a6a3c, roughness:.8, flatShading:true});
    const animal = (x, z, rot, body, head, len, h) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(.2, 1), body); b.scale.set(len, .8, 1.25); b.position.y = h; b.castShadow = true; g.add(b);
      const hd = new THREE.Mesh(new THREE.IcosahedronGeometry(.09, 1), head); hd.position.set(0, h + .08, .3); g.add(hd);
      for (const [lx,lz] of [[-.08,.12],[.08,.12],[-.08,-.12],[.08,-.12]]){ const l = new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,h,4), head); l.position.set(lx, h/2, lz); g.add(l); } return g; };
    for (const [x,z] of [[-21,13],[-21.6,14.2],[-20.4,14.6],[-22.4,12.6]]) animal(x, z, r()*6, wool, dark, 1, .22);
    for (const [x,z] of [[17,22],[18.2,21.4],[-23,-20]]) { const d = animal(x, z, r()*6, deerM, deerM, .9, .36); }
  }
  // rolling green hills on the horizon
  { const hillM = new THREE.MeshStandardMaterial({vertexColors:true, roughness:1, flatShading:false});
    for (let i=0;i<20;i++){ const a = i/20*Math.PI*2 + r()*.2, d = 80 + r()*40, h = 6 + r()*10, w = 18 + r()*14, geo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI*2, 0, Math.PI/2); geo.scale(w, h, w*.7);
      const cc = new Float32Array(geo.attributes.position.count*3); for (let k=0;k<geo.attributes.position.count;k++){ const y = geo.attributes.position.getY(k)/h; cc.set([.32 + y*.05, .48 + y*.06, .22], k*3); }
      geo.setAttribute('color', new THREE.BufferAttribute(cc, 3)); const m = new THREE.Mesh(geo, hillM); m.position.set(Math.cos(a)*d, -.6, Math.sin(a)*d); m.rotation.y = r()*6; scene.add(m); } }
  // clouds
  { const cloud = canvasTex(256, 128, (g, w, h) => { g.clearRect(0,0,w,h); for (let i=0;i<14;i++){ const x = w*(.15 + r()*.7), y = h*(.45 + r()*.25), rr = 18 + r()*30, gr = g.createRadialGradient(x, y - rr*.3, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.7, 'rgba(245,248,255,.9)'); gr.addColorStop(1, 'rgba(220,230,250,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill(); } });
    for (let i=0;i<14;i++){ const a = r()*Math.PI*2, d = 100 + r()*60, sp = new THREE.Sprite(new THREE.SpriteMaterial({map:cloud, transparent:true, depthWrite:false, fog:false, opacity:.85}));
      sp.position.set(Math.cos(a)*d, 22 + r()*30, Math.sin(a)*d); sp.scale.set(40 + r()*30, 18 + r()*12, 1); scene.add(sp); } }
  buildCommon(); }
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
function clearDynamic(){ if (rocks.meshes){ rocks.meshes.forEach(m => m.count = 0); rocks.sig = null; }
  for (const o of towerObjs.values()){ scene.remove(o.g); for (const k of ['frame','glint','burnRing','plate']) if (o[k]) scene.remove(o[k]); } towerObjs.clear();
  for (const o of creepObjs.values()) scene.remove(o.g, o.bar); creepObjs.clear();
  for (const o of projObjs.values()) scene.remove(o.m); projObjs.clear();
  parts.length = 0; for (const f of floaters) f.el.remove(); floaters.length = 0; }
function keyFor(t){ return t.key==='rock' ? 'rock' + (1 + t.id % 5) : t.key; }
// every maze rock is drawn through five instanced meshes (one per rock shape), so a board full of rocks costs a handful of draw calls
const rocks = {sig:null, meshes:null};
function rockMeshes(){ if (rocks.meshes) return rocks.meshes;
  rocks.meshes = [1,2,3,4,5].map(v => { const p = buildRock(v); p.g.updateMatrixWorld(true); const geos = [];
    p.g.traverse(m => { if (m.isMesh){ const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); geos.push(g); } });
    const im = new THREE.InstancedMesh(mergeGeometries(geos), M.stone, GW*GH); im.count = 0; im.castShadow = im.receiveShadow = true; im.frustumCulled = false; scene.add(im); return im; });
  return rocks.meshes; }
function syncRocks(list){ const sig = list.map(t => t.id + ':' + t.x + ',' + t.y).join('|'); if (sig === rocks.sig) return; rocks.sig = sig;
  const ms = rockMeshes(), m4 = new THREE.Matrix4(); ms.forEach(m => m.count = 0);
  for (const t of list){ const im = ms[t.id % 5]; m4.makeScale(.85, .85, .85).setPosition(wx(t.x), 0, wz(t.y)); im.setMatrixAt(im.count++, m4); }
  ms.forEach(m => m.instanceMatrix.needsUpdate = true); }
function syncTowers(T, dt){
  const S = G.state(), seen = new Set();
  const rockList = [];
  for (const t of S.towers){
    if (t.key === 'rock'){ rockList.push(t); continue; }
    seen.add(t.id); let o = towerObjs.get(t.id); const k = keyFor(t);
    if (!o || o.key !== k){ if (o){ scene.remove(o.g); for (const x of ['frame','glint','burnRing','plate']) if (o[x]) scene.remove(o[x]); } o = instance(k); o.key = k; o.g.position.set(wx(t.x), 0, wz(t.y)); o.g.userData.tid = t.id; o.g.traverse(m => m.userData.tid = t.id); scene.add(o.g); towerObjs.set(t.id, o); o.born = T; }
    const age = T - o.born, s = age < .25 ? .5 + age*2 : 1; o.g.scale.setScalar(s * (o.key==='bryvx' ? 1 : DEFS[t.key] && DEFS[t.key].kind==='gem' ? 1.15 : 1));
    o.t = t;
    if (!o.plate){ o.plate = new THREE.Mesh(new THREE.PlaneGeometry(.94,.94), new THREE.MeshBasicMaterial({color:new THREE.Color(DEFS[t.key].color || '#ffffff'), transparent:true, opacity:.32, depthWrite:false}));
      o.plate.rotation.x = -Math.PI/2; o.plate.position.set(wx(t.x), .004, wz(t.y)); scene.add(o.plate); }
    // this round's gems: a thin grey frame; towers that can combine: a glint running round it
    if (t.draft || t.oneShot || t.flag){ if (!o.frame){ o.frame = new THREE.Mesh(new THREE.PlaneGeometry(.96,.96), new THREE.MeshBasicMaterial({map:frameTex, color:0xffd25a, transparent:true, opacity:.95, depthWrite:false})); o.frame.rotation.x = -Math.PI/2; o.frame.position.set(wx(t.x), .007, wz(t.y)); scene.add(o.frame);
      { const fill = new THREE.Mesh(new THREE.PlaneGeometry(.96,.96), new THREE.MeshBasicMaterial({color:0xffe9a0, transparent:true, opacity:.22, depthWrite:false})); fill.position.z = -.001; o.frame.add(fill); } } o.frame.visible = !!t.draft; }
    else if (o.frame) o.frame.visible = false;
    const glint = t.oneShot || t.flag;
    if (glint && !o.glint){ o.glint = glowSprite(0xfff2c0, .1, .9); scene.add(o.glint); }
    if (o.glint){ o.glint.visible = !!glint; if (glint){ const u = ((T*.45 + t.id*.17) % 1 + 1) % 1, d = u*4, k2 = Math.floor(d), f = d - k2, h = .47;
      const [gx, gz] = k2===0 ? [-h + 2*h*f, -h] : k2===1 ? [h, -h + 2*h*f] : k2===2 ? [h - 2*h*f, h] : [-h, h - 2*h*f]; o.glint.position.set(wx(t.x)+gx, .03, wz(t.y)+gz); } }
    // burn towers scorch the ground they reach while a wave is on
    const bd = DEFS[t.key] && DEFS[t.key].burn;
    if (bd && !o.burnRing){ const col = new THREE.Color(DEFS[t.key].color || '#ff6a20').lerp(new THREE.Color('#ff7a1a'), .5);
      o.burnRing = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({map:glowTex, color:col, transparent:true, opacity:.22, blending:THREE.AdditiveBlending, depthWrite:false}));
      o.burnRing.rotation.x = -Math.PI/2; o.burnRing.position.set(wx(t.x), .03, wz(t.y)); scene.add(o.burnRing); }
    if (o.burnRing){ const on = !!bd && G.state().phase === 'wave'; o.burnRing.visible = on; if (on){ o.burnRing.scale.setScalar(G.U(bd.r)*1.15); o.burnRing.material.opacity = .2 + Math.sin(T*4 + t.id)*.05; } }
    // idle animation
    for (const a of o.anims){ if (a.kind==='spin') a.o.rotation[a.axis||'y'] += a.speed*dt; else if (a.kind==='bob') a.o.position.y = a.y0 + Math.sin(T*(a.speed||1.5) + t.id)*(a.amp||.04);
      else if (a.kind==='flicker'){ const k = Math.floor(T*9 + a.phase*3.7); a.o.visible = Math.sin(k*12.9898 + a.phase*78.233 + t.id)*43758.5 % 1 > -.35; } }
    if (o.anim){ 
      if (o.anim.slice) o.anim.slice.rotation.y += .006; }
    if (o.embers && Math.random() < .2) emit(tmp.set(wx(t.x)+(Math.random()-.5)*.25, .7, wz(t.y)+(Math.random()-.5)*.25), new THREE.Color(1,.45+Math.random()*.3,.1), 1, .3, 1.1, .1, 3);
    if (o.sparkle && Math.random() < .08) emit(tmp.set(wx(t.x)+(Math.random()-.5)*.6, .4, wz(t.y)+(Math.random()-.5)*.6), new THREE.Color().setHSL(Math.random(), .8, .7), 1, .12, 1.6, .1, 6);
  }
  syncRocks(rockList);
  for (const [id, o] of towerObjs) if (!seen.has(id)){ scene.remove(o.g); if (o.frame) scene.remove(o.frame); if (o.glint) scene.remove(o.glint); if (o.burnRing) scene.remove(o.burnRing); if (o.plate) scene.remove(o.plate); towerObjs.delete(id); } }
function syncCreeps(T, dt){
  const S = G.state(), seen = new Set();
  for (const e of S.enemies){ if (e.dead) continue; seen.add(e.id); let o = creepObjs.get(e.id); if (!o){ o = makeCreep(e); creepObjs.set(e.id, o); }
    const x = px(e.x), z = pz(e.y); o.phase += dt*10*(S.paused ? 0 : 1);
    const y = e.fly ? 1.6 + Math.sin(o.phase*.4)*.1 : Math.abs(Math.sin(o.phase*.7))*.04;
    o.g.position.set(x, y, z); o.g.rotation.y = Math.atan2(Math.cos(e.ang), Math.sin(e.ang));
    if (e.fly) o.legs.forEach((w,i) => w.rotation.x = Math.sin(o.phase*1.4)*.6*(i?1:-1)); else o.legs.forEach((l,i) => l.rotation.x = Math.sin(o.phase + (i%2)*Math.PI)*.6);
    o.mat.emissiveIntensity = e.hitT > 0 ? .6 : 0;
    o.mat.emissive.set(e.frost && e.frost.t > 0 ? 0x8fd3ff : e.poison && e.poison.t > 0 ? 0x4fe08a : 0xffffff); if ((e.frost && e.frost.t > 0) || (e.poison && e.poison.t > 0)) o.mat.emissiveIntensity = Math.max(o.mat.emissiveIntensity, .35);
    if (e.burnT > 0){ o.mat.emissive.set(0xff5a10); o.mat.emissiveIntensity = .55 + Math.sin(T*18 + e.id)*.15; }
    o.bar.position.set(x - .31*o.size, y + (e.fly ? .45 : .75)*o.size, z); o.bar.quaternion.copy(camera.quaternion);
    const f = Math.max(0, e.hp / e.max); o.fg.scale.x = .58*o.size*f; o.fg.material.color.set(f > .5 ? 0x5fd38d : f > .25 ? 0xf2c35b : 0xff5d73); }
  for (const [id, o] of creepObjs) if (!seen.has(id)){ scene.remove(o.g, o.bar); o.mat.dispose(); creepObjs.delete(id); } }
function syncProjs(){
  const S = G.state(), seen = new Set();
  shotGeo = shotGeo || new THREE.SphereGeometry(.06, 10, 8);
  for (const p of S.projs){ seen.add(p); let o = projObjs.get(p);
    if (!o){ const c = new THREE.Color(p.color || '#ffffff'); const m = new THREE.Mesh(shotGeo, new THREE.MeshBasicMaterial({color:c.clone().multiplyScalar(2)})); m.add(glowSprite(c, .5, .9)); scene.add(m);
      const tw = p.t && towerObjs.get(p.t.id); o = {m, c, y0: tw ? tw.top : .8, sx:p.px ?? p.x, sy:p.py ?? p.y}; projObjs.set(p, o); }
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
  if (hit){ const t = G.state().towers.find(t => t.id === hit.object.userData.tid); if (t) return {x:t.x, y:t.y, t}; }
  const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, p)) return null;
  const x = Math.floor(p.x + GW/2), y = Math.floor(p.z + GH/2), S = G.state();
  const t = S && x >= 0 && y >= 0 && x < GW && y < GH ? S.occ[IDX(x,y)] : null;
  return t ? {x, y, t} : {x, y}; }
let down = null;
let tip = null, tipFor = null;
function onMove(ev){ const c = tileAt(ev); if (c) G.input.hover(c.x, c.y); else G.input.leave();
  const t = c && c.t; if (!tip){ tip = document.createElement('div'); tip.className = 'tip3d'; tip.hidden = true; document.body.appendChild(tip); }
  if (t !== tipFor){ tipFor = t; tip.hidden = !t; if (t) tip.textContent = G.describe(t).name; }
  tip.style.left = ev.clientX + 'px'; tip.style.top = ev.clientY + 'px'; }
function hideTip(){ tipFor = null; if (tip) tip.hidden = true; }
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
  const dt = Math.min(clock.getDelta(), .05); T += dt; crysU.time.value = T; size();
  controls.update();
  const lim = 20, cx = THREE.MathUtils.clamp(controls.target.x, -lim, lim), cz = THREE.MathUtils.clamp(controls.target.z, -lim, lim);
  if (cx !== controls.target.x || cz !== controls.target.z){ camera.position.x += cx - controls.target.x; camera.position.z += cz - controls.target.z; controls.target.x = cx; controls.target.z = cz; }
  const S = G.state();
  if (S !== lastS){ clearDynamic(); lastS = S; }
  
  portal.userData.vortex.rotation.z -= dt*1.8; portal.userData.rune.rotation.z += dt*.25;
  if (Math.random() < dt*30) emit(tmp.set(portal.position.x + (Math.random()-.5)*2, .1, portal.position.z + (Math.random()-.5)*2), new THREE.Color('#7ae0ff'), 1, .15, 1.6, .12, 6);
  { const p = castleFlag.geometry.attributes.position; for (let i=0;i<p.count;i++){ const x = p.getX(i) + .225; p.setZ(i, Math.sin(T*5 + x*9)*.05*x*2); } p.needsUpdate = true; }

  // route line (rebuilt only when the route changes)
  const route = S ? S.route : G.emptyRoute(), showPath = S ? G.ui.showPath : true;
  if (route !== pathKey){ disposeMesh(pathMesh); pathMesh = route ? (AOE ? roadMesh(route.pts) : lineTube(route.pts, .06, .035, 0x8ae6ff, .8, true)) : null; if (pathMesh) scene.add(pathMesh); pathKey = route; }
  if (pathMesh){ pathMesh.visible = !!showPath; if (!AOE) pathMesh.material.map.offset.x -= dt*.6; }
  const nextW = S ? (S.phase === 'wave' ? S.waveCur : G.waveInfo(S.wave)) : null;
  if (!flyLine){ flyLine = lineTube(G.flyPts(), 1.6, .025, 0xff7cc0, .55, true); scene.add(flyLine); }
  flyLine.visible = !!(nextW && nextW.fly); flyLine.material.map.offset.x -= dt*.6;

  // hover preview while building
  const hv = G.hover();
  if (S && hv && S.phase === 'build'){ hl.visible = true; hl.position.set(wx(hv.x), .006, wz(hv.y)); const c = hv.ok ? 0x5fd38d : 0xff5d73; hl.material.color.set(c); hl.userData.edge.material.color.set(c); }
  else hl.visible = false;
  const hr = S && G.ui.showPath && hv && hv.ok && S.phase === 'build' ? hv.route : null;
  if (hr !== hoverPathKey){ disposeMesh(hoverPath); hoverPath = hr ? lineTube(hr.pts, .08, .03, 0x5fd38d, .7, false) : null; if (hoverPath) scene.add(hoverPath); hoverPathKey = hr; }

  if (S){
    syncTowers(T, dt); syncCreeps(T, dt); syncProjs(); syncFx();
    // selection, range and auras
    const sel = S.sel && S.towers.includes(S.sel) ? S.sel : null;
    selFrame.visible = !!sel; rangeRing.visible = false; auraRings.forEach(r => r.visible = false);
    if (sel){ selFrame.position.set(wx(sel.x), .008, wz(sel.y)); const d = DEFS[sel.key];
      if (sel.key !== 'rock' && d.dmg){ const rr = G.U(d.range)*(1 + (sel.bRange||0)); rangeRing.visible = true; rangeRing.position.set(wx(sel.x), .02, wz(sel.y));
        rangeRing.children[0].geometry = ringGeo(rr, false); rangeRing.children[1].scale.setScalar(rr); }
      const auras = sel.key === 'rock' ? [] : [d.burn, d.radslow, d.spdAura, d.spdAura2, d.dmgAura, d.armorAura, d.rangeAura].filter(Boolean);
      auras.forEach((a, i) => { let r = auraRings[i]; if (!r){ r = new THREE.Mesh(ringGeo(1, true), new THREE.MeshBasicMaterial({color:AURA_COLOR, transparent:true, opacity:.9, depthWrite:false, side:THREE.DoubleSide})); r.rotation.x = -Math.PI/2; scene.add(r); auraRings[i] = r; }
        r.visible = true; r.position.set(wx(sel.x), .025 + i*.002, wz(sel.y)); const ar = G.U(a.r), rr = d.dmg ? G.U(d.range)*(1 + (sel.bRange||0)) : -1; r.geometry = ringGeo(Math.abs(ar - rr) < .05 ? ar - RING_W*1.6 : ar, true); }); }   // an aura as wide as the range sits just inside it
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
/* ---------- look: day or night, and painted outlines ---------- */
let skyMesh, hemi, grade, starPts, look = 'day';
const OUTLINE = new THREE.ShaderMaterial({ side:THREE.BackSide, uniforms:{w:{value:.0016}, c:{value:new THREE.Color(0x0a0812)}},
  vertexShader:`uniform float w; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vec3 n = normalize(normalMatrix*normal); mv.xyz += n*w*(-mv.z); gl_Position = projectionMatrix*mv; }`,
  fragmentShader:`uniform vec3 c; void main(){ gl_FragColor = vec4(c, 1.); }` });
const GRADE = { uniforms:{tDiffuse:{value:null}, amt:{value:1}},
  vertexShader:`varying vec2 u; void main(){ u = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader:`uniform sampler2D tDiffuse; uniform float amt; varying vec2 u; void main(){ vec4 c = texture2D(tDiffuse, u);
    float l = dot(c.rgb, vec3(.299,.587,.114)); c.rgb = mix(vec3(l), c.rgb, 1.25);                  // richer colour
    c.rgb = mix(c.rgb, c.rgb*vec3(.85,.9,1.12), .35*amt);                                          // cool shadows
    float v = smoothstep(.95, .3, length(u - .5)*1.3); c.rgb *= mix(1., v, .55*amt);               // vignette
    gl_FragColor = c; }` };
function buildStars(){ const n = 900, pos = new Float32Array(n*3), r = mkRng(91);
  for (let i=0;i<n;i++){ const a = r()*Math.PI*2, y = .08 + r()*.92, k = Math.sqrt(1 - y*y); pos.set([Math.cos(a)*k*280, y*280, Math.sin(a)*k*280], i*3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starPts = new THREE.Points(g, new THREE.PointsMaterial({color:0xdfe8ff, size:1.6, sizeAttenuation:false, fog:false, transparent:true, opacity:.85})); starPts.visible = false; scene.add(starPts); }
const LOOKS = {
  day:  {top:'#2f6fd8', mid:'#7fb8f2', bot:'#e6f2ff', fog:0xbcd6f0, fogN:60, fogF:170, sun:0xfff0d4, sunI:2.7, hemiS:0xd6e8ff, hemiG:0x6a6048, hemiI:.95, exp:1.05, bloom:[.32, .45, .9], tile:0xc6c8cf, grade:true, gradeAmt:.35, stars:false},
  aoe:  {top:'#5d8fd0', mid:'#a9c8e6', bot:'#e8eedc', fog:0xc9d6c4, fogN:55, fogF:150, sun:0xffe0ae, sunI:2.9, hemiS:0xdfe8f0, hemiG:0x5d6a30, hemiI:1.0, exp:1.0, bloom:[.3, .45, .92], tile:0xffffff, grade:true, gradeAmt:.25, stars:false},
  night:{top:'#05061a', mid:'#1a1a48', bot:'#3a2a5a', fog:0x14122e, fogN:40, fogF:140, sun:0x8aa0ff, sunI:.75, hemiS:0x4a5aa8, hemiG:0x1a1428, hemiI:.65, exp:1.05, bloom:[.9, .55, .55], tile:0x9090b0, grade:true, stars:true} };
export function setLook(l){ look = LOOKS[l] ? l : 'day'; if (AOE && look === 'day') look = 'aoe'; if (!built) return; const L = LOOKS[look], u = skyMesh.material.uniforms;
  u.top.value.set(L.top); u.mid.value.set(L.mid); u.bot.value.set(L.bot); scene.fog.color.set(L.fog); scene.fog.near = L.fogN; scene.fog.far = L.fogF;
  sun.color.set(L.sun); sun.intensity = L.sunI; hemi.color.set(L.hemiS); hemi.groundColor.set(L.hemiG); hemi.intensity = L.hemiI;
  renderer.toneMappingExposure = L.exp; [bloom.strength, bloom.radius, bloom.threshold] = L.bloom; grade.enabled = L.grade; grade.uniforms.amt.value = L.gradeAmt ?? 1; starPts.visible = L.stars;
  tilesMesh.material.color.set(L.tile); }
export function setOutline(on){ OUTLINE.visible = !!on; }
let built = false, cored = false;
// the renderer, reflections, textures and materials: shared by the board and the tower portraits
function core(){ if (cored) return; cored = true;
  renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance', alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  canvas = renderer.domElement; canvas.className = 'board3d';
  const pmrem = new THREE.PMREMGenerator(renderer); envTex = pmrem.fromScene(studio(), .02).texture;
  makeTextures(); makeMaterials(); }
/* ---------- portraits: a tower rendered once to a transparent picture, for the 2D board, the inspector and the gallery ---------- */
let pScene, pCam, pComposer, pTarget, pByte, pCopy, pCopyScene, pCopyCam;
function portraitRig(){ if (pScene) return; core();
  pScene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.7); sun.position.set(-3, 6, 4); pScene.add(sun);
  pScene.add(new THREE.HemisphereLight(0xd6e8ff, 0x6a6048, 1.0));
  const k = .5; pCam = new THREE.OrthographicCamera(-.85, .85, 2.08, -.32, .1, 50);
  const pitch = .62; pCam.position.set(0, Math.sin(pitch)*10, Math.cos(pitch)*10); pCam.lookAt(0, 0, 0); }
// a W×H cell picture (1.7 × 2.4 cells), tile centre .32 cells above the bottom edge, like the old tower sprites
export function portrait(key, cellPx){
  portraitRig();
  const W = Math.max(8, Math.ceil(cellPx*1.7)), H = Math.max(8, Math.ceil(cellPx*2.4)), SS = 2, w = W*SS, h = H*SS;
  if (!pTarget || pTarget.width !== w || pTarget.height !== h){
    if (pTarget) pTarget.dispose(); pTarget = new THREE.WebGLRenderTarget(w, h, {type:THREE.HalfFloatType});
    pComposer = new EffectComposer(renderer, pTarget); pComposer.renderToScreen = false; pComposer.setPixelRatio(1); pComposer.setSize(w, h);
    pComposer.addPass(new RenderPass(pScene, pCam)); pComposer.addPass(new OutputPass()); }
  const inst = instance(key); pScene.add(inst.g);
  const keepT = renderer.getRenderTarget(), keepC = new THREE.Color(); renderer.getClearColor(keepC); const keepA = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  pComposer.render();
  // copy the tone-mapped result into an 8-bit target so it can be read back
  if (!pByte || pByte.width !== w || pByte.height !== h){ if (pByte) pByte.dispose(); pByte = new THREE.WebGLRenderTarget(w, h); }
  if (!pCopy){ pCopy = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({uniforms:{t:{value:null}}, depthTest:false, depthWrite:false,
    vertexShader:`varying vec2 u; void main(){ u = uv; gl_Position = vec4(position.xy, 0., 1.); }`, fragmentShader:`uniform sampler2D t; varying vec2 u; void main(){ gl_FragColor = texture2D(t, u); }`}));
    pCopy.frustumCulled = false; pCopyScene = new THREE.Scene(); pCopyScene.add(pCopy); pCopyCam = new THREE.Camera(); }
  pCopy.material.uniforms.t.value = pComposer.readBuffer.texture;
  renderer.setRenderTarget(pByte); renderer.clear(); renderer.render(pCopyScene, pCopyCam);
  const px = new Uint8Array(w*h*4); renderer.readRenderTargetPixels(pByte, 0, 0, w, h, px);
  renderer.setRenderTarget(keepT); renderer.setClearColor(keepC, keepA); pScene.remove(inst.g);
  const big = document.createElement('canvas'); big.width = w; big.height = h; const bg = big.getContext('2d'), img = bg.createImageData(w, h);
  for (let y=0;y<h;y++) img.data.set(px.subarray((h-1-y)*w*4, (h-y)*w*4), y*w*4);   // flip: GL rows run bottom-up
  bg.putImageData(img, 0, 0);
  const out = document.createElement('canvas'); out.width = W; out.height = H; const o = out.getContext('2d'); o.imageSmoothingQuality = 'high'; o.drawImage(big, 0, 0, W, H);
  return out; }
export function start(el, anchor){
  host = el;
  if (!built){
    core();
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, .1, 400);
    controls = new MapControls(camera, canvas);
    Object.assign(controls, {enableDamping:true, dampingFactor:.08, screenSpacePanning:false, minDistance:6, maxDistance:70, minPolarAngle:.15, maxPolarAngle:1.18, zoomSpeed:1.1, keyPanSpeed:22});
    controls.listenToKeyEvents(window);   // arrow keys pan; letters stay with the game's hotkeys
    composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .38, .45, .92); composer.addPass(bloom); grade = new ShaderPass(GRADE); grade.enabled = false; composer.addPass(grade); composer.addPass(new OutputPass());
    makeParticles(); buildWorld(); fitCamera();
    labels = document.createElement('div'); labels.className = 'labels3d';
    canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerleave', () => { G.input.leave(); hideTip(); });
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());
    built = true; window.__view3d = {camera, controls}; setLook(look);   // handy from the console
  }
  host.insertBefore(labels, anchor.nextSibling); host.insertBefore(canvas, anchor.nextSibling);
  viewSize = {w:0, h:0}; running = true; lastS = undefined; clock.getDelta(); tick();
}
export function stop(){ hideTip(); running = false; cancelAnimationFrame(raf); if (canvas && canvas.parentNode) canvas.remove(); if (labels && labels.parentNode) labels.remove(); clearDynamic(); lastS = undefined; }
export function resetView(){ if (built) fitCamera(); }
export function setQuality(q){ if (!built) return; const hi = q !== 'low';
  renderer.setPixelRatio(hi ? Math.min(devicePixelRatio, 1.5) : 1); viewSize = {w:0, h:0};
  if (renderer.shadowMap.enabled !== hi){ renderer.shadowMap.enabled = hi; sun.castShadow = hi; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); }
  bloom.enabled = hi; }
