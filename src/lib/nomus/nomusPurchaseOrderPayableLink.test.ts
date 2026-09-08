/**
 * Pedido Nomus ↔ Contas a Pagar — motor puro.
 * Regras testadas: camadas automáticas só com chave oficial dos dois lados,
 * sugestão só com fornecedor + empresa + valor + vencimento idênticos (nunca
 * automática), reconciliação parcela × título e status derivado da autoridade
 * de baixa do Contas a Pagar.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedInstallment } from "./nomusPurchaseOrder360.js";
import { resolvePayableFinancialOwnership } from "./nomusPurchaseOrderPayableOwnership.js";
import {
  PURCHASE_ORDER_PAYABLE_LINK_METHODS,
  PurchaseOrderPayableLinkError,
  assertPayableFinancialOwnerAvailable,
  buildPayableLinkSuggestions,
  buildPurchaseOrderPayableReconciliation,
  civilDayKey,
  isSameCompany,
  isSameSupplier,
  normalizeDocumentNumber,
  normalizePurchaseOrderPayableLinkReason,
  parseConfirmPayableLinkPayload,
  resolveAutomaticPayableLinks,
  sameMoney,
  type PayableCandidateRow,
  type PersistedPayableLinkRow,
  type PurchaseOrderLinkIdentity,
} from "./nomusPurchaseOrderPayableLink.js";

const NOW = new Date("2026-10-20T12:00:00.000Z");

/** Dia civil local — mesma convenção de civilDayKey. */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const ORDER: PurchaseOrderLinkIdentity = {
  id: "11111111-1111-4111-8111-111111111111",
  externalId: 613,
  orderNumber: "PC00612",
  companyId: 1,
  supplierExternalId: 215,
  supplierTaxId: "12.345.678/0001-90",
};

function installment(
  index: number,
  due: string,
  amount: number,
  extra: Partial<PlannedInstallment> = {}
): PlannedInstallment {
  return {
    index,
    dueDate: localDate(due),
    dueDateRaw: due,
    amount,
    paymentMethodId: 10,
    bankAccountId: 3,
    generatesAdvance: false,
    ...extra,
  };
}

const INSTALLMENTS = [
  installment(0, "2026-10-16", 1136.68),
  installment(1, "2026-10-30", 1136.68),
  installment(2, "2026-11-09", 1171.14),
];
const PLANNED_TOTAL = 3444.5;

function payable(externalId: number, extra: Partial<PayableCandidateRow> = {}): PayableCandidateRow {
  return {
    externalId,
    companyId: 1,
    personId: 215,
    personName: "ACME LTDA",
    personCnpj: "12345678000190",
    documentNumber: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    dueDate: localDate("2026-10-16"),
    paymentDate: null,
    settlementDate: null,
    amountPayable: 1136.68,
    amountPaid: 0,
    balancePayable: 1136.68,
    paymentMethodId: 10,
    paymentMethodName: "Boleto",
    bankAccountId: 3,
    description: null,
    comments: null,
    classification: null,
    nomusStatus: true,
    suspendPayment: false,
    ...extra,
  };
}

const settled = (externalId: number, extra: Partial<PayableCandidateRow> = {}) =>
  payable(externalId, {
    amountPaid: 1136.68,
    balancePayable: 0,
    paymentDate: localDate("2026-10-15"),
    settlementDate: localDate("2026-10-15"),
    ...extra,
  });

