import type { CandidateFinding, ReviewedFile, Vote } from "./types";
import type { ReviewDepth } from "./types";
import { isMarkdown, lineIsCodeComment } from "./text";
import type { QuorumRule } from "./policy";

export interface VoteContext {
  depth: ReviewDepth;
  files: ReviewedFile[];
}

export interface Voter {
  id: string;
  name: string;
  vote(finding: CandidateFinding, ctx: VoteContext): Promise<Vote>;
}

function yes(voter: Voter, reason: string): Vote {
  return { voterId: voter.id, real: true, reason };
}

function no(voter: Voter, reason: string): Vote {
  return { voterId: voter.id, real: false, reason };
}

function changedLines(file: ReviewedFile | undefined) {
  if (!file) return [];
  return [...file.added, ...file.removed];
}

function citedLine(finding: CandidateFinding, ctx: VoteContext) {
  const file = ctx.files.find((item) => item.path === finding.path);
  const lines = changedLines(file);
  const line =
    lines.find((item) => item.line === finding.line && item.text.includes(finding.evidence)) ??
    lines.find((item) => item.line === finding.line);
  return { file, line };
}

function proseOrComment(finding: CandidateFinding, ctx: VoteContext): string | null {
  if (finding.category === "docs") return null;
  const { file, line } = citedLine(finding, ctx);
  if (!file) return null;
  if (isMarkdown(file.path)) return "The quote is in a markdown file, and this finding is not about the document.";
  if (line && lineIsCodeComment(line.text, file.path)) {
    return "The quote is a comment, not an executable line.";
  }
  return null;
}

export const evidenceVoter: Voter = {
  id: "evidence-voter",
  name: "Evidence",
  async vote(finding, ctx) {
    const excuse = proseOrComment(finding, ctx);
    if (excuse) return no(evidenceVoter, excuse);
    const file = ctx.files.find((item) => item.path === finding.path);
    if (!file) return no(evidenceVoter, "That path is not in this round's scope.");
    const haystack = changedLines(file).map((line) => line.text).join("\n");
    if (!finding.evidence || !haystack.includes(finding.evidence)) {
      return no(evidenceVoter, "The evidence quote is not on a line this round changed.");
    }
    return yes(evidenceVoter, "The evidence quote appears on a changed line.");
  },
};

export const introducedVoter: Voter = {
  id: "introduced-voter",
  name: "Introduced here",
  async vote(finding, ctx) {
    const excuse = proseOrComment(finding, ctx);
    if (excuse) return no(introducedVoter, excuse);
    const { line } = citedLine(finding, ctx);
    if (!line) return no(introducedVoter, "The cited line was not added or removed in this round.");
    if (finding.evidence && !line.text.includes(finding.evidence)) {
      return no(introducedVoter, "The cited line does not contain the evidence quote.");
    }
    return yes(introducedVoter, "The finding points at a line this round introduced.");
  },
};

const DROPPED = new Set(["style", "diagnostics", "cleanup"]);

export const actionableVoter: Voter = {
  id: "actionable-voter",
  name: "Actionable",
  async vote(finding, ctx) {
    if (DROPPED.has(finding.category)) {
      return no(actionableVoter, "Style, diagnostics, and cleanup do not get a vote.");
    }
    const excuse = proseOrComment(finding, ctx);
    if (excuse) return no(actionableVoter, excuse);
    return yes(actionableVoter, "The finding is a behavior, contract, security, or docs claim.");
  },
};

export const specificityVoter: Voter = {
  id: "specificity-voter",
  name: "Specificity",
  async vote(finding) {
    if (!finding.path || !finding.bugClass || !finding.symbol) {
      return no(specificityVoter, "The finding is missing a path, a bug class, or a symbol.");
    }
    if (finding.evidence.trim().length < 8) {
      return no(specificityVoter, "The evidence quote is too thin to accept.");
    }
    if (/\b(maybe|might want|consider renaming|nit:)\b/i.test(finding.title)) {
      return no(specificityVoter, "The title is hedged.");
    }
    return yes(specificityVoter, "The finding names a file, a symbol, and a quote.");
  },
};

export const reachabilityVoter: Voter = {
  id: "reachability-voter",
  name: "Reachability",
  async vote(finding, ctx) {
    if (finding.category === "docs") {
      if (!isMarkdown(finding.path)) {
        return no(reachabilityVoter, "A docs finding has to land on a document.");
      }
      return yes(reachabilityVoter, "The claim is about a document in this diff.");
    }
    const excuse = proseOrComment(finding, ctx);
    if (excuse) return no(reachabilityVoter, excuse);
    return yes(reachabilityVoter, "The cited line is executable code in this change.");
  },
};

export const allVoters: Voter[] = [
  evidenceVoter,
  introducedVoter,
  actionableVoter,
  specificityVoter,
  reachabilityVoter,
];

export function votersFor(rule: QuorumRule): Voter[] {
  return allVoters.slice(0, rule.panel);
}

export async function voteOn(
  voters: Voter[],
  candidate: CandidateFinding,
  ctx: VoteContext,
): Promise<Vote[]> {
  return Promise.all(voters.map((voter) => voter.vote(candidate, ctx)));
}
