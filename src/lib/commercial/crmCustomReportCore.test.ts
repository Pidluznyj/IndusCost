import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CrmCustomReportTooLargeError,
  computeCrmCustomReport,
  describeCrmCustomReportMetricAvailability,
  pageCrmCustomReport,
  parseCrmCustomReportRequest,
  type CrmCustomReportContext,
} from "./crmCustomReportCore.js";
import {
  buildCrmReportsAnalysis,
  resolveCrmReportsWindows,
  type CrmReportsCustomerRecord,
  type CrmReportsOrderRecord,
} from "./crmReportsOperationalCore.js";
import { CRM_CUSTOM_REPORT_MAX_ROWS, type CrmCustomReportSpec } from "./crmReportsTypes.js";

const NOW = new Date(2026, 8, 11, 10, 0, 0);
const WINDOWS = resolveCrmReportsWindows(NOW);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const customer = (n: number, companyName: string, extra: Partial<CrmReportsCustomerRecord> = {}): CrmReportsCustomerRecord => ({
  id: uuid(n),
  companyName,
  tradeName: null,
  taxId: `33.333.333/0001-${String(n).padStart(2, "0")}`,
  city: "Curitiba",
  state: "PR",
  ...extra,
});

let seq = 0;
const order = (customerId: string, ymd: string, value: number, sellerId: number | null = null): CrmReportsOrderRecord => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  seq += 1;
  return {
    id: `co-${seq}`,
    customerId,
    orderCode: `PD ${String(seq).padStart(5, "0")}`,
    issueDate: new Date(y, m - 1, d, 10, 0, 0),
    totalNetValue: value,
    externalSellerId: sellerId,
    nomusSellerName: null,
  };
};

const A = customer(1, "Alfa Ltda", { city: "São Paulo", state: "SP" });
const B = customer(2, "Beta SA");
const C = customer(3, "Gama Comércio");
const D = customer(4, "Delta Indústria"); // sem pedidos
const ORDERS = [
  order(A.id, "2026-06-01", 1000, 501),
  order(A.id, "2026-07-01", 1500, 464),
  order(A.id, "2026-07-31", 500.1, 501),
  order(B.id, "2026-03-01", 20000, 464),
  order(B.id, "2026-05-01", 30000, 464),
  order(C.id, "2025-08-10", 700, null), // fora do período de 12m abaixo
  order(C.id, "2026-09-20", 9999, 464), // emissão futura — nunca entra
];
const OWNERS: Record<string, { key: string; label: string }> = {
  [A.id]: { key: "gislene lima", label: "Gislene Lima" },
  [B.id]: { key: "gislene lima", label: "Gislene Lima" },
  [C.id]: { key: "joseane souza", label: "Joseane Souza" },
};

function context(): CrmCustomReportContext {
  const byCustomer = new Map<string, CrmReportsOrderRecord[]>();
  for (const o of ORDERS) byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o]);
  const analysis = buildCrmReportsAnalysis({
    windows: WINDOWS,
    authorizedCustomers: 4,
    candidates: [A, B, C, D],
    ordersByCustomer: byCustomer,
    lastOrderSellerWhere: null,
    customerSelection: { mode: "ALL", customerIds: [] },
  });
  return {
    today: WINDOWS.today,
    facts: analysis.analyzed,
    ordersByCustomer: byCustomer,
    ownerOf: (id) => OWNERS[id] ?? null,
    sellerLabelOf: (id) => (id === 501 ? "JOSEANE SOUZA" : id === 464 ? "GISLENE LIMA" : "Sem vendedor no pedido Nomus"),
  };
}

function spec(body: Record<string, unknown>): CrmCustomReportSpec {
  const parsed = parseCrmCustomReportRequest(body);
  if (parsed.ok !== true) throw new Error(`spec inválido no teste: ${JSON.stringify(parsed)}`);
  return parsed.spec;
}

const LAST_12M = { from: "2025-09-12", to: "2026-09-11" };

