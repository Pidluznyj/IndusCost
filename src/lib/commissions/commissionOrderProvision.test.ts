import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  aggregateCommissionOrderProvisionRows,
  assembleCommissionOrderProvisionPayload,
  assembleCommissionOrderProvisionReportPayload,
  buildCommissionOrderProvisionCards,
  buildCommissionOrderProvisionClientQuery,
  buildCommissionOrderProvisionExportFilename,
  buildCommissionOrderProvisionExportWorkbook,
  buildCommissionOrderProvisionFilterSummary,
  filterCommissionOrderProvisionZeroRows,
  isCommissionOrderProvisionSellerChipActive,
  parseCommissionOrderProvisionQuery,
  resolveCommissionOrderProvisionMonthRanges,
  resolveCommissionOrderProvisionMonths,
  resolveCommissionOrderProvisionSaleDateBounds,
  resolveCommissionOrderProvisionSaleDateFilter,
} from "./commissionOrderProvision.shared.js";

const SELLER_A = "11111111-1111-4111-8111-111111111111";
const SELLER_B = "22222222-2222-4222-8222-222222222222";

function snap(partial: {
  id: string;
  salesOrderId: string;
  orderCode: string;
  saleDate: Date;
  canonicalSellerId?: string | null;
  canonicalSellerName?: string | null;
  rawSellerId?: number | null;
  rawSellerName?: string | null;
  totalFinalCommissionAmount?: number;
  totalSoldAmount?: number;
  totalGrossCommissionAmount?: number;
  hasCustomerExcludedItems?: boolean;
}) {
  return {
    id: partial.id,
    salesOrderId: partial.salesOrderId,
    orderCode: partial.orderCode,
    saleDate: partial.saleDate,
    customerNameSnapshot: "Cliente",
    canonicalSellerId: partial.canonicalSellerId ?? SELLER_A,
    canonicalSellerName: partial.canonicalSellerName ?? "Maria",
    rawSellerId: partial.rawSellerId ?? 10,
    rawSellerName: partial.rawSellerName ?? "Maria",
    nfeId: null as number | null,
    totalSoldAmount: partial.totalSoldAmount ?? 100,
    totalGrossCommissionAmount: partial.totalGrossCommissionAmount ?? 10,
    totalFinalCommissionAmount: partial.totalFinalCommissionAmount ?? 10,
    hasCustomerExcludedItems: partial.hasCustomerExcludedItems ?? false,
  };
}

