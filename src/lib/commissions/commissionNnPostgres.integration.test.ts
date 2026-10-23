/**
 * Integração de ponta a ponta das comissões N:N (B1–B5) num PostgreSQL efêmero.
 *
 * Fluxo real, só com funções oficiais: pedido → NF-e (N:N) → documento de saída →
 * título → recebimento → materialização (snapshot + schedule) → prévia → aplicação
 * do fechamento (ledger + cobertura, em transação) → reaplicação recusada → mês
 * seguinte (pendências) → Previsão. Banco via scripts/testing/commissionPostgresHarness.ts —
 * dados 100% sintéticos:
 *   - COMMISSION_PG17_BIN=<bin do PostgreSQL 17> → servidor PostgreSQL 17 real e
 *     descartável, pool de várias conexões (preferido: mesma versão da produção);
 *   - senão COMMISSION_PG_HARNESS_MODULES=<dir com @electric-sql/pglite e pglite-socket>
 *     → PGlite em memória, conexão única.
 * Executar: npm run test:commissions:pg. Sem nenhuma das variáveis o suite é pulado.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { summarizeLinesByOrderAndNfe } from "./commissionReceiptFinancialAnchor.shared.js";
import {
  assertPrismaOnTestDatabase,
  commissionPg17BinDir,
  commissionPgHarnessModulesDir,
  startCommissionPostgres17,
  startCommissionTestDatabase,
  type CommissionTestDatabase,
} from "../../../scripts/testing/commissionPostgresHarness.js";
import {
  addOutputDocument,
  addReceipts,
  seedCommissionScenario,
  seededRandom,
  type SeedOrder,
  type SeedScenario,
} from "../../../scripts/testing/commissionNnScenarioSeed.js";

const pg17Bin = commissionPg17BinDir();
const modulesDir = commissionPgHarnessModulesDir();
const SKIP =
  pg17Bin || modulesDir
    ? false
    : "COMMISSION_PG17_BIN e COMMISSION_PG_HARNESS_MODULES ausentes: PostgreSQL efêmero indisponível — integração não executada.";
/** Conexões do pool do cliente oficial (PostgreSQL 17: concorrência real; PGlite: 1). */
const POOL = pg17Bin ? 8 : 1;

const round2 = (value: number) => Math.round(value * 100) / 100;
const sum = (values: number[]) => round2(values.reduce((acc, value) => acc + value, 0));
const num = (value: unknown) => Number(value ?? 0);

type Modules = {
  orchestrator: typeof import("./commissionMaterializationOrchestrator.server.js");
  engine: typeof import("./commissionReceiptEngine.server.js");
  closingServer: typeof import("./commissionReceiptClosing.server.js");
  closing: typeof import("./commissionReceiptClosing.js");
  outlookServer: typeof import("./commissionPortfolioOutlook.server.js");
  outlook: typeof import("./commissionPortfolioOutlook.js");
  payments: typeof import("./commission-payment-service.server.js");
};

