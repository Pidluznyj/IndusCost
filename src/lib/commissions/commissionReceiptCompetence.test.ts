/**
 * Regressão da competência mensal por RECEBIMENTO.
 *
 * Casos reais provados no probe READ ONLY contra `GET /rest/recebimentos`:
 *   CR 18505 / NF 7479 — recebimento 30/07/2026, baixa 03/08/2026, R$ 2.775,90
 *   CR 18674 / NF 7532 — recebimento 31/07/2026, baixa 06/08/2026, R$   897,00
 *   CR 17480           — recebimento 30/06/2026, baixa 01/07/2026, R$ 1.527,55
 *   CR 17530           — recebimento 29/06/2026, baixa 02/07/2026, R$   394,00
 *   CR 17809           — recebimento 25/06/2026, baixa 13/07/2026, R$ 7.605,00
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReceiptCompetenceByReceivable,
  computeCompetenceReleaseBreakdown,
  detectReceiptsWithoutLocalReceivable,
  detectSettledWithoutReceipt,
  isReceiptInCompetencePeriod,
  receiptCompetenceMonthKey,
  resolveCompetencePeriodUtcBounds,
  type CommissionReceiptEventInput,
} from "./commissionReceiptCompetence.js";

/** Simula Prisma DATE: meia-noite UTC do dia civil. */
function prismaDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function receiptEvent(
  receiptExternalId: number,
  receivableExternalId: number,
  receiptDate: string,
  receivedAmount: number
): CommissionReceiptEventInput {
  return {
    receiptExternalId,
    receivableExternalId,
    receiptDate: prismaDate(receiptDate),
    receivedAmount,
  };
}