describe("helpers", () => {
  it("normaliza número de documento sem inventar equivalência", () => {
    assert.equal(normalizeDocumentNumber("pc-00612"), "PC00612");
    assert.equal(normalizeDocumentNumber("000613"), "613");
    assert.equal(normalizeDocumentNumber(null), "");
  });

  it("dia civil e moeda com tolerância de centavo", () => {
    assert.equal(civilDayKey(new Date(2026, 9, 16, 23, 59, 59)), "2026-10-16");
    assert.equal(civilDayKey(null), null);
    assert.ok(sameMoney(10, 10.004));
    assert.ok(!sameMoney(10, 10.01));
    assert.ok(!sameMoney(null, 0));
  });

  it("fornecedor igual por ID Nomus; sem ID, por CNPJ; nunca por nome", () => {
    assert.ok(isSameSupplier(ORDER, payable(1)));
    assert.ok(!isSameSupplier(ORDER, payable(1, { personId: 999 })));
    assert.ok(
      isSameSupplier({ supplierExternalId: null, supplierTaxId: "12345678000190" }, payable(1, { personId: null }))
    );
    assert.ok(
      !isSameSupplier(
        { supplierExternalId: null, supplierTaxId: null },
        payable(1, { personId: null, personName: "ACME LTDA" })
      )
    );
  });

  it("empresa desconhecida não reprova; empresa diferente reprova", () => {
    assert.ok(isSameCompany({ companyId: null }, payable(1)));
    assert.ok(isSameCompany(ORDER, payable(1, { companyId: null })));
    assert.ok(!isSameCompany(ORDER, payable(1, { companyId: 2 })));
  });

  it("motivo: obrigatório quando exigido, limitado a 500 caracteres", () => {
    assert.equal(normalizePurchaseOrderPayableLinkReason("  ok  ", true), "ok");
    assert.equal(normalizePurchaseOrderPayableLinkReason(null, false), null);
    assert.throws(() => normalizePurchaseOrderPayableLinkReason("   ", true), PurchaseOrderPayableLinkError);
    assert.throws(() => normalizePurchaseOrderPayableLinkReason("x".repeat(501), false), PurchaseOrderPayableLinkError);
  });
});

describe("resolveAutomaticPayableLinks — camadas 1 a 3", () => {
  it("NF-e declarada no pedido vence documento de entrada; número do pedido no título exige mesmo fornecedor", () => {
    const rows = [
      payable(9001, { sourceInvoiceId: 501 }),
      payable(9002, { sourceInvoiceId: 777 }),
      payable(9003, { documentNumber: "PC00612" }),
      payable(9004, { documentNumber: "PC00612", personId: 999 }),
      payable(9005, { documentNumber: "613" }),
      payable(9006),
    ];
    const resolved = resolveAutomaticPayableLinks({
      order: ORDER,
      payables: rows,
      directInvoiceIds: [501, 777],
      stockDocumentInvoiceIds: [777],
    });
    assert.deepEqual(
      resolved.map((row) => [row.payableExternalId, row.method]),
      [
        [9001, "DIRECT_NOMUS_NFE"],
        [9002, "DIRECT_NOMUS_NFE"],
        [9003, "AP_DOCUMENT_NUMBER"],
        [9005, "AP_DOCUMENT_NUMBER"],
      ]
    );
    assert.match(resolved[0].evidence, /NF-e 501/);
  });

  it("documento de entrada só liga quando a NF-e chega pelo idPedidoCompra", () => {
    const resolved = resolveAutomaticPayableLinks({
      order: ORDER,
      payables: [payable(9002, { sourceInvoiceId: 777 }), payable(9007, { sourceInvoiceId: 778 })],
      directInvoiceIds: [],
      stockDocumentInvoiceIds: [777],
    });
    assert.deepEqual(
      resolved.map((row) => [row.payableExternalId, row.method]),
      [[9002, "STOCK_DOCUMENT_PURCHASE_ORDER"]]
    );
  });

  it("mesmo fornecedor, sozinho, nunca vira vínculo automático", () => {
    const resolved = resolveAutomaticPayableLinks({
      order: ORDER,
      payables: [payable(9006), payable(9008, { amountPayable: 1171.14, balancePayable: 1171.14 })],
      directInvoiceIds: [],
      stockDocumentInvoiceIds: [],
    });
    assert.deepEqual(resolved, []);
  });
});

