# Gem TD Remastered

A single-player web Gem TD that mixes the Warcraft III original, the Flash/iOS port and the Dota 2 version. Everything is static, so it runs on GitHub Pages. Scores are submitted as GitHub issues and verified by a GitHub Action that replays the whole game.

- `index.html`: the game
- `towers.html`: the tower gallery
- `leaderboard.html`: verified scores, read from `scores.json`
- `scripts/verify.mjs`: replays a submitted run and scores how believable it is
- `.github/workflows/verify-score.yml`: runs the verifier on every new `[score]` issue
- `.github/ISSUE_TEMPLATE/score.yml`: the form the game fills in

## Setup

1. Push this folder to a new GitHub repository.
2. **Settings → Pages**: deploy from the `main` branch, root folder. The game will be live at `https://<you>.github.io/<repo>/`.
3. **Settings → Actions → General → Workflow permissions**: choose **Read and write permissions**, so the bot can comment, label and commit `scores.json`.
4. Make sure **Issues** are turned on under **Settings → General → Features**.

On GitHub Pages the game works out which repository to send scores to from its own address. If you host it somewhere else, set `SUBMIT_REPO_OVERRIDE` in `index.html` to `owner/repo`.

## How a score gets onto the leaderboard

1. When the castle falls, the end screen offers **Submit score**. It opens a prefilled issue on this repository holding a compressed replay: the run's random seed plus every decision the player made, each tagged with the simulation tick it happened on.
2. The workflow loads `index.html` in headless Chromium and replays the run from scratch with the game's own code. The game uses seeded randomness and fixed 1/60 s ticks, so the same inputs always give the same result.
3. The verifier posts a feasibility score out of 100:

| Check | Points |
|---|---|
| Same game version | 15 |
| Every action was legal (affordable, in the right phase, on a real tower) | 25 |
| Every action landed on its recorded tick | 10 |
| The replay reaches the claimed wave | 30 |
| Kills match | 10 |
| Real play time is at least what 3× speed allows | 10 |

**90 or more** is accepted: the score is committed to `scores.json` and the issue is closed. **60 to 89** gets a `needs-review` label for you to look at. Anything lower, a claim more than one wave off, a damaged code or a repeated seed is rejected.

Console cheats such as extra gold or lives don't survive the replay. The replayed game never had that gold, so the purchases become impossible actions and the run falls apart.

## Changing the game

Bump `GAME_VERSION` in `index.html` whenever a change affects gameplay. Replays recorded on an older version can't be checked exactly against new rules, so they score 85 and land in review.

To check a submission locally, run `npm install`, `npx playwright install chromium`, then `node scripts/verify.mjs issue-body.txt`.

## Known limits

- The check runs in Chromium. Players on Firefox or Safari could, very rarely, see a tiny floating-point difference that changes a close fight. That shows up as a lower score and a review rather than a wrong acceptance.
- Players need a GitHub account to submit.
- A determined cheater could write a bot that plays legally and very well. A replay proves the run happened under the rules; it doesn't prove a human played it.
