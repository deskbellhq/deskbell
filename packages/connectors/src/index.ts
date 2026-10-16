import type { z } from "zod";
import { docsCrawler } from "./docs-crawler";

/**
 * Connector anatomy (open-mercato-style convention — see AGENTS.md):
 * one folder per connector exporting a Connector object; registered here.
 * v1 connectors: docs-crawler. Planned: helpcenter-zendesk, helpcenter-intercom,
 * confluence, github. Post-launch: discord, slack.
 */

export interface RawDocument {
  externalId: string;
  url?: string;
  title: string;
  content: string;
}

export interface Connector<TConfig = unknown> {
  type: string;
  displayName: string;
  configSchema: z.ZodType<TConfig>;
  /** Yields documents; the worker handles chunking, hashing, and embedding. */
  discover(config: TConfig): AsyncIterable<RawDocument>;
}

export const connectorRegistry = new Map<string, Connector<never>>(
  [docsCrawler].map((c) => [c.type, c as Connector<never>]),
);
