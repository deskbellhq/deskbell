import { describe, expect, it, vi } from "vitest";
import {
  extractTerms,
  isSupportedBy,
  MAX_TERMS,
  normalizeTerm,
  termVariants,
  verifyAnswer,
} from "./verify";

describe("normalizeTerm — the index's notion of a token", () => {
  it("lowercases, strips accents and collapses punctuation to spaces", () => {
    expect(normalizeTerm("Règles d'Export")).toBe("regles d export");
    expect(normalizeTerm("Auto-Reply")).toBe("auto reply");
    expect(normalizeTerm("Settings → Billing")).toBe("settings billing");
    expect(normalizeTerm("  Many   spaces ")).toBe("many spaces");
  });

  it("drops a trailing possessive — the docs name the thing, not what belongs to it", () => {
    expect(normalizeTerm("Deskbell's widget")).toBe("deskbell widget");
    expect(normalizeTerm("Deskbell’s")).toBe("deskbell");
    // A bare s inside a word is not a possessive.
    expect(normalizeTerm("Settings")).toBe("settings");
  });

  it("folds ß like the index's unaccent does", () => {
    expect(normalizeTerm("Straße")).toBe("strasse");
  });
});

describe("termVariants — plural and singular both count", () => {
  it("adds the other number", () => {
    expect(termVariants("API key")).toEqual(["api key", "api keys"]);
    expect(termVariants("API keys")).toEqual(["api keys", "api key"]);
  });

  it("does not strip the s from a short word", () => {
    expect(termVariants("CSS")).toEqual(["css", "csss"]);
  });

  it("is empty for a term that normalizes to nothing", () => {
    expect(termVariants("***")).toEqual([]);
  });
});

describe("isSupportedBy — word-bounded containment", () => {
  it("finds a name in any text, in any variant", () => {
    expect(isSupportedBy("API keys", ["Create an API key under Settings."])).toBe(true);
    expect(isSupportedBy("auto-reply", ["Turn on Auto Reply to answer out of hours."])).toBe(true);
  });

  it("does not match inside a longer word", () => {
    expect(isSupportedBy("key", ["keyboard shortcuts"])).toBe(false);
  });
});

describe("extractTerms — what an answer asserts", () => {
  it("takes bold spans and single-token code, in first-seen order", () => {
    const answer =
      "Open **Settings** and enable **Auto-reply**. Set `DESKBELL_VERIFY` to `on`. Then open **Settings** again.";
    expect(extractTerms(answer)).toEqual(["Settings", "Auto-reply", "DESKBELL_VERIFY"]);
  });

  it("skips fenced code blocks, where samples and commands live", () => {
    const answer = "Run this:\n```sh\npnpm **not a name** `also not`\n```\nThen click **Save**.";
    expect(extractTerms(answer)).toEqual(["Save"]);
  });

  it("skips an unterminated fence to the end of the answer", () => {
    expect(extractTerms("Use **Export**.\n```\n**inside**")).toEqual(["Export"]);
  });

  it("drops label words, numbers, locators and sentences", () => {
    const answer = [
      "**Note:** see **https://example.com/docs** or **docs/guide.md**.",
      "Mail **help@example.com**. Version **2.0** is out.",
      "**This is a whole sentence. It is emphasised.**",
      "**Is it on?** Choose **Yes**.",
    ].join(" ");
    expect(extractTerms(answer)).toEqual([]);
  });

  it("strips trailing colons and periods from a label used as a heading", () => {
    expect(extractTerms("**Export rules:** choose a format.")).toEqual(["Export rules"]);
  });

  it("keeps code only when it is one token of reasonable length", () => {
    const answer = "`projectKey` and `pnpm db:migrate --force` and `a` and `theme.primary`";
    expect(extractTerms(answer)).toEqual(["projectKey", "theme.primary"]);
  });

  it("treats __x__ as bold only at word boundaries, not inside identifiers", () => {
    expect(extractTerms("Call __init__ then open __Settings__ or my__var__name")).toEqual([
      "init",
      "Settings",
    ]);
  });

  it("checks an arrow path whole and by part", () => {
    expect(extractTerms("Go to **Settings → Billing > Invoices**.")).toEqual([
      "Settings → Billing > Invoices",
      "Settings",
      "Billing",
      "Invoices",
    ]);
  });

  it("deduplicates by normalized form and caps the list", () => {
    expect(extractTerms("**Auto-reply** and **auto reply** and `auto-reply`")).toEqual([
      "Auto-reply",
    ]);
    const many = Array.from({ length: MAX_TERMS + 5 }, (_, i) => `**Name ${i}**`).join(" ");
    expect(extractTerms(many)).toHaveLength(MAX_TERMS);
  });
});

describe("verifyAnswer — the two passes and the three outcomes", () => {
  const answer = "Use **Find and Replace** or the **Skip Row** rule box.";

  it("is clean when every name is in the support text", async () => {
    const report = await verifyAnswer({
      answer,
      support: ["The Find and Replace rule box replaces values.", "Skip Row drops rows."],
    });
    expect(report).toEqual({ checked: ["Find and Replace", "Skip Row"], unsupported: [] });
  });

  it("flags a name found in neither the support nor the lookup", async () => {
    const lookup = vi.fn(async (terms: string[]) => new Set(terms.filter((t) => t === "Skip Row")));
    const report = await verifyAnswer({ answer, support: ["unrelated"], lookup });
    expect(lookup).toHaveBeenCalledWith(["Find and Replace", "Skip Row"]);
    expect(report).toEqual({
      checked: ["Find and Replace", "Skip Row"],
      unsupported: ["Find and Replace"],
    });
  });

  it("does not call the lookup when the local pass already cleared everything", async () => {
    const lookup = vi.fn(async () => new Set<string>());
    await verifyAnswer({ answer, support: ["Find and Replace", "Skip Row"], lookup });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("reports from the local pass alone when no lookup is wired", async () => {
    // A host that forgot the lookup must not get a silent no-op.
    const report = await verifyAnswer({ answer, support: ["Skip Row"] });
    expect(report?.unsupported).toEqual(["Find and Replace"]);
  });

  it("excludes names the visitor typed and names the project ignores", async () => {
    const report = await verifyAnswer({
      answer,
      said: ["Is there a find and replace box?"],
      ignoredTerms: ["skip row"],
      support: [],
    });
    expect(report).toEqual({ checked: [], unsupported: [] });
  });

  it("leaves the answer unchecked when the lookup rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await verifyAnswer({
      answer,
      support: [],
      lookup: async () => {
        throw new Error("db down");
      },
    });
    expect(report).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("leaves the answer unchecked when the lookup exceeds its budget", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await verifyAnswer({
      answer,
      support: [],
      lookup: () => new Promise(() => {}),
      lookupTimeoutMs: 5,
    });
    expect(report).toBeNull();
    error.mockRestore();
  });
});
