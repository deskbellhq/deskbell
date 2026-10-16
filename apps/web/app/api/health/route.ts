export function GET() {
  // D12 "boring upgrades": compose healthcheck + load balancers hit this.
  return Response.json({ ok: true, service: "deskbell-web" });
}
