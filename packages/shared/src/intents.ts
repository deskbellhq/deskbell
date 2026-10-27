/**
 * Intent and signals (spec: intent-and-signals): two fixed vocabularies the
 * worker writes on every visitor question from the same model call that
 * labels its topic. Topics are the operator's list because every product's
 * subjects differ; intents and signals are the same for every product, so
 * they are constants here that the dashboard can name, colour and document
 * without configuration.
 *
 * An intent is why the visitor asked — exactly one per question. A signal is
 * how it went for them — any number, usually none. Each entry carries its
 * name for the dashboard and its rule for the classifier and the tooltip, so
 * the model and the reader are told the same sentence.
 */

export const INTENTS = [
  "how_to",
  "troubleshooting",
  "lookup",
  "request",
  "off_topic",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

/** The intent a question gets when none of the others fits, or the reply named none. */
export const OTHER_INTENT: Intent = "other";

export const SIGNALS = ["pushback", "frustration", "wants_human"] as const;
export type Signal = (typeof SIGNALS)[number];

/** The two signals that ask to be read: the inbox marks a thread for them. */
export const ATTENTION_SIGNALS: readonly Signal[] = ["wants_human", "pushback"];

export interface LabelInfo {
  name: string;
  /** The rule, as one sentence: what the classifier is told and what the tooltip says. */
  description: string;
}

export const INTENT_INFO: Record<Intent, LabelInfo> = {
  how_to: {
    name: "How-to",
    description: "Wants to do something: how to set up, use, change or achieve a result.",
  },
  troubleshooting: {
    name: "Troubleshooting",
    description: "Something is wrong, failing or not as expected, and they want it fixed.",
  },
  lookup: {
    name: "Lookup",
    description: "Wants a fact: a limit, a price, a definition, whether something is supported.",
  },
  request: {
    name: "Request",
    description:
      "Asks for something the product should do or have: a feature, a change, “please add”, “it should”, “can it…” asked as a wish rather than a how-to.",
  },
  off_topic: {
    name: "Off topic",
    description: "Not about the product at all.",
  },
  other: {
    name: "Other",
    description:
      "Fits none of the others, or only asks to reach a person: greetings, tests, fragments.",
  },
};

export const SIGNAL_INFO: Record<Signal, LabelInfo> = {
  pushback: {
    name: "Pushback",
    description:
      "Repeats or disputes the previous answer: “no, I meant…”, “that's wrong”, “that didn't work”.",
  },
  frustration: {
    name: "Frustration",
    description: "Negative tone, urgency or complaint about the product or the help so far.",
  },
  wants_human: {
    name: "Wants a human",
    description: "Asks for a person, support, contact details, a ticket or a call.",
  },
};

export function isIntent(value: unknown): value is Intent {
  return typeof value === "string" && (INTENTS as readonly string[]).includes(value);
}

export function isSignal(value: unknown): value is Signal {
  return typeof value === "string" && (SIGNALS as readonly string[]).includes(value);
}

/** What the dashboard calls a stored intent; the key itself for one it no longer knows. */
export function intentName(key: string): string {
  return isIntent(key) ? INTENT_INFO[key].name : key;
}

/** What the dashboard calls a stored signal; the key itself for one it no longer knows. */
export function signalName(key: string): string {
  return isSignal(key) ? SIGNAL_INFO[key].name : key;
}

/**
 * Signals as stored: known keys only, each once, in the fixed order, so two
 * rows with the same signals compare equal and the dashboard's columns come
 * out in one order.
 */
export function normalizeSignals(values: readonly unknown[]): Signal[] {
  const set = new Set(values.filter(isSignal));
  return SIGNALS.filter((s) => set.has(s));
}