describe("commissionReceiptCompetence", () => {
  it("TESTE 1 — CR 18505: recebimento 30/07 com baixa 03/08 é competência de JULHO", () => {
    const events = [receiptEvent(11011, 18505, "2026-07-30", 2775.9)];

    const julho = buildReceiptCompetenceByReceivable(events, 2026, 7);
    const agosto = buildReceiptCompetenceByReceivable(events, 2026, 8);

    assert.equal(julho.get(18505)?.periodReceivedAmount, 2775.9);
    assert.deepEqual(julho.get(18505)?.receiptIds, [11011]);
    // A baixa de agosto não pode arrastar a competência.
    assert.equal(agosto.has(18505), false);
  });

  it("TESTE 2 — CR 18674: recebimento 31/07 com baixa 06/08 é competência de JULHO", () => {
    const events = [receiptEvent(11066, 18674, "2026-07-31", 897)];

    assert.equal(
      buildReceiptCompetenceByReceivable(events, 2026, 7).get(18674)?.periodReceivedAmount,
      897
    );
    assert.equal(buildReceiptCompetenceByReceivable(events, 2026, 8).has(18674), false);
  });

  it("TESTE 3 — CR 17480: recebimento 30/06 com baixa 01/07 é competência de JUNHO", () => {
    const events = [receiptEvent(10500, 17480, "2026-06-30", 1527.55)];

    assert.equal(
      buildReceiptCompetenceByReceivable(events, 2026, 6).get(17480)?.periodReceivedAmount,
      1527.55
    );
    assert.equal(buildReceiptCompetenceByReceivable(events, 2026, 7).has(17480), false);
  });

  it("demais casos reais provados (17530 e 17809) ficam em JUNHO", () => {
    const events = [
      receiptEvent(10510, 17530, "2026-06-29", 394),
      receiptEvent(10520, 17809, "2026-06-25", 7605),
    ];
    const junho = buildReceiptCompetenceByReceivable(events, 2026, 6);
    const julho = buildReceiptCompetenceByReceivable(events, 2026, 7);

    assert.equal(junho.size, 2);
    assert.equal(julho.size, 0);
    assert.equal(
      junho.get(17530)!.periodReceivedAmount + junho.get(17809)!.periodReceivedAmount,
      7999
    );
  });

  it("TESTE 11 — timezone: 31/07 nunca vira 01/08 nem 30/07", () => {
    assert.equal(receiptCompetenceMonthKey(prismaDate("2026-07-31")), "2026-07");
    assert.equal(isReceiptInCompetencePeriod(prismaDate("2026-07-31"), 2026, 7), true);
    assert.equal(isReceiptInCompetencePeriod(prismaDate("2026-07-31"), 2026, 8), false);
    assert.equal(isReceiptInCompetencePeriod(prismaDate("2026-08-01"), 2026, 7), false);
    assert.equal(isReceiptInCompetencePeriod(prismaDate("2026-07-01"), 2026, 7), true);
    assert.equal(isReceiptInCompetencePeriod("2026-07-31T00:00:00.000Z", 2026, 7), true);
  });

  it("limites do período são UTC — coluna DATE não perde o 1º nem o último dia", () => {
    const { from, to } = resolveCompetencePeriodUtcBounds(2026, 7);
    assert.equal(from.toISOString(), "2026-07-01T00:00:00.000Z");
    assert.equal(to.toISOString(), "2026-07-31T00:00:00.000Z");
  });

  it("TESTE 7 — recebimentos parciais: julho 40% e agosto 60% da mesma comissão", () => {
    const events = [
      receiptEvent(1, 900, "2026-07-31", 4000),
      receiptEvent(2, 900, "2026-08-05", 6000),
    ];

    const julho = buildReceiptCompetenceByReceivable(events, 2026, 7).get(900)!;
    const agosto = buildReceiptCompetenceByReceivable(events, 2026, 8).get(900)!;

    // Julho não enxerga o recebimento de agosto.
    assert.equal(julho.periodReceivedAmount, 4000);
    assert.equal(julho.priorReceivedAmount, 0);
    // Agosto enxerga o de julho apenas como acumulado anterior (cap).
    assert.equal(agosto.periodReceivedAmount, 6000);
    assert.equal(agosto.priorReceivedAmount, 4000);

    const julhoRelease = computeCompetenceReleaseBreakdown({
      receivableOriginalAmount: 10000,
      scheduledCommissionAmount: 300,
      competence: julho,
    });
    const agostoRelease = computeCompetenceReleaseBreakdown({
      receivableOriginalAmount: 10000,
      scheduledCommissionAmount: 300,
      competence: agosto,
    });

    assert.equal(julhoRelease.periodReleasedCommissionAmount, 120);
    assert.equal(agostoRelease.periodReleasedCommissionAmount, 180);
    assert.equal(
      julhoRelease.periodReleasedCommissionAmount +
        agostoRelease.periodReleasedCommissionAmount,
      300
    );
    assert.equal(agostoRelease.cumulativeReleasedCommissionAmount, 300);
  });

  it("TESTE 8 — dois recebimentos do mesmo CR no mesmo mês somam sem colidir", () => {
    const events = [
      receiptEvent(51, 900, "2026-07-10", 4000),
      receiptEvent(52, 900, "2026-07-25", 6000),
    ];
    const julho = buildReceiptCompetenceByReceivable(events, 2026, 7);

    // Um único agregado por título/mês: nada colide no ledger.
    assert.equal(julho.size, 1);
    const competence = julho.get(900)!;
    assert.equal(competence.periodReceivedAmount, 10000);
    assert.deepEqual(competence.receiptIds, [51, 52]);
    assert.equal(competence.firstReceiptDate.toISOString(), "2026-07-10T00:00:00.000Z");
    assert.equal(competence.receiptDate.toISOString(), "2026-07-25T00:00:00.000Z");

    const release = computeCompetenceReleaseBreakdown({
      receivableOriginalAmount: 10000,
      scheduledCommissionAmount: 300,
      competence,
    });
    assert.equal(release.periodReleasedCommissionAmount, 300);
  });

  it("cap nunca libera acima da comissão calculada da venda", () => {
    const competence = buildReceiptCompetenceByReceivable(
      [receiptEvent(1, 900, "2026-07-10", 13000)],
      2026,
      7
    ).get(900)!;
    const release = computeCompetenceReleaseBreakdown({
      receivableOriginalAmount: 10000,
      scheduledCommissionAmount: 300,
      competence,
    });

    assert.equal(release.periodReleasedCommissionAmount, 300);
    assert.equal(release.periodPrincipalAmount, 10000);
    // Juros/multa acima do original não entram na base comissionável.
    assert.equal(release.periodIgnoredFinancialChargesAmount, 3000);
  });

  it("TESTE 6 — baixa no período sem recebimento vira inconsistência, não fallback", () => {
    const competence = buildReceiptCompetenceByReceivable(
      [receiptEvent(1, 18505, "2026-07-30", 2775.9)],
      2026,
      7
    );

    const inconsistencies = detectSettledWithoutReceipt([18505, 99999], competence);

    assert.equal(inconsistencies.length, 1);
    assert.equal(inconsistencies[0].receivableExternalId, 99999);
    assert.equal(inconsistencies[0].code, "SETTLED_WITHOUT_RECEIPT");
    // O título sem recebimento NÃO entrou na competência por causa da baixa.
    assert.equal(competence.has(99999), false);
  });

  it("recebimento sem CR local é reportado sem join aproximado", () => {
    const competence = buildReceiptCompetenceByReceivable(
      [receiptEvent(1, 18505, "2026-07-30", 100), receiptEvent(2, 40404, "2026-07-31", 200)],
      2026,
      7
    );

    const orphans = detectReceiptsWithoutLocalReceivable(competence, [18505]);

    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].receivableExternalId, 40404);
    assert.equal(orphans[0].code, "RECEIPT_WITHOUT_LOCAL_RECEIVABLE");
  });

  it("recebimento posterior ao período não altera a competência do mês", () => {
    const julho = buildReceiptCompetenceByReceivable(
      [receiptEvent(1, 900, "2026-07-10", 4000), receiptEvent(2, 900, "2026-09-01", 6000)],
      2026,
      7
    ).get(900)!;

    assert.equal(julho.periodReceivedAmount, 4000);
    assert.equal(julho.cumulativeReceivedAmount, 4000);
  });
});
