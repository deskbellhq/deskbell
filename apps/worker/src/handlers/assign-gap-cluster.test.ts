import { describe, expect, it } from "vitest";
import {
  type AssignDeps,
  assignGapCluster,
  type ClusterRef,
  NO_QUESTION,
} from "./assign-gap-cluster";

const T0 = new Date(Date.UTC(2026, 8, 1, 12, 0));
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

interface Cluster extends ClusterRef {
  key: string;
  label: string;
  embedded: boolean;
  firstSeen: Date;
  lastSeen: Date;
  reopenedAt: Date | null;
}

interface Phrasing {
  id: string;
  clusterId: string;
  text: string;
  key: string;
  embedding: number[] | null;
  firstSeen: Date;
  lastSeen: Date;
}

interface Msg {
  id: string;
  createdAt: Date;
  question: string | null;
  gapClusterId: string | null;
}

/** Unit vectors on a plane so cosine similarity is readable in the tests. */
const dir = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const cosine = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] as number), 0);

/**
 * In-memory stand-in with the real deps' contract: one cluster per key, the
 * nearest *wording* by cosine — every wording the project has seen, not
 * cluster leaders — and a resolved cluster that only the handler can reopen.
 * `embeddings` maps the text handed to the embedder to its vector; text absent
 * from it "fails to embed" (null), like a provider outage.
 */
function fake(msgs: Msg[], clusters: Cluster[] = [], embeddings: Record<string, number[]> = {}) {
  let n = 0;
  let p = 0;
  const phrasings: Phrasing[] = [];
  const embedCalls: string[] = [];
  const deps: AssignDeps = {
    async loadMessage(id) {
      return msgs.find((m) => m.id === id) ?? null;
    },
    async findByKey(key) {
      const phrasing = phrasings.find((x) => x.key === key);
      if (!phrasing) return null;
      const cluster = clusters.find((c) => c.id === phrasing.clusterId);
      return cluster ? { ...cluster, phrasingId: phrasing.id } : null;
    },
    async nearestPhrasing(embedding) {
      const scored = phrasings
        .filter((x) => x.embedding)
        .map((x) => ({ x, similarity: cosine(x.embedding as number[], embedding) }))
        .sort((a, b) => b.similarity - a.similarity);
      const best = scored[0];
      if (!best) return null;
      const cluster = clusters.find((c) => c.id === best.x.clusterId);
      return cluster ? { ...cluster, similarity: best.similarity } : null;
    },
    async createCluster({ label, key, embedded, at }) {
      const existing = clusters.find((c) => c.key === key);
      if (existing) return existing;
      const c: Cluster = {
        id: `gap_${++n}`,
        status: "open",
        resolvedAt: null,
        key,
        label,
        embedded,
        firstSeen: at,
        lastSeen: at,
        reopenedAt: null,
      };
      clusters.push(c);
      return c;
    },
    async recordPhrasing({ clusterId, text, key, embedding, at }) {
      const existing = phrasings.find((x) => x.key === key);
      if (existing) {
        existing.embedding ??= embedding;
        if (at > existing.lastSeen) existing.lastSeen = at;
        return;
      }
      phrasings.push({
        id: `gph_${++p}`,
        clusterId,
        text,
        key,
        embedding,
        firstSeen: at,
        lastSeen: at,
      });
    },
    async touchPhrasing(phrasingId, at) {
      const phrasing = phrasings.find((x) => x.id === phrasingId);
      if (!phrasing) return;
      if (at < phrasing.firstSeen) phrasing.firstSeen = at;
      if (at > phrasing.lastSeen) phrasing.lastSeen = at;
    },
    async attach(messageId, clusterId) {
      const m = msgs.find((x) => x.id === messageId);
      if (m) m.gapClusterId = clusterId;
    },
    async touch(clusterId, at, reopen) {
      const c = clusters.find((x) => x.id === clusterId);
      if (!c) return;
      if (at < c.firstSeen) c.firstSeen = at;
      if (at > c.lastSeen) c.lastSeen = at;
      if (reopen) {
        c.status = "open";
        c.reopenedAt = new Date();
      }
    },
    async embed(text) {
      embedCalls.push(text);
      return embeddings[text] ?? null;
    },
  };
  return { deps, clusters, phrasings, embedCalls };
}

