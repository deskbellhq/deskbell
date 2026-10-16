/**
 * Flow diagrams, as data. components/flow.tsx lays a diagram out on a grid
 * and draws it as inline SVG, so a diagram is edited here, in the same way
 * every time, and renders in both themes.
 *
 * A node sits in a cell (`col`, `row`) and may span rows. An edge joins two
 * nodes and carries a short label: what moves, or what happens on the way.
 * A lane is a labelled band behind a range of rows and columns. Keep labels
 * to a few words; a sentence belongs in the caption.
 */

export interface FlowNode {
  id: string;
  /** One or two lines; separate with `\n`. */
  label: string;
  /** A muted line under the label: what kind, or which options. */
  sublabel?: string;
  col: number;
  row: number;
  rowSpan?: number;
  /** `store` is drawn in the accent colour: the one part the argument turns on. */
  kind?: "store";
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  /** Arrowheads at both ends: something goes out and something comes back. */
  both?: boolean;
}

export interface FlowLane {
  title: string;
  rows: [number, number];
  cols: [number, number];
}

export interface FlowDiagram {
  /** What the picture shows, in one sentence. Also the accessible name. */
  caption: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  lanes?: FlowLane[];
}

export const DIAGRAMS: Record<string, FlowDiagram> = {
  "how-it-works": {
    caption:
      "Two loops that share only the store. Ingestion turns sources into chunks and embeds them into the vector database; answering resolves the question, searches the same index and hands the closest chunks to the model. With MCP servers attached, the model may also call the tools you allowed, and each result comes back as material for the answer. Postgres holds the records throughout; the index is pgvector inside it by default, or a Weaviate cluster you run.",
    lanes: [
      { title: "Ingestion", rows: [0, 1], cols: [0, 1] },
      { title: "Answering", rows: [2, 3], cols: [0, 4] },
    ],
    nodes: [
      { id: "site", label: "Docs site", sublabel: "crawled", col: 0, row: 0 },
      { id: "written", label: "Written answers", sublabel: "from the dashboard", col: 0, row: 1 },
      { id: "chunks", label: "Chunks", sublabel: "text + metadata", col: 1, row: 0 },
      { id: "question", label: "Question", sublabel: "from the widget", col: 0, row: 2 },
      { id: "query", label: "Resolved query", col: 1, row: 2 },
      {
        id: "store",
        label: "Vector database",
        sublabel: "pgvector · Weaviate",
        col: 2,
        row: 0,
        rowSpan: 3,
        kind: "store",
      },
      { id: "model", label: "Model", sublabel: "OpenAI · Anthropic · local", col: 3, row: 2 },
      { id: "tools", label: "MCP servers", sublabel: "off · allowed · confirm", col: 3, row: 3 },
      { id: "widget", label: "Widget", sublabel: "your site, your UI", col: 4, row: 2 },
    ],
    edges: [
      { from: "site", to: "chunks", label: "crawl, extract, chunk" },
      { from: "written", to: "chunks", label: "chunk" },
      { from: "chunks", to: "store", label: "embed" },
      { from: "question", to: "query", label: "plan" },
      { from: "query", to: "store", label: "embed + search" },
      { from: "store", to: "model", label: "top 8 chunks" },
      { from: "model", to: "tools", label: "call · result", both: true },
      { from: "model", to: "widget", label: "answer, sources, steps" },
    ],
  },
};