describe("parseCrmCustomReportRequest — só combinações seguras", () => {
  it("normaliza dimensões/métricas, ordenação padrão e página", () => {
    const s = spec({ dimensions: ["customer", "customer"], metrics: ["soldValue", "orders"], period: LAST_12M });
    assert.deepEqual(s.dimensions, ["customer"]);
    assert.deepEqual(s.sort, { by: "soldValue", direction: "desc" });
    assert.deepEqual(s.pagination, { limit: 100, offset: 0 });
    assert.equal(s.customerStatus, "ALL");
    assert.deepEqual(s.filters.customerSelection, { mode: "ALL", customerIds: [] });
  });

  it("recusa (400) métrica sem significado seguro para a granularidade — com o motivo", () => {
    const cadenceByMonth = parseCrmCustomReportRequest({ dimensions: ["customer", "month"], metrics: ["averageRepurchaseDays"] });
    assert.equal(cadenceByMonth.ok, false);
    if (cadenceByMonth.ok === false) assert.match(cadenceByMonth.errors.join(" "), /Cadência é do cliente/);
    const cadenceByOwner = parseCrmCustomReportRequest({ dimensions: ["commercialOwner"], metrics: ["overdueDays"] });
    assert.equal(cadenceByOwner.ok, false);
    const recencyBySeller = parseCrmCustomReportRequest({ dimensions: ["orderSeller"], metrics: ["lastPurchaseDate"] });
    assert.equal(recencyBySeller.ok, false);
    const withoutPurchaseByMonth = parseCrmCustomReportRequest({
      dimensions: ["month"],
      metrics: ["orders"],
      customerStatus: "WITHOUT_PURCHASE",
    });
    assert.equal(withoutPurchaseByMonth.ok, false);
    // Recência por responsável é segura (máximo entre os clientes do grupo).
    assert.equal(parseCrmCustomReportRequest({ dimensions: ["commercialOwner"], metrics: ["lastPurchaseDate"] }).ok, true);
  });

  it("recusa entradas inválidas em vez de ignorar", () => {
    for (const body of [
      {},
      { dimensions: [], metrics: ["orders"] },
      { dimensions: ["customer"], metrics: [] },
      { dimensions: ["produto"], metrics: ["orders"] },
      { dimensions: ["customer"], metrics: ["margem"] },
      { dimensions: ["customer", "month", "year", "city"], metrics: ["orders"] },
      { dimensions: ["customer"], metrics: ["orders"], groupBy: "city" },
      { dimensions: ["customer"], metrics: ["orders"], sort: { by: "soldValue" } },
      { dimensions: ["customer"], metrics: ["orders"], period: { from: "2026-02-30", to: "2026-03-01" } },
      { dimensions: ["customer"], metrics: ["orders"], period: { from: "2026-05-01", to: "2026-04-01" } },
      { dimensions: ["customer"], metrics: ["orders"], customerStatus: "VIP" },
      { dimensions: ["customer"], metrics: ["orders"], filters: { customerSelection: { mode: "ONLY" } } },
    ]) {
      assert.equal(parseCrmCustomReportRequest(body).ok, false, JSON.stringify(body));
    }
  });

  it("disponibilidade das métricas é explicável para a UI", () => {
    assert.deepEqual(describeCrmCustomReportMetricAvailability("soldValue", ["month"]), { available: true, reason: null });
    assert.equal(describeCrmCustomReportMetricAvailability("averageRepurchaseDays", ["customer"]).available, true);
    assert.equal(describeCrmCustomReportMetricAvailability("averageRepurchaseDays", ["commercialOwner"]).available, false);
    assert.equal(describeCrmCustomReportMetricAvailability("daysSinceLastPurchase", ["customer", "year"]).available, false);
  });
});

