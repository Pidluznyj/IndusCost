import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildSalesOrderListWhere } from "@/src/lib/salesOrdersListSummary.js";
import { NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV } from "@/src/lib/nomus/nomusSourcePresencePolicy.js";
import { crmCanonicalSalesOrderWhere } from "./crmCanonicalSalesOrderScope.server.js";
import { crmEligibleCustomerWhere } from "./crmManagementOrderFacts.server.js";
import {
  CRM_REPORTS_ID_CHUNK_SIZE,
  CRM_REPORTS_ORDER_SELECT,
  CrmReportsForbiddenError,
  buildCrmReportsCommercialOwnerOptions,
  createPrismaCrmReportsDataSource,
  loadCrmReportsFilterOptions,
  loadCrmReportsOperational,
  runCrmReportsAnalysis,
  searchCrmReportsCustomerOptions,
} from "./crmReportsOperationalService.server.js";
import {
  A,
  B,
  C,
  D,
  GLOBAL_SCOPE,
  K,
  M,
  NONE_SCOPE,
  NOW,
  OWN_GISLENE_SCOPE,
  OWN_UNLINKED_SCOPE,
  X,
  analyzedIds,
  baseDb,
  createFakeDataSource,
  customer,
  idsOf,
  matchesWhere,
  order,
  request,
  type Row,
} from "./crmReportsService.fixtures.js";

// Fixtures compartilhadas (hoje = 11/09/2026): crmReportsService.fixtures.ts.

afterEach(() => {
  delete process.env[NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV];
});

// ---------------------------------------------------------------------------

describe("pré-condições dos escopos de teste (resolver real)", () => {
  it("global / own vinculado / own sem vínculo / none", () => {
    assert.equal(GLOBAL_SCOPE.dataScope, "global");
    assert.equal(OWN_GISLENE_SCOPE.dataScope, "own");
    assert.equal(OWN_GISLENE_SCOPE.sellerIdentityKey, "gislene lima");
    assert.equal(OWN_UNLINKED_SCOPE.dataScope, "own");
    assert.equal(OWN_UNLINKED_SCOPE.blockedReason, "SELLER_NOT_LINKED");
    assert.equal(NONE_SCOPE.dataScope, "none");
  });
});