describe("buildPayableLinkSuggestions — camada 4 (sempre com confirmação)", () => {
  it("sugere só com fornecedor, empresa, valor e vencimento idênticos; um título por parcela", () => {
    const rows = [
      payable(9101),
      payable(9102, { personId: 999 }),
      payable(9103, { companyId: 2 }),
      payable(9104, { dueDate: localDate("2026-10-17") }),
      payable(9105, { amountPayable: 1136.67, balancePayable: 1136.67 }),
      payable(9106, { dueDate: localDate("2026-10-30") }),
      payable(9107, { dueDate: localDate("2026-10-30"), paymentMethodId: 99, bankAccountId: 1 }),
      payable(9108, {
        dueDate: localDate("2026-11-09"),
        amountPayable: 1171.14,
        balancePayable: 1171.14,
        description: "TITULO CANCELADO",
      }),
    ];
    const suggestions = buildPayableLinkSuggestions({ order: ORDER, installments: INSTALLMENTS, payables: rows });
    assert.deepEqual(
      suggestions.map((row) => [row.installmentIndex, row.payableExternalId]),
      [
        [0, 9101],
        [1, 9106],
      ]
    );
    for (const row of suggestions) {
      assert.equal(row.method, "INSTALLMENT_MATCH");
      assert.equal(row.requiresConfirmation, true);
      assert.deepEqual(row.matchedOn, {
        supplier: true,
        company: true,
        amount: true,
        dueDate: true,
        paymentMethod: true,
        bankAccount: true,
      });
    }
    assert.match(
      suggestions[0].evidence,
      /parcela 1 · vencimento 2026-10-16 · valor 1136\.68 · forma de pagamento igual · conta bancária igual/
    );
  });

  it("forma/conta iguais só desempatam; exclui já vinculados; marca título de outro pedido", () => {
    const rows = [payable(9201, { paymentMethodId: 99 }), payable(9202)];
    const suggestions = buildPayableLinkSuggestions({
      order: ORDER,
      installments: [INSTALLMENTS[0]],
      payables: rows,
      linkedElsewherePayableIds: [9202],
    });
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].payableExternalId, 9202);
    assert.equal(suggestions[0].linkedToOtherOrder, true);

    const excluded = buildPayableLinkSuggestions({
      order: ORDER,
      installments: [INSTALLMENTS[0]],
      payables: rows,
      alreadyLinkedPayableIds: [9202],
    });
    assert.equal(excluded[0].payableExternalId, 9201);
    assert.equal(excluded[0].matchedOn.paymentMethod, false);
  });

  it("parcela sem vencimento ou sem valor não gera sugestão", () => {
    const suggestions = buildPayableLinkSuggestions({
      order: ORDER,
      installments: [
        installment(0, "2026-10-16", 1136.68, { dueDate: null }),
        installment(1, "2026-10-30", 0, { amount: null }),
      ],
      payables: [payable(9301), payable(9302, { dueDate: localDate("2026-10-30") })],
    });
    assert.deepEqual(suggestions, []);
  });
});

