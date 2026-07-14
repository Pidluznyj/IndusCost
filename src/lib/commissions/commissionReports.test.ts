import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assembleCommissionReportsPayload,
  buildCommissionReportsExportFilename,
  buildEmptyCommissionReportsPayload,
  filterCommissionReportRecords,
  formatCommissionReportMonthsLabel,
  isCommissionReportAllMonths,
  mapSourceLineToReportRecord,
  matchesCommissionReportSearch,
  resolveCommissionReportMonths,
  type CommissionReportSourceLine,
} from "./commissionReports.shared.js";
import { parseCommissionReportsQuery, CommissionQueryParseError } from "./commissionQuery.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function line(
  partial: Partial<CommissionReportSourceLine> & { lineKey: string }
): CommissionReportSourceLine {
  return {
    nomusReceivableId: 1,
    receivableNumber: "CR-1",
    installmentNumber: 1,
    settlementDate: "2026-06-15T00:00:00.000Z",
    dueDate: null,
    customerId: null,
    customerExternalId: null,
    customerName: "Cliente A",
    orderCode: "PED-1",
    localOrderId: null,
    linkResolutionSource: null,
    linkResolutionStatus: null,
    nomusNfeId: null,
    nfeNumber: "NF-100",
    localItemId: null,
    nomusOrderItemId: null,
    productCode: "P1",
    productName: null,
    rawSellerId: 10,
    rawSellerName: "Vendedor Raw",
    canonicalSellerId: "11111111-1111-4111-8111-111111111111",
    canonicalSellerName: "Vendedor Oficial",
    sellerResolutionStatus: "RESOLVED_FROM_SCHEDULE",
    receivedAmount: 1000,
    uniqueReceivedAmount: 1000,
    commissionableBaseAmount: 800,
    ratePercent: 5,
    expectedCommissionAmount: 40,
    releasedCommissionAmount: 40,
    grossCommissionAmount: 40,
    scheduledCommissionAmount: 40,
    commissionReceivableScheduleId: null,
    ruleId: null,
    ruleName: null,
    exclusionReason: null,
    status: "COMMISSIONABLE",
    statusReason: null,
    source: "PERSISTED_LEDGER",
    year: 2026,
    month: 6,
    periodStatus: "CLOSED",
    closingId: "22222222-2222-4222-8222-222222222222",
    ...partial,
  };
}

describe("parseCommissionReportsQuery", () => {
  it("exige ano válido", () => {
    assert.throws(
      () => parseCommissionReportsQuery({}),
      (err: unknown) => err instanceof CommissionQueryParseError
    );
  });

  it("aceita months=all e month legado", () => {
    const all = parseCommissionReportsQuery({ year: "2026", months: "all" });
    assert.equal(all.months, "all");
    const legacy = parseCommissionReportsQuery({ year: "2026", month: "6" });
    assert.deepEqual(legacy.months, [6]);
  });

  it("aceita months múltiplos", () => {
    const q = parseCommissionReportsQuery({ year: "2026", months: "6,7" });
    assert.deepEqual(q.months, [6, 7]);
  });

  it("array vazio de months vira all", () => {
    const q = parseCommissionReportsQuery({ year: "2026", months: [] });
    assert.equal(q.months, "all");
  });

  it("rejeita mês inválido com erro amigável", () => {
    assert.throws(
      () => parseCommissionReportsQuery({ year: "2026", months: "13" }),
      (err: unknown) =>
        err instanceof CommissionQueryParseError && String(err.message).includes("Mês inválido")
    );
  });

  it("rejeita status inválido com erro amigável", () => {
    assert.throws(
      () => parseCommissionReportsQuery({ year: "2026", status: "PAGO_XYZ" }),
      (err: unknown) =>
        err instanceof CommissionQueryParseError &&
        String(err.message).includes("Status inválido")
    );
  });
});

