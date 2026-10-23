import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import type { Provenance, ReviewDepth, RiskTier, SessionStatus } from "@/lib/review/types";

export function TierBadge({ tier }: { tier: RiskTier }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "uppercase tracking-wide",
        tier === "high" && "border-destructive/40 bg-destructive/10 text-destructive",
        tier === "medium" && "border-amber-800/30 bg-amber-800/10 text-amber-900",
        tier === "low" && "border-emerald-800/30 bg-emerald-800/10 text-emerald-900",
      )}
    >
      {tier} risk
    </Badge>
  );
}

export function DepthBadge({ depth }: { depth: ReviewDepth }) {
  return (
    <Badge variant="secondary" className="uppercase tracking-wide">
      {depth}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const label =
    status === "clear" ? "Desk clear" : status === "needs_author" ? "Round cap" : "Findings open";
  return (
    <Badge
      variant={status === "blocked" ? "destructive" : "outline"}
      className={cn(status === "needs_author" && "border-amber-800/40 text-amber-950")}
    >
      {label}
    </Badge>
  );
}

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const label =
    provenance === "seeded-example"
      ? "Seeded example"
      : provenance === "github"
        ? "Imported from GitHub"
        : "Imported fixture";
  return <Badge variant="outline">{label}</Badge>;
}

export function RoundPips({ rounds }: { rounds: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${rounds} of 3 rounds`}>
      {[1, 2, 3].map((pip) => (
        <span
          key={pip}
          className={cn("size-1.5 rounded-full", pip <= rounds ? "bg-foreground" : "bg-border")}
        />
      ))}
      <span className="ml-1 text-muted-foreground">
        {rounds} round{rounds === 1 ? "" : "s"}
      </span>
    </span>
  );
}