const msg = (id: string, question: string | null, at = T0): Msg => ({
  id,
  createdAt: at,
  question,
  gapClusterId: null,
});

describe("assignGapCluster", () => {
  it("joins by exact normalised key without calling the embedder", async () => {
    const { deps, embedCalls } = fake(
      [msg("m1", "How do I export?"), msg("m2", "how do i export")],
      [],
      { "How do I export?": dir(0) },
    );
    const first = await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
    const second = await assignGapCluster(deps, { messageId: "m2", threshold: 0.9 });

    expect(first?.joinedBy).toBe("created");
    expect(second).toMatchObject({ clusterId: first?.clusterId, joinedBy: "key" });
    // Only the first phrasing was embedded; the second matched by text.
    expect(embedCalls).toEqual(["How do I export?"]);
  });

  it("joins the nearest wording at or above the threshold, else creates", async () => {
    const { deps, clusters } = fake(
      [
        msg("m1", "How do I export?"),
        msg("m2", "Exporting — how?"),
        msg("m3", "Reset my password"),
      ],
      [],
      { "How do I export?": dir(0), "Exporting — how?": dir(10), "Reset my password": dir(80) },
    );
    await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
    const near = await assignGapCluster(deps, { messageId: "m2", threshold: 0.9 }); // cos 10° ≈ 0.985
    const far = await assignGapCluster(deps, { messageId: "m3", threshold: 0.9 }); // cos 80° ≈ 0.17

    expect(near).toMatchObject({ clusterId: "gap_1", joinedBy: "embedding" });
    expect(far).toMatchObject({ clusterId: "gap_2", joinedBy: "created" });
    expect(clusters.map((c) => c.label)).toEqual(["How do I export?", "Reset my password"]);
  });

  it("compares with every wording of a cluster, not only its leader", async () => {
    const { deps, clusters, phrasings } = fake(
      [
        msg("m1", "How do I embed the widget?"),
        msg("m2", "How do I add the widget to a page?"),
        msg("m3", "How do I put the widget on my site?"),
      ],
      [],
      {
        "How do I embed the widget?": dir(0),
        "How do I add the widget to a page?": dir(20),
        // 35° from the leader (cos ≈ 0.82, under the threshold) but 15° from
        // the second wording (cos ≈ 0.97): the case leader-only comparison lost.
        "How do I put the widget on my site?": dir(35),
      },
    );
    await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
    await assignGapCluster(deps, { messageId: "m2", threshold: 0.9 });
    const third = await assignGapCluster(deps, { messageId: "m3", threshold: 0.9 });

    expect(third).toMatchObject({ clusterId: "gap_1", joinedBy: "embedding" });
    expect(clusters).toHaveLength(1);
    // Every wording is remembered, so the next paraphrase is compared with all three.
    expect(phrasings.map((x) => x.clusterId)).toEqual(["gap_1", "gap_1", "gap_1"]);
  });

  it("embeds the question with the project's ignored terms removed", async () => {
    const { deps, clusters, embedCalls } = fake(
      [msg("m1", "What is Deskbell?"), msg("m2", "How much does Deskbell cost?")],
      [],
      { "What is?": dir(0), "How much does cost?": dir(60) },
    );
    const opts = { threshold: 0.8, ignoredTerms: ["Deskbell"] };
    await assignGapCluster(deps, { messageId: "m1", ...opts });
    const second = await assignGapCluster(deps, { messageId: "m2", ...opts });

    expect(embedCalls).toEqual(["What is?", "How much does cost?"]);
    // Two needs, two clusters — and the label keeps the word that was stripped.
    expect(second?.joinedBy).toBe("created");
    expect(clusters.map((c) => c.label)).toEqual([
      "What is Deskbell?",
      "How much does Deskbell cost?",
    ]);
  });

  it("embeds the question as typed when stripping would leave nothing", async () => {
    const { deps, embedCalls } = fake([msg("m1", "Deskbell?")]);
    await assignGapCluster(deps, { messageId: "m1", threshold: 0.9, ignoredTerms: ["Deskbell"] });
    expect(embedCalls).toEqual(["Deskbell?"]);
  });

  it("records a vectorless wording when embedding fails, and later key joins still work", async () => {
    const { deps, clusters, phrasings } = fake([
      msg("m1", "Where is the API key?"),
      msg("m2", "where is the api key?"),
    ]);
    const first = await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
    const second = await assignGapCluster(deps, { messageId: "m2", threshold: 0.9 });

    expect(first?.joinedBy).toBe("created");
    expect(clusters[0]?.embedded).toBe(false);
    expect(phrasings[0]?.embedding).toBeNull();
    expect(second).toMatchObject({ clusterId: first?.clusterId, joinedBy: "key" });
  });

  it("uses a vector handed in by the caller instead of embedding again", async () => {
    const { deps, embedCalls } = fake(
      [msg("m1", "How do I export?"), msg("m2", "Exporting — how?")],
      [],
      { "How do I export?": dir(0) },
    );
    await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
    const r = await assignGapCluster(deps, { messageId: "m2", threshold: 0.9, embedding: dir(5) });

    expect(r?.joinedBy).toBe("embedding");
    expect(embedCalls).toEqual(["How do I export?"]);
  });

  it("reopens a resolved cluster on a later occurrence, not on an older one", async () => {
    const resolvedAt = later(60);
    const resolved: Cluster = {
      id: "gap_r",
      status: "resolved",
      resolvedAt,
      key: "how do i export",
      label: "How do I export?",
      embedded: true,
      firstSeen: T0,
      lastSeen: T0,
      reopenedAt: null,
    };
    const { deps, clusters } = fake(
      [msg("old", "How do I export?", later(30)), msg("new", "How do I export?", later(90))],
      [resolved],
      { "How do I export?": dir(0) },
    );

    const old = await assignGapCluster(deps, { messageId: "old", threshold: 0.9 });
    expect(old?.reopened).toBe(false);
    expect(clusters[0]?.status).toBe("resolved");

    const fresh = await assignGapCluster(deps, { messageId: "new", threshold: 0.9 });
    expect(fresh?.reopened).toBe(true);
    expect(clusters[0]?.status).toBe("open");
    expect(clusters[0]?.lastSeen).toEqual(later(90));
  });

  it("is idempotent: an assigned message is reported, not moved", async () => {
    const { deps, clusters, phrasings } = fake([msg("m1", "How do I export?")], [], {
      "How do I export?": dir(0),
    });
    const first = await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
    const again = await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });

    expect(again).toEqual({
      clusterId: first?.clusterId,
      joinedBy: "existing",
      reopened: false,
      analysisRequested: false,
    });
    expect(clusters).toHaveLength(1);
    expect(phrasings).toHaveLength(1);
  });

  it("returns null for a message it cannot see, and groups a missing question under a fixed label", async () => {
    const { deps, clusters } = fake([msg("m1", null)]);
    expect(await assignGapCluster(deps, { messageId: "nope", threshold: 0.9 })).toBeNull();
    await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
    expect(clusters[0]?.label).toBe(NO_QUESTION);
  });
});

