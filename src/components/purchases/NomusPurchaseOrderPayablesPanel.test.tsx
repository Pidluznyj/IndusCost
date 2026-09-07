/**
 * Aba Financeiro do Pedido Nomus — painel de Contas a Pagar (render estático).
 * O painel só apresenta o que o servidor calculou; aqui garantimos que cada
 * estado aparece, que as ações respeitam a permissão e que nada é inventado.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  LinkedPayableView,
  PurchaseOrderPayableReconciliation,
} from "@/src/lib/nomus/nomusPurchaseOrderPayableLink";
import { NomusPurchaseOrderPayablesPanelView } from "./NomusPurchaseOrderPayablesPanel";

const linked: LinkedPayableView = {
  payableExternalId: 9001,
  installmentIndex: 0,
  method: "DIRECT_NOMUS_NFE",
  methodLabel: "NF-e do pedido",
  confidence: "EXACT",
  evidence: "NF-e 501 declarada no pedido",
  linkId: null,
  linkedByUserName: null,
  linkedAt: null,
  sourceInvoiceNumber: "501",
  personName: "ACME",
  dueDate: "2026-10-16T00:00:00.000Z",
  paymentDate: "2026-10-15T00:00:00.000Z",
  settlementDate: "2026-10-15T00:00:00.000Z",
  amountPayable: 1136.68,
  amountPaid: 1136.68,
  realizedAmount: 1136.68,
  openAmount: 0,
  balancePayable: 0,
  paymentMethodName: "Boleto",
  status: "SETTLED",
  statusLabel: "Baixado",
  isSettled: true,
  linkedToOtherOrder: false,
};

const confirmed: LinkedPayableView = {
  ...linked,
  payableExternalId: 9002,
  installmentIndex: 1,
  method: "INSTALLMENT_MATCH",
  methodLabel: "Parcela conferida",
  confidence: "CONFIRMED",
  linkId: "link-9002",
  linkedByUserName: "Paulo",
  paymentDate: null,
  settlementDate: null,
  amountPaid: 0,
  realizedAmount: 0,
  openAmount: 1136.68,
  status: "OPEN",
  statusLabel: "Em aberto",
  isSettled: false,
  linkedToOtherOrder: true,
};

const data: PurchaseOrderPayableReconciliation = {
  orderId: "o1",
  orderExternalId: 613,
  orderNumber: "PC00612",
  installments: [
    {
      index: 0,
      dueDate: "2026-10-16T00:00:00.000Z",
      dueDateRaw: "16/10/2026",
      amount: 1136.68,
      paymentMethodId: 10,
      bankAccountId: 3,
      generatesAdvance: false,
      payables: [linked],
      suggestions: [],
      linkedAmount: 1136.68,
      paidAmount: 1136.68,
      openAmount: 0,
      status: "PAID",
      statusLabel: "Baixada",
    },
    {
      index: 1,
      dueDate: "2026-10-30T00:00:00.000Z",
      dueDateRaw: "30/10/2026",
      amount: 1136.68,
      paymentMethodId: 10,
      bankAccountId: 3,
      generatesAdvance: false,
      payables: [confirmed],
      suggestions: [],
      linkedAmount: 1136.68,
      paidAmount: 0,
      openAmount: 1136.68,
      status: "LINKED",
      statusLabel: "Título vinculado",
    },
    {
      index: 2,
      dueDate: "2026-11-09T00:00:00.000Z",
      dueDateRaw: "09/11/2026",
      amount: 1171.14,
      paymentMethodId: 10,
      bankAccountId: 3,
      generatesAdvance: false,
      payables: [],
      suggestions: [
        {
          payableExternalId: 9003,
          installmentIndex: 2,
          method: "INSTALLMENT_MATCH",
          requiresConfirmation: true,
          matchedOn: { supplier: true, company: true, amount: true, dueDate: true, paymentMethod: true, bankAccount: false },
          evidence: "parcela 3 · vencimento 2026-11-09 · valor 1171.14",
          linkedToOtherOrder: false,
        },
      ],
      linkedAmount: 0,
      paidAmount: 0,
      openAmount: 0,
      status: "UNLINKED",
      statusLabel: "Sem título vinculado",
    },
  ],
  unassignedPayables: [],
  suggestions: [],
  totals: {
    plannedAmount: 3444.5,
    plannedCount: 3,
    linkedCount: 2,
    linkedAmount: 2273.36,
    paidAmount: 1136.68,
    openAmount: 1136.68,
    unlinkedInstallmentCount: 1,
    suggestionCount: 1,
  },
  financialStatus: "PARTIALLY_PAID",
  fullySettled: false,
  warnings: ["Título 9002 também está vinculado a outro pedido — confira para não contar o pagamento duas vezes."],
};

const noop = () => undefined;

function render(overrides: Partial<React.ComponentProps<typeof NomusPurchaseOrderPayablesPanelView>> = {}) {
  return renderToStaticMarkup(
    <NomusPurchaseOrderPayablesPanelView
      data={data}
      loading={false}
      error={null}
      busyKey={null}
      actionError={null}
      canLink
      onRefresh={noop}
      onConfirmSuggestion={noop}
      onUnlink={noop}
      onManualLink={noop}
      {...overrides}
    />
  );
}

describe("NomusPurchaseOrderPayablesPanelView", () => {
  it("mostra totais, situação derivada, avisos e cada parcela com seus títulos", () => {
    const html = render();
    assert.match(html, /data-testid="npo-payables-panel"/);
    assert.match(html, /Parcial pago/);
    assert.match(html, /data-testid="npo-payables-warnings"/);
    assert.match(html, /também está vinculado a outro pedido/);
    assert.match(html, /data-testid="npo-installment-0"/);
    assert.match(html, /data-testid="npo-installment-2"/);
    assert.match(html, /data-testid="npo-linked-payable-9001"/);
    assert.match(html, /NF-e do pedido/);
    assert.match(html, /Baixado/);
    assert.match(html, /Parcela conferida · Paulo/);
    assert.match(html, /Em outro pedido/);
    assert.match(html, /1 título\(s\)|2 título\(s\)/);
  });

  it("vínculo automático (EXACT, sem linkId) não oferece desvincular; confirmado oferece", () => {
    const html = render();
    assert.doesNotMatch(html, /data-testid="npo-unlink-9001"/);
    assert.match(html, /data-testid="npo-unlink-9002"/);
  });

  it("sugestão pendente pede confirmação humana e nunca aparece como vínculo", () => {
    const html = render();
    assert.match(html, /data-testid="npo-suggestion-9003"/);
    assert.match(html, /data-testid="npo-confirm-suggestion-9003"/);
    assert.match(html, /Sugestão — parcela 3/);
    assert.doesNotMatch(html, /data-testid="npo-linked-payable-9003"/);
  });

  it("sem permissão de edição: nada de confirmar, desvincular ou vincular manualmente", () => {
    const html = render({ canLink: false });
    assert.doesNotMatch(html, /npo-confirm-suggestion-/);
    assert.doesNotMatch(html, /npo-unlink-/);
    assert.doesNotMatch(html, /npo-manual-link-form/);
    assert.match(html, /Confirmação exige permissão de edição em Compras/);
  });

  it("com permissão: formulário manual exige título e motivo; parcelas viram opções", () => {
    const html = render();
    assert.match(html, /data-testid="npo-manual-link-form"/);
    assert.match(html, /Motivo \(obrigatório\)/);
    assert.match(html, /<option value="2">Parcela 3<\/option>/);
    assert.match(html, /<button type="submit" disabled=""[^>]*data-testid="npo-manual-submit"/);
  });

  it("pedido quitado mostra 'Quitado'; erro e carregamento têm marcadores próprios", () => {
    const paid = render({ data: { ...data, fullySettled: true, financialStatus: "PAID" } });
    assert.match(paid, /data-testid="npo-payables-status"[^>]*><span class="truncate">Quitado</);

    const failed = render({ data: null, error: "Falha ao carregar os títulos do pedido." });
    assert.match(failed, /data-testid="npo-payables-error"/);
    assert.doesNotMatch(failed, /npo-payables-installments/);

    const loading = render({ data: null, loading: true });
    assert.match(loading, /data-testid="npo-payables-loading"/);

    const actionFailed = render({ actionError: "Este título já está vinculado a este pedido." });
    assert.match(actionFailed, /data-testid="npo-payables-action-error"/);
  });

  it("pedido sem parcelas explica em vez de inventar linhas", () => {
    const html = render({
      data: { ...data, installments: [], totals: { ...data.totals, plannedCount: 0, unlinkedInstallmentCount: 0 } },
    });
    assert.match(html, /O pedido não traz parcelas planejadas\./);
  });
});