describe("commissionOrderProvision", () => {
  it("confirma agregação: comissão do pedido = soma dos snapshots/itens finais", () => {
    const rows = aggregateCommissionOrderProvisionRows([
      {
        id: "s1",
        salesOrderId: "o1",
        orderCode: "PD 02716",
        saleDate: "2026-07-10",
        customerNameSnapshot: "Cliente A",
        canonicalSellerId: "seller-1",
        canonicalSellerName: "Maria",
        rawSellerId: 10,
        rawSellerName: "Maria",
        nfeId: 100,
        totalSoldAmount: 1000,
        totalGrossCommissionAmount: 50,
        totalFinalCommissionAmount: 50,
        hasCustomerExcludedItems: false,
      },
      {
        id: "s2",
        salesOrderId: "o1",
        orderCode: "PD 02716",
        saleDate: "2026-07-15",
        customerNameSnapshot: "Cliente A",
        canonicalSellerId: "seller-1",
        canonicalSellerName: "Maria",
        rawSellerId: 10,
        rawSellerName: "Maria",
        nfeId: 101,
        totalSoldAmount: 500,
        totalGrossCommissionAmount: 25,
        totalFinalCommissionAmount: 25,
        hasCustomerExcludedItems: false,
      },
      {
        id: "s3",
        salesOrderId: "o2",
        orderCode: "PD 02717",
        saleDate: "2026-07-12",
        customerNameSnapshot: "Cliente excluído",
        canonicalSellerId: "seller-1",
        canonicalSellerName: "Maria",
        rawSellerId: 10,
        rawSellerName: "Maria",
        nfeId: null,
        totalSoldAmount: 800,
        totalGrossCommissionAmount: 40,
        totalFinalCommissionAmount: 0,
        hasCustomerExcludedItems: true,
      },
    ]);

    assert.equal(rows.length, 2);
    const pd = rows.find((r) => r.orderCode === "PD 02716");
    assert.ok(pd);
    assert.equal(pd!.totalFinalCommissionAmount, 75);
    assert.equal(pd!.snapshotCount, 2);
    assert.deepEqual(pd!.nfeIds, [100, 101]);

    const cards = buildCommissionOrderProvisionCards(rows);
    assert.equal(cards.orderCount, 2);
    assert.equal(cards.totalFinalCommissionAmount, 75);
    assert.equal(cards.zeroCommissionOrderCount, 1);
    assert.equal(cards.sellers[0]?.sellerName, "Maria");
    assert.equal(cards.sellers[0]?.totalFinalCommissionAmount, 75);
  });

  it("esconde zerados por padrão e monta payload", () => {
    const payload = assembleCommissionOrderProvisionPayload({
      query: parseCommissionOrderProvisionQuery({ year: "2026" }),
      snapshots: [
        snap({
          id: "s1",
          salesOrderId: "o1",
          orderCode: "PD 1",
          saleDate: new Date(2026, 6, 1),
          canonicalSellerId: null,
          canonicalSellerName: "João",
          rawSellerId: 1,
          rawSellerName: "João",
        }),
        snap({
          id: "s2",
          salesOrderId: "o2",
          orderCode: "PD 2",
          saleDate: new Date(2026, 6, 2),
          canonicalSellerId: null,
          canonicalSellerName: "João",
          rawSellerId: 1,
          rawSellerName: "João",
          totalFinalCommissionAmount: 0,
          hasCustomerExcludedItems: true,
        }),
      ],
    });

    assert.equal(payload.source, "COMMISSION_ORDER_SNAPSHOT_ACTIVE");
    assert.equal(payload.cards.orderCount, 1);
    assert.equal(payload.cards.totalFinalCommissionAmount, 10);
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]?.orderCode, "PD 1");
  });

  it("onlyZeroCommission devolve APENAS pedidos com comissão zerada (auditoria)", () => {
    const payload = assembleCommissionOrderProvisionPayload({
      query: parseCommissionOrderProvisionQuery({
        year: "2026",
        onlyZeroCommission: "true",
      }),
      snapshots: [
        snap({
          id: "s1",
          salesOrderId: "o1",
          orderCode: "PD 1",
          saleDate: new Date(2026, 6, 1),
          canonicalSellerId: null,
          canonicalSellerName: "João",
          rawSellerId: 1,
          rawSellerName: "João",
          totalFinalCommissionAmount: 10,
        }),
        snap({
          id: "s2",
          salesOrderId: "o2",
          orderCode: "PD 2",
          saleDate: new Date(2026, 6, 2),
          canonicalSellerId: null,
          canonicalSellerName: "João",
          rawSellerId: 1,
          rawSellerName: "João",
          totalFinalCommissionAmount: 0,
          hasCustomerExcludedItems: true,
        }),
        snap({
          id: "s3",
          salesOrderId: "o3",
          orderCode: "PD 3",
          saleDate: new Date(2026, 6, 3),
          canonicalSellerId: null,
          canonicalSellerName: "João",
          rawSellerId: 1,
          rawSellerName: "João",
          totalFinalCommissionAmount: 0,
        }),
      ],
    });
    assert.equal(payload.rows.length, 2, "só PD 2 e PD 3 (zerados)");
    for (const r of payload.rows) {
      assert.ok(r.totalFinalCommissionAmount <= 0.009);
    }
  });

  it("onlyZeroCommission tem precedência sobre includeZeroCommission (mutuamente exclusivos)", () => {
    // Mesmo com includeZero=true, onlyZero=true filtra só zeros.
    const payload = assembleCommissionOrderProvisionPayload({
      query: parseCommissionOrderProvisionQuery({
        year: "2026",
        includeZeroCommission: "true",
        onlyZeroCommission: "true",
      }),
      snapshots: [
        snap({
          id: "s1",
          salesOrderId: "o1",
          orderCode: "PD 1",
          saleDate: new Date(2026, 6, 1),
          canonicalSellerId: null,
          canonicalSellerName: "João",
          rawSellerId: 1,
          rawSellerName: "João",
          totalFinalCommissionAmount: 10,
        }),
        snap({
          id: "s2",
          salesOrderId: "o2",
          orderCode: "PD 2",
          saleDate: new Date(2026, 6, 2),
          canonicalSellerId: null,
          canonicalSellerName: "João",
          rawSellerId: 1,
          rawSellerName: "João",
          totalFinalCommissionAmount: 0,
        }),
      ],
    });
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]?.orderCode, "PD 2");
  });

  it("client query serializa onlyZeroCommission=true quando ligado", () => {
    const qs = buildCommissionOrderProvisionClientQuery({
      year: "2026",
      months: "all",
      sellerId: "all",
      selectedRawSellerId: null,
      customer: "",
      orderCode: "",
      includeZeroCommission: false,
      onlyZeroCommission: true,
      page: 1,
    });
    assert.equal(new URLSearchParams(qs).get("onlyZeroCommission"), "true");
  });
});

