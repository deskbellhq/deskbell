import { Badge } from "@deskbell/ui/components/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@deskbell/ui/components/card";
import Link from "next/link";

export interface OverviewStats {
  conversations: number;
  conversations7d: number;
  /** Threads that are uncertain, marked down, or asked for a person or pushed back (spec: attention-inbox). */
  attention: number;
  questions: number;
  questions7d: number;
  /**
   * Certain answers ÷ all assistant answers, 0–100; null before the first
   * answer. Certain as the thread badge means it: neither refused nor
   * weakly grounded, so the rate and the chart under it count the same thing.
   */
  answerRate: number | null;
  /** Open gap clusters with activity in the last 30 days — what the gaps page lists by default. */
  gaps: number;
  feedbackUp: number;
  feedbackDown: number;
}

export function SectionCards({ stats }: { stats: OverviewStats }) {
  const votes = stats.feedbackUp + stats.feedbackDown;
  const positive = votes > 0 ? Math.round((stats.feedbackUp / votes) * 100) : null;
  const cards = [
    {
      label: "Conversations",
      value: String(stats.conversations),
      badge: `${stats.attention} need${stats.attention === 1 ? "s" : ""} attention`,
      // A door, like the gaps count: the inbox lists what asks to be read.
      href: "/conversations?view=attention",
      headline: "Threads started by visitors",
      detail: `+${stats.conversations7d} this week · uncertain, marked down, or asking for a person`,
    },
    {
      label: "Questions asked",
      value: String(stats.questions),
      badge: `+${stats.questions7d} this week`,
      headline: "Everything visitors asked",
      detail: "Across all conversations",
    },
    {
      label: "Answer rate",
      value: stats.answerRate === null ? "—" : `${stats.answerRate}%`,
      badge: `${stats.gaps} open ${stats.gaps === 1 ? "gap" : "gaps"} · 30 days`,
      // The count is a door, not a number: the gaps page lists the questions.
      href: "/gaps",
      headline: "Share of answers that were certain",
      detail: "The rest refused or answered from weak grounding: gaps to close in the docs",
    },
    {
      label: "Positive feedback",
      value: positive === null ? "—" : `${positive}%`,
      badge: `${votes} ${votes === 1 ? "vote" : "votes"}`,
      headline: "Thumbs from the widget",
      detail: votes === 0 ? "No answers rated yet" : "Share of thumbs-up among rated answers",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="@container/card">
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.value}
            </CardTitle>
            <CardAction>
              {"href" in card && card.href ? (
                <Badge variant="outline" asChild>
                  <Link href={card.href}>{card.badge}</Link>
                </Badge>
              ) : (
                <Badge variant="outline">{card.badge}</Badge>
              )}
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">{card.headline}</div>
            <div className="text-muted-foreground">{card.detail}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
