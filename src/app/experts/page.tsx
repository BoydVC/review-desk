import { expertCards } from "@/lib/review/experts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ExpertsPage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <p className="text-sm uppercase tracking-[0.16em] text-muted-foreground">Expert cards</p>
        <h1 className="max-w-3xl text-4xl leading-tight">Lenses borrowed from published work.</h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground">
          Each card is a way of reading a diff. The principle is quoted or marked as a paraphrase, and the checks
          underneath are Review Desk&apos;s operational reading of that work. They are not a claim that the author
          wrote these regexes. Depth decides which cards are in the room.
        </p>
      </section>
      <ul className="flex flex-col gap-4">
        {expertCards.map((card) => (
          <li key={card.id} id={card.id}>
            <Card>
              <CardHeader>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{card.lens}</p>
                <CardTitle className="text-2xl">{card.person}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm leading-6">
                <blockquote className="border-l-2 border-foreground/30 pl-4 text-base leading-7">
                  {card.principleKind === "quote" ? `“${card.principle}”` : card.principle}
                </blockquote>
                <p className="text-muted-foreground">
                  {card.principleKind === "quote" ? "Quoted." : "Paraphrase of the cited work, not a quotation."}
                </p>
                <ul className="flex flex-col gap-2">
                  {card.citations.map((citation) => (
                    <li key={`${citation.title}-${citation.authors}`}>
                      {citation.url ? (
                        <a href={citation.url} className="underline">
                          {citation.title}
                        </a>
                      ) : (
                        <span className="font-medium">{citation.title}</span>
                      )}
                      {". "}
                      {citation.authors}
                      {citation.year ? `, ${citation.year}` : ""}. {citation.outlet}.
                      {citation.locator ? ` ${citation.locator}` : ""}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {card.depths.map((depth) => (
                    <Badge key={depth} variant="secondary">
                      {depth}
                    </Badge>
                  ))}
                </div>
                <ul className="flex flex-col gap-2">
                  {card.checks.map((check) => (
                    <li key={check.bugClass}>
                      <span className="font-medium">{check.bugClass}</span>
                      <span className="text-muted-foreground"> · {check.summary}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
