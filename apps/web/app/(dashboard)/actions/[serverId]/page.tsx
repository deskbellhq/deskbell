import { redirect } from "next/navigation";

/** A server's page lives under the Servers tab; the older address still lands. */
export default async function ServerRedirect({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  redirect(`/actions/servers/${encodeURIComponent(serverId)}`);
}