describe("buildPurchaseOrderPayableReconciliation — parcela × título", () => {
  const persisted = (externalId: number, extra: Partial<PersistedPayableLinkRow> = {}): PersistedPayableLinkRow => ({
    id: `link-${externalId}`,
    nomusPurchaseOrderId: ORDER.id,
    payableExternalId: externalId,
    installmentIndex: null,
    method: "MANUAL",
    confidence: "CONFIRMED",
    evidence: "manual",
    reason: "conferido",
    createdByUserId: "u1",
    createdByUserName: "Paulo",
    createdAt: localDate("2026-10-01"),
    ...extra,
  });

  it("sem títulos: parcelas ficam sem vínculo, status PLANNED_ONLY, sugestões listadas", () => {
    const view = buildPurchaseOrderPayableReconciliation({
      order: ORDER,
      installments: INSTALLMENTS,
      plannedInstallmentsTotal: PLANNED_TOTAL,
      payables: [payable(9101)],
      automatic: [],
      persisted: [],
      now: NOW,
    });
    assert.equal(view.financialStatus, "PLANNED_ONLY");
    assert.equal(view.fullySettled, false);
    assert.equal(view.totals.linkedCount, 0);
    assert.equal(view.totals.unlinkedInstallmentCount, 3);
    assert.equal(view.totals.suggestionCount, 1);
    assert.equal(view.installments[0].status, "UNLINKED");
    assert.equal(view.installments[0].suggestions[0].payableExternalId, 9101);
    assert.deepEqual(view.warnings, []);
  });

  it("automáticos aparecem como EXACT sem parcela; persistidos vencem automáticos e trazem a parcela", () => {
    const rows = [
      settled(9001, { sourceInvoiceId: 501 }),
      payable(9002, { sourceInvoiceId: 502, dueDate: localDate("2026-10-30") }),
    ];
    const view = buildPurchaseOrderPayableReconciliation({
      order: ORDER,
      installments: INSTALLMENTS,
      plannedInstallmentsTotal: PLANNED_TOTAL,
      payables: rows,
      automatic: [
        { payableExternalId: 9001, method: "DIRECT_NOMUS_NFE", evidence: "nf 501" },
        { payableExternalId: 9002, method: "DIRECT_NOMUS_NFE", evidence: "nf 502" },
      ],
      persisted: [persisted(9002, { installmentIndex: 1, method: "INSTALLMENT_MATCH" })],
      now: NOW,
    });
    assert.equal(view.unassignedPayables.length, 1);
    assert.equal(view.unassignedPayables[0].payableExternalId, 9001);
    assert.equal(view.unassignedPayables[0].confidence, "EXACT");
    assert.equal(view.unassignedPayables[0].linkId, null);
    assert.equal(view.unassignedPayables[0].status, "SETTLED");
    assert.equal(view.unassignedPayables[0].methodLabel, "NF-e do pedido");

    const second = view.installments[1];
    assert.equal(second.payables.length, 1);
    assert.equal(second.payables[0].confidence, "CONFIRMED");
    assert.equal(second.payables[0].linkId, "link-9002");
    assert.equal(second.payables[0].linkedByUserName, "Paulo");
    assert.equal(second.payables[0].status, "OPEN");
    assert.equal(second.status, "LINKED");
    assert.equal(second.suggestions.length, 0);

    assert.equal(view.totals.linkedCount, 2);
    assert.equal(view.totals.linkedAmount, 2273.36);
    assert.equal(view.totals.paidAmount, 1136.68);
    assert.equal(view.totals.openAmount, 1136.68);
    assert.equal(view.totals.unlinkedInstallmentCount, 2);
    assert.equal(view.financialStatus, "PARTIALLY_PAID");
    assert.match(view.warnings[0], /Total vinculado \(2273\.36\) difere do planejado no pedido \(3444\.50\)/);
  });

  it("pedido quitado quando todos os títulos vinculados estão baixados; cancelado não conta", () => {
    const rows = [
      settled(9001, { sourceInvoiceId: 501 }),
      settled(9002, { sourceInvoiceId: 502, dueDate: localDate("2026-10-30") }),
      settled(9003, {
        sourceInvoiceId: 503,
        amountPayable: 1171.14,
        amountPaid: 1171.14,
        dueDate: localDate("2026-11-09"),
      }),
      payable(9004, { sourceInvoiceId: 504, description: "CANCELADO" }),
    ];
    const view = buildPurchaseOrderPayableReconciliation({
      order: ORDER,
      installments: INSTALLMENTS,
      plannedInstallmentsTotal: PLANNED_TOTAL,
      payables: rows,
      automatic: rows.map((row) => ({
        payableExternalId: row.externalId,
        method: "DIRECT_NOMUS_NFE" as const,
        evidence: "nf",
      })),
      persisted: [
        persisted(9001, { installmentIndex: 0, method: "DIRECT_NOMUS_NFE" }),
        persisted(9002, { installmentIndex: 1, method: "DIRECT_NOMUS_NFE" }),
        persisted(9003, { installmentIndex: 2, method: "DIRECT_NOMUS_NFE" }),
      ],
      now: NOW,
    });
    assert.equal(view.fullySettled, true);
    assert.equal(view.financialStatus, "PAID");
    assert.deepEqual(
      view.installments.map((row) => row.status),
      ["PAID", "PAID", "PAID"]
    );
    assert.equal(view.totals.linkedCount, 3);
    assert.equal(view.totals.paidAmount, 3444.5);
    assert.equal(view.totals.openAmount, 0);
    assert.equal(view.unassignedPayables[0].status, "CANCELLED");
    assert.deepEqual(view.warnings, []);
  });

  it("somente título cancelado: visível, não infla vinculado e não marca quitado", () => {
    const view = buildPurchaseOrderPayableReconciliation({
      order: ORDER,
      installments: [INSTALLMENTS[0]],
      plannedInstallmentsTotal: 1136.68,
      payables: [payable(9001, { sourceInvoiceId: 501, description: "CANCELADO" })],
      automatic: [{ payableExternalId: 9001, method: "DIRECT_NOMUS_NFE", evidence: "nf" }],
      persisted: [persisted(9001, { installmentIndex: 0 })],
      now: NOW,
    });
    assert.equal(view.installments[0].payables[0].status, "CANCELLED");
    assert.equal(view.installments[0].status, "UNLINKED");
    assert.equal(view.totals.linkedCount, 0);
    assert.equal(view.totals.linkedAmount, 0);
    assert.equal(view.totals.paidAmount, 0);
    assert.equal(view.fullySettled, false);
    assert.equal(view.financialStatus, "PLANNED_ONLY");
  });

  it("ativo + cancelado: só o ativo entra nos totais; cancelado continua visível", () => {
    const view = buildPurchaseOrderPayableReconciliation({
      order: ORDER,
      installments: [INSTALLMENTS[0]],
      plannedInstallmentsTotal: 1136.68,
      payables: [
        payable(9001, { sourceInvoiceId: 501 }),
        payable(9002, { sourceInvoiceId: 502, description: "CANCELADO" }),
      ],
      automatic: [
        { payableExternalId: 9001, method: "DIRECT_NOMUS_NFE", evidence: "nf" },
        { payableExternalId: 9002, method: "DIRECT_NOMUS_NFE", evidence: "nf" },
      ],
      persisted: [
        persisted(9001, { installmentIndex: 0 }),
        persisted(9002, { installmentIndex: 0 }),
      ],
      now: NOW,
    });
    assert.equal(view.installments[0].payables.length, 2);
    assert.equal(view.totals.linkedCount, 1);
    assert.equal(view.totals.linkedAmount, 1136.68);
    assert.equal(view.totals.paidAmount, 0);
    assert.equal(view.fullySettled, false);
    assert.equal(view.financialStatus, "CONFIRMED");
  });

  it("pago + cancelado: quitado pelo título baixado; cancelado não soma nem impede", () => {
    const view = buildPurchaseOrderPayableReconciliation({
      order: ORDER,
      installments: [INSTALLMENTS[0]],
      plannedInstallmentsTotal: 1136.68,
      payables: [
        settled(9001, { sourceInvoiceId: 501 }),
        payable(9002, { sourceInvoiceId: 502, description: "CANCELADO" }),
      ],
      automatic: [
        { payableExternalId: 9001, method: "DIRECT_NOMUS_NFE", evidence: "nf" },
        { payableExternalId: 9002, method: "DIRECT_NOMUS_NFE", evidence: "nf" },
      ],
      persisted: [
        persisted(9001, { installmentIndex: 0 }),
        persisted(9002, { installmentIndex: 0 }),
      ],
      now: NOW,
    });
    assert.equal(view.totals.linkedCount, 1);
    assert.equal(view.totals.paidAmount, 1136.68);
    assert.equal(view.fullySettled, true);
    assert.equal(view.financialStatus, "PAID");
  });

  it("título vencido, suspenso e parcialmente pago têm status próprios", () => {
    const rows = [
      payable(9001, { dueDate: localDate("2026-10-01") }),
      payable(9002, { suspendPayment: true, dueDate: localDate("2026-12-01") }),
      payable(9003, { amountPaid: 500, balancePayable: 636.68, dueDate: localDate("2026-12-01") }),
    ];
    const view = buildPurchaseOrderPayableReconciliation({
      order: ORDER,
      installments: [INSTALLMENTS[0]],
      plannedInstallmentsTotal: 1136.68,
      payables: rows,
      automatic: [],
      persisted: [persisted(9001, { installmentIndex: 0 }), persisted(9002), persisted(9003, { installmentIndex: 0 })],
      now: NOW,
    });
    const first = view.installments[0];
    assert.deepEqual(
      first.payables.map((row) => row.status),
      ["OVERDUE", "OPEN"]
    );
    assert.equal(first.status, "PARTIALLY_PAID");
    assert.equal(first.paidAmount, 500);
    assert.equal(view.unassignedPayables[0].status, "SUSPENDED");
    assert.equal(view.unassignedPayables[0].openAmount, 0);
    assert.equal(view.financialStatus, "PARTIALLY_PAID");
  });

  it("avisa vínculo persistido cujo título sumiu do espelho e título vinculado a outro pedido", () => {
    const view = buildPurchaseOrderPayableReconciliation({
      order: ORDER,
      installments: INSTALLMENTS,
      plannedInstallmentsTotal: PLANNED_TOTAL,
      payables: [payable(9002, { sourceInvoiceId: 502 })],
      automatic: [{ payableExternalId: 9002, method: "DIRECT_NOMUS_NFE", evidence: "nf" }],
      persisted: [persisted(9999)],
      linkedElsewherePayableIds: [9002],
      now: NOW,
    });
    assert.ok(view.warnings.some((w) => /Título 9999 vinculado manualmente não está mais no espelho/.test(w)));
    assert.ok(view.warnings.some((w) => /Título 9002 também está vinculado a outro pedido/.test(w)));
    assert.equal(view.unassignedPayables[0].linkedToOtherOrder, true);
    // Sem mapa de ownership (chamador legado), o título apresentado ainda conta para o pedido.
    assert.equal(view.unassignedPayables[0].countsForThisOrder, true);
  });

  describe("cardinalidade financeira V1 — dono por título decide quem soma", () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const numbers = new Map([[ORDER.id, "PC00612"], [OTHER, "PC00613"]]);
    const claim = (order: string, source: "CONFIRMED" | "AUTOMATIC", payableExternalId = 9002) => ({ nomusPurchaseOrderId: order, payableExternalId, source });
    const base = {
      order: ORDER,
      installments: INSTALLMENTS,
      plannedInstallmentsTotal: PLANNED_TOTAL,
      orderNumbersById: numbers,
      now: NOW,
    };

    it("I. NF-e aqui + confirmado em outro pedido → visível, 'Vinculado a outro pedido (PC00613)', fora dos totais, não quita", () => {
      const view = buildPurchaseOrderPayableReconciliation({
        ...base,
        payables: [settled(9002, { sourceInvoiceId: 502 })],
        automatic: [{ payableExternalId: 9002, method: "DIRECT_NOMUS_NFE", evidence: "nf" }],
        persisted: [],
        ownership: resolvePayableFinancialOwnership([claim(OTHER, "CONFIRMED"), claim(ORDER.id, "AUTOMATIC")]),
      });
      const row = view.unassignedPayables[0];
      assert.equal(row.countsForThisOrder, false);
      assert.equal(row.linkedToOtherOrder, true);
      assert.deepEqual(row.ownership, { kind: "CONFIRMED_OWNER", ownerOrderId: OTHER, ownerOrderNumber: "PC00613", label: "Vinculado a outro pedido" });
      assert.equal(view.totals.linkedCount, 0);
      assert.equal(view.totals.linkedAmount, 0);
      assert.equal(view.totals.paidAmount, 0);
      assert.equal(view.totals.excludedByOwnershipCount, 1);
      assert.equal(view.fullySettled, false);
      assert.equal(view.financialStatus, "PLANNED_ONLY");
      assert.ok(view.warnings.some((w) => /9002 está vinculado financeiramente a outro pedido \(PC00613\) — não entra nos totais/.test(w)));
    });

    it("K. conflito automático (NF-e em dois pedidos) → visível como conflito, 0 aqui", () => {
      const view = buildPurchaseOrderPayableReconciliation({
        ...base,
        payables: [settled(9002, { sourceInvoiceId: 502 })],
        automatic: [{ payableExternalId: 9002, method: "DIRECT_NOMUS_NFE", evidence: "nf" }],
        persisted: [],
        ownership: resolvePayableFinancialOwnership([claim(ORDER.id, "AUTOMATIC"), claim(OTHER, "AUTOMATIC")]),
      });
      assert.equal(view.unassignedPayables[0].ownership.kind, "AUTO_CONFLICT");
      assert.equal(view.unassignedPayables[0].countsForThisOrder, false);
      assert.equal(view.totals.paidAmount, 0);
      assert.equal(view.fullySettled, false);
      assert.ok(view.warnings.some((w) => /9002 tem evidência de vínculo em mais de um pedido/.test(w)));
    });

    it("M/J. confirmado aqui (mesmo com NF-e aqui e evidência em outro) → conta uma vez; automático só daqui → conta", () => {
      const persistedHere = persisted(9002, { installmentIndex: 1 });
      const view = buildPurchaseOrderPayableReconciliation({
        ...base,
        payables: [payable(9002, { sourceInvoiceId: 502, dueDate: localDate("2026-10-30") })],
        automatic: [{ payableExternalId: 9002, method: "DIRECT_NOMUS_NFE", evidence: "nf" }],
        persisted: [persistedHere],
        ownership: resolvePayableFinancialOwnership([claim(ORDER.id, "CONFIRMED"), claim(ORDER.id, "AUTOMATIC"), claim(OTHER, "AUTOMATIC")]),
      });
      assert.equal(view.totals.linkedCount, 1);
      assert.equal(view.totals.linkedAmount, 1136.68);
      assert.equal(view.installments[1].payables[0].countsForThisOrder, true);
      assert.equal(view.installments[1].status, "LINKED");

      const single = buildPurchaseOrderPayableReconciliation({
        ...base,
        payables: [payable(9002, { sourceInvoiceId: 502 })],
        automatic: [{ payableExternalId: 9002, method: "DIRECT_NOMUS_NFE", evidence: "nf" }],
        persisted: [],
        ownership: resolvePayableFinancialOwnership([claim(ORDER.id, "AUTOMATIC")]),
      });
      assert.equal(single.unassignedPayables[0].ownership.kind, "AUTO_SINGLE_OWNER");
      assert.equal(single.totals.linkedCount, 1);
    });

    it("R/sugestão: título confirmado em outro pedido não é confirmável aqui (confirmable=false, número do dono)", () => {
      const view = buildPurchaseOrderPayableReconciliation({
        ...base,
        payables: [payable(9101)],
        automatic: [],
        persisted: [],
        ownership: resolvePayableFinancialOwnership([claim(OTHER, "CONFIRMED", 9101)]),
      });
      assert.equal(view.suggestions.length, 1);
      assert.equal(view.suggestions[0].confirmable, false);
      assert.equal(view.suggestions[0].linkedToOtherOrder, true);
      assert.equal(view.suggestions[0].ownerOrderNumber, "PC00613");
      assert.ok(view.warnings.some((w) => /9101 sugerido para a parcela 1 já está vinculado financeiramente a outro pedido \(PC00613\)/.test(w)));
      const free = buildPayableLinkSuggestions({ order: ORDER, installments: INSTALLMENTS, payables: [payable(9101)] });
      assert.equal(free[0].confirmable, true);
      assert.equal(free[0].ownerOrderNumber, null);
    });

    it("P/N. cancelado nunca conta; o mesmo título nunca soma 100% em dois pedidos", () => {
      const cancelled = settled(9002, { sourceInvoiceId: 502, description: "CANCELADO" });
      const view = buildPurchaseOrderPayableReconciliation({
        ...base,
        payables: [cancelled],
        automatic: [{ payableExternalId: 9002, method: "DIRECT_NOMUS_NFE", evidence: "nf" }],
        persisted: [],
        ownership: resolvePayableFinancialOwnership([claim(ORDER.id, "AUTOMATIC")]),
      });
      assert.equal(view.unassignedPayables[0].status, "CANCELLED");
      assert.equal(view.unassignedPayables[0].countsForThisOrder, false);
      assert.equal(view.totals.excludedByOwnershipCount, 0);
      assert.equal(view.totals.linkedAmount, 0);

      const paidTitle = settled(9002, { sourceInvoiceId: 502, amountPayable: 10000, amountPaid: 10000 });
      const auto = [{ payableExternalId: 9002, method: "DIRECT_NOMUS_NFE" as const, evidence: "nf" }];
      for (const claims of [
        [claim(ORDER.id, "CONFIRMED"), claim(OTHER, "AUTOMATIC")],
        [claim(OTHER, "CONFIRMED"), claim(ORDER.id, "AUTOMATIC")],
        [claim(ORDER.id, "AUTOMATIC"), claim(OTHER, "AUTOMATIC")],
      ]) {
        const ownership = resolvePayableFinancialOwnership(claims);
        const here = buildPurchaseOrderPayableReconciliation({ ...base, payables: [paidTitle], automatic: auto, persisted: [], ownership });
        const there = buildPurchaseOrderPayableReconciliation({ ...base, order: { ...ORDER, id: OTHER }, payables: [paidTitle], automatic: auto, persisted: [], ownership });
        assert.ok(here.totals.paidAmount + there.totals.paidAmount <= 10000);
        assert.ok(!(here.fullySettled && there.fullySettled), "o mesmo pagamento não quita dois pedidos");
      }
    });
  });

  it("pedido sem parcelas e sem títulos: NO_FINANCIAL_DATA", () => {
    const view = buildPurchaseOrderPayableReconciliation({
      order: ORDER,
      installments: [],
      plannedInstallmentsTotal: null,
      payables: [],
      automatic: [],
      persisted: [],
      now: NOW,
    });
    assert.equal(view.financialStatus, "NO_FINANCIAL_DATA");
    assert.equal(view.totals.plannedCount, 0);
  });
});

