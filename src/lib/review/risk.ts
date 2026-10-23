import { changedLineCount } from "./diff";
import { defaultPolicy, depthForTier, pathIsSensitive, type RepoPolicy } from "./policy";
import type { ChangeFile, PullRequest, RiskAssessment, RiskTier } from "./types";
import { isDocsPath, isTestPath } from "./text";

export interface RiskInput {
  files: ChangeFile[];
  author: string;
  authorTrusted: boolean;
}

const LIVE_SECRET = /sk-live-|sk-ant-|ghp_|github_pat_|AKIA[0-9A-Z]{16}|xox[baprs]-/;

function removedTest(file: ChangeFile): boolean {
  if (!isTestPath(file.path)) return false;
  const previous = file.previousContent ?? "";
  const next = file.content ?? "";
  const names = (source: string) =>
    [...source.matchAll(/(?:it|test)\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
  const kept = new Set(names(next));
  return names(previous).some((name) => !kept.has(name));
}

export function classifyRisk(input: RiskInput, policy: RepoPolicy = defaultPolicy): RiskAssessment {
  const reasons: string[] = [];
  let tier: RiskTier = "low";
  const files = input.files.filter((file) => file.status !== "deleted" || file.previousContent);
  const docsOnly =
    files.length > 0 &&
    files.every((file) => isDocsPath(file.path) || file.path.endsWith(".json") && file.path.includes("copy"));

  if (docsOnly) {
    tier = "low";
    reasons.push("Every changed file is documentation or static copy.");
  } else if (files.length === 0) {
    tier = "low";
    reasons.push("The diff is empty.");
  } else {
    tier = "medium";
    reasons.push("The diff changes code, config, or other non-doc files.");
  }

  for (const file of files) {
    if (pathIsSensitive(file.path, policy.sensitivePathFragments)) {
      tier = "high";
      reasons.push(`${file.path} is on a sensitive path.`);
    }
    const added = `${file.content ?? ""}\n${file.patch ?? ""}`;
    if (/pull_request_target/.test(added) && file.path.includes(".github/workflows")) {
      tier = "high";
      reasons.push(`${file.path} uses pull_request_target.`);
    }
    if (LIVE_SECRET.test(file.content ?? "") || LIVE_SECRET.test(file.patch ?? "")) {
      tier = "high";
      reasons.push(`${file.path} contains a live-credential pattern.`);
    }
  }

  const trusted =
    input.authorTrusted || policy.trustedAuthors.includes(input.author);
  const extraHumanReasons: string[] = [];
  if (!trusted) {
    extraHumanReasons.push(
      "The author is not on the trusted list, so the lighter approval path stays closed.",
    );
  }
  if (files.some(removedTest)) {
    extraHumanReasons.push("The diff removes a test.");
  }
  const volume = files.reduce((sum, file) => sum + changedLineCount(file), 0);
  if (volume > policy.bigDiffLines) {
    extraHumanReasons.push(`The diff is ${volume} lines, over the ${policy.bigDiffLines}-line mark.`);
  }

  const baseHumans = tier === "low" ? 0 : tier === "medium" ? 1 : 2;
  let humanApprovals = baseHumans;
  if (!trusted) humanApprovals = Math.max(humanApprovals, 2);
  if (files.some(removedTest)) humanApprovals += 1;
  if (volume > policy.bigDiffLines) humanApprovals += 1;

  return {
    tier,
    depth: depthForTier(tier),
    reasons,
    humanApprovals,
    extraHuman: extraHumanReasons.length > 0,
    extraHumanReasons,
    trustedAuthor: trusted,
  };
}

export function classifyPullRequest(pr: PullRequest, policy?: RepoPolicy): RiskAssessment {
  return classifyRisk(
    { files: pr.files, author: pr.author, authorTrusted: pr.authorTrusted },
    policy,
  );
}
