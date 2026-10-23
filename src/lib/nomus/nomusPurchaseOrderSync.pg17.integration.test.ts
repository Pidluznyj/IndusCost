/**
 * Pedidos de Compra Nomus — ciclo de vida de presença num PostgreSQL 17 descartável.
 *
 * Reproduz o caso PC00637 (ID Nomus 638, excluído no Nomus em 22/10/2026) com um Nomus FALSO
 * (fetch injetado; nenhum acesso à rede): incremental não remove, reconciliação completa marca
 * candidata → confirma em execução distinta, preserva itens/avaliação/vínculo de CP, carteira
 * padrão exclui o confirmado, reaparecimento reativa. Falhas (5xx, limite de páginas, lock,
 * fonte inativa) nunca alteram presença.
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npm run test:nomus:purchase-orders:pg
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  assertPrismaOnTestDatabase,
  commissionPg17BinDir,
  startCommissionPostgres17,
  type CommissionPg17Database,
} from "../../../scripts/testing/commissionPostgresHarness.js";

const pg17Bin = commissionPg17BinDir();
const SKIP = pg17Bin ? false : "COMMISSION_PG17_BIN ausente: suite de integração PostgreSQL 17 não executada.";

const BASE_URL = "https://nomus.invalid/rest";
const T0 = new Date("2026-10-23T06:37:00.000Z");
const H = 3_600_000;

type NomusOrder = Record<string, unknown>;

function nomusOrder(id: number, overrides: Partial<NomusOrder> = {}): NomusOrder {
  return {
    id,
    codigoPedido: `PC${String(id - 1).padStart(5, "0")}`,
    idPessoaFornecedor: 215,
    nomeFornecedor: "QUIMICOS E PLASTICOS IND. E COM. DE PROD. DERIV.",
    cnpjFornecedor: "03.261.226/0001-34",
    status: "Aprovado",
    cancelado: false,
    dataEmissao: "22/10/2026",
    dataEntregaPadrao: "05/11/2026",
    valorTotal: "31.114,39",
    itensPedidoCompra: [
      { item: "000010", idProduto: 1292, quantidade: "50", valorUnitario: "400,00", status: 2 },
      { item: "000020", idProduto: 1293, quantidade: "10", valorUnitario: "1.111,44", status: 2 },
    ],
    parcelas: [
      { dataVencimento: "21/11/2026", valorParcela: "15.557,20", idFormaPagamento: 10 },
      { dataVencimento: "21/12/2026", valorParcela: "15.557,19", idFormaPagamento: 10 },
    ],
    ...overrides,
  };
}

/** Nomus falso: listagem paginada (array, 50/página) + GET por ID. */
function createFakeNomus() {
  const orders = new Map<number, NomusOrder>();
  const state = { failOnPage: null as number | null, failStatus: 503, calls: 0, pageSize: 50 };
  const fetchJson = async (url: URL): Promise<unknown> => {
    state.calls += 1;
    const path = url.pathname;
    const byId = /pedidoscompra\/(\d+)$/.exec(path);
    if (byId) {
      const row = orders.get(Number(byId[1]));
      if (!row) throw new Error(`Falha HTTP 404 em ${BASE_URL}/pedidoscompra/${byId[1]}: (sem corpo)`);
      return row;
    }
    const page = Number(url.searchParams.get("pagina") ?? "1");
    if (state.failOnPage != null && page >= state.failOnPage) {
      throw new Error(`Falha HTTP ${state.failStatus} em ${BASE_URL}/pedidoscompra?pagina=${page}: erro interno`);
    }
    const all = [...orders.values()].sort((a, b) => Number(a.id) - Number(b.id));
    return all.slice((page - 1) * state.pageSize, page * state.pageSize);
  };
  return { orders, state, fetchJson };
}

