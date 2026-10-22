import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockedCustomerDocumentAlert } from "./blockedCustomerDocumentAlert.js";

const blocked = {
  customerStatus: "BLOQUEADO",
  decisionTitle: "CRÉDITO BLOQUEADO",
  reasonLabel: "Risco compartilhado",
};

describe("aviso de documento para cliente bloqueado", () => {
  it("proposta em aberto de cliente bloqueado explica o motivo e o prazo", () => {
    const alert = blockedCustomerDocumentAlert({
      ...blocked,
      kind: "proposal",
      documentStatus: "SENT",
      paymentTerms: "30",
    });
    assert.equal(alert?.label, "Crédito bloqueado");
    assert.match(alert?.title ?? "", /CRÉDITO BLOQUEADO\. Risco compartilhado\./);
    assert.match(alert?.title ?? "", /proposta/);
    assert.match(alert?.title ?? "", /a prazo/);
  });

  it("proposta à vista continua visível para análise", () => {
    const alert = blockedCustomerDocumentAlert({
      ...blocked,
      kind: "proposal",
      documentStatus: "APPROVED",
      paymentTerms: "À vista",
    });
    assert.match(alert?.title ?? "", /à vista/);
  });

  it("proposta encerrada e cliente liberado ou em análise não pintam a linha", () => {
    assert.equal(
      blockedCustomerDocumentAlert({ ...blocked, kind: "proposal", documentStatus: "CANCELED", paymentTerms: "30" }),
      null
    );
    assert.equal(
      blockedCustomerDocumentAlert({
        customerStatus: "LIBERADO",
        kind: "proposal",
        documentStatus: "SENT",
        paymentTerms: "30",
      }),
      null
    );
    assert.equal(
      blockedCustomerDocumentAlert({
        customerStatus: "EM_ANALISE",
        kind: "sales_order",
        documentStatus: "SENT_TO_NOMUS",
        hasProposal: false,
      }),
      null
    );
  });

  it("pedido importado sem proposta marca a exceção", () => {
    const alert = blockedCustomerDocumentAlert({
      ...blocked,
      customerStatus: "BLOQUEIO_CRITICO",
      kind: "sales_order",
      documentStatus: "SENT_TO_NOMUS",
      hasProposal: false,
    });
    assert.equal(alert?.label, "Crédito bloqueado · sem proposta");
    assert.match(alert?.title ?? "", /sem proposta/);
    assert.match(alert?.title ?? "", /Confira se a condição é à vista/);
  });

  it("pedido cancelado não pede ação", () => {
    assert.equal(
      blockedCustomerDocumentAlert({
        ...blocked,
        kind: "sales_order",
        documentStatus: "CANCELLED",
        hasProposal: true,
        paymentTerms: "30",
        paymentTermsKnown: true,
      }),
      null
    );
  });
});