describe("assignGapCluster — automatic analysis", () => {
  function withAuto(
    threshold: number,
    recent: number,
    state = { hasAnalysis: false, pending: false },
  ) {
    const requests: string[] = [];
    const base = fake([msg("m1", "How do I export?")], [], { "How do I export?": dir(0) });
    base.deps.autoAnalyze = {
      threshold,
      recentOccurrences: async () => recent,
      analysisState: async () => state,
      request: async (id) => {
        requests.push(id);
      },
    };
    return { ...base, requests };
  }

  it("requests an analysis once the threshold is reached", async () => {
    const { deps, requests } = withAuto(3, 3);
    const r = await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
    expect(r?.analysisRequested).toBe(true);
    expect(requests).toEqual([r?.clusterId]);
  });

  it("does nothing below the threshold, when an analysis exists, or when one is pending", async () => {
    for (const [recent, state] of [
      [2, { hasAnalysis: false, pending: false }],
      [3, { hasAnalysis: true, pending: false }],
      [3, { hasAnalysis: false, pending: true }],
    ] as const) {
      const { deps, requests } = withAuto(3, recent, state);
      const r = await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
      expect(r?.analysisRequested).toBe(false);
      expect(requests).toEqual([]);
    }
  });

  it("is off entirely without the rule", async () => {
    const { deps } = fake([msg("m1", "How do I export?")]);
    const r = await assignGapCluster(deps, { messageId: "m1", threshold: 0.9 });
    expect(r?.analysisRequested).toBe(false);
  });
});