describe("CANÔNICO — população de compra = Pedido de Venda oficial", () => {
  it("pedidos vêm do where canônico (todos os anos) + customerId em lote", async () => {
    const { ds, calls } = createFakeDataSource(baseDb());
    await runCrmReportsAnalysis(ds, GLOBAL_SCOPE, request().filters, { now: NOW });
    assert.equal(calls.findSalesOrders.length, 1);
    const where = calls.findSalesOrders[0] as { AND: unknown[] };
    const canonical = crmCanonicalSalesOrderWhere({ allYears: true }, { ignorePeriod: true });
    assert.deepEqual(where.AND[0], canonical);
    assert.deepEqual(Object.keys(where.AND[1] as object), ["customerId"]);
    // É exatamente a população da tela Pedidos de Venda (sem recorte de período).
    assert.deepEqual(canonical, buildSalesOrderListWhere({}, { excludeEconomicGroupCustomers: true }));
  });

  it("CANCELLED fora: não vira compra nem última compra", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(ds, GLOBAL_SCOPE, request().filters, { now: NOW });
    const alfa = run.analysis.analyzed.find((f) => f.customer.id === A.id)!;
    assert.equal(alfa.lastPurchaseDate, "2026-07-31");
    assert.equal(alfa.totalOrders, 3);
    assert.ok(!alfa.occasions.some((o) => o.businessDate === "2026-09-10"));
  });

  it("ERROR preservado quando o canônico inclui (a tela oficial conta)", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(ds, GLOBAL_SCOPE, request().filters, { now: NOW });
    const alfa = run.analysis.analyzed.find((f) => f.customer.id === A.id)!;
    assert.equal(alfa.cadence.totalOccasions, 3);
    assert.equal(alfa.orders12m, 3);
    assert.equal(alfa.purchaseValue12m, 3000.1);
    assert.equal(alfa.cadence.deltaDays, 12);
    assert.equal(alfa.cadence.status, "OVERDUE");
    assert.ok(!JSON.stringify(crmCanonicalSalesOrderWhere({ allYears: true })).includes('"ERROR"'));
  });

  it("grupo econômico fora — no cadastro (cliente) e no pedido (canônico)", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(ds, GLOBAL_SCOPE, request().filters, { now: NOW });
    assert.ok(!analyzedIds(run).includes(K.id));
    const kOrder = baseDb().orders.find((o) => o.customerId === K.id)!;
    assert.equal(
      matchesWhere({ ...kOrder, Customer: K } as Row, crmCanonicalSalesOrderWhere({ allYears: true })),
      false
    );
    assert.equal(matchesWhere(K as unknown as Row, crmEligibleCustomerWhere()), false);
    assert.equal(matchesWhere(A as unknown as Row, crmEligibleCustomerWhere()), true);
  });

  it("cliente inativo fica fora do universo", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(ds, GLOBAL_SCOPE, request().filters, { now: NOW });
    assert.ok(!analyzedIds(run).includes(X.id));
  });

  it("issueDate é o eixo (createdAt recente não muda a data de compra)", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(ds, GLOBAL_SCOPE, request().filters, { now: NOW });
    const beta = run.analysis.analyzed.find((f) => f.customer.id === B.id)!;
    assert.deepEqual(
      beta.occasions.map((o) => o.businessDate),
      ["2026-08-15", "2026-09-05"]
    );
    assert.equal(beta.cadence.expectedRepurchaseDate, "2026-09-26");
    assert.equal(beta.cadence.deltaDays, -15);
    assert.equal(beta.cadence.status, "DUE_SOON");
  });

  it("NF, proposta e atividade não criam compra", async () => {
    const db = baseDb();
    assert.ok(db.invoicesWithoutOrder.length > 0 && db.proposals.length > 0);
    const { ds } = createFakeDataSource(db);
    const run = await runCrmReportsAnalysis(ds, GLOBAL_SCOPE, request().filters, { now: NOW });
    const delta = run.analysis.analyzed.find((f) => f.customer.id === D.id)!;
    assert.equal(delta.totalOrders, 0);
    assert.equal(delta.cadence.status, "NO_HISTORY");
    assert.ok(!run.analysis.cadence.some((f) => f.customer.id === D.id));
    // O select do pedido é mínimo: nada de NF, proposta, comissão ou payload.
    assert.deepEqual(Object.keys(CRM_REPORTS_ORDER_SELECT).sort(), [
      "customerId",
      "externalSellerId",
      "id",
      "issueDate",
      "nomusSellerName",
      "orderCode",
      "totalNetValue",
    ]);
  });

  it("presença operacional Nomus segue a flag canônica (MISSING_CONFIRMED)", async () => {
    const off = await runCrmReportsAnalysis(createFakeDataSource(baseDb()).ds, GLOBAL_SCOPE, request().filters, {
      now: NOW,
    });
    assert.equal(off.analysis.analyzed.find((f) => f.customer.id === M.id)!.lastPurchaseDate, "2026-08-20");

    process.env[NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV] = "1";
    const on = await runCrmReportsAnalysis(createFakeDataSource(baseDb()).ds, GLOBAL_SCOPE, request().filters, {
      now: NOW,
    });
    const mu = on.analysis.analyzed.find((f) => f.customer.id === M.id)!;
    assert.equal(mu.lastPurchaseDate, "2026-06-20");
    assert.equal(mu.cadence.status, "INSUFFICIENT_HISTORY");
  });
});