describe("computeCrmCustomReport — agrega sem dupla contagem", () => {
  it("Vendas por Cliente no período: soma = pedidos canônicos do período; sem compra fica fora", () => {
    const s = spec({ dimensions: ["customer"], metrics: ["soldValue", "orders", "customers", "averageTicket"], period: LAST_12M });
    const r = computeCrmCustomReport(s, context());
    assert.deepEqual(
      r.rows.map((row) => [row.dimensions.customer!.label, row.metrics.soldValue, row.metrics.orders]),
      [
        ["Beta SA", 50000, 2],
        ["Alfa Ltda", 3000.1, 3],
      ]
    );
    assert.equal(r.rows[0]!.customerId, B.id);
    assert.equal(r.rows[1]!.metrics.averageTicket, 1000.03);
    assert.deepEqual(r.totals, { soldValue: 53000.1, orders: 5, customers: 2, averageTicket: 10600.02 });
    assert.equal(r.rows[1]!.dimensions.customer!.sublabel, A.taxId);
  });

  it("dimensão de pedido (mês × vendedor): cada pedido em uma linha; clientes distintos no total", () => {
    const s = spec({
      dimensions: ["month", "orderSeller"],
      metrics: ["soldValue", "orders", "customers"],
      period: LAST_12M,
      sort: { by: "month", direction: "asc" },
    });
    const r = computeCrmCustomReport(s, context());
    assert.deepEqual(
      r.rows.map((row) => [row.dimensions.month!.label, row.dimensions.orderSeller!.label, row.metrics.orders, row.metrics.soldValue]),
      [
        ["03/2026", "GISLENE LIMA", 1, 20000],
        ["05/2026", "GISLENE LIMA", 1, 30000],
        ["06/2026", "JOSEANE SOUZA", 1, 1000],
        ["07/2026", "GISLENE LIMA", 1, 1500],
        ["07/2026", "JOSEANE SOUZA", 1, 500.1],
      ]
    );
    const sumRows = r.rows.reduce((acc, row) => acc + (row.metrics.orders as number), 0);
    assert.equal(sumRows, r.totals.orders);
    assert.equal(r.totals.customers, 2, "clientes distintos, não soma das linhas");
    assert.equal(r.rows[4]!.customerId, null, "linha de pedido não aponta um cliente");
  });

  it("Responsável × recência: última compra = máximo dos clientes do grupo (histórico inteiro)", () => {
    const s = spec({
      dimensions: ["commercialOwner"],
      metrics: ["customers", "lastPurchaseDate", "daysSinceLastPurchase"],
      period: LAST_12M,
      sort: { by: "commercialOwner", direction: "asc" },
    });
    const r = computeCrmCustomReport(s, context());
    assert.deepEqual(
      r.rows.map((row) => [row.dimensions.commercialOwner!.label, row.metrics.customers, row.metrics.lastPurchaseDate, row.metrics.daysSinceLastPurchase]),
      [["Gislene Lima", 2, "2026-07-31", 42]],
      "C não comprou no período (só em 2025 e uma emissão futura) e fica fora sem filtro de situação"
    );
  });

  it("Clientes sem compra: entram inclusive sem histórico; recência vem do motor", () => {
    const s = spec({
      dimensions: ["customer"],
      metrics: ["orders", "lastPurchaseDate", "daysSinceLastPurchase"],
      period: { from: "2026-08-01", to: "2026-09-11" },
      customerStatus: "WITHOUT_PURCHASE",
      sort: { by: "daysSinceLastPurchase", direction: "desc" },
    });
    const r = computeCrmCustomReport(s, context());
    assert.deepEqual(
      r.rows.map((row) => [row.dimensions.customer!.label, row.metrics.orders, row.metrics.lastPurchaseDate]),
      [
        ["Gama Comércio", 0, "2025-08-10"],
        ["Beta SA", 0, "2026-05-01"],
        ["Alfa Ltda", 0, "2026-07-31"],
        ["Delta Indústria", 0, null],
      ],
      "nulos (sem histórico) sempre por último"
    );
  });

  it("Atrasados para recompra: cadência é a do motor, 1 linha por cliente", () => {
    const s = spec({
      dimensions: ["customer", "commercialOwner"],
      metrics: ["averageRepurchaseDays", "overdueDays", "soldValue"],
      period: LAST_12M,
      customerStatus: "REPURCHASE_OVERDUE",
      sort: { by: "overdueDays", direction: "desc" },
    });
    const ctx = context();
    const r = computeCrmCustomReport(s, ctx);
    const factsById = new Map(ctx.facts.map((f) => [f.customer.id, f]));
    assert.deepEqual(r.rows.map((row) => row.customerId), [B.id, A.id]);
    for (const row of r.rows) {
      const facts = factsById.get(row.customerId!)!;
      assert.equal(row.metrics.overdueDays, facts.cadence.deltaDays);
      assert.ok(facts.cadence.status === "OVERDUE" || facts.cadence.status === "SEVERELY_OVERDUE");
    }
  });

  it("Agrupar por: ordena pelo grupo e subtotaliza com clientes distintos", () => {
    const s = spec({
      dimensions: ["commercialOwner", "customer"],
      metrics: ["soldValue", "customers"],
      period: LAST_12M,
      groupBy: "commercialOwner",
    });
    const r = computeCrmCustomReport(s, context());
    const page = pageCrmCustomReport(r, { groupBy: s.groupBy, pagination: { limit: 1, offset: 0 } });
    assert.equal(page.total, 2);
    assert.equal(page.returned, 1);
    assert.equal(page.hasMore, true);
    assert.deepEqual(page.groups, [
      { key: "o:gislene lima", label: "Gislene Lima", rowCount: 2, metrics: { soldValue: 53000.1, customers: 2 } },
    ]);
  });

  it("período nulo = histórico inteiro até hoje; emissão futura nunca entra", () => {
    const s = spec({ dimensions: ["year"], metrics: ["orders", "soldValue"], sort: { by: "year", direction: "asc" } });
    const r = computeCrmCustomReport(s, context());
    assert.deepEqual(
      r.rows.map((row) => [row.dimensions.year!.label, row.metrics.orders]),
      [
        ["2025", 1],
        ["2026", 5],
      ]
    );
  });

  it("teto de linhas falha explícito — nunca devolve relatório truncado", () => {
    const many = Array.from({ length: CRM_CUSTOM_REPORT_MAX_ROWS + 1 }, (_, i) => customer(10_000 + i, `C${i}`));
    const byCustomer = new Map(many.map((c) => [c.id, [order(c.id, "2026-09-01", 1)]]));
    const analysis = buildCrmReportsAnalysis({
      windows: WINDOWS,
      authorizedCustomers: many.length,
      candidates: many,
      ordersByCustomer: byCustomer,
      lastOrderSellerWhere: null,
      customerSelection: { mode: "ALL", customerIds: [] },
    });
    const s = spec({ dimensions: ["customer"], metrics: ["orders"] });
    assert.throws(
      () =>
        computeCrmCustomReport(s, {
          today: WINDOWS.today,
          facts: analysis.analyzed,
          ordersByCustomer: byCustomer,
          ownerOf: () => null,
          sellerLabelOf: () => "—",
        }),
      CrmCustomReportTooLargeError
    );
  });
});
