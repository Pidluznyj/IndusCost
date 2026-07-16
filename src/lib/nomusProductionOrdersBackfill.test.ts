import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE } from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import {
  parseProductionOrdersBackfillCheckpoint,
  parseProductionOrdersBackfillCli,
  resolveProductionOrdersBackfillStartPage,
  serializeProductionOrdersBackfillCheckpoint,
  shouldStopProductionOrdersBackfill,
} from "@/src/lib/nomusProductionOrdersBackfill.js";
import { runProductionOrdersBackfillLoop } from "@/src/lib/nomusProductionOrdersBackfill.server.js";
import { stableNomusProductionOrderPayloadHash } from "@/src/lib/nomusProductionOrdersParsers.js";

function op(id: number, overrides: Record<string, unknown> = {}) {
  return {
    ...NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE,
    id,
    nome: `OP ${id}`,
    ...overrides,
  };
}

describe("production orders backfill CLI/checkpoint", () => {
  it("parse CLI preview/apply com limites e reprocess", () => {
    const preview = parseProductionOrdersBackfillCli(
      ["preview", "--max-pages=10", "--start-page=3", "--page-size=20"],
      {}
    );
    assert.equal(preview.mode, "preview");
    assert.equal(preview.maxPages, 10);
    assert.equal(preview.startPage, 3);

    const apply = parseProductionOrdersBackfillCli(
      ["apply", "--reprocess=7", "--cursor-file=/tmp/op.cursor", "--hard-max-pages=100"],
      { NOMUS_PRODUCTION_ORDERS_PAGE_CURSOR_FILE: "/tmp/env.cursor" }
    );
    assert.equal(apply.mode, "apply");
    assert.equal(apply.reprocess, true);
    assert.equal(apply.startPage, 7);
    assert.equal(apply.cursorFile, "/tmp/op.cursor");
    assert.equal(apply.hardMaxPages, 100);
  });

  it("checkpoint serializa/parseia e resolve retomada", () => {
    const raw = serializeProductionOrdersBackfillCheckpoint({
      nextPage: 12,
      pagesCompleted: 11,
      lastExternalId: 30347,
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    const parsed = parseProductionOrdersBackfillCheckpoint(raw);
    assert.equal(parsed.nextPage, 12);
    assert.equal(parsed.checkpoint?.pagesCompleted, 11);

    assert.equal(
      resolveProductionOrdersBackfillStartPage({
        options: {
          mode: "apply",
          pageSize: 50,
          maxPages: 40,
          hardMaxPages: 2000,
          startPage: 1,
          reprocess: false,
          cursorFile: "/tmp/x",
        },
        cursorContent: raw,
      }),
      12
    );

    assert.equal(
      resolveProductionOrdersBackfillStartPage({
        options: {
          mode: "apply",
          pageSize: 50,
          maxPages: 40,
          hardMaxPages: 2000,
          startPage: 5,
          reprocess: true,
          cursorFile: "/tmp/x",
        },
        cursorContent: raw,
      }),
      5
    );
  });

  it("stop defensivo por max/hard/interrupt/catálogo", () => {
    assert.equal(
      shouldStopProductionOrdersBackfill({
        pagesRead: 40,
        maxPages: 40,
        hardMaxPages: 2000,
        interrupted: false,
        completedCatalog: false,
      }),
      true
    );
    assert.equal(
      shouldStopProductionOrdersBackfill({
        pagesRead: 1,
        maxPages: 40,
        hardMaxPages: 2000,
        interrupted: true,
        completedCatalog: false,
      }),
      true
    );
  });
});

describe("runProductionOrdersBackfillLoop", () => {
  it("execução completa apply + segunda execução idempotente", async () => {
    const store = new Map<number, { payloadHash: string; links: number }>();
    const pages: Record<number, unknown[]> = {
      1: [op(1), op(2)],
      2: [op(3)],
      3: [],
    };
    let checkpoints: string[] = [];

    const persistFn = async (raw: unknown) => {
      const item = raw as { id: number };
      const hash = stableNomusProductionOrderPayloadHash(raw as never);
      const existing = store.get(item.id);
      if (!existing) {
        store.set(item.id, { payloadHash: hash, links: 1 });
        return {
          outcome: "created" as const,
          externalId: item.id,
          links: {
            linksCreated: 1,
            linksUpdated: 0,
            linksReactivated: 0,
            linksMarkedAbsent: 0,
            salesOrderResolved: 0,
            salesOrderItemResolved: 0,
          },
          error: null,
        };
      }
      if (existing.payloadHash === hash) {
        return {
          outcome: "unchanged" as const,
          externalId: item.id,
          links: {
            linksCreated: 0,
            linksUpdated: 1,
            linksReactivated: 0,
            linksMarkedAbsent: 0,
            salesOrderResolved: 0,
            salesOrderItemResolved: 0,
          },
          error: null,
        };
      }
      store.set(item.id, { payloadHash: hash, links: 1 });
      return {
        outcome: "updated" as const,
        externalId: item.id,
        links: {
          linksCreated: 0,
          linksUpdated: 1,
          linksReactivated: 0,
          linksMarkedAbsent: 0,
          salesOrderResolved: 0,
          salesOrderItemResolved: 0,
        },
        error: null,
      };
    };

    const first = await runProductionOrdersBackfillLoop({
      mode: "apply",
      options: {
        mode: "apply",
        pageSize: 2,
        maxPages: 10,
        hardMaxPages: 100,
        startPage: 1,
        reprocess: false,
        cursorFile: "/tmp/op.cursor",
      },
      startPage: 1,
      fetchPage: async ({ page }) => ({
        items: pages[page] ?? [],
        fingerprint: `p${page}:${(pages[page] ?? []).length}`,
      }),
      persist: persistFn,
      writeCheckpoint: (content) => {
        checkpoints.push(content);
      },
      logger: () => undefined,
    });

    assert.equal(first.completedCatalog, true);
    assert.equal(first.created, 3);
    assert.equal(first.pagesRead, 3);
    assert.equal(store.size, 3);
    assert.ok(checkpoints.length >= 1);
    assert.equal(parseProductionOrdersBackfillCheckpoint(checkpoints.at(-1)!).nextPage, 1);

    const second = await runProductionOrdersBackfillLoop({
      mode: "apply",
      options: {
        mode: "apply",
        pageSize: 2,
        maxPages: 10,
        hardMaxPages: 100,
        startPage: 1,
        reprocess: true,
        cursorFile: "/tmp/op.cursor",
      },
      startPage: 1,
      fetchPage: async ({ page }) => ({
        items: pages[page] ?? [],
        fingerprint: `p${page}:${(pages[page] ?? []).length}`,
      }),
      persist: persistFn,
      writeCheckpoint: () => undefined,
      logger: () => undefined,
    });
    assert.equal(second.created, 0);
    assert.equal(second.unchanged, 3);
    assert.equal(store.size, 3);
  });

  it("interrupção segura e retomada pelo checkpoint", async () => {
    let pageFetches = 0;
    let checkpointRaw = "";

    const first = await runProductionOrdersBackfillLoop({
      mode: "apply",
      options: {
        mode: "apply",
        pageSize: 1,
        maxPages: 10,
        hardMaxPages: 100,
        startPage: 1,
        reprocess: false,
        cursorFile: "/tmp/op.cursor",
      },
      startPage: 1,
      fetchPage: async ({ page }) => {
        pageFetches += 1;
        return {
          items: [op(page)],
          fingerprint: `id:${page}`,
        };
      },
      persist: async (raw) => ({
        outcome: "created",
        externalId: (raw as { id: number }).id,
        links: {
          linksCreated: 1,
          linksUpdated: 0,
          linksReactivated: 0,
          linksMarkedAbsent: 0,
          salesOrderResolved: 0,
          salesOrderItemResolved: 0,
        },
        error: null,
      }),
      shouldContinue: () => pageFetches < 1,
      writeCheckpoint: (c) => {
        checkpointRaw = c;
      },
      logger: () => undefined,
    });

    assert.equal(first.interrupted, true);
    assert.equal(first.created, 1);
    assert.ok(first.checkpoint);
    const resumePage = parseProductionOrdersBackfillCheckpoint(checkpointRaw).nextPage;
    assert.equal(resumePage, 2);

    const resumed = await runProductionOrdersBackfillLoop({
      mode: "apply",
      options: {
        mode: "apply",
        pageSize: 1,
        maxPages: 5,
        hardMaxPages: 100,
        startPage: resumePage!,
        reprocess: false,
        cursorFile: "/tmp/op.cursor",
      },
      startPage: resumePage!,
      fetchPage: async ({ page }) => {
        if (page >= 4) return { items: [], fingerprint: "empty" };
        return { items: [op(page + 100)], fingerprint: `id:${page}` };
      },
      persist: async (raw) => ({
        outcome: "created",
        externalId: (raw as { id: number }).id,
        links: {
          linksCreated: 0,
          linksUpdated: 0,
          linksReactivated: 0,
          linksMarkedAbsent: 0,
          salesOrderResolved: 0,
          salesOrderItemResolved: 0,
        },
        error: null,
      }),
      writeCheckpoint: () => undefined,
      logger: () => undefined,
    });
    assert.equal(resumed.interrupted, false);
    assert.equal(resumed.completedCatalog, true);
    assert.ok(resumed.created >= 1);
  });

  it("página repetida encerra sem corromper", async () => {
    const summary = await runProductionOrdersBackfillLoop({
      mode: "apply",
      options: {
        mode: "apply",
        pageSize: 2,
        maxPages: 10,
        hardMaxPages: 100,
        startPage: 1,
        reprocess: false,
        cursorFile: null,
      },
      startPage: 1,
      fetchPage: async () => ({
        items: [op(1), op(2)],
        fingerprint: "same",
      }),
      persist: async (raw) => ({
        outcome: "created",
        externalId: (raw as { id: number }).id,
        links: {
          linksCreated: 0,
          linksUpdated: 0,
          linksReactivated: 0,
          linksMarkedAbsent: 0,
          salesOrderResolved: 0,
          salesOrderItemResolved: 0,
        },
        error: null,
      }),
      logger: () => undefined,
    });
    assert.equal(summary.pagesRead, 1);
    assert.ok(summary.errors >= 1);
    assert.match(summary.errorReport[0]?.message ?? "", /repetida/i);
  });

  it("erro no meio do lote isola falha e continua", async () => {
    const persisted: number[] = [];
    const summary = await runProductionOrdersBackfillLoop({
      mode: "apply",
      options: {
        mode: "apply",
        pageSize: 10,
        maxPages: 1,
        hardMaxPages: 10,
        startPage: 1,
        reprocess: false,
        cursorFile: null,
      },
      startPage: 1,
      fetchPage: async () => ({
        items: [op(1), op(2), op(3)],
        fingerprint: "batch",
      }),
      persist: async (raw) => {
        const id = (raw as { id: number }).id;
        if (id === 2) throw new Error("boom mid-batch");
        persisted.push(id);
        return {
          outcome: "created",
          externalId: id,
          links: {
            linksCreated: 1,
            linksUpdated: 0,
            linksReactivated: 0,
            linksMarkedAbsent: 0,
            salesOrderResolved: 0,
            salesOrderItemResolved: 0,
          },
          error: null,
        };
      },
      logger: () => undefined,
    });
    assert.deepEqual(persisted, [1, 3]);
    assert.equal(summary.created, 2);
    assert.equal(summary.errors, 1);
    assert.match(summary.errorReport[0]?.message ?? "", /boom mid-batch/);
  });

  it("conta 429 via rateLimit no runner externo + vínculos pendentes/removidos", async () => {
    const summary = await runProductionOrdersBackfillLoop({
      mode: "apply",
      options: {
        mode: "apply",
        pageSize: 10,
        maxPages: 2,
        hardMaxPages: 10,
        startPage: 1,
        reprocess: false,
        cursorFile: null,
      },
      startPage: 1,
      fetchPage: async ({ page }) => {
        if (page === 1) {
          return {
            items: [NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE],
            fingerprint: "05800",
          };
        }
        return { items: [], fingerprint: "empty" };
      },
      persist: async () => ({
        outcome: "created",
        externalId: 30347,
        links: {
          linksCreated: 1,
          linksUpdated: 0,
          linksReactivated: 0,
          linksMarkedAbsent: 1,
          salesOrderResolved: 0,
          salesOrderItemResolved: 0,
        },
        error: null,
      }),
      reconcilePending: async () => 2,
      logger: () => undefined,
    });
    assert.equal(summary.linksMarkedAbsent, 1);
    assert.equal(summary.unresolved, 1);
    assert.equal(summary.pendingLinksReconciled, 2);
    assert.equal(summary.completedCatalog, true);
  });

  it("preview não grava checkpoint", async () => {
    let wrote = false;
    const summary = await runProductionOrdersBackfillLoop({
      mode: "preview",
      options: {
        mode: "preview",
        pageSize: 10,
        maxPages: 1,
        hardMaxPages: 10,
        startPage: 1,
        reprocess: false,
        cursorFile: "/tmp/should-not-write",
      },
      startPage: 1,
      fetchPage: async () => ({
        items: [op(9)],
        fingerprint: "p1",
      }),
      persist: async () => ({
        outcome: "created",
        externalId: 9,
        links: {
          linksCreated: 1,
          linksUpdated: 0,
          linksReactivated: 0,
          linksMarkedAbsent: 0,
          salesOrderResolved: 1,
          salesOrderItemResolved: 1,
        },
        error: null,
      }),
      writeCheckpoint: () => {
        wrote = true;
      },
      logger: () => undefined,
    });
    assert.equal(summary.mode, "preview");
    assert.equal(wrote, false);
    assert.equal(summary.created, 1);
  });
  it("propaga rateLimitCount de 429 no runner", async () => {
    const { runNomusProductionOrdersBackfill } = await import(
      "@/src/lib/nomusProductionOrdersBackfill.server.js"
    );
    const counter = { count: 0 };
    const summary = await runNomusProductionOrdersBackfill({
      argv: ["preview", "--max-pages=1"],
      options: {
        mode: "preview",
        pageSize: 10,
        maxPages: 1,
        hardMaxPages: 10,
        startPage: 1,
        reprocess: true,
        cursorFile: null,
      },
      rateLimitCounter: counter,
      fetchPage: async () => {
        counter.count += 1; // simula 429 tratado pelo client HTTP
        return { items: [op(1)], fingerprint: "one" };
      },
      persist: async () => ({
        outcome: "created",
        externalId: 1,
        links: {
          linksCreated: 0,
          linksUpdated: 0,
          linksReactivated: 0,
          linksMarkedAbsent: 0,
          salesOrderResolved: 0,
          salesOrderItemResolved: 0,
        },
        error: null,
      }),
      logger: () => undefined,
    });
    assert.equal(summary.rateLimitCount, 1);
    assert.equal(summary.mode, "preview");
  });
});

describe("production orders backfill wiring", () => {
  it("comandos package.json existem e orquestrador/cron não incluem backfill OP", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["sync:nomus:production-orders:backfill:preview"] ?? "", /Backfill/);
    assert.match(pkg.scripts["sync:nomus:production-orders:backfill:apply"] ?? "", /Backfill/);

    const orchestrator = readFileSync(
      join(process.cwd(), "scripts/nomusSyncOrchestrator.ts"),
      "utf8"
    );
    assert.doesNotMatch(orchestrator, /production-orders:backfill/);
    assert.doesNotMatch(orchestrator, /nomusProductionOrdersBackfill/);
  });
});