describe("commissionReports months helpers", () => {
  it("resolve all para 1–12", () => {
    assert.deepEqual(resolveCommissionReportMonths("all"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.equal(isCommissionReportAllMonths("all"), true);
    assert.equal(isCommissionReportAllMonths([6, 7]), false);
  });

  it("filename reflete filtro", () => {
    assert.equal(
      buildCommissionReportsExportFilename(2026, "all"),
      "comissao-relatorio-2026-todos-os-meses.xlsx"
    );
    assert.equal(
      buildCommissionReportsExportFilename(2026, [6, 7]),
      "comissao-relatorio-2026-jun-jul.xlsx"
    );
  });

  it("label resume seleção", () => {
    assert.equal(formatCommissionReportMonthsLabel("all"), "Todos os meses");
    assert.equal(formatCommissionReportMonthsLabel([6]), "Junho");
    assert.match(formatCommissionReportMonthsLabel([6, 7]), /Junho/);
  });
});

describe("commissionReports.shared", () => {
  it("arrays vazios não quebram payload", () => {
    const empty = buildEmptyCommissionReportsPayload({
      year: 2026,
      months: "all",
      sellerId: "all",
      status: "all",
      search: null,
      page: 1,
      pageSize: 50,
    });
    assert.deepEqual(empty.sellers, []);
    assert.deepEqual(empty.records, []);
    assert.equal(empty.summary.recordCount, 0);
  });

  it("filtra por vendedor e todos os vendedores", () => {
    const records = [
      mapSourceLineToReportRecord(line({ lineKey: "a" })),
      mapSourceLineToReportRecord(
        line({
          lineKey: "b",
          canonicalSellerId: "33333333-3333-4333-8333-333333333333",
          canonicalSellerName: "Outro",
          nomusReceivableId: 2,
        })
      ),
    ];
    const one = filterCommissionReportRecords(records, {
      sellerId: "11111111-1111-4111-8111-111111111111",
      status: "all",
      search: null,
    });
    assert.equal(one.length, 1);
    const all = filterCommissionReportRecords(records, {
      sellerId: "all",
      status: "all",
      search: null,
    });
    assert.equal(all.length, 2);
  });

  it("busca por cliente/pedido/NF/CR", () => {
    const record = mapSourceLineToReportRecord(line({ lineKey: "x" }));
    assert.equal(matchesCommissionReportSearch(record, "Cliente A"), true);
    assert.equal(matchesCommissionReportSearch(record, "PED-1"), true);
    assert.equal(matchesCommissionReportSearch(record, "NF-100"), true);
    assert.equal(matchesCommissionReportSearch(record, "CR-1"), true);
    assert.equal(matchesCommissionReportSearch(record, "inexistente"), false);
  });

  it("COMMISSION_SOURCE_MISMATCH exibe prevista do snapshot e marca divergência", () => {
    const record = mapSourceLineToReportRecord(
      line({
        lineKey: "mismatch",
        status: "COMMISSION_SOURCE_MISMATCH",
        statusReason: "COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT",
        expectedCommissionAmount: 250,
        releasedCommissionAmount: 0,
        grossCommissionAmount: 250,
        source: "ORDER_SNAPSHOT",
      })
    );
    assert.equal(record.finalCommissionAmount, 250);
    assert.equal(record.isPayable, false);
    assert.equal(record.divergesFromOrderSnapshot, true);
    assert.equal(record.lineStatus, "COMMISSION_SOURCE_MISMATCH");
  });

  it("resumo por vendedor soma comissão final de múltiplos meses", () => {
    const payload = assembleCommissionReportsPayload(
      [
        line({ lineKey: "1", month: 6, releasedCommissionAmount: 40, grossCommissionAmount: 40 }),
        line({
          lineKey: "2",
          month: 7,
          nomusReceivableId: 2,
          settlementDate: "2026-07-10T00:00:00.000Z",
          releasedCommissionAmount: 60,
          grossCommissionAmount: 60,
        }),
      ],
      {
        year: 2026,
        months: [6, 7],
        sellerId: "all",
        status: "all",
        search: null,
        page: 1,
        pageSize: 50,
      },
      [
        { year: 2026, month: 6, periodStatus: "CLOSED", closingId: "c1" },
        { year: 2026, month: 7, periodStatus: "PREVIEW", closingId: null },
      ]
    );
    assert.equal(payload.summary.totalCommission, 100);
    assert.equal(payload.sellers.length, 1);
    assert.equal(payload.sellers[0]?.finalCommission, 100);
    assert.deepEqual(payload.filtersApplied.months, [6, 7]);
    assert.ok(Array.isArray(payload.records));
  });

  it("summary bate com soma do resumo por vendedor e respeita filtros", () => {
    const sellerA = "11111111-1111-4111-8111-111111111111";
    const sellerB = "33333333-3333-4333-8333-333333333333";
    const lines = [
      line({
        lineKey: "a1",
        month: 6,
        canonicalSellerId: sellerA,
        canonicalSellerName: "Rodrigo",
        receivedAmount: 100,
        uniqueReceivedAmount: 100,
        commissionableBaseAmount: 80,
        releasedCommissionAmount: 4,
        grossCommissionAmount: 4,
        periodStatus: "CLOSED",
      }),
      line({
        lineKey: "a2",
        month: 7,
        nomusReceivableId: 2,
        settlementDate: "2026-07-10T00:00:00.000Z",
        canonicalSellerId: sellerA,
        canonicalSellerName: "Rodrigo",
        receivedAmount: 200,
        uniqueReceivedAmount: 200,
        commissionableBaseAmount: 160,
        releasedCommissionAmount: 8,
        grossCommissionAmount: 8,
        periodStatus: "PREVIEW",
      }),
      line({
        lineKey: "b1",
        month: 6,
        nomusReceivableId: 3,
        canonicalSellerId: sellerB,
        canonicalSellerName: "Gislene",
        receivedAmount: 50,
        uniqueReceivedAmount: 50,
        commissionableBaseAmount: 40,
        releasedCommissionAmount: 2,
        grossCommissionAmount: 2,
        periodStatus: "CLOSED",
      }),
      line({
        lineKey: "ex",
        month: 6,
        nomusReceivableId: 4,
        status: "CUSTOMER_EXCLUDED",
        canonicalSellerId: sellerA,
        canonicalSellerName: "Rodrigo",
        receivedAmount: 10,
        uniqueReceivedAmount: 10,
        commissionableBaseAmount: 0,
        releasedCommissionAmount: 0,
        expectedCommissionAmount: 1,
        grossCommissionAmount: 1,
        periodStatus: "CLOSED",
      }),
    ];

    const allMonths = assembleCommissionReportsPayload(
      lines,
      {
        year: 2026,
        months: "all",
        sellerId: "all",
        status: "all",
        search: null,
        page: 1,
        pageSize: 50,
      },
      [
        { year: 2026, month: 6, periodStatus: "CLOSED", closingId: "c1" },
        { year: 2026, month: 7, periodStatus: "PREVIEW", closingId: null },
      ]
    );
    assert.equal(
      allMonths.summary.totalCommission,
      roundSellerSum(allMonths.sellers, "finalCommission")
    );
    assert.equal(
      allMonths.summary.commissionableBase,
      roundSellerSum(allMonths.sellers, "commissionableBase")
    );
    assert.equal(
      allMonths.summary.receivedAmount,
      roundSellerSum(allMonths.sellers, "receivedAmount")
    );
    assert.equal(allMonths.summary.recordCount, allMonths.pagination.total);
    assert.equal(allMonths.summary.sellerCount, allMonths.sellers.length);
    assert.equal(allMonths.summary.excludedCustomerCount, 1);
    assert.equal(
      allMonths.summary.excludedCommission,
      roundSellerSum(allMonths.sellers, "excludedCommission")
    );
    assert.ok(allMonths.summary.excludedCommission > 0);

    const bySeller = assembleCommissionReportsPayload(
      lines,
      {
        year: 2026,
        months: "all",
        sellerId: sellerA,
        status: "all",
        search: null,
        page: 1,
        pageSize: 50,
      },
      [
        { year: 2026, month: 6, periodStatus: "CLOSED", closingId: "c1" },
        { year: 2026, month: 7, periodStatus: "PREVIEW", closingId: null },
      ]
    );
    // CUSTOMER_EXCLUDED agrupa em bucket unassigned, mas ainda filtra pelo sellerId canônico.
    assert.equal(bySeller.summary.sellerCount, 2);
    assert.equal(bySeller.sellers[0]?.sellerName, "Rodrigo");
    assert.ok(
      bySeller.sellers.some((s) => s.sellerName === "Sem vendedor / Excluído")
    );
    assert.equal(bySeller.summary.excludedCustomerCount, 1);
    assert.ok(bySeller.summary.excludedCommission > 0);
    assert.equal(
      bySeller.summary.totalCommission,
      roundSellerSum(bySeller.sellers, "finalCommission")
    );
    assert.equal(
      bySeller.summary.commissionableBase,
      roundSellerSum(bySeller.sellers, "commissionableBase")
    );
    assert.equal(
      bySeller.summary.receivedAmount,
      roundSellerSum(bySeller.sellers, "receivedAmount")
    );
    assert.equal(bySeller.summary.recordCount, 3);

    const multi = assembleCommissionReportsPayload(
      lines,
      {
        year: 2026,
        months: [6, 7],
        sellerId: "all",
        status: "all",
        search: null,
        page: 1,
        pageSize: 50,
      },
      [
        { year: 2026, month: 6, periodStatus: "CLOSED", closingId: "c1" },
        { year: 2026, month: 7, periodStatus: "PREVIEW", closingId: null },
      ]
    );
    assert.equal(multi.summary.totalCommission, allMonths.summary.totalCommission);

    const previewOnly = assembleCommissionReportsPayload(
      lines,
      {
        year: 2026,
        months: "all",
        sellerId: "all",
        status: "PREVIEW",
        search: null,
        page: 1,
        pageSize: 50,
      },
      [
        { year: 2026, month: 6, periodStatus: "CLOSED", closingId: "c1" },
        { year: 2026, month: 7, periodStatus: "PREVIEW", closingId: null },
      ]
    );
    assert.equal(previewOnly.summary.recordCount, 1);
    assert.equal(previewOnly.summary.totalCommission, 8);
    assert.equal(previewOnly.summary.receivedAmount, 200);

    const search = assembleCommissionReportsPayload(
      lines,
      {
        year: 2026,
        months: "all",
        sellerId: "all",
        status: "all",
        search: "Gislene",
        page: 1,
        pageSize: 50,
      },
      [
        { year: 2026, month: 6, periodStatus: "CLOSED", closingId: "c1" },
        { year: 2026, month: 7, periodStatus: "PREVIEW", closingId: null },
      ]
    );
    assert.equal(search.summary.recordCount, 1);
    assert.equal(search.summary.totalCommission, 2);
    assert.equal(search.summary.sellerCount, 1);
  });

  it("summary com zero monetário retorna 0 (não null)", () => {
    const payload = assembleCommissionReportsPayload(
      [
        line({
          lineKey: "z",
          status: "SELLER_UNRESOLVED",
          sellerResolutionStatus: "SELLER_UNRESOLVED",
          canonicalSellerId: null,
          canonicalSellerName: null,
          releasedCommissionAmount: 0,
          grossCommissionAmount: 0,
          commissionableBaseAmount: 0,
          receivedAmount: 0,
          uniqueReceivedAmount: 0,
        }),
      ],
      {
        year: 2026,
        months: [6],
        sellerId: "all",
        status: "all",
        search: null,
        page: 1,
        pageSize: 50,
      },
      [{ year: 2026, month: 6, periodStatus: "CLOSED", closingId: "c1" }]
    );
    assert.equal(payload.summary.totalCommission, 0);
    assert.equal(payload.summary.commissionableBase, 0);
    assert.equal(payload.summary.receivedAmount, 0);
    assert.equal(payload.summary.excludedCommission, 0);
    assert.equal(payload.summary.unresolvedSellerCount, 1);
  });

  it("não recalcula percentual no frontend — usa rate da linha", () => {
    const record = mapSourceLineToReportRecord(line({ lineKey: "r", ratePercent: 7.5 }));
    assert.equal(record.ratePercent, 7.5);
    assert.equal(record.finalCommissionAmount, 40);
  });

  it("propaga localOrderId do source line para o registro do relatório", () => {
    const withId = mapSourceLineToReportRecord(
      line({ lineKey: "with-id", localOrderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
    );
    assert.equal(withId.localOrderId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const without = mapSourceLineToReportRecord(line({ lineKey: "no-id", localOrderId: null }));
    assert.equal(without.localOrderId, null);
  });

  it("propaga linkResolutionStatus AMBIGUOUS e não mascara no registro", () => {
    const record = mapSourceLineToReportRecord(
      line({
        lineKey: "amb",
        orderCode: "PD02341",
        localOrderId: null,
        linkResolutionSource: "AMBIGUOUS",
        linkResolutionStatus: "AMBIGUOUS",
        statusReason:
          "Vínculo ambíguo: há múltiplos pedidos do mesmo cliente com mesmo valor/produto (ou a mesma NF ligada a mais de um pedido).",
      })
    );
    assert.equal(record.linkResolutionStatus, "AMBIGUOUS");
    assert.equal(record.localOrderId, null);
    assert.match(record.statusReason ?? "", /Vínculo ambíguo/);
  });
});

describe("commissionReports UI months multiselect", () => {
  it("página usa multiselect e months na query", () => {
    const page = read("src/components/commissions/pages/CommissionsReportsPage.tsx");
    assert.match(page, /CommissionsMonthsMultiSelect/);
    assert.match(page, /months/);
    assert.match(page, /\/api\/commissions\/reports/);
    assert.doesNotMatch(page, /CommissionsPeriodFilterFields/);
  });

  it("cards monetários usam amountFormat currency", () => {
    const page = read("src/components/commissions/pages/CommissionsReportsPage.tsx");
    assert.match(page, /label="Comissão total"[\s\S]*?amountFormat="currency"/);
    assert.match(page, /label="Base comissionável"[\s\S]*?amountFormat="currency"/);
    assert.match(page, /label="Valor recebido"[\s\S]*?amountFormat="currency"/);
    assert.match(page, /label="Comissão excluída"[\s\S]*?amountFormat="currency"/);
    assert.match(page, /label="Registros"[\s\S]*?amountFormat="number"/);
  });

  it("server carrega prévia para meses sem fechamento também em multi/all", () => {
    const server = read("src/lib/commissions/commissionReports.server.ts");
    assert.match(server, /loadPreviewMonthSourceLines/);
    assert.match(server, /months\.filter\(\(m\) => !closedMonths\.has\(m\)\)/);
    assert.match(server, /month:\s*\{\s*in:\s*input\.months\s*\}/);
    assert.match(server, /applyActiveCustomerExclusionsToReportLines/);
    assert.match(server, /loadActiveCustomerExclusionRuleSnapshots/);
  });

  it("informa clientes não comissionáveis no resumo e no alerta", () => {
    const page = read("src/components/commissions/pages/CommissionsReportsPage.tsx");
    assert.match(page, /commissions-reports-exclusion-alert/);
    assert.match(page, /Clientes não comissionáveis/);
    assert.match(page, /Exceções por cliente/);
  });
  it("comissão zerada exibe alerta suave com motivo (tooltip)", () => {
    const page = read("src/components/commissions/pages/CommissionsReportsPage.tsx");
    assert.match(page, /CommissionAmountCell/);
    assert.match(page, /commissions-reports-commission-reason-hint/);
    assert.match(page, /resolveCommissionBlockReason/);
    assert.match(page, /REASON_LABELS/);
    assert.match(page, /AlertCircle/);
  });

  it("coluna Pedido é clicável e abre drawer de margem do SalesOrder", () => {
    const page = read("src/components/commissions/pages/CommissionsReportsPage.tsx");
    const drawer = read("src/components/sales/SalesOrderMarginDetailDrawer.tsx");
    const server = read("src/lib/commissions/commissionReports.server.ts");
    assert.match(page, /commissions-reports-order-link/);
    assert.match(page, /linkResolutionStatus !== "AMBIGUOUS"/);
    assert.match(page, /commissions-reports-order-ambiguous/);
    assert.match(page, /SalesOrderMarginDetailDrawer/);
    assert.match(page, /setOrderDetailRow/);
    assert.match(page, /localOrderId/);
    assert.match(page, /onClose=\{\(\) => setOrderDetailRow\(null\)\}/);
    assert.doesNotMatch(
      page,
      /onClose=\{\(\) => \{\s*setOrderDetailRow\(null\);\s*setYear/
    );
    assert.match(drawer, /sales-order-margin-detail-drawer/);
    assert.match(drawer, /\/api\/sales-orders\/\$\{salesOrderId\}/);
    assert.match(drawer, /SalesOrderMarginAnalysisSection/);
    assert.match(drawer, /Abrir pedido completo/);
    assert.match(drawer, /Não foi possível carregar o detalhe do pedido/);
    assert.doesNotMatch(drawer, /from ["']@\/src\/lib\/proposals|Proposal\.find/);
    assert.doesNotMatch(drawer, /finalCommissionAmount\s*\*|ratePercent\s*\*/);
    assert.match(server, /attachLocalOrderIdsToReportLines/);
    assert.match(server, /prisma\.salesOrder\.findMany/);
    assert.match(server, /AMBIGUOUS/);
    assert.match(server, /salesOrderNfeLink\.findMany/);
  });
});

function roundSellerSum(
  sellers: Array<{
    finalCommission: number;
    commissionableBase: number;
    receivedAmount: number;
    excludedCommission: number;
  }>,
  key: "finalCommission" | "commissionableBase" | "receivedAmount" | "excludedCommission"
): number {
  return Math.round(sellers.reduce((sum, row) => sum + row[key], 0) * 100) / 100;
}