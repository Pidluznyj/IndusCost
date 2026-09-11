import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCrmReportsCustomerFacts,
  buildCrmReportsAnalysis,
  buildCrmReportsPage,
  lastOrderMatchesSellerWhere,
  paginateCrmReportsRows,
  parseCrmReportsOperationalRequest,
  resolveCrmReportsWindows,
  roundCrmReportsMoney,
  selectCrmReportsInclusionCandidates,
  toCrmReportsCadenceRow,
  toCrmReportsOverdueRow,
  toCrmReportsRecent60dRow,
  type CrmReportsCustomerRecord,
  type CrmReportsOrderRecord,
} from "./crmReportsOperationalCore.js";
import {
  CRM_REPORTS_MAX_SELECTION_IDS,
  CRM_REPORTS_PAGE_DEFAULT_LIMIT,
  CRM_REPORTS_PAGE_MAX_LIMIT,
  type CrmReportsCustomerSelection,
} from "./crmReportsTypes.js";

// Hoje do relatório: 11/09/2026 (horário local — o motor trabalha em dia civil).
const NOW = new Date(2026, 8, 11, 10, 0, 0);
const WINDOWS = resolveCrmReportsWindows(NOW);

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function customer(n: number, companyName: string, extra: Partial<CrmReportsCustomerRecord> = {}) {
  return {
    id: uuid(n),
    companyName,
    tradeName: null,
    taxId: `TAX-${n}`,
    city: "Curitiba",
    state: "PR",
    ...extra,
  } satisfies CrmReportsCustomerRecord;
}

let orderSeq = 0;
function order(
  customerId: string,
  ymd: string,
  value: number,
  extra: Partial<CrmReportsOrderRecord> & { hour?: number } = {}
): CrmReportsOrderRecord {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  orderSeq += 1;
  const { hour, ...rest } = extra;
  return {
    id: `order-${String(orderSeq).padStart(4, "0")}`,
    customerId,
    orderCode: `PD ${String(orderSeq).padStart(5, "0")}`,
    issueDate: new Date(y, m - 1, d, hour ?? 10, 0, 0),
    totalNetValue: value,
    externalSellerId: null,
    nomusSellerName: null,
    ...rest,
  };
}

// Cenário base (hoje 11/09/2026):
const A = customer(1, "Alfa Ltda"); // 3 ocasiões, média 30 → esperada 30/08 → +12 OVERDUE
const B = customer(2, "Beta SA"); // 2 ocasiões, 61 dias → esperada 01/07 → +72 SEVERELY
const C = customer(3, "Gama Comércio"); // 1 ocasião em 01/09 → INSUFFICIENT, recente
const D = customer(4, "Delta Indústria"); // sem pedidos → NO_HISTORY
const E = customer(5, "Épsilon Máquinas"); // comprou hoje → ON_TIME
const F = customer(6, "Zeta Peças"); // esperada 20/09 → −9 DUE_SOON
const G = customer(7, "Eta Ferragens"); // cadência antiga → +314 SEVERELY
const ALL_CUSTOMERS = [A, B, C, D, E, F, G];

const ORDERS: CrmReportsOrderRecord[] = [
  order(A.id, "2026-06-01", 1000),
  order(A.id, "2026-07-01", 1500),
  order(A.id, "2026-07-31", 500.1),
  order(B.id, "2026-03-01", 20000),
  order(B.id, "2026-05-01", 30000),
  order(C.id, "2026-09-01", 750),
  order(E.id, "2026-08-12", 100),
  order(E.id, "2026-09-11", 200, { hour: 23 }),
  order(F.id, "2026-07-20", 300),
  order(F.id, "2026-08-20", 300),
  order(G.id, "2025-08-01", 10),
  order(G.id, "2025-09-01", 10),
  order(G.id, "2025-10-01", 10),
];

function groupOrders(orders: readonly CrmReportsOrderRecord[]) {
  const map = new Map<string, CrmReportsOrderRecord[]>();
  for (const o of orders) map.set(o.customerId, [...(map.get(o.customerId) ?? []), o]);
  return map;
}