describe("ESCOPO — carteira = Responsável Comercial; nunca amplia acesso", () => {
  it("global: todos os clientes elegíveis (ativos, fora do grupo)", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(ds, GLOBAL_SCOPE, request().filters, { now: NOW });
    assert.deepEqual(analyzedIds(run), [A.id, B.id, C.id, D.id, M.id].sort());
    assert.equal(run.analysis.universe.authorizedCustomers, 5);
    assert.equal(run.scope.dataScope, "global");
  });

  it("own: só clientes com Responsável Comercial ATIVO do usuário", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(ds, OWN_GISLENE_SCOPE, request().filters, { now: NOW });
    // C tem responsável inativo; K é grupo; X é inativo.
    assert.deepEqual(analyzedIds(run), [A.id, M.id].sort());
    assert.equal(run.analysis.universe.authorizedCustomers, 2);
  });

  it("vendedor Nomus não concede acesso (B tem pedidos da Gislene, mas é carteira da Joseane)", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(ds, OWN_GISLENE_SCOPE, request().filters, { now: NOW });
    assert.ok(!analyzedIds(run).includes(B.id));

    // Nem pelo filtro "vendedor do último pedido" = Gislene (464).
    const bySeller = await runCrmReportsAnalysis(
      createFakeDataSource(baseDb()).ds,
      OWN_GISLENE_SCOPE,
      request({ filters: { lastOrderSeller: { sellerKey: "464" } } }).filters,
      { now: NOW }
    );
    assert.deepEqual(analyzedIds(bySeller), [M.id]);
  });

  it("own: filtro de responsável de outro vendedor é ignorado (carteira forçada)", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(
      ds,
      OWN_GISLENE_SCOPE,
      request({ filters: { commercialOwner: { sellerIdentityKey: "Joseane Souza" } } }).filters,
      { now: NOW }
    );
    assert.deepEqual(analyzedIds(run), [A.id, M.id].sort());
    assert.equal(run.scope.commercialOwnerFilterIgnored, true);
    assert.equal(run.scope.commercialOwnerFilterApplied, false);
  });

  it("cliente fora da carteira em ONLY é ignorado e contado", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(
      ds,
      OWN_GISLENE_SCOPE,
      request({ filters: { customerSelection: { mode: "ONLY", customerIds: [B.id] } } }).filters,
      { now: NOW }
    );
    assert.equal(run.analysis.universe.analyzedCustomers, 0);
    assert.equal(run.analysis.selection.idsOutsideUniverse, 1);
  });

  it("usuário sem vínculo: universo vazio, sem cair no global", async () => {
    const { ds, calls } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(ds, OWN_UNLINKED_SCOPE, request().filters, { now: NOW });
    assert.equal(run.analysis.universe.authorizedCustomers, 0);
    assert.equal(run.analysis.universe.analyzedCustomers, 0);
    assert.equal(run.scope.blockedReason, "SELLER_NOT_LINKED");
    assert.equal(calls.findCustomers.length, 0, "não consulta clientes sem carteira");
    assert.equal(calls.findSalesOrders.length, 0, "não consulta pedidos sem carteira");
  });

  it("none: proibido no serviço (defesa em profundidade além da rota)", async () => {
    const { ds } = createFakeDataSource(baseDb());
    await assert.rejects(
      () => runCrmReportsAnalysis(ds, NONE_SCOPE, request().filters, { now: NOW }),
      CrmReportsForbiddenError
    );
  });

  it("filtro de inclusão customerIds: recorta antes das exclusões e nunca amplia", async () => {
    const global = await runCrmReportsAnalysis(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      request({ filters: { customerIds: [A.id, B.id, K.id] } }).filters,
      { now: NOW }
    );
    assert.deepEqual(analyzedIds(global), [A.id, B.id].sort(), "K (grupo econômico) não entra por ID");
    assert.equal(global.analysis.universe.authorizedCustomers, 5);
    assert.equal(global.analysis.universe.matchedBeforeExclusions, 2);
    assert.equal(global.analysis.universe.manuallyExcluded, 0);

    const own = await runCrmReportsAnalysis(
      createFakeDataSource(baseDb()).ds,
      OWN_GISLENE_SCOPE,
      request({ filters: { customerIds: [B.id] } }).filters,
      { now: NOW }
    );
    assert.equal(own.analysis.universe.analyzedCustomers, 0, "cliente fora da carteira não entra por ID");
  });

  it("global + responsável: filtra pela carteira (CrmCustomerCommercialOwner)", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(
      ds,
      GLOBAL_SCOPE,
      request({ filters: { commercialOwner: { sellerIdentityKey: "Joseane Souza" } } }).filters,
      { now: NOW }
    );
    assert.deepEqual(analyzedIds(run), [B.id]);
    assert.equal(run.analysis.universe.authorizedCustomers, 5);
    assert.equal(run.analysis.universe.matchedBeforeExclusions, 1);
    assert.equal(run.scope.commercialOwnerFilterApplied, true);
  });
});

