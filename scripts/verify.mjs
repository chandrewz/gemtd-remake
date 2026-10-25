// Verifies a Gem TD score submitted as a GitHub issue.
// Replays the run in a headless browser with the game's own code, scores how believable it is,
// and (if accepted) adds it to scores.json. Writes report.md and result.json for the workflow.
//
// Inputs (env): ISSUE_BODY, ISSUE_NUMBER, ISSUE_USER, ISSUE_URL
// Local use:    node scripts/verify.mjs path/to/issue-body.txt
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'index.html');
const SCORES = path.join(ROOT, 'scores.json');
const ACCEPT_AT = 90, REVIEW_AT = 60;

const body = process.env.ISSUE_BODY ?? (process.argv[2] ? readFileSync(process.argv[2], 'utf8') : '');
const issue = { number: +(process.env.ISSUE_NUMBER || 0), user: process.env.ISSUE_USER || 'local', url: process.env.ISSUE_URL || '' };

const field = label => { const m = body.match(new RegExp(`###\\s*${label}\\s*\\n+([^\\n]+)`, 'i')); return m ? m[1].trim() : ''; };
const claim = {
  name: (field('Player name') || 'Anonymous').replace(/[<>`|\r]/g, '').slice(0, 24),
};
if (/@|https?:|www\./i.test(claim.name)) claim.name = 'Anonymous';   // never publish an email or link as a name
Object.assign(claim, {
  wave: parseInt(field('Wave reached'), 10),
  kills: parseInt(field('Kills'), 10),
});

const checks = [];   // {name, pts, max, note}
const add = (name, max, pts, note) => checks.push({ name, max, pts, note });
let decision = 'rejected', rep = null, run = null, gameVersion = '?', fatal = '';

function finish() {
  const total = checks.reduce((a, c) => a + c.pts, 0);
  if (!fatal) decision = total >= ACCEPT_AT ? 'accepted' : total >= REVIEW_AT ? 'review' : 'rejected';
  let entry = null;
  if (decision === 'accepted') {
    entry = { name: claim.name, github: issue.user, wave: run.wave, kills: run.kills, lives: run.lives,
              version: rep.v, seed: rep.seed, issue: issue.number, date: new Date().toISOString().slice(0, 10), feasibility: total };
    const scores = existsSync(SCORES) ? JSON.parse(readFileSync(SCORES, 'utf8')) : [];
    scores.push(entry);
    scores.sort((a, b) => b.wave - a.wave || b.kills - a.kills || a.issue - b.issue);
    writeFileSync(SCORES, JSON.stringify(scores, null, 2) + '\n');
    entry.rank = scores.indexOf(entry) + 1;
  }
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || 'owner/repo').split('/');
  const site = repo === `${owner}.github.io` ? `https://${owner}.github.io` : `https://${owner}.github.io/${repo}`;
  const lb = entry ? `${site}/leaderboard.html?run=${entry.seed}` : `${site}/leaderboard.html`;
  const verdict = { accepted: `✅ **Accepted.** You're **#${entry?.rank}** on the [leaderboard](${lb}). It can take a minute or two for the site to update.`, review: '🟡 **Needs review.** A maintainer will take a look.', rejected: '❌ **Not accepted.**' }[decision];
  const rows = checks.map(c => `| ${c.pts === c.max ? '✅' : c.pts > 0 ? '🟡' : '❌'} ${c.name} | ${c.pts}/${c.max} | ${c.note} |`).join('\n');
  const md = [
    `## Score check: ${checks.length ? total : 0}/100`,
    '', verdict, fatal ? `\n${fatal}` : '',
    '', `**${claim.name}** claimed wave **${isNaN(claim.wave) ? '?' : claim.wave}**${isNaN(claim.kills) ? '' : ` with ${claim.kills} kills`}.`,
    run ? `The replay reached wave **${run.wave}** with ${run.kills} kills and ${run.lives} lives left (${rep.a.length} actions, ${Math.round(run.tick / 60)} s of game time).` : '',
    '', checks.length ? '| Check | Points | Detail |\n|---|---|---|\n' + rows : '',
    '', `<sub>Accepted at ${ACCEPT_AT}+, reviewed at ${REVIEW_AT}–${ACCEPT_AT - 1}. Verified against game version ${gameVersion}.</sub>`,
  ].join('\n');
  writeFileSync(path.join(ROOT, 'report.md'), md + '\n');
  writeFileSync(path.join(ROOT, 'result.json'), JSON.stringify({ decision, total, entry }, null, 2));
  console.log(md);
}

// 1. decode
const code = (body.match(/GTD1\.[A-Za-z0-9_-]+/) || [])[0];
if (!code) { fatal = 'No replay code was found. It starts with `GTD1.`'; finish(); process.exit(0); }
try { rep = JSON.parse(inflateRawSync(Buffer.from(code.slice(5), 'base64url')).toString('utf8')); }
catch (e) { fatal = 'The replay code is damaged and couldn’t be read. Copy it again from the game.'; finish(); process.exit(0); }
if (!rep || !Array.isArray(rep.a) || typeof rep.seed !== 'number') { fatal = 'The replay is missing its data.'; finish(); process.exit(0); }
if (rep.tainted) { fatal = 'This game was restored mid-run, so it can’t be replayed from the start.'; finish(); process.exit(0); }
const existing = existsSync(SCORES) ? JSON.parse(readFileSync(SCORES, 'utf8')) : [];
if (existing.some(s => s.seed === rep.seed)) { fatal = `This run (seed ${rep.seed}) is already on the leaderboard.`; finish(); process.exit(0); }

// 2. replay it with the game's own code
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(GAME).href);
  await page.waitForFunction(() => window.GemReplay);
  gameVersion = await page.evaluate(() => GemReplay.version);
  run = await page.evaluate(r => GemReplay.runReplay(r), rep);
  if (errors.length) run.errors = errors.slice(0, 3);
} finally { await browser.close(); }

