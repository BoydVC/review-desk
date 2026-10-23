import { describe, expect, it } from "vitest";
import { deltaFiles, lineDiff, parseUnifiedDiff } from "@/lib/review/diff";
import { exampleFixtures } from "@/lib/review/examples";
import { expertCards } from "@/lib/review/experts";
import { allHunters } from "@/lib/review/hunters";
import { buildDemoSessions } from "@/lib/review/demo";
import { GithubAccessError, githubClient, importGithubPulls, parseFixture } from "@/lib/review/import";
import { mergeGate, openSession, resolveFinding, reviewRound, runHunters } from "@/lib/review/pipeline";
import { defaultPolicy } from "@/lib/review/policy";
import { classifyRisk } from "@/lib/review/risk";
import { scoreCases, scoreFindings } from "@/lib/review/score";
import type { CandidateFinding, ChangeFile, ReviewDepth } from "@/lib/review/types";
import { allVoters } from "@/lib/review/voters";

const code = (path: string, content: string, previousContent = ""): ChangeFile => ({
  path,
  status: previousContent ? "modified" : "added",
  content,
  previousContent,
});

describe("diffs", () => {
  it("counts added and removed lines", () => {
    const delta = lineDiff("one\ntwo\n", "one\nthree\n");
    expect(delta.removed.map((line) => line.text)).toEqual(["two"]);
    expect(delta.added.map((line) => line.text)).toEqual(["three"]);
  });

  it("parses a unified diff", () => {
    const patch = "@@ -1,2 +1,2 @@\n keep\n-old\n+new\n";
    const parsed = parseUnifiedDiff(patch);
    expect(parsed.removed).toEqual([{ line: 2, text: "old" }]);
    expect(parsed.added).toEqual([{ line: 2, text: "new" }]);
  });

  it("limits a follow-up to files whose contents changed", () => {
    const previous = [code("a.ts", "const a = 1;\n"), code("b.ts", "const b = 1;\n")];
    const next = [code("a.ts", "const a = 1;\n"), code("b.ts", "const b = 2;\n")];
    expect(deltaFiles(previous, next).map((file) => file.path)).toEqual(["b.ts"]);
  });
});

describe("risk", () => {
  const docs = [code("README.md", "# Hello\n", "# Hi\n")];
  const workflow = [code(".github/workflows/ci.yml", "name: ci\n")];

  it("sets the tier from the change, then the tier sets the depth", () => {
    expect(classifyRisk({ files: docs, author: "ada", authorTrusted: true })).toMatchObject({
      tier: "low",
      depth: "quick",
      humanApprovals: 0,
    });
    expect(classifyRisk({ files: workflow, author: "ada", authorTrusted: true })).toMatchObject({
      tier: "high",
      depth: "deep",
      humanApprovals: 2,
    });
  });

  it("does not let the author change the tier", () => {
    const trusted = classifyRisk({ files: docs, author: "ada", authorTrusted: true });
    const stranger = classifyRisk({ files: docs, author: "ada", authorTrusted: false });
    expect(trusted.tier).toBe(stranger.tier);
    expect(trusted.depth).toBe(stranger.depth);
    expect(stranger.humanApprovals).toBe(2);
    expect(stranger.extraHuman).toBe(true);
  });

  it("asks for another person when the diff deletes a test, without promoting the tier", () => {
    const files = [
      code(
        "src/drafts/title.test.ts",
        'test("keeps the id", () => {\n  expect(true).toBe(false);\n});\n',
        'test("keeps the title", () => {\n  expect(titleOf(draft)).toBe("Note");\n});\n',
      ),
    ];
    const risk = classifyRisk({ files, author: "ada", authorTrusted: true });
    expect(risk.tier).toBe("medium");
    expect(risk.depth).toBe("standard");
    expect(risk.extraHuman).toBe(true);
    expect(risk.humanApprovals).toBe(2);
  });

  it("uses the policy quorum sizes", () => {
    expect(defaultPolicy.quorum).toEqual({
      quick: { panel: 3, required: 2 },
      standard: { panel: 4, required: 3 },
      deep: { panel: 5, required: 4 },
    });
    expect(defaultPolicy.roundCap).toBe(3);
  });
});

