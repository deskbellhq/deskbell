"use client";

import { Badge } from "@deskbell/ui/components/badge";
import { Button } from "@deskbell/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@deskbell/ui/components/drawer";
import { Separator } from "@deskbell/ui/components/separator";
import { useIsMobile } from "@deskbell/ui/hooks/use-mobile";
import { MessagesSquare, Plug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useState } from "react";

import { CALL_STATUS_LABEL, type LogRow } from "@/lib/actions/log";
import { formatLatency } from "@/lib/latency";

/**
 * One call, in full (spec: actions-log). Open because the URL says so —
 * `?call=<id>` — and closing rewrites the URL without it, so a link to a
 * call opens the log on that call and a reload keeps it open.
 */
export function ActionCallDetail({ call, closeHref }: { call: LogRow; closeHref: string }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(true);
  const close = useCallback(() => {
    setOpen(false);
    router.replace(closeHref, { scroll: false });
  }, [router, closeHref]);

  const when = new Date(call.createdAt);
  const responded = call.respondedAt ? new Date(call.respondedAt) : null;
  const expires = call.expiresAt ? new Date(call.expiresAt) : null;

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DrawerContent data-testid="call-detail">
        <DrawerHeader className="gap-1.5 pr-12">
          <DrawerTitle className="flex items-center gap-2 text-left">
            <Plug className="size-4 text-muted-foreground" />
            {call.title}
          </DrawerTitle>
          <DrawerDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left">
              <StatusChip status={call.status} />
              <span>{when.toLocaleString()}</span>
              {call.latencyMs != null ? <span>· {formatLatency(call.latencyMs)}</span> : null}
            </div>
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4 text-sm">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
            <Row label="Server">
              {call.serverId ? (
                <Link
                  href={`/actions/servers/${call.serverId}`}
                  className="underline-offset-4 hover:underline"
                >
                  {call.serverName ?? "Server"}
                </Link>
              ) : (
                <span className="text-muted-foreground">Removed</span>
              )}
            </Row>
            <Row label="Tool">
              <code>{call.tool}</code>
            </Row>
            <Row label="Visitor">
              {call.visitorName ?? (
                <span className="text-muted-foreground">
                  {call.visitorId ? "Signed in" : "Anonymous"}
                </span>
              )}
            </Row>
            {call.status === "pending_approval" ||
            call.status === "approved" ||
            call.status === "denied" ||
            call.status === "expired" ? (
              <>
                <Row label="Asked">{when.toLocaleString()}</Row>
                {responded ? <Row label="Answered">{responded.toLocaleString()}</Row> : null}
                {!responded && expires ? (
                  <Row label={call.status === "expired" ? "Expired" : "Expires"}>
                    {expires.toLocaleString()}
                  </Row>
                ) : null}
              </>
            ) : null}
          </dl>
          <Separator />
          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Arguments</h3>
            {call.details && call.details.length > 0 ? (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                {call.details.map((d) => (
                  <div key={d.label} className="contents">
                    <dt className="text-muted-foreground">{d.label}</dt>
                    <dd className="break-words">{d.value}</dd>
                  </div>
                ))}
              </dl>
            ) : Object.keys(call.input).length > 0 ? (
              <Code value={call.input} />
            ) : (
              <p className="text-muted-foreground">None.</p>
            )}
          </section>
          {call.error ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-destructive">Error</h3>
              <p className="whitespace-pre-wrap break-words">{call.error}</p>
            </section>
          ) : null}
          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">
              Result
              {call.outputTruncated ? (
                <span className="font-normal"> · cut to the stored limit</span>
              ) : null}
            </h3>
            {call.output !== null && call.output !== undefined ? (
              <Code value={call.output} />
            ) : (
              <p className="text-muted-foreground">
                {call.status === "succeeded" ? "Empty." : "No result."}
              </p>
            )}
          </section>
        </div>
        <DrawerFooter className="flex-row justify-end gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/conversations/${call.conversationId}`}>
              <MessagesSquare />
              Open conversation
            </Link>
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Code({ value }: { value: unknown }) {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

export function StatusChip({ status }: { status: LogRow["status"] }) {
  const tone =
    status === "failed" || status === "expired"
      ? "destructive"
      : status === "succeeded" || status === "approved"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={tone} className="font-normal">
      {CALL_STATUS_LABEL[status]}
    </Badge>
  );
}
