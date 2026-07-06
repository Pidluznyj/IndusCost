import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOMUS_NFE_STATUS_AUTHORIZED } from "@/src/lib/nomusNfeClassification.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  buildCommissionReceiptPreview,
  COMMISSION_RECEIPT_NO_SCHEDULE_REASON,
  filterSettledReceivablesForPreview,
  type CommissionReceiptReceivableInput,
} from "./commissionReceiptEngine.js";
import type {
  CommissionOrderItemSource,
  CommissionOrderSourceBundle,
} from "./commission-types.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";
import { buildVisualAuditRow } from "./commissionVisualAudit.js";

const EMPTY_IDENTITY: CommissionSellerIdentityContext = { persons: [], aliases: [] };

const OK_IDENTITY: CommissionSellerIdentityContext = {
  persons: [
    {
      id: "person-seller",
      nomusPersonId: 464,
      name: "GISLENE LIMA",
      type: "SELLER",
      source: "NOMUS",
      active: true,
      linkedRecordCount: 1,
    },
  ],
  aliases: [
    {
      id: "alias-1",
      commissionedPersonId: "person-seller",
      source: "NOMUS_ORDER",
      rawSellerId: 464,
      rawSellerName: "GISLENE LIMA",
      normalizedSellerName: "GISLENE LIMA",
      status: "ACTIVE",
      confidence: 1,
    },
  ],
};

function item(
  localItemId: string,
  itemNetAmount: number,
  productCode = localItemId
): CommissionOrderItemSource {
  return {
    localItemId,
    localProductId: `prod-${localItemId}`,
    nomusOrderItemId: null,
    nomusProductId: null,
    productCode,
    productName: productCode,
    quantity: 1,
    unitPrice: itemNetAmount,
    discount: 0,
    surcharge: 0,
    itemNetAmount,
  };
}

function makeOrderBundle(
  items: CommissionOrderItemSource[],
  overrides: Partial<CommissionOrderSourceBundle> = {}
): CommissionOrderSourceBundle {
  const linkedNfe = {
    nfeExternalId: 100,
    nfeNumber: "12345",
    nfeStatus: NOMUS_NFE_STATUS_AUTHORIZED,
    tipoOperacao: 1,
    dataProcessamento: new Date("2026-06-01"),
    nfeValue: items.reduce((sum, row) => sum + row.itemNetAmount, 0),
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
    customerName: "Cliente Teste",
    seller: { nomusSellerId: 464, responsibleName: "GISLENE LIMA" },
    representative: { nomusRepresentativeId: null, name: null },
    items,
    forecastInstallments: [],
    linkedNfes: [linkedNfe],
    authorizedOutputNfes: [linkedNfe],
    outputDocumentsByNfeId: new Map(),
    receivablesByNfeId: new Map(),
    ...overrides,
  };
}

function receivable(
  partial: Partial<CommissionReceiptReceivableInput> & Pick<CommissionReceiptReceivableInput, "nomusReceivableId">
): CommissionReceiptReceivableInput {
  return {
    settlementDate: new Date("2026-06-15"),
    dueDate: new Date("2026-06-30"),
    amountReceivable: 5000,
    amountReceived: 5000,
    nomusNfeId: 100,
    nfeNumber: "12345",
    customerExternalId: 200,
    customerName: "Cliente Teste",
    ...partial,
  };
}

function exclusionRule(
  partial: Partial<CustomerExclusionRuleSnapshot> & Pick<CustomerExclusionRuleSnapshot, "id">
): CustomerExclusionRuleSnapshot {
  return {
    customerId: null,
    customerExternalId: 200,
    customerNameSnapshot: "Cliente Teste",
    normalizedCustomerName: "cliente teste",
    reason: "Política comercial",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    status: "ACTIVE",
    notes: null,
    ...partial,
  };
}

const LEGACY_ITEM_FALLBACK = { allowItemRecalculationFallback: true as const };

function materializedSchedule(
  partial: Partial<import("./commissionReceiptEngine.js").MaterializedReceivableScheduleInput> &
    Pick<
      import("./commissionReceiptEngine.js").MaterializedReceivableScheduleInput,
      "receivableId" | "scheduledCommissionAmount"
    >
): import("./commissionReceiptEngine.js").MaterializedReceivableScheduleInput {
  return {
    id: partial.id ?? `sched-${partial.receivableId}`,
    orderSnapshotId: "snap-1",
    receivableCode: null,
    installmentNumber: 1,
    nfeId: 100,
    salesOrderId: "order-1",
    customerId: "cust-1",
    canonicalSellerId: "person-seller",
    canonicalSellerName: "GISLENE LIMA",
    rawSellerId: 464,
    rawSellerName: "GISLENE LIMA",
    orderCode: "PED-1",
    receivableNominalAmount: 10000,
    receivableSharePercent: 100,
    scheduleStatus: "ACTIVE",
    sellerResolutionStatus: "OK_CANONICAL",
    exclusionRuleId: null,
    exclusionReason: null,
    ...partial,
  };
}