describe("quorum", () => {
  it("keeps a finding only when enough voters agree, and drops cleanup first", async () => {
    const session = await openSession(
      exampleFixtures.find((item) => item.pr.id === "example-off-by-one")!.pr,
    );
    const round = session.rounds[0];
    expect(round.dropped.some((item) => item.candidate.bugClass === "todo-comment")).toBe(true);
    expect(session.findings.map((finding) => finding.bugClass)).toEqual(["off-by-one"]);
    const kept = session.findings[0];
    expect(kept.yesVotes).toBeGreaterThanOrEqual(kept.quorumRequired);
    expect(round.hunterIds).not.toEqual(expect.arrayContaining(round.voterIds));
  });

  it("votes down a comment that merely contains the word bug", async () => {
    const session = await openSession(
      exampleFixtures.find((item) => item.pr.id === "example-comment-only")!.pr,
    );
    expect(session.findings).toHaveLength(0);
    expect(session.rounds[0].rejected.some((item) => item.candidate.bugClass === "comment-mention")).toBe(
      true,
    );
    expect(session.status).toBe("clear");
  });

  it("runs hunters concurrently", async () => {
    let inFlight = 0;
    let max = 0;
    const hunters = ["a", "b", "c"].map((id) => ({
      id,
      name: id,
      expertCardId: null,
      async hunt() {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return [] as CandidateFinding[];
      },
    }));
    await runHunters(hunters, {
      depth: "quick",
      files: [],
      tree: [],
      treeComplete: true,
      activeCardIds: [],
    });
    expect(max).toBe(3);
  });

  it("keeps hunter ids and voter ids disjoint", () => {
    const hunters = new Set(allHunters.map((hunter) => hunter.id));
    for (const voter of allVoters) expect(hunters.has(voter.id)).toBe(false);
  });
});

describe("rounds and closure", () => {
  it("caps re-review at three rounds and reviews only the new lines after the first", async () => {
    const fixture = exampleFixtures.find((item) => item.pr.id === "example-round-cap")!;
    let session = await openSession(fixture.pr);
    expect(session.rounds[0].scope).toBe("full");
    expect(session.findings.map((finding) => finding.bugClass)).toEqual(["swallowed-error"]);

    session = await reviewRound(session, fixture.pr.followUps![0]);
    expect(session.rounds[1].scope).toBe("delta");
    expect(session.rounds[1].filesReviewed).toEqual(["src/billing/charge.ts"]);
    expect(session.findings.filter((finding) => finding.bugClass === "swallowed-error")[0].status).toBe(
      "fixed",
    );
    expect(session.findings.filter((finding) => finding.status === "open").map((finding) => finding.bugClass)).toEqual([
      "falsy-default",
    ]);

    session = await reviewRound(session, fixture.pr.followUps![1]);
    expect(session.rounds).toHaveLength(3);
    expect(session.findings.filter((finding) => finding.bugClass === "falsy-default")[0].status).toBe("fixed");
    expect(session.findings.filter((finding) => finding.status === "open").map((finding) => finding.bugClass)).toEqual([
      "off-by-one",
    ]);

    session = await reviewRound(session, fixture.pr.followUps![1]);
    expect(session.rounds).toHaveLength(3);
    expect(session.capped).toBe(true);
    expect(session.status).toBe("needs_author");
    expect(session.capNote).toMatch(/three rounds/i);
  });

  it("does not repeat a finding that is still present", async () => {
    const fixture = exampleFixtures.find((item) => item.pr.id === "example-off-by-one")!;
    let session = await openSession(fixture.pr);
    const again = fixture.pr.files[0].content ?? "";
    session = await reviewRound(session, {
      headSha: "again",
      repoPaths: fixture.pr.repoPaths,
      files: [{ ...fixture.pr.files[0], content: `${again}\nconst extra = 1;\n` }],
    });
    expect(session.findings.filter((finding) => finding.bugClass === "off-by-one")).toHaveLength(1);
  });

  it("requires a written reason, and blocks a clear desk while a finding is open", async () => {
    const fixture = exampleFixtures.find((item) => item.pr.id === "example-falsy-limit")!;
    const session = await openSession(fixture.pr);
    const finding = session.findings[0];
    expect(() => resolveFinding(session, finding.id, { kind: "closed", reason: "no" })).toThrow(/written reason/i);
    const closed = resolveFinding(session, finding.id, {
      kind: "closed",
      reason: "Upstream validation rejects 0, so this default only replaces undefined.",
    });
    expect(closed.findings[0].status).toBe("closed");
    expect(closed.findings[0].resolution?.reason.length).toBeGreaterThanOrEqual(12);
    expect(closed.status).toBe("clear");
    expect(mergeGate(session).ok).toBe(false);
    expect(mergeGate(closed).blockers.join(" ")).toMatch(/human approval/i);
  });
});

