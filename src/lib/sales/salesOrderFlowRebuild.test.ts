import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireSalesOrderFlowRebuildLock,
  emptySalesOrderFlowRebuildSummary,
  exitCodeForSalesOrderFlowRebuildSummary,
  parseSalesOrderFlowRebuildCheckpoint,
  parseSalesOrderFlowRebuildCli,
  printSalesOrderFlowRebuildHelp,
  releaseSalesOrderFlowRebuildLock,
  serializeSalesOrderFlowRebuildCheckpoint,
  shouldAdvanceSalesOrderFlowRebuildCheckpoint,
} from "./salesOrderFlowRebuild.js";
import {
  listSalesOrderFlowRebuildCandidates,
  runSalesOrderFlowRebuild,
} from "./salesOrderFlowRebuild.server.js";
import type { RecomputeSalesOrderFlowResult } from "./salesOrderFlowRecompute.server.js";

const ORDER_A = "11111111-1111-4111-8111-111111111111";
const ORDER_B = "22222222-2222-4222-8222-222222222222";
const ORDER_C = "33333333-3333-4333-8333-333333333333";

function recomputeResult(
  partial: Partial<RecomputeSalesOrderFlowResult> & { salesOrderId: string }
): RecomputeSalesOrderFlowResult {
  return {
    action: "unchanged",
    reason: "fingerprint_match",
    computationVersion: "sales-order-flow/v1",
    orderFingerprint: "fp",
    previousOrderStage: null,
    currentOrderStage: "WAITING_NFE",
    computedAt: null,
    items: { total: 0, upserted: 0, created: 0, updated: 0, deleted: 0 },
    events: { attempted: 0, created: 0, duplicates: 0 },
    skippedWrite: true,
    ...partial,
  };
}

describe("salesOrderFlowRebuild CLI (OP-56)", () => {
  it("parseia argumentos principais", () => {
    const opts = parseSalesOrderFlowRebuildCli([
      "--apply",
      "--order=PD 02596",
      "--from=2026-01-01",
      "--to=2026-06-30",
      "--batch-size=25",
      "--include-completed",
      "--resume-from=PD 02000",
      "--checkpoint-file=tmp/x.checkpoint.json",
      "--lock-file=tmp/x.lock",
      "--max-batches=3",
    ]);
    assert.equal(opts.mode, "apply");
    assert.equal(opts.orderCode, "PD 02596");
    assert.equal(opts.fromDate?.toISOString().slice(0, 10), "2026-01-01");
    assert.equal(opts.toDate?.toISOString().slice(0, 10), "2026-06-30");
    assert.equal(opts.batchSize, 25);
    assert.equal(opts.includeCompleted, true);
    assert.equal(opts.resumeFrom, "PD 02000");
    assert.equal(opts.checkpointFile, "tmp/x.checkpoint.json");
    assert.equal(opts.lockFile, "tmp/x.lock");
    assert.equal(opts.maxBatches, 3);
  });

  it("default é preview; rejeita preview+apply", () => {
    assert.equal(parseSalesOrderFlowRebuildCli([]).mode, "preview");
    assert.throws(
      () => parseSalesOrderFlowRebuildCli(["--preview", "--apply"]),
      /apenas --preview ou --apply/
    );
  });

  it("help string menciona rebuild:sales-order-flow", () => {
    assert.match(printSalesOrderFlowRebuildHelp(), /rebuild:sales-order-flow/);
  });
});

