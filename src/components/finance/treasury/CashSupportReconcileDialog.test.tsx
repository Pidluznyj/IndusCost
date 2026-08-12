import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CashSupportReconcileDialog,
  type CashSupportReconcileSubmitPayload,
} from "./CashSupportReconcileDialog.js";
import type { CashSupportUnifiedRow } from "@/src/lib/treasury/contracts/cashSupportContracts.js";

function movementRow(overrides: Partial<CashSupportUnifiedRow> = {}): CashSupportUnifiedRow {
  return {
    displayId: "bank-movement:mov-1",
    resourceType: "BANK_MOVEMENT",
    officialTitleKey: null,
    bankMovementKey: { __brand: "bankMovementKey", bankMovementId: "mov-1" },
    forecastContextKey: null,
    reconcilable: true,
    direction: "IN",
    description: "Depósito",
    expectedDate: null,
    dueDate: null,
    bankDate: "2026-07-20",
    occurredAt: "2026-07-20",
    sourceUpdatedAt: null,
    expectedAmount: null,
    officialAmount: null,
    bankAmount: "10000.00",
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: "10000.00",
    reconciliationState: "PENDING",
    sourceState: "PENDING",
    companyContext: { companyCode: "EMP1" },
    accountContext: { accountId: "acc-1", accountName: "Caixa" },
    currencyContext: { currency: "BRL", assumed: false },
    sourceReferences: [],
    warnings: [],
    availableActions: [],
    ...overrides,
  };
}

function titleRow(overrides: Partial<CashSupportUnifiedRow> = {}): CashSupportUnifiedRow {
  return {
    displayId: "receivable:due:900:2026-07-20",
    resourceType: "OFFICIAL_RECEIVABLE",
    officialTitleKey: {
      __brand: "officialTitleKey",
      companyCode: "EMP1",
      side: "ACCOUNTS_RECEIVABLE",
      externalId: 900,
    },
    bankMovementKey: null,
    forecastContextKey: null,
    reconcilable: true,
    direction: "IN",
    description: "Cliente A",
    expectedDate: null,
    dueDate: "2026-07-20",
    bankDate: null,
    occurredAt: null,
    sourceUpdatedAt: null,
    expectedAmount: null,
    officialAmount: "10000.00",
    bankAmount: null,
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: "10000.00",
    reconciliationState: "NOT_APPLICABLE",
    sourceState: "open",
    companyContext: { companyCode: "EMP1" },
    accountContext: null,
    currencyContext: { currency: "BRL", assumed: true },
    sourceReferences: [],
    warnings: [],
    availableActions: [],
    ...overrides,
  };
}