describe("commissionReceiptEngine", () => {
  it("exemplo obrigatório: dois itens com % diferentes e parcela recebida", () => {
    const order = makeOrderBundle([item("item-a", 6000, "A"), item("item-b", 4000, "B")]);
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 1, amountReceivable: 10000, amountReceived: 5000 })],
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([
        ["item-a", 2],
        ["item-b", 1],
      ]),
      ...LEGACY_ITEM_FALLBACK,
    });

    const lineA = result.lines.find((row) => row.localItemId === "item-a");
    const lineB = result.lines.find((row) => row.localItemId === "item-b");
    assert.ok(lineA);
    assert.ok(lineB);
    assert.equal(lineA.commissionableBaseAmount, 3000);
    assert.equal(lineA.expectedCommissionAmount, 60);
    assert.equal(lineB.commissionableBaseAmount, 2000);
    assert.equal(lineB.expectedCommissionAmount, 20);
    assert.equal(result.totalExpectedCommission, 80);
    assert.equal(result.totalReleasedCommission, 80);
  });

  it("duas parcelas em meses diferentes liberam só a parcela do mês", () => {
    const order = makeOrderBundle([item("item-a", 10000)]);
    const june = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [
        receivable({
          nomusReceivableId: 10,
          settlementDate: new Date("2026-06-10"),
          amountReceivable: 5000,
          amountReceived: 5000,
        }),
        receivable({
          nomusReceivableId: 11,
          settlementDate: new Date("2026-07-10"),
          amountReceivable: 5000,
          amountReceived: 5000,
        }),
      ],
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([["item-a", 2]]),
      ...LEGACY_ITEM_FALLBACK,
    });
    const july = buildCommissionReceiptPreview({
      year: 2026,
      month: 7,
      receivables: [
        receivable({
          nomusReceivableId: 10,
          settlementDate: new Date("2026-06-10"),
          amountReceivable: 5000,
          amountReceived: 5000,
        }),
        receivable({
          nomusReceivableId: 11,
          settlementDate: new Date("2026-07-10"),
          amountReceivable: 5000,
          amountReceived: 5000,
        }),
      ],
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([["item-a", 2]]),
      ...LEGACY_ITEM_FALLBACK,
    });

    assert.equal(june.totalReceivables, 1);
    assert.equal(june.totalExpectedCommission, 100);
    assert.equal(july.totalReceivables, 1);
    assert.equal(july.totalExpectedCommission, 100);
    assert.equal(june.totalExpectedCommission + july.totalExpectedCommission, 200);
  });

  it("cliente excluído gera comissão zero com status CUSTOMER_EXCLUDED", () => {
    const order = makeOrderBundle([item("item-a", 10000)]);
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 20 })],
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [exclusionRule({ id: "ex-1" })],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([["item-a", 2]]),
      ...LEGACY_ITEM_FALLBACK,
    });

    assert.equal(result.lines[0]?.status, "CUSTOMER_EXCLUDED");
    assert.equal(result.lines[0]?.expectedCommissionAmount, 0);
    assert.equal(result.lines[0]?.exclusionRuleId, "ex-1");
    assert.equal(result.totalExpectedCommission, 0);
    assert.ok(result.totalExcludedAmount > 0);
  });

  it("título sem vínculo NF/pedido vira NO_SALES_LINK", () => {
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 30, nomusNfeId: 999 })],
      ordersByNfeId: new Map(),
      rules: [],
      exclusionRules: [],
      identityCtx: EMPTY_IDENTITY,
    });
    assert.equal(result.lines[0]?.status, "NO_SALES_LINK");
    assert.equal(result.countByStatus.NO_SALES_LINK, 1);
  });

  it("vendedor sem alias consolidado vira SELLER_UNRESOLVED", () => {
    const order = makeOrderBundle([item("item-a", 5000)], {
      seller: { nomusSellerId: 999, responsibleName: "Vendedor Desconhecido" },
    });
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 40 })],
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [],
      identityCtx: EMPTY_IDENTITY,
      itemRateOverrides: new Map([["item-a", 2]]),
      ...LEGACY_ITEM_FALLBACK,
    });
    assert.equal(result.lines[0]?.status, "SELLER_UNRESOLVED");
  });

  it("sem regra vira NO_RULE", () => {
    const order = makeOrderBundle([item("item-a", 5000)]);
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 50 })],
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      ...LEGACY_ITEM_FALLBACK,
    });
    assert.equal(result.lines[0]?.status, "NO_RULE");
  });

  it("baixa parcial libera comissão proporcional ao recebido", () => {
    const order = makeOrderBundle([item("item-a", 10000)]);
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [
        receivable({
          nomusReceivableId: 60,
          amountReceivable: 10000,
          amountReceived: 2500,
        }),
      ],
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([["item-a", 2]]),
      ...LEGACY_ITEM_FALLBACK,
    });
    assert.equal(result.lines[0]?.commissionableBaseAmount, 2500);
    assert.equal(result.lines[0]?.expectedCommissionAmount, 50);
  });

  it("não gera comissão maior que base × regra", () => {
    const order = makeOrderBundle([item("item-a", 1000)]);
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 70, amountReceived: 1000 })],
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([["item-a", 2]]),
      ...LEGACY_ITEM_FALLBACK,
    });
    const line = result.lines[0]!;
    assert.ok(line.expectedCommissionAmount <= line.commissionableBaseAmount);
    assert.equal(line.expectedCommissionAmount, 20);
  });

  it("não concentra comissão na primeira parcela", () => {
    const order = makeOrderBundle([item("item-a", 10000)]);
    const receivables = [
      receivable({
        nomusReceivableId: 81,
        settlementDate: new Date("2026-06-05"),
        amountReceivable: 5000,
        amountReceived: 5000,
      }),
      receivable({
        nomusReceivableId: 82,
        settlementDate: new Date("2026-06-20"),
        amountReceivable: 5000,
        amountReceived: 5000,
      }),
    ];
    const june = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables,
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([["item-a", 2]]),
      ...LEGACY_ITEM_FALLBACK,
    });
    const first = june.lines.find((row) => row.nomusReceivableId === 81);
    const second = june.lines.find((row) => row.nomusReceivableId === 82);
    assert.equal(first?.expectedCommissionAmount, 100);
    assert.equal(second?.expectedCommissionAmount, 100);
    assert.equal(june.totalExpectedCommission, 200);
  });

  it("prefere linhas persistidas (schedule) quando existem", () => {
    const auditRow = buildVisualAuditRow({
      lineId: "r1:s1",
      recordId: "record-1",
      scheduleId: "schedule-1",
      commissionPersonId: "person-seller",
      commissionPersonName: "GISLENE LIMA",
      customerName: "Cliente Teste",
      orderCode: "PED-1",
      nfeNumber: "12345",
      nomusNfeId: 100,
      confirmedAt: "2026-06-01T00:00:00.000Z",
      documentKey: "person-seller:100",
      documentBaseAmount: 10000,
      documentCommissionTotal: 200,
      itemBaseAmount: 10000,
      itemCommissionAmount: 200,
      itemRatePercent: 2,
      productCode: "A",
      nomusReceivableId: 90,
      installmentNumber: 1,
      dueDate: "2026-06-30T00:00:00.000Z",
      settlementDate: "2026-06-15T00:00:00.000Z",
      receivableAmount: 5000,
      receivedAmount: 5000,
      openBalance: 0,
      allocationPercent: 50,
      commissionExpected: 100,
      commissionReleased: 100,
      hasArLink: true,
      hasSchedule: true,
      customerNoCommission: false,
      isCommissionable: true,
      exclusionReason: null,
      exclusionRuleId: null,
    });

    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [
        receivable({
          nomusReceivableId: 90,
          amountReceivable: 5000,
          amountReceived: 5000,
        }),
      ],
      ordersByNfeId: new Map(),
      persistedAuditRows: [
        {
          ...auditRow,
          canonicalSellerId: "person-seller",
          canonicalSellerName: "GISLENE LIMA",
          sellerResolutionStatus: "OK_CANONICAL",
        },
      ],
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      ...LEGACY_ITEM_FALLBACK,
    });

    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0]?.source, "PERSISTED_SCHEDULE");
    assert.equal(result.lines[0]?.expectedCommissionAmount, 100);
    assert.equal(result.lines[0]?.releasedCommissionAmount, 100);
  });

  it("título recebido com schedule ativo libera comissão correta", () => {
    const sched = materializedSchedule({
      receivableId: 501,
      scheduledCommissionAmount: 200,
      receivableNominalAmount: 10000,
    });
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [
        receivable({
          nomusReceivableId: 501,
          amountReceivable: 10000,
          amountReceived: 10000,
        }),
      ],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([[501, [sched]]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });

    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0]?.source, "MATERIALIZED_SCHEDULE");
    assert.equal(result.lines[0]?.status, "COMMISSIONABLE");
    assert.equal(result.lines[0]?.expectedCommissionAmount, 200);
    assert.equal(result.lines[0]?.releasedCommissionAmount, 200);
  });

  it("título recebido parcial libera comissão proporcional via schedule", () => {
    const sched = materializedSchedule({
      receivableId: 502,
      scheduledCommissionAmount: 200,
      receivableNominalAmount: 10000,
    });
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [
        receivable({
          nomusReceivableId: 502,
          amountReceivable: 10000,
          amountReceived: 2500,
        }),
      ],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([[502, [sched]]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });

    assert.equal(result.lines[0]?.expectedCommissionAmount, 50);
    assert.equal(result.lines[0]?.releasedCommissionAmount, 50);
  });

  it("título sem schedule vira NO_SCHEDULE", () => {
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 503 })],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map(),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });
    assert.equal(result.lines[0]?.status, "NO_SCHEDULE");
    assert.equal(result.lines[0]?.statusReason, COMMISSION_RECEIPT_NO_SCHEDULE_REASON);
    assert.equal(result.lines[0]?.source, "EXCEPTION");
    assert.equal(result.lines[0]?.releasedCommissionAmount, 0);
  });

  it("schedule stale não libera sem reprocessar", () => {
    const sched = materializedSchedule({
      receivableId: 504,
      scheduledCommissionAmount: 100,
      scheduleStatus: "STALE",
    });
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 504 })],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([[504, [sched]]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });
    assert.equal(result.lines[0]?.status, "STALE_SCHEDULE");
    assert.equal(result.lines[0]?.releasedCommissionAmount, 0);
  });

  it("cliente excluído no schedule entra com comissão zero e motivo", () => {
    const sched = materializedSchedule({
      receivableId: 505,
      scheduledCommissionAmount: 0,
      scheduleStatus: "CUSTOMER_EXCLUDED",
      exclusionRuleId: "ex-1",
      exclusionReason: "Política comercial",
    });
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 505 })],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([[505, [sched]]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
    });
    assert.equal(result.lines[0]?.status, "CUSTOMER_EXCLUDED");
    assert.equal(result.lines[0]?.releasedCommissionAmount, 0);
    assert.equal(result.lines[0]?.exclusionReason, "Política comercial");
    assert.equal(result.lines[0]?.exclusionRuleId, "ex-1");
  });

  it("schedule CUSTOMER_EXCLUDED sem exclusionRuleId resolve regra ativa no preview", () => {
    const sched = materializedSchedule({
      receivableId: 506,
      scheduledCommissionAmount: 0,
      scheduleStatus: "CUSTOMER_EXCLUDED",
      exclusionReason: "Política comercial",
      customerId: "cust-ex",
    });
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [
        receivable({
          nomusReceivableId: 506,
          customerId: "cust-ex",
          customerName: "ESMALTEC",
        }),
      ],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([[506, [sched]]]),
      rules: [],
      exclusionRules: [
        exclusionRule({ id: "ex-esmaltec", customerId: "cust-ex", customerExternalId: null }),
      ],
      identityCtx: OK_IDENTITY,
    });
    assert.equal(result.lines[0]?.status, "CUSTOMER_EXCLUDED");
    assert.equal(result.lines[0]?.exclusionRuleId, "ex-esmaltec");
  });

  it("valor recebido é somado por título único", () => {
    const order = makeOrderBundle([item("item-a", 6000), item("item-b", 4000)]);
    const result = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable({ nomusReceivableId: 506, amountReceivable: 10000, amountReceived: 5000 })],
      ordersByNfeId: new Map([[100, order]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([
        ["item-a", 2],
        ["item-b", 1],
      ]),
      ...LEGACY_ITEM_FALLBACK,
    });
    assert.equal(result.lines.length, 2);
    assert.equal(result.totalReceivedAmount, 5000);
  });

  it("filterSettledReceivablesForPreview ignora cancelados e sem recebimento", () => {
    const rows = filterSettledReceivablesForPreview(
      [
        receivable({ nomusReceivableId: 1, amountReceived: 100 }),
        receivable({ nomusReceivableId: 2, amountReceived: 0 }),
        receivable({ nomusReceivableId: 3, amountReceived: 50, cancelled: true }),
        receivable({
          nomusReceivableId: 4,
          settlementDate: new Date("2026-05-01"),
          amountReceived: 100,
        }),
      ],
      2026,
      6
    );
    assert.deepEqual(rows.map((row) => row.nomusReceivableId), [1]);
  });
});
