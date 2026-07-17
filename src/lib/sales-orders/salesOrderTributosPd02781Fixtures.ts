/**
 * TRIB-08 — Fixtures sintéticas equivalentes ao PD 02781 (release candidate).
 *
 * Não usam dados reais de produção. Validação do PD 02781 no servidor
 * permanece via `npm run audit:sales-order:taxes -- --order=PD02781`.
 */

import type { SalesOrderRelatedNfeResolveInput } from "./salesOrderRelatedNfeResolver.js";
import type { SalesOrderTaxesAuditInput } from "./salesOrderTaxesAudit.js";

export const PD_02781_FIXTURE_ORDER = {
  id: "00000000-0000-4000-8000-000000000781",
  orderCode: "PD 02781",
  externalSalesOrderId: 2781,
  externalSalesOrderCode: "PD02781",
  activeOrderValue: 115,
} as const;

export const PD_02781_NFE_VALID = {
  externalId: 27810,
  numero: "2781",
  serie: "1",
  chave: "35260700000000000000550010000027811000027810",
  status: 100,
  productsNet: 100,
  freight: 10,
  ipi: 5,
  icms: 18,
  pis: 1.65,
  cofins: 7.6,
  vNF: 115,
} as const;

export const PD_02781_NFE_PARTIAL = {
  externalId: 27811,
  numero: "27811",
  serie: "1",
  chave: null as string | null,
  status: 100,
  productsNet: 50,
  vNF: 50,
} as const;

export const PD_02781_NFE_CANCELLED = {
  externalId: 27812,
  numero: "27812",
  serie: "1",
  chave: "35260700000000000000550010000027812000027812",
  status: 7,
  productsNet: 999,
  ipi: 80,
  vNF: 999,
} as const;

export type Pd02781ScenarioId =
  | "directLink"
  | "stockDocumentOnly"
  | "o2cOnly"
  | "validNfWithTaxes"
  | "partialNf"
  | "cancelledNf"
  | "orderWithoutNf";

export type Pd02781Scenario = {
  id: Pd02781ScenarioId;
  label: string;
  resolveInput: SalesOrderRelatedNfeResolveInput;
  auditInput: SalesOrderTaxesAuditInput;
  expected: {
    uniqueNfes: number;
    validNfes: number;
    cancelledNfes: number;
    primaryOrigin?: string;
    status: "available" | "unavailable" | "partial";
    hasIpi?: boolean;
  };
};

function emptyAuditBase(
  overrides: Partial<SalesOrderTaxesAuditInput> = {}
): SalesOrderTaxesAuditInput {
  return {
    requestedOrder: "PD02781",
    order: {
      id: PD_02781_FIXTURE_ORDER.id,
      orderCode: PD_02781_FIXTURE_ORDER.orderCode,
      externalSalesOrderId: PD_02781_FIXTURE_ORDER.externalSalesOrderId,
      externalSalesOrderCode: PD_02781_FIXTURE_ORDER.externalSalesOrderCode,
    },
    links: [],
    o2cFacts: [],
    stockDocuments: [],
    items: [],
    foreignLinks: [],
    nfes: [],
    ...overrides,
  };
}