describe("CashSupportReconcileDialog — renderização", () => {
  it("fechado não renderiza nada", () => {
    const html = renderToStaticMarkup(
      <CashSupportReconcileDialog
        open={false}
        movements={[movementRow()]}
        candidateTitles={[titleRow()]}
        onCancel={() => {}}
        onSubmit={() => {}}
      />
    );
    assert.equal(html, "");
  });

  it("aberto mostra movimento, título candidato e simulação", () => {
    const html = renderToStaticMarkup(
      <CashSupportReconcileDialog
        open
        movements={[movementRow()]}
        candidateTitles={[titleRow()]}
        onCancel={() => {}}
        onSubmit={() => {}}
      />
    );
    assert.ok(html.includes('data-testid="cash-support-reconcile-dialog"'));
    assert.ok(html.includes('data-testid="cash-support-reconcile-preview"'));
    assert.ok(html.includes("Cliente A"));
  });

  it("candidato de título só inclui OFFICIAL_*, nunca FORECAST (garantido pelo tipo de props)", () => {
    // O componente não filtra internamente — é contrato do chamador só
    // passar títulos reais. Este teste documenta a invariante esperada.
    const html = renderToStaticMarkup(
      <CashSupportReconcileDialog
        open
        movements={[movementRow()]}
        candidateTitles={[titleRow()]}
        onCancel={() => {}}
        onSubmit={() => {}}
      />
    );
    assert.ok(!html.includes("Contexto de previsão"));
  });

  it("aviso de não-oficialidade sempre presente", () => {
    const html = renderToStaticMarkup(
      <CashSupportReconcileDialog
        open
        movements={[movementRow()]}
        candidateTitles={[]}
        onCancel={() => {}}
        onSubmit={() => {}}
      />
    );
    assert.ok(html.includes("não altera baixa, vencimento ou saldo oficial no Nomus"));
  });

  it("erro do backend é exibido quando fornecido", () => {
    const html = renderToStaticMarkup(
      <CashSupportReconcileDialog
        open
        movements={[movementRow()]}
        candidateTitles={[]}
        error="Movimento já integralmente conciliado."
        onCancel={() => {}}
        onSubmit={() => {}}
      />
    );
    assert.ok(html.includes('data-testid="cash-support-reconcile-error"'));
    assert.ok(html.includes("já integralmente conciliado"));
  });

  it("movimentos de contas diferentes são sinalizados como inconsistentes", () => {
    const html = renderToStaticMarkup(
      <CashSupportReconcileDialog
        open
        movements={[
          movementRow({ displayId: "m1", accountContext: { accountId: "acc-1", accountName: "A" } }),
          movementRow({ displayId: "m2", accountContext: { accountId: "acc-2", accountName: "B" } }),
        ]}
        candidateTitles={[]}
        onCancel={() => {}}
        onSubmit={() => {}}
      />
    );
    assert.ok(html.includes('data-testid="cash-support-reconcile-inconsistent"'));
  });

  it("botão de confirmar existe e está desabilitado sem candidato (não balanceado)", () => {
    const html = renderToStaticMarkup(
      <CashSupportReconcileDialog
        open
        movements={[movementRow()]}
        candidateTitles={[]}
        onCancel={() => {}}
        onSubmit={() => {}}
      />
    );
    const buttonTag = html.match(/<button[^>]*data-testid="cash-support-reconcile-submit"[^>]*>/)?.[0];
    assert.ok(buttonTag, "botão de confirmar deve existir");
    assert.ok(
      buttonTag!.includes('disabled=""'),
      "botão deve nascer desabilitado — nada foi alocado ainda"
    );
  });
});

describe("CashSupportReconcileDialog — tipos do payload de submit", () => {
  it("payload de submit tem o shape esperado pelo cliente de API oficial", () => {
    const payload: CashSupportReconcileSubmitPayload = {
      companyCode: "EMP1",
      accountId: "acc-1",
      justification: null,
      movements: [{ bankMovementId: "mov-1", amount: "10000.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "10000.00",
          memo: null,
          nomusSide: "AR",
          officialTitleId: "900",
          nomusExternalId: 900,
          openBalance: "10000.00",
        },
      ],
    };
    assert.equal(payload.allocations[0]!.kind, "TITLE");
    assert.equal(typeof payload.movements[0]!.amount, "string");
  });

  it("ajustes carregam a classificação oficial (differenceCode) junto do kind contábil", () => {
    // Tarifa que o banco somou ao débito: kind FEE + classificação TARIFA.
    const payload: CashSupportReconcileSubmitPayload = {
      companyCode: "EMP1",
      accountId: "acc-1",
      justification: "Tarifa bancária destacada no extrato",
      movements: [{ bankMovementId: "mov-1", amount: "1005.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "1000.00",
          memo: null,
          nomusSide: "AP",
          officialTitleId: "700",
          nomusExternalId: 700,
          openBalance: "1000.00",
        },
        { kind: "FEE", amount: "5.00", memo: null, differenceCode: "TARIFA" },
      ],
    };
    assert.equal(payload.allocations[1]!.differenceCode, "TARIFA");
  });
});