describe("vendedor do último pedido — auditoria/filtro, nunca cadência", () => {
  it("'Joseane' seleciona quem tem o ÚLTIMO PV dela; cadência usa todas as compras", async () => {
    const { ds, calls } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(
      ds,
      GLOBAL_SCOPE,
      request({ filters: { lastOrderSeller: { sellerName: "Joseane" } } }).filters,
      { now: NOW }
    );
    assert.deepEqual(analyzedIds(run), [A.id]);
    assert.equal(run.analysis.analyzed[0]!.cadence.totalOccasions, 3);
    assert.equal(calls.loadSellerIdentityContext, 1);
  });

  it("sellerKey tem prioridade e dispensa o contexto de identidade", async () => {
    const { ds, calls } = createFakeDataSource(baseDb());
    const run = await runCrmReportsAnalysis(
      ds,
      GLOBAL_SCOPE,
      request({ filters: { lastOrderSeller: { sellerKey: "501", sellerName: "Gislene" } } }).filters,
      { now: NOW }
    );
    assert.deepEqual(analyzedIds(run), [A.id]);
    assert.equal(calls.loadSellerIdentityContext, 0);
  });
});

describe("endpoint — contrato, reconciliação e ausência de N+1", () => {
  it("resposta completa: sourceInfo, universo, indicadores e 3 listas", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const res = await loadCrmReportsOperational(ds, GLOBAL_SCOPE, request(), { now: NOW });
    assert.equal(res.asOf, NOW.toISOString());
    assert.equal(res.windows.today, "2026-09-11");
    assert.deepEqual(
      {
        orderSource: res.sourceInfo.orderSource,
        dateAxis: res.sourceInfo.dateAxis,
        portfolioAxis: res.sourceInfo.portfolioAxis,
        orderSellerAxis: res.sourceInfo.orderSellerAxis,
        repurchaseVersion: res.sourceInfo.repurchaseVersion,
        truncated: res.sourceInfo.truncated,
        historyWindow: res.sourceInfo.historyWindow,
      },
      {
        orderSource: "SalesOrder",
        dateAxis: "SalesOrder.issueDate",
        portfolioAxis: "RESPONSAVEL_COMERCIAL_CLIENTE",
        orderSellerAxis: "AUDIT_ONLY",
        repurchaseVersion: "LAST_6_DISTINCT_PURCHASE_DAYS_MEAN_V1",
        truncated: false,
        historyWindow: "FULL_HISTORY",
      }
    );
    assert.match(res.sourceInfo.validitySource, /crmCanonicalSalesOrderWhere/);
    assert.deepEqual(res.universe, {
      authorizedCustomers: 5,
      matchedBeforeExclusions: 5,
      manuallyExcluded: 0,
      analyzedCustomers: 5,
    });
    assert.deepEqual(res.indicators, {
      customersPurchased60d: 4,
      repurchaseDueNext15d: 1,
      overdueRepurchase: 1,
      severelyOverdueRepurchase: 0,
      insufficientCadence: 1,
    });
    assert.equal(res.recent60d.total, res.indicators.customersPurchased60d);
    assert.equal(res.overdueRepurchase.total, res.indicators.overdueRepurchase);
    assert.deepEqual(idsOf(res.recent60d.rows), [B.id, C.id, M.id, A.id]);
    assert.deepEqual(idsOf(res.repurchaseCadence.rows), [A.id, B.id, C.id, M.id]);

    const overdueRow = res.overdueRepurchase.rows[0]!;
    assert.equal(overdueRow.customerId, A.id);
    assert.equal(overdueRow.commercialOwnerName, "Gislene Lima");
    assert.equal(overdueRow.lastOrderSellerLabel, "JOSEANE SOUZA", "vendedor do último pedido ≠ responsável");
    assert.equal(overdueRow.lastOrderSellerResolution, "RESOLVED");
    assert.equal(overdueRow.hasOverdueFollowUp, true);
    assert.equal(overdueRow.nextFollowUpAt, new Date(2026, 8, 20, 9).toISOString());
    assert.equal(overdueRow.lastContactAt, new Date(2026, 8, 8, 9).toISOString());
  });

  it("visões: card 'Recompra nos próximos 15 dias' filtra a cadência sem mudar cards", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const res = await loadCrmReportsOperational(
      ds,
      GLOBAL_SCOPE,
      request({ views: { cadence: { statuses: ["DUE_SOON"] }, overdue: { sort: "VALUE_12M_DESC" } } }),
      { now: NOW }
    );
    assert.deepEqual(res.appliedViews, {
      cadence: { statuses: ["DUE_SOON"] },
      overdue: { severity: "ALL", sort: "VALUE_12M_DESC" },
    });
    assert.equal(res.repurchaseCadence.total, res.indicators.repurchaseDueNext15d);
    assert.deepEqual(idsOf(res.repurchaseCadence.rows), [B.id]);
    assert.deepEqual(res.overdueRepurchase.sort, ["purchaseValue12m:desc", "deltaDays:desc", "displayName:asc"]);
    // Cards continuam do universo inteiro.
    assert.equal(res.indicators.customersPurchased60d, 4);
    assert.equal(res.indicators.insufficientCadence, 1);
    // Último pedido canônico para o modal (ERROR entra; CANCELLED não).
    const alfaOverdue = res.overdueRepurchase.rows.find((r) => r.customerId === A.id)!;
    assert.ok(alfaOverdue.lastOrderId);
    assert.equal(alfaOverdue.lastOrderSellerExternalId, 501);
  });

  it("EXCLUDE no endpoint: cards e listas reconciliam no mesmo universo", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const res = await loadCrmReportsOperational(
      ds,
      GLOBAL_SCOPE,
      request({ filters: { customerSelection: { mode: "EXCLUDE", customerIds: [A.id, C.id] } } }),
      { now: NOW }
    );
    assert.equal(res.universe.manuallyExcluded, 2);
    assert.equal(res.universe.analyzedCustomers, 3);
    assert.equal(res.indicators.overdueRepurchase, 0);
    assert.equal(res.indicators.insufficientCadence, 0);
    assert.equal(res.overdueRepurchase.total, 0);
    assert.equal(res.recent60d.total, res.indicators.customersPurchased60d);
    for (const page of [res.recent60d, res.repurchaseCadence, res.overdueRepurchase]) {
      assert.ok(!page.rows.some((r) => r.customerId === A.id || r.customerId === C.id));
    }
  });

  it("paginação: total nunca é o tamanho da página e enriquecimento só da página", async () => {
    const { ds, calls } = createFakeDataSource(baseDb());
    const res = await loadCrmReportsOperational(
      ds,
      GLOBAL_SCOPE,
      request({ pagination: { recent: { limit: 1 }, cadence: { limit: 1, offset: 1 }, overdue: { limit: 1 } } }),
      { now: NOW }
    );
    assert.equal(res.recent60d.rows.length, 1);
    assert.equal(res.recent60d.total, 4);
    assert.equal(res.recent60d.hasMore, true);
    assert.equal(res.repurchaseCadence.rows.length, 1);
    assert.equal(res.repurchaseCadence.total, 4);
    assert.equal(res.repurchaseCadence.rows[0]!.customerId, B.id);
    assert.equal(calls.resolveCommercialOwners.length, 1);
    assert.ok(calls.resolveCommercialOwners[0]!.length <= 3, "só as linhas das páginas são enriquecidas");
    assert.deepEqual(calls.findActivities, [[A.id]]);
  });

  it("sem N+1: consultas em lote, número independe da quantidade de clientes", async () => {
    const db = baseDb();
    const many = Array.from({ length: 2500 }, (_, i) => customer(1000 + i, `Cliente ${String(i).padStart(4, "0")}`));
    db.customers = [...db.customers, ...many];
    db.orders = [...db.orders, ...many.map((c, i) => order(c.id, i % 2 === 0 ? "2026-09-01" : "2026-05-01", 10))];
    const { ds, calls } = createFakeDataSource(db);
    const res = await loadCrmReportsOperational(ds, GLOBAL_SCOPE, request(), { now: NOW });
    assert.equal(res.universe.analyzedCustomers, 2505);
    assert.equal(calls.findCustomers.length, 1);
    assert.equal(calls.findSalesOrders.length, Math.ceil(2505 / CRM_REPORTS_ID_CHUNK_SIZE));
    for (const where of calls.findSalesOrders as { AND: [unknown, { customerId: { in: string[] } }] }[]) {
      assert.ok(where.AND[1].customerId.in.length <= CRM_REPORTS_ID_CHUNK_SIZE);
    }
    assert.equal(calls.resolveCommercialOwners.length, 1);
    assert.ok(calls.resolveCommercialOwners[0]!.length <= 150);
    assert.ok(calls.findActivities.length <= 1);
    assert.ok(calls.loadSellerIdentityContext <= 1);
    assert.equal(res.recent60d.rows.length, 50);
    assert.ok(res.recent60d.total > 50);
  });

  it("ONLY sem filtro de vendedor carrega pedidos só dos selecionados — mesmo resultado", async () => {
    const db = baseDb();
    const full = createFakeDataSource(db);
    const fullRes = await loadCrmReportsOperational(full.ds, GLOBAL_SCOPE, request(), { now: NOW });
    const only = createFakeDataSource(db);
    const onlyRes = await loadCrmReportsOperational(
      only.ds,
      GLOBAL_SCOPE,
      request({ filters: { customerSelection: { mode: "ONLY", customerIds: [A.id] } } }),
      { now: NOW }
    );
    const where = only.calls.findSalesOrders[0] as { AND: [unknown, { customerId: { in: string[] } }] };
    assert.deepEqual(where.AND[1].customerId.in, [A.id]);
    assert.equal(onlyRes.universe.matchedBeforeExclusions, 5);
    assert.equal(onlyRes.universe.analyzedCustomers, 1);
    const fullAlfa = fullRes.overdueRepurchase.rows.find((r) => r.customerId === A.id);
    assert.deepEqual(onlyRes.overdueRepurchase.rows[0], fullAlfa);
  });
});

