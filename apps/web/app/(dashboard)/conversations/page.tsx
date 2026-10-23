import { MessagesSquare } from "lucide-react";

import { ConversationThread } from "@/components/conversation-thread";
import { listConversations } from "@/lib/conversations-list";
import { parseView, resolveRange, todayUtc } from "@/lib/conversations-view";
import { getDefaultProject } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * Desktop pane for the index route: the newest thread of the current view
 * opens on its own (spec: conversations-inbox-polish), so the page has
 * something to read on arrival. On phones the list in the layout is the
 * index view and this pane is hidden.
 */
export default async function ConversationsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, project] = await Promise.all([searchParams, getDefaultProject()]);
  const view = parseView(params);
  const [newest] = await listConversations(project, {
    filter: view.filter,
    range: resolveRange(view, todayUtc()),
    topic: view.topic,
    context: view.context,
    limit: 1,
  });

  if (newest) {
    return (
      <div className="hidden h-full min-h-0 flex-1 md:flex">
        <ConversationThread id={newest.id} project={project} />
      </div>
    );
  }

  return (
    <div className="hidden h-full flex-col items-center justify-center gap-3 text-center md:flex">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <MessagesSquare className="size-5 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Nothing to read yet</p>
        <p className="text-sm text-muted-foreground">
          A thread appears here as soon as a visitor asks the widget a question.
        </p>
      </div>
    </div>
  );
}