describe("assertPayableFinancialOwnerAvailable — autoridade única do segundo dono", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const run = (confirmedOrderIds: string[]) => {
    try {
      assertPayableFinancialOwnerAvailable({ payableExternalId: 9001, orderId: ORDER.id, confirmedOrderIds, orderNumbersById: new Map([[OTHER, "PC00613"]]) });
      return null;
    } catch (error) {
      return error as PurchaseOrderPayableLinkError;
    }
  };

  it("sem dono → livre; dono aqui → PAYABLE_ALREADY_LINKED 409; dono em outro → PAYABLE_ALREADY_LINKED_TO_ANOTHER_PURCHASE_ORDER 409 com número do dono", () => {
    assert.equal(run([]), null);
    const here = run([ORDER.id])!;
    assert.equal(here.code, "PAYABLE_ALREADY_LINKED");
    assert.equal(here.httpStatus, 409);
    const other = run([OTHER])!;
    assert.equal(other.code, "PAYABLE_ALREADY_LINKED_TO_ANOTHER_PURCHASE_ORDER");
    assert.equal(other.httpStatus, 409);
    assert.equal(other.message, "Este título já está vinculado financeiramente a outro pedido.");
    assert.equal(other.field, "payableExternalId");
    assert.deepEqual(other.details, { payableExternalId: 9001, ownerOrderId: OTHER, ownerOrderNumber: "PC00613" });
    // Conflito confirmado (dado anterior à unique): outro pedido vence a idempotência local — 409 de outro pedido.
    assert.equal(run([ORDER.id, OTHER])!.code, "PAYABLE_ALREADY_LINKED_TO_ANOTHER_PURCHASE_ORDER");
  });
});