describe("salesOrderFlowRebuild checkpoint/lock (OP-56)", () => {
  it("serialize/parse checkpoint", () => {
    const raw = serializeSalesOrderFlowRebuildCheckpoint({
      version: 1,
      lastSalesOrderId: ORDER_A,
      lastOrderCode: "PD 1",
      batchesCompleted: 2,
      ordersProcessed: 40,
      updatedAt: "2026-07-17T12:00:00.000Z",
    });
    const parsed = parseSalesOrderFlowRebuildCheckpoint(raw);
    assert.equal(parsed?.lastSalesOrderId, ORDER_A);
    assert.equal(parsed?.batchesCompleted, 2);
  });

  it("checkpoint só avança em apply com lote completo", () => {
    assert.equal(
      shouldAdvanceSalesOrderFlowRebuildCheckpoint({
        batchComplete: true,
        mode: "apply",
      }),
      true
    );
    assert.equal(
      shouldAdvanceSalesOrderFlowRebuildCheckpoint({
        batchComplete: false,
        mode: "apply",
      }),
      false
    );
    assert.equal(
      shouldAdvanceSalesOrderFlowRebuildCheckpoint({
        batchComplete: true,
        mode: "preview",
      }),
      false
    );
  });

  it("lock: segunda aquisição bloqueia; release libera", () => {
    const files = new Map<string, string>();
    const lockFile = "tmp/test-sof.lock";
    const fs = {
      existsFn: (p: string) => files.has(p),
      readFn: (p: string) => files.get(p)!,
      writeFn: (p: string, data: string) => {
        files.set(p, data);
      },
      unlinkFn: (p: string) => {
        files.delete(p);
      },
      mkdirFn: () => undefined,
    };

    const first = acquireSalesOrderFlowRebuildLock({
      lockFile,
      mode: "apply",
      pid: process.pid,
      ...fs,
    });
    assert.equal(first.ok, true);

    const second = acquireSalesOrderFlowRebuildLock({
      lockFile,
      mode: "apply",
      pid: process.pid,
      ...fs,
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "LOCK_HELD");

    assert.equal(
      releaseSalesOrderFlowRebuildLock({
        lockFile,
        token: first.ok ? first.token : "",
        ...fs,
      }),
      true
    );

    const third = acquireSalesOrderFlowRebuildLock({
      lockFile,
      mode: "apply",
      pid: process.pid,
      ...fs,
    });
    assert.equal(third.ok, true);
    if (third.ok) {
      releaseSalesOrderFlowRebuildLock({
        lockFile,
        token: third.token,
        ...fs,
      });
    }
  });

  it("exit codes", () => {
    const base = emptySalesOrderFlowRebuildSummary(
      parseSalesOrderFlowRebuildCli(["--preview"])
    );
    assert.equal(exitCodeForSalesOrderFlowRebuildSummary(base), 0);
    assert.equal(
      exitCodeForSalesOrderFlowRebuildSummary({ ...base, errors: 1 }),
      1
    );
    assert.equal(
      exitCodeForSalesOrderFlowRebuildSummary({ ...base, lockBlocked: true }),
      2
    );
  });
});

describe("runSalesOrderFlowRebuild (OP-56)", () => {
  function createListDb(rows: { id: string; orderCode: string }[]) {
    return {
      salesOrder: {
        findMany: async (args: {
          where?: { id?: { gt: string }; orderCode?: string };
          take?: number;
        }) => {
          let list = [...rows];
          if (args.where?.orderCode) {
            list = list.filter((r) => r.orderCode === args.where!.orderCode);
          }
          if (args.where?.id?.gt) {
            list = list.filter((r) => r.id > args.where!.id!.gt);
          }
          list.sort((a, b) => a.id.localeCompare(b.id));
          return list.slice(0, args.take ?? list.length);
        },
        findFirst: async (args: { where: { orderCode: string } }) =>
          rows.find((r) => r.orderCode === args.where.orderCode) ?? null,
      },
    };
  }

  it("preview não grava (dryRun) e não avança checkpoint", async () => {
    const checkpoints: string[] = [];
    const recomputes: Array<{ id: string; dryRun?: boolean }> = [];
    const db = createListDb([
      { id: ORDER_A, orderCode: "PD A" },
      { id: ORDER_B, orderCode: "PD B" },
    ]);

    const summary = await runSalesOrderFlowRebuild(
      db as never,
      parseSalesOrderFlowRebuildCli([
        "--preview",
        "--batch-size=10",
        "--checkpoint-file=tmp/preview.ckpt",
        "--max-batches=1",
      ]),
      {
        recompute: async (_db, id, options) => {
          recomputes.push({ id, dryRun: options.dryRun });
          return recomputeResult({ salesOrderId: id, action: "created", reason: "first_run" });
        },
        writeCheckpoint: (_path, content) => {
          checkpoints.push(content);
        },
        readCheckpoint: () => null,
        acquireLock: () => {
          throw new Error("lock não deve ser chamado em preview");
        },
      }
    );

    assert.equal(summary.mode, "preview");
    assert.equal(summary.ordersProcessed, 2);
    assert.equal(summary.created, 2);
    assert.equal(summary.checkpointAdvanced, false);
    assert.equal(checkpoints.length, 0);
    assert.ok(recomputes.every((r) => r.dryRun === true));
    assert.equal(summary.exitCode, 0);
  });

  it("apply chama recompute sem dryRun, avança checkpoint e é idempotente na 2ª execução", async () => {
    const files = new Map<string, string>();
    const db = createListDb([
      { id: ORDER_A, orderCode: "PD A" },
      { id: ORDER_B, orderCode: "PD B" },
    ]);
    let pass = 0;

    const io = {
      recompute: async (_db: unknown, id: string, options: { dryRun?: boolean }) => {
        assert.equal(options.dryRun, false);
        pass += 1;
        if (pass <= 2) {
          return recomputeResult({
            salesOrderId: id,
            action: "created",
            reason: "first_run",
            skippedWrite: false,
          });
        }
        return recomputeResult({ salesOrderId: id, action: "unchanged" });
      },
      readCheckpoint: (path: string) => files.get(path) ?? null,
      writeCheckpoint: (path: string, content: string) => {
        files.set(path, content);
      },
      acquireLock: acquireSalesOrderFlowRebuildLock,
      releaseLock: releaseSalesOrderFlowRebuildLock,
    };

    const lockStore = new Map<string, string>();
    const lockFs = {
      existsFn: (p: string) => lockStore.has(p),
      readFn: (p: string) => lockStore.get(p)!,
      writeFn: (p: string, d: string) => {
        lockStore.set(p, d);
      },
      unlinkFn: (p: string) => {
        lockStore.delete(p);
      },
      mkdirFn: () => undefined,
    };

    const first = await runSalesOrderFlowRebuild(
      db as never,
      parseSalesOrderFlowRebuildCli([
        "--apply",
        "--batch-size=10",
        "--checkpoint-file=tmp/apply.ckpt",
        "--lock-file=tmp/apply.lock",
        "--max-batches=1",
      ]),
      {
        ...io,
        acquireLock: (args) =>
          acquireSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
        releaseLock: (args) =>
          releaseSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
      }
    );

    assert.equal(first.created, 2);
    assert.equal(first.checkpointAdvanced, true);
    assert.ok(files.get("tmp/apply.ckpt"));
    assert.equal(first.exitCode, 0);

    const second = await runSalesOrderFlowRebuild(
      db as never,
      parseSalesOrderFlowRebuildCli([
        "--apply",
        "--batch-size=10",
        "--checkpoint-file=tmp/apply.ckpt",
        "--lock-file=tmp/apply.lock",
        "--max-batches=1",
        "--resume-from",
        ORDER_B,
      ]),
      {
        ...io,
        acquireLock: (args) =>
          acquireSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
        releaseLock: (args) =>
          releaseSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
      }
    );
    // resume after B → nenhum candidato
    assert.equal(second.ordersSelected, 0);
    assert.equal(second.ordersProcessed, 0);
  });

  it("lock bloqueia segunda apply concorrente", async () => {
    const lockStore = new Map<string, string>();
    const lockFs = {
      existsFn: (p: string) => lockStore.has(p),
      readFn: (p: string) => lockStore.get(p)!,
      writeFn: (p: string, d: string) => {
        lockStore.set(p, d);
      },
      unlinkFn: (p: string) => {
        lockStore.delete(p);
      },
      mkdirFn: () => undefined,
    };

    const held = acquireSalesOrderFlowRebuildLock({
      lockFile: "tmp/held.lock",
      mode: "apply",
      pid: process.pid,
      ...lockFs,
    });
    assert.ok(held.ok);

    const summary = await runSalesOrderFlowRebuild(
      createListDb([{ id: ORDER_A, orderCode: "PD A" }]) as never,
      parseSalesOrderFlowRebuildCli([
        "--apply",
        "--lock-file=tmp/held.lock",
        "--checkpoint-file=tmp/held.ckpt",
      ]),
      {
        acquireLock: (args) =>
          acquireSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
        releaseLock: (args) =>
          releaseSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
        recompute: async () => {
          throw new Error("não deve recomputar");
        },
      }
    );

    assert.equal(summary.lockBlocked, true);
    assert.equal(summary.exitCode, 2);
    if (held.ok) {
      releaseSalesOrderFlowRebuildLock({
        lockFile: "tmp/held.lock",
        token: held.token,
        ...lockFs,
      });
    }
  });

  it("erro isolado é reportado e não oculta; lote completo ainda avança checkpoint", async () => {
    const files = new Map<string, string>();
    const lockStore = new Map<string, string>();
    const lockFs = {
      existsFn: (p: string) => lockStore.has(p),
      readFn: (p: string) => lockStore.get(p)!,
      writeFn: (p: string, d: string) => {
        lockStore.set(p, d);
      },
      unlinkFn: (p: string) => {
        lockStore.delete(p);
      },
      mkdirFn: () => undefined,
    };

    const summary = await runSalesOrderFlowRebuild(
      createListDb([
        { id: ORDER_A, orderCode: "PD A" },
        { id: ORDER_B, orderCode: "PD B" },
      ]) as never,
      parseSalesOrderFlowRebuildCli([
        "--apply",
        "--batch-size=10",
        "--checkpoint-file=tmp/err.ckpt",
        "--lock-file=tmp/err.lock",
        "--max-batches=1",
      ]),
      {
        recompute: async (_db, id) => {
          if (id === ORDER_A) throw new Error("boom-A");
          return recomputeResult({
            salesOrderId: id,
            action: "updated",
            reason: "fingerprint_changed",
          });
        },
        readCheckpoint: (p) => files.get(p) ?? null,
        writeCheckpoint: (p, c) => {
          files.set(p, c);
        },
        acquireLock: (args) =>
          acquireSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
        releaseLock: (args) =>
          releaseSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
      }
    );

    assert.equal(summary.errors, 1);
    assert.equal(summary.errorReport[0]?.message, "boom-A");
    assert.equal(summary.updated, 1);
    assert.equal(summary.checkpointAdvanced, true);
    assert.equal(summary.exitCode, 1);
  });

  it("lote incompleto não avança checkpoint", async () => {
    const files = new Map<string, string>();
    const lockStore = new Map<string, string>();
    const lockFs = {
      existsFn: (p: string) => lockStore.has(p),
      readFn: (p: string) => lockStore.get(p)!,
      writeFn: (p: string, d: string) => {
        lockStore.set(p, d);
      },
      unlinkFn: (p: string) => {
        lockStore.delete(p);
      },
      mkdirFn: () => undefined,
    };
    let calls = 0;

    const summary = await runSalesOrderFlowRebuild(
      createListDb([
        { id: ORDER_A, orderCode: "PD A" },
        { id: ORDER_B, orderCode: "PD B" },
        { id: ORDER_C, orderCode: "PD C" },
      ]) as never,
      parseSalesOrderFlowRebuildCli([
        "--apply",
        "--batch-size=10",
        "--checkpoint-file=tmp/incomplete.ckpt",
        "--lock-file=tmp/incomplete.lock",
        "--max-batches=1",
      ]),
      {
        shouldAbortBatch: () => {
          calls += 1;
          return calls > 1;
        },
        recompute: async (_db, id) =>
          recomputeResult({
            salesOrderId: id,
            action: "created",
            reason: "first_run",
          }),
        readCheckpoint: (p) => files.get(p) ?? null,
        writeCheckpoint: (p, c) => {
          files.set(p, c);
        },
        acquireLock: (args) =>
          acquireSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
        releaseLock: (args) =>
          releaseSalesOrderFlowRebuildLock({ ...args, ...lockFs }),
      }
    );

    assert.equal(summary.checkpointAdvanced, false);
    assert.equal(files.has("tmp/incomplete.ckpt"), false);
    assert.equal(summary.ordersProcessed, 1);
  });

  it("retomada por resume-from usa cursor id >", async () => {
    const db = createListDb([
      { id: ORDER_A, orderCode: "PD A" },
      { id: ORDER_B, orderCode: "PD B" },
      { id: ORDER_C, orderCode: "PD C" },
    ]);
    const rows = await listSalesOrderFlowRebuildCandidates(
      db as never,
      parseSalesOrderFlowRebuildCli(["--preview", "--batch-size=10"]),
      ORDER_A
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [ORDER_B, ORDER_C]
    );
  });
});
