import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCrmCustomReportRequest } from "./crmCustomReportCore.js";
import { loadCrmCustomReport } from "./crmCustomReportService.server.js";
import { CrmReportsForbiddenError, loadCrmReportsOperational } from "./crmReportsOperationalService.server.js";
import type { CrmCustomReportRequest, CrmCustomReportResponse, CrmCustomReportSpec } from "./crmReportsTypes.js";
import {
  A,
  B,
  C,
  D,
  GLOBAL_SCOPE,
  M,
  NONE_SCOPE,
  NOW,
  OWN_GISLENE_SCOPE,
  OWN_UNLINKED_SCOPE,
  baseDb,
  createFakeDataSource,
  request,
} from "./crmReportsService.fixtures.js";

// Fixtures compartilhadas com as listas (hoje = 11/09/2026): o personalizado
// tem de sair do MESMO pipeline — os testes reconciliam com as listas.

function spec(body: Partial<CrmCustomReportRequest>): CrmCustomReportSpec {
  const parsed = parseCrmCustomReportRequest({ dimensions: ["customer"], metrics: ["soldValue", "orders"], ...body });
  if (parsed.ok !== true) throw new Error(`spec inválido no teste: ${parsed.errors.join(" ")}`);
  return parsed.spec;
}

const rowIds = (res: CrmCustomReportResponse) => res.rows.map((r) => r.customerId);
const byLabel = (res: CrmCustomReportResponse, dimension: "commercialOwner" | "orderSeller") =>
  new Map(res.rows.map((r) => [r.dimensions[dimension]!.label, r.metrics]));

describe("relatório personalizado — mesmo pipeline das listas", () => {
  it("Vendas por Cliente (histórico): universo das listas, sem compra fora, totais do backend, sem I/O extra", async () => {
    const { ds, calls } = createFakeDataSource(baseDb());
    const res = await loadCrmCustomReport(ds, GLOBAL_SCOPE, spec({ metrics: ["soldValue", "orders", "customers"] }), { now: NOW });
    const operational = await loadCrmReportsOperational(createFakeDataSource(baseDb()).ds, GLOBAL_SCOPE, request(), { now: NOW });

    assert.deepEqual(res.universe, operational.universe);
    assert.deepEqual(rowIds(res), [A.id, B.id, C.id, M.id]); // D nunca comprou: fora de um relatório de venda
    assert.deepEqual(
      res.rows.map((r) => [r.dimensions.customer!.label, r.metrics.soldValue, r.metrics.orders]),
      [
        ["Alfa Ltda", 3000.1, 3], // ERROR conta; CANCELLED (99.999) não
        ["Beta SA", 1600, 2],
        ["Gama Comércio", 750, 1],
        ["Mu Presença", 200, 2],
      ]
    );
    assert.equal(res.rows[0]!.dimensions.customer!.sublabel, A.taxId);
    assert.deepEqual(res.totals, { soldValue: 5550.1, orders: 8, customers: 4 });
    assert.equal(res.total, 4);
    assert.equal(res.groups, null);
    assert.equal(res.sourceInfo.periodAxis, "SalesOrder.issueDate (dia civil local)");
    assert.equal(res.sourceInfo.repurchaseVersion, operational.sourceInfo.repurchaseVersion);
    // Sem dimensão de responsável/vendedor: nenhuma consulta de enriquecimento.
    assert.equal(calls.resolveCommercialOwners.length, 0);
    assert.equal(calls.loadSellerIdentityContext, 0);
    assert.equal(calls.findActivities.length, 0);
    assert.equal(calls.findSalesOrders.length, 1);
  });

  it("reconcilia com as listas: janelas 12m e 60d batem com Venda/Pedidos 12m e 60d", async () => {
    const operational = await loadCrmReportsOperational(createFakeDataSource(baseDb()).ds, GLOBAL_SCOPE, request(), { now: NOW });
    const w = operational.windows;

    const r12 = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      spec({ period: { from: w.rolling12m.from, to: w.rolling12m.to } }),
      { now: NOW }
    );
    const cadenceById = new Map(operational.repurchaseCadence.rows.map((r) => [r.customerId, r]));
    const with12m = operational.repurchaseCadence.rows.filter((r) => r.orders12m > 0).map((r) => r.customerId);
    assert.deepEqual(new Set(rowIds(r12)), new Set(with12m));
    for (const row of r12.rows) {
      const list = cadenceById.get(row.customerId!)!;
      assert.equal(row.metrics.soldValue, list.purchaseValue12m, row.dimensions.customer!.label);
      assert.equal(row.metrics.orders, list.orders12m, row.dimensions.customer!.label);
    }

    const r60 = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      spec({ period: { from: w.recent60d.from, to: w.recent60d.to } }),
      { now: NOW }
    );
    const recentById = new Map(operational.recent60d.rows.map((r) => [r.customerId, r]));
    assert.deepEqual(new Set(rowIds(r60)), new Set(recentById.keys()));
    for (const row of r60.rows) {
      assert.equal(row.metrics.soldValue, recentById.get(row.customerId!)!.purchaseValue60d);
      assert.equal(row.metrics.orders, recentById.get(row.customerId!)!.orders60d);
    }
  });

  it("clientes ocultados (EXCLUDE) e somente selecionados (ONLY) valem igual aqui", async () => {
    const excluded = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      spec({ filters: { customerSelection: { mode: "EXCLUDE", customerIds: [A.id] } } }),
      { now: NOW }
    );
    assert.ok(!rowIds(excluded).includes(A.id));
    assert.equal(excluded.universe.manuallyExcluded, 1);
    assert.deepEqual(excluded.totals, { soldValue: 2550, orders: 5 });

    const only = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      spec({ filters: { customerSelection: { mode: "ONLY", customerIds: [B.id] } } }),
      { now: NOW }
    );
    assert.deepEqual(rowIds(only), [B.id]);
    assert.equal(only.universe.analyzedCustomers, 1);
    assert.deepEqual(only.totals, { soldValue: 1600, orders: 2 });
  });

  it("paginação real: total/hasMore do backend, totais independem da página", async () => {
    const page1 = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      spec({ pagination: { limit: 2, offset: 0 } }),
      { now: NOW }
    );
    assert.deepEqual(rowIds(page1), [A.id, B.id]);
    assert.equal(page1.total, 4);
    assert.equal(page1.returned, 2);
    assert.equal(page1.hasMore, true);
    const page2 = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      spec({ pagination: { limit: 2, offset: 2 } }),
      { now: NOW }
    );
    assert.deepEqual(rowIds(page2), [C.id, M.id]);
    assert.equal(page2.hasMore, false);
    assert.deepEqual(page2.totals, page1.totals);
  });
});

