import { describe, expect, it } from "vitest";
import {
  INTENT_INFO,
  INTENTS,
  intentName,
  isIntent,
  isSignal,
  normalizeSignals,
  SIGNAL_INFO,
  SIGNALS,
  signalName,
} from "./intents.ts";

describe("intents and signals", () => {
  it("names and describes every key", () => {
    for (const key of INTENTS) {
      expect(INTENT_INFO[key].name.length).toBeGreaterThan(0);
      expect(INTENT_INFO[key].description.length).toBeGreaterThan(0);
    }
    for (const key of SIGNALS) {
      expect(SIGNAL_INFO[key].name.length).toBeGreaterThan(0);
      expect(SIGNAL_INFO[key].description.length).toBeGreaterThan(0);
    }
    expect(intentName("how_to")).toBe("How-to");
    expect(signalName("wants_human")).toBe("Wants a human");
  });

  it("keeps an unknown stored key readable", () => {
    expect(intentName("legacy_key")).toBe("legacy_key");
    expect(signalName("legacy_key")).toBe("legacy_key");
    expect(isIntent("legacy_key")).toBe(false);
    expect(isSignal(3)).toBe(false);
  });

  it("normalises signals to known keys, once each, in the fixed order", () => {
    expect(normalizeSignals(["wants_human", "pushback", "wants_human", "angry", 1])).toEqual([
      "pushback",
      "wants_human",
    ]);
    expect(normalizeSignals([])).toEqual([]);
  });
});
