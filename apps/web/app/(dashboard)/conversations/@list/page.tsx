import { ConversationsListPane } from "@/components/conversations-list-pane";

export const dynamic = "force-dynamic";

export default async function ListSlot({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ConversationsListPane params={await searchParams} />;
}