describe("commissionOrderProvision — months parsing", () => {
  it("1. month legado continua funcionando", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026", month: "6" });
    assert.deepEqual(q.months, [6]);
    assert.equal(q.month, 6);
  });

  it("2. months com um mês", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026", months: "6" });
    assert.deepEqual(q.months, [6]);
  });

  it("3. months com dois meses contíguos", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026", months: "6,7" });
    assert.deepEqual(q.months, [6, 7]);
  });

  it("4. months com meses não contíguos", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026", months: "1,3" });
    assert.deepEqual(q.months, [1, 3]);
  });

  it("5. months=all", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026", months: "all" });
    assert.equal(q.months, "all");
    assert.equal(q.month, null);
  });

  it("6. janeiro e março não incluem fevereiro (OR exato)", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026", months: "1,3" });
    const filter = resolveCommissionOrderProvisionSaleDateFilter(q);
    assert.equal(filter.kind, "or_months");
    if (filter.kind !== "or_months") return;
    assert.equal(filter.ranges.length, 2);
    assert.equal(filter.ranges[0]!.gte.getMonth(), 0);
    assert.equal(filter.ranges[0]!.lte.getMonth(), 0);
    assert.equal(filter.ranges[1]!.gte.getMonth(), 2);
    assert.equal(filter.ranges[1]!.lte.getMonth(), 2);
    const feb = new Date(2026, 1, 15);
    const inRange = filter.ranges.some((r) => feb >= r.gte && feb <= r.lte);
    assert.equal(inRange, false);
  });

  it("7. fevereiro e dezembro não incluem meses intermediários", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026", months: "2,12" });
    const filter = resolveCommissionOrderProvisionSaleDateFilter(q);
    assert.equal(filter.kind, "or_months");
    if (filter.kind !== "or_months") return;
    assert.equal(filter.ranges.length, 2);
    for (const mid of [3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const d = new Date(2026, mid - 1, 10);
      assert.equal(
        filter.ranges.some((r) => d >= r.gte && d <= r.lte),
        false,
        `mês ${mid} não deve entrar`
      );
    }
  });

  it("8. meses duplicados", () => {
    const q = parseCommissionOrderProvisionQuery({
      year: "2026",
      months: "1,1,3",
    });
    assert.deepEqual(q.months, [1, 3]);
  });

  it("9. mês inválido normaliza para all (descarta tokens)", () => {
    assert.equal(
      parseCommissionOrderProvisionQuery({ year: "2026", months: "0" }).months,
      "all"
    );
    assert.equal(
      parseCommissionOrderProvisionQuery({ year: "2026", months: "13" }).months,
      "all"
    );
    assert.equal(
      parseCommissionOrderProvisionQuery({ year: "2026", months: "abc" }).months,
      "all"
    );
  });

  it("10. parâmetro vazio / months=1,,3", () => {
    assert.equal(
      parseCommissionOrderProvisionQuery({ year: "2026", months: "" }).months,
      "all"
    );
    assert.deepEqual(
      parseCommissionOrderProvisionQuery({ year: "2026", months: "1,,3" }).months,
      [1, 3]
    );
  });

  it("11. month e months simultâneos — months prevalece", () => {
    const q = parseCommissionOrderProvisionQuery({
      year: "2026",
      month: "3",
      months: "6,7",
    });
    assert.deepEqual(q.months, [6, 7]);
    assert.equal(q.month, null);
  });

  it("12–13. mudança de ano e dezembro → janeiro seguinte", () => {
    const jan25 = resolveCommissionOrderProvisionSaleDateBounds(
      parseCommissionOrderProvisionQuery({ year: "2025", months: "1" })
    );
    assert.ok(jan25);
    assert.equal(jan25!.gte.getFullYear(), 2025);
    assert.equal(jan25!.gte.getMonth(), 0);
    assert.equal(jan25!.gte.getDate(), 1);

    const dec25 = resolveCommissionOrderProvisionSaleDateBounds(
      parseCommissionOrderProvisionQuery({ year: "2025", months: "12" })
    );
    assert.ok(dec25);
    assert.equal(dec25!.gte.getFullYear(), 2025);
    assert.equal(dec25!.gte.getMonth(), 11);
    assert.equal(dec25!.lte.getFullYear(), 2025);
    assert.equal(dec25!.lte.getMonth(), 11);
    assert.equal(dec25!.lte.getDate(), 31);
    // dia seguinte ao lte é 1º de janeiro do ano seguinte
    const next = new Date(dec25!.lte.getTime() + 1);
    assert.equal(next.getFullYear(), 2026);
    assert.equal(next.getMonth(), 0);
    assert.equal(next.getDate(), 1);

    const jan26 = resolveCommissionOrderProvisionSaleDateBounds(
      parseCommissionOrderProvisionQuery({ year: "2026", months: "1" })
    );
    assert.equal(jan26!.gte.getFullYear(), 2026);
    assert.equal(jan26!.gte.getMonth(), 0);

    const dec26 = resolveCommissionOrderProvisionSaleDateBounds(
      parseCommissionOrderProvisionQuery({ year: "2026", months: "12" })
    );
    assert.equal(dec26!.lte.getFullYear(), 2026);
    assert.equal(dec26!.lte.getMonth(), 11);
  });

  it("23. sem months/month → all no ano default (comportamento anterior Todos os meses)", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026" });
    assert.equal(q.months, "all");
    const filter = resolveCommissionOrderProvisionSaleDateFilter(q);
    assert.equal(filter.kind, "range");
    if (filter.kind === "range") {
      assert.equal(filter.gte.getMonth(), 0);
      assert.equal(filter.lte.getMonth(), 11);
    }
  });

  it("24. months=2,5,9 sem intermediários", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026", months: "2,5,9" });
    const ranges = resolveCommissionOrderProvisionMonthRanges(q);
    assert.ok(ranges);
    assert.equal(ranges!.length, 3);
    assert.deepEqual(
      ranges!.map((r) => r.gte.getMonth()),
      [1, 4, 8]
    );
  });

  it("month inválido legado é ignorado → all", () => {
    const q = parseCommissionOrderProvisionQuery({ year: "2026", month: "99" });
    assert.equal(q.months, "all");
  });

  it("months=1,2,3,...,12 colapsa para all", () => {
    const q = parseCommissionOrderProvisionQuery({
      year: "2026",
      months: "1,2,3,4,5,6,7,8,9,10,11,12",
    });
    assert.equal(q.months, "all");
  });
});

