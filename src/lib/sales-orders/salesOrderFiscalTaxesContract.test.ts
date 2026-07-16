/**
 * TRIB-05 — Contrato estável da API de Tributos do Pedido.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PD_02457_FISCAL } from "../nfeFiscalFixtures.js";
import type { OrderFullAuditPayload } from "../finance/orderFullAuditClient.js";
import { buildSalesOrderFiscalTaxesPayload } from "./salesOrderFiscalTaxes.server.js";
import {
  attachSalesOrderFiscalTaxesContract,
  buildSalesOrderFiscalNfeLinkOrigins,
  buildSalesOrderFiscalTaxesErrorPayload,
  resolveSalesOrderFiscalTaxesStatus,
} from "./salesOrderFiscalTaxesContract.js";
import {
  emptySalesOrderFiscalSettlementsBlock,
  type SalesOrderFiscalTaxesPayload,
} from "./salesOrderFiscalTaxesClient.js";
import {
  canViewSalesOrderFiscalTaxesFromAuth,
  canViewSalesOrderFiscalTaxesFromPermissions,
} from "./salesOrderFiscalTaxesPermissions.js";

function emptySettlementPrismaExtras() {
  return {
    fiscalAllocation: { findMany: async () => [] },
    fiscalPaymentGuide: { findMany: async () => [] },
    fiscalSettlementAuditLog: { findMany: async () => [] },
    nomusAccountsPayable: { findMany: async () => [] },
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
    nfes: [
      {
        nfeExternalId: 9001,
        nomusNfeId: null,
        numero: "123",
        serie: "1",
        chave: null,
        dataEmissao: null,
        dataProcessamento: null,
        status: 100,
        statusRaw: "100",
        statusNormalized: "AUTHORIZED",
        statusLabel: "Autorizada",
        isCanceled: false,
        isValidForBilling: true,
        valorTotal: PD_02457_FISCAL.vNF,
        valorLiquido: PD_02457_FISCAL.productsNet,
        highlightedTaxesValue: null,
        linkOrigin: "SALES_ORDER_NFE_LINK",
      } as OrderFullAuditPayload["nfes"][number],
    ],
    nfeItems: [],
    stockDocuments: [],
    alerts: [],
    technicalAudit: { sourceTables: [] },
    marginPricing: { itemMargins: [] },
    ...overrides,
  } as OrderFullAuditPayload;
}

function skeletonPayload(
  overrides: Partial<SalesOrderFiscalTaxesPayload> = {}
): Omit<
  SalesOrderFiscalTaxesPayload,
  "status" | "statusReason" | "warnings" | "linkOrigins"
> {
  return {
    summary: {
      orderActiveValue: 100,
      productsValue: 0,
      discountsValue: 0,
      freightValue: 0,
      insuranceValue: 0,
      otherExpensesValue: 0,
      nfeValidTotal: 0,
      amountToInvoice: 100,
      financialBalance: null,
      financialBalanceLabel: "Sem CR gerado",
      validNfeCount: 0,
      cancelledNfeCount: 0,
      compositionIncomplete: false,
      compositionIncompleteReason: null,
      sourceLabel: "XML NF-e",
      lastParsedAt: null,
      parserVersion: null,
    },
    highlightedTaxes: [],
    nfes: [],
    cancelledNfes: [],
    itemTaxLines: [],
    settlements: emptySalesOrderFiscalSettlementsBlock("2026-07-16T00:00:00.000Z"),
    technical: {
      source: "test",
      note: "test",
      doNotSumHeaderAndItem: true,
    },
    ...overrides,
  };
}

describe("TRIB-05 — resolveSalesOrderFiscalTaxesStatus", () => {
  it("unavailable quando não há NF válida", () => {
    const r = resolveSalesOrderFiscalTaxesStatus({ validNfeCount: 0 });
    assert.equal(r.status, "unavailable");
    assert.match(r.statusReason ?? "", /Nenhuma NF-e válida/);
  });

  it("unavailable com NF cancelada só em auditoria", () => {
    const r = resolveSalesOrderFiscalTaxesStatus({
      validNfeCount: 0,
      cancelledNfeCount: 1,
    });
    assert.equal(r.status, "unavailable");
    assert.match(r.statusReason ?? "", /cancelada/);
  });

  it("available com NF válida e composição completa", () => {
    const r = resolveSalesOrderFiscalTaxesStatus({
      validNfeCount: 1,
      validNfeSources: ["FISCAL_SUMMARY"],
      compositionIncomplete: false,
    });
    assert.equal(r.status, "available");
    assert.equal(r.statusReason, null);
    assert.equal(r.warnings.length, 0);
  });

  it("partial quando campo/composição fiscal incompleta — não vazio", () => {
    const r = resolveSalesOrderFiscalTaxesStatus({
      validNfeCount: 1,
      compositionIncomplete: true,
      validNfeSources: ["FISCAL_SUMMARY"],
    });
    assert.equal(r.status, "partial");
    assert.ok(r.warnings.length > 0);
  });

  it("partial com source MISSING ou HEADER_DIFF", () => {
    assert.equal(
      resolveSalesOrderFiscalTaxesStatus({
        validNfeCount: 1,
        validNfeSources: ["MISSING"],
      }).status,
      "partial"
    );
    assert.equal(
      resolveSalesOrderFiscalTaxesStatus({
        validNfeCount: 2,
        validNfeSources: ["FISCAL_SUMMARY", "HEADER_DIFF"],
      }).status,
      "partial"
    );
  });
});

describe("TRIB-05 — attach + error payload", () => {
  it("attach preenche status/warnings/linkOrigins sem anular o payload", () => {
    const attached = attachSalesOrderFiscalTaxesContract(
      skeletonPayload({
        summary: {
          ...skeletonPayload().summary,
          validNfeCount: 1,
          nfeValidTotal: 50,
        },
        nfes: [
          {
            nomusNfeId: "n1",
            nfeExternalId: 1,
            numero: "10",
            serie: "1",
            chave: null,
            emissionDate: null,
            status: 100,
            statusLabel: "Autorizada",
            isCancelled: false,
            isValidForTotals: true,
            finalidade: 1,
            productsValue: 50,
            discountsValue: 0,
            freightValue: null,
            insuranceValue: null,
            otherExpensesValue: null,
            taxesTotalHeader: 5,
            highlightedTaxesFallback: null,
            totalValue: 50,
            compositionIncomplete: false,
            source: "FISCAL_SUMMARY",
            parsedAt: null,
            parserVersion: null,
            linkOrigin: "ORDER_TO_CASH",
            linkOrigins: ["ORDER_TO_CASH"],
            headerTaxes: [{ taxType: "IPI", label: "IPI", amount: 5 }],
            itemTaxLines: [],
          },
        ],
        highlightedTaxes: [{ taxType: "IPI", label: "IPI", amount: 5 }],
      })
    );
    assert.equal(attached.status, "available");
    assert.ok(attached.linkOrigins.length >= 1);
    assert.equal(attached.highlightedTaxes[0]!.amount, 5);
    assert.equal(attached.nfes[0]!.freightValue, null);
  });

  it("campo tributário individual ausente não vira payload vazio", () => {
    const attached = attachSalesOrderFiscalTaxesContract(
      skeletonPayload({
        summary: {
          ...skeletonPayload().summary,
          validNfeCount: 1,
          nfeValidTotal: 100,
        },
        nfes: [
          {
            nomusNfeId: null,
            nfeExternalId: 7,
            numero: "7",
            serie: null,
            chave: null,
            emissionDate: null,
            status: 100,
            statusLabel: "Autorizada",
            isCancelled: false,
            isValidForTotals: true,
            finalidade: null,
            productsValue: 100,
            discountsValue: null,
            freightValue: null,
            insuranceValue: null,
            otherExpensesValue: null,
            taxesTotalHeader: null,
            highlightedTaxesFallback: null,
            totalValue: 100,
            compositionIncomplete: false,
            source: "FISCAL_SUMMARY",
            parsedAt: null,
            parserVersion: null,
            headerTaxes: [{ taxType: "ICMS", label: "ICMS", amount: 10 }],
            itemTaxLines: [],
          },
        ],
        highlightedTaxes: [{ taxType: "ICMS", label: "ICMS", amount: 10 }],
      })
    );
    assert.equal(attached.status, "available");
    assert.notEqual(attached, null);
    assert.equal(attached.nfes.length, 1);
    assert.equal(attached.highlightedTaxes.length, 1);
  });

  it("error payload é status error, não null", () => {
    const err = buildSalesOrderFiscalTaxesErrorPayload("boom", {
      orderActiveValue: 42,
    });
    assert.equal(err.status, "error");
    assert.equal(err.statusReason, "boom");
    assert.equal(err.summary.orderActiveValue, 42);
    assert.equal(err.nfes.length, 0);
    assert.ok(Array.isArray(err.warnings));
  });

  it("buildSalesOrderFiscalNfeLinkOrigins deduplica origens", () => {
    const origins = buildSalesOrderFiscalNfeLinkOrigins([
      {
        nfeExternalId: 1,
        numero: "1",
        linkOrigin: "ITEM_REF",
        linkOrigins: ["SALES_ORDER_NFE_LINK", "ITEM_REF"],
      },
      { nfeExternalId: 1, numero: "1", linkOrigin: "STOCK_DOCUMENT" },
    ]);
    assert.equal(origins.length, 1);
    assert.ok(origins[0]!.origins.includes("ITEM_REF"));
    assert.ok(origins[0]!.origins.includes("STOCK_DOCUMENT"));
  });
});

describe("TRIB-05 — autorização oficial da aba Tributos", () => {
  it("SUPER_ADMIN e effectivePermissions liberam; bag sales_orders sem invoice/detail nega", () => {
    assert.equal(
      canViewSalesOrderFiscalTaxesFromAuth({ role: "SUPER_ADMIN" }),
      true
    );
    assert.equal(
      canViewSalesOrderFiscalTaxesFromAuth({
        role: "USER",
        permissions: ["sales_orders.view"],
        effectivePermissions: ["sales_orders.invoice.view"],
      }),
      true
    );
    assert.equal(
      canViewSalesOrderFiscalTaxesFromAuth({
        role: "USER",
        permissions: ["sales_orders.view"],
        effectivePermissions: ["sales_orders.view"],
      }),
      false
    );
    assert.equal(
      canViewSalesOrderFiscalTaxesFromPermissions(["sales_orders.view"]),
      false
    );
    assert.equal(
      canViewSalesOrderFiscalTaxesFromPermissions([
        "sales_orders.detail.view",
      ]),
      true
    );
  });

  it("detail route passa effectivePermissions + role ao userContext", () => {
    const routes = readFileSync(
      new URL("../salesOrderDetailRoutes.ts", import.meta.url),
      "utf8"
    );
    assert.match(routes, /effectivePermissions:\s*appAuth\.effectivePermissions/);
    assert.match(routes, /role:\s*appAuth\.role/);
    const service = readFileSync(
      new URL("./salesOrderDetailService.server.ts", import.meta.url),
      "utf8"
    );
    assert.match(service, /canViewSalesOrderFiscalTaxesFromAuth/);
    assert.match(service, /fiscalTaxesAccess/);
    assert.match(service, /buildSalesOrderFiscalTaxesErrorPayload/);
  });
});

describe("TRIB-05 — builder: unavailable / partial / available / cancelada", () => {
  it("pedido sem NF → unavailable (não erro)", async () => {
    const payload = await buildSalesOrderFiscalTaxesPayload(
      {
        nomusNfe: { findMany: async () => [] },
        ...emptySettlementPrismaExtras(),
      } as never,
      baseAudit({
        nfes: [],
        summary: { ...baseAudit().summary, activeOrderValue: 500 },
      })
    );
    assert.equal(payload.status, "unavailable");
    assert.equal(payload.nfes.length, 0);
    assert.equal(payload.summary.amountToInvoice, 500);
    assert.ok(payload.statusReason);
  });

  it("NF válida com fiscal summary → available + resumo/tributos/origens", async () => {
    const payload = await buildSalesOrderFiscalTaxesPayload(
      {
        nomusNfe: {
          findMany: async () => [
            {
              id: "nfe-1",
              externalId: 9001,
              fiscalSummary: {
                id: "sum-1",
                finalidade: 1,
                vProd: PD_02457_FISCAL.productsNet,
                vDesc: 0,
                vFrete: 0,
                vSeg: 0,
                vOutro: 0,
                vNF: PD_02457_FISCAL.vNF,
                vICMS: null,
                vICMSDeson: null,
                vST: null,
                vFCP: null,
                vFCPST: null,
                vFCPSTRet: null,
                vIPI: PD_02457_FISCAL.ipi,
                vIPIDevol: null,
                vPIS: null,
                vCOFINS: null,
                vII: null,
                vISS: null,
                vBC: PD_02457_FISCAL.productsNet,
                vBCST: null,
                highlightedResidual: 0,
                parsedAt: new Date("2026-01-01T00:00:00.000Z"),
                parserVersion: "test",
                source: "XML",
                qualityAlert: null,
                taxLines: [
                  {
                    lineKey: "H:IPI",
                    taxType: "IPI",
                    scope: "HEADER",
                    itemNumber: null,
                    baseAmount: null,
                    rate: null,
                    amount: PD_02457_FISCAL.ipi,
                    cst: null,
                    csosn: null,
                    cfop: null,
                    ncm: null,
                    metadata: null,
                  },
                ],
              },
            },
          ],
        },
        ...emptySettlementPrismaExtras(),
      } as never,
      baseAudit()
    );
    assert.equal(payload.status, "available");
    assert.equal(payload.nfes.length, 1);
    assert.ok(payload.highlightedTaxes.length > 0);
    assert.ok(payload.linkOrigins.some((o) => o.nfeExternalId === 9001));
    assert.equal(payload.cancelledNfes.length, 0);
  });

  it("NF sem summary fiscal → partial (não empty)", async () => {
    const payload = await buildSalesOrderFiscalTaxesPayload(
      {
        nomusNfe: {
          findMany: async () => [{ id: "nfe-1", externalId: 9001, fiscalSummary: null }],
        },
        ...emptySettlementPrismaExtras(),
      } as never,
      baseAudit()
    );
    assert.equal(payload.status, "partial");
    assert.equal(payload.nfes.length, 1);
    assert.ok(
      payload.nfes[0]!.source === "HEADER_DIFF" ||
        payload.nfes[0]!.source === "MISSING"
    );
    assert.ok(payload.warnings.length > 0);
  });

  it("NF cancelada fica só em cancelledNfes; totais ignoram", async () => {
    const nfeBase = baseAudit().nfes[0]!;
    const payload = await buildSalesOrderFiscalTaxesPayload(
      {
        nomusNfe: {
          findMany: async () => [
            {
              id: "nfe-ok",
              externalId: 1,
              fiscalSummary: {
                id: "s1",
                finalidade: 1,
                vProd: 50,
                vDesc: 0,
                vFrete: 0,
                vSeg: 0,
                vOutro: 0,
                vNF: 50,
                vICMS: null,
                vICMSDeson: null,
                vST: null,
                vFCP: null,
                vFCPST: null,
                vFCPSTRet: null,
                vIPI: null,
                vIPIDevol: null,
                vPIS: null,
                vCOFINS: null,
                vII: null,
                vISS: null,
                vBC: 50,
                vBCST: null,
                highlightedResidual: 0,
                parsedAt: new Date(),
                parserVersion: "t",
                source: "XML",
                qualityAlert: null,
                taxLines: [],
              },
            },
            {
              id: "nfe-cancel",
              externalId: 2,
              fiscalSummary: {
                id: "s2",
                finalidade: 1,
                vProd: 999,
                vDesc: 0,
                vFrete: 0,
                vSeg: 0,
                vOutro: 0,
                vNF: 999,
                vICMS: 0,
                vICMSDeson: null,
                vST: null,
                vFCP: null,
                vFCPST: null,
                vFCPSTRet: null,
                vIPI: 80,
                vIPIDevol: null,
                vPIS: null,
                vCOFINS: null,
                vII: null,
                vISS: null,
                vBC: 999,
                vBCST: null,
                highlightedResidual: 0,
                parsedAt: new Date(),
                parserVersion: "t",
                source: "XML",
                qualityAlert: null,
                taxLines: [
                  {
                    lineKey: "H:IPI",
                    taxType: "IPI",
                    scope: "HEADER",
                    itemNumber: null,
                    baseAmount: null,
                    rate: null,
                    amount: 80,
                    cst: null,
                    csosn: null,
                    cfop: null,
                    ncm: null,
                    metadata: null,
                  },
                ],
              },
            },
          ],
        },
        ...emptySettlementPrismaExtras(),
      } as never,
      baseAudit({
        nfes: [
          {
            ...nfeBase,
            nfeExternalId: 1,
            isCanceled: false,
            isValidForBilling: true,
            valorTotal: 50,
            valorLiquido: 50,
            highlightedTaxesValue: null,
            linkOrigin: "STOCK_DOCUMENT",
          },
          {
            ...nfeBase,
            nfeExternalId: 2,
            isCanceled: true,
            isValidForBilling: false,
            valorTotal: 999,
            valorLiquido: 999,
            highlightedTaxesValue: 80,
            statusLabel: "Cancelada",
            linkOrigin: "ITEM_REF",
          },
        ],
        summary: { ...baseAudit().summary, activeOrderValue: 50 },
      })
    );
    assert.equal(payload.status, "available");
    assert.equal(payload.nfes.length, 1);
    assert.equal(payload.cancelledNfes.length, 1);
    assert.equal(payload.summary.nfeValidTotal, 50);
    assert.equal(
      payload.highlightedTaxes.find((t) => t.taxType === "IPI"),
      undefined
    );
    assert.ok(
      payload.cancelledNfes[0]!.headerTaxes.some((t) => t.taxType === "IPI")
    );
    assert.ok(payload.linkOrigins.some((o) => o.nfeExternalId === 2));
  });

  it("somente NF cancelada → unavailable com bloco de auditoria", async () => {
    const nfeBase = baseAudit().nfes[0]!;
    const payload = await buildSalesOrderFiscalTaxesPayload(
      {
        nomusNfe: {
          findMany: async () => [
            {
              id: "nfe-cancel",
              externalId: 2,
              fiscalSummary: {
                id: "s2",
                finalidade: 1,
                vProd: 10,
                vDesc: 0,
                vFrete: 0,
                vSeg: 0,
                vOutro: 0,
                vNF: 10,
                vICMS: null,
                vICMSDeson: null,
                vST: null,
                vFCP: null,
                vFCPST: null,
                vFCPSTRet: null,
                vIPI: null,
                vIPIDevol: null,
                vPIS: null,
                vCOFINS: null,
                vII: null,
                vISS: null,
                vBC: null,
                vBCST: null,
                highlightedResidual: 0,
                parsedAt: new Date(),
                parserVersion: "t",
                source: "XML",
                qualityAlert: null,
                taxLines: [],
              },
            },
          ],
        },
        ...emptySettlementPrismaExtras(),
      } as never,
      baseAudit({
        nfes: [
          {
            ...nfeBase,
            nfeExternalId: 2,
            isCanceled: true,
            isValidForBilling: false,
            valorTotal: 10,
            valorLiquido: 10,
            statusLabel: "Cancelada",
          },
        ],
        summary: { ...baseAudit().summary, activeOrderValue: 10 },
      })
    );
    assert.equal(payload.status, "unavailable");
    assert.equal(payload.nfes.length, 0);
    assert.equal(payload.cancelledNfes.length, 1);
    assert.match(payload.statusReason ?? "", /cancelada/i);
  });
});