describe("Pedidos de Compra Nomus — presença no PostgreSQL 17", { skip: SKIP }, () => {
  let database: CommissionPg17Database;
  let prisma: PrismaClient;
  let lockDir: string;
  let canonical: typeof import("./nomusCanonicalSync.server.js");
  let service: typeof import("./nomusPurchaseOrderSyncService.server.js");
  let runner: typeof import("../nomusPurchaseOrdersSyncRunner.js");
  let query: typeof import("./nomusPurchaseOrderQuery.js");
  let link: typeof import("./nomusPurchaseOrderPayableLink.server.js");
  const nomus = createFakeNomus();
  let now = T0;
  let globalLockHeld = false;
  let logs: string[] = [];

  const baseEnv = () => ({
    NOMUS_BASE_URL: BASE_URL,
    NOMUS_PO_SCHEDULE_SOURCE: "independent",
    NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED: "1",
    NOMUS_PO_RECONCILE_PREVIEW_ONLY: "0",
    NOMUS_PO_RECONCILE_APPLY_CONFIRMED_ENABLED: "1",
    NOMUS_PO_GLOBAL_LOCK_WAIT_SECONDS: "1",
    NOMUS_PURCHASE_ORDERS_CANONICAL_LOCK_FILE: join(lockDir, "po.canonical.lock"),
  });
  let env: Record<string, string> = {};

  const sync = async (input: {
    strategy: "RECENT_WINDOW" | "FULL_RECONCILIATION" | "TARGETED_LOOKUP";
    trigger?: "SCHEDULED_HOURLY" | "SCHEDULED_DAILY" | "CHAIN_AFTER_AR" | "ADMIN_PANEL" | "CLI";
    mode?: "apply" | "preview";
    target?: number;
  }) => {
    // O contrato canônico lê as flags de process.env (permissões de ausência); o serviço, de deps.env.
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    return canonical.runNomusPurchaseOrdersSync(
      {
        strategy: input.strategy,
        mode: input.mode ?? "apply",
        scope: undefined,
        sourceTrigger: input.trigger ?? (input.strategy === "FULL_RECONCILIATION" ? "SCHEDULED_DAILY" : "SCHEDULED_HOURLY"),
        allowMissingDetection: input.strategy === "FULL_RECONCILIATION",
        allowMissingConfirmation: input.strategy === "FULL_RECONCILIATION",
        targetExternalId: input.target ?? null,
      },
      (execution) =>
        service.executeNomusPurchaseOrdersSync(execution, {
          prisma,
          fetchJson: nomus.fetchJson,
          env: { ...env },
          now: () => now,
          probeGlobalLockHeld: () => globalLockHeld,
          waitForGlobalLockToFree: () => !globalLockHeld,
          log: (line) => logs.push(line),
        })
    );
  };

  const po = (externalId: number) =>
    prisma.nomusPurchaseOrder.findUniqueOrThrow({
      where: { externalId },
      include: { items: true, supplierEvaluation: true, payableLinks: true, presenceEvents: { orderBy: { occurredAt: "asc" } } },
    });

  before(async () => {
    lockDir = mkdtempSync(join(tmpdir(), "induscost-po-lock-"));
    database = await startCommissionPostgres17(pg17Bin!);
    prisma = new PrismaClient({ datasourceUrl: database.poolUrl(4) });
    await assertPrismaOnTestDatabase(prisma, database.validation.marker);
    (globalThis as unknown as { prisma: PrismaClient }).prisma = prisma;
    process.env.DATABASE_URL = database.url;
    canonical = await import("./nomusCanonicalSync.server.js");
    service = await import("./nomusPurchaseOrderSyncService.server.js");
    runner = await import("../nomusPurchaseOrdersSyncRunner.js");
    query = await import("./nomusPurchaseOrderQuery.js");
    link = await import("./nomusPurchaseOrderPayableLink.server.js");
  });

  after(async () => {
    await prisma?.$disconnect();
    await database?.stop();
    rmSync(lockDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    env = baseEnv();
    globalLockHeld = false;
    nomus.state.failOnPage = null;
    logs = [];
  });

  it("1. incremental cria o espelho (PC00636/637/638) como PRESENT, run SUCCESS rastreado", async () => {
    for (const id of [637, 638, 639]) nomus.orders.set(id, nomusOrder(id));
    now = new Date(T0.getTime() - 26 * H);
    const result = await sync({ strategy: "RECENT_WINDOW" });
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.counters.created, 3);
    const row = await po(638);
    assert.equal(row.orderNumber, "PC00637");
    assert.equal(row.stage, "APPROVED");
    assert.equal(row.sourcePresenceStatus, "PRESENT");
    assert.equal(row.lastSyncRunId, result.runId);
    const run = await prisma.nomusSourceSyncRun.findUniqueOrThrow({ where: { id: result.runId! } });
    assert.equal(run.entityType, "PURCHASE_ORDER");
    assert.equal(run.status, "SUCCESS");
    // Janela de 45 dias com filtro de datas sem semântica validada: execução ok, universo não provado.
    assert.equal(run.payloadComplete, false);
    assert.match(JSON.stringify(run.summaryJson), /DATE_FILTER_SEMANTICS_NOT_VALIDATED/);

    // Dados ligados ao pedido que nunca podem ser apagados por ausência.
    await prisma.nomusPurchaseOrderSupplierEvaluation.create({
      data: {
        nomusPurchaseOrderId: row.id,
        supplierMatchMethod: "SUPPLIER_DOCUMENT",
        supplierMatchConfidence: "HIGH",
        qualityScore: 4,
        deliveryScore: 4,
        conformityScore: 4,
        serviceScore: 4,
        overallScore: 4,
        methodologyVersion: 2,
      },
    });
    await prisma.nomusPurchaseOrderPayableLink.create({
      data: { nomusPurchaseOrderId: row.id, payableExternalId: 990638, method: "MANUAL", confidence: "HIGH" },
    });
  });

  it("2. pedido excluído no Nomus: o incremental NÃO remove nem cancela (causa do 'Aprovado' em 23/10)", async () => {
    nomus.orders.delete(638);
    now = new Date(T0.getTime() - 2 * H);
    const result = await sync({ strategy: "RECENT_WINDOW" });
    assert.equal(result.status, "SUCCESS");
    const row = await po(638);
    assert.equal(row.sourcePresenceStatus, "PRESENT");
    assert.equal(row.stage, "APPROVED");
    assert.equal(result.counters.missingCandidates, 0);
  });

  it("3. só-prévia (padrão): ausência calculada no resumo, presença intocada", async () => {
    env.NOMUS_PO_RECONCILE_PREVIEW_ONLY = "1";
    now = new Date(T0.getTime() - H);
    const result = await sync({ strategy: "FULL_RECONCILIATION" });
    assert.equal(result.status, "SUCCESS");
    assert.equal((await po(638)).sourcePresenceStatus, "PRESENT");
    const run = await prisma.nomusSourceSyncRun.findUniqueOrThrow({ where: { id: result.runId! } });
    assert.equal(run.missingCandidateCount, 0, "só-prévia não afirma ausência gravada");
    const summary = run.summaryJson as { plan: { counters: { missingCandidates: number } }; absenceWritesApplied: boolean };
    assert.equal(summary.plan.counters.missingCandidates, 1);
    assert.equal(summary.absenceWritesApplied, false);
    assert.equal(await prisma.nomusPurchaseOrderPresenceEvent.count(), 0);
  });

  it("4. 1ª reconciliação completa autorizada: MISSING_CANDIDATE, nada apagado, nada cancelado", async () => {
    now = T0;
    const result = await sync({ strategy: "FULL_RECONCILIATION" });
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.payloadComplete, true);
    const row = await po(638);
    assert.equal(row.sourcePresenceStatus, "MISSING_CANDIDATE");
    assert.equal(row.missingConsecutiveRuns, 1);
    assert.equal(row.stage, "APPROVED", "ausência nunca vira cancelamento");
    assert.equal(row.items.length, 2);
    assert.ok(row.supplierEvaluation);
    assert.equal(row.payableLinks.length, 1);
    assert.equal(row.presenceEvents.length, 1);
    assert.equal(row.presenceEvents[0]!.action, "MISSING_CANDIDATE");
    assert.equal((await po(639)).sourcePresenceStatus, "PRESENT");
    // Em verificação continua na carteira padrão.
    const active = await prisma.nomusPurchaseOrder.count({ where: query.buildNomusPurchaseOrderWhere({}) });
    assert.equal(active, 3);
  });

  it("5. nova reconciliação antes do intervalo mínimo não confirma nem incrementa", async () => {
    now = new Date(T0.getTime() + 2 * H);
    const result = await sync({ strategy: "FULL_RECONCILIATION", trigger: "ADMIN_PANEL" });
    assert.equal(result.status, "SUCCESS");
    const row = await po(638);
    assert.equal(row.sourcePresenceStatus, "MISSING_CANDIDATE");
    assert.equal(row.missingConsecutiveRuns, 1);
    assert.equal(row.presenceEvents.length, 1, "candidata → candidata não gera evento");
  });

  it("6. falha HTTP no meio da paginação: FAILED, parcial, presença intocada", async () => {
    nomus.state.failOnPage = 1;
    now = new Date(T0.getTime() + 20 * H);
    const result = await sync({ strategy: "FULL_RECONCILIATION" });
    assert.equal(result.status, "FAILED");
    const run = await prisma.nomusSourceSyncRun.findUniqueOrThrow({ where: { id: result.runId! } });
    assert.equal(run.status, "FAILED");
    assert.equal(run.payloadComplete, false);
    assert.match(run.errorMessage ?? "", /Falha HTTP 503/);
    assert.doesNotMatch(JSON.stringify(run.summaryJson), /nomus\.invalid|erro interno/, "sem URL ou corpo de resposta no log");
    assert.equal((await po(638)).missingConsecutiveRuns, 1);
  });

  it("7. limite de páginas atingido: INCONCLUSIVE, sem ausência", async () => {
    nomus.state.pageSize = 1;
    env.NOMUS_PO_PAGE_SIZE = "1";
    env.NOMUS_PO_RECONCILE_MAX_PAGES = "1";
    now = new Date(T0.getTime() + 21 * H);
    const result = await sync({ strategy: "FULL_RECONCILIATION" });
    nomus.state.pageSize = 50;
    assert.equal(result.status, "INCONCLUSIVE");
    assert.equal((await po(638)).sourcePresenceStatus, "MISSING_CANDIDATE");
    assert.equal((await po(639)).sourcePresenceStatus, "PRESENT", "não lido na página 1 ≠ ausente");
  });

  it("8. 2ª reconciliação completa em execução distinta: MISSING_CONFIRMED com histórico", async () => {
    now = new Date(T0.getTime() + 24 * H);
    const result = await sync({ strategy: "FULL_RECONCILIATION" });
    assert.equal(result.status, "SUCCESS");
    const row = await po(638);
    assert.equal(row.sourcePresenceStatus, "MISSING_CONFIRMED");
    assert.ok(row.sourceRemovedAt);
    assert.equal(row.stage, "APPROVED");
    assert.equal(row.items.length, 2);
    assert.equal(row.payableLinks.length, 1);
    assert.deepEqual(row.presenceEvents.map((e) => e.action), ["MISSING_CANDIDATE", "MISSING_CONFIRMED"]);
  });

  it("9. carteira padrão, KPIs e paginação excluem o confirmado; histórico o mostra", async () => {
    const count = (presence?: string) =>
      prisma.nomusPurchaseOrder.count({ where: query.buildNomusPurchaseOrderWhere({ presence: presence as never }) });
    assert.equal(await count(), 2);
    assert.equal(await count("ALL"), 3);
    assert.equal(await count("MISSING_CONFIRMED"), 1);
    assert.equal(await count("MISSING"), 1);
    const kpiRows = await prisma.nomusPurchaseOrder.findMany({
      where: query.buildNomusPurchaseOrderWhere({}),
      select: { stage: true, expectedAt: true, totalAmount: true },
    });
    assert.equal(query.buildNomusPurchaseOrderKpis(kpiRows, now).openCount, 2);
  });

  it("10. pedido confirmado ausente não recebe vínculo novo; o existente permanece", async () => {
    const row = await po(638);
    await assert.rejects(
      link.confirmPurchaseOrderPayableLink(row.id, { userId: "u1", userName: "Teste" } as never, { payableExternalId: 1 }, { db: prisma }),
      (error: { code?: string }) => error.code === "PURCHASE_ORDER_MISSING_IN_NOMUS"
    );
    assert.equal((await po(638)).payableLinks.length, 1);
  });

  it("11. disparo da fonte inativa é SKIPPED registrado (nunca execução dupla)", async () => {
    env.NOMUS_PO_SCHEDULE_SOURCE = "chain";
    const hourly = await sync({ strategy: "RECENT_WINDOW", trigger: "SCHEDULED_HOURLY" });
    assert.equal(hourly.status, "SKIPPED_SCHEDULE_SOURCE");
    env.NOMUS_PO_SCHEDULE_SOURCE = "independent";
    const chain = await sync({ strategy: "RECENT_WINDOW", trigger: "CHAIN_AFTER_AR" });
    assert.equal(chain.status, "SKIPPED_SCHEDULE_SOURCE");
    const skipped = await prisma.nomusSourceSyncRun.findMany({ where: { id: { in: [hourly.runId!, chain.runId!] } } });
    assert.deepEqual(skipped.map((r) => r.status), ["SKIPPED", "SKIPPED"]);
    assert.equal(nomus.state.calls > 0, true);
  });

  it("12. lock global ocupado além da espera: SKIPPED, sem chamada ao Nomus", async () => {
    globalLockHeld = true;
    const before = nomus.state.calls;
    const result = await sync({ strategy: "RECENT_WINDOW" });
    assert.equal(result.status, "SKIPPED_LOCKED");
    assert.equal(nomus.state.calls, before);
    const run = await prisma.nomusSourceSyncRun.findUniqueOrThrow({ where: { id: result.runId! } });
    assert.equal((run.summaryJson as { skipReason: string }).skipReason, "GLOBAL_LOCK_WAIT_TIMEOUT");
  });

  it("13. execuções simultâneas: a segunda é SKIPPED_LOCKED (lock de entidade)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowFetch = async (url: URL) => {
      await gate;
      return nomus.fetchJson(url);
    };
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    now = new Date(T0.getTime() + 25 * H);
    const first = canonical.runNomusPurchaseOrdersSync(
      { strategy: "RECENT_WINDOW", mode: "apply", scope: undefined, sourceTrigger: "ADMIN_PANEL" },
      (execution) =>
        service.executeNomusPurchaseOrdersSync(execution, {
          prisma,
          fetchJson: slowFetch,
          env: { ...env },
          now: () => now,
          probeGlobalLockHeld: () => false,
          waitForGlobalLockToFree: () => true,
          log: () => undefined,
        })
    );
    await new Promise((r) => setTimeout(r, 200));
    const second = await sync({ strategy: "RECENT_WINDOW", trigger: "ADMIN_PANEL" });
    release();
    assert.equal(second.status, "SKIPPED_LOCKED");
    assert.equal((await first).status, "SUCCESS");
  });

  it("14. prévia do painel (mode=preview) não grava pedido novo nem presença", async () => {
    nomus.orders.set(700, nomusOrder(700, { codigoPedido: "PC00699" }));
    const result = await sync({ strategy: "FULL_RECONCILIATION", mode: "preview", trigger: "ADMIN_PANEL" });
    assert.equal(result.status, "SUCCESS");
    assert.equal(await prisma.nomusPurchaseOrder.count({ where: { externalId: 700 } }), 0);
    const run = await prisma.nomusSourceSyncRun.findUniqueOrThrow({ where: { id: result.runId! } });
    assert.equal(run.strategy, "FULL_RECONCILIATION_PREVIEW");
    nomus.orders.delete(700);
  });

  it("15. status do painel: pulo e prévia não contam como último sucesso", async () => {
    const lastReal = await prisma.nomusSourceSyncRun.findFirstOrThrow({
      where: { entityType: "PURCHASE_ORDER", status: "SUCCESS", NOT: { strategy: { endsWith: "_PREVIEW" } } },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    });
    const status = await runner.getNomusPurchaseOrdersSyncStatus(prisma, {
      env: { ...env },
      now: new Date(now.getTime() + H),
      cronFile: join(lockDir, "inexistente"),
    });
    assert.equal(status.lastSuccess?.id, lastReal.id);
    assert.equal(status.presence.MISSING_CONFIRMED, 1);
    assert.equal(status.schedule.cronInstalled, false);
    const stale = await runner.getNomusPurchaseOrdersSyncStatus(prisma, {
      env: { ...env },
      now: new Date(now.getTime() + 10 * H),
      cronFile: join(lockDir, "inexistente"),
    });
    assert.equal(stale.overallStatus, "STALE");
  });

  it("16. reaparecimento no Nomus reativa o pedido (PRESENT) e registra o evento", async () => {
    nomus.orders.set(638, nomusOrder(638));
    now = new Date(T0.getTime() + 30 * H);
    const result = await sync({ strategy: "RECENT_WINDOW" });
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.counters.reactivated, 1);
    const row = await po(638);
    assert.equal(row.sourcePresenceStatus, "PRESENT");
    assert.equal(row.missingConsecutiveRuns, 0);
    assert.equal(row.sourceRemovedAt, null);
    assert.deepEqual(row.presenceEvents.map((e) => e.action), ["MISSING_CANDIDATE", "MISSING_CONFIRMED", "REACTIVATE"]);
  });

  it("17. guarda de volume: sumiço em massa não confirma ninguém", async () => {
    for (let id = 1000; id < 1040; id += 1) nomus.orders.set(id, nomusOrder(id, { codigoPedido: `PCM${id}` }));
    now = new Date(T0.getTime() + 40 * H);
    await sync({ strategy: "RECENT_WINDOW" });
    for (let id = 1000; id < 1040; id += 1) nomus.orders.delete(id);
    now = new Date(T0.getTime() + 41 * H);
    await sync({ strategy: "FULL_RECONCILIATION" });
    now = new Date(T0.getTime() + 66 * H);
    const second = await sync({ strategy: "FULL_RECONCILIATION" });
    const run = await prisma.nomusSourceSyncRun.findUniqueOrThrow({ where: { id: second.runId! } });
    const summary = run.summaryJson as { guards: { massGuardTriggered: boolean }; alerts: Array<{ code: string }> };
    assert.equal(summary.guards.massGuardTriggered, true);
    assert.ok(summary.alerts.some((a) => a.code === "MASS_ABSENCE_GUARD_TRIGGERED"));
    assert.equal(await prisma.nomusPurchaseOrder.count({ where: { externalId: { gte: 1000 }, sourcePresenceStatus: "MISSING_CONFIRMED" } }), 0);
    assert.ok(logs.some((l) => l.includes("ALERT code=MASS_ABSENCE_GUARD_TRIGGERED")));
  });

  it("18. consulta por ID (TARGETED_LOOKUP) atualiza só o próprio pedido e nunca prova ausência", async () => {
    now = new Date(T0.getTime() + 70 * H);
    const found = await sync({ strategy: "TARGETED_LOOKUP", target: 639, trigger: "CLI" });
    assert.equal(found.payloadComplete, false);
    const missing = await sync({ strategy: "TARGETED_LOOKUP", target: 1001, trigger: "CLI" });
    assert.notEqual(missing.status, "SUCCESS");
    assert.equal((await po(1001)).sourcePresenceStatus, "MISSING_CANDIDATE");
  });

  it("19. nenhuma linha de pedido foi apagada fisicamente em todo o ciclo", async () => {
    assert.equal(await prisma.nomusPurchaseOrder.count(), 43);
    assert.equal(await prisma.nomusPurchaseOrderItem.count({ where: { purchaseOrder: { externalId: 638 } } }), 2);
  });
});
