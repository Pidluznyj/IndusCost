/**
 * Concorrência real das comissões N:N num PostgreSQL 17 descartável (multi-conexão e
 * multiprocesso): dois processos fechando a mesma competência, trava do trigger de
 * cobertura (evento × direito), índice parcial sob corrida, rollback transacional do
 * fechamento e materialização simultânea. Só funções oficiais; dados sintéticos.
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npm run test:commissions:pg
 * (sem a variável o suite é pulado: PGlite tem conexão única e não prova concorrência).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  assertPrismaOnTestDatabase,
  commissionPg17BinDir,
  startCommissionPostgres17,
  type CommissionPg17Database,
} from "../../../scripts/testing/commissionPostgresHarness.js";
import { addReceipts, seedCommissionScenario, type SeedScenario } from "../../../scripts/testing/commissionNnScenarioSeed.js";

const pg17Bin = commissionPg17BinDir();
const SKIP = pg17Bin ? false : "COMMISSION_PG17_BIN ausente: concorrência exige um PostgreSQL 17 servidor (multi-conexão) — não executada.";
const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..", "..", "..");
const num = (value: unknown) => Number(value ?? 0);

type WorkerResult = { ok: boolean; code?: string | null; message?: string; closingId?: string; lineCount?: number; errors?: string[]; ms: number };

describe("N:N de comissões — concorrência no PostgreSQL 17", { skip: SKIP }, () => {
  let database: CommissionPg17Database;
  let prisma: PrismaClient;
  let closingServer: typeof import("./commissionReceiptClosing.server.js");
  let orchestrator: typeof import("./commissionMaterializationOrchestrator.server.js");
  let orderIds: string[] = [];

  /** Dois (ou mais) processos Node, cada um com seu pool, disparados no mesmo instante. */
  const runWorkers = (argsList: string[][]): Promise<WorkerResult[]> => {
    const startAt = Date.now() + 4000;
    return Promise.all(
      argsList.map(
        (args) =>
          new Promise<WorkerResult>((resolveRun, reject) => {
            const child = spawn(process.execPath, [join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs"), join(REPO_ROOT, "scripts/testing/commissionPgWorker.ts"), ...args], {
              cwd: REPO_ROOT,
              env: { ...process.env, START_AT: String(startAt), COMMISSION_PG_MARKER: database.validation.marker, DATABASE_URL: database.url },
            });
            let output = "";
            child.stdout.on("data", (chunk) => (output += chunk));
            child.stderr.on("data", (chunk) => (output += chunk));
            child.on("error", reject);
            child.on("close", () => {
              const line = output.split("\n").find((row) => row.startsWith("RESULT "));
              if (!line) return reject(new Error(`worker sem resultado: ${output.slice(-1500)}`));
              resolveRun(JSON.parse(line.slice(7)) as WorkerResult);
            });
          })
      )
    );
  };

  const scenario: SeedScenario = {
    sellers: [
      { nomusId: 8101, name: "VENDEDOR CONCORRÊNCIA 1" },
      { nomusId: 8102, name: "VENDEDOR CONCORRÊNCIA 2" },
      { nomusId: 8103, name: "VENDEDOR CONCORRÊNCIA 3" },
    ],
    products: [{ key: "PC", externalId: 9801, ratePercent: 3 }],
    orders: [1, 2, 3].map((index) => ({
      key: `C${index}`,
      code: `081${index}0`,
      externalId: 8100 + index,
      sellerNomusId: 8100 + index,
      issueDate: "2026-09-10",
      items: [{ key: "i", productKey: "PC", quantity: 1, unitPrice: 1000 * index, nomusItemExternalId: 810000 + index }],
    })),
    nfes: [
      { externalId: 8191, numero: "8191", processedAt: "2026-10-02", orderKeys: ["C1", "C2", "C3"], titles: [{ externalId: 81911, amount: 6000, due: "2026-10-20" }, { externalId: 81912, amount: 3000, due: "2026-11-20" }] },
    ],
    receipts: [{ externalId: 81911001, titleExternalId: 81911, date: "2026-10-21", amount: 6000 }],
  };

  before(async () => {
    database = await startCommissionPostgres17(pg17Bin!);
    prisma = new PrismaClient({ datasourceUrl: database.poolUrl(8) });
    await assertPrismaOnTestDatabase(prisma, database.validation.marker);
    (globalThis as unknown as { prisma: PrismaClient }).prisma = prisma;
    process.env.DATABASE_URL = database.url;
    closingServer = await import("./commissionReceiptClosing.server.js");
    orchestrator = await import("./commissionMaterializationOrchestrator.server.js");
    const ids = await seedCommissionScenario(prisma, scenario);
    orderIds = [...ids.orderIdByKey.values()];
    console.log(`[pg17] ${database.validation.engine.slice(0, 40)} · 127.0.0.1:${database.validation.port} · marcador ${database.validation.marker}`);
  });

  after(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  it("materialização simultânea em dois processos: um snapshot ACTIVE por (pedido, NF-e), schedules sem duplicata", async () => {
    const results = await runWorkers([
      ["rebuild", database.poolUrl(4), orderIds.join(",")],
      ["rebuild", database.poolUrl(4), orderIds.join(",")],
    ]);
    console.log(`[pg17] rebuild simultâneo: ${JSON.stringify(results)}`);
    assert.ok(results.every((row) => row.ok), `corrida resolvida sem erro (o perdedor aceita o snapshot idêntico): ${JSON.stringify(results)}`);
    const active = await prisma.commissionOrderSnapshot.groupBy({ by: ["salesOrderId", "nfeId"], where: { status: "ACTIVE", salesOrderId: { in: orderIds } }, _count: { _all: true } });
    assert.equal(active.length, 3);
    assert.ok(active.every((row) => row._count._all === 1), "nunca dois snapshots ACTIVE do mesmo (pedido, NF-e)");
    const schedules = await prisma.commissionReceivableSchedule.groupBy({ by: ["salesOrderId", "receivableId"], where: { status: "ACTIVE", salesOrderId: { in: orderIds } }, _count: { _all: true } });
    const allSchedules = await prisma.commissionReceivableSchedule.findMany({ where: { salesOrderId: { in: orderIds } }, select: { salesOrderId: true, receivableId: true, status: true, orderSnapshotId: true, sourceHash: true }, orderBy: [{ salesOrderId: "asc" }, { receivableId: "asc" }] });
    const allSnapshots = await prisma.commissionOrderSnapshot.findMany({ where: { salesOrderId: { in: orderIds } }, select: { id: true, salesOrderId: true, status: true } });
    assert.ok(schedules.length === 6 && schedules.every((row) => row._count._all === 1), JSON.stringify({ schedules: allSchedules, snapshots: allSnapshots }));
    // A rematerialização seguinte não muda nada.
    const again = await orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: orderIds, apply: true });
    assert.deepEqual(again.errors, []);
    assert.equal(again.snapshotsCreated + again.schedulesCreated, 0);
  });

  it("dois processos fechando outubro ao mesmo tempo: exatamente um fechamento, ledger e cobertura sem duplicata", async () => {
    const results = await runWorkers([
      ["apply", database.poolUrl(4), "2026", "10"],
      ["apply", database.poolUrl(4), "2026", "10"],
    ]);
    console.log(`[pg17] fechamento simultâneo: ${JSON.stringify(results)}`);
    assert.equal(results.filter((row) => row.ok).length, 1, "um vence");
    const loser = results.find((row) => !row.ok)!;
    assert.ok(loser, "o outro é recusado");
    assert.match(`${loser.code} ${loser.message}`, /DUPLICATE|duplic|já existe|Unique constraint|P2002|ALREADY|CLOSED/i);
    const closings = await prisma.commissionMonthlyClosing.findMany({ where: { year: 2026, month: 10, status: "CLOSED" } });
    assert.equal(closings.length, 1);
    const lines = await prisma.commissionReceiptLedgerLine.findMany({ where: { closingId: closings[0]!.id } });
    assert.equal(lines.length, 3, "um direito por pedido, uma vez");
    assert.equal(lines.filter((line) => line.closingId !== closings[0]!.id).length, 0);
    const coverage = await prisma.commissionReceiptCoverage.findMany({ where: { receiptExternalId: 81911001, coverageStatus: "COVERED" } });
    assert.equal(coverage.length, 3);
    assert.equal(Math.round(coverage.reduce((acc, row) => acc + num(row.coveredReceivedAmount), 0) * 100) / 100, 6000, "evento consumido uma vez");
    // Última barreira no banco: um segundo CLOSED do mesmo mês cai no índice parcial único.
    const { id: _closingId, createdAt: _cc, updatedAt: _cu, supersededByClosingId: _sb, ...closingRow } = closings[0]! as Record<string, unknown>;
    await assert.rejects(prisma.commissionMonthlyClosing.create({ data: closingRow as never }), (error: unknown) => (error as { code?: string }).code === "P2002");
    // Reaplicação posterior: recusada sem tocar no que foi gravado.
    await assert.rejects(closingServer.applyCommissionReceiptClosing(prisma, { year: 2026, month: 10, userId: "teste" }));
    assert.equal(await prisma.commissionReceiptLedgerLine.count({ where: { year: 2026, month: 10 } }), 3);
  });

  it("trigger com trava: cobertura do evento inteiro espera a do direito e é recusada; direito repetido cai no índice parcial", async () => {
    const template = (await prisma.commissionReceiptCoverage.findFirstOrThrow({ where: { receiptExternalId: 81911001, coverageStatus: "COVERED" } })) as Record<string, unknown>;
    const { id: _id, createdAt: _c, updatedAt: _u, ledgerLineId: _l, closingId: _cl, ...rest } = template;
    const base = { ...rest, receiptExternalId: 81990001 } as never;
    const clientA = new PrismaClient({ datasourceUrl: database.poolUrl(1) });
    const clientB = new PrismaClient({ datasourceUrl: database.poolUrl(1) });
    try {
      const startedB = { at: 0 };
      const txA = clientA.$transaction(
        async (tx) => {
          await tx.commissionReceiptCoverage.create({ data: { ...(base as object), salesOrderId: orderIds[0] } as never });
          await tx.$executeRawUnsafe("select pg_sleep(1.5)");
        },
        { timeout: 20_000 }
      );
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      startedB.at = Date.now();
      const txB = clientB.$transaction(
        async (tx) => {
          await tx.commissionReceiptCoverage.create({ data: { ...(base as object), salesOrderId: null } as never });
        },
        { timeout: 20_000 }
      );
      const [a, b] = await Promise.allSettled([txA, txB]);
      const waitedMs = Date.now() - startedB.at;
      assert.equal(a.status, "fulfilled");
      assert.equal(b.status, "rejected", "evento inteiro recusado sobre evento com direito coberto");
      // O Prisma traduz o unique_violation do trigger em P2002 (sem o nome da constraint): só
      // o trigger pode recusar aqui — o índice do evento ignora linhas com pedido.
      assert.equal(((b as PromiseRejectedResult).reason as { code?: string }).code, "P2002");
      assert.ok(waitedMs >= 900, `B esperou a trava de A (${waitedMs} ms)`);
      // Mesmo direito em duas transações: o índice parcial único barra o segundo.
      const dupA = clientA.$transaction(async (tx) => {
        await tx.commissionReceiptCoverage.create({ data: { ...(base as object), receiptExternalId: 81990002, salesOrderId: orderIds[1] } as never });
        await tx.$executeRawUnsafe("select pg_sleep(1)");
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      const dupB = clientB.$transaction(async (tx) => {
        await tx.commissionReceiptCoverage.create({ data: { ...(base as object), receiptExternalId: 81990002, salesOrderId: orderIds[1] } as never });
      });
      const [da, db] = await Promise.allSettled([dupA, dupB]);
      assert.equal(da.status, "fulfilled");
      assert.equal(db.status, "rejected");
      assert.match(String((db as PromiseRejectedResult).reason), /Unique constraint|receipt_right_covered_key|P2002/);
      assert.equal(await prisma.commissionReceiptCoverage.count({ where: { receiptExternalId: { in: [81990001, 81990002] } } }), 2);
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }
  });

  it("rollback transacional: falha no meio da gravação desfaz fechamento, ledger e cobertura de novembro", async () => {
    await addReceipts(prisma, [{ externalId: 81912001, titleExternalId: 81912, date: "2026-11-05", amount: 3000 }]);
    // Falha injetada só na cobertura do 3º pedido (depois do fechamento e do ledger gravados).
    await database.exec(`
      CREATE OR REPLACE FUNCTION "__test_fail_coverage"() RETURNS trigger AS $$
      BEGIN
        IF NEW."receiptExternalId" = 81912001 AND NEW."salesOrderId" = '${orderIds[2]}' THEN
          RAISE EXCEPTION 'falha injetada no meio da aplicação';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER "__test_fail_coverage_trg" BEFORE INSERT ON "CommissionReceiptCoverage" FOR EACH ROW EXECUTE FUNCTION "__test_fail_coverage"();
    `);
    try {
      await assert.rejects(closingServer.applyCommissionReceiptClosing(prisma, { year: 2026, month: 11, userId: "teste" }), /falha injetada/);
      assert.equal(await prisma.commissionMonthlyClosing.count({ where: { year: 2026, month: 11 } }), 0, "fechamento desfeito");
      assert.equal(await prisma.commissionReceiptLedgerLine.count({ where: { year: 2026, month: 11 } }), 0, "ledger desfeito");
      assert.equal(await prisma.commissionReceiptCoverage.count({ where: { receiptExternalId: 81912001 } }), 0, "cobertura desfeita");
    } finally {
      await database.exec(`DROP TRIGGER "__test_fail_coverage_trg" ON "CommissionReceiptCoverage"; DROP FUNCTION "__test_fail_coverage"();`);
    }
    const result = await closingServer.applyCommissionReceiptClosing(prisma, { year: 2026, month: 11, userId: "teste" });
    assert.ok(result.closingId, "sem a falha, a mesma aplicação conclui");
  });
});
