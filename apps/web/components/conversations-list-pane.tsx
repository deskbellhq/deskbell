import { intentName, signalName, topicName } from "@deskbell/shared";

import { InboxList } from "@/components/conversations-inbox";
import { countConversations, listConversations } from "@/lib/conversations-list";
import { parseView, resolveRange, todayUtc } from "@/lib/conversations-view";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";
import { loadContextNames, loadVisitorLabel } from "@/lib/usage-query";

/**
 * The list pane's data (spec: conversations-date-range): the rows of the
 * view in the URL and what each filter segment of its period would show,
 * both from the same aggregates, fetched server-side so a period reaches
 * past the list's cap. A topic or context narrowing from the usage page
 * (spec: usage-page) applies to both, and the pane learns what to call it;
 * so does a verified visitor, named the way the thread view names them.
 */
export async function ConversationsListPane({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const view = parseView(params);
  const range = resolveRange(view, todayUtc());
  const project = await getDefaultProject();
  const narrowing = {
    topic: view.topic,
    intent: view.intent,
    signal: view.signal,
    context: view.context,
    user: view.user,
  };
  const [rows, counts, contextNames, visitor] = await Promise.all([
    listConversations(project, { filter: view.filter, range, ...narrowing }),
    countConversations(project, range, narrowing),
    view.context
      ? loadContextNames(getDb(), project, [view.context])
      : ({} as Record<string, string>),
    view.user ? loadVisitorLabel(getDb(), project, view.user) : null,
  ]);
  const labels = {
    topic: view.topic ? topicName(project.topics, view.topic) : null,
    intent: view.intent ? intentName(view.intent) : null,
    signal: view.signal ? signalName(view.signal) : null,
    context: view.context ? (contextNames[view.context.key] ?? view.context.id) : null,
    user: view.user ? (visitor ?? "Unknown visitor") : null,
  };
  return <InboxList rows={rows} counts={counts} view={view} labels={labels} />;
}
