import { ConversationThread } from "@/components/conversation-thread";
import { getDefaultProject } from "@/lib/org";

export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getDefaultProject();
  return <ConversationThread id={id} project={project} />;
}