function validNfeRow() {
  return {
    id: "nfe-valid-27810",
    externalId: PD_02781_NFE_VALID.externalId,
    numero: PD_02781_NFE_VALID.numero,
    serie: PD_02781_NFE_VALID.serie,
    chave: PD_02781_NFE_VALID.chave,
    status: PD_02781_NFE_VALID.status,
    fiscalSummary: {
      source: "XML",
      parserVersion: "trib-08-fixture",
      parsedAt: "2026-07-16T00:00:00.000Z",
      isCancelled: false,
      finalidade: 1,
      vProd: PD_02781_NFE_VALID.productsNet,
      vDesc: 0,
      vFrete: PD_02781_NFE_VALID.freight,
      vSeg: 0,
      vOutro: 0,
      vII: null,
      vIPI: PD_02781_NFE_VALID.ipi,
      vIPIDevol: null,
      vBC: PD_02781_NFE_VALID.productsNet,
      vICMS: PD_02781_NFE_VALID.icms,
      vICMSDeson: null,
      vBCST: null,
      vST: null,
      vFCP: null,
      vFCPST: null,
      vFCPSTRet: null,
      vPIS: PD_02781_NFE_VALID.pis,
      vCOFINS: PD_02781_NFE_VALID.cofins,
      vISS: null,
      vTotTrib: null,
      vNF: PD_02781_NFE_VALID.vNF,
      highlightedResidual: 0,
      qualityAlert: null,
      taxLines: [
        {
          taxType: "IPI",
          scope: "HEADER",
          amount: PD_02781_NFE_VALID.ipi,
          baseAmount: null,
          rate: null,
        },
        {
          taxType: "ICMS",
          scope: "HEADER",
          amount: PD_02781_NFE_VALID.icms,
          baseAmount: PD_02781_NFE_VALID.productsNet,
          rate: null,
        },
        {
          taxType: "PIS",
          scope: "HEADER",
          amount: PD_02781_NFE_VALID.pis,
          baseAmount: null,
          rate: null,
        },
        {
          taxType: "COFINS",
          scope: "HEADER",
          amount: PD_02781_NFE_VALID.cofins,
          baseAmount: null,
          rate: null,
        },
      ],
    },
  };
}

