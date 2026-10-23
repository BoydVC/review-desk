export type RiskTier = "low" | "medium" | "high";
export type ReviewDepth = "quick" | "standard" | "deep";
export type FindingStatus = "fixed" | "closed" | "open";
export type FindingCategory =
  | "bug"
  | "security"
  | "compat"
  | "reliability"
  | "tests"
  | "docs"
  | "style"
  | "diagnostics"
  | "cleanup";

export type Provenance = "seeded-example" | "github" | "imported";

export interface ChangeFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  previousContent?: string;
  content?: string;
  patch?: string;
  /** Content was rebuilt from hunks, not the whole file. Added and removed lines come from the patch. */
  partial?: boolean;
}

export interface ContextFile {
  path: string;
  content: string;
}

export interface Snapshot {
  headSha: string;
  files: ChangeFile[];
  repoPaths: string[];
}

export interface PullRequest {
  id: string;
  provenance: Provenance;
  provenanceNote: string;
  inspiredBy?: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  authorTrusted: boolean;
  baseSha: string;
  headSha: string;
  files: ChangeFile[];
  repoPaths: string[];
  contextFiles?: ContextFile[];
  /** False when repoPaths lists only files in the diff, not the repository tree. */
  treeComplete?: boolean;
  /** Sparse follow-up snapshots. Each lists only files that changed since the previous head. */
  followUps?: Snapshot[];
}

export interface CandidateFinding {
  agentId: string;
  expertCardId: string | null;
  path: string;
  line: number;
  symbol: string;
  title: string;
  body: string;
  severity: "important" | "nit" | "pre-existing";
  category: FindingCategory;
  bugClass: string;
  evidence: string;
}

export interface Vote {
  voterId: string;
  real: boolean;
  reason: string;
}

export interface Finding extends CandidateFinding {
  id: string;
  roundIntroduced: number;
  votes: Vote[];
  yesVotes: number;
  panelSize: number;
  quorumRequired: number;
  status: FindingStatus;
  resolution?: {
    kind: "fixed" | "closed";
    reason: string;
    round: number;
    source: "re-review" | "author";
  };
}

export interface RejectedFinding {
  candidate: CandidateFinding;
  votes: Vote[];
  yesVotes: number;
  quorumRequired: number;
}

export interface DroppedCandidate {
  candidate: CandidateFinding;
  reason: string;
}

export interface ReviewRound {
  round: number;
  scope: "full" | "delta";
  depth: ReviewDepth;
  riskTier: RiskTier;
  headSha: string;
  filesReviewed: string[];
  hunterIds: string[];
  voterIds: string[];
  candidates: number;
  dropped: DroppedCandidate[];
  rejected: RejectedFinding[];
  kept: number;
}

export interface RiskAssessment {
  tier: RiskTier;
  depth: ReviewDepth;
  reasons: string[];
  humanApprovals: number;
  extraHuman: boolean;
  extraHumanReasons: string[];
  trustedAuthor: boolean;
}

export type SessionStatus = "blocked" | "clear" | "needs_author";

export interface ReviewSession {
  id: string;
  pr: PullRequest;
  risk: RiskAssessment;
  rounds: ReviewRound[];
  findings: Finding[];
  status: SessionStatus;
  capped: boolean;
  capNote?: string;
  currentHeadSha: string;
  lastSnapshot: Snapshot;
}

export interface ExpectedBug {
  bugClass: string;
  path: string;
  symbol: string;
}

export interface EvalCase {
  pr: PullRequest;
  groundTruth: boolean;
  expected: ExpectedBug[];
  shouldNotFlag?: Array<{ bugClass: string; path: string }>;
}

export interface LineChange {
  line: number;
  text: string;
}

export interface ReviewedFile {
  path: string;
  status: ChangeFile["status"];
  content: string;
  previousContent: string;
  added: LineChange[];
  removed: LineChange[];
}
