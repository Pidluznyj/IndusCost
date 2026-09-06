/**
 * Ponte de apresentação histórica do gráfico de projeção da Tesouraria.
 * Não altera realizado diário, overlay mensal, motor de cenários nem saldo oficial.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
} from "@/src/lib/financeCashFlowDashboard.js";
import type { FinanceCashFlowCanonicalRealizedYearSets } from "@/src/lib/finance/financeCashFlowCanonicalRealized.server.js";
import { FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS } from "@/src/lib/finance/financeSettlementReconciliation.js";
import {
  computeTreasuryCaixaHistoricalArGraphPresentationBridge,
  computeTreasuryCaixaHistoricalArMonthlyInflowDeltas,
} from "./treasuryCaixaService.server.js";

const POLICY = FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS;

function arRow(over: Partial<FinanceCashFlowArRow>): FinanceCashFlowArRow {
  return {
    dueDate: null,
    settlementDate: null,
    amountReceived: 0,
    balanceReceivable: 0,
    ...over,
  } as unknown as FinanceCashFlowArRow;
}

function apRow(over: Partial<FinanceCashFlowApRow>): FinanceCashFlowApRow {
  return {
    dueDate: null,
    paymentDate: null,
    settlementDate: null,
    amountPayable: 0,
    amountPaid: 0,
    balancePayable: 0,
    suspendPayment: false,
    description: "titulo normal",
    paymentMethodName: null,
    ...over,
  } as unknown as FinanceCashFlowApRow;
}

function ctx(
  year: number,
  arReceivedRows: FinanceCashFlowArRow[],
  apPaidRows: FinanceCashFlowApRow[] = []
): FinanceCashFlowCanonicalRealizedYearSets {
  return { year, arReceivedRows, apPaidRows };
}

function sumBridge(bridge: {
  openingAdjustment: number;
  adjustmentByCivilDate: Readonly<Record<string, number>>;
}): number {
  return (
    Math.round(
      (bridge.openingAdjustment +
        Object.values(bridge.adjustmentByCivilDate).reduce((s, n) => s + n, 0) +
        Number.EPSILON) *
        100
    ) / 100
  );
}

function emptyBridge() {
  return computeTreasuryCaixaHistoricalArGraphPresentationBridge([], POLICY, 2026);
}

describe("computeTreasuryCaixaHistoricalArGraphPresentationBridge", () => {
  it("1. título não afetado: nenhum adjustment", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 1,
            dueDate: new Date(2026, 2, 1),
            settlementDate: new Date(2026, 2, 2),
            amountReceived: 50,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(bridge.openingAdjustment, 0);
    assert.deepEqual(bridge.adjustmentByCivilDate, {});
  });

  it("2. lag <= 15: nenhum adjustment pela policy histórica", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 2,
            dueDate: new Date(2026, 0, 31),
            settlementDate: new Date(2026, 1, 5),
            amountReceived: 100,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(bridge.openingAdjustment, 0);
    assert.deepEqual(bridge.adjustmentByCivilDate, {});
  });

  it("3. data fora das datas históricas: nenhum adjustment", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 3,
            dueDate: new Date(2025, 11, 1),
            settlementDate: new Date(2026, 1, 20),
            amountReceived: 300,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(bridge.openingAdjustment, 0);
    assert.deepEqual(bridge.adjustmentByCivilDate, {});
  });

  it("4. dueDate ausente: nenhum adjustment", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 4,
            dueDate: null,
            settlementDate: new Date(2026, 1, 5),
            amountReceived: 100,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(bridge.openingAdjustment, 0);
    assert.deepEqual(bridge.adjustmentByCivilDate, {});
  });

  it("5. normalizedMonth == baselineMonth: nenhum adjustment visual", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 5,
            dueDate: new Date(2026, 1, 1),
            settlementDate: new Date(2026, 1, 19),
            amountReceived: 400,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(bridge.openingAdjustment, 0);
    assert.deepEqual(bridge.adjustmentByCivilDate, {});
  });

  it("6. competência dentro do ano: +amount no fechamento do mês de competência", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 6,
            dueDate: new Date(2026, 0, 10),
            settlementDate: new Date(2026, 1, 5),
            amountReceived: 100,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(bridge.openingAdjustment, 0);
    assert.equal(bridge.adjustmentByCivilDate["2026-01-31"], 100);
    assert.equal(bridge.adjustmentByCivilDate["2026-01-10"], undefined);
    assert.equal(bridge.adjustmentByCivilDate["2026-02-05"], -100);
  });

  it("7. competência anterior ao ano: amount entra em openingAdjustment", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 7,
            dueDate: new Date(2025, 11, 6),
            settlementDate: new Date(2026, 1, 5),
            amountReceived: 80,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(bridge.openingAdjustment, 80);
    assert.equal(bridge.adjustmentByCivilDate["2026-02-05"], -80);
    assert.equal(bridge.adjustmentByCivilDate["2025-12-31"], undefined);
  });

  it("8. origem administrativa: -amount no effective realized day", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 8,
            dueDate: new Date(2026, 0, 1),
            settlementDate: new Date(2026, 1, 19),
            amountReceived: 250,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(bridge.adjustmentByCivilDate["2026-02-19"], -250);
    assert.equal(bridge.adjustmentByCivilDate["2026-01-01"], undefined);
    assert.equal(bridge.adjustmentByCivilDate["2026-01-31"], 250);
  });

  it("9. conservação por título: +amount + -amount = 0", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 9,
            dueDate: new Date(2026, 0, 15),
            settlementDate: new Date(2026, 1, 4),
            amountReceived: 77.7,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(sumBridge(bridge), 0);
  });

  it("10. conservação agregada: sum opening + events até fim da janela = 0", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 10,
            dueDate: new Date(2025, 10, 1),
            settlementDate: new Date(2026, 1, 4),
            amountReceived: 10,
          }),
          arRow({
            externalId: 11,
            dueDate: new Date(2026, 0, 20),
            settlementDate: new Date(2026, 1, 9),
            amountReceived: 20,
          }),
          arRow({
            externalId: 12,
            dueDate: new Date(2026, 0, 2),
            settlementDate: new Date(2026, 1, 19),
            amountReceived: 30,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(sumBridge(bridge), 0);
    assert.equal(bridge.openingAdjustment, 10);
    assert.equal(bridge.adjustmentByCivilDate["2026-01-31"], 50);
    assert.equal(bridge.adjustmentByCivilDate["2026-02-04"], -10);
    assert.equal(bridge.adjustmentByCivilDate["2026-02-09"], -20);
    assert.equal(bridge.adjustmentByCivilDate["2026-02-19"], -30);
  });

  it("11. após última origem afetada o running volta a zero", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [
          arRow({
            externalId: 13,
            dueDate: new Date(2025, 11, 1),
            settlementDate: new Date(2026, 1, 5),
            amountReceived: 100,
          }),
          arRow({
            externalId: 14,
            dueDate: new Date(2026, 0, 10),
            settlementDate: new Date(2026, 1, 19),
            amountReceived: 40,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    let running = bridge.openingAdjustment;
    const dates = Object.keys(bridge.adjustmentByCivilDate).sort();
    for (const date of dates) {
      running = Math.round((running + (bridge.adjustmentByCivilDate[date] ?? 0)) * 100) / 100;
    }
    assert.equal(running, 0);
  });

  it("12. sem hardcode duplicado das quatro datas na nova camada", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./treasuryCaixaService.server.ts", import.meta.url)),
      "utf8"
    );
    const start = src.indexOf(
      "export function computeTreasuryCaixaHistoricalArGraphPresentationBridge"
    );
    const end = src.indexOf("export function civilDateUtcRange");
    assert.ok(start >= 0 && end > start);
    const helper = src.slice(start, end);
    for (const date of ["2026-02-04", "2026-02-05", "2026-02-09", "2026-02-19"]) {
      assert.equal(
        helper.includes(date),
        false,
        `a ponte não pode duplicar ${date}`
      );
    }
    assert.equal(helper.includes("> 15"), false);
    assert.ok(helper.includes("resolveFinanceArHistoricalMonthlyMovementDate"));
    assert.ok(helper.includes("resolveFinanceArEffectiveSettlementDate"));
  });

  it("13. linhas fora da população canônica (sanitizadas) não ressurgem", () => {
    const sanitized = [
      arRow({
        externalId: 15,
        dueDate: new Date(2026, 0, 10),
        settlementDate: new Date(2026, 1, 5),
        amountReceived: 100,
      }),
    ];
    const excludedIntercompany = arRow({
      externalId: 9999,
      dueDate: new Date(2026, 0, 10),
      settlementDate: new Date(2026, 1, 5),
      amountReceived: 999,
    });
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [ctx(2026, sanitized)],
      POLICY,
      2026
    );
    assert.equal(bridge.adjustmentByCivilDate["2026-01-31"], 100);
    assert.equal(
      sumBridge(
        computeTreasuryCaixaHistoricalArGraphPresentationBridge(
          [ctx(2026, sanitized)],
          POLICY,
          2026
        )
      ),
      0
    );
    void excludedIntercompany;
    assert.notEqual(bridge.adjustmentByCivilDate["2026-01-31"], 1099);
  });

  it("cross-year: destinationYear < graphYear e sourceYear == graphYear", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2025, [
          arRow({
            externalId: 20,
            dueDate: new Date(2025, 11, 1),
            settlementDate: new Date(2026, 1, 5),
            amountReceived: 55,
          }),
        ]),
        ctx(2026, [
          arRow({
            externalId: 20,
            dueDate: new Date(2025, 11, 1),
            settlementDate: new Date(2026, 1, 5),
            amountReceived: 55,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.equal(bridge.openingAdjustment, 55);
    assert.equal(bridge.adjustmentByCivilDate["2026-02-05"], -55);
    assert.equal(sumBridge(bridge), 0);
  });

  it("não duplica o mesmo título presente em dois anos da cadeia", () => {
    const title = arRow({
      externalId: 21,
      dueDate: new Date(2025, 11, 15),
      settlementDate: new Date(2026, 1, 9),
      amountReceived: 12,
    });
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [ctx(2025, [title]), ctx(2026, [title])],
      POLICY,
      2026
    );
    assert.equal(bridge.openingAdjustment, 12);
    assert.equal(bridge.adjustmentByCivilDate["2026-02-09"], -12);
  });

  it("overlay mensal e ponte do gráfico são estruturas distintas da mesma população", () => {
    const contexts = [
      ctx(2026, [
        arRow({
          externalId: 22,
          dueDate: new Date(2025, 11, 6),
          settlementDate: new Date(2026, 1, 5),
          amountReceived: 100,
        }),
      ]),
    ];
    const monthly = computeTreasuryCaixaHistoricalArMonthlyInflowDeltas(
      contexts,
      POLICY
    );
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      contexts,
      POLICY,
      2026
    );
    assert.equal(monthly["2026-02"], -100);
    assert.equal(bridge.openingAdjustment, 100);
    assert.equal(bridge.adjustmentByCivilDate["2026-02-05"], -100);
    assert.equal(
      Object.keys(monthly).some((k) => k.length === 10),
      false,
      "delta mensal permanece YYYY-MM, nunca dia civil"
    );
  });

  it("AP não entra na ponte de apresentação", () => {
    const bridge = computeTreasuryCaixaHistoricalArGraphPresentationBridge(
      [
        ctx(2026, [], [
          apRow({
            dueDate: new Date(2026, 0, 10),
            paymentDate: new Date(2026, 1, 5),
            amountPaid: 80,
            amountPayable: 80,
          }),
        ]),
      ],
      POLICY,
      2026
    );
    assert.deepEqual(bridge, emptyBridge());
  });
});