describe("eval set", () => {
  it("labels every seeded case as an example and not as draft-day history", () => {
    expect(exampleFixtures.length).toBeGreaterThanOrEqual(15);
    for (const item of exampleFixtures) {
      expect(item.pr.provenance).toBe("seeded-example");
      expect(item.pr.provenanceNote.toLowerCase()).toContain("seeded example");
      expect(item.pr.provenanceNote.toLowerCase()).toContain("not a pull request");
      expect(item.pr.repo).not.toBe("BoydVC/draft-day");
      expect(item.groundTruth).toBe(true);
    }
    const readme = exampleFixtures.find((item) => item.pr.id === "example-readme-links");
    expect(readme?.pr.inspiredBy).toMatch(/draft-day PR #12/i);
    expect(readme?.expected.map((bug) => bug.symbol)).toEqual([
      "examples/quickstart.ts",
      "examples/config.yml",
    ]);
  });

  it("scores the seeded bugs with full recall and no false alarms", async () => {
    const report = await scoreCases(exampleFixtures, { label: "unit" });
    const misses = report.results.filter((result) => result.falseNegatives > 0 || result.falsePositives > 0);
    expect(misses, JSON.stringify(misses, null, 2)).toEqual([]);
    expect(report.recall).toBe(1);
    expect(report.precision).toBe(1);
    expect(report.falseNegatives).toBe(0);
    expect(report.falsePositives).toBe(0);
  });

  it("gives every expert card a kept finding", async () => {
    const reportSessions = await Promise.all(exampleFixtures.map((item) => openSession(item.pr)));
    const used = new Set(reportSessions.flatMap((session) => session.findings.map((finding) => finding.expertCardId)));
    for (const card of expertCards) {
      expect(used.has(card.id), card.person).toBe(true);
    }
    const depths = new Set(reportSessions.map((session) => session.risk.depth));
    expect(depths).toEqual(new Set<ReviewDepth>(["quick", "standard", "deep"]));
  });

  it("matches findings by bug class, path, and symbol", () => {
    const scored = scoreFindings(
      [{ bugClass: "off-by-one", path: "a.ts", symbol: "items" }],
      [
        {
          id: "1",
          agentId: "bounds-hunter",
          expertCardId: "john-ousterhout",
          path: "a.ts",
          line: 2,
          symbol: "items",
          title: "Loop",
          body: "Past the end.",
          severity: "important",
          category: "bug",
          bugClass: "off-by-one",
          evidence: "i <= items.length",
          roundIntroduced: 1,
          votes: [],
          yesVotes: 0,
          panelSize: 0,
          quorumRequired: 0,
          status: "open",
        },
        {
          id: "2",
          agentId: "bounds-hunter",
          expertCardId: "john-ousterhout",
          path: "a.ts",
          line: 9,
          symbol: "limit",
          title: "Default",
          body: "Zero collapses.",
          severity: "important",
          category: "bug",
          bugClass: "falsy-default",
          evidence: "limit || 25",
          roundIntroduced: 1,
          votes: [],
          yesVotes: 0,
          panelSize: 0,
          quorumRequired: 0,
          status: "open",
        },
      ],
    );
    expect(scored.truePositives).toBe(1);
    expect(scored.falsePositives).toBe(1);
    expect(scored.falseNegatives).toBe(0);
    expect(scored.recall).toBe(1);
    expect(scored.precision).toBe(0.5);
  });
});

describe("importer", () => {
  it("rejects a fixture that is not labeled", () => {
    expect(() =>
      parseFixture({
        groundTruth: true,
        expected: [],
        pr: {
          id: "x",
          provenance: "seeded-example",
          provenanceNote: "looks real",
          repo: "BoydVC/draft-day",
          number: 12,
          title: "x",
          author: "a",
          authorTrusted: true,
          baseSha: "a",
          headSha: "b",
          files: [],
        },
      }),
    ).toThrow(/seeded example/i);
  });

  it("turns a GitHub 404 into an access error and does not invent a diff", async () => {
    const client = githubClient(undefined, async () => new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
    await expect(importGithubPulls(client, { owner: "BoydVC", repo: "draft-day", from: 12, to: 12 })).rejects.toBeInstanceOf(
      GithubAccessError,
    );
  });

  it("imports a pull request payload without marking it as ground truth", async () => {
    const pull = {
      number: 4,
      title: "Add a parser",
      body: "Real history would land here.",
      user: { login: "octocat" },
      head: { sha: "abc" },
      base: { sha: "def" },
    };
    const client = {
      async get(pathname: string) {
        if (pathname.endsWith("/pulls/4")) return pull;
        if (pathname.includes("/pulls/4/files")) {
          return [
            {
              filename: "src/parse.ts",
              status: "added",
              patch: "@@ -0,0 +1,2 @@\n+export function parseDraft() {\n+  return 1;\n+",
            },
          ];
        }
        if (pathname.includes("/git/trees/")) return { tree: [{ path: "src/parse.ts", type: "blob" }] };
        if (pathname.includes("/contents/")) {
          return {
            encoding: "base64",
            size: 40,
            content: Buffer.from("export function parseDraft() {\n  return 1;\n}\n").toString("base64"),
          };
        }
        throw new Error(pathname);
      },
    };
    const [imported] = await importGithubPulls(client, { owner: "BoydVC", repo: "draft-day", from: 4, to: 4 });
    expect(imported.groundTruth).toBe(false);
    expect(imported.expected).toEqual([]);
    expect(imported.pr.provenance).toBe("github");
    expect(imported.pr.provenanceNote).toMatch(/Imported from GitHub/);
    expect(imported.pr.files[0].content).toMatch(/parseDraft/);
    expect(imported.pr.repo).toBe("BoydVC/draft-day");
  });
});

describe("demo desk", () => {
  it("builds a desk where every seeded resolution has a written reason", async () => {
    const sessions = await buildDemoSessions();
    const cap = sessions.find((session) => session.id === "example-round-cap");
    expect(cap?.rounds).toHaveLength(3);
    expect(cap?.status).toBe("needs_author");
    expect(cap?.capped).toBe(true);
    const closed = sessions.flatMap((session) => session.findings).filter((finding) => finding.status === "closed");
    const fixed = sessions.flatMap((session) => session.findings).filter((finding) => finding.status === "fixed");
    expect(closed.length).toBeGreaterThan(0);
    expect(fixed.length).toBeGreaterThan(0);
    for (const finding of [...closed, ...fixed]) {
      expect(finding.resolution?.reason.trim().length).toBeGreaterThanOrEqual(12);
    }
  });
});
