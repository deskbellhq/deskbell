import { redirect } from "next/navigation";

/** A server's page moved with the rest of Actions; old links still land. */
export default async function SettingsServerRedirect({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  redirect(`/actions/servers/${encodeURIComponent(serverId)}`);
}