// 3. score it
add('Same game version', 15, rep.v === gameVersion ? 15 : 0, rep.v === gameVersion ? rep.v : `played on ${rep.v}, checked on ${gameVersion}`);
add('Every action was legal', 25, run.illegal === 0 ? 25 : 0,
  run.illegal === 0 ? `${rep.a.length} actions` : `${run.illegal} impossible action(s), first at wave ${run.firstIllegal.wave} (${run.firstIllegal.a[1]}, ${run.firstIllegal.gold} gold)`);
add('Actions happened on time', 10, run.late === 0 ? 10 : 0, run.late === 0 ? 'all on their recorded tick' : `${run.late} action(s) out of sync`);
const dw = isNaN(claim.wave) ? 99 : Math.abs(run.wave - claim.wave);
add('Replay reaches the claimed wave', 30, run.phase === 'lost' && dw === 0 ? 30 : dw <= 1 ? 10 : 0,
  `${run.wave} vs ${isNaN(claim.wave) ? '?' : claim.wave} claimed${run.phase === 'lost' ? '' : ' (run never ended)'}`);
const kOk = !isNaN(claim.kills) && Math.abs(run.kills - claim.kills) <= Math.max(2, claim.kills * .02);
add('Kills match', 10, kOk ? 10 : 0, `${run.kills} vs ${isNaN(claim.kills) ? '?' : claim.kills} claimed`);
const minWall = run.tick / 60 / 16 * .9;   // fastest possible: the 8× button runs the simulation at 16× real time
const wallOk = typeof rep.wall === 'number' && rep.wall >= minWall && rep.wall < 7 * 86400;
add('Played in believable time', 10, wallOk ? 10 : 0, `${Math.round((rep.wall || 0) / 60)} min real time, at least ${Math.ceil(minWall / 60)} min needed`);
if (run.errors) add('Game ran cleanly', 0, 0, run.errors.join('; ').slice(0, 120));
if (dw > 1) fatal = `The replay only reaches wave ${run.wave}, not the claimed wave ${isNaN(claim.wave) ? '?' : claim.wave}.`;
finish();
