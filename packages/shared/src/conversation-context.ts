import { z } from "zod";

/**
 * Opaque key/value context a host page attaches to a conversation (spec:
 * conversation-context-and-titles): which account, which site, which
 * product. Stored once at creation, filterable by one key, shown in the
 * dashboard. Never interpreted by the server.
 */
export const ConversationContextSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_-]*$/i, "context keys are identifiers"),
    z.object({ id: z.string().min(1).max(128), name: z.string().max(200).optional() }),
  )
  .refine((ctx) => Object.keys(ctx).length <= 8, "at most 8 context keys");
export type ConversationContext = z.infer<typeof ConversationContextSchema>;
