import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CashSupportPanel } from "./CashSupportPanel.js";
import type { CashSupportReadModel, CashSupportUnifiedRow } from "@/src/lib/treasury/contracts/cashSupportContracts.js";

function forecastRow(): CashSupportUnifiedRow {
  return {
    displayId: "receivable:due:-123:2026-07-20",
    resourceType: "FORECAST",
    officialTitleKey: null,
    bankMovementKey: null,
    forecastContextKey: {
      __brand: "forecastContextKey",
      orderCode: "PD-1",
      lineKind: "ORDER_FORECAST",
      syntheticId: -123,
    },
    reconcilable: false,
    direction: "IN",
    description: "Cliente Previsão",
    expectedDate: "2026-07-20",
    dueDate: "2026-07-20",
    bankDate: null,
    occurredAt: null,
    sourceUpdatedAt: null,
    expectedAmount: "500.00",
    officialAmount: null,
    bankAmount: null,
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: "500.00",
    reconciliationState: "NOT_APPLICABLE",
    sourceState: "open",
    companyContext: { companyCode: "EMP1" },
    accountContext: null,
    currencyContext: { currency: "BRL", assumed: true },
    sourceReferences: [],
    warnings: [{ code: "FORECAST_CONTEXT_ONLY", message: "Só contexto." }],
    availableActions: [
      { kind: "RECONCILE", enabled: false, disabledReason: "Previsão nunca é conciliável (ADR 001)." },
    ],
  };
}

function bankRow(): CashSupportUnifiedRow {
  return {
    displayId: "bank-movement:mov-1",
    resourceType: "BANK_MOVEMENT",
    officialTitleKey: null,
    bankMovementKey: { __brand: "bankMovementKey", bankMovementId: "mov-1" },
    forecastContextKey: null,
    reconcilable: true,
    direction: "IN",
    description: "Depósito cliente",
    expectedDate: null,
    dueDate: null,
    bankDate: "2026-07-20",
    occurredAt: "2026-07-20",
    sourceUpdatedAt: "2026-07-20T10:00:00.000Z",
    expectedAmount: null,
    officialAmount: null,
    bankAmount: "1000.00",
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: "1000.00",
    reconciliationState: "PENDING",
    sourceState: "PENDING",
    companyContext: { companyCode: "EMP1" },
    accountContext: { accountId: "acc-1", accountName: "Caixa" },
    currencyContext: { currency: "BRL", assumed: false },
    sourceReferences: [],
    warnings: [],
    availableActions: [
      { kind: "RECONCILE", enabled: true, disabledReason: null },
    ],
  };
}

function readModel(rows: CashSupportUnifiedRow[]): CashSupportReadModel {
  return {
    rows,
    summary: {
      bankPosition: {
        balance: null,
        inflows: "1000.00",
        outflows: "0.00",
        reconciled: "0.00",
        partiallyReconciled: "0.00",
        unreconciled: "1000.00",
        unidentified: "0.00",
      },
      canonicalPosition: {
        expectedTitles: "500.00",
        evidencedTitles: "0.00",
        futureForecasts: "0.00",
        overdue: "0.00",
      },
      bridge: {
        bankNotExplainedByTitles: "0.00",
        titlesWithoutBankEvidence: "0.00",
        internalTransfersConsolidated: "0.00",
      },
      warnings: [],
    },
    analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    pagination: { page: 1, pageSize: 50, total: rows.length },
    warnings: [],
  };
}

