import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapCommissionReceiptSellerToLineFields,
  resolveCommissionReceiptSeller,
} from "./commissionReceiptSeller.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";
import { buildCommissionReceiptPreview } from "./commissionReceiptEngine.js";
import type { CommissionOrderItemSource, CommissionOrderSourceBundle } from "./commission-types.js";
import { NOMUS_NFE_STATUS_AUTHORIZED } from "@/src/lib/nomusNfeClassification.js";
import { buildReceiptClosingBySeller } from "./commissionReceiptClosingApi.js";
import { RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY } from "./commissionReceiptClosingApi.shared.js";
import { resolveReceiptClosingSellerGroupKey } from "./commissionReceiptClosingApi.shared.js";

const OK_IDENTITY: CommissionSellerIdentityContext = {
  persons: [
    {
      id: "person-gislene",
      nomusPersonId: 464,
      name: "GISLENE LIMA",
      type: "SELLER",
      source: "NOMUS",
      active: true,
      linkedRecordCount: 1,
    },
    {
      id: "person-rodrigo",
      nomusPersonId: 512,
      name: "RODRIGO SILVA",
      type: "SELLER",
      source: "NOMUS",
      active: true,
      linkedRecordCount: 1,
    },
  ],
  aliases: [],
};

describe("resolveCommissionReceiptSeller", () => {
  it("1 — schedule com vendedor canônico", () => {
    const r = resolveCommissionReceiptSeller({
      schedule: {
        canonicalSellerId: "person-gislene",
        canonicalSellerName: "GISLENE LIMA",
        rawSellerId: 464,
      },
    });
    assert.equal(r.sellerResolutionStatus, "RESOLVED_FROM_SCHEDULE");
    assert.equal(r.canonicalSellerId, "person-gislene");
    assert.equal(r.canonicalSellerName, "GISLENE LIMA");
  });

  it("2 — sem schedule e sem SalesOrder, com CommissionRecord", () => {
    const r = resolveCommissionReceiptSeller({
      commissionRecord: {
        commissionPersonId: "person-rodrigo",
        commissionPersonName: "RODRIGO SILVA",
        nomusSellerId: 512,
      },
    });
    assert.equal(r.sellerResolutionStatus, "RESOLVED_FROM_COMMISSION_RECORD");
    assert.equal(r.canonicalSellerId, "person-rodrigo");
    assert.equal(r.canonicalSellerName, "RODRIGO SILVA");
    assert.equal(r.rawSellerId, 512);
  });

  it("2b — SalesOrder sem vendedor ignora CommissionRecord materializado", () => {
    const r = resolveCommissionReceiptSeller({
      commissionRecord: {
        commissionPersonId: "person-eduardo",
        commissionPersonName: "JOSE EDUARDO CARDOSO DOS SANTOS",
        nomusSellerId: 1189,
      },
      salesOrder: { externalSellerId: null },
      identityCtx: OK_IDENTITY,
    });
    assert.equal(r.sellerResolutionStatus, "NO_SELLER");
    assert.equal(r.rawSellerId, null);
    assert.equal(r.canonicalSellerName, "Sem vendedor no pedido Nomus");
    assert.equal(r.canonicalSellerId, null);
  });

  it("2c — SalesOrder com vendedor prevalece sobre CommissionRecord divergente", () => {
    const r = resolveCommissionReceiptSeller({
      commissionRecord: {
        commissionPersonId: "person-rodrigo",
        commissionPersonName: "RODRIGO SILVA",
        nomusSellerId: 512,
      },
      salesOrder: { externalSellerId: 464, issueDate: new Date("2026-06-01") },
      identityCtx: OK_IDENTITY,
    });
    assert.equal(r.sellerResolutionStatus, "RESOLVED_FROM_SALES_ORDER");
    assert.equal(r.canonicalSellerId, "person-gislene");
    assert.equal(r.canonicalSellerName, "GISLENE LIMA");
  });

  it("2d — schedule ignorado quando SalesOrder vinculado sem vendedor", () => {
    const r = resolveCommissionReceiptSeller({
      schedule: {
        canonicalSellerId: "person-eduardo",
        canonicalSellerName: "JOSE EDUARDO CARDOSO DOS SANTOS",
        rawSellerId: 1189,
      },
      salesOrder: { externalSellerId: null },
      identityCtx: OK_IDENTITY,
    });
    assert.equal(r.sellerResolutionStatus, "NO_SELLER");
    assert.equal(r.canonicalSellerId, null);
  });

  it("3 — sem schedule/record, SalesOrder.externalSellerId mapeado", () => {
    const r = resolveCommissionReceiptSeller({
      salesOrder: { externalSellerId: 464, issueDate: new Date("2026-06-01") },
      identityCtx: OK_IDENTITY,
    });
    assert.equal(r.sellerResolutionStatus, "RESOLVED_FROM_SALES_ORDER");
    assert.equal(r.canonicalSellerId, "person-gislene");
    assert.equal(r.canonicalSellerName, "GISLENE LIMA");
  });

  it("4 — externalSellerId não mapeado → SELLER_UNRESOLVED", () => {
    const r = resolveCommissionReceiptSeller({
      salesOrder: { externalSellerId: 9999, issueDate: new Date("2026-06-01") },
      identityCtx: OK_IDENTITY,
    });
    assert.equal(r.sellerResolutionStatus, "SELLER_UNRESOLVED");
    assert.match(r.sellerLabel, /9999/);
    assert.equal(r.canonicalSellerId, null);
  });

  it("5 — sem externalSellerId → NO_SELLER", () => {
    const r = resolveCommissionReceiptSeller({
      salesOrder: { externalSellerId: null },
      identityCtx: OK_IDENTITY,
    });
    assert.equal(r.sellerResolutionStatus, "NO_SELLER");
    assert.equal(r.sellerLabel, "Sem vendedor no pedido Nomus");
  });

  it("mapCommissionReceiptSellerToLineFields expõe ID Nomus em raw quando sem nome", () => {
    const fields = mapCommissionReceiptSellerToLineFields(
      resolveCommissionReceiptSeller({
        commissionRecord: {
          commissionPersonId: "person-rodrigo",
          commissionPersonName: "RODRIGO SILVA",
          nomusSellerId: 512,
        },
      })
    );
    assert.equal(fields.rawSellerName, "512");
    assert.equal(fields.canonicalSellerName, "RODRIGO SILVA");
  });
});

