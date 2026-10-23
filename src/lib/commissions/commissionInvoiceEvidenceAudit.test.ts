/**
 * Classificação (somente leitura) da evidência oficial do Nomus por pedido: inequívoca,
 * ambígua ou ausente — e o efeito B5 na comissão. Nenhum vínculo é presumido.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveOrderInvoiceAllocation, type InvoiceAllocationLineInput } from "./commissionInvoiceAllocation.js";
import {
  classifyOrderInvoiceEvidence,
  classifyOutputDocumentLineRefs,
  summarizeInvoiceEvidenceAudit,
  type InvoiceEvidenceAuditRow,
} from "./commissionInvoiceEvidenceAudit.js";

const ITEMS = [{ salesOrderItemId: "i1", orderedQuantity: 10 }];
const nfe = (id: number, day: number) => ({ nfeExternalId: id, processedAt: new Date(Date.UTC(2026, 9, day)), valid: true });
const line = (partial: Partial<InvoiceAllocationLineInput> & Pick<InvoiceAllocationLineInput, "stockDocumentItemId" | "nfeExternalId" | "quantity">): InvoiceAllocationLineInput => ({
  stockDocumentExternalId: 1,
  documentValid: true,
  belongsToOrder: true,
  salesOrderItemId: "i1",
  sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
  itemCoverage: "RESOLVED",
  claimedByOtherOrders: false,
  ...partial,
});

describe("auditoria da evidência Nomus por pedido", () => {
  it("inequívoca: item oficial em todas as NF-e → alocado; NF-e única que fatura tudo → histórico", () => {
    const two = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1), nfe(2, 2)],
      lines: [line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 4 }), line({ stockDocumentItemId: "b", nfeExternalId: 2, quantity: 6 })],
    });
    assert.deepEqual(classifyOrderInvoiceEvidence(two, [1, 2]), { evidenceClass: "UNEQUIVOCAL", outcome: "ALLOCATED", heldNfeIds: [], reasons: [] });
    const single = resolveOrderInvoiceAllocation({ items: ITEMS, nfes: [nfe(1, 1)], lines: [line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 10 })] });
    const result = classifyOrderInvoiceEvidence(single, [1]);
    assert.deepEqual([result.evidenceClass, result.outcome], ["UNEQUIVOCAL", "LEGACY_FULL"]);
  });

  it("ambígua: linha só por pedido/produto ou reivindicada por outro pedido → retida", () => {
    const weak = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1), nfe(2, 2)],
      lines: [
        line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 4 }),
        line({ stockDocumentItemId: "b", nfeExternalId: 2, quantity: 6, sourceType: "SALES_ORDER_NFE_LINK", salesOrderItemId: null, itemCoverage: "ORDER_LEVEL_ONLY" }),
      ],
    });
    const result = classifyOrderInvoiceEvidence(weak, [1, 2]);
    assert.deepEqual([result.evidenceClass, result.outcome, result.heldNfeIds], ["AMBIGUOUS", "HELD", [2]]);
    const claimed = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1), nfe(2, 2)],
      lines: [line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 4 }), line({ stockDocumentItemId: "c", nfeExternalId: 2, quantity: 6, claimedByOtherOrders: true })],
    });
    assert.equal(classifyOrderInvoiceEvidence(claimed, [1, 2]).evidenceClass, "AMBIGUOUS");
    assert.equal(claimed.evidence.claimedLines, 1);
  });

  it("ausente: sem documento de saída com item oficial; NF-e única só passa com prova de faturamento integral", () => {
    const none = resolveOrderInvoiceAllocation({ items: ITEMS, nfes: [nfe(1, 1), nfe(2, 2)], lines: [] });
    assert.deepEqual(classifyOrderInvoiceEvidence(none, [1, 2]).evidenceClass, "NO_EVIDENCE");
    assert.deepEqual(classifyOrderInvoiceEvidence(none, [1, 2]).heldNfeIds, [1, 2]);
    const proven = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1)],
      lines: [],
      singleNfeBillingProof: { status: "FULL", source: "NFE_PRODUCTS_VALUE", reason: "valor" },
    });
    assert.deepEqual(
      [classifyOrderInvoiceEvidence(proven, [1]).evidenceClass, classifyOrderInvoiceEvidence(proven, [1]).outcome, proven.singleNfeBillingProof?.status],
      ["NO_EVIDENCE", "LEGACY_FULL", "FULL"]
    );
    const unproven = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1)],
      lines: [],
      singleNfeBillingProof: { status: "UNPROVEN", source: "NONE", reason: "sem valor" },
    });
    assert.equal(classifyOrderInvoiceEvidence(unproven, [1]).outcome, "HELD");
  });

  it("linha do documento: identifica o identificador oficial presente, sem resolver", () => {
    const refs = (partial: Partial<Parameters<typeof classifyOutputDocumentLineRefs>[0]>) =>
      classifyOutputDocumentLineRefs({ externalSalesOrderItemId: null, salesOrderItemSequence: null, externalSalesOrderId: null, orderCodeNormalized: null, ...partial });
    assert.equal(refs({ externalSalesOrderItemId: 7 }), "ITEM_ID");
    assert.equal(refs({ salesOrderItemSequence: "00001", externalSalesOrderId: 3 }), "ITEM_SEQUENCE");
    assert.equal(refs({ externalSalesOrderId: 3 }), "ORDER_ONLY");
    assert.equal(refs({}), "NONE");
  });

  it("resumo: contagens por classe, efeito e prova da NF-e única, com a comissão hoje programada", () => {
    const row = (partial: Partial<InvoiceEvidenceAuditRow>): InvoiceEvidenceAuditRow => ({
      salesOrderId: "x",
      orderCode: "x",
      validNfeCount: 1,
      proofStatus: null,
      proofSource: null,
      activeSnapshotCommission: 0,
      evidenceClass: "UNEQUIVOCAL",
      outcome: "LEGACY_FULL",
      heldNfeIds: [],
      reasons: [],
      ...partial,
    });
    const summary = summarizeInvoiceEvidenceAudit([
      row({ activeSnapshotCommission: 10, proofStatus: "FULL", proofSource: "NFE_PRODUCTS_VALUE", evidenceClass: "NO_EVIDENCE" }),
      row({ activeSnapshotCommission: 20.5, outcome: "HELD", proofStatus: "PARTIAL", proofSource: "ITEMIZED_COVERAGE", evidenceClass: "NO_EVIDENCE" }),
      row({ activeSnapshotCommission: 30, validNfeCount: 3, outcome: "ALLOCATED" }),
    ]);
    assert.deepEqual(summary.byClass, { UNEQUIVOCAL: 1, AMBIGUOUS: 0, NO_EVIDENCE: 2 });
    assert.deepEqual(summary.byOutcome.HELD, { orders: 1, activeSnapshotCommission: 20.5 });
    assert.deepEqual(summary.singleNfeProof, { "FULL · NFE_PRODUCTS_VALUE": 1, "PARTIAL · ITEMIZED_COVERAGE": 1 });
    assert.equal(summary.multiNfeOrders, 1);
  });
});