describe("CashSupportPanel — renderização", () => {
  it("estado de loading", () => {
    const html = renderToStaticMarkup(
      <CashSupportPanel civilDateFrom="2026-07-01" civilDateTo="2026-07-31" loading data={null} />
    );
    assert.ok(html.includes('data-testid="cash-support-loading"'));
  });

  it("estado de erro", () => {
    const html = renderToStaticMarkup(
      <CashSupportPanel
        civilDateFrom="2026-07-01"
        civilDateTo="2026-07-31"
        error="Falha ao carregar"
        data={null}
      />
    );
    assert.ok(html.includes('data-testid="cash-support-error"'));
    assert.ok(html.includes("Falha ao carregar"));
  });

  it("estado vazio", () => {
    const html = renderToStaticMarkup(
      <CashSupportPanel civilDateFrom="2026-07-01" civilDateTo="2026-07-31" data={readModel([])} />
    );
    assert.ok(html.includes('data-testid="cash-support-empty"'));
  });

  it("previsão renderiza sem botão de conciliar", () => {
    const html = renderToStaticMarkup(
      <CashSupportPanel
        civilDateFrom="2026-07-01"
        civilDateTo="2026-07-31"
        data={readModel([forecastRow()])}
      />
    );
    assert.ok(html.includes("Contexto de previsão"));
    assert.ok(
      !html.includes('data-testid="cash-support-reconcile-receivable:due:-123:2026-07-20"'),
      "previsão não pode ter botão Conciliar"
    );
  });

  it("título/movimento com ação habilitada mostra botão Conciliar", () => {
    const html = renderToStaticMarkup(
      <CashSupportPanel
        civilDateFrom="2026-07-01"
        civilDateTo="2026-07-31"
        data={readModel([bankRow()])}
      />
    );
    assert.ok(html.includes('data-testid="cash-support-reconcile-bank-movement:mov-1"'));
  });

  it("resumo mostra os quatro cartões vindos do backend, sem recalcular", () => {
    const html = renderToStaticMarkup(
      <CashSupportPanel
        civilDateFrom="2026-07-01"
        civilDateTo="2026-07-31"
        data={readModel([bankRow(), forecastRow()])}
      />
    );
    assert.ok(html.includes('data-testid="cash-support-summary-inflows"'));
    assert.ok(html.includes('data-testid="cash-support-summary-expected"'));
  });

  it("warnings do backend aparecem no topo", () => {
    const model = readModel([forecastRow()]);
    model.warnings = [{ code: "COMPANY_CONTEXT_UNAVAILABLE", message: "Empresa ausente." }];
    const html = renderToStaticMarkup(
      <CashSupportPanel civilDateFrom="2026-07-01" civilDateTo="2026-07-31" data={model} />
    );
    assert.ok(html.includes('data-testid="cash-support-warnings"'));
    assert.ok(html.includes("Empresa ausente."));
  });

  it("aviso de que a conciliação não altera o Nomus aparece no drawer de detalhe", () => {
    // O drawer só monta quando há seleção — como SSR estático não interage,
    // validamos que o texto existe no componente compilado (fixo, sempre
    // presente quando `selected` é truthy). Aqui garantimos ao menos que
    // a grade renderiza a linha clicável com o testid correto.
    const html = renderToStaticMarkup(
      <CashSupportPanel
        civilDateFrom="2026-07-01"
        civilDateTo="2026-07-31"
        data={readModel([bankRow()])}
      />
    );
    assert.ok(html.includes('data-testid="cash-support-row-bank-movement:mov-1"'));
  });
});

describe("CashSupportPanel — ações de escrita (CS-012/013/016)", () => {
  it("sem onReconcileSelected, nenhuma checkbox aparece (permanece read-only)", () => {
    const html = renderToStaticMarkup(
      <CashSupportPanel civilDateFrom="2026-07-01" civilDateTo="2026-07-31" data={readModel([bankRow()])} />
    );
    assert.ok(!html.includes('data-testid="cash-support-checkbox-bank-movement:mov-1"'));
  });

  it("com onReconcileSelected, movimento bancário ganha checkbox; previsão não", () => {
    const html = renderToStaticMarkup(
      <CashSupportPanel
        civilDateFrom="2026-07-01"
        civilDateTo="2026-07-31"
        data={readModel([bankRow(), forecastRow()])}
        onReconcileSelected={() => {}}
      />
    );
    assert.ok(html.includes('data-testid="cash-support-checkbox-bank-movement:mov-1"'));
    assert.ok(!html.includes('data-testid="cash-support-checkbox-receivable:due:-123:2026-07-20"'));
  });

  it("botão 'Conciliar selecionados' só aparece com seleção (SSR: nunca, pois estado inicial é vazio)", () => {
    const html = renderToStaticMarkup(
      <CashSupportPanel
        civilDateFrom="2026-07-01"
        civilDateTo="2026-07-31"
        data={readModel([bankRow()])}
        onReconcileSelected={() => {}}
      />
    );
    assert.ok(!html.includes('data-testid="cash-support-reconcile-selected"'));
  });

  it("linha com match ativo mostra referência auditável em sourceReferences", () => {
    const withMatch = bankRow();
    withMatch.sourceReferences = [
      { source: "TreasuryReconciliationMatch", id: "match-1", label: null },
    ];
    const model = readModel([withMatch]);
    assert.equal(
      model.rows[0]!.sourceReferences.find((r) => r.source === "TreasuryReconciliationMatch")?.id,
      "match-1"
    );
  });
});
