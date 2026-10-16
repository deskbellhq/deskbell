import { describe, expect, it } from "vitest";
import { DIAGRAMS } from "./diagrams";

/**
 * A diagram is data, so the mistakes are data mistakes: an edge naming a node
 * that is not there, two nodes in one cell, a label long enough to be a
 * sentence. The renderer throws on the first; the rest would draw wrong and
 * look fine at a glance.
 */

describe("diagrams", () => {
  for (const [name, diagram] of Object.entries(DIAGRAMS)) {
    describe(name, () => {
      const ids = new Set(diagram.nodes.map((node) => node.id));

      it("joins nodes that exist", () => {
        for (const edge of diagram.edges) {
          expect(ids.has(edge.from), `${edge.from} -> ${edge.to}: no node ${edge.from}`).toBe(true);
          expect(ids.has(edge.to), `${edge.from} -> ${edge.to}: no node ${edge.to}`).toBe(true);
        }
      });

      it("puts one node in a cell", () => {
        const cells = new Set<string>();
        for (const node of diagram.nodes) {
          for (let r = node.row; r < node.row + (node.rowSpan ?? 1); r++) {
            const cell = `${node.col},${r}`;
            expect(cells.has(cell), `${node.id} shares cell ${cell}`).toBe(false);
            cells.add(cell);
          }
        }
      });

      it("keeps labels short", () => {
        for (const node of diagram.nodes) {
          for (const line of node.label.split("\n")) {
            expect(line.length, `${node.id}: "${line}"`).toBeLessThanOrEqual(16);
          }
        }
        for (const node of diagram.nodes) {
          expect(node.sublabel?.length ?? 0, `${node.id}: "${node.sublabel}"`).toBeLessThanOrEqual(
            26,
          );
        }
        for (const edge of diagram.edges) {
          expect(edge.label?.length ?? 0, `${edge.from} -> ${edge.to}`).toBeLessThanOrEqual(24);
        }
      });

      it("routes edges left to right or downwards", () => {
        const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
        for (const edge of diagram.edges) {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) continue;
          const forward = to.col > from.col || (to.col === from.col && to.row > from.row);
          expect(forward, `${edge.from} -> ${edge.to} runs backwards`).toBe(true);
        }
      });

      it("states its claim", () => {
        expect(diagram.caption.length).toBeGreaterThan(40);
      });
    });
  }
});