describe("commissionOrderProvision — client query + seller sync", () => {
  it("frontend envia months=6,7 e months=all sem month legado", () => {
    const multi = buildCommissionOrderProvisionClientQuery({
      year: "2026",
      months: [6, 7],
      sellerId: "all",
      selectedRawSellerId: null,
      customer: "",
      orderCode: "",
      includeZeroCommission: false,
      page: 1,
    });
    const p1 = new URLSearchParams(multi);
    assert.equal(p1.get("months"), "6,7");
    assert.equal(p1.get("month"), null);
    assert.equal(p1.get("year"), "2026");

    const all = buildCommissionOrderProvisionClientQuery({
      year: "2026",
      months: "all",
      sellerId: "all",
      selectedRawSellerId: null,
      customer: "",
      orderCode: "",
      includeZeroCommission: false,
      page: 1,
    });
    assert.equal(new URLSearchParams(all).get("months"), "all");
  });

  it("14–16. vendedor ativo / inválido / todos", () => {
    const withSeller = parseCommissionOrderProvisionQuery({
      year: "2026",
      sellerId: SELLER_A,
    });
    assert.equal(withSeller.canonicalSellerId, SELLER_A);

    const invalid = parseCommissionOrderProvisionQuery({
      year: "2026",
      sellerId: "nao-uuid",
    });
    assert.equal(invalid.canonicalSellerId, null);

    const all = parseCommissionOrderProvisionQuery({
      year: "2026",
      sellerId: "all",
    });
    assert.equal(all.canonicalSellerId, null);
  });

  it("17–19. vendedor + meses (um / vários / all) — query client e parse", () => {
    const qs = buildCommissionOrderProvisionClientQuery({
      year: "2026",
      months: [1, 3],
      sellerId: SELLER_A,
      selectedRawSellerId: null,
      customer: "",
      orderCode: "",
      includeZeroCommission: false,
      page: 2,
    });
    const params = Object.fromEntries(new URLSearchParams(qs).entries());
    assert.equal(params.months, "1,3");
    assert.equal(params.sellerId, SELLER_A);
    assert.equal(params.canonicalSellerId, SELLER_A);
    assert.equal(params.page, "2");

    const parsed = parseCommissionOrderProvisionQuery(params);
    assert.deepEqual(parsed.months, [1, 3]);
    assert.equal(parsed.canonicalSellerId, SELLER_A);
    assert.equal(parsed.page, 2);

    const allMonths = parseCommissionOrderProvisionQuery({
      year: "2026",
      months: "all",
      sellerId: SELLER_B,
    });
    assert.equal(allMonths.months, "all");
    assert.equal(allMonths.canonicalSellerId, SELLER_B);
  });

  it("20. sincronização lógica select ↔ chips", () => {
    const seller = {
      key: SELLER_A,
      canonicalSellerId: SELLER_A,
    };
    assert.equal(
      isCommissionOrderProvisionSellerChipActive({
        seller,
        sellerId: SELLER_A,
        selectedSellerKey: null,
        selectedRawSellerId: null,
      }),
      true
    );
    assert.equal(
      isCommissionOrderProvisionSellerChipActive({
        seller,
        sellerId: "all",
        selectedSellerKey: SELLER_A,
        selectedRawSellerId: null,
      }),
      true
    );
    assert.equal(
      isCommissionOrderProvisionSellerChipActive({
        seller,
        sellerId: "all",
        selectedSellerKey: null,
        selectedRawSellerId: null,
      }),
      false
    );
    assert.equal(
      isCommissionOrderProvisionSellerChipActive({
        seller: { key: "raw:99", canonicalSellerId: null },
        sellerId: "all",
        selectedSellerKey: "raw:99",
        selectedRawSellerId: 99,
      }),
      true
    );
  });

  it("21–22. totalizadores e paginação usam a mesma população filtrada", () => {
    const snapshots = [
      snap({
        id: "a",
        salesOrderId: "o1",
        orderCode: "PD 1",
        saleDate: new Date(2026, 0, 5),
        canonicalSellerId: SELLER_A,
        totalFinalCommissionAmount: 30,
      }),
      snap({
        id: "b",
        salesOrderId: "o2",
        orderCode: "PD 2",
        saleDate: new Date(2026, 0, 6),
        canonicalSellerId: SELLER_B,
        totalFinalCommissionAmount: 40,
      }),
      snap({
        id: "c",
        salesOrderId: "o3",
        orderCode: "PD 3",
        saleDate: new Date(2026, 2, 6),
        canonicalSellerId: SELLER_A,
        totalFinalCommissionAmount: 50,
      }),
    ];
    // Simula filtro server já aplicado (só SELLER_A em jan+mar)
    const filtered = snapshots.filter(
      (s) =>
        s.canonicalSellerId === SELLER_A &&
        [0, 2].includes((s.saleDate as Date).getMonth())
    );
    const payload = assembleCommissionOrderProvisionPayload({
      query: parseCommissionOrderProvisionQuery({
        year: "2026",
        months: "1,3",
        sellerId: SELLER_A,
        page: "1",
        pageSize: "1",
      }),
      snapshots: filtered,
    });
    assert.equal(payload.cards.orderCount, 2);
    assert.equal(payload.cards.totalFinalCommissionAmount, 80);
    assert.equal(payload.pagination.totalRows, 2);
    assert.equal(payload.pagination.pageSize, 1);
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.filters.canonicalSellerId, SELLER_A);
    assert.deepEqual(payload.filters.months, [1, 3]);
  });

  it("alterar meses não muda sellerId na query client", () => {
    const base = {
      year: "2026",
      sellerId: SELLER_A,
      selectedRawSellerId: null as number | null,
      customer: "",
      orderCode: "",
      includeZeroCommission: false,
      page: 1,
    };
    const a = new URLSearchParams(
      buildCommissionOrderProvisionClientQuery({ ...base, months: [1] })
    );
    const b = new URLSearchParams(
      buildCommissionOrderProvisionClientQuery({ ...base, months: [1, 3] })
    );
    assert.equal(a.get("sellerId"), SELLER_A);
    assert.equal(b.get("sellerId"), SELLER_A);
    assert.equal(a.get("months"), "1");
    assert.equal(b.get("months"), "1,3");
  });

  it("resolveCommissionOrderProvisionMonths é determinístico", () => {
    assert.deepEqual(resolveCommissionOrderProvisionMonths([3, 1, 3, 2]), [1, 2, 3]);
    assert.deepEqual(resolveCommissionOrderProvisionMonths("all").length, 12);
  });
});