describe("NO_SCHEDULE + vendedor no motor de fechamento", () => {
  function item(localItemId: string, itemNetAmount: number): CommissionOrderItemSource {
    return {
      localItemId,
      localProductId: `prod-${localItemId}`,
      nomusOrderItemId: null,
      nomusProductId: null,
      productCode: localItemId,
      productName: localItemId,
      quantity: 1,
      unitPrice: itemNetAmount,
      discount: 0,
      surcharge: 0,
      itemNetAmount,
    };
  }

  function order(overrides: Partial<CommissionOrderSourceBundle> = {}): CommissionOrderSourceBundle {
    const linkedNfe = {
      nfeExternalId: 100,
      nfeNumber: "12345",
      nfeStatus: NOMUS_NFE_STATUS_AUTHORIZED,
      tipoOperacao: 1,
      dataProcessamento: new Date("2026-06-01"),
      nfeValue: 5000,
      isAuthorized: true,
      isCancelled: false,
      isOutputOperation: true,
      nomusNfeLocalId: "nfe-local",
    };
    return {
      localOrderId: "order-1",
      nomusOrderId: 1,
      orderCode: "PED-1",
      issueDate: new Date("2026-06-01"),
      status: "CONFIRMED",
      paymentTerms: null,
      paymentMethod: null,
      companyExternalId: 1,
      customerExternalId: 200,
      customerName: "Cliente",
      seller: { nomusSellerId: 464, responsibleName: null },
      representative: { nomusRepresentativeId: null, name: null },
      items: [item("i1", 5000)],
      forecastInstallments: [],
      linkedNfes: [linkedNfe],
      authorizedOutputNfes: [linkedNfe],
      outputDocumentsByNfeId: new Map(),
      receivablesByNfeId: new Map(),
      ...overrides,
    };
  }

  function receivable(nomusReceivableId: number) {
    return {
      nomusReceivableId,
      receivableNumber: "CR-1",
      installmentNumber: 1,
      settlementDate: new Date("2026-06-15"),
      dueDate: new Date("2026-06-10"),
      amountReceivable: 5000,
      amountReceived: 5000,
      balanceReceivable: 0,
      nomusNfeId: 100,
      nfeNumber: "12345",
      customerExternalId: 200,
      customerId: null,
      customerName: "Cliente",
      cancelled: false,
      suspended: false,
    };
  }

  it("NO_SCHEDULE com SalesOrder prevalece sobre CommissionRecord divergente", () => {
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable(601)],
      ordersByNfeId: new Map([[100, order()]]),
      materializedSchedulesByReceivableId: new Map(),
      commissionRecordsByNfeId: new Map([
        [
          100,
          {
            commissionPersonId: "person-rodrigo",
            commissionPersonName: "RODRIGO SILVA",
            nomusSellerId: 512,
          },
        ],
      ]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });
    assert.equal(result.lines[0]?.status, "NO_SCHEDULE");
    assert.equal(result.lines[0]?.canonicalSellerId, "person-gislene");
    assert.equal(result.lines[0]?.sellerResolutionStatus, "RESOLVED_FROM_SALES_ORDER");

    const key = resolveReceiptClosingSellerGroupKey(result.lines[0]!);
    assert.equal(key, "person-gislene");
    assert.notEqual(key, RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY);
  });

  it("NO_SCHEDULE sem vendedor no pedido Nomus não usa CommissionRecord", () => {
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable(604)],
      ordersByNfeId: new Map([
        [
          100,
          order({
            seller: { nomusSellerId: null, responsibleName: null },
          }),
        ],
      ]),
      materializedSchedulesByReceivableId: new Map(),
      commissionRecordsByNfeId: new Map([
        [
          100,
          {
            commissionPersonId: "person-eduardo",
            commissionPersonName: "JOSE EDUARDO CARDOSO DOS SANTOS",
            nomusSellerId: 1189,
          },
        ],
      ]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });
    assert.equal(result.lines[0]?.status, "NO_SELLER");
    assert.equal(result.lines[0]?.sellerResolutionStatus, "NO_SELLER");
    assert.equal(result.lines[0]?.canonicalSellerId, null);
    assert.equal(result.lines[0]?.canonicalSellerName, "Sem vendedor no pedido Nomus");
    assert.equal(result.lines[0]?.rawSellerId, null);

    const key = resolveReceiptClosingSellerGroupKey(result.lines[0]!);
    assert.equal(key, "no-seller");
  });

  it("NO_SCHEDULE via SalesOrder agrupa no vendedor resolvido", () => {
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable(602)],
      ordersByNfeId: new Map([[100, order()]]),
      materializedSchedulesByReceivableId: new Map(),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });
    assert.equal(result.lines[0]?.status, "NO_SCHEDULE");
    assert.equal(result.lines[0]?.canonicalSellerId, "person-gislene");
    const rows = buildReceiptClosingBySeller(
      result.lines.map((line) => ({
        ...line,
        lineKey: line.ledgerLineKey,
        uniqueReceivedAmount: line.receivedAmount,
        scheduledCommissionAmount: null,
        commissionReceivableScheduleId: line.commissionReceivableScheduleId,
      }))
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sellerId, "person-gislene");
    assert.equal(rows[0]?.exceptionCount, 1);
  });

  it("vendedor resolvido não entra em Sem vendedor / Excluído", () => {
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable(603)],
      ordersByNfeId: new Map([[100, order()]]),
      materializedSchedulesByReceivableId: new Map(),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });
    const rows = buildReceiptClosingBySeller(
      result.lines.map((line) => ({
        ...line,
        lineKey: line.ledgerLineKey,
        uniqueReceivedAmount: line.receivedAmount,
        scheduledCommissionAmount: null,
        commissionReceivableScheduleId: line.commissionReceivableScheduleId,
      }))
    );
    assert.ok(rows.every((row) => row.sellerName !== null));
    assert.ok(rows.every((row) => row.sellerId !== null));
  });
});
