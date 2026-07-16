/**
 * Testes do DTO/builder da aba Tributos (T04) — âncora PD 02457.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNfeFiscalXml } from "../nfeFiscalXmlParser.js";
import { PD_02457_FISCAL, PD_02457_NFE_XML } from "../nfeFiscalFixtures.js";
import { buildSalesOrderFiscalTaxesPayload } from "./salesOrderFiscalTaxes.server.js";
import {
  canViewSalesOrderFiscalTaxes,
  canViewSalesOrderFiscalTaxesFromPermissions,
} from "./salesOrderFiscalTaxesPermissions.js";
import {
  collectionLabelForGuide,
  resolveSalesOrderFiscalSettlementStatus,
} from "./salesOrderFiscalTaxesClient.js";
import type { OrderFullAuditPayload } from "../finance/orderFullAuditClient.js";

function emptySettlementPrismaExtras() {
  return {
    fiscalAllocation: {
      findMany: async () => [],
    },
    fiscalPaymentGuide: {
      findMany: async () => [],
    },
    fiscalSettlementAuditLog: {
      findMany: async () => [],
    },
    nomusAccountsPayable: {
      findMany: async () => [],
    },
  };
}

function baseAudit(
  overrides: Partial<OrderFullAuditPayload> = {}
): OrderFullAuditPayload {
  return {
    ok: true,
    salesOrderId: "00000000-0000-4000-8000-000000000001",
    orderCode: "PD 02457",
    runId: null,
    runMeta: { runId: null, orderToCashFinishedAt: null },
    summary: {
      orderCode: "PD 02457",
      customerName: "ESMALTEC",
      externalCustomerId: null,
      customerDocument: null,
      companyName: null,
      orderIssueDate: null,
      orderExpectedDeliveryDate: null,
      paymentTerms: null,
      paymentMethod: null,
      freightCondition: null,
      commercialResponsibleName: null,
      commercialResponsible: {
        kind: "MISSING",
        label: "—",
        sellerCanonicalName: null,
        sellerResponsibleName: null,
      } as OrderFullAuditPayload["summary"]["commercialResponsible"],
      orderSellerName: null,
      orderSellerExternalId: null,
      orderSeller: {
        kind: "MISSING",
        label: "—",
        externalId: null,
        displayName: null,
      } as OrderFullAuditPayload["summary"]["orderSeller"],
      operationalResponsibleArea: null,
      originalOrderValue: PD_02457_FISCAL.vNF,
      canceledOrderValue: 0,
      cutOrderValue: 0,
      activeOrderValue: PD_02457_FISCAL.vNF,
      allocatedOrderValue: PD_02457_FISCAL.vNF,
      pendingActiveOrderValue: 0,
      fulfillmentPercentActive: 100,
      receivableTotalValue: PD_02457_FISCAL.vNF,
      receivableOpenValue: 0,
      receivableReceivedValue: PD_02457_FISCAL.vNF,
      nfeValidTotalValue: PD_02457_FISCAL.vNF,
      nfeCount: 1,
      stockDocumentCount: 0,
      alertCount: 0,
      operationalStatus: null,
      operationalStage: null,
      financialStatus: null,
      financialStage: null,
      confidence: null,
    } as OrderFullAuditPayload["summary"],
    timeline: [],
    items: [],
    itemFacts: [],
    receivables: [
      {
        receivableExternalId: 1,
        documentNumber: "1",
        dueDate: null,
        issueDate: null,
        originalAmount: PD_02457_FISCAL.vNF,
        openAmount: 0,
        receivedAmount: PD_02457_FISCAL.vNF,
        status: "QUITADO",
        isOverdue: false,
        nfeExternalId: 2457,
        nfeNumber: "2457",
        alerts: [],
      } as OrderFullAuditPayload["receivables"][number],
    ],
    receivablesTotal: {
      totalAmount: PD_02457_FISCAL.vNF,
      openAmount: 0,
      receivedAmount: PD_02457_FISCAL.vNF,
      overdueCount: 0,
      nextDueDate: null,
      maxAmount: PD_02457_FISCAL.vNF,
      totalCount: 1,
    },
    plannedReceivables: [],
    plannedReceivablesTotal: {
      totalCount: 0,
      totalExpected: 0,
      applicableExpected: 0,
      openExpected: 0,
      overdueExpected: 0,
      overdueCount: 0,
      nextDueDate: null,
      replacedCount: 0,
      replacedAmount: 0,
    },
    stockDocuments: [],
    stockDocumentItems: [],
    nfeItems: [
      {
        nfeExternalId: 2457,
        nfeNumber: "2457",
        nfeItemIndex: 1,
        productSku: "SKU-PD02457",
        productName: "COMPONENTE FIXTURE PD02457",
        productExternalId: null,
        unit: "UN",
        cfop: "5102",
        quantityNfe: 1,
        unitValueNfe: PD_02457_FISCAL.productsNet,
        totalValueNfe: PD_02457_FISCAL.productsNet,
        taxes: PD_02457_FISCAL.ipi,
        linkedSalesOrderItemId: null,
        linkedOrderItemSequence: null,
        linkedStockDocumentExternalId: null,
        linkedStockDocumentItemId: null,
        orderUnitPrice: null,
        documentUnitPrice: null,
        priceDiffNfeVsOrderAbsolute: null,
        priceDiffNfeVsOrderPercent: null,
        priceDiffNfeVsDocumentAbsolute: null,
        priceDiffNfeVsDocumentPercent: null,
        alerts: [],
      },
    ],
    nfes: [
      {
        nfeExternalId: 2457,
        numero: "2457",
        serie: "1",
        chave: null,
        dataProcessamento: null,
        dataEmissao: "2025-03-10T14:00:00.000Z",
        status: 100,
        statusRaw: "100",
        statusNormalized: "AUTHORIZED",
        statusLabel: "Autorizada",
        isCanceled: false,
        isValidForBilling: true,
        valorTotal: PD_02457_FISCAL.vNF,
        valorLiquido: PD_02457_FISCAL.productsNet,
        highlightedTaxesValue: PD_02457_FISCAL.ipi,
        allocatedValueToOrder: PD_02457_FISCAL.vNF,
        allocatedValueToOrderRaw: PD_02457_FISCAL.vNF,
        headerGreaterThanOrder: false,
        hasExtraItems: false,
        hasReceivable: true,
        linkedStockDocumentExternalIds: [],
        linkOrigin: "SALES_ORDER_NFE_LINK",
        insideOrderItemsValue: PD_02457_FISCAL.productsNet,
        outsideOrderItemsValue: 0,
        alerts: [],
      } as OrderFullAuditPayload["nfes"][number],
    ],
    delivery: {} as OrderFullAuditPayload["delivery"],
    alerts: [],
    proposal: {} as OrderFullAuditPayload["proposal"],
    proposalVsOrderComparisons: null,
    salesOrder: {} as OrderFullAuditPayload["salesOrder"],
    receipts: [],
    freight: {} as OrderFullAuditPayload["freight"],
    marginPricing: {
      totals: {
        totalNetRevenue: null,
        totalCost: null,
        marginValue: null,
        marginPerc: null,
        coverage: null,
        canceledValue: 0,
        cutValue: 0,
        staleValue: 0,
        noMarginValue: 0,
        priceOrderVsTableDelta: 0,
        priceOrderVsDocumentDelta: 0,
      },
      counts: {
        activeItems: 0,
        canceledItems: 0,
        cutItems: 0,
        staleItems: 0,
        noMarginItems: 0,
        priceMismatchItems: 0,
        negativeMarginItems: 0,
        missingCostItems: 0,
        missingTableItems: 0,
      },
      items: [],
      itemMargins: [],
      officialPriceReferences: [],
      source: "NONE",
    },
    commissions: {} as OrderFullAuditPayload["commissions"],
    divergences: {} as OrderFullAuditPayload["divergences"],
    technicalAudit: {
      sources: [],
      sourceTables: [],
      identifiers: {} as OrderFullAuditPayload["technicalAudit"]["identifiers"],
      rulesApplied: [],
      history: {} as OrderFullAuditPayload["technicalAudit"]["history"],
      matchConfidenceSummary: {},
      factCount: 0,
      gaps: [],
      rawStatus: { included: false, reason: "default" } as OrderFullAuditPayload["technicalAudit"]["rawStatus"],
    },
    ...overrides,
  };
}

describe("salesOrderFiscalTaxesPermissions", () => {
  it("libera com invoice.view ou detail.view", () => {
    assert.equal(
      canViewSalesOrderFiscalTaxes({
        hasPermission: (p) => p === "sales_orders.invoice.view",
      }),
      true
    );
    assert.equal(
      canViewSalesOrderFiscalTaxes({
        hasPermission: (p) => p === "sales_orders.detail.view",
      }),
      true
    );
    assert.equal(
      canViewSalesOrderFiscalTaxes({ hasPermission: () => false }),
      false
    );
  });

  it("backend: bag vazia ou sem sales_orders libera; só view nega", () => {
    assert.equal(canViewSalesOrderFiscalTaxesFromPermissions(null), true);
    assert.equal(canViewSalesOrderFiscalTaxesFromPermissions([]), true);
    assert.equal(
      canViewSalesOrderFiscalTaxesFromPermissions(["settings.view"]),
      true
    );
    assert.equal(
      canViewSalesOrderFiscalTaxesFromPermissions(["sales_orders.view"]),
      false
    );
    assert.equal(
      canViewSalesOrderFiscalTaxesFromPermissions([
        "sales_orders.view",
        "sales_orders.invoice.view",
      ]),
      true
    );
  });
});

describe("buildSalesOrderFiscalTaxesPayload — PD 02457", () => {
  it("monta produtos líquidos, IPI 129,19, total NF 4104,19, a faturar 0 e saldo CR 0", async () => {
    const parsed = parseNfeFiscalXml(PD_02457_NFE_XML);
    const headerLines = parsed.lines.filter((l) => l.scope === "HEADER");
    const itemLines = parsed.lines.filter((l) => l.scope === "ITEM");

    const prisma = {
      nomusNfe: {
        findMany: async () => [
          {
            id: "nfe-uuid-1",
            externalId: 2457,
            fiscalSummary: {
              id: "sum-1",
              finalidade: 1,
              vProd: PD_02457_FISCAL.productsNet,
              vDesc: 0,
              vFrete: 0,
              vSeg: 0,
              vOutro: 0,
              vNF: PD_02457_FISCAL.vNF,
              highlightedResidual: parsed.highlightedResidual,
              parsedAt: new Date("2026-07-16T12:00:00.000Z"),
              parserVersion: parsed.parserVersion,
              source: parsed.source,
              qualityAlert: parsed.qualityAlert,
              taxLines: [...headerLines, ...itemLines].map((l) => ({
                lineKey: l.lineKey,
                taxType: l.taxType,
                scope: l.scope,
                itemNumber: l.itemNumber,
                baseAmount: l.baseAmount,
                rate: l.rate,
                amount: l.amount,
                cst: l.cst,
                csosn: l.csosn,
                cfop: l.cfop,
                ncm: l.ncm,
                metadata: l.metadata,
              })),
            },
          },
        ],
      },
      ...emptySettlementPrismaExtras(),
    };

    const payload = await buildSalesOrderFiscalTaxesPayload(
      prisma as never,
      baseAudit()
    );

    assert.equal(payload.summary.productsValue, PD_02457_FISCAL.productsNet);
    assert.equal(payload.summary.nfeValidTotal, PD_02457_FISCAL.vNF);
    assert.equal(payload.summary.amountToInvoice, 0);
    assert.equal(payload.summary.financialBalance, 0);
    assert.equal(payload.summary.validNfeCount, 1);
    assert.equal(payload.summary.cancelledNfeCount, 0);
    assert.equal(payload.summary.sourceLabel, "XML NF-e");

    const ipi = payload.highlightedTaxes.find((t) => t.taxType === "IPI");
    assert.ok(ipi);
    assert.equal(ipi!.amount, PD_02457_FISCAL.ipi);

    // Não inventar “saldo” fiscal fictício
    assert.ok(
      !payload.highlightedTaxes.some((t) => /saldo/i.test(t.label))
    );
    assert.match(payload.technical.note, /Residual ≠ saldo financeiro/);

    assert.equal(payload.nfes.length, 1);
    assert.equal(payload.nfes[0]!.totalValue, PD_02457_FISCAL.vNF);
    assert.ok(payload.itemTaxLines.some((l) => l.taxType === "IPI"));

    // T06 — settlements: sem guia → “Sem informação de recolhimento”
    assert.ok(payload.settlements);
    assert.equal(payload.settlements.emptyStates.noGuides, true);
    const matrixIpi = payload.settlements.taxMatrix.find((r) => r.taxType === "IPI");
    assert.ok(matrixIpi);
    assert.equal(matrixIpi!.highlightedAmount, PD_02457_FISCAL.ipi);
    assert.equal(matrixIpi!.statusCode, "NO_COLLECTION_INFO");
    assert.equal(matrixIpi!.statusLabel, "Sem informação de recolhimento");
  });

  it("consolida alocação + guia parcial no pedido", async () => {
    const money = (n: number) => ({
      toNumber: () => n,
      toFixed: (d: number) => n.toFixed(d),
    });
    const prisma = {
      nomusNfe: { findMany: async () => [] },
      fiscalAllocation: {
        findMany: async () => [
          {
            id: "alloc-1",
            guideId: "guide-1",
            salesOrderId: "00000000-0000-4000-8000-000000000001",
            nomusNfeId: null,
            taxType: "IPI",
            allocatedAmount: money(129.19),
            allocationMethod: "MANUAL",
            allocationBase: null,
            periodStart: new Date("2026-03-01"),
            periodEnd: new Date("2026-03-31"),
            calculatedAt: new Date("2026-04-01T10:00:00Z"),
            version: 1,
            manualOverride: true,
            notes: "gerencial",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      fiscalPaymentGuide: {
        findMany: async () => [
          {
            id: "guide-1",
            taxType: "IPI",
            guideType: "DARF",
            guideNumber: "G-IPI",
            status: "PARTIALLY_PAID",
            periodStart: new Date("2026-03-01"),
            periodEnd: new Date("2026-03-31"),
            dueDate: new Date("2026-04-20"),
            assessedAmount: money(1000),
            creditsAmount: money(0),
            compensationsAmount: money(0),
            interestAmount: money(0),
            fineAmount: money(0),
            amountDue: money(1000),
            amountPaid: money(400),
            balanceDue: money(600),
            paidAt: new Date("2026-04-15"),
            accountsPayableExternalId: 55,
            period: { id: "p1", status: "CLOSED", periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31") },
            proofs: [{ id: "pr1" }],
            allocations: [
              {
                id: "alloc-1",
                allocatedAmount: money(129.19),
                allocationMethod: "MANUAL",
                salesOrderId: "00000000-0000-4000-8000-000000000001",
              },
            ],
          },
        ],
      },
      fiscalSettlementAuditLog: {
        findMany: async () => [
          {
            id: "aud-1",
            entityType: "FiscalAllocation",
            entityId: "alloc-1",
            action: "CREATE",
            userName: "tester",
            createdAt: new Date("2026-04-01T10:00:00Z"),
          },
        ],
      },
      nomusAccountsPayable: {
        findMany: async () => [
          { externalId: 55, documentNumber: "AP-55" },
        ],
      },
    };

    const audit = baseAudit({
      nfes: [],
      nfeItems: [],
      summary: { ...baseAudit().summary, activeOrderValue: 0 },
    });
    // inject highlighted via empty nfes — matrix from allocations/guides
    const { buildSalesOrderFiscalSettlementsBlock } = await import(
      "./salesOrderFiscalTaxes.server.js"
    );
    const block = await buildSalesOrderFiscalSettlementsBlock(prisma as never, {
      salesOrderId: audit.salesOrderId,
      highlightedTaxes: [{ taxType: "IPI", label: "IPI", amount: 129.19 }],
      nomusNfeIds: [],
    });

    assert.equal(block.emptyStates.noGuides, false);
    assert.equal(block.emptyStates.noAllocations, false);
    assert.equal(block.guides.length, 1);
    assert.match(block.guides[0]!.collectionLabel, /parcial/i);
    assert.equal(block.guides[0]!.accountsPayableDocumentNumber, "AP-55");
    assert.equal(block.totals.allocatedToOrderTotal, 129.19);
    const row = block.taxMatrix.find((r) => r.taxType === "IPI");
    assert.ok(row);
    assert.equal(row!.statusCode, "PARTIALLY_PAID");
    assert.equal(row!.allocatedToOrder, 129.19);
    assert.equal(row!.highlightedAmount, 129.19);
    assert.ok(block.history.length >= 1);
  });

  it("NF cancelada fica separada e fora dos totalizadores", async () => {
    const prisma = {
      nomusNfe: {
        findMany: async () => [],
      },
      ...emptySettlementPrismaExtras(),
    };
    const audit = baseAudit({
      nfes: [
        {
          ...(baseAudit().nfes[0] as OrderFullAuditPayload["nfes"][number]),
          nfeExternalId: 1,
          numero: "1",
          isCanceled: false,
          isValidForBilling: true,
          valorTotal: 100,
          valorLiquido: 100,
          highlightedTaxesValue: 0,
        },
        {
          ...(baseAudit().nfes[0] as OrderFullAuditPayload["nfes"][number]),
          nfeExternalId: 2,
          numero: "2",
          isCanceled: true,
          isValidForBilling: false,
          valorTotal: 999,
          valorLiquido: 999,
          highlightedTaxesValue: 50,
          statusLabel: "Cancelada",
        },
      ],
      nfeItems: [],
      receivables: [],
      receivablesTotal: {
        totalAmount: 0,
        openAmount: 0,
        receivedAmount: 0,
        overdueCount: 0,
        nextDueDate: null,
        maxAmount: 0,
        totalCount: 0,
      },
      summary: {
        ...baseAudit().summary,
        activeOrderValue: 100,
      },
    });

    const payload = await buildSalesOrderFiscalTaxesPayload(
      prisma as never,
      audit
    );
    assert.equal(payload.summary.validNfeCount, 1);
    assert.equal(payload.summary.cancelledNfeCount, 1);
    assert.equal(payload.summary.nfeValidTotal, 100);
    assert.equal(payload.cancelledNfes.length, 1);
    assert.equal(payload.nfes.length, 1);
  });

  it("pedido sem NF retorna resumo vazio e a faturar = ativo", async () => {
    const prisma = {
      nomusNfe: { findMany: async () => [] },
      ...emptySettlementPrismaExtras(),
    };
    const audit = baseAudit({
      nfes: [],
      nfeItems: [],
      receivables: [],
      receivablesTotal: {
        totalAmount: 0,
        openAmount: 0,
        receivedAmount: 0,
        overdueCount: 0,
        nextDueDate: null,
        maxAmount: 0,
        totalCount: 0,
      },
      summary: {
        ...baseAudit().summary,
        activeOrderValue: 500,
      },
    });
    const payload = await buildSalesOrderFiscalTaxesPayload(
      prisma as never,
      audit
    );
    assert.equal(payload.nfes.length, 0);
    assert.equal(payload.summary.nfeValidTotal, 0);
    assert.equal(payload.summary.amountToInvoice, 500);
    assert.equal(payload.summary.financialBalance, null);
    assert.equal(payload.highlightedTaxes.length, 0);
  });
});
