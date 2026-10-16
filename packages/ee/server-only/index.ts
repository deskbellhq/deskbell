import "server-only";

/**
 * Enterprise Edition entry point. Rules (D3, documenso pattern):
 * - EE code NEVER ships in client bundles ("server-only" enforces it).
 * - The open app imports EE only through feature-flag gates.
 * - What belongs here is listed in ../FEATURES; the AI core never does.
 */
export const EE_ENABLED = process.env.DESKBELL_EE_LICENSE_KEY !== undefined;

/**
 * White-label: may this project hide the "Powered by Deskbell" badge?
 *
 * Honest framing — this is a licence term, not DRM. The widget is MIT and any
 * self-hoster can delete the badge from source in ten seconds. The gate exists
 * so the hosted product and the EE contract mean something, not to stop
 * anyone; building enforcement into an open-source widget would be theatre.
 */
export function canHideBranding(): boolean {
  return EE_ENABLED;
}
