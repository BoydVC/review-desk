import type { ReviewDepth } from "./types";

export interface QuorumRule {
  panel: number;
  required: number;
}

export interface RepoPolicy {
  sensitivePathFragments: string[];
  trustedAuthors: string[];
  roundCap: number;
  quorum: Record<ReviewDepth, QuorumRule>;
  bigDiffLines: number;
}

export const ROUND_CAP = 3;

export const defaultPolicy: RepoPolicy = {
  sensitivePathFragments: [
    ".github/workflows",
    "auth",
    "billing",
    "payments",
    "payment",
    "secrets",
  ],
  trustedAuthors: [],
  roundCap: ROUND_CAP,
  quorum: {
    quick: { panel: 3, required: 2 },
    standard: { panel: 4, required: 3 },
    deep: { panel: 5, required: 4 },
  },
  bigDiffLines: 800,
};

export function depthForTier(tier: "low" | "medium" | "high"): ReviewDepth {
  if (tier === "high") return "deep";
  if (tier === "medium") return "standard";
  return "quick";
}

export function pathIsSensitive(path: string, fragments: string[]): boolean {
  const normalized = path.replace(/^\/+/, "");
  return fragments.some((fragment) => {
    const clean = fragment.replace(/^\/+|\/+$/g, "");
    if (clean.includes("/")) return normalized.includes(clean);
    const segments = normalized.split("/");
    return segments.some((segment, index) => {
      if (index === segments.length - 1) {
        const stem = segment.replace(/\.[^.]+$/, "");
        return stem === clean;
      }
      return segment === clean;
    });
  });
}
