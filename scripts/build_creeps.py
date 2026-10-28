# builds creeps.html from the game's own wave and damage tables, so the page never drifts from index.html
import re
import os
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC=os.path.join(ROOT, 'index.html'); OUT=os.path.join(ROOT, 'creeps.html')
g=open(SRC).read()
def grab(start, end_pat):
    i=g.index(start); j=g.index(end_pat, i)+len(end_pat); return g[i:j]
def line(start): i=g.index(start); return g[i:g.index('\n',i)]
parts=[
 grab("const GT = {", "\n};"), line("const TYPES = "), line("const QN = "), line("const ARMOR = "), line("const AORDER = "),
 grab("const ATK = {", "\n};"), line("const DTYPE_NAME = "), line("const armorMult = "),
 grab("const WAVES = [", "\n];"), line("const MRES_BASE = "), grab("const WNAMES = [", "];"), line("const DIFF = "),
 line("const ENDLESS_GROWTH = "), line("const ROMAN = "), line("const bossBounty = "), grab("function endlessInfo(w){", "\n}"),
 line("const BOSS_ADJ = "), grab("function waveInfo(w){", "\n}"), line("const START_LIVES = "),
]
data='\n'.join(parts)
ver=re.search(r"GAME_VERSION = '([^']+)'", g).group(1)
html=r'''<meta charset="utf-8">
<title>Creeps and Waves</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Marcellus+SC&family=Barlow+Semi+Condensed:wght@400;500;600&display=swap">
<style>
/* Layout: a short header, the damage-against-armour table, then every wave as one row of a scrollable ledger, then endless. */
:root{ --ink:#0b0d15; --slate:#121725; --slate-2:#1a2133; --rule:#2a3350; --fg:#e8eaf3; --muted:#8e95ad; --gold:#f2c35b; --ok:#5fd38d; --bad:#ff7a7a; --fly:#ff7cc0;
  --f-display:"Marcellus SC", Georgia, serif; --f-ui:"Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif; color-scheme:dark; }
[hidden]{display:none!important}
body{background:var(--ink);color:var(--fg);font-family:var(--f-ui);font-size:15px;line-height:1.4;margin:0;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:28px 48px}
.wrap{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:22px}
header h1{font-family:var(--f-display);font-weight:400;font-size:clamp(30px,5vw,44px);margin:0;letter-spacing:.04em;line-height:1}
header h1 span{color:var(--gold)}
header p{margin:8px 0 0;color:var(--muted);max-width:72ch}
.sitenav{display:flex;gap:18px;margin:0 0 10px;flex-wrap:wrap}.sitenav a{color:var(--gold);text-decoration:none;font-weight:600}.sitenav a:hover{text-decoration:underline}
h2.sec{font-family:var(--f-display);font-weight:400;font-size:24px;margin:8px 0 0}
.sec-note{color:var(--muted);margin:2px 0 8px;font-size:14px;max-width:80ch}
.box{background:var(--slate);border:1px solid var(--rule);border-radius:10px;overflow:auto;max-width:100%}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:14px}
th,td{padding:7px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid #1f2740}
th{position:sticky;top:0;background:var(--slate-2);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;z-index:1}
th.l,td.l{text-align:left}
tr:last-child td{border-bottom:0}
tr.boss td{background:rgba(242,195,91,.06)}
tr.flying td.nm::after{content:"Flying";margin-left:8px;font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--fly);color:var(--fly)}
tr.boss td.nm::before{content:"Boss";margin-right:8px;font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--gold);color:var(--gold)}
.ico{display:inline-block;vertical-align:-3px;margin-right:6px}
.arm{display:inline-flex;align-items:center;gap:6px}.arm i{width:10px;height:10px;border-radius:50%;display:inline-block}
.hi{color:var(--ok);font-weight:600}.lo{color:var(--bad)}
.mult td{text-align:center}.mult th{text-align:center}
.small{color:var(--muted);font-size:12px;white-space:normal}
.key{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);font-size:13px}
.ver{color:var(--muted);font-size:12px}
</style>
<div class="wrap">
  <header><nav class="sitenav" id="sitenav" hidden><a href="./">Play the game</a><a href="towers.html">Towers</a><a href="leaderboard.html">Leaderboard</a></nav>
  <h1>Creeps <span>and waves</span></h1>
  <p>Every wave in the game: who comes, how tough they are, how fast they move, what they resist and what they pay. Numbers are read from the game itself.</p></header>

  <section><h2 class="sec">Damage against armour</h2>
  <p class="sec-note">Each gem's damage is multiplied by the creep's armour type, then reduced by its armour value: each point of armour cuts damage by about 6% (5 armour takes 23% off, 15 takes 47%). Pure damage ignores both, and magic damage (burn, poison, Wings of Topaz) ignores armour but is cut by magic resistance.</p>
  <div class="box"><table class="mult" id="atk"></table></div></section>

  <section><h2 class="sec">Waves 1–50</h2>
  <p class="sec-note">Ten creeps a wave, except every tenth wave, which is a single boss. Speed is in tiles per second. Gold is per creep (or for the boss); a wave with no leaks also pays a bonus of 5 + the wave number.</p>
  <div class="box"><table id="waves"></table></div></section>

  <section><h2 class="sec">Endless</h2>
  <p class="sec-note" id="endnote"></p>
  <div class="box"><table id="endless"></table></div></section>
  <p class="ver" id="ver"></p>
</div>
<script>
'use strict';
if (/\.github\.io$/i.test(location.hostname)) document.getElementById('sitenav').hidden = false;   // links only make sense on the live site
const S = {diff:'normal'};
/*DATA*/
const GAME_VERSION = '/*VER*/';
const pct = v => Math.round(v*100) + '%';
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? Math.round(n/1e3) + 'k' : n.toLocaleString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function icon(w){ const col = ARMOR[w.type], r = w.boss ? 7 : 5, cy = w.fly ? 9 : 10;   // a small creep marker: armour colour, wings for flyers, bigger for bosses
  const wings = w.fly ? `<path d="M9 9 L1 4 L2 12 Z M9 9 L17 4 L16 12 Z" fill="${col}" opacity=".55"/>` : '';
  return `<svg class="ico" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">${wings}<circle cx="9" cy="${cy}" r="${r}" fill="${col}" stroke="rgba(0,0,0,.5)"/></svg>`; }
const arm = t => `<span class="arm"><i style="background:${ARMOR[t]}"></i>${t}</span>`;
function vs(type){ const ai = AORDER.indexOf(type);
  const strong = Object.keys(ATK).filter(k=>k!=='X' && ATK[k][ai]>=1.5).map(k=>`<span class="hi">${DTYPE_NAME[k]} ×${ATK[k][ai]}</span>`);
  const weak = Object.keys(ATK).filter(k=>k!=='X' && ATK[k][ai]<=.6).map(k=>`<span class="lo">${DTYPE_NAME[k]} ×${ATK[k][ai]}</span>`);
  return [strong.join(', '), weak.join(', ')]; }
// damage table
{ let h = `<tr><th class="l">Damage</th>${AORDER.map(t=>`<th>${arm(t)}</th>`).join('')}</tr>`;
  for (const k of Object.keys(ATK)) h += `<tr><td class="l">${DTYPE_NAME[k]}</td>${ATK[k].map(v=>`<td class="${v>=1.5?'hi':v<=.6?'lo':''}">×${v}</td>`).join('')}</tr>`;
  document.getElementById('atk').innerHTML = h; }
function rows(from, to){
  let h = `<tr><th>Wave</th><th class="l">Creep</th><th class="l">Armour type</th><th>HP</th><th>Total HP</th><th>Armour</th><th>Speed</th><th>Magic resist</th><th>Leak cost</th><th>Gold</th><th class="l">Strong against it</th><th class="l">Weak against it</th></tr>`;
  for (let w=from; w<=to; w++){ const W = waveInfo(w), [st, wk] = vs(W.type);
    h += `<tr class="${W.boss?'boss':''} ${W.fly?'flying':''}"><td>${w}</td><td class="l nm">${icon(W)}${esc(W.name)}</td><td class="l">${arm(W.type)}</td><td>${fmt(W.hp)}</td><td>${fmt(W.hp*W.count)}</td><td>${W.armor}</td><td>${(W.speed/100).toFixed(2)}</td><td>${pct(W.mr||0)}</td><td>${W.leak}${W.boss?'':' each'}</td><td>${W.bounty}${W.boss?'':' each'}</td><td class="l small">${st||'—'}</td><td class="l small">${wk||'—'}</td></tr>`; }
  return h; }
document.getElementById('waves').innerHTML = rows(1, 50);
document.getElementById('endless').innerHTML = rows(51, 70);
document.getElementById('endnote').textContent = `After the Gem Eater, waves 41–49 repeat as endless creeps with ${pct(ENDLESS_GROWTH-1)} more HP each wave, more armour every five waves and rising speed (up to 5 tiles a second), with a boss every tenth wave. The first 20 endless waves are shown; it keeps going until your castle falls. You start with ${START_LIVES} lives.`;
document.getElementById('ver').textContent = 'Game version ' + GAME_VERSION;
</script>
'''
html=html.replace('/*DATA*/', data).replace('/*VER*/', ver)
open(OUT,'w').write(html)
print('wrote', OUT, len(html))