function analyze(
  selection: CrmReportsCustomerSelection = { mode: "ALL", customerIds: [] },
  extra: { orders?: CrmReportsOrderRecord[]; candidates?: CrmReportsCustomerRecord[]; sellerWhere?: Record<string, unknown> | null } = {}
) {
  const candidates = extra.candidates ?? ALL_CUSTOMERS;
  return buildCrmReportsAnalysis({
    windows: WINDOWS,
    authorizedCustomers: candidates.length + 3,
    candidates,
    ordersByCustomer: groupOrders(extra.orders ?? ORDERS),
    lastOrderSellerWhere: extra.sellerWhere ?? null,
    customerSelection: selection,
  });
}

const names = (list: { customer: CrmReportsCustomerRecord }[]) => list.map((f) => f.customer.companyName);

describe("parseCrmReportsOperationalRequest", () => {
  it("corpo vazio → ALL e página padrão de 50 em cada lista", () => {
    const parsed = parseCrmReportsOperationalRequest(undefined);
    assert.equal(parsed.ok, true);
    if (parsed.ok !== true) return;
    assert.deepEqual(parsed.request.filters, {
      customerIds: [],
      commercialOwner: null,
      lastOrderSeller: null,
      cities: [],
      states: [],
      customerSelection: { mode: "ALL", customerIds: [] },
    });
    for (const key of ["recent", "cadence", "overdue"] as const) {
      assert.deepEqual(parsed.request.pagination[key], { limit: CRM_REPORTS_PAGE_DEFAULT_LIMIT, offset: 0 });
    }
  });

  it("limita a página ao máximo e corrige offset negativo", () => {
    const parsed = parseCrmReportsOperationalRequest({
      pagination: { recent: { limit: 5000, offset: -3 }, cadence: { limit: "abc" }, overdue: { limit: 10, offset: 20 } },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok !== true) return;
    assert.deepEqual(parsed.request.pagination.recent, { limit: CRM_REPORTS_PAGE_MAX_LIMIT, offset: 0 });
    assert.deepEqual(parsed.request.pagination.cadence, { limit: CRM_REPORTS_PAGE_DEFAULT_LIMIT, offset: 0 });
    assert.deepEqual(parsed.request.pagination.overdue, { limit: 10, offset: 20 });
  });

  it("normaliza seleção: UUID minúsculo e sem duplicata", () => {
    const parsed = parseCrmReportsOperationalRequest({
      filters: {
        customerSelection: { mode: "exclude", customerIds: [uuid(1).toUpperCase(), uuid(1), uuid(2)] },
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok !== true) return;
    assert.deepEqual(parsed.request.filters.customerSelection, {
      mode: "EXCLUDE",
      customerIds: [uuid(1), uuid(2)],
    });
  });

  it("filtro de inclusão customerIds: UUID minúsculo, sem duplicata; inválido = 400", () => {
    const parsed = parseCrmReportsOperationalRequest({
      filters: { customerIds: [uuid(3).toUpperCase(), uuid(3), uuid(4)] },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok !== true) return;
    assert.deepEqual(parsed.request.filters.customerIds, [uuid(3), uuid(4)]);
    assert.equal(parseCrmReportsOperationalRequest({ filters: { customerIds: uuid(3) } }).ok, false);
    assert.equal(parseCrmReportsOperationalRequest({ filters: { customerIds: ["x"] } }).ok, false);
    const empty = parseCrmReportsOperationalRequest({ filters: { customerIds: [] } });
    assert.equal(empty.ok, true);
    if (empty.ok === true) assert.deepEqual(empty.request.filters.customerIds, []);
  });

  it("modo ALL ignora customerIds enviados", () => {
    const parsed = parseCrmReportsOperationalRequest({
      filters: { customerSelection: { mode: "ALL", customerIds: [uuid(1)] } },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok !== true) return;
    assert.deepEqual(parsed.request.filters.customerSelection, { mode: "ALL", customerIds: [] });
  });

  it("recusa (400) filtro inválido em vez de ignorar em silêncio", () => {
    const cases: unknown[] = [
      { filters: { customerSelection: { mode: "SOME", customerIds: [] } } },
      { filters: { customerSelection: { mode: "ONLY" } } },
      { filters: { customerSelection: { mode: "ONLY", customerIds: ["not-a-uuid"] } } },
      {
        filters: {
          customerSelection: {
            mode: "EXCLUDE",
            customerIds: Array.from({ length: CRM_REPORTS_MAX_SELECTION_IDS + 1 }, (_, i) => uuid(i)),
          },
        },
      },
      { filters: { lastOrderSeller: { sellerKey: "joseane" } } },
      { filters: { commercialOwner: { externalSellerId: -4 } } },
      { filters: { commercialOwner: { externalSellerIds: [1, "x"] } } },
      { filters: { city: 42 } },
      { filters: "tudo" },
      "texto",
    ];
    for (const body of cases) {
      const parsed = parseCrmReportsOperationalRequest(body);
      assert.equal(parsed.ok, false, JSON.stringify(body).slice(0, 120));
    }
  });

  it("filtros de responsável, vendedor, cidade e UF normalizados", () => {
    const parsed = parseCrmReportsOperationalRequest({
      filters: {
        commercialOwner: { sellerIdentityKey: "  gislene lima ", externalSellerIds: [9, 3, 9] },
        lastOrderSeller: { sellerKey: 501 },
        city: ["  São  Paulo ", "sao paulo", "Curitiba"],
        state: "sp",
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok !== true) return;
    assert.deepEqual(parsed.request.filters.commercialOwner, {
      sellerIdentityKey: "gislene lima",
      externalSellerId: null,
      externalSellerIds: [3, 9],
    });
    assert.deepEqual(parsed.request.filters.lastOrderSeller, { sellerKey: "501", sellerName: null });
    assert.deepEqual(parsed.request.filters.cities, ["São Paulo", "Curitiba"]);
    assert.deepEqual(parsed.request.filters.states, ["sp"]);
  });

  it("responsável vazio vira 'sem filtro' e __NO_SELLER__ é aceito", () => {
    const parsed = parseCrmReportsOperationalRequest({
      filters: { commercialOwner: { sellerIdentityKey: "  " }, lastOrderSeller: { sellerKey: "__NO_SELLER__" } },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok !== true) return;
    assert.equal(parsed.request.filters.commercialOwner, null);
    assert.deepEqual(parsed.request.filters.lastOrderSeller, { sellerKey: "__NO_SELLER__", sellerName: null });
  });
});

describe("agregação por cliente (60d / 12m / última compra)", () => {
  it("janela 60d inclui hoje e hoje−59; exclui hoje−60", () => {
    assert.deepEqual(WINDOWS.recent60d, { from: "2026-07-14", to: "2026-09-11", days: 60 });
    const cust = customer(50, "Janela");
    const facts = aggregateCrmReportsCustomerFacts(
      cust,
      [
        order(cust.id, "2026-07-13", 1), // hoje − 60 → fora
        order(cust.id, "2026-07-14", 2), // hoje − 59 → dentro
        order(cust.id, "2026-09-11", 4, { hour: 23 }), // hoje, 23h → dentro
      ],
      WINDOWS
    );
    assert.equal(facts.orders60d, 2);
    assert.equal(facts.purchaseValue60d, 6);
    assert.equal(facts.averageTicket60d, 3);
    assert.equal(facts.lastPurchaseDate, "2026-09-11");
    assert.equal(facts.daysSinceLastPurchase, 0);
  });

  it("janela 12m é móvel própria: (hoje − 12 meses) + 1 dia … hoje", () => {
    assert.deepEqual(WINDOWS.rolling12m, { from: "2025-09-12", to: "2026-09-11", months: 12 });
    const cust = customer(51, "Doze");
    const facts = aggregateCrmReportsCustomerFacts(
      cust,
      [order(cust.id, "2025-09-11", 100), order(cust.id, "2025-09-12", 10.005), order(cust.id, "2026-01-10", 0.015)],
      WINDOWS
    );
    assert.equal(facts.orders12m, 2);
    assert.equal(facts.purchaseValue12m, 10.02);
    assert.equal(facts.averageTicket12m, 5.01);
    assert.equal(facts.totalOrders, 3);
  });

  it("pedido com emissão futura não entra em janela nem cadência — e é contado", () => {
    const cust = customer(52, "Futuro");
    const facts = aggregateCrmReportsCustomerFacts(
      cust,
      [order(cust.id, "2026-08-01", 10), order(cust.id, "2026-09-12", 99)],
      WINDOWS
    );
    assert.equal(facts.futureDatedOrders, 1);
    assert.equal(facts.totalOrders, 1);
    assert.equal(facts.lastPurchaseDate, "2026-08-01");
    assert.equal(facts.cadence.status, "INSUFFICIENT_HISTORY");
  });

  it("vários pedidos no dia: contam todos no valor/quantidade e 1 ocasião na recompra", () => {
    const cust = customer(53, "Mesmo Dia");
    const facts = aggregateCrmReportsCustomerFacts(
      cust,
      [
        order(cust.id, "2026-09-03", 100, { hour: 8 }),
        order(cust.id, "2026-09-03", 200, { hour: 12 }),
        order(cust.id, "2026-09-03", 300, { hour: 16 }),
      ],
      WINDOWS
    );
    assert.equal(facts.orders60d, 3);
    assert.equal(facts.purchaseValue60d, 600);
    assert.equal(facts.averageTicket60d, 200);
    assert.equal(facts.cadence.totalOccasions, 1);
    assert.equal(facts.occasions[0]!.orderCount, 3);
  });

  it("último pedido: maior issueDate; empate de horário → maior orderCode", () => {
    const cust = customer(54, "Empate");
    const sameInstant = new Date(2026, 8, 5, 9, 0, 0);
    const facts = aggregateCrmReportsCustomerFacts(
      cust,
      [
        { ...order(cust.id, "2026-09-05", 1), orderCode: "PD 00010", issueDate: sameInstant, externalSellerId: 1 },
        { ...order(cust.id, "2026-09-05", 1), orderCode: "PD 00011", issueDate: sameInstant, externalSellerId: 2 },
        order(cust.id, "2026-08-01", 1, { externalSellerId: 3 }),
      ],
      WINDOWS
    );
    assert.equal(facts.lastOrder?.orderCode, "PD 00011");
    assert.equal(facts.lastOrder?.externalSellerId, 2);
  });
});

describe("universo, indicadores e listas", () => {
  it("indicadores e listas saem do MESMO universo analisado", () => {
    const a = analyze();
    assert.deepEqual(a.universe, {
      authorizedCustomers: 10,
      matchedBeforeExclusions: 7,
      manuallyExcluded: 0,
      analyzedCustomers: 7,
    });
    assert.deepEqual(a.indicators, {
      customersPurchased60d: 4,
      repurchaseDueNext15d: 1,
      overdueRepurchase: 3,
      severelyOverdueRepurchase: 2,
      insufficientCadence: 1,
    });
    // Reconciliação card × lista por construção.
    assert.equal(a.indicators.customersPurchased60d, a.recent60d.length);
    assert.equal(a.indicators.overdueRepurchase, a.overdue.length);
    assert.equal(
      a.indicators.insufficientCadence,
      a.cadence.filter((f) => f.cadence.status === "INSUFFICIENT_HISTORY").length
    );
    assert.equal(
      a.indicators.repurchaseDueNext15d,
      a.analyzed.filter((f) => f.cadence.status === "DUE_SOON").length
    );
  });

  it("RECENT_60D: última compra DESC, nome ASC", () => {
    assert.deepEqual(names(analyze().recent60d), ["Épsilon Máquinas", "Gama Comércio", "Zeta Peças", "Alfa Ltda"]);
  });

  it("CADENCE: todo cliente com compra (inclusive compra única), nome ASC", () => {
    const a = analyze();
    assert.deepEqual(names(a.cadence), [
      "Alfa Ltda",
      "Beta SA",
      "Épsilon Máquinas",
      "Eta Ferragens",
      "Gama Comércio",
      "Zeta Peças",
    ]);
    assert.ok(!names(a.cadence).includes("Delta Indústria"), "sem compra não entra na cadência");
  });

  it("OVERDUE: filtra o resultado do motor — atraso DESC, valor 12m DESC, nome ASC", () => {
    const a = analyze();
    assert.deepEqual(names(a.overdue), ["Eta Ferragens", "Beta SA", "Alfa Ltda"]);
    assert.deepEqual(
      a.overdue.map((f) => f.cadence.deltaDays),
      [314, 72, 12]
    );
    for (const f of a.overdue) assert.ok(f.cadence.status === "OVERDUE" || f.cadence.status === "SEVERELY_OVERDUE");
  });

  it("OVERDUE desempata por valor 12m e depois por nome", () => {
    const x = customer(60, "Xis");
    const y = customer(61, "Ypsilon");
    const w = customer(62, "Wagner");
    const orders = [
      order(x.id, "2026-06-01", 100),
      order(x.id, "2026-07-01", 100),
      order(y.id, "2026-06-01", 900),
      order(y.id, "2026-07-01", 900),
      order(w.id, "2026-06-01", 100),
      order(w.id, "2026-07-01", 100),
    ];
    const a = analyze({ mode: "ALL", customerIds: [] }, { candidates: [x, y, w], orders });
    assert.deepEqual(names(a.overdue), ["Ypsilon", "Wagner", "Xis"]);
  });

  it("sem histórico só conta no universo", () => {
    const a = analyze();
    const delta = a.analyzed.find((f) => f.customer.id === D.id)!;
    assert.equal(delta.cadence.status, "NO_HISTORY");
    for (const list of [a.recent60d, a.cadence, a.overdue]) {
      assert.ok(!list.some((f) => f.customer.id === D.id));
    }
  });
});

describe("seleção analítica (EXCLUDE / ONLY)", () => {
  it("EXCLUDE: cards e listas reconciliam após excluir", () => {
    const a = analyze({ mode: "EXCLUDE", customerIds: [B.id, C.id] });
    assert.deepEqual(a.universe, {
      authorizedCustomers: 10,
      matchedBeforeExclusions: 7,
      manuallyExcluded: 2,
      analyzedCustomers: 5,
    });
    assert.equal(a.indicators.overdueRepurchase, 2);
    assert.equal(a.indicators.severelyOverdueRepurchase, 1);
    assert.equal(a.indicators.insufficientCadence, 0);
    assert.equal(a.indicators.customersPurchased60d, 3);
    assert.equal(a.indicators.overdueRepurchase, a.overdue.length);
    assert.equal(a.indicators.customersPurchased60d, a.recent60d.length);
    for (const list of [a.analyzed, a.recent60d, a.cadence, a.overdue]) {
      assert.ok(!list.some((f) => f.customer.id === B.id || f.customer.id === C.id));
    }
  });

  it("ONLY: mantém só os IDs do universo; ID fora do escopo é ignorado e contado", () => {
    const outside = uuid(999);
    const a = analyze({ mode: "ONLY", customerIds: [A.id, C.id, outside] });
    assert.deepEqual(names(a.analyzed), ["Alfa Ltda", "Gama Comércio"]);
    assert.deepEqual(a.universe, {
      authorizedCustomers: 10,
      matchedBeforeExclusions: 7,
      manuallyExcluded: 5,
      analyzedCustomers: 2,
    });
    assert.deepEqual(a.selection, { mode: "ONLY", requestedIds: 3, idsOutsideUniverse: 1 });
    assert.equal(a.indicators.overdueRepurchase, 1);
    assert.equal(a.indicators.insufficientCadence, 1);
  });

  it("ONLY vazio → universo analisado vazio (nunca 'todos')", () => {
    const a = analyze({ mode: "ONLY", customerIds: [] });
    assert.equal(a.universe.analyzedCustomers, 0);
    assert.equal(a.recent60d.length + a.cadence.length + a.overdue.length, 0);
  });
});

describe("vendedor do último pedido (fragmento canônico)", () => {
  const H = customer(70, "Hotel Joseane");
  const I = customer(71, "Índia Outro");
  const orders = [
    order(H.id, "2026-05-10", 100, { externalSellerId: 777 }),
    order(H.id, "2026-06-10", 100, { externalSellerId: 777 }),
    order(H.id, "2026-07-10", 100, { externalSellerId: 501 }),
    order(I.id, "2026-06-01", 100, { externalSellerId: 501 }),
    order(I.id, "2026-08-01", 100, { externalSellerId: 777 }),
  ];

  it("seleciona pelo ÚLTIMO pedido e mantém a cadência com TODAS as compras", () => {
    const a = analyze({ mode: "ALL", customerIds: [] }, { candidates: [H, I], orders, sellerWhere: { externalSellerId: 501 } });
    assert.deepEqual(names(a.analyzed), ["Hotel Joseane"]);
    const h = a.analyzed[0]!;
    assert.equal(h.cadence.totalOccasions, 3, "cadência usa os pedidos dos outros vendedores também");
    assert.deepEqual(h.cadence.intervalDays, [31, 30]);
    assert.equal(a.universe.matchedBeforeExclusions, 1);
  });

  it("formas emitidas pelos construtores de Pedidos de Venda", () => {
    const last = { id: "o1", externalSellerId: 501 };
    assert.equal(lastOrderMatchesSellerWhere(last, { externalSellerId: 501 }), true);
    assert.equal(lastOrderMatchesSellerWhere(last, { externalSellerId: 502 }), false);
    assert.equal(lastOrderMatchesSellerWhere(last, { externalSellerId: { in: [9, 501] } }), true);
    assert.equal(lastOrderMatchesSellerWhere(last, { id: { in: [] } }), false);
    assert.equal(lastOrderMatchesSellerWhere({ id: "o2", externalSellerId: null }, { externalSellerId: null }), true);
    assert.equal(lastOrderMatchesSellerWhere(last, { externalSellerId: null }), false);
    assert.equal(lastOrderMatchesSellerWhere(null, { externalSellerId: null }), false, "sem pedido não casa");
    assert.throws(() => lastOrderMatchesSellerWhere(last, { externalSellerId: { gte: 1 } }));
    assert.throws(() => lastOrderMatchesSellerWhere(last, { responsible: "X" }));
  });
});

describe("filtros de inclusão do cadastro", () => {
  it("responsável (IDs da carteira), cidade e UF sem caixa/acento", () => {
    const list = [
      customer(80, "Um", { city: "São Paulo", state: "SP" }),
      customer(81, "Dois", { city: "SAO PAULO", state: "sp" }),
      customer(82, "Três", { city: "Santos", state: "SP" }),
      customer(83, "Quatro", { city: null, state: null }),
    ];
    assert.deepEqual(
      selectCrmReportsInclusionCandidates({
        authorizedCustomers: list,
        ownerFilterCustomerIds: null,
        cities: ["sao paulo"],
        states: ["SP"],
      }).map((c) => c.companyName),
      ["Um", "Dois"]
    );
    assert.deepEqual(
      selectCrmReportsInclusionCandidates({
        authorizedCustomers: list,
        ownerFilterCustomerIds: new Set([list[2]!.id, uuid(12345)]),
        cities: [],
        states: [],
      }).map((c) => c.companyName),
      ["Três"],
      "filtro de responsável só recorta — ID fora da lista autorizada não entra"
    );
    assert.deepEqual(
      selectCrmReportsInclusionCandidates({
        authorizedCustomers: list,
        customerIds: [list[0]!.id, list[3]!.id, uuid(54321)],
        ownerFilterCustomerIds: null,
        cities: [],
        states: [],
      }).map((c) => c.companyName),
      ["Um", "Quatro"],
      "filtro de cliente só recorta — ID não autorizado não entra"
    );
    assert.equal(
      selectCrmReportsInclusionCandidates({
        authorizedCustomers: list,
        customerIds: [],
        ownerFilterCustomerIds: null,
        cities: [],
        states: [],
      }).length,
      4,
      "lista vazia = sem filtro"
    );
  });
});

describe("paginação", () => {
  it("total é o tamanho da lista inteira, nunca o da página", () => {
    const rows = Array.from({ length: 123 }, (_, i) => i);
    const first = paginateCrmReportsRows(rows, { limit: 50, offset: 0 });
    assert.equal(first.total, 123);
    assert.equal(first.returned, 50);
    assert.equal(first.hasMore, true);
    const last = paginateCrmReportsRows(rows, { limit: 50, offset: 100 });
    assert.equal(last.total, 123);
    assert.equal(last.returned, 23);
    assert.equal(last.hasMore, false);
    const beyond = paginateCrmReportsRows(rows, { limit: 50, offset: 500 });
    assert.equal(beyond.total, 123);
    assert.equal(beyond.returned, 0);
    assert.equal(beyond.hasMore, false);
  });

  it("página do relatório preserva o total do universo analisado", () => {
    const a = analyze();
    const page = buildCrmReportsPage(paginateCrmReportsRows(a.cadence, { limit: 2, offset: 0 }), "cadence", (f) =>
      toCrmReportsCadenceRow(f, null)
    );
    assert.equal(page.rows.length, 2);
    assert.equal(page.total, 6);
    assert.notEqual(page.total, page.rows.length);
    assert.deepEqual(page.sort, ["displayName:asc"]);
  });
});

describe("DTOs", () => {
  it("dinheiro em centavos; média em 2 casas; atraso = deltaDays; follow-up em ISO", () => {
    const a = analyze();
    const alfa = a.overdue.find((f) => f.customer.id === A.id)!;
    const row = toCrmReportsOverdueRow(
      alfa,
      { name: "Gislene Lima", externalSellerId: 464 },
      { externalSellerId: 501, name: "Joseane", label: "Joseane", resolution: "RESOLVED" },
      { lastContactAt: new Date("2026-09-01T12:00:00.000Z"), nextFollowUpAt: null, hasOverdueFollowUp: true }
    );
    assert.equal(row.customerId, A.id);
    assert.equal(row.displayName, "Alfa Ltda");
    assert.equal(row.commercialOwnerName, "Gislene Lima");
    assert.equal(row.lastOrderSellerLabel, "Joseane");
    assert.equal(row.overdueDays, 12);
    assert.equal(row.deltaDays, 12);
    assert.equal(row.repurchaseStatus, "OVERDUE");
    assert.equal(row.expectedRepurchaseDate, "2026-08-30");
    assert.equal(row.orders12m, 3);
    assert.equal(row.purchaseValue12m, 3000.1);
    assert.equal(row.averageTicket12m, 1000.03);
    assert.equal(row.lastContactAt, "2026-09-01T12:00:00.000Z");
    assert.equal(row.hasOverdueFollowUp, true);

    const eta = a.overdue.find((f) => f.customer.id === G.id)!;
    const etaRow = toCrmReportsOverdueRow(eta, null, null, null);
    assert.equal(etaRow.averageRepurchaseDays, 30.5);
    assert.equal(etaRow.averageRepurchaseDaysRounded, 31);
    assert.equal(etaRow.commercialOwnerName, null);
    assert.equal(etaRow.lastContactAt, null);
    assert.equal(etaRow.hasOverdueFollowUp, false);
  });

  it("linha recente traz 60d e cadência do mesmo motor", () => {
    const a = analyze();
    const gama = a.recent60d.find((f) => f.customer.id === C.id)!;
    const row = toCrmReportsRecent60dRow(gama, null, null);
    assert.equal(row.lastPurchaseDate, "2026-09-01");
    assert.equal(row.daysSinceLastPurchase, 10);
    assert.equal(row.orders60d, 1);
    assert.equal(row.purchaseValue60d, 750);
    assert.equal(row.repurchaseStatus, "INSUFFICIENT_HISTORY");
    assert.equal(row.cadenceConfidence, "NONE");
    assert.equal(row.expectedRepurchaseDate, null);
    assert.equal(row.lastOrderSellerLabel, "—");
  });

  it("arredondamento de apresentação é estável e idempotente", () => {
    assert.equal(roundCrmReportsMoney(3000.1 / 3), 1000.03);
    assert.equal(roundCrmReportsMoney(0.1 + 0.2), 0.3);
    assert.equal(roundCrmReportsMoney(12.345678), 12.35);
    assert.equal(roundCrmReportsMoney(roundCrmReportsMoney(12.345678)), 12.35);
    assert.equal(roundCrmReportsMoney(Number.NaN), 0);
  });
});
