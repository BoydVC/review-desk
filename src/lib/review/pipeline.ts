import { applySparse, deltaFiles, reviewFile } from "./diff";
import { cardsForDepth } from "./experts";
import { exportedNames, huntersFor, type HuntContext, type ReviewAgent } from "./hunters";
import { defaultPolicy, type RepoPolicy } from "./policy";
import { classifyRisk } from "./risk";
import type {
  CandidateFinding,
  ChangeFile,
  Finding,
  PullRequest,
  ReviewRound,
  ReviewSession,
  Snapshot,
} from "./types";
import { testPathsFor } from "./text";
import { voteOn, votersFor, type Voter } from "./voters";

const DROPPED_CATEGORIES = new Set(["style", "diagnostics", "cleanup"]);

export interface PipelineOptions {
  policy?: RepoPolicy;
  hunters?: ReviewAgent[];
  voters?: Voter[];
}

export async function runHunters(
  hunters: ReviewAgent[],
  ctx: HuntContext,
): Promise<CandidateFinding[]> {
  const groups = await Promise.all(hunters.map((hunter) => hunter.hunt(ctx)));
  return groups.flat();
}

export function fingerprint(finding: Pick<CandidateFinding, "bugClass" | "path" | "symbol" | "evidence">): string {
  return `${finding.bugClass}|${finding.path}|${finding.symbol}|${finding.evidence.trim()}`;
}

export async function openSession(
  pr: PullRequest,
  options?: PipelineOptions,
): Promise<ReviewSession> {
  const session: ReviewSession = {
    id: pr.id,
    pr,
    risk: classifyRisk(
      { files: pr.files, author: pr.author, authorTrusted: pr.authorTrusted },
      options?.policy ?? defaultPolicy,
    ),
    rounds: [],
    findings: [],
    status: "clear",
    capped: false,
    currentHeadSha: pr.baseSha,
    lastSnapshot: { headSha: pr.baseSha, files: [], repoPaths: pr.repoPaths },
  };
  return reviewRound(
    session,
    { headSha: pr.headSha, files: pr.files, repoPaths: pr.repoPaths },
    options,
  );
}

export async function reviewRound(
  session: ReviewSession,
  snapshot: Snapshot,
  options?: PipelineOptions,
): Promise<ReviewSession> {
  const policy = options?.policy ?? defaultPolicy;
  if (session.rounds.length >= policy.roundCap) {
    const capNote =
      "After three rounds, Review Desk stops. Step back and reconsider the approach. A further pass would mostly re-read code the desk has already seen.";
    const open = session.findings.some((finding) => finding.status === "open");
    return {
      ...session,
      capped: true,
      capNote,
      status: open ? "needs_author" : "clear",
    };
  }

  const fullScope = session.rounds.length === 0;
  const mergedFiles = fullScope ? snapshot.files : applySparse(session.lastSnapshot.files, snapshot.files);
  const scoped = fullScope ? snapshot.files : deltaFiles(session.lastSnapshot.files, mergedFiles);
  const reviewed = scoped.map(reviewFile).filter((file) => file.added.length > 0 || file.removed.length > 0);
  const tree = [
    ...new Set([
      ...snapshot.repoPaths,
      ...session.pr.repoPaths,
      ...mergedFiles.map((file) => file.path),
      ...(session.pr.contextFiles ?? []).map((file) => file.path),
    ]),
  ];
  const risk = classifyRisk(
    { files: mergedFiles, author: session.pr.author, authorTrusted: session.pr.authorTrusted },
    policy,
  );
  const cards = cardsForDepth(risk.depth);
  const hunters = options?.hunters ?? huntersFor(risk.depth, cards);
  const rule = policy.quorum[risk.depth];
  const voters = options?.voters ?? votersFor(rule);
  const roundNumber = session.rounds.length + 1;
  const packageJson = readPackageJson(session.pr, mergedFiles);

  const ctx: HuntContext = {
    depth: risk.depth,
    files: reviewed,
    tree,
    packageJson,
    treeComplete: session.pr.treeComplete !== false,
    activeCardIds: cards.map((card) => card.id),
  };
  const candidates = await runHunters(hunters, ctx);
  const dropped = candidates
    .filter((candidate) => DROPPED_CATEGORIES.has(candidate.category))
    .map((candidate) => ({
      candidate,
      reason: "Style, diagnostics, and cleanup findings are dropped before the vote.",
    }));
  const keptSoFar = new Set(session.findings.map(fingerprint));
  const rejected = [];
  const kept: Finding[] = [];

  for (const candidate of candidates) {
    if (DROPPED_CATEGORIES.has(candidate.category)) continue;
    if (keptSoFar.has(fingerprint(candidate))) continue;
    const votes = await voteOn(voters, candidate, { depth: risk.depth, files: reviewed });
    const yesVotes = votes.filter((vote) => vote.real).length;
    if (yesVotes < rule.required) {
      rejected.push({ candidate, votes, yesVotes, quorumRequired: rule.required });
      continue;
    }
    const id = findingId(roundNumber, candidate);
    keptSoFar.add(fingerprint(candidate));
    kept.push({
      ...candidate,
      id,
      roundIntroduced: roundNumber,
      votes,
      yesVotes,
      panelSize: voters.length,
      quorumRequired: rule.required,
      status: "open",
    });
  }

  const prior = session.findings.map((finding) => {
    if (finding.status !== "open" || finding.roundIntroduced === roundNumber) return finding;
    if (!clearedBySnapshot(finding, mergedFiles, tree, packageJson)) return finding;
    return {
      ...finding,
      status: "fixed" as const,
      resolution: {
        kind: "fixed" as const,
        reason: "Cleared on re-review: the cited problem is no longer in the changed tree.",
        round: roundNumber,
        source: "re-review" as const,
      },
    };
  });

  const round: ReviewRound = {
    round: roundNumber,
    scope: fullScope ? "full" : "delta",
    depth: risk.depth,
    riskTier: risk.tier,
    headSha: snapshot.headSha,
    filesReviewed: reviewed.map((file) => file.path),
    hunterIds: hunters.map((hunter) => hunter.id),
    voterIds: voters.map((voter) => voter.id),
    candidates: candidates.length,
    dropped,
    rejected,
    kept: kept.length,
  };

  const next: ReviewSession = {
    ...session,
    risk,
    rounds: [...session.rounds, round],
    findings: [...prior, ...kept],
    currentHeadSha: snapshot.headSha,
    lastSnapshot: { headSha: snapshot.headSha, files: mergedFiles, repoPaths: tree },
    capped: false,
  };
  return { ...next, status: statusOf(next) };
}

