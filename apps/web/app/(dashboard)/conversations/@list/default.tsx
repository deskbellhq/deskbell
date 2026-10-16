import { ConversationsListPane } from "@/components/conversations-list-pane";

export const dynamic = "force-dynamic";

/** The slot for a route it has no page for: the whole list, no view. */
export default function ListSlotDefault() {
  return <ConversationsListPane params={{}} />;
}