describe("commissionOrderProvision — relatório completo (print/XLSX)", () => {
  const query = parseCommissionOrderProvisionQuery({ year: "2026", months: "all" });
  const snapshots = [
    snap({
      id: "s1",
      salesOrderId: "o1",
      orderCode: "PD 00001",
      saleDate: new Date(2026, 0, 10),
      totalFinalCommissionAmount: 50,
    }),
    snap({
      id: "s2",
      salesOrderId: "o2",
      orderCode: "PD 00002",
      saleDate: new Date(2026, 1, 5),
      canonicalSellerId: SELLER_B,
      canonicalSellerName: "João",
      rawSellerId: 20,
      rawSellerName: "João",
      totalFinalCommissionAmount: 30,
    }),
    snap({
      id: "s3",
      salesOrderId: "o3",
      orderCode: "PD 00003",
      saleDate: new Date(2026, 2, 1),
      totalFinalCommissionAmount: 0,
      hasCustomerExcludedItems: true,
    }),
  ];

  it("filterCommissionOrderProvisionZeroRows é a MESMA regra usada pela página paginada", () => {
    const rows = aggregateCommissionOrderProvisionRows(snapshots);
    const filtered = filterCommissionOrderProvisionZeroRows(rows, {
      includeZeroCommission: false,
      onlyZeroCommission: false,
    });
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((r) => r.totalFinalCommissionAmount > 0.009));

    const onlyZero = filterCommissionOrderProvisionZeroRows(rows, {
      includeZeroCommission: false,
      onlyZeroCommission: true,
    });
    assert.equal(onlyZero.length, 1);
    assert.equal(onlyZero[0]!.salesOrderId, "o3");
  });

  it("assembleCommissionOrderProvisionReportPayload devolve TODAS as linhas (sem paginação)", () => {
    const report = assembleCommissionOrderProvisionReportPayload({ query, snapshots });
    assert.equal(report.rows.length, 2); // exclui o3 (comissão zero) por padrão
    assert.equal(report.cards.orderCount, 2);
    assert.equal(report.cards.totalFinalCommissionAmount, 80);
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("relatório completo e página paginada concordam nos cards (mesma regra de zero)", () => {
    const paged = assembleCommissionOrderProvisionPayload({
      query: { ...query, page: 1, pageSize: 50 },
      snapshots,
    });
    const report = assembleCommissionOrderProvisionReportPayload({ query, snapshots });
    assert.deepEqual(paged.cards, report.cards);
  });

  it("buildCommissionOrderProvisionFilterSummary inclui período, vendedor e filtros ativos", () => {
    const withSeller = assembleCommissionOrderProvisionReportPayload({
      query: { ...query, canonicalSellerId: SELLER_B },
      snapshots,
    });
    const summary = buildCommissionOrderProvisionFilterSummary(withSeller);
    assert.match(summary, /Período:/);
    assert.match(summary, /Vendedor: João/);
    assert.match(summary, /Exclui comissão zero/);
  });

  it("buildCommissionOrderProvisionFilterSummary mostra 'Todos os vendedores' sem filtro de vendedor", () => {
    const report = assembleCommissionOrderProvisionReportPayload({ query, snapshots });
    assert.match(buildCommissionOrderProvisionFilterSummary(report), /Vendedor: Todos os vendedores/);
  });

  it("buildCommissionOrderProvisionExportWorkbook gera as 3 abas com as linhas certas", () => {
    const report = assembleCommissionOrderProvisionReportPayload({ query, snapshots });
    const wb = buildCommissionOrderProvisionExportWorkbook(report);
    assert.deepEqual(wb.SheetNames, ["Por vendedor", "Pedidos", "Filtros"]);

    const detail = XLSX.utils.sheet_to_json(wb.Sheets["Pedidos"]!, { header: 1 }) as unknown[][];
    // header + 2 linhas (o3 fica de fora por comissão zero, mesma regra da tela)
    assert.equal(detail.length, 3);
    assert.equal(detail[0]![0], "Pedido");

    const bySeller = XLSX.utils.sheet_to_json(wb.Sheets["Por vendedor"]!, {
      header: 1,
    }) as unknown[][];
    assert.equal(bySeller.length, 3); // header + 2 vendedores
  });

  it("buildCommissionOrderProvisionExportFilename varia com o filtro de meses", () => {
    assert.equal(
      buildCommissionOrderProvisionExportFilename({ year: 2026, months: "all" }),
      "comissao-provisao-pedido-2026-todos-os-meses.xlsx"
    );
    assert.equal(
      buildCommissionOrderProvisionExportFilename({ year: 2026, months: [1, 2] }),
      "comissao-provisao-pedido-2026-1-2.xlsx"
    );
  });
});
