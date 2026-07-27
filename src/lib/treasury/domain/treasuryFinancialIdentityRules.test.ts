import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTreasuryFinancialGroupKey,
  buildTreasuryFinancialLogicalKey,
  clusterRealizedClaims,
  resolveTreasuryFinancialIdentities,
  TREASURY_FINANCIAL_PRECEDENCE,
  treasuryTransferConsolidatedImpact,
  type TreasuryFinancialClaim,
} from "./treasuryFinancialIdentityRules.js";

function claim(
  partial: Partial<TreasuryFinancialClaim> &
    Pick<TreasuryFinancialClaim, "id" | "source" | "amount">
): TreasuryFinancialClaim {
  return {
    side: "AR",
    installmentNumber: 1,
    officialTitleId: "11111111-1111-4111-8111-111111111111",
    nomusExternalId: 1001,
    ...partial,
  };
}

describe("treasuryFinancialIdentityRules — chave lógica", () => {
  it("chave lógica inclui fonte e parcela", () => {
    const c = claim({
      id: "c1",
      source: "FORECAST",
      amount: "100.00",
      installmentNumber: 2,
    });
    const key = buildTreasuryFinancialLogicalKey(c);
    assert.match(key, /\|FORECAST\|/);
    assert.match(key, /inst:2$/);
    assert.match(key, /^AR\|/);
  });

  it("grupo ignora fonte e une o mesmo título/parcela", () => {
    const a = claim({ id: "a", source: "FORECAST", amount: "100.00" });
    const b = claim({
      id: "b",
      source: "OFFICIAL_SETTLEMENT",
      amount: "100.00",
    });
    assert.equal(
      buildTreasuryFinancialGroupKey(a),
      buildTreasuryFinancialGroupKey(b)
    );
  });

  it("precedência: conciliado < baixa < realizado < previsão", () => {
    assert.ok(
      TREASURY_FINANCIAL_PRECEDENCE.RECONCILED_MOVEMENT <
        TREASURY_FINANCIAL_PRECEDENCE.OFFICIAL_SETTLEMENT
    );
    assert.ok(
      TREASURY_FINANCIAL_PRECEDENCE.OFFICIAL_SETTLEMENT <
        TREASURY_FINANCIAL_PRECEDENCE.REALIZED_UNRECONCILED
    );
    assert.ok(
      TREASURY_FINANCIAL_PRECEDENCE.REALIZED_UNRECONCILED <
        TREASURY_FINANCIAL_PRECEDENCE.FORECAST
    );
  });
});