describe("opções leves e escopadas (filtros)", () => {
  it("busca de cliente: nome, fantasia e CNPJ só com dígitos — dentro do escopo", async () => {
    const db = baseDb();
    db.customers = db.customers.map((c) =>
      c.id === B.id ? { ...c, tradeName: "Britânia Eletro", taxId: "07.019.308/0001-28" } : c
    );
    const { ds, calls } = createFakeDataSource(db);
    const byTrade = await searchCrmReportsCustomerOptions(ds, GLOBAL_SCOPE, { ok: true, mode: "search", q: "britânia", limit: 20 });
    assert.deepEqual(byTrade.options.map((o) => o.id), [B.id]);
    const byDigits = await searchCrmReportsCustomerOptions(ds, GLOBAL_SCOPE, { ok: true, mode: "search", q: "07019308", limit: 20 });
    assert.deepEqual(byDigits.options.map((o) => o.id), [B.id], "dígitos casam com CNPJ formatado");
    const groupHidden = await searchCrmReportsCustomerOptions(ds, GLOBAL_SCOPE, { ok: true, mode: "search", q: "Koppetel", limit: 20 });
    assert.deepEqual(groupHidden.options, [], "grupo econômico nunca aparece");
    assert.ok(calls.searchCustomers.every((c) => c.take <= 21), "busca limitada — nunca baixa a carteira");
  });

  it("busca respeita a carteira own e não vaza cliente de outro responsável (nem por ID)", async () => {
    const { ds } = createFakeDataSource(baseDb());
    const search = await searchCrmReportsCustomerOptions(ds, OWN_GISLENE_SCOPE, { ok: true, mode: "search", q: "Beta", limit: 20 });
    assert.deepEqual(search.options, []);
    const byIds = await searchCrmReportsCustomerOptions(ds, OWN_GISLENE_SCOPE, { ok: true, mode: "ids", ids: [A.id, B.id, K.id] });
    assert.deepEqual(byIds.options.map((o) => o.id), [A.id], "B é de outra carteira; K é grupo");
    const unlinked = await searchCrmReportsCustomerOptions(ds, OWN_UNLINKED_SCOPE, { ok: true, mode: "search", q: "Alfa", limit: 20 });
    assert.deepEqual(unlinked.options, []);
    await assert.rejects(
      () => searchCrmReportsCustomerOptions(ds, NONE_SCOPE, { ok: true, mode: "search", q: "Alfa", limit: 20 }),
      CrmReportsForbiddenError
    );
  });

  it("hasMore quando passa do limite (paginação da busca, sem baixar tudo)", async () => {
    const db = baseDb();
    db.customers = [...db.customers, ...Array.from({ length: 30 }, (_, i) => customer(500 + i, `Cliente Busca ${i}`))];
    const { ds } = createFakeDataSource(db);
    const res = await searchCrmReportsCustomerOptions(ds, GLOBAL_SCOPE, { ok: true, mode: "search", q: "Busca", limit: 10 });
    assert.equal(res.options.length, 10);
    assert.equal(res.hasMore, true);
  });

  it("filter-options global: responsáveis ativos, vendedores dos pedidos canônicos, cidades/UF do universo", async () => {
    const db = baseDb();
    db.customers = db.customers.map((c) => (c.id === C.id ? { ...c, city: "São Paulo", state: "sp" } : c));
    const { ds } = createFakeDataSource(db);
    const res = await loadCrmReportsFilterOptions(ds, GLOBAL_SCOPE);
    assert.equal(res.commercialOwnerFilterEnabled, true);
    assert.deepEqual(
      res.commercialOwners.map((o) => ({ label: o.label, count: o.customerCount, filter: o.filter })),
      [
        // A e M (Gislene ativa; K é grupo e X inativo — fora do universo). C tem vínculo INATIVO.
        { label: "Gislene Lima", count: 2, filter: { sellerIdentityKey: "gislene lima" } },
        { label: "Joseane Souza", count: 1, filter: { sellerIdentityKey: "joseane souza" } },
      ]
    );
    assert.deepEqual(
      res.lastOrderSellers.map((s) => s.sellerKey).sort(),
      ["464", "501"],
      "só vendedores de pedidos canônicos do universo (CANCELLED/grupo/inativo fora)"
    );
    const joseane = res.lastOrderSellers.find((s) => s.sellerKey === "501")!;
    assert.equal(joseane.label, "JOSEANE SOUZA");
    assert.equal(joseane.orderCount, 3, "ERROR entra; CANCELLED não");
    assert.deepEqual(res.cities, [
      { value: "Curitiba", customerCount: 4 },
      { value: "São Paulo", customerCount: 1 },
    ]);
    assert.deepEqual(res.states, [
      { value: "PR", customerCount: 4 },
      { value: "SP", customerCount: 1 },
    ]);
  });

  it("filter-options own: sem filtro de responsável e opções só da própria carteira", async () => {
    const { ds, calls } = createFakeDataSource(baseDb());
    const res = await loadCrmReportsFilterOptions(ds, OWN_GISLENE_SCOPE);
    assert.equal(res.commercialOwnerFilterEnabled, false);
    assert.deepEqual(res.commercialOwners, []);
    assert.equal(calls.findActiveCommercialOwners, 0);
    // Só pedidos dos clientes da carteira (A: Joseane ×3; M: Gislene ×2) — B e C
    // também têm pedidos da Gislene, mas não são da carteira e não contam.
    assert.deepEqual(
      res.lastOrderSellers.map((s) => [s.sellerKey, s.orderCount]),
      [["464", 2], ["501", 3]]
    );
    assert.equal(res.cities.reduce((acc, c) => acc + c.customerCount, 0), 2);
  });

  it("opções de responsável: vínculo só por ID vira filtro por externalSellerId", () => {
    const options = buildCrmReportsCommercialOwnerOptions(
      [
        { customerId: "c1", sellerIdentityKey: "__ID_ONLY__:777", sellerCanonicalName: "Vendedor ID 777", sellerResponsibleName: null, sellerExternalId: 777 },
        { customerId: "c2", sellerIdentityKey: "__ID_ONLY__:777", sellerCanonicalName: "Vendedor ID 777", sellerResponsibleName: null, sellerExternalId: 777 },
        { customerId: "fora", sellerIdentityKey: "ana", sellerCanonicalName: "Ana", sellerResponsibleName: null, sellerExternalId: 1 },
      ],
      new Set(["c1", "c2"])
    );
    assert.equal(options.length, 1);
    assert.deepEqual(options[0]!.filter, { externalSellerId: 777 });
    assert.equal(options[0]!.customerCount, 2);
    assert.match(options[0]!.label, /ID Nomus 777/);
  });
});

describe("fonte Prisma — consultas mínimas e somente leitura", () => {
  it("usa findMany com select mínimo e nunca escreve", async () => {
    const seen: Array<{ model: string; method: string; args: Record<string, unknown> }> = [];
    const handler = (model: string) =>
      new Proxy(
        {},
        {
          get: (_target, method: string) => async (args: Record<string, unknown>) => {
            seen.push({ model, method, args });
            return [];
          },
        }
      );
    const prisma = new Proxy({}, { get: (_t, model: string) => handler(model) });
    const ds = createPrismaCrmReportsDataSource(prisma as never);
    await ds.findCustomers(crmEligibleCustomerWhere());
    await ds.findSalesOrders({ id: "x" });
    await ds.findActivities([A.id]);
    await ds.findActivities([]);
    assert.deepEqual(
      seen.map((s) => `${s.model}.${s.method}`),
      ["customer.findMany", "salesOrder.findMany", "commercialActivity.findMany"]
    );
    assert.deepEqual(seen[1]!.args.select, CRM_REPORTS_ORDER_SELECT);
  });
});