export const PD_02781_SCENARIOS: Record<Pd02781ScenarioId, Pd02781Scenario> = {
  directLink: {
    id: "directLink",
    label: "Vínculo direto SalesOrderNfeLink",
    resolveInput: {
      salesOrderId: PD_02781_FIXTURE_ORDER.id,
      links: [
        {
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          nfeNumber: PD_02781_NFE_VALID.numero,
          nfeKey: PD_02781_NFE_VALID.chave,
          nfeStatus: PD_02781_NFE_VALID.status,
          linkId: "link-direct",
        },
      ],
      nfeStatusHints: [
        {
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          status: PD_02781_NFE_VALID.status,
        },
      ],
    },
    auditInput: emptyAuditBase({
      links: [
        {
          id: "link-direct",
          salesOrderId: PD_02781_FIXTURE_ORDER.id,
          orderCode: PD_02781_FIXTURE_ORDER.orderCode,
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          nfeNumber: PD_02781_NFE_VALID.numero,
          nfeKey: PD_02781_NFE_VALID.chave,
          nfeStatus: PD_02781_NFE_VALID.status,
          presentInLastPayload: true,
        },
      ],
      nfes: [validNfeRow()],
    }),
    expected: {
      uniqueNfes: 1,
      validNfes: 1,
      cancelledNfes: 0,
      primaryOrigin: "SALES_ORDER_NFE_LINK",
      status: "available",
      hasIpi: true,
    },
  },

  stockDocumentOnly: {
    id: "stockDocumentOnly",
    label: "Vínculo somente por Documento de Saída",
    resolveInput: {
      salesOrderId: PD_02781_FIXTURE_ORDER.id,
      o2cFacts: [
        {
          stockDocumentExternalId: 7001,
          stockDocumentIdNfe: PD_02781_NFE_VALID.externalId,
          nfeExternalId: null,
        },
      ],
      stockDocuments: [
        {
          stockDocumentExternalId: 7001,
          idNfe: PD_02781_NFE_VALID.externalId,
        },
      ],
      nfeStatusHints: [
        {
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          status: PD_02781_NFE_VALID.status,
        },
      ],
    },
    auditInput: emptyAuditBase({
      o2cFacts: [
        {
          nfeExternalId: null,
          nfeNumber: null,
          nfeKey: null,
          stockDocumentExternalId: 7001,
          stockDocumentIdNfe: PD_02781_NFE_VALID.externalId,
          stockDocumentType: "DOCUMENTO_SAIDA",
          stockDocumentDate: "2026-07-01T00:00:00.000Z",
          salesOrderItemId: null,
          nfeItemMatchedOrderItem: false,
        },
      ],
      stockDocuments: [
        {
          id: "doc-7001",
          externalId: 7001,
          idNfe: PD_02781_NFE_VALID.externalId,
          tipoDocumentoEstoque: "DOCUMENTO_SAIDA",
          dataDocumento: "2026-07-01T00:00:00.000Z",
        },
      ],
      nfes: [validNfeRow()],
    }),
    expected: {
      uniqueNfes: 1,
      validNfes: 1,
      cancelledNfes: 0,
      primaryOrigin: "STOCK_DOCUMENT",
      status: "available",
      hasIpi: true,
    },
  },

  o2cOnly: {
    id: "o2cOnly",
    label: "Vínculo somente pelo Order-to-Cash",
    resolveInput: {
      salesOrderId: PD_02781_FIXTURE_ORDER.id,
      o2cFacts: [
        {
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          nfeNumber: PD_02781_NFE_VALID.numero,
        },
      ],
      nfeStatusHints: [
        {
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          status: PD_02781_NFE_VALID.status,
        },
      ],
    },
    auditInput: emptyAuditBase({
      o2cFacts: [
        {
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          nfeNumber: PD_02781_NFE_VALID.numero,
          nfeKey: PD_02781_NFE_VALID.chave,
          stockDocumentExternalId: null,
          stockDocumentIdNfe: null,
          stockDocumentType: null,
          stockDocumentDate: null,
          salesOrderItemId: null,
          nfeItemMatchedOrderItem: false,
        },
      ],
      nfes: [validNfeRow()],
    }),
    expected: {
      uniqueNfes: 1,
      validNfes: 1,
      cancelledNfes: 0,
      primaryOrigin: "ORDER_TO_CASH",
      status: "available",
      hasIpi: true,
    },
  },

  validNfWithTaxes: {
    id: "validNfWithTaxes",
    label: "NF válida com tributos documentais",
    resolveInput: {
      salesOrderId: PD_02781_FIXTURE_ORDER.id,
      links: [
        {
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          nfeNumber: PD_02781_NFE_VALID.numero,
          linkId: "link-taxes",
        },
      ],
      nfeStatusHints: [
        {
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          status: PD_02781_NFE_VALID.status,
        },
      ],
    },
    auditInput: emptyAuditBase({
      links: [
        {
          id: "link-taxes",
          salesOrderId: PD_02781_FIXTURE_ORDER.id,
          orderCode: PD_02781_FIXTURE_ORDER.orderCode,
          nfeExternalId: PD_02781_NFE_VALID.externalId,
          nfeNumber: PD_02781_NFE_VALID.numero,
          nfeKey: PD_02781_NFE_VALID.chave,
          nfeStatus: PD_02781_NFE_VALID.status,
          presentInLastPayload: true,
        },
      ],
      nfes: [validNfeRow()],
    }),
    expected: {
      uniqueNfes: 1,
      validNfes: 1,
      cancelledNfes: 0,
      primaryOrigin: "SALES_ORDER_NFE_LINK",
      status: "available",
      hasIpi: true,
    },
  },

  partialNf: {
    id: "partialNf",
    label: "NF parcialmente preenchida (sem summary fiscal)",
    resolveInput: {
      salesOrderId: PD_02781_FIXTURE_ORDER.id,
      links: [
        {
          nfeExternalId: PD_02781_NFE_PARTIAL.externalId,
          nfeNumber: PD_02781_NFE_PARTIAL.numero,
          linkId: "link-partial",
        },
      ],
      nfeStatusHints: [
        {
          nfeExternalId: PD_02781_NFE_PARTIAL.externalId,
          status: PD_02781_NFE_PARTIAL.status,
        },
      ],
    },
    auditInput: emptyAuditBase({
      links: [
        {
          id: "link-partial",
          salesOrderId: PD_02781_FIXTURE_ORDER.id,
          orderCode: PD_02781_FIXTURE_ORDER.orderCode,
          nfeExternalId: PD_02781_NFE_PARTIAL.externalId,
          nfeNumber: PD_02781_NFE_PARTIAL.numero,
          nfeKey: null,
          nfeStatus: PD_02781_NFE_PARTIAL.status,
          presentInLastPayload: true,
        },
      ],
      nfes: [
        {
          id: "nfe-partial-27811",
          externalId: PD_02781_NFE_PARTIAL.externalId,
          numero: PD_02781_NFE_PARTIAL.numero,
          serie: PD_02781_NFE_PARTIAL.serie,
          chave: null,
          status: PD_02781_NFE_PARTIAL.status,
          fiscalSummary: null,
        },
      ],
    }),
    expected: {
      uniqueNfes: 1,
      validNfes: 1,
      cancelledNfes: 0,
      primaryOrigin: "SALES_ORDER_NFE_LINK",
      status: "partial",
      hasIpi: false,
    },
  },

  cancelledNf: {
    id: "cancelledNf",
    label: "NF cancelada (auditoria, fora dos totais)",
    resolveInput: {
      salesOrderId: PD_02781_FIXTURE_ORDER.id,
      links: [
        {
          nfeExternalId: PD_02781_NFE_CANCELLED.externalId,
          nfeNumber: PD_02781_NFE_CANCELLED.numero,
          nfeStatus: PD_02781_NFE_CANCELLED.status,
          linkId: "link-cancel",
        },
      ],
      nfeStatusHints: [
        {
          nfeExternalId: PD_02781_NFE_CANCELLED.externalId,
          status: PD_02781_NFE_CANCELLED.status,
        },
      ],
    },
    auditInput: emptyAuditBase({
      links: [
        {
          id: "link-cancel",
          salesOrderId: PD_02781_FIXTURE_ORDER.id,
          orderCode: PD_02781_FIXTURE_ORDER.orderCode,
          nfeExternalId: PD_02781_NFE_CANCELLED.externalId,
          nfeNumber: PD_02781_NFE_CANCELLED.numero,
          nfeKey: PD_02781_NFE_CANCELLED.chave,
          nfeStatus: PD_02781_NFE_CANCELLED.status,
          presentInLastPayload: true,
        },
      ],
      nfes: [
        {
          id: "nfe-cancel-27812",
          externalId: PD_02781_NFE_CANCELLED.externalId,
          numero: PD_02781_NFE_CANCELLED.numero,
          serie: PD_02781_NFE_CANCELLED.serie,
          chave: PD_02781_NFE_CANCELLED.chave,
          status: PD_02781_NFE_CANCELLED.status,
          fiscalSummary: {
            source: "XML",
            parserVersion: "trib-08-fixture",
            parsedAt: "2026-07-16T00:00:00.000Z",
            isCancelled: true,
            finalidade: 1,
            vProd: PD_02781_NFE_CANCELLED.productsNet,
            vDesc: 0,
            vFrete: 0,
            vSeg: 0,
            vOutro: 0,
            vII: null,
            vIPI: PD_02781_NFE_CANCELLED.ipi,
            vIPIDevol: null,
            vBC: null,
            vICMS: null,
            vICMSDeson: null,
            vBCST: null,
            vST: null,
            vFCP: null,
            vFCPST: null,
            vFCPSTRet: null,
            vPIS: null,
            vCOFINS: null,
            vISS: null,
            vTotTrib: null,
            vNF: PD_02781_NFE_CANCELLED.vNF,
            highlightedResidual: 0,
            qualityAlert: null,
            taxLines: [
              {
                taxType: "IPI",
                scope: "HEADER",
                amount: PD_02781_NFE_CANCELLED.ipi,
                baseAmount: null,
                rate: null,
              },
            ],
          },
        },
      ],
    }),
    expected: {
      uniqueNfes: 1,
      validNfes: 0,
      cancelledNfes: 1,
      primaryOrigin: "SALES_ORDER_NFE_LINK",
      status: "unavailable",
      hasIpi: false,
    },
  },

  orderWithoutNf: {
    id: "orderWithoutNf",
    label: "Pedido sem NF",
    resolveInput: {
      salesOrderId: PD_02781_FIXTURE_ORDER.id,
      links: [],
      o2cFacts: [],
      stockDocuments: [],
      itemRefs: [],
    },
    auditInput: emptyAuditBase(),
    expected: {
      uniqueNfes: 0,
      validNfes: 0,
      cancelledNfes: 0,
      status: "unavailable",
      hasIpi: false,
    },
  },
};

export const PD_02781_SCENARIO_IDS = Object.keys(
  PD_02781_SCENARIOS
) as Pd02781ScenarioId[];