describe("treasuryFinancialIdentityRules — casos de dupla contagem IndusCost", () => {
  it("pedido não é somado ao título (PD 02457 / order-nfe-cr)", () => {
    const titleId = "22222222-2222-4222-8222-222222222222";
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "title-forecast",
        source: "FORECAST",
        amount: "4104.19",
        openBalance: "4104.19",
        officialTitleId: titleId,
        salesOrderExternalId: 2457,
      }),
      {
        id: "order",
        source: "SALES_ORDER",
        side: "AR",
        amount: "4104.19",
        salesOrderExternalId: 2457,
        installmentNumber: 1,
      },
    ]);

    const cash = resolution.slices.filter((s) => s.includeInCashProjection);
    assert.equal(cash.length, 1);
    assert.equal(cash[0]?.source, "FORECAST");
    assert.equal(cash[0]?.amount, "4104.19");
    assert.equal(resolution.consolidatedCashTotal, "4104.19");
    assert.ok(resolution.suppressedClaimIds.includes("order"));
  });

  it("NF não é somada ao título", () => {
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "cr",
        source: "FORECAST",
        amount: "1000.00",
        openBalance: "1000.00",
        nfeExternalId: 6937,
      }),
      {
        id: "nfe",
        source: "NFE",
        side: "AR",
        amount: "1000.00",
        nfeExternalId: 6937,
        installmentNumber: 1,
      },
    ]);
    assert.equal(resolution.consolidatedCashTotal, "1000.00");
    assert.ok(resolution.suppressedClaimIds.includes("nfe"));
    assert.equal(
      resolution.slices.find((s) => s.claimId === "nfe")?.role,
      "CONTEXTUAL_SUPPRESSED"
    );
  });

  it("documento de saída não é somado ao título", () => {
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "cr",
        source: "FORECAST",
        amount: "500.00",
        openBalance: "500.00",
        outputDocumentExternalId: 88,
        salesOrderExternalId: 10,
      }),
      {
        id: "ds",
        source: "OUTPUT_DOCUMENT",
        side: "AR",
        amount: "500.00",
        outputDocumentExternalId: 88,
        salesOrderExternalId: 10,
        installmentNumber: 1,
      },
    ]);
    assert.equal(resolution.consolidatedCashTotal, "500.00");
    assert.ok(resolution.suppressedClaimIds.includes("ds"));
  });

  it("pedido + NF + DS + título: só o título conta (não há quatro recebíveis)", () => {
    const titleId = "33333333-3333-4333-8333-333333333333";
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "cr",
        source: "FORECAST",
        amount: "2000.00",
        openBalance: "2000.00",
        officialTitleId: titleId,
        salesOrderExternalId: 77,
        nfeExternalId: 88,
        outputDocumentExternalId: 99,
      }),
      {
        id: "order",
        source: "SALES_ORDER",
        side: "AR",
        amount: "2000.00",
        salesOrderExternalId: 77,
        installmentNumber: 1,
      },
      {
        id: "nfe",
        source: "NFE",
        side: "AR",
        amount: "2000.00",
        nfeExternalId: 88,
        installmentNumber: 1,
      },
      {
        id: "ds",
        source: "OUTPUT_DOCUMENT",
        side: "AR",
        amount: "2000.00",
        outputDocumentExternalId: 99,
        installmentNumber: 1,
      },
    ]);
    assert.equal(resolution.consolidatedCashTotal, "2000.00");
    assert.deepEqual(
      resolution.suppressedClaimIds.sort(),
      ["ds", "nfe", "order"].sort()
    );
  });

  it("previsão não é somada ao realizado (mesmo título liquidado)", () => {
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "settled",
        source: "OFFICIAL_SETTLEMENT",
        amount: "1000.00",
        settledAmount: "1000.00",
        openBalance: "0.00",
      }),
      claim({
        id: "forecast",
        source: "FORECAST",
        amount: "1000.00",
        openBalance: "0.00",
      }),
    ]);
    const cash = resolution.slices.filter((s) => s.includeInCashProjection);
    assert.equal(cash.length, 1);
    assert.equal(cash[0]?.source, "OFFICIAL_SETTLEMENT");
    assert.equal(resolution.consolidatedCashTotal, "1000.00");
    assert.ok(resolution.suppressedClaimIds.includes("forecast"));
  });

  it("baixa e conciliação não são duplicadas (prevalece conciliado)", () => {
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "reconciled",
        source: "RECONCILED_MOVEMENT",
        amount: "800.00",
        settledAmount: "800.00",
        reconciliationMatchId: "m1",
      }),
      claim({
        id: "baixa",
        source: "OFFICIAL_SETTLEMENT",
        amount: "800.00",
        settledAmount: "800.00",
      }),
      claim({
        id: "realized",
        source: "REALIZED_UNRECONCILED",
        amount: "800.00",
        settledAmount: "800.00",
      }),
    ]);
    const cash = resolution.slices.filter((s) => s.includeInCashProjection);
    assert.equal(cash.length, 1);
    assert.equal(cash[0]?.claimId, "reconciled");
    assert.equal(resolution.consolidatedCashTotal, "800.00");
    assert.ok(resolution.suppressedClaimIds.includes("baixa"));
    assert.ok(resolution.suppressedClaimIds.includes("realized"));
  });

  it("transferências não alteram consolidado (par de pernas)", () => {
    const groupId = "xfer-1";
    const resolution = resolveTreasuryFinancialIdentities([
      {
        id: "out",
        source: "TRANSFER",
        side: "INTERNAL",
        amount: "-150.00",
        transferGroupId: groupId,
        installmentNumber: null,
      },
      {
        id: "in",
        source: "TRANSFER",
        side: "INTERNAL",
        amount: "150.00",
        transferGroupId: groupId,
        installmentNumber: null,
      },
    ]);

    assert.equal(resolution.consolidatedCashTotal, "0.00");
    for (const s of resolution.slices) {
      assert.equal(s.affectsConsolidated, false);
      assert.equal(s.role, "TRANSFER");
    }
    assert.equal(
      treasuryTransferConsolidatedImpact([
        { amount: "150.00", sign: -1 },
        { amount: "150.00", sign: 1 },
      ]),
      "0.00"
    );
  });

  it("parcela parcial considera somente saldo aberto na previsão", () => {
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "baixa-parcial",
        source: "OFFICIAL_SETTLEMENT",
        amount: "1000.00",
        settledAmount: "600.00",
        openBalance: "400.00",
      }),
      claim({
        id: "forecast",
        source: "FORECAST",
        amount: "1000.00",
        openBalance: "400.00",
      }),
    ]);

    const realized = resolution.slices.find((s) => s.role === "REALIZED");
    const forecast = resolution.slices.find(
      (s) => s.role === "FORECAST" && s.includeInCashProjection
    );
    assert.equal(realized?.amount, "600.00");
    assert.equal(forecast?.amount, "400.00");
    assert.equal(resolution.consolidatedCashTotal, "1000.00");
    // Não usa 1000+1000 nem 1000+400
    assert.notEqual(resolution.consolidatedCashTotal, "2000.00");
    assert.notEqual(resolution.consolidatedCashTotal, "1400.00");
  });

  it("cancelados não projetam", () => {
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "cancelled",
        source: "FORECAST",
        amount: "999.00",
        openBalance: "999.00",
        isCancelled: true,
      }),
      claim({
        id: "active",
        source: "FORECAST",
        amount: "50.00",
        openBalance: "50.00",
        officialTitleId: "44444444-4444-4444-8444-444444444444",
        nomusExternalId: 2002,
      }),
    ]);
    assert.ok(resolution.suppressedClaimIds.includes("cancelled"));
    assert.equal(
      resolution.slices.find((s) => s.claimId === "cancelled")?.role,
      "CANCELLED"
    );
    assert.equal(resolution.consolidatedCashTotal, "50.00");
  });

  it("previsão do pedido substituída por CR real não volta ao total (replacedByRealCr)", () => {
    // Espelha bug PD 02457: planejado aplicável ≠ planejado + CR
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "cr-real",
        source: "OFFICIAL_SETTLEMENT",
        amount: "4104.19",
        settledAmount: "4104.19",
        openBalance: "0.00",
        salesOrderExternalId: 2457,
      }),
      {
        id: "planned-replaced",
        source: "SALES_ORDER",
        side: "AR",
        amount: "4104.19",
        salesOrderExternalId: 2457,
        installmentNumber: 1,
      },
      claim({
        id: "forecast-zero",
        source: "FORECAST",
        amount: "4104.19",
        openBalance: "0.00",
        salesOrderExternalId: 2457,
      }),
    ]);
    assert.equal(resolution.consolidatedCashTotal, "4104.19");
    assert.ok(resolution.suppressedClaimIds.includes("planned-replaced"));
    assert.ok(resolution.suppressedClaimIds.includes("forecast-zero"));
  });

  it("realizado não conciliado perde para baixa oficial", () => {
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "unrec",
        source: "REALIZED_UNRECONCILED",
        amount: "120.00",
        settledAmount: "120.00",
      }),
      claim({
        id: "baixa",
        source: "OFFICIAL_SETTLEMENT",
        amount: "120.00",
        settledAmount: "120.00",
      }),
    ]);
    const cash = resolution.slices.filter((s) => s.includeInCashProjection);
    assert.equal(cash[0]?.claimId, "baixa");
    assert.ok(resolution.suppressedClaimIds.includes("unrec"));
  });

  it("pedido isolado sem título não vira caixa da Tesouraria", () => {
    const resolution = resolveTreasuryFinancialIdentities([
      {
        id: "order-only",
        source: "SALES_ORDER",
        side: "AR",
        amount: "300.00",
        salesOrderExternalId: 501,
        installmentNumber: 1,
      },
    ]);
    assert.equal(resolution.consolidatedCashTotal, "0.00");
    assert.equal(resolution.slices[0]?.includeInCashProjection, false);
  });

  it("duas OFFICIAL_SETTLEMENT distintas não se suprimem", () => {
    const resolution = resolveTreasuryFinancialIdentities([
      claim({
        id: "baixa-1",
        source: "OFFICIAL_SETTLEMENT",
        amount: "300.00",
        settledAmount: "300.00",
        openBalance: "400.00",
      }),
      claim({
        id: "baixa-2",
        source: "OFFICIAL_SETTLEMENT",
        amount: "300.00",
        settledAmount: "300.00",
        openBalance: "400.00",
      }),
      claim({
        id: "forecast",
        source: "FORECAST",
        amount: "1000.00",
        openBalance: "400.00",
      }),
    ]);
    const realized = resolution.slices.filter(
      (s) => s.role === "REALIZED" && s.includeInCashProjection
    );
    assert.equal(realized.length, 2);
    assert.equal(resolution.consolidatedCashTotal, "1000.00");
    assert.equal(clusterRealizedClaims([
      claim({
        id: "baixa-1",
        source: "OFFICIAL_SETTLEMENT",
        amount: "300.00",
        settledAmount: "300.00",
      }),
      claim({
        id: "baixa-2",
        source: "OFFICIAL_SETTLEMENT",
        amount: "300.00",
        settledAmount: "300.00",
      }),
    ]).length, 2);
  });
});