describe("N:N de comissões — PostgreSQL efêmero, fluxo oficial completo", { skip: SKIP }, () => {
  let database: CommissionTestDatabase;
  let prisma: PrismaClient;
  let m: Modules;
  let queryCount = 0;

  before(async () => {
    if (pg17Bin) {
      const pg17 = await startCommissionPostgres17(pg17Bin);
      database = pg17;
      prisma = new PrismaClient({ datasourceUrl: pg17.poolUrl(POOL), log: [{ emit: "event", level: "query" }] });
    } else {
      database = await startCommissionTestDatabase(modulesDir!);
      prisma = new PrismaClient({ datasourceUrl: database.url, log: [{ emit: "event", level: "query" }] });
    }
    (prisma as unknown as { $on: (event: "query", cb: () => void) => void }).$on("query", () => {
      queryCount += 1;
    });
    await assertPrismaOnTestDatabase(prisma, database.validation.marker);
    // Os módulos oficiais usam o singleton global: instala o cliente do banco efêmero
    // ANTES de importá-los (nenhuma conexão com outro banco é criada).
    (globalThis as unknown as { prisma: PrismaClient }).prisma = prisma;
    process.env.DATABASE_URL = database.url;
    m = {
      orchestrator: await import("./commissionMaterializationOrchestrator.server.js"),
      engine: await import("./commissionReceiptEngine.server.js"),
      closingServer: await import("./commissionReceiptClosing.server.js"),
      closing: await import("./commissionReceiptClosing.js"),
      outlookServer: await import("./commissionPortfolioOutlook.server.js"),
      outlook: await import("./commissionPortfolioOutlook.js"),
      payments: await import("./commission-payment-service.server.js"),
    };
    console.log(
      `[pg] banco efêmero: ${database.validation.host}:${database.validation.port}/${database.validation.database} · ${database.validation.engine.slice(0, 32)} · marcador ${database.validation.marker}`
    );
  });

  after(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  const materialize = (year: number, month: number) =>
    m.orchestrator.ensureCommissionMaterializationForReceiptMonth(prisma, { year, month, apply: true });
  const ledgerOf = (year: number, month: number) =>
    prisma.commissionReceiptLedgerLine.findMany({
      where: { year, month, closing: { status: "CLOSED" } },
      orderBy: [{ nomusReceivableId: "asc" }, { orderCode: "asc" }],
    });
  const coverageOf = (receiptExternalId: number) =>
    prisma.commissionReceiptCoverage.findMany({
      where: { receiptExternalId, coverageStatus: "COVERED" },
      orderBy: [{ salesOrderId: "asc" }],
    });

  /* ---------------------------------------------------------------- */
  it("isolamento: só o banco efêmero em 127.0.0.1 (PostgreSQL 17 descartável ou PGlite), marcador lido pelo Prisma", () => {
    assert.equal(database.validation.host, "127.0.0.1");
    assert.match(database.validation.engine, pg17Bin ? /^PostgreSQL 17\./ : /PGlite/);
    assert.equal(database.validation.envDatabaseUrlDiffers, true);
  });

  it("migrations: índices de cobertura por evento e por direito + trigger de exclusão mútua", async () => {
    const indexes = await database.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'CommissionReceiptCoverage' and indexname like '%covered_key' order by 1`
    );
    assert.deepEqual(indexes.map((row) => row.indexname), [
      "CommissionReceiptCoverage_receipt_event_covered_key",
      "CommissionReceiptCoverage_receipt_right_covered_key",
    ]);
    const trigger = await database.query(`select 1 from pg_trigger where tgname = 'CommissionReceiptCoverage_scope_guard'`);
    assert.equal(trigger.length, 1);
  });

  /* ---------------------------------------------------------------- */
  describe("regressão NF-e 7862 (PD 02933 + PD 02997, vendedora 464)", () => {
    const scenario: SeedScenario = {
      sellers: [{ nomusId: 464, name: "VENDEDORA SINTÉTICA 464" }],
      products: [
        { key: "P1", externalId: 9101, ratePercent: 2.9955 },
        { key: "P2", externalId: 9102, ratePercent: 3.1127 },
      ],
      orders: [
        { key: "A", code: "02933", externalId: 2934, sellerNomusId: 464, issueDate: "2026-09-20", items: [{ key: "i", productKey: "P1", quantity: 1, unitPrice: 3045.9, nomusItemExternalId: 293401 }] },
        { key: "B", code: "02997", externalId: 2998, sellerNomusId: 464, issueDate: "2026-09-25", items: [{ key: "i", productKey: "P2", quantity: 1, unitPrice: 10395, nomusItemExternalId: 299801 }] },
      ],
      nfes: [
        {
          externalId: 8204,
          numero: "7862",
          processedAt: "2026-10-01",
          orderKeys: ["A", "B"],
          titles: [
            { externalId: 19809, amount: 4435.5, due: "2026-10-18" },
            { externalId: 19810, amount: 4435.5, due: "2026-11-02" },
            { externalId: 19811, amount: 4569.9, due: "2026-11-17" },
          ],
        },
      ],
      receipts: [{ externalId: 12130, titleExternalId: 19809, date: "2026-10-20", amount: 4435.5 }],
    };
    let ids: Awaited<ReturnType<typeof seedCommissionScenario>>;

    before(async () => {
      ids = await seedCommissionScenario(prisma, scenario);
    });

    it("materialização oficial: 2 snapshots, 6 schedules com R$ 30,11/106,78 · 30,11/106,78 · 31,02/110,01", async () => {
      await materialize(2026, 10);
      const schedules = await prisma.commissionReceivableSchedule.findMany({
        where: { receivableId: { in: [19809, 19810, 19811] }, status: "ACTIVE", orderSnapshot: { status: "ACTIVE" } },
        include: { salesOrder: { select: { orderCode: true } } },
        orderBy: [{ receivableId: "asc" }],
      });
      const table = [19809, 19810, 19811].map((cr) =>
        schedules
          .filter((row) => row.receivableId === cr)
          .sort((a, b) => a.salesOrder.orderCode.localeCompare(b.salesOrder.orderCode))
          .map((row) => num(row.scheduledCommissionAmount))
      );
      assert.deepEqual(table, [
        [30.11, 106.78],
        [30.11, 106.78],
        [31.02, 110.01],
      ]);
      const snapshots = await prisma.commissionOrderSnapshot.findMany({ where: { status: "ACTIVE", nfeId: 8204 } });
      assert.equal(snapshots.length, 2);
      assert.deepEqual(snapshots.map((row) => num(row.totalFinalCommissionAmount)).sort((a, b) => a - b), [91.24, 323.57]);
    });

    it("prévia oficial: duas linhas da vendedora 464, R$ 136,89 liberados, R$ 4.435,50 recebidos uma vez", async () => {
      const payload = await m.closingServer.previewCommissionReceiptClosing({ year: 2026, month: 10 }, { includeCarryover: true });
      assert.equal(payload.canApply, true, payload.applyBlockedReason ?? "");
      const lines = payload.preview.lines.filter((line) => line.nomusReceivableId === 19809);
      assert.deepEqual(
        lines.map((line) => [line.orderCode, line.status, line.canonicalSellerName, line.releasedCommissionAmount]),
        [
          ["02933", "COMMISSIONABLE", "VENDEDORA SINTÉTICA 464", 30.11],
          ["02997", "COMMISSIONABLE", "VENDEDORA SINTÉTICA 464", 106.78],
        ]
      );
      assert.equal(payload.preview.totalReceivedAmount, 4435.5);
      assert.equal(payload.preview.totalReleasedCommission, 136.89);
    });

    it("aplicação oficial: ledger com pedido/schedule, cobertura por direito somando R$ 136,89 e R$ 4.435,50", async () => {
      const result = await m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2026, month: 10, userId: "teste-integracao" });
      assert.equal(result.lineCount, 2);
      const ledger = await ledgerOf(2026, 10);
      assert.deepEqual(ledger.map((row) => [row.orderCode, row.salesOrderId, num(row.releasedCommissionAmount)]), [
        ["02933", ids.orderIdByKey.get("A"), 30.11],
        ["02997", ids.orderIdByKey.get("B"), 106.78],
      ]);
      assert.ok(ledger.every((row) => row.commissionReceivableScheduleId != null));
      assert.equal(sum(ledger.map((row) => num(row.allocatedReceivedAmount))), 4435.5);
      const coverage = await coverageOf(12130);
      assert.equal(coverage.length, 2);
      assert.equal(sum(coverage.map((row) => num(row.coveredCommissionAmount))), 136.89);
      assert.equal(sum(coverage.map((row) => num(row.coveredReceivedAmount))), 4435.5);
      assert.deepEqual(new Set(coverage.map((row) => row.salesOrderId)), new Set([ids.orderIdByKey.get("A"), ids.orderIdByKey.get("B")]));
    });

    it("reaplicação recusada e fechamento CLOSED intocado mesmo com nova sincronização/materialização", async () => {
      const ledgerBefore = JSON.stringify(await ledgerOf(2026, 10));
      const coverageBefore = JSON.stringify(await coverageOf(12130));
      const schedulesBefore = await prisma.commissionReceivableSchedule.count();
      const snapshotsBefore = await prisma.commissionOrderSnapshot.count();
      await assert.rejects(
        m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2026, month: 10, userId: "teste-integracao" }),
        (error: unknown) => error instanceof m.closing.ReceiptClosingDuplicateError
      );
      // Idempotência: rematerializar sem mudança de origem não cria direitos.
      await materialize(2026, 10);
      await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [...ids.orderIdByKey.values()], apply: true });
      assert.equal(await prisma.commissionReceivableSchedule.count(), schedulesBefore);
      assert.equal(await prisma.commissionOrderSnapshot.count(), snapshotsBefore);
      // Mudança posterior da origem: novo recebimento no mês fechado.
      await addReceipts(prisma, [{ externalId: 12131, titleExternalId: 19810, date: "2026-10-28", amount: 4435.5 }]);
      await materialize(2026, 10);
      await m.closingServer.previewCommissionReceiptClosing({ year: 2026, month: 10 }, { includeCarryover: true });
      assert.equal(JSON.stringify(await ledgerOf(2026, 10)), ledgerBefore);
      assert.equal(JSON.stringify(await coverageOf(12130)), coverageBefore);
    });

    it("mês seguinte: o recebimento novo entra como pendência só uma vez, sem recriar o direito já consumido", async () => {
      const preview = await m.closingServer.previewCommissionReceiptClosing({ year: 2026, month: 11 }, { includeCarryover: true });
      const rows = preview.carryover?.rows ?? [];
      assert.deepEqual(rows.map((row) => row.receiptExternalIds), [[12131]]);
      assert.equal(rows[0]!.includable, true, rows[0]!.blockedReason ?? "");
      await m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2026, month: 11, userId: "teste-integracao", carryoverReceiptIds: [12131] });
      const november = await ledgerOf(2026, 11);
      assert.deepEqual(november.map((row) => [row.inclusionType, row.orderCode, num(row.releasedCommissionAmount)]), [
        ["LATE_CARRYOVER", "02933", 30.11],
        ["LATE_CARRYOVER", "02997", 106.78],
      ]);
      assert.equal((await coverageOf(12130)).length, 2, "evento de outubro não é coberto de novo");
      assert.equal((await coverageOf(12131)).length, 2);
    });
  });

  /* ---------------------------------------------------------------- */
  describe("B4 — status misto: cobre o direito resolvido e mantém o pendente até resolver", () => {
    const scenario: SeedScenario = {
      sellers: [
        { nomusId: 464, name: "VENDEDORA SINTÉTICA 464" },
        { nomusId: 999, name: "VENDEDOR AINDA SEM CADASTRO", registered: false },
      ],
      products: [{ key: "P4", externalId: 9104, ratePercent: 3 }],
      orders: [
        { key: "C", code: "04101", externalId: 4101, sellerNomusId: 464, issueDate: "2026-09-10", items: [{ key: "i", productKey: "P4", quantity: 1, unitPrice: 3000, nomusItemExternalId: 410101 }] },
        { key: "D", code: "04102", externalId: 4102, sellerNomusId: 999, issueDate: "2026-09-10", items: [{ key: "i", productKey: "P4", quantity: 1, unitPrice: 1000, nomusItemExternalId: 410201 }] },
      ],
      nfes: [{ externalId: 8410, numero: "8410", processedAt: "2026-10-02", orderKeys: ["C", "D"], titles: [{ externalId: 84101, amount: 4000, due: "2026-10-10" }] }],
      receipts: [{ externalId: 84101001, titleExternalId: 84101, date: "2026-10-11", amount: 4000 }],
    };
    let ids: Awaited<ReturnType<typeof seedCommissionScenario>>;

    before(async () => {
      ids = await seedCommissionScenario(prisma, scenario);
    });

    it("outubro (reprocessado): cobre só o pedido C; o pedido D, sem vendedor resolvido, segue pendente", async () => {
      // Outubro já está fechado (cenário anterior): reprocessa pelo fluxo oficial.
      await materialize(2026, 10);
      const result = await m.closingServer.reprocessCommissionReceiptClosingApply(prisma, {
        year: 2026,
        month: 10,
        userId: "teste-integracao",
        reason: "teste de status misto",
      });
      assert.ok(result.closingId);
      const lines = (await ledgerOf(2026, 10)).filter((row) => row.nomusReceivableId === 84101);
      assert.deepEqual(lines.map((row) => [row.orderCode, row.status]), [
        ["04101", "COMMISSIONABLE"],
        ["04102", "SELLER_UNRESOLVED"],
      ]);
      const coverage = await coverageOf(84101001);
      assert.deepEqual(coverage.map((row) => row.salesOrderId), [ids.orderIdByKey.get("C")]);
      assert.equal(num(coverage[0]!.coveredCommissionAmount), 90);
      assert.equal(num(coverage[0]!.coveredReceivedAmount), 3000);
      // O reprocessamento manteve a cobertura da NF-e 7862 (substituída pela nova, mesmo valor).
      assert.equal(sum((await coverageOf(12130)).map((row) => num(row.coveredCommissionAmount))), 136.89);
    });

    it("novembro: com o vendedor cadastrado, só o direito de D entra como pendência; C não é pago de novo", async () => {
      const person = await prisma.commissionPerson.create({ data: { name: "VENDEDOR CADASTRADO DEPOIS", type: "SELLER", nomusPersonId: 999, source: "NOMUS", active: true } });
      await prisma.commissionPersonAlias.create({
        data: { commissionedPersonId: person.id, source: "NOMUS_ORDER", rawSellerId: 999, rawSellerName: "VENDEDOR CADASTRADO DEPOIS", normalizedSellerName: "VENDEDOR CADASTRADO DEPOIS", status: "ACTIVE", confidence: 1 },
      });
      await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [ids.orderIdByKey.get("D")!], apply: true });
      // Novembro já foi fechado no cenário anterior: reprocessa incluindo a pendência.
      const preview = await m.closingServer.reprocessCommissionReceiptClosingPreview({ year: 2026, month: 11 });
      void preview;
      const carry = await m.closingServer.previewCommissionReceiptClosing({ year: 2026, month: 12 }, { includeCarryover: true, carryoverReceiptIds: [84101001] });
      const row = (carry.carryover?.rows ?? []).find((candidate) => candidate.receiptExternalIds.includes(84101001));
      assert.ok(row, "recebimento com direito pendente volta como pendência");
      assert.equal(row!.includable, true, row!.blockedReason ?? "");
      // D: 1 × R$ 1.000 a 3% (produto P4) = R$ 30.
      assert.equal(row!.commissionAmount, 30);
      await m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2026, month: 12, userId: "teste-integracao", carryoverReceiptIds: [84101001] });
      const december = (await ledgerOf(2026, 12)).filter((line) => line.nomusReceivableId === 84101);
      assert.deepEqual(december.map((line) => [line.orderCode, num(line.releasedCommissionAmount)]), [["04102", 30]]);
      const coverage = await coverageOf(84101001);
      assert.deepEqual(
        coverage.map((line) => [line.salesOrderId, num(line.coveredCommissionAmount), num(line.coveredReceivedAmount)]),
        [
          [ids.orderIdByKey.get("C"), 90, 3000],
          [ids.orderIdByKey.get("D"), 30, 1000],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      );
      assert.equal(sum(coverage.map((line) => num(line.coveredReceivedAmount))), 4000, "evento consumido uma vez");
    });

    it("banco recusa cobertura do evento inteiro sobre evento já coberto por direito (trigger) e direito repetido (índice)", async () => {
      const base = (await coverageOf(84101001))[0]!;
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = base;
      await assert.rejects(prisma.commissionReceiptCoverage.create({ data: { ...rest, salesOrderId: null } }));
      await assert.rejects(prisma.commissionReceiptCoverage.create({ data: { ...rest } }));
    });
  });

  /* ---------------------------------------------------------------- */
  describe("B5 — pedido de R$ 30.000 faturado em três NF-e (8/12/10 mil)", () => {
    const order: SeedOrder = {
      key: "X",
      code: "05001",
      externalId: 5001,
      sellerNomusId: 470,
      issueDate: "2026-09-01",
      items: [{ key: "i", productKey: "P5", quantity: 30, unitPrice: 1000, nomusItemExternalId: 500101 }],
    };
    const scenario: SeedScenario = {
      sellers: [{ nomusId: 470, name: "VENDEDOR SINTÉTICO 470" }],
      products: [{ key: "P5", externalId: 9105, ratePercent: 4 }],
      orders: [order],
      nfes: [
        { externalId: 9701, numero: "9701", processedAt: "2026-10-02", orderKeys: ["X"], titles: [{ externalId: 97011, amount: 8000, due: "2026-10-15" }], documents: [{ externalId: 970101, lines: [{ orderKey: "X", itemKey: "i", quantity: 8 }] }] },
        { externalId: 9702, numero: "9702", processedAt: "2026-10-12", orderKeys: ["X"], titles: [{ externalId: 97021, amount: 12000, due: "2026-10-25" }], documents: [{ externalId: 970201, lines: [{ orderKey: "X", itemKey: "i", quantity: 12 }] }] },
        { externalId: 9703, numero: "9703", processedAt: "2026-10-22", orderKeys: ["X"], titles: [{ externalId: 97031, amount: 10000, due: "2026-12-01" }], documents: [{ externalId: 970301, lines: [{ orderKey: "X", itemKey: "i", quantity: 10 }] }] },
      ],
      receipts: [
        { externalId: 97011001, titleExternalId: 97011, date: "2026-10-16", amount: 8000 },
        // Título da 2ª NF-e quitado em duas parcelas (out + nov): o motor oficial só lê
        // título baixado no Nomus (status true), então a 2ª parcela fecha o título.
        { externalId: 97021001, titleExternalId: 97021, date: "2026-10-26", amount: 6000 },
        { externalId: 97021002, titleExternalId: 97021, date: "2026-11-05", amount: 6000 },
      ],
    };
    let ids: Awaited<ReturnType<typeof seedCommissionScenario>>;

    before(async () => {
      ids = await seedCommissionScenario(prisma, scenario);
      await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [ids.orderIdByKey.get("X")!], apply: true });
    });

    it("snapshots por NF-e alocados por item: 320 + 480 + 400 = R$ 1.200 (4% de R$ 30.000), sem reproduzir o integral", async () => {
      const snapshots = await prisma.commissionOrderSnapshot.findMany({
        where: { salesOrderId: ids.orderIdByKey.get("X"), status: "ACTIVE" },
        include: { items: true },
        orderBy: { nfeId: "asc" },
      });
      assert.deepEqual(snapshots.map((row) => [row.nfeId, row.allocationBasis, num(row.totalSoldAmount), num(row.totalFinalCommissionAmount)]), [
        [9701, "INVOICED_ALLOCATION", 8000, 320],
        [9702, "INVOICED_ALLOCATION", 12000, 480],
        [9703, "INVOICED_ALLOCATION", 10000, 400],
      ]);
      assert.deepEqual(snapshots.map((row) => [num(row.items[0]!.invoicedQuantity), num(row.items[0]!.cumulativeInvoicedQuantity), num(row.items[0]!.orderedQuantity)]), [
        [8, 8, 30],
        [12, 20, 30],
        [10, 30, 30],
      ]);
      assert.equal(sum(snapshots.map((row) => num(row.totalFinalCommissionAmount))), 1200);
      const schedules = await prisma.commissionReceivableSchedule.findMany({ where: { salesOrderId: ids.orderIdByKey.get("X"), status: "ACTIVE", orderSnapshot: { status: "ACTIVE" } } });
      assert.equal(sum(schedules.map((row) => num(row.scheduledCommissionAmount))), 1200);
    });

    it("prévia de janeiro/2027 (pendências de out/nov): libera 320 + 240 + 240, nada retido, R1 não dispara", async () => {
      const payload = await m.closingServer.previewCommissionReceiptClosing({ year: 2027, month: 1 }, { includeCarryover: true, carryoverReceiptIds: [97011001, 97021001, 97021002] });
      assert.ok(payload.carryover, "janeiro/2027 aberto: pendências avaliadas");
      const lines = payload.preview.lines.filter((line) => line.orderCode === "05001");
      assert.deepEqual(lines.map((line) => [line.nomusReceivableId, line.status, line.releasedCommissionAmount]).sort((a, b) => Number(a[0]) - Number(b[0])), [
        [97011, "COMMISSIONABLE", 320],
        [97021, "COMMISSIONABLE", 240],
        [97021, "COMMISSIONABLE", 240],
      ]);
      // Teto incremental: a 2ª parcela do título não libera além dos R$ 480 da NF-e.
      assert.equal(sum(lines.map((line) => line.releasedCommissionAmount)), 800);
      // Totais por NF-e: cada título uma vez; a NF-e 9702 já liberou os R$ 480 dela.
      assert.deepEqual(
        summarizeLinesByOrderAndNfe(lines).byNfe.map((row) => [row.key, row.receivableCount, row.receivedAmount, row.releasedCommission]),
        [
          ["9701", 1, 8000, 320],
          ["9702", 1, 12000, 480],
        ]
      );
    });

    it("Previsão e Provisão conciliam com os schedules: Σ por pedido = R$ 1.200 (I10)", async () => {
      const { facts } = await m.outlookServer.loadCommissionPortfolioOutlookFacts({ salesOrderId: ids.orderIdByKey.get("X") });
      const lines = m.outlook.projectCommissionPortfolioOutlookLines(facts, "2026-12-31");
      assert.equal(sum(lines.map((line) => line.allocatedCommission)), 1200);
      const provision = await prisma.commissionOrderSnapshot.aggregate({
        where: { salesOrderId: ids.orderIdByKey.get("X"), status: "ACTIVE" },
        _sum: { totalFinalCommissionAmount: true },
      });
      assert.equal(num(provision._sum.totalFinalCommissionAmount), 1200);
    });

    it("sem a alocação (flag desligada) o pedido em três NF-e é RETIDO pela guarda R1, nunca liberado 3×", async () => {
      process.env.COMMISSION_INVOICE_ALLOCATION_ENABLED = "false";
      try {
        await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [ids.orderIdByKey.get("X")!], apply: true });
        const snapshots = await prisma.commissionOrderSnapshot.findMany({ where: { salesOrderId: ids.orderIdByKey.get("X"), status: "ACTIVE" } });
        assert.ok(snapshots.every((row) => row.allocationBasis === "FULL_ORDER_LEGACY" && num(row.totalFinalCommissionAmount) === 1200));
        // Motor oficial na competência natural (outubro): as três NF-e somariam 3 × R$ 1.200
        // sobre o mesmo pedido — a guarda R1 segura cada direito como ERRO, liberado zero.
        const october = await m.engine.loadCommissionReceiptPreview({ year: 2026, month: 10 });
        const lines = october.lines.filter((line) => line.orderCode === "05001");
        assert.deepEqual(lines.map((line) => line.nomusReceivableId).sort(), [97011, 97021]);
        assert.ok(lines.every((line) => line.status === "ERROR" && line.releasedCommissionAmount === 0), JSON.stringify(lines.map((line) => [line.status, line.statusReason])));
        // Na tela de fechamento as pendências aparecem retidas e não podem ser incluídas.
        const payload = await m.closingServer.previewCommissionReceiptClosing({ year: 2027, month: 1 }, { includeCarryover: true, carryoverReceiptIds: [97011001, 97021001, 97021002] });
        const rows = (payload.carryover?.rows ?? []).filter((row) => row.receivableExternalId === 97011 || row.receivableExternalId === 97021);
        assert.equal(rows.length, 3, "97011/out + 97021/out + 97021/nov");
        assert.ok(rows.every((row) => !row.includable && !row.selected && row.commissionAmount === 0));
        assert.equal(payload.preview.lines.filter((line) => line.orderCode === "05001").length, 0, "nada retido entra no fechamento");
      } finally {
        delete process.env.COMMISSION_INVOICE_ALLOCATION_ENABLED;
        const restoredRun = await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [ids.orderIdByKey.get("X")!], apply: true });
        // Religar a flag volta à origem anterior: os snapshots alocados idênticos são reativados.
        assert.deepEqual(restoredRun.errors, []);
      }
      const restored = await prisma.commissionOrderSnapshot.findMany({ where: { salesOrderId: ids.orderIdByKey.get("X"), status: "ACTIVE" } });
      assert.equal(sum(restored.map((row) => num(row.totalFinalCommissionAmount))), 1200);
    });
  });

  /* ---------------------------------------------------------------- */
  describe("B5 — NF-e parcial cancelada e reemitida (pedido de 20 un. em 10 + 10)", () => {
    const scenario: SeedScenario = {
      sellers: [{ nomusId: 470, name: "VENDEDOR SINTÉTICO 470" }],
      products: [{ key: "P5", externalId: 9105, ratePercent: 4 }],
      orders: [
        { key: "Y", code: "05101", externalId: 5101, sellerNomusId: 470, issueDate: "2026-09-02", items: [{ key: "i", productKey: "P5", quantity: 20, unitPrice: 500, nomusItemExternalId: 510101 }] },
      ],
      nfes: [
        { externalId: 9711, numero: "9711", processedAt: "2026-10-03", orderKeys: ["Y"], titles: [{ externalId: 97111, amount: 5000, due: "2026-10-15" }], documents: [{ externalId: 971101, lines: [{ orderKey: "Y", itemKey: "i", quantity: 10 }] }] },
        // Segunda parcial cancelada no Nomus (documento de saída também cancelado), sem título.
        { externalId: 9712, numero: "9712", processedAt: "2026-10-08", cancelled: true, orderKeys: ["Y"], titles: [], documents: [{ externalId: 971201, lines: [{ orderKey: "Y", itemKey: "i", quantity: 10 }] }] },
        // Reemissão das mesmas 10 unidades.
        { externalId: 9713, numero: "9713", processedAt: "2026-10-10", orderKeys: ["Y"], titles: [{ externalId: 97131, amount: 5000, due: "2026-10-20" }], documents: [{ externalId: 971301, lines: [{ orderKey: "Y", itemKey: "i", quantity: 10 }] }] },
      ],
      receipts: [
        { externalId: 97111001, titleExternalId: 97111, date: "2026-10-16", amount: 5000 },
        { externalId: 97131001, titleExternalId: 97131, date: "2026-10-21", amount: 5000 },
      ],
    };
    let ids: Awaited<ReturnType<typeof seedCommissionScenario>>;

    before(async () => {
      ids = await seedCommissionScenario(prisma, scenario);
      await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [ids.orderIdByKey.get("Y")!], apply: true });
    });

    it("a cancelada não fatura nem comissiona; a reemitida completa o pedido: 200 + 200 = R$ 400 (4% de R$ 10.000)", async () => {
      const snapshots = await prisma.commissionOrderSnapshot.findMany({
        where: { salesOrderId: ids.orderIdByKey.get("Y"), status: "ACTIVE" },
        include: { items: true },
        orderBy: { nfeId: "asc" },
      });
      const commissioned = snapshots.filter((row) => num(row.totalFinalCommissionAmount) > 0);
      assert.deepEqual(commissioned.map((row) => [row.nfeId, row.allocationBasis, num(row.totalFinalCommissionAmount)]), [
        [9711, "INVOICED_ALLOCATION", 200],
        [9713, "INVOICED_ALLOCATION", 200],
      ]);
      assert.deepEqual(commissioned.map((row) => num(row.items[0]!.cumulativeInvoicedQuantity)), [10, 20], "faturado acumulado ≤ pedido (I3)");
      assert.ok(snapshots.every((row) => row.nfeId !== 9712 || num(row.totalFinalCommissionAmount) === 0), "NF-e cancelada sem comissão");
      assert.equal(sum(snapshots.map((row) => num(row.totalFinalCommissionAmount))), 400, "I2/I4: o pedido nunca passa do direito");
    });

    it("prévia de janeiro/2027 (pendências de outubro): libera 200 + 200, a guarda R1 não retém", async () => {
      const payload = await m.closingServer.previewCommissionReceiptClosing({ year: 2027, month: 1 }, { includeCarryover: true, carryoverReceiptIds: [97111001, 97131001] });
      const lines = payload.preview.lines.filter((line) => line.orderCode === "05101");
      assert.deepEqual(lines.map((line) => [line.nomusReceivableId, line.status, line.releasedCommissionAmount]).sort((a, b) => Number(a[0]) - Number(b[0])), [
        [97111, "COMMISSIONABLE", 200],
        [97131, "COMMISSIONABLE", 200],
      ]);
    });
  });

  /* ---------------------------------------------------------------- */
  describe("N:N simultâneo com faturamento parcial e dez vendedores", () => {
    it("NF-e A{1,2,3} B{1,4,5} C{2,3,5} D{1,2,4,6}: Σ comissão por pedido ≤ direito, evento consumido uma vez, faturado ≤ pedido", async () => {
      const random = seededRandom(2026);
      const sellers = Array.from({ length: 6 }, (_, index) => ({ nomusId: 6100 + index, name: `VENDEDOR SINTÉTICO ${index + 1}` }));
      const orders: SeedOrder[] = Array.from({ length: 6 }, (_, index) => ({
        key: `O${index + 1}`,
        code: `061${String(index + 1).padStart(2, "0")}`,
        externalId: 6100 + index + 1,
        sellerNomusId: sellers[index]!.nomusId,
        issueDate: "2026-09-05",
        items: [{ key: "i", productKey: "P6", quantity: 12, unitPrice: Math.round(100 + random() * 900), nomusItemExternalId: 610000 + index + 1 }],
      }));
      const membership: Record<string, string[]> = { A: ["O1", "O2", "O3"], B: ["O1", "O4", "O5"], C: ["O2", "O3", "O5"], D: ["O1", "O2", "O4", "O6"] };
      const invoicedPerNfe = new Map<string, number>(); // pedido → próxima quantidade
      const nfes = Object.entries(membership).map(([letter, keys], index) => {
        const lines = keys.map((key) => {
          const qty = 1 + Math.floor(random() * 3);
          invoicedPerNfe.set(key, (invoicedPerNfe.get(key) ?? 0) + qty);
          return { orderKey: key, itemKey: "i", quantity: qty };
        });
        const value = round2(lines.reduce((acc, line) => acc + line.quantity * orders.find((order) => order.key === line.orderKey)!.items[0]!.unitPrice, 0));
        return {
          externalId: 9900 + index,
          numero: `99${letter}`,
          processedAt: `2026-10-0${index + 1}`,
          orderKeys: keys,
          titles: [{ externalId: 99000 + index, amount: value, due: "2026-10-20" }],
          documents: [{ externalId: 990000 + index, lines }],
        };
      });
      const receipts = nfes.map((nfe, index) => ({ externalId: 99000100 + index, titleExternalId: nfe.titles[0]!.externalId, date: "2026-10-21", amount: nfe.titles[0]!.amount }));
      const ids = await seedCommissionScenario(prisma, { sellers, products: [{ key: "P6", externalId: 9106, ratePercent: 5 }], orders, nfes, receipts });
      await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [...ids.orderIdByKey.values()], apply: true });

      const payload = await m.closingServer.previewCommissionReceiptClosing({ year: 2027, month: 1 }, { includeCarryover: true, carryoverReceiptIds: receipts.map((row) => row.externalId) });
      assert.ok(payload.carryover, "janeiro/2027 aberto: pendências avaliadas");
      const lines = payload.carryover ? payload.preview.lines.filter((line) => nfes.some((nfe) => nfe.titles[0]!.externalId === line.nomusReceivableId)) : [];
      const nnRows = (payload.carryover?.rows ?? []).filter((row) => nfes.some((nfe) => nfe.titles[0]!.externalId === row.receivableExternalId));
      assert.equal(lines.length, 13, `um direito por (pedido, título): 3+3+3+4 — ${JSON.stringify(nnRows.map((row) => [row.receivableExternalId, row.includable, row.selected, row.blockedReason, row.lineStatus, row.statusReason]))}`);
      assert.ok(lines.every((line) => line.status === "COMMISSIONABLE"));
      for (const order of orders) {
        const right = round2(order.items[0]!.quantity * order.items[0]!.unitPrice * 0.05);
        const released = sum(lines.filter((line) => line.orderCode === order.code).map((line) => line.releasedCommissionAmount));
        const invoiced = invoicedPerNfe.get(order.key) ?? 0;
        assert.ok(invoiced <= order.items[0]!.quantity, "faturado ≤ pedido (I3)");
        assert.ok(released <= right + 0.01, `liberado ${released} ≤ direito ${right} (I2)`);
        assert.ok(Math.abs(released - round2(right * (invoiced / order.items[0]!.quantity))) <= 0.02, "liberado = parcela faturada");
      }
      await m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2027, month: 1, userId: "teste-integracao", carryoverReceiptIds: receipts.map((row) => row.externalId) });
      const january = (await ledgerOf(2027, 1)).filter((row) => receipts.some((receipt) => nfes.some((nfe) => nfe.titles[0]!.externalId === row.nomusReceivableId && receipt.titleExternalId === row.nomusReceivableId)));
      assert.equal(january.length, 13);
      assert.equal(sum(january.map((row) => num(row.releasedCommissionAmount))), sum(lines.map((line) => line.releasedCommissionAmount)));
      for (const receipt of receipts) {
        const coverage = await coverageOf(receipt.externalId);
        assert.equal(sum(coverage.map((row) => num(row.coveredReceivedAmount))) <= receipt.amount + 0.01, true, "evento consumido no máximo uma vez (I1/I7)");
      }
    });
  });

  /* ---------------------------------------------------------------- */
  describe("recebimentos parciais: título em aberto libera por parcela em competências distintas", () => {
    // Título de R$ 12.000 (4% = R$ 480) quitado em três baixas: fev, mar e abr/2027. Até a
    // última baixa o título fica EM ABERTO no Nomus (status false, saldo > 0).
    const scenario: SeedScenario = {
      sellers: [{ nomusId: 470, name: "VENDEDOR SINTÉTICO 470" }],
      products: [{ key: "P5", externalId: 9105, ratePercent: 4 }],
      orders: [
        { key: "R", code: "07101", externalId: 7101, sellerNomusId: 470, issueDate: "2027-01-05", items: [{ key: "i", productKey: "P5", quantity: 12, unitPrice: 1000, nomusItemExternalId: 710101 }] },
        // Regressão do corte: título de setembro/2026 (antes do cutover) recebido em parte.
        { key: "S", code: "07102", externalId: 7102, sellerNomusId: 470, issueDate: "2026-08-20", items: [{ key: "i", productKey: "P5", quantity: 2, unitPrice: 1000, nomusItemExternalId: 710201 }] },
      ],
      nfes: [
        { externalId: 7111, numero: "7111", processedAt: "2027-01-20", orderKeys: ["R"], titles: [{ externalId: 71111, amount: 12000, due: "2027-04-30" }], documents: [{ externalId: 711101, lines: [{ orderKey: "R", itemKey: "i", quantity: 12 }] }] },
        { externalId: 7112, numero: "7112", processedAt: "2026-08-25", orderKeys: ["S"], titles: [{ externalId: 71121, amount: 2000, due: "2026-09-30" }], documents: [{ externalId: 711201, lines: [{ orderKey: "S", itemKey: "i", quantity: 2 }] }] },
      ],
      receipts: [{ externalId: 71121001, titleExternalId: 71121, date: "2026-09-15", amount: 500 }],
    };
    let ids: Awaited<ReturnType<typeof seedCommissionScenario>>;
    const installments = [
      { externalId: 71111001, titleExternalId: 71111, date: "2027-02-10", amount: 4000, month: 2 },
      { externalId: 71111002, titleExternalId: 71111, date: "2027-03-10", amount: 4000, month: 3 },
      { externalId: 71111003, titleExternalId: 71111, date: "2027-04-10", amount: 4000, month: 4 },
    ];

    before(async () => {
      ids = await seedCommissionScenario(prisma, scenario);
      await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [...ids.orderIdByKey.values()], apply: true });
    });

    it("cada baixa libera a sua parcela (160 + 160 + 160 = R$ 480) com o título ainda em aberto; recebimento uma vez", async () => {
      const released: number[] = [];
      for (const [index, installment] of installments.entries()) {
        await addReceipts(prisma, [installment]);
        const title = await prisma.nomusAccountsReceivable.findUniqueOrThrow({ where: { externalId: 71111 } });
        assert.equal(title.status, index < 2 ? false : true, "título em aberto até a última baixa (status = baixa no Nomus)");
        const payload = await m.closingServer.previewCommissionReceiptClosing({ year: 2027, month: installment.month });
        const lines = payload.preview.lines.filter((line) => line.nomusReceivableId === 71111);
        assert.deepEqual(
          lines.map((line) => [line.status, line.receivedAmount, line.releasedCommissionAmount]),
          [["COMMISSIONABLE", 4000, 160]],
          `competência ${installment.month}/2027`
        );
        await m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2027, month: installment.month, userId: "teste-integracao" });
        const ledger = (await ledgerOf(2027, installment.month)).filter((row) => row.nomusReceivableId === 71111);
        assert.deepEqual(ledger.map((row) => row.receiptExternalIds), [[installment.externalId]]);
        released.push(...ledger.map((row) => num(row.releasedCommissionAmount)));
        const coverage = await coverageOf(installment.externalId);
        assert.equal(sum(coverage.map((row) => num(row.coveredReceivedAmount))), 4000, "evento coberto uma vez");
      }
      assert.deepEqual(released, [160, 160, 160]);
      assert.equal(sum(released), 480, "Σ das parcelas = comissão do pedido (I2/I11)");
    });

    it("Previsão por títulos em aberto enxerga o saldo; a flag de rollback restaura a regra antiga", async () => {
      // Reconstrói o estado intermediário num título novo do mesmo pedido de teste.
      await prisma.nomusAccountsReceivable.update({ where: { externalId: 71111 }, data: { amountReceived: 4000, balanceReceivable: 8000, status: false } });
      try {
        const forecast = await m.engine.loadCommissionReceivableForecastPreview({
          nomusReceivableId: 71111,
          dueDateFrom: new Date("2027-04-01T00:00:00Z"),
          dueDateTo: new Date("2027-05-31T00:00:00Z"),
        });
        const lines = forecast.lines.filter((line) => line.nomusReceivableId === 71111);
        assert.ok(lines.length > 0, "título em aberto (status false) entra na previsão");
        assert.equal(lines[0]!.receivedAmount, 8000, "saldo em aberto");
        // Alavanca de rollback: com a flag desligada a competência oficial volta à regra antiga.
        const inFebruary = async () => (await m.engine.loadCommissionReceiptPreview({ year: 2027, month: 2 })).lines.filter((line) => line.nomusReceivableId === 71111).length;
        assert.equal(await inFebruary(), 1);
        process.env.COMMISSION_OPEN_RECEIVABLE_RELEASE_ENABLED = "false";
        try {
          assert.equal(await inFebruary(), 0, "flag desligada: título em aberto fora da prévia");
        } finally {
          delete process.env.COMMISSION_OPEN_RECEIVABLE_RELEASE_ENABLED;
        }
      } finally {
        await prisma.nomusAccountsReceivable.update({ where: { externalId: 71111 }, data: { amountReceived: 12000, balanceReceivable: 0, status: true } });
      }
    });

    it("antes do cutover a regra histórica fica idêntica: título em aberto de setembro/2026 não entra (comparação com o Nomus)", async () => {
      const september = await m.engine.loadCommissionReceiptPreview({ year: 2026, month: 9 });
      assert.equal(september.lines.filter((line) => line.nomusReceivableId === 71121).length, 0);
    });
  });

  /* ---------------------------------------------------------------- */
  describe("faturamento parcial sem evidência: NF-e única que fatura parte do pedido é retida até a evidência", () => {
    const scenario: SeedScenario = {
      sellers: [{ nomusId: 470, name: "VENDEDOR SINTÉTICO 470" }],
      products: [{ key: "P5", externalId: 9105, ratePercent: 4 }],
      orders: [
        { key: "PARCIAL", code: "07201", externalId: 7201, sellerNomusId: 470, issueDate: "2027-04-01", items: [{ key: "i", productKey: "P5", quantity: 10, unitPrice: 1000, nomusItemExternalId: 720101 }] },
        { key: "INTEGRAL", code: "07202", externalId: 7202, sellerNomusId: 470, issueDate: "2027-04-01", items: [{ key: "i", productKey: "P5", quantity: 5, unitPrice: 1000, nomusItemExternalId: 720201 }] },
      ],
      nfes: [
        // Sem documento de saída: produtos da NF-e = R$ 4.000 de um pedido de R$ 10.000.
        { externalId: 7211, numero: "7211", processedAt: "2027-04-20", orderKeys: ["PARCIAL"], titles: [{ externalId: 72111, amount: 4000, due: "2027-05-05" }] },
        { externalId: 7212, numero: "7212", processedAt: "2027-04-21", orderKeys: ["INTEGRAL"], titles: [{ externalId: 72121, amount: 5000, due: "2027-05-06" }] },
      ],
      receipts: [
        { externalId: 72111001, titleExternalId: 72111, date: "2027-05-10", amount: 4000 },
        { externalId: 72121001, titleExternalId: 72121, date: "2027-05-12", amount: 5000 },
      ],
    };
    let ids: Awaited<ReturnType<typeof seedCommissionScenario>>;

    before(async () => {
      ids = await seedCommissionScenario(prisma, scenario);
      await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [...ids.orderIdByKey.values()], apply: true });
    });

    it("snapshot: parcial sem evidência RETIDO com motivo; integral comprovado pelo valor mantém o pedido inteiro", async () => {
      const partial = await prisma.commissionOrderSnapshot.findFirstOrThrow({ where: { salesOrderId: ids.orderIdByKey.get("PARCIAL"), status: "ACTIVE" } });
      assert.equal(partial.allocationBasis, "ALLOCATION_PENDING");
      assert.equal(num(partial.totalFinalCommissionAmount), 0);
      const full = await prisma.commissionOrderSnapshot.findFirstOrThrow({ where: { salesOrderId: ids.orderIdByKey.get("INTEGRAL"), status: "ACTIVE" } });
      assert.deepEqual([full.allocationBasis, num(full.totalFinalCommissionAmount)], ["FULL_ORDER_LEGACY", 200]);
    });

    it("maio/2027: o parcial fica retido (ERRO, R$ 0, recebimento pendente); o integral libera R$ 200; fechamento aplicado", async () => {
      const payload = await m.closingServer.previewCommissionReceiptClosing({ year: 2027, month: 5 });
      const byTitle = (id: number) => payload.preview.lines.filter((line) => line.nomusReceivableId === id);
      assert.deepEqual(byTitle(72111).map((line) => [line.status, line.releasedCommissionAmount]), [["ERROR", 0]]);
      assert.match(byTitle(72111)[0]!.statusReason ?? "", /fatura só parte do pedido/);
      assert.deepEqual(byTitle(72121).map((line) => [line.status, line.releasedCommissionAmount]), [["COMMISSIONABLE", 200]]);
      await m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2027, month: 5, userId: "teste-integracao" });
      assert.equal((await coverageOf(72111001)).length, 0, "retido não é coberto: o recebimento continua pendente");
      assert.equal((await coverageOf(72121001)).length, 1);
    });

    it("junho/2027: a evidência por item chega (4 de 10) e a pendência libera só o faturado — R$ 160, nunca R$ 400", async () => {
      await addOutputDocument(prisma, {
        documentExternalId: 721101,
        nfeExternalId: 7211,
        lines: [{ externalSalesOrderId: 7201, nomusItemExternalId: 720101, productExternalId: 9105, quantity: 4, unitPrice: 1000 }],
      });
      await m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [ids.orderIdByKey.get("PARCIAL")!], apply: true });
      const snapshot = await prisma.commissionOrderSnapshot.findFirstOrThrow({ where: { salesOrderId: ids.orderIdByKey.get("PARCIAL"), status: "ACTIVE" } });
      assert.deepEqual([snapshot.allocationBasis, num(snapshot.totalFinalCommissionAmount)], ["INVOICED_ALLOCATION", 160]);
      const payload = await m.closingServer.previewCommissionReceiptClosing({ year: 2027, month: 6 }, { includeCarryover: true, carryoverReceiptIds: [72111001] });
      const row = (payload.carryover?.rows ?? []).find((candidate) => candidate.receiptExternalIds.includes(72111001));
      assert.ok(row?.includable, row?.blockedReason ?? "pendência deveria ser incluível");
      await m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2027, month: 6, userId: "teste-integracao", carryoverReceiptIds: [72111001] });
      const june = (await ledgerOf(2027, 6)).filter((line) => line.nomusReceivableId === 72111);
      assert.deepEqual(june.map((line) => [line.inclusionType, num(line.releasedCommissionAmount)]), [["LATE_CARRYOVER", 160]]);
    });
  });

  /* ---------------------------------------------------------------- */
  describe("pagamento por direito: rastreio até o lote e teto pelo fechamento oficial", () => {
    let seller470: string;
    let seller464: string;
    const record = (person: string, nomusOrderId: number, orderCode: string, released: number, tag: string) =>
      prisma.commissionRecord.create({
        data: {
          originStage: "SALES_ORDER",
          status: "RELEASED",
          nomusOrderId,
          orderCode,
          commissionPersonId: person,
          baseAmount: released * 25,
          ratePercent: 4,
          commissionAmount: released,
          releasedAmount: released,
          paidAmount: 0,
          balanceAmount: 0,
          releaseRule: "EACH_RECEIVABLE_PAID",
          calculationHash: `pagamento-${tag}`,
        },
        select: { id: true },
      });
    const isGuardError = (error: unknown) => (error as { code?: string }).code === "COMMISSION_PAYMENT_EXCEEDS_OFFICIAL_CLOSING";

    before(async () => {
      seller470 = (await prisma.commissionPerson.findFirstOrThrow({ where: { nomusPersonId: 470 } })).id;
      seller464 = (await prisma.commissionPerson.findFirstOrThrow({ where: { nomusPersonId: 464 } })).id;
    });

    it("rastreio: pedido → NF-e → título → recebimento → direito → liberado → fechamento → valor a pagar do vendedor", async () => {
      const lines = await prisma.commissionReceiptLedgerLine.findMany({
        where: { nomusOrderId: 7101, closing: { status: "CLOSED" } },
        include: { closing: { select: { year: true, month: true, status: true } } },
        orderBy: [{ year: "asc" }, { month: "asc" }],
      });
      assert.equal(lines.length, 3);
      for (const line of lines) {
        assert.ok(line.salesOrderId && line.commissionReceivableScheduleId, "linha leva pedido e direito (schedule)");
        const schedule = await prisma.commissionReceivableSchedule.findUniqueOrThrow({ where: { id: line.commissionReceivableScheduleId! }, include: { orderSnapshot: true } });
        assert.equal(schedule.salesOrderId, line.salesOrderId);
        assert.equal(schedule.receivableId, 71111);
        assert.equal(schedule.orderSnapshot.nfeId, 7111);
        assert.equal(line.canonicalSellerId, seller470);
      }
      const payable = await Promise.all([2, 3, 4].map((month) => m.closingServer.getMonthlyPayableFromClosedReceiptLedger({ year: 2027, month } as never)));
      const ofSeller = payable.map((summary) => summary?.sellers.find((row) => row.sellerId === seller470)?.releasedCommissionAmount ?? 0);
      assert.deepEqual(ofSeller, [160, 160, 160]);
    });

    it("lote do vendedor paga o liberado do pedido; registro duplicado (R1) e repetição em outro lote são recusados", async () => {
      const legit = await record(seller470, 7101, "07101", 480, "legit-7101");
      const duplicate = await record(seller470, 7101, "07101", 480, "dup-7101");
      const period = { periodStart: new Date("2027-02-01T03:00:00Z"), periodEnd: new Date("2027-04-30T03:00:00Z") };
      const batch = await m.payments.createCommissionPaymentBatch(prisma, { ...period, commissionPersonId: seller470, recordIds: [legit.id], createdBy: "teste" });
      assert.equal(batch.totalSelected, 480);
      await m.payments.approveCommissionPaymentBatch(prisma, batch.batchId, "aprovador");
      const paid = await m.payments.markCommissionPaymentBatchPaid(prisma, { batchId: batch.batchId, paymentDate: new Date("2027-05-05T12:00:00Z"), paidBy: "tesouraria" });
      assert.equal(paid.totalPaid, 480);
      await assert.rejects(
        m.payments.createCommissionPaymentBatch(prisma, { ...period, commissionPersonId: seller470, recordIds: [duplicate.id], createdBy: "teste" }),
        isGuardError,
        "a mesma comissão não é paga duas vezes por outro registro"
      );
      const batches = await prisma.commissionPaymentBatch.count({ where: { commissionPersonId: seller470 } });
      assert.equal(batches, 1, "lote recusado não é gravado (transação)");
    });

    it("pedido retido/parcial: registro integral do cálculo legado (R$ 400) não passa do liberado no fechamento (R$ 160)", async () => {
      const full = await record(seller470, 7201, "07201", 400, "full-7201");
      const period = { periodStart: new Date("2027-05-01T03:00:00Z"), periodEnd: new Date("2027-06-30T03:00:00Z") };
      await assert.rejects(m.payments.createCommissionPaymentBatch(prisma, { ...period, commissionPersonId: seller470, recordIds: [full.id], createdBy: "teste" }), isGuardError);
      const right = await record(seller470, 7201, "07201", 160, "right-7201");
      const ok = await m.payments.createCommissionPaymentBatch(prisma, { ...period, commissionPersonId: seller470, recordIds: [right.id], createdBy: "teste" });
      assert.equal(ok.totalSelected, 160);
    });

    it("atribuição: outro vendedor não recebe o pedido; competência sem fechamento CLOSED bloqueia", async () => {
      const foreign = await record(seller464, 7101, "07101", 160, "foreign-7101");
      await assert.rejects(
        m.payments.createCommissionPaymentBatch(prisma, {
          periodStart: new Date("2027-02-01T03:00:00Z"),
          periodEnd: new Date("2027-04-30T03:00:00Z"),
          commissionPersonId: seller464,
          recordIds: [foreign.id],
          createdBy: "teste",
        }),
        isGuardError
      );
      const later = await record(seller470, 7202, "07202", 200, "open-7202");
      await assert.rejects(
        m.payments.createCommissionPaymentBatch(prisma, {
          periodStart: new Date("2027-05-01T03:00:00Z"),
          periodEnd: new Date("2027-10-31T03:00:00Z"),
          commissionPersonId: seller470,
          recordIds: [later.id],
          createdBy: "teste",
        }),
        (error: unknown) => isGuardError(error) && /sem fechamento oficial encerrado/.test((error as Error).message)
      );
    });
  });

  /* ---------------------------------------------------------------- */
  describe("flag de alocação: desligada → ligada → desligada preserva dados e fechamentos encerrados", () => {
    const scenario: SeedScenario = {
      sellers: [{ nomusId: 470, name: "VENDEDOR SINTÉTICO 470" }],
      products: [{ key: "P5", externalId: 9105, ratePercent: 4 }],
      orders: [
        { key: "F", code: "07301", externalId: 7301, sellerNomusId: 470, issueDate: "2027-06-01", items: [{ key: "i", productKey: "P5", quantity: 10, unitPrice: 1000, nomusItemExternalId: 730101 }] },
      ],
      nfes: [
        { externalId: 7311, numero: "7311", processedAt: "2027-06-25", orderKeys: ["F"], titles: [{ externalId: 73111, amount: 4000, due: "2027-07-05" }], documents: [{ externalId: 731101, lines: [{ orderKey: "F", itemKey: "i", quantity: 4 }] }] },
        { externalId: 7312, numero: "7312", processedAt: "2027-06-28", orderKeys: ["F"], titles: [{ externalId: 73121, amount: 6000, due: "2027-07-10" }], documents: [{ externalId: 731201, lines: [{ orderKey: "F", itemKey: "i", quantity: 6 }] }] },
      ],
      receipts: [
        { externalId: 73111001, titleExternalId: 73111, date: "2027-07-10", amount: 4000 },
        { externalId: 73121001, titleExternalId: 73121, date: "2027-07-15", amount: 6000 },
      ],
    };
    let orderId: string;
    const rebuild = () => m.orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: [orderId], apply: true });
    const activeBases = async () =>
      (await prisma.commissionOrderSnapshot.findMany({ where: { salesOrderId: orderId, status: "ACTIVE" }, orderBy: { nfeId: "asc" } })).map((row) => [
        row.allocationBasis,
        num(row.totalFinalCommissionAmount),
      ]);

    before(async () => {
      orderId = (await seedCommissionScenario(prisma, scenario)).orderIdByKey.get("F")!;
    });

    it("desligada → ligada → desligada: R1 retém, alocação libera 160 + 240, desligar de novo não mexe nos meses fechados", async () => {
      process.env.COMMISSION_INVOICE_ALLOCATION_ENABLED = "false";
      try {
        assert.deepEqual((await rebuild()).errors, []);
        assert.deepEqual(await activeBases(), [["FULL_ORDER_LEGACY", 400], ["FULL_ORDER_LEGACY", 400]]);
        const july = await m.closingServer.previewCommissionReceiptClosing({ year: 2027, month: 7 });
        const held = july.preview.lines.filter((line) => line.orderCode === "07301");
        assert.ok(held.length === 2 && held.every((line) => line.status === "ERROR" && line.releasedCommissionAmount === 0), "R1 retém com a flag desligada");
        await m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2027, month: 7, userId: "teste-integracao" });
      } finally {
        delete process.env.COMMISSION_INVOICE_ALLOCATION_ENABLED;
      }
      const julyLedger = JSON.stringify(await ledgerOf(2027, 7));

      assert.deepEqual((await rebuild()).errors, []);
      assert.deepEqual(await activeBases(), [["INVOICED_ALLOCATION", 160], ["INVOICED_ALLOCATION", 240]]);
      await m.closingServer.applyCommissionReceiptClosing(prisma, { year: 2027, month: 8, userId: "teste-integracao", carryoverReceiptIds: [73111001, 73121001] });
      const august = (await ledgerOf(2027, 8)).filter((line) => line.orderCode === "07301");
      assert.deepEqual(august.map((line) => num(line.releasedCommissionAmount)).sort((a, b) => a - b), [160, 240]);
      const augustLedger = JSON.stringify(await ledgerOf(2027, 8));
      const coverageAfterAugust = JSON.stringify([...(await coverageOf(73111001)), ...(await coverageOf(73121001))]);

      process.env.COMMISSION_INVOICE_ALLOCATION_ENABLED = "false";
      try {
        assert.deepEqual((await rebuild()).errors, [], "desligar de novo reativa os snapshots idênticos (sem P2002)");
        assert.deepEqual(await activeBases(), [["FULL_ORDER_LEGACY", 400], ["FULL_ORDER_LEGACY", 400]]);
        const september = await m.closingServer.previewCommissionReceiptClosing({ year: 2027, month: 9 }, { includeCarryover: true });
        assert.ok(
          !(september.carryover?.rows ?? []).some((row) => row.receiptExternalIds.some((id) => id === 73111001 || id === 73121001)),
          "recebimentos já cobertos não voltam como pendência"
        );
      } finally {
        delete process.env.COMMISSION_INVOICE_ALLOCATION_ENABLED;
      }
      assert.equal(JSON.stringify(await ledgerOf(2027, 7)), julyLedger, "julho CLOSED intocado");
      assert.equal(JSON.stringify(await ledgerOf(2027, 8)), augustLedger, "agosto CLOSED intocado");
      assert.equal(JSON.stringify([...(await coverageOf(73111001)), ...(await coverageOf(73121001))]), coverageAfterAugust);
      assert.deepEqual((await rebuild()).errors, []);
      assert.deepEqual(await activeBases(), [["INVOICED_ALLOCATION", 160], ["INVOICED_ALLOCATION", 240]], "religar reativa os alocados");
    });
  });

  /* ---------------------------------------------------------------- */
  describe("desempenho", () => {
    for (const count of [10, 50, 100]) {
      it(`NF-e com ${count} pedidos e ${count} vendedores: materialização + prévia, consultas medidas`, async () => {
        const random = seededRandom(count);
        const base = 700000 + count * 1000;
        const sellers = Array.from({ length: count }, (_, index) => ({ nomusId: base + index, name: `VENDEDOR PERF ${count}-${index}` }));
        const orders: SeedOrder[] = sellers.map((seller, index) => ({
          key: `Q${index}`,
          code: `P${count}-${String(index).padStart(3, "0")}`,
          externalId: base + index,
          sellerNomusId: seller.nomusId,
          issueDate: "2026-09-15",
          items: [{ key: "i", productKey: `PP${count}`, quantity: 1, unitPrice: round2(100 + random() * 5000), nomusItemExternalId: base * 10 + index }],
        }));
        const total = sum(orders.map((order) => order.items[0]!.unitPrice));
        const nfeId = base;
        await seedCommissionScenario(prisma, {
          sellers,
          products: [{ key: `PP${count}`, externalId: base, ratePercent: 2.5 }],
          orders,
          nfes: [{ externalId: nfeId, numero: String(nfeId), processedAt: "2026-10-03", orderKeys: orders.map((order) => order.key), titles: [{ externalId: base, amount: total, due: "2026-10-30" }] }],
          receipts: [{ externalId: base * 10, titleExternalId: base, date: "2026-10-31", amount: total }],
        });
        queryCount = 0;
        let started = Date.now();
        await m.orchestrator.ensureCommissionMaterializationForReceivableRefs(prisma, [{ receivableId: base, sourceInvoiceId: nfeId }], { apply: true });
        const materializeMs = Date.now() - started;
        const materializeQueries = queryCount;
        queryCount = 0;
        started = Date.now();
        const preview = await m.engine.loadCommissionReceiptPreview({ year: 2026, month: 10 });
        const previewMs = Date.now() - started;
        const previewQueries = queryCount;
        const lines = preview.lines.filter((line) => line.nomusReceivableId === base);
        assert.equal(lines.length, count);
        assert.equal(sum(lines.map((line) => line.attributedReceivedAmount ?? 0)), round2(total));
        console.log(`[perf] ${count} pedidos: materialização ${materializeMs} ms / ${materializeQueries} consultas · prévia ${previewMs} ms / ${previewQueries} consultas`);
        // A prévia não pode crescer em consultas com o número de pedidos (sem N+1).
        assert.ok(previewQueries < 60, `prévia com ${previewQueries} consultas`);
      });
    }

    it("1.000 vínculos pedido × NF-e (100 pedidos × 10 NF-e, alocação B5 em todas): materialização + prévia", { timeout: 600_000 }, async () => {
      const random = seededRandom(1000);
      const base = 900000;
      const sellers = Array.from({ length: 10 }, (_, index) => ({ nomusId: base + index, name: `VENDEDOR MIL ${index}` }));
      const orders: SeedOrder[] = Array.from({ length: 100 }, (_, index) => ({
        key: `M${index}`,
        code: `M-${String(index).padStart(3, "0")}`,
        externalId: base + index,
        sellerNomusId: sellers[index % 10]!.nomusId,
        issueDate: "2026-09-15",
        items: [{ key: "i", productKey: "PM", quantity: 10, unitPrice: round2(50 + random() * 950), nomusItemExternalId: 9000000 + index }],
      }));
      // Pedido j em 10 NF-e: (j + 5t) mod 50, t = 0..9 → cada NF-e com 20 pedidos, 1 unidade de cada.
      const nfes = Array.from({ length: 50 }, (_, n) => {
        const members = orders.filter((_, j) => Array.from({ length: 10 }, (_, t) => (j + 5 * t) % 50).includes(n));
        const amount = sum(members.map((order) => order.items[0]!.unitPrice));
        return {
          externalId: base + n,
          numero: String(base + n),
          processedAt: "2026-10-05",
          orderKeys: members.map((order) => order.key),
          titles: [{ externalId: base + n, amount, due: "2026-10-30" }],
          documents: [{ externalId: base + n, lines: members.map((order) => ({ orderKey: order.key, itemKey: "i", quantity: 1 })) }],
        };
      });
      assert.equal(sum(nfes.map((nfe) => nfe.orderKeys.length)), 1000);
      await seedCommissionScenario(prisma, {
        sellers,
        products: [{ key: "PM", externalId: base, ratePercent: 2 }],
        orders,
        nfes,
        receipts: nfes.map((nfe, n) => ({ externalId: base * 10 + n, titleExternalId: nfe.titles[0]!.externalId, date: "2026-10-31", amount: nfe.titles[0]!.amount })),
      });
      queryCount = 0;
      let started = Date.now();
      await m.orchestrator.ensureCommissionMaterializationForReceivableRefs(
        prisma,
        nfes.map((nfe) => ({ receivableId: nfe.titles[0]!.externalId, sourceInvoiceId: nfe.externalId })),
        { apply: true }
      );
      const materializeMs = Date.now() - started;
      const materializeQueries = queryCount;
      queryCount = 0;
      started = Date.now();
      const preview = await m.engine.loadCommissionReceiptPreview({ year: 2026, month: 10 });
      const previewMs = Date.now() - started;
      const previewQueries = queryCount;
      const titleIds = new Set(nfes.map((nfe) => nfe.titles[0]!.externalId));
      const lines = preview.lines.filter((line) => titleIds.has(line.nomusReceivableId));
      console.log(`[perf] 1.000 vínculos: materialização ${materializeMs} ms / ${materializeQueries} consultas · prévia ${previewMs} ms / ${previewQueries} consultas`);
      assert.equal(lines.length, 1000, "um direito por (pedido, título)");
      assert.ok(lines.every((line) => line.status === "COMMISSIONABLE"), JSON.stringify(lines.find((line) => line.status !== "COMMISSIONABLE")?.statusReason));
      for (const nfe of nfes) {
        const ofTitle = lines.filter((line) => line.nomusReceivableId === nfe.titles[0]!.externalId);
        assert.equal(sum(ofTitle.map((line) => line.attributedReceivedAmount ?? 0)), nfe.titles[0]!.amount, "evento repartido uma vez (I1)");
      }
      for (const order of orders) {
        const released = sum(lines.filter((line) => line.orderCode === order.code).map((line) => line.releasedCommissionAmount));
        const right = round2(order.items[0]!.quantity * order.items[0]!.unitPrice * 0.02);
        assert.ok(Math.abs(released - right) <= 0.05, `${order.code}: liberado ${released} × direito ${right} (I2)`);
      }
      assert.ok(previewQueries < 60, `prévia com ${previewQueries} consultas`);
    });
  });
});
