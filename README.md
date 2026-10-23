# Review Desk

Review Desk is a local code-review pipeline for agent-written pull requests. It follows the shape described in [How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/) (Addy Osmani, Morgan Westlee Lunt, and Qing Wang, October 15, 2026): several hunters read a diff in parallel, a separate panel votes, and a finding is kept only when a quorum says it is real. The change picks a risk tier. The tier picks how deep the review goes. Re-review stops after three rounds, and later rounds read only the new lines. Every kept finding ends fixed or closed with a written reason.

The seeded demo works with no GitHub token. `npm run demo` and `npm run seed` unset `GITHUB_TOKEN` and `GH_TOKEN` for that process. The only command that reads a token is `npm run import:draft-day`.

This is a local tool. Do not deploy it publicly. It has no authentication.

## Install

```bash
npm install
```

## Seeded demo (no token)

```bash
npm test
npm run demo
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). The desk shows bugs caught, false alarms, rounds per pull, and the risk tier on each pull. Every card is labeled as a seeded example. A finding that is still open has a form: mark it fixed, or close it as not a bug. Both require a written reason of at least 12 characters.

`npm run demo` seeds `data/desk.json`, then starts the dev server on port 43123. It does not call GitHub.

To run the pieces yourself:

```bash
npm run seed
npm run dev
```

`npm start` serves a production build (`npm run build` first) on the same port. The first page load creates the desk file if you have not seeded. It still does not read a token.

Score the reviewer against the seeded bugs:

```bash
npm run score:nightly
```

That command writes `data/scores/YYYY-MM-DD.json` and exits non-zero if recall or precision on the ground-truth set drops below 1. A nightly timer:

```bash
15 2 * * * cd /path/to/review-desk && npm run score:nightly
```

Review one fixture from the command line:

```bash
npm run review -- fixtures/inbox/readme-missing-link.json
```

## Import BoydVC/draft-day

`npm run import:draft-day` fetches pull requests 1 through 15 from the private repository `BoydVC/draft-day`.

1. Copy `.env.example` to `.env`.
2. Set `GITHUB_TOKEN` to a token that can read that repository (contents and pull requests). `GH_TOKEN` is used only when `GITHUB_TOKEN` is unset. `.env` is gitignored.
3. Export it into the shell, then import:

```bash
set -a && source .env && set +a
npm run import:draft-day
```

The same thing in one line, without a file:

```bash
GITHUB_TOKEN=replace-with-a-github-token npm run import:draft-day
```

What the command does:

- If neither `GITHUB_TOKEN` nor `GH_TOKEN` is set, it exits and does not guess private contents.
- It writes one JSON file per pull to `fixtures/imported/pr-N.json`.
- Each file has `groundTruth: false` and an empty `expected` list. The provenance note says it was imported from GitHub.
- It keeps the first 40 changed files. Bodies larger than 100 KB are omitted; a patch is kept when the GitHub files API sent one.
- It does not change the dashboard. Review a file with `npm run review -- fixtures/imported/pr-12.json`.
- It does not change the nightly score. To count a confirmed bug, fill in `expected`, set `groundTruth: true`, and move the file to `fixtures/eval`.

Uploaded pull JSON uses the same shape as `fixtures/inbox/readme-missing-link.json`. Drop samples in `fixtures/inbox` and list them with `npm run import:fixtures -- fixtures/inbox`. That folder is not scored unless you copy a file into `fixtures/eval`.

## Load attached unified diffs

Real `BoydVC/draft-day` diffs stay out of git and out of the seeded demo. Put them in a folder such as `data/draft-day/` (that directory is gitignored):

```text
data/draft-day/index.json
data/draft-day/pr-01.diff
...
data/draft-day/pr-15.diff
```

`index.json` is an array of `{ number, title, head, base, diff_file }`. A diff file may be named `pr-01.diff` or `pr-01_<suffix>.diff`. An index named `index_<suffix>.json` is used when `index.json` is absent. No `GITHUB_TOKEN` is required.

```bash
npm run import:diffs -- data/draft-day
npm run review:diffs -- data/draft-day
```

`import:diffs` writes one unlabeled case per pull to `data/draft-day/cases/pr-NN.json` with `groundTruth: false`. `review:diffs` runs the same hunters and writes `data/draft-day/report.json`. Those pulls are not added to the desk, and they do not change `npm run score:nightly`.

The diff is the whole input. The repository tree is not in the file, so this pass does not flag a relative doc link as missing, and it does not flag a code change as untested, unless the test file itself is in the diff. JSON and JSONL payloads are not treated as executable code. `RegExp.exec` is not a shell call. Recall and precision stay on the seeded set, which has confirmed bugs. The diff report counts findings the quorum kept. These pulls have no confirmed bug list, so that report does not invent recall or precision.

`fixtures/samples/unified/` is a tiny sample of the same folder shape. `npm run review:diffs -- fixtures/samples/unified` runs it. People without the real diffs can ignore this section and use `npm run demo`.

## What the desk does

1. **Parallel hunters, then a quorum.** Docs, bounds, STRIDE, compatibility, stability, tests, abstraction, and telemetry hunters run with `Promise.all`. A separate panel (evidence, introduced-here, actionable, and on deeper passes specificity and reachability) votes. Style, diagnostics, and cleanup are dropped before the vote. Quick keeps a finding at 2 of 3. Standard needs 3 of 4. Deep needs 4 of 5.
2. **Expert cards.** Each lens is a published framework, with a quote or a labeled paraphrase and a citation. Depth decides which cards are in the room. They are listed at `/experts`.
3. **Risk tier sets depth.** Low (docs and copy) is a quick pass and needs no person once the desk is clear. Medium (ordinary code) is standard and needs one person. High (billing, auth, payments, secrets, workflows, live credentials) is deep and needs two. The author does not pick the tier. An untrusted author never gets the lighter approval path. An agent approval never counts as a person's.
4. **Three rounds, then only the new lines.** Round 1 reads the pull request diff. Rounds 2 and 3 read lines that changed since the previous head. A fourth request is refused. The author is asked to step back.
5. **Every finding is disposed.** Fix it, or close it with a written reason of at least 12 characters. A later round clears a finding on its own when the cited problem is gone, and it records that reason. Open findings block the merge gate.
6. **A test set scores the reviewer.** Seeded examples are ground truth. `npm run score:nightly` is the scoring command. Imports are not ground truth until a person confirms the bugs and moves the fixture into `fixtures/eval` with `groundTruth: true`.
7. **The dashboard** is the dev server: bugs caught (kept findings later fixed), false alarms (kept findings closed with a reason), rounds per pull, and the risk tier on each pull. `/score` is recall and precision.

## Layout

- `src/lib/review` — risk, hunters, quorum, rounds, closure, scoring, import
- `src/cli.ts` — `seed`, `score`, `review`, `import-fixtures`, `import-github`
- `src/app` — the dashboard
- `fixtures/inbox` — JSON to try the importer
- `fixtures/samples/unified` — tiny `index.json` plus one diff for `review:diffs`
- `data/draft-day/` — local home for the real diffs. Gitignored. Not required to run the demo.
- `fixtures/eval` — extra ground-truth cases
- `fixtures/imported` — GitHub output, not ground truth
- `data/desk.json` — generated when you seed or open the dashboard. Not committed.
- `.env.example` — placeholder names for the import token. Not a secret.

Hunters are deterministic checkers, so the pipeline, the tests, and the nightly score run without an API key. They are the review agents. They are not a language model. See `CHANGELOG.md` for v1 limits.