describe("relatório personalizado — Responsável Comercial × Vendedor do pedido", () => {
  it("Responsável Comercial = carteira ativa, resolvida em UM lote só quando pedida", async () => {
    const { ds, calls } = createFakeDataSource(baseDb());
    const res = await loadCrmCustomReport(
      ds,
      GLOBAL_SCOPE,
      spec({ dimensions: ["commercialOwner"], metrics: ["soldValue", "customers"] }),
      { now: NOW }
    );
    const owners = byLabel(res, "commercialOwner");
    assert.deepEqual(owners.get("Gislene Lima"), { soldValue: 3200.1, customers: 2 }); // Alfa + Mu
    assert.deepEqual(owners.get("Joseane Souza"), { soldValue: 1600, customers: 1 }); // Beta
    // Gama: responsável INATIVO → sem responsável (nunca herda do vendedor do pedido).
    assert.deepEqual(owners.get("Sem responsável comercial"), { soldValue: 750, customers: 1 });
    assert.equal(calls.resolveCommercialOwners.length, 1);
    assert.equal(calls.loadSellerIdentityContext, 0);
  });

  it("Vendedor do pedido é auditoria: cada pedido cai numa linha; divergência fica visível", async () => {
    const { ds, calls } = createFakeDataSource(baseDb());
    const res = await loadCrmCustomReport(
      ds,
      GLOBAL_SCOPE,
      spec({ dimensions: ["commercialOwner", "orderSeller"], metrics: ["soldValue", "orders"] }),
      { now: NOW }
    );
    const cells = res.rows.map((r) => [
      r.dimensions.commercialOwner!.label,
      r.dimensions.orderSeller!.sublabel,
      r.metrics.soldValue,
      r.metrics.orders,
    ]);
    assert.deepEqual(
      new Set(cells.map((c) => JSON.stringify(c))),
      new Set(
        [
          ["Gislene Lima", "ID Nomus 501", 3000.1, 3], // carteira da Gislene, pedidos lançados pela Joseane
          ["Gislene Lima", "ID Nomus 464", 200, 2],
          ["Joseane Souza", "ID Nomus 464", 1600, 2], // carteira da Joseane, pedidos lançados pela Gislene
          ["Sem responsável comercial", "ID Nomus 464", 750, 1],
        ].map((c) => JSON.stringify(c))
      )
    );
    assert.deepEqual(res.totals, { soldValue: 5550.1, orders: 8 }); // nenhum pedido contado duas vezes
    const seller501 = res.rows.find((r) => r.dimensions.orderSeller!.sublabel === "ID Nomus 501")!;
    assert.match(seller501.dimensions.orderSeller!.label, /JOSEANE/i);
    assert.equal(calls.loadSellerIdentityContext, 1);
    assert.equal(calls.resolveCommercialOwners.length, 1);
  });

  it("escopo próprio: só a carteira do usuário — vendedor Nomus dos pedidos nunca amplia", async () => {
    const res = await loadCrmCustomReport(createFakeDataSource(baseDb()).ds, OWN_GISLENE_SCOPE, spec({}), { now: NOW });
    // Beta tem pedidos lançados pela Gislene (Nomus 464), mas a carteira é da Joseane.
    assert.deepEqual(rowIds(res), [A.id, M.id]);
    const bySeller = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      OWN_GISLENE_SCOPE,
      spec({ dimensions: ["orderSeller"], metrics: ["soldValue", "customers"] }),
      { now: NOW }
    );
    assert.deepEqual(bySeller.totals, { soldValue: 3200.1, customers: 2 });
    // Filtro de responsável de outra pessoa é ignorado no escopo próprio.
    const foreignOwner = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      OWN_GISLENE_SCOPE,
      spec({ filters: { commercialOwner: { sellerIdentityKey: "joseane souza" } } }),
      { now: NOW }
    );
    assert.deepEqual(rowIds(foreignOwner), [A.id, M.id]);
    assert.equal(foreignOwner.scope.commercialOwnerFilterIgnored, true);
  });

  it("sem vínculo → universo vazio (sem erro); sem escopo CRM → proibido", async () => {
    const res = await loadCrmCustomReport(createFakeDataSource(baseDb()).ds, OWN_UNLINKED_SCOPE, spec({}), { now: NOW });
    assert.equal(res.total, 0);
    assert.deepEqual(res.rows, []);
    assert.equal(res.scope.blockedReason, "SELLER_NOT_LINKED");
    await assert.rejects(
      () => loadCrmCustomReport(createFakeDataSource(baseDb()).ds, NONE_SCOPE, spec({}), { now: NOW }),
      CrmReportsForbiddenError
    );
  });
});

