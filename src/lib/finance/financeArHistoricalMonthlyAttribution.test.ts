import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { resolveFinanceArEffectiveSettlementDate } from "@/src/lib/financeAccountsReceivableRules.js";
import { FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS } from "./financeSettlementReconciliation.js";
import {
  HISTORICAL_AR_ADMIN_SETTLEMENT_BATCH_CIVIL_DATES_V1,
  HISTORICAL_SETTLEMENT_NORMALIZATION_POLICY_VERSION,
  resolveFinanceArHistoricalMonthlyMovementDate,
} from "./financeArHistoricalMonthlyAttribution.js";

function civil(value: Date | string | null): string | null {
  return toCivilDateKey(value);
}

describe("HISTORICAL SETTLEMENT NORMALIZATION V1", () => {
  it("declara a política V1 e as quatro datas do lote", () => {
    assert.equal(
      HISTORICAL_SETTLEMENT_NORMALIZATION_POLICY_VERSION,
      "HISTORICAL_SETTLEMENT_NORMALIZATION_V1"
    );
    assert.deepEqual(
      [...HISTORICAL_AR_ADMIN_SETTLEMENT_BATCH_CIVIL_DATES_V1].sort(),
      ["2026-02-04", "2026-02-05", "2026-02-09", "2026-02-19"]
    );
  });

  it("H01 — lote 2026-02-04 + lag >15 → dueDate", () => {
    const dueDate = "2025-12-01";
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate,
      settlementDate: "2026-02-04",
      normalDate: "2026-02-04",
    });
    assert.equal(civil(got), "2025-12-01");
  });

  it("H02 — lote 2026-02-05 + lag >15 → dueDate", () => {
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: "2025-12-01",
      settlementDate: "2026-02-05",
      normalDate: "2026-02-05",
    });
    assert.equal(civil(got), "2025-12-01");
  });

  it("H03 — lote 2026-02-09 + lag >15 → dueDate", () => {
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: "2025-12-01",
      settlementDate: "2026-02-09",
      normalDate: "2026-02-09",
    });
    assert.equal(civil(got), "2025-12-01");
  });

  it("H04 — lote 2026-02-19 + lag >15 → dueDate", () => {
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: "2026-01-01",
      settlementDate: "2026-02-19",
      normalDate: "2026-02-19",
    });
    assert.equal(civil(got), "2026-01-01");
  });

  it("H05 — LIMITE lag = 15 → NÃO normalizar", () => {
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: "2026-01-20",
      settlementDate: "2026-02-04",
      normalDate: "2026-02-04",
    });
    assert.equal(civil(got), "2026-02-04");
  });

  it("H06 — lag = 16 → normalizar", () => {
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: "2026-01-19",
      settlementDate: "2026-02-04",
      normalDate: "2026-02-04",
    });
    assert.equal(civil(got), "2026-01-19");
  });

  it("H07 — 2026-02-20 fora do lote, lag enorme → preservar regra normal", () => {
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: "2025-12-01",
      settlementDate: "2026-02-20",
      normalDate: "2026-02-20",
    });
    assert.equal(civil(got), "2026-02-20");
  });

  it("H08 — settlement 2026-03-05 → preservar regra normal", () => {
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: "2025-12-01",
      settlementDate: "2026-03-05",
      normalDate: "2026-03-05",
    });
    assert.equal(civil(got), "2026-03-05");
  });

  it("H09 — dueDate null → fallback normal, sem throw", () => {
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: null,
      settlementDate: "2026-02-04",
      normalDate: "2026-02-04",
    });
    assert.equal(civil(got), "2026-02-04");
  });

  it("H10 — antecipação (settlement < due) → preservar regra normal", () => {
    const got = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: "2026-02-20",
      settlementDate: "2026-02-04",
      normalDate: "2026-02-04",
    });
    assert.equal(civil(got), "2026-02-04");
  });
});

describe("paridade da decisão histórica mensal Fluxo × Tesouraria", () => {
  const POLICY = FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS;

  function cashFlowDate(due: string, settlement: string): string | null {
    return civil(
      resolveFinanceArHistoricalMonthlyMovementDate({
        dueDate: due,
        settlementDate: settlement,
        normalDate: settlement,
      })
    );
  }

  function treasuryDate(due: string, settlement: string): string | null {
    const dueDate = new Date(`${due}T12:00:00.000Z`);
    const settlementDate = new Date(`${settlement}T12:00:00.000Z`);
    const normal = resolveFinanceArEffectiveSettlementDate(
      {
        dueDate,
        settlementDate,
        amountReceived: 100,
        balanceReceivable: 0,
      },
      { reconciliation: POLICY }
    );
    return civil(
      resolveFinanceArHistoricalMonthlyMovementDate({
        dueDate,
        settlementDate,
        normalDate: normal,
      })
    );
  }

  it("título do lote histórico >15: as duas superfícies escolhem o dueDate", () => {
    const due = "2025-12-06";
    const settlement = "2026-02-05";
    assert.equal(cashFlowDate(due, settlement), due);
    assert.equal(treasuryDate(due, settlement), due);
    assert.equal(cashFlowDate(due, settlement), treasuryDate(due, settlement));
  });

  it("documenta diferença legítima D+1 fora do overlay: Fluxo usa baixa; Tesouraria usa 3 dias", () => {
    const due = "2026-08-04";
    const settlement = "2026-08-05";
    assert.equal(cashFlowDate(due, settlement), settlement);
    assert.equal(treasuryDate(due, settlement), due);
    assert.notEqual(
      cashFlowDate(due, settlement),
      treasuryDate(due, settlement),
      "sem overlay, a regra dos 3 dias da Tesouraria continua desacoplada do Fluxo"
    );
  });
});

describe("guards de mutação da política histórica", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));

  it("a regra dos 3 dias global não contém o lote de fevereiro/2026", () => {
    const src = readFileSync(
      `${root}/lib/finance/financeSettlementReconciliation.ts`,
      "utf8"
    );
    assert.doesNotMatch(src, /2026-02-04/);
    const arResolver = readFileSync(
      `${root}/lib/financeAccountsReceivableRules.ts`,
      "utf8"
    );
    assert.doesNotMatch(arResolver, /2026-02-04/);
    assert.doesNotMatch(arResolver, /HISTORICAL_SETTLEMENT_NORMALIZATION/);
  });

  it("o overlay vive numa única autoridade — não há datas do lote duplicadas noutros motores", () => {
    const files = [
      `${root}/lib/financeCashFlowExecutiveSummary.ts`,
      `${root}/lib/treasury/services/treasuryCaixaService.server.ts`,
      `${root}/lib/treasury/domain/treasuryCaixaCanonicalDay.ts`,
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(
        src,
        /2026-02-04/,
        `${file} não pode hardcodar o lote; deve consumir o helper`
      );
    }
  });
});
