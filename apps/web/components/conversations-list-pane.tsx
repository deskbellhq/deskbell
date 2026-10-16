import { InboxList } from "@/components/conversations-inbox";
import { countConversations, listConversations } from "@/lib/conversations-list";
import { parseView, resolveRange, todayUtc } from "@/lib/conversations-view";
import { getDefaultProject } from "@/lib/org";

/**
 * The list pane's data (spec: conversations-date-range): the rows of the
 * view in the URL and what each filter segment of its period would show,
 * both from the same aggregates, fetched server-side so a period reaches
 * past the list's cap.
 */
export async function ConversationsListPane({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const view = parseView(params);
  const range = resolveRange(view, todayUtc());
  const project = await getDefaultProject();
  const [rows, counts] = await Promise.all([
    listConversations(project, { filter: view.filter, range }),
    countConversations(project, range),
  ]);
  return <InboxList rows={rows} counts={counts} view={view} />;
}
