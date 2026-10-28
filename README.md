# Gem TD Remake

**[Play it here](https://chandrewz.github.io/gemtd-remake/)** · [Leaderboard](https://chandrewz.github.io/gemtd-remake/leaderboard.html) · [Tower gallery](https://chandrewz.github.io/gemtd-remake/towers.html)

A single-player web Gem TD that mixes the Warcraft III original, the Flash/iOS port and the Dota 2 version. Everything is static, so it runs on GitHub Pages. Scores are submitted as GitHub issues and checked by a bot before they reach the leaderboard.

- `index.html`: the game
- `towers.html`: the tower gallery
- `leaderboard.html`: verified scores, read from `scores.json`
- `scripts/verify.mjs`: checks submitted runs
- `.github/workflows/verify-score.yml`: runs the verifier on every new `[score]` issue
- `.github/ISSUE_TEMPLATE/score.yml`: the form the game fills in

## Setup

1. Push this folder to a new GitHub repository.
2. **Settings → Pages**: deploy from the `main` branch, root folder. The game will be live at `https://<you>.github.io/<repo>/`.
3. Make sure **Issues** are turned on under **Settings → General → Features**.

On GitHub Pages the game works out which repository to send scores to from its own address. If you host it somewhere else, set `SUBMIT_REPO_OVERRIDE` in `index.html` to `owner/repo`.

## Submitting scores

When the castle falls, the end screen offers **Submit score**. It opens a prefilled GitHub issue with a replay of the run. A bot replays it, comments a score, and adds verified runs to the leaderboard.

## Changing the game

Bump `GAME_VERSION` in `index.html` whenever a change affects gameplay. Replays from an older version go to review instead of being accepted automatically.

To check a submission locally, run `npm install`, `npx playwright install chromium`, then `node scripts/verify.mjs issue-body.txt`.
