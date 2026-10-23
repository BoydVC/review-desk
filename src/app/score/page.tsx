import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { rescoreAction } from "@/app/score/actions";
import { getDesk } from "@/lib/desk";

export default function ScorePage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Scoring the seeded examples…</p>}>
      <ScoreBody />
    </Suspense>
  );
}

async function ScoreBody() {
  const store = await getDesk();
  const report = store.scores[0];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <p className="text-sm uppercase tracking-[0.16em] text-muted-foreground">Nightly score</p>
        <h1 className="max-w-3xl text-4xl leading-tight">Known bugs, caught or missed.</h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground">
          The score is separate from the desk counts. Recall is the share of confirmed bugs the quorum kept.
          Precision is the share of kept findings that match a confirmed bug. A seeded example is ground truth.
          A GitHub import is not, until a person adds the expected bugs.
        </p>
      </section>

      {report ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric value={pct(report.recall)} label="Recall" detail={`${report.truePositives} caught, ${report.falseNegatives} missed.`} />
            <Metric value={pct(report.precision)} label="Precision" detail={`${report.falsePositives} unexpected findings.`} />
            <Metric value={pct(report.falseAlarmRate)} label="False alarm rate" detail="Unexpected kept findings over all kept findings." />
            <Metric value={String(report.cases)} label="Cases" detail={report.label} />
          </section>
          <p className="text-sm text-muted-foreground">Last run {report.ranAt}.</p>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Case</th>
                  <th className="px-3 py-2 font-medium">Recall</th>
                  <th className="px-3 py-2 font-medium">Precision</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((result) => (
                  <tr key={result.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <p className="font-medium">{result.title}</p>
                      <p className="text-xs text-muted-foreground">{result.id}</p>
                    </td>
                    <td className="px-3 py-2">{pct(result.recall)}</td>
                    <td className="px-3 py-2">{pct(result.precision)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {result.missed.length === 0 && result.unexpected.length === 0
                        ? "Matched."
                        : [
                            ...result.missed.map((bug) => `missed ${bug.bugClass}`),
                            ...result.unexpected.map((bug) => `unexpected ${bug.bugClass}`),
                          ].join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>No score yet. Run the nightly command, then come back.</p>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 text-sm leading-6">
        <h2 className="font-heading text-2xl">Run it</h2>
        <p>From the repo root:</p>
        <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">npm run score:nightly</pre>
        <p className="text-muted-foreground">
          A cron entry is the nightly half. The command writes data/scores/YYYY-MM-DD.json and exits non-zero if
          recall or precision on the ground-truth set drops below 1.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">
          15 2 * * * cd /path/to/review-desk && npm run score:nightly
        </pre>
        <form action={rescoreAction}>
          <Button type="submit">Run the score now</Button>
        </form>
      </section>
    </div>
  );
}

function Metric({ value, label, detail }: { value: string; label: string; detail: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="font-heading text-3xl">{value}</p>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}
