import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import openapi from "../public/openapi.json";
import { contentRoot } from "./content-slugs";

/**
 * The HTTP API page renders endpoints from the generated document. Two
 * things can go quietly wrong: an endpoint in the document that the page
 * never shows, and a page block naming a path the document does not have
 * (which throws at build, but only when that page builds).
 */

const page = readFileSync(join(contentRoot, "developer/api.mdx"), "utf8");
const shown = [...page.matchAll(/<ApiEndpoint path="([^"]+)"/g)].map((m) => m[1]);
const documented = Object.keys(openapi.paths);

describe("openapi", () => {
  it("is OpenAPI 3.1 with a server placeholder", () => {
    expect(openapi.openapi).toBe("3.1.0");
    expect(openapi.servers[0]?.url).toContain("example.com");
  });

  it("shows every documented endpoint on the API page", () => {
    for (const path of documented) {
      expect(shown, `${path} is in openapi.json but not on developer/api.mdx`).toContain(path);
    }
  });

  it("renders only endpoints the document has", () => {
    for (const path of shown) {
      expect(documented, `${path} is on the page but not in openapi.json`).toContain(path);
    }
  });

  it("describes every request field", () => {
    for (const [path, ops] of Object.entries(openapi.paths)) {
      for (const op of Object.values(
        ops as Record<
          string,
          {
            requestBody?: {
              content: Record<
                string,
                { schema: { properties?: Record<string, { description?: string }> } }
              >;
            };
          }
        >,
      )) {
        const props = op.requestBody?.content["application/json"]?.schema.properties ?? {};
        for (const [name, field] of Object.entries(props)) {
          expect(field.description, `${path}.${name} has no description`).toBeTruthy();
        }
      }
    }
  });
});
