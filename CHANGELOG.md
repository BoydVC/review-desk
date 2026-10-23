# Changelog

## 1.0.0

First shippable cut of Review Desk. The dashboard and the nightly score run on seeded examples. Real `BoydVC/draft-day` diffs are not in this tree.

### Capabilities

- Parallel hunters, then a separate voter panel. A finding is kept only when the quorum for that depth agrees it is real (quick 2 of 3, standard 3 of 4, deep 4 of 5).
- Expert cards drawn from published frameworks, each with a citation. Depth decides which cards are active.
- Every change gets a risk tier from the diff. The tier sets review depth and how many human approvals the merge gate asks for. An agent approval does not count.
- Re-review stops after 3 rounds. Rounds 2 and 3 read only lines that changed since the previous head.
- Every kept finding ends fixed or closed with a written reason of at least 12 characters.
- Seeded past bugs score the reviewer. `npm run score:nightly` writes `data/scores/YYYY-MM-DD.json` and exits non-zero if recall or precision drops below 1.
- Local dashboard at port 43123: bugs caught, false alarms, rounds per pull, and the risk tier on each pull.
- Fixture importer for JSON files, `npm run import:draft-day` for GitHub pulls 1–15 when `GITHUB_TOKEN` is set, and `npm run import:diffs` / `npm run review:diffs` for a local folder of unified diffs. No token required for the local folder.

### Known limits

- The desk and the nightly score stay on seeded examples. Real unified diffs dropped in `data/draft-day/` are reviewed on demand and are not ground truth. The full diff set is not part of the source archive.
- A diff-only review cannot see the rest of the repository. It skips "doc links to a missing file" and "behavior changed with no test file" unless that file is in the diff. Other hunters see the hunks. JSON payloads and `RegExp.exec` are not reported as injection.
- `npm run import:draft-day` is the only command that contacts GitHub. It refuses to run without `GITHUB_TOKEN` or `GH_TOKEN`, and it does not invent file contents.
- Imported pulls are written to `fixtures/imported/pr-N.json` with `groundTruth: false`. `npm run seed` does not put them on the desk. Review one with `npm run review -- fixtures/imported/pr-N.json`. They affect the nightly score only after a person sets `expected`, sets `groundTruth: true`, and moves the file to `fixtures/eval`.
- The GitHub importer keeps the first 40 changed files per pull. File bodies larger than 100 KB are skipped; the patch from the files API is still stored when GitHub sent one.
- Hunters are deterministic checkers, not a language model. No model API key is required.
- This is a local tool with no authentication. Do not deploy it publicly.
