import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exampleFixtures } from "./lib/review/examples";
import { formatReport, scoreCases } from "./lib/review/score";
import { formatDiffReview, loadDiffFolder, summarizeDiffSessions, writeDiffCases } from "./lib/review/gitdiff";
import { githubClient, importGithubPulls, loadFixtureDir, loadFixtureFile } from "./lib/review/import";
import { openSession, resolveFinding, reviewFollowUps } from "./lib/review/pipeline";
import { appendScore, buildDesk, ensureStore, loadEvalCases, writeStore } from "./lib/review/store";

const [command, ...args] = process.argv.slice(2);

async function main() {
  if (!command || command === "help" || command === "--help") {
    console.log(`Review Desk

  npm test
  npm run demo
  npm run seed
  npm run dev
  npm start
  npm run score
  npm run score:nightly
  npm run review -- fixtures/inbox/readme-missing-link.json
  npm run import:fixtures -- fixtures/inbox
  npm run import:draft-day
  npm run import:diffs -- data/draft-day
  npm run review:diffs -- data/draft-day

demo, seed, test, and the dashboard do not read GITHUB_TOKEN.
import:draft-day is the only command that uses it.
import:diffs and review:diffs read local unified diffs. They do not call GitHub.

Nightly scoring is the same command on a timer:

  15 2 * * * cd /path/to/review-desk && npm run score:nightly
`);
    return;
  }

  if (command === "seed") {
    const store = await buildDesk();
    writeStore(store);
    const score = store.scores[0];
    console.log(`Seeded ${store.sessions.length} reviews and a score of ${score?.cases ?? 0} cases.`);
    if (score) {
      console.log(`Recall ${score.recall} · precision ${score.precision}. GitHub was not contacted.`);
    }
    return;
  }

  if (command === "score") {
    const nightly = args.includes("--nightly");
    await ensureStore();
    const report = await scoreCases(loadEvalCases(), {
      label: nightly ? "nightly" : "review-desk score",
    });
    console.log(formatReport(report));
    appendScore(report);
    if (nightly) {
      const day = report.ranAt.slice(0, 10);
      const file = path.join(process.cwd(), "data", "scores", `${day}.json`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(report, null, 2));
      console.log(`Wrote ${file}`);
    }
    if (report.recall < 1 || report.precision < 1) {
      console.error("Score dropped below the seeded bar (recall and precision must both be 1).");
      process.exitCode = 1;
    }
    return;
  }

  if (command === "review") {
    const file = args[0];
    if (!file) throw new Error("Pass a fixture JSON file.");
    const loaded = loadFixtureFile(path.resolve(file));
    const session = await reviewFollowUps(loaded.pr);
    console.log(JSON.stringify({
      id: session.id,
      tier: session.risk.tier,
      depth: session.risk.depth,
      rounds: session.rounds.length,
      status: session.status,
      findings: session.findings.map((finding) => ({
        id: finding.id,
        status: finding.status,
        bugClass: finding.bugClass,
        path: finding.path,
        symbol: finding.symbol,
        yesVotes: finding.yesVotes,
        quorumRequired: finding.quorumRequired,
        title: finding.title,
      })),
    }, null, 2));
    return;
  }

  if (command === "resolve") {
    const [sessionFile, findingId, kind, ...reasonParts] = args;
    if (!sessionFile || !findingId || (kind !== "fixed" && kind !== "closed")) {
      throw new Error("Usage: review-desk resolve <fixture.json> <findingId> fixed|closed <reason>");
    }
    const loaded = loadFixtureFile(path.resolve(sessionFile));
    const session = await openSession(loaded.pr);
    const next = resolveFinding(session, findingId, { kind, reason: reasonParts.join(" ") });
    console.log(`${findingId} ${next.findings.find((finding) => finding.id === findingId)?.status}`);
    return;
  }

  if (command === "import-fixtures") {
    const dir = args[0] ? path.resolve(args[0]) : path.join(process.cwd(), "fixtures", "inbox");
    const cases = loadFixtureDir(dir);
    console.log(`Loaded ${cases.length} fixture(s) from ${dir}.`);
    for (const item of cases) {
      console.log(`- ${item.pr.id} [${item.pr.provenance}] groundTruth=${item.groundTruth} ${item.pr.title}`);
    }
    return;
  }

  if (command === "import-diffs" || command === "review-diffs") {
    const dir = args.find((arg) => !arg.startsWith("--")) ?? path.join(process.cwd(), "data", "draft-day");
    const loaded = loadDiffFolder(dir);
    const outDir = path.join(process.cwd(), "data", "draft-day", "cases");
    const written = writeDiffCases(loaded.cases, outDir);
    const files = loaded.cases.reduce((sum, item) => sum + item.pr.files.length, 0);
    console.log(
      `Imported ${loaded.cases.length} pulls (${files} files) from ${loaded.dir} using ${loaded.indexName}.`,
    );
    console.log(`Wrote ${written.length} case files to ${outDir}. groundTruth=false. GitHub was not contacted.`);
    if (command === "import-diffs") return;
    const sessions = [];
    for (const item of loaded.cases) sessions.push(await openSession(item.pr));
    const summary = summarizeDiffSessions(sessions);
    const baselineReport = await scoreCases(exampleFixtures, { label: "seeded baseline" });
    const baseline = formatReport(baselineReport).split("\n").slice(0, 3).join("\n");
    const text = formatDiffReview(summary, baseline);
    console.log(text);
    const reportFile = path.join(process.cwd(), "data", "draft-day", "report.json");
    mkdirSync(path.dirname(reportFile), { recursive: true });
    writeFileSync(
      reportFile,
      JSON.stringify(
        {
          seeded: {
            cases: baselineReport.cases,
            recall: baselineReport.recall,
            precision: baselineReport.precision,
            truePositives: baselineReport.truePositives,
            falseNegatives: baselineReport.falseNegatives,
            falsePositives: baselineReport.falsePositives,
          },
          draftDay: summary,
        },
        null,
        2,
      ),
    );
    console.log(`Wrote ${reportFile}`);
    return;
  }

  if (command === "import-github") {
    const repoArg = args[0] ?? "BoydVC/draft-day";
    const [owner, repo] = repoArg.split("/");
    if (!owner || !repo) throw new Error("Expected owner/repo.");
    const from = numberFlag(args, "--from", 1);
    const to = numberFlag(args, "--to", 15);
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
      throw new Error(
        "GITHUB_TOKEN is not set. Review Desk will not guess the contents of a private repository.",
      );
    }
    const cases = await importGithubPulls(githubClient(token), { owner, repo, from, to });
    const outDir = path.join(process.cwd(), "fixtures", "imported");
    mkdirSync(outDir, { recursive: true });
    for (const item of cases) {
      const file = path.join(outDir, `pr-${item.pr.number}.json`);
      writeFileSync(file, JSON.stringify(item, null, 2));
      console.log(`Wrote ${file} (${item.pr.files.length} files). groundTruth=false until a person confirms bugs.`);
    }
    console.log(
      "Review one file with npm run review -- fixtures/imported/pr-N.json. " +
        "Seed does not add these pulls to the desk. They stay out of the nightly score until groundTruth is true and the file is in fixtures/eval.",
    );
    return;
  }

  if (command === "list-examples") {
    for (const item of exampleFixtures) {
      console.log(`${item.pr.number}\t${item.pr.id}\t${item.expected.map((bug) => bug.bugClass).join(",") || "clean"}`);
    }
    return;
  }

  throw new Error(`Unknown command ${command}. Try: npm run review -- --help`);
}

function numberFlag(argv: string[], flag: string, fallback: number): number {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`${flag} needs a number.`);
  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