export async function reviewFollowUps(
  pr: PullRequest,
  options?: PipelineOptions,
): Promise<ReviewSession> {
  let session = await openSession(pr, options);
  for (const followUp of pr.followUps ?? []) {
    session = await reviewRound(session, followUp, options);
  }
  return session;
}

export function resolveFinding(
  session: ReviewSession,
  findingId: string,
  decision: { kind: "fixed" | "closed"; reason: string },
): ReviewSession {
  if (decision.kind !== "fixed" && decision.kind !== "closed") {
    throw new Error("A finding can only be fixed or closed.");
  }
  const reason = decision.reason.trim();
  if (reason.length < 12) {
    throw new Error("A written reason is required (at least 12 characters).");
  }
  const existing = session.findings.find((finding) => finding.id === findingId);
  if (!existing) throw new Error(`No finding ${findingId}.`);
  if (existing.status !== "open") throw new Error("That finding is already resolved.");
  const findings = session.findings.map((finding) =>
    finding.id === findingId
      ? {
          ...finding,
          status: decision.kind,
          resolution: {
            kind: decision.kind,
            reason,
            round: session.rounds.length,
            source: "author" as const,
          },
        }
      : finding,
  );
  const next = { ...session, findings };
  return { ...next, status: statusOf(next) };
}

export function mergeGate(session: ReviewSession): { ok: boolean; blockers: string[] } {
  const blockers: string[] = [];
  const open = session.findings.filter((finding) => finding.status === "open");
  if (open.length > 0) {
    const noun = open.length === 1 ? "finding" : "findings";
    blockers.push(`${open.length} ${noun} still open. Fix each one, or close it with a written reason.`);
  }
  if (session.status === "needs_author" && session.capNote) blockers.push(session.capNote);
  if (session.risk.humanApprovals > 0) {
    const noun = session.risk.humanApprovals === 1 ? "approval" : "approvals";
    blockers.push(
      `${session.risk.humanApprovals} human ${noun} still required. An agent approval does not count.`,
    );
  }
  return { ok: blockers.length === 0, blockers };
}

export function statusOf(session: Pick<ReviewSession, "findings" | "capped" | "status">): ReviewSession["status"] {
  const open = session.findings.some((finding) => finding.status === "open");
  if (session.capped && open) return "needs_author";
  return open ? "blocked" : "clear";
}

function findingId(round: number, candidate: CandidateFinding): string {
  const raw = `${round}-${candidate.bugClass}-${candidate.path}-${candidate.symbol}-${candidate.line}`;
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function readPackageJson(pr: PullRequest, files: ChangeFile[]): string | undefined {
  const changed = files.find((file) => file.path === "package.json" || file.path.endsWith("/package.json"));
  if (changed?.content) return changed.content;
  return pr.contextFiles?.find((file) => file.path === "package.json" || file.path.endsWith("/package.json"))
    ?.content;
}

function clearedBySnapshot(
  finding: Finding,
  files: ChangeFile[],
  tree: string[],
  packageJson: string | undefined,
): boolean {
  const file = files.find((item) => item.path === finding.path);
  const content = file?.content ?? "";
  const evidenceGone = !content.includes(finding.evidence.trim());
  switch (finding.bugClass) {
    case "removed-export":
      return files.some((item) => exportedNames(item.content ?? "").has(finding.symbol));
    case "test-deleted":
      return content.includes(finding.symbol);
    case "docs-missing-target":
      return evidenceGone || tree.includes(finding.symbol);
    case "docs-unknown-script":
      if (evidenceGone) return true;
      if (!packageJson) return false;
      try {
        const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> };
        return Boolean(parsed.scripts && finding.symbol in parsed.scripts);
      } catch {
        return false;
      }
    case "untested-behavior":
      return evidenceGone || testPathsFor(finding.path).some((path) => tree.includes(path));
    default:
      return !file || evidenceGone;
  }
}