describe("parseConfirmPayableLinkPayload", () => {
  it("aceita INSTALLMENT_MATCH sem motivo e MANUAL com motivo; rejeita métodos automáticos", () => {
    assert.deepEqual(
      parseConfirmPayableLinkPayload(
        { payableExternalId: "9001", installmentIndex: "1", method: "INSTALLMENT_MATCH" },
        { installmentCount: 3 }
      ),
      { payableExternalId: 9001, installmentIndex: 1, method: "INSTALLMENT_MATCH", reason: null }
    );
    assert.deepEqual(
      parseConfirmPayableLinkPayload({ payableExternalId: 9001, reason: " conferido " }, { installmentCount: 3 }),
      { payableExternalId: 9001, installmentIndex: null, method: "MANUAL", reason: "conferido" }
    );
    for (const method of PURCHASE_ORDER_PAYABLE_LINK_METHODS.filter(
      (m) => m !== "MANUAL" && m !== "INSTALLMENT_MATCH"
    )) {
      assert.throws(
        () => parseConfirmPayableLinkPayload({ payableExternalId: 1, method, reason: "x" }, { installmentCount: 1 }),
        (error: unknown) => error instanceof PurchaseOrderPayableLinkError && error.code === "INVALID_LINK_METHOD"
      );
    }
  });

  it("valida título, parcela e motivo do manual", () => {
    const codeOf = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (error) {
        return error instanceof PurchaseOrderPayableLinkError ? `${error.code}:${error.httpStatus}` : "other";
      }
    };
    assert.equal(
      codeOf(() => parseConfirmPayableLinkPayload({ payableExternalId: 0, reason: "x" }, { installmentCount: 1 })),
      "INVALID_PAYABLE_EXTERNAL_ID:400"
    );
    assert.equal(
      codeOf(() =>
        parseConfirmPayableLinkPayload({ payableExternalId: 1, installmentIndex: 3, reason: "x" }, { installmentCount: 3 })
      ),
      "INVALID_INSTALLMENT_INDEX:400"
    );
    assert.equal(
      codeOf(() => parseConfirmPayableLinkPayload({ payableExternalId: 1, method: "MANUAL" }, { installmentCount: 1 })),
      "PURCHASE_ORDER_PAYABLE_LINK_REASON_REQUIRED:400"
    );
  });
});