describe("relatório personalizado — situação do cliente vem do motor", () => {
  it("Atrasados para recompra = exatamente a lista 3 (mesmos clientes e dias de atraso)", async () => {
    const operational = await loadCrmReportsOperational(createFakeDataSource(baseDb()).ds, GLOBAL_SCOPE, request(), { now: NOW });
    const res = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      spec({ customerStatus: "REPURCHASE_OVERDUE", metrics: ["overdueDays", "averageRepurchaseDays"] }),
      { now: NOW }
    );
    assert.ok(operational.overdueRepurchase.total > 0);
    assert.deepEqual(
      new Set(rowIds(res)),
      new Set(operational.overdueRepurchase.rows.map((r) => r.customerId))
    );
    for (const row of operational.overdueRepurchase.rows) {
      const custom = res.rows.find((r) => r.customerId === row.customerId)!;
      assert.equal(custom.metrics.overdueDays, row.overdueDays);
      assert.equal(custom.metrics.averageRepurchaseDays, row.averageRepurchaseDays);
    }
    assert.equal(res.rows.find((r) => r.customerId === A.id)!.metrics.overdueDays, 12);
  });

  it("Sem compra no período inclui quem nunca comprou (sem previsão inventada)", async () => {
    const operational = await loadCrmReportsOperational(createFakeDataSource(baseDb()).ds, GLOBAL_SCOPE, request(), { now: NOW });
    const w = operational.windows;
    const res = await loadCrmCustomReport(
      createFakeDataSource(baseDb()).ds,
      GLOBAL_SCOPE,
      spec({
        period: { from: w.recent60d.from, to: w.recent60d.to },
        customerStatus: "WITHOUT_PURCHASE",
        metrics: ["lastPurchaseDate", "daysSinceLastPurchase", "soldValue"],
      }),
      { now: NOW }
    );
    assert.deepEqual(rowIds(res), [D.id]);
    assert.deepEqual(res.rows[0]!.metrics, { lastPurchaseDate: null, daysSinceLastPurchase: null, soldValue: 0 });
  });
});
