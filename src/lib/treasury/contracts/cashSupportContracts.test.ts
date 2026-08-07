/**
 * Testes de contrato do Apoio ao Caixa — as regras da ADR 001 viram
 * impossibilidade de tipo/runtime, não convenção documentada.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCashSupportRowInvariants,
  buildCashSupportBankMovementKey,
  buildCashSupportForecastContextKey,
  buildCashSupportOfficialTitleKey,
  CashSupportIdentityError,
  formatCashSupportOfficialTitleKey,
  type CashSupportUnifiedRow,
} from "./cashSupportContracts.js";

function baseRow(
  overrides: Partial<CashSupportUnifiedRow> = {}
): CashSupportUnifiedRow {
  return {
    displayId: "row-1",
    resourceType: "BANK_MOVEMENT",
    officialTitleKey: null,
    bankMovementKey: buildCashSupportBankMovementKey("mov-1"),
    forecastContextKey: null,
    reconcilable: true,
    direction: "IN",
    description: null,
    expectedDate: null,
    dueDate: null,
    bankDate: "2026-07-20",
    occurredAt: null,
    sourceUpdatedAt: null,
    expectedAmount: null,
    officialAmount: null,
    bankAmount: "1000.00",
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: "1000.00",
    reconciliationState: "PENDING",
    sourceState: null,
    companyContext: { companyCode: "EMP1" },
    accountContext: { accountId: "acc-1", accountName: "Caixa" },
    currencyContext: { currency: "BRL", assumed: false },
    sourceReferences: [],
    warnings: [],
    availableActions: [],
    ...overrides,
  };
}

describe("cashSupportContracts — identidades", () => {
  it("título oficial exige externalId positivo", () => {
    const key = buildCashSupportOfficialTitleKey({
      companyCode: "EMP1",
      side: "ACCOUNTS_RECEIVABLE",
      externalId: 1001,
    });
    assert.equal(formatCashSupportOfficialTitleKey(key), "EMP1:ACCOUNTS_RECEIVABLE:1001");
  });

  it("id sintético de previsão é rejeitado como título oficial", () => {
    // FIN-08 gera id negativo para previsão — não pode virar chave conciliável.
    assert.throws(
      () =>
        buildCashSupportOfficialTitleKey({
          companyCode: "EMP1",
          side: "ACCOUNTS_RECEIVABLE",
          externalId: -1739283,
        }),
      CashSupportIdentityError
    );
  });

  it("externalId zero é rejeitado", () => {
    assert.throws(
      () =>
        buildCashSupportOfficialTitleKey({
          companyCode: "EMP1",
          side: "ACCOUNTS_PAYABLE",
          externalId: 0,
        }),
      CashSupportIdentityError
    );
  });

  it("companyCode vazio é rejeitado", () => {
    assert.throws(
      () =>
        buildCashSupportOfficialTitleKey({
          companyCode: "  ",
          side: "ACCOUNTS_RECEIVABLE",
          externalId: 1,
        }),
      CashSupportIdentityError
    );
  });

  it("identidades não são intercambiáveis (marcas distintas)", () => {
    const title = buildCashSupportOfficialTitleKey({
      companyCode: "EMP1",
      side: "ACCOUNTS_RECEIVABLE",
      externalId: 7,
    });
    const movement = buildCashSupportBankMovementKey("mov-9");
    const forecast = buildCashSupportForecastContextKey({
      orderCode: "PD-1",
      lineKind: "ORDER_PLAN_FORECAST",
      syntheticId: -55,
    });
    assert.equal(title.__brand, "officialTitleKey");
    assert.equal(movement.__brand, "bankMovementKey");
    assert.equal(forecast.__brand, "forecastContextKey");
    assert.notEqual(title.__brand, forecast.__brand);
  });

  it("previsão aceita id negativo na sua própria chave", () => {
    const key = buildCashSupportForecastContextKey({
      orderCode: "PD-42",
      lineKind: "ORDER_RESIDUAL_FORECAST",
      syntheticId: -998,
    });
    assert.equal(key.syntheticId, -998);
  });
});

describe("cashSupportContracts — invariantes da linha", () => {
  it("linha bancária válida passa", () => {
    assert.doesNotThrow(() => assertCashSupportRowInvariants(baseRow()));
  });

  it("previsão conciliável é rejeitada", () => {
    assert.throws(
      () =>
        assertCashSupportRowInvariants(
          baseRow({
            resourceType: "FORECAST",
            reconcilable: true,
            bankMovementKey: null,
            bankDate: null,
          })
        ),
      CashSupportIdentityError
    );
  });

  it("previsão não pode carregar officialTitleKey", () => {
    assert.throws(
      () =>
        assertCashSupportRowInvariants(
          baseRow({
            resourceType: "FORECAST",
            reconcilable: false,
            bankMovementKey: null,
            bankDate: null,
            officialTitleKey: buildCashSupportOfficialTitleKey({
              companyCode: "EMP1",
              side: "ACCOUNTS_RECEIVABLE",
              externalId: 5,
            }),
          })
        ),
      CashSupportIdentityError
    );
  });

  it("previsão não pode ter bankDate", () => {
    assert.throws(
      () =>
        assertCashSupportRowInvariants(
          baseRow({
            resourceType: "FORECAST",
            reconcilable: false,
            bankMovementKey: null,
            bankDate: "2026-07-20",
          })
        ),
      CashSupportIdentityError
    );
  });

  it("previsão não pode oferecer ação de conciliar habilitada", () => {
    assert.throws(
      () =>
        assertCashSupportRowInvariants(
          baseRow({
            resourceType: "FORECAST",
            reconcilable: false,
            bankMovementKey: null,
            bankDate: null,
            availableActions: [
              { kind: "RECONCILE", enabled: true, disabledReason: null },
            ],
          })
        ),
      CashSupportIdentityError
    );
  });

  it("previsão com ação desabilitada é aceita", () => {
    assert.doesNotThrow(() =>
      assertCashSupportRowInvariants(
        baseRow({
          resourceType: "FORECAST",
          reconcilable: false,
          bankMovementKey: null,
          bankDate: null,
          availableActions: [
            {
              kind: "RECONCILE",
              enabled: false,
              disabledReason: "Contexto de previsão — não conciliável.",
            },
          ],
        })
      )
    );
  });

  it("conciliável sem título nem movimento é rejeitado", () => {
    assert.throws(
      () =>
        assertCashSupportRowInvariants(
          baseRow({
            resourceType: "ADJUSTMENT",
            reconcilable: true,
            bankMovementKey: null,
            bankDate: null,
          })
        ),
      CashSupportIdentityError
    );
  });

  it("bankDate sem movimento bancário é rejeitado", () => {
    assert.throws(
      () =>
        assertCashSupportRowInvariants(
          baseRow({
            resourceType: "OFFICIAL_RECEIVABLE",
            reconcilable: true,
            bankMovementKey: null,
            bankDate: "2026-07-20",
            officialTitleKey: buildCashSupportOfficialTitleKey({
              companyCode: "EMP1",
              side: "ACCOUNTS_RECEIVABLE",
              externalId: 10,
            }),
          })
        ),
      CashSupportIdentityError
    );
  });

  it("título oficial sem evidência bancária é válido (dueDate, sem bankDate)", () => {
    assert.doesNotThrow(() =>
      assertCashSupportRowInvariants(
        baseRow({
          resourceType: "OFFICIAL_RECEIVABLE",
          reconcilable: true,
          bankMovementKey: null,
          bankDate: null,
          dueDate: "2026-07-25",
          officialAmount: "5000.00",
          bankAmount: null,
          officialTitleKey: buildCashSupportOfficialTitleKey({
            companyCode: "EMP1",
            side: "ACCOUNTS_RECEIVABLE",
            externalId: 11,
          }),
        })
      )
    );
  });

  it("contexto ausente é null explícito, nunca inventado", () => {
    const row = baseRow({ companyContext: null, accountContext: null });
    assert.equal(row.companyContext, null);
    assert.equal(row.accountContext, null);
    assert.doesNotThrow(() => assertCashSupportRowInvariants(row));
  });

  it("valores monetários são string, nunca number", () => {
    const row = baseRow();
    assert.equal(typeof row.allocatedAmount, "string");
    assert.equal(typeof row.residualAmount, "string");
    assert.equal(typeof row.bankAmount, "string");
  });
});
