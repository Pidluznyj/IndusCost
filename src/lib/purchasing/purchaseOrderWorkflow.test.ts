import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAwardApprovedForPo,
  assertQuotationAdjudicated,
  buildOperationalCommitmentMeta,
  PurchaseOrderWorkflowError,
  resolvePurchaseOrderTransition,
} from "./purchaseOrderWorkflow.js";
import { buildPurchaseOrderPdfLines } from "./purchaseOrderPdf.js";

describe("purchaseOrderWorkflow (OP-20)", () => {
  it("aprova rascunho → APROVADO; envia → ENVIADO; confirma", () => {
    assert.equal(resolvePurchaseOrderTransition("RASCUNHO", "APPROVE"), "APROVADO");
    assert.equal(resolvePurchaseOrderTransition("APROVADO", "SEND"), "ENVIADO");
    assert.equal(resolvePurchaseOrderTransition("ENVIADO", "CONFIRM"), "CONFIRMADO");
  });

  it("permite marcar recebimento parcial/total a partir de confirmado", () => {
    assert.equal(
      resolvePurchaseOrderTransition("CONFIRMADO", "MARK_PARTIAL_RECEIVED"),
      "PARCIALMENTE_RECEBIDO"
    );
    assert.equal(resolvePurchaseOrderTransition("CONFIRMADO", "MARK_RECEIVED"), "RECEBIDO");
    assert.equal(
      resolvePurchaseOrderTransition("PARCIALMENTE_RECEBIDO", "MARK_RECEIVED"),
      "RECEBIDO"
    );
    assert.equal(
      resolvePurchaseOrderTransition("RECEBIDO", "MARK_PARTIAL_RECEIVED"),
      "PARCIALMENTE_RECEBIDO"
    );
  });

  it("exige adjudicação aprovada e cotação ADJUDICADA", () => {
    assert.throws(
      () => assertAwardApprovedForPo("PENDENTE_APROVACAO"),
      (e: unknown) => e instanceof PurchaseOrderWorkflowError && e.code === "AWARD_NOT_APPROVED"
    );
    assert.doesNotThrow(() => assertAwardApprovedForPo("APROVADA"));
    assert.throws(
      () => assertQuotationAdjudicated("EM_ANALISE"),
      (e: unknown) => e instanceof PurchaseOrderWorkflowError && e.code === "QUOTATION_NOT_AWARDED"
    );
  });

  it("compromisso operacional não cria AP nem estoque", () => {
    const meta = buildOperationalCommitmentMeta("2026-07-21T12:00:00.000Z");
    assert.equal(meta.futureEntryPending, true);
    assert.equal(meta.createsAccountsPayable, false);
    assert.equal(meta.increasesStock, false);
  });
});

describe("purchaseOrderPdf (OP-20)", () => {
  it("monta linhas com snapshots e aviso sem AP/estoque", () => {
    const lines = buildPurchaseOrderPdfLines({
      code: "PC-2026-0001",
      status: "APROVADO",
      supplierName: "Fornecedor X",
      supplierDocument: "00.000.000/0001-00",
      currency: "BRL",
      quotationCode: "SC-1-ABC",
      paymentTerms: "30 dias",
      deliveryTerms: "FOB",
      freightValue: 10,
      taxes: 2,
      discounts: 1,
      leadTimeDays: 15,
      totalAmount: 100,
      initialComparable: 120,
      negotiatedComparable: 100,
      totalGain: 20,
      awardJustification: "Melhor prazo.",
      evidenceCount: 2,
      operationalCommitmentAt: "2026-07-21T12:00:00.000Z",
      futureEntryPending: true,
      approvedAt: "2026-07-21T12:00:00.000Z",
      approvedBy: "Comprador",
      notes: null,
      items: [
        {
          lineNumber: 1,
          description: "MP A",
          materialCode: "MP-A",
          quantity: 10,
          unit: "KG",
          initialUnitPrice: 12,
          negotiatedUnitPrice: 10,
          lineTotal: 100,
          lineGain: 20,
        },
      ],
    });
    const blob = JSON.stringify(lines);
    assert.match(blob, /PC-2026-0001/);
    assert.match(blob, /sem Contas a Pagar/i);
    assert.match(blob, /sem estoque/i);
    assert.match(blob, /MP A/);
  });
});
