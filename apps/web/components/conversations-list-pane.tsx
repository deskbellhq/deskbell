import { INTENT_INFO, intentName, SIGNAL_INFO, signalName, topicName } from "@deskbell/shared";

import { InboxList } from "@/components/conversations-inbox";
import { countConversations, listConversations, loadContextValues } from "@/lib/conversations-list";
import { parseView, resolveRange, todayUtc } from "@/lib/conversations-view";
import { getDb } from "@/lib/db";
import { getDefaultProject } from "@/lib/org";
import { loadContextNames, loadVisitorLabel } from "@/lib/usage-query";

const INTENT_NAMES = Object.fromEntries(Object.keys(INTENT_INFO).map((k) => [k, intentName(k)]));
const SIGNAL_NAMES = Object.fromEntries(Object.keys(SIGNAL_INFO).map((k) => [k, signalName(k)]));

/**
 * The list pane's data (spec: conversations-date-range, attention-inbox):
 * the rows of the view in the URL and what each quick view of its period
 * would show, both from the same aggregates, fetched server-side so a
 * period reaches past the list's cap. Every narrowing applies to both, and
 * the pane learns what to call it; the filter menu learns what the project
 * can be narrowed by.
 */
export async function ConversationsListPane({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const view = parseView(params);
  const range = resolveRange(view, todayUtc());
  const project = await getDefaultProject();
  const [rows, counts, contextNames, visitor, contextValues] = await Promise.all([
    listConversations(project, view, { range }),
    countConversations(project, range, view),
    view.context
      ? loadContextNames(getDb(), project, [view.context])
      : ({} as Record<string, string>),
    view.user ? loadVisitorLabel(getDb(), project, view.user) : null,
    loadContextValues(project),
  ]);
  const labels = {
    topic: view.topic ? topicName(project.topics, view.topic) : null,
    intent: view.intent ? intentName(view.intent) : null,
    signal: view.signal ? signalName(view.signal) : null,
    context: view.context ? (contextNames[view.context.key] ?? view.context.id) : null,
    user: view.user ? (visitor ?? "Unknown visitor") : null,
  };
  return (
    <InboxList
      rows={rows}
      counts={counts}
      view={view}
      labels={labels}
      topics={project.topics}
      contextValues={contextValues}
      intentNames={INTENT_NAMES}
      signalNames={SIGNAL_NAMES}
    />
  );
}
