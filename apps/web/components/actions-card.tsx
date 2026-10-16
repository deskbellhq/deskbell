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

/**
 * Actions on the Overview (spec: actions-ia): shown only once a tool has
 * run this week, because an empty card is noise on a project without
 * servers. Failures link to the log narrowed to them.
 */
export function ActionsCard({ calls, failed }: { calls: number; failed: number }) {
  if (calls === 0) return null;
  return (
    <div className="px-4 lg:px-6">
      <Card className="@container/card" data-testid="actions-card">
        <CardHeader>
          <CardDescription>Actions this week</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {calls}
          </CardTitle>
          <CardAction>
            <Badge variant={failed > 0 ? "destructive" : "outline"} asChild>
              <Link
                href={
                  failed > 0 ? "/actions/log?period=7d&status=failed" : "/actions/log?period=7d"
                }
              >
                {failed > 0 ? `${failed} failed` : "none failed"}
              </Link>
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Tool calls on visitors' behalf</div>
          <div className="text-muted-foreground">
            <Link href="/actions" className="underline-offset-4 hover:underline">
              See which tools ran
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
