import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVisualAuditCsv,
  buildVisualAuditNomusReference,
  buildVisualAuditRow,
  computeVisualAuditCards,
  filterRowsByAppraisalMode,
  parseVisualAuditAppraisalMode,
  resolveAllocatedBaseAmount,
  resolveCommissionVisualStatus,
  resolveReceivableTitleStatus,
  resolveVisualAuditAlerts,
  type VisualAuditRowInput,
} from "./commissionVisualAudit.js";

function baseInput(overrides: Partial<VisualAuditRowInput> = {}): VisualAuditRowInput {
  return {
    lineId: "r1:s1",
    recordId: "r1",
    scheduleId: "s1",
    commissionPersonId: "p1",
    commissionPersonName: "GISLENE LIMA",
    customerName: "Cliente A",
    orderCode: "PED-1",
    nfeNumber: "12345",
    nomusNfeId: 100,
    confirmedAt: "2026-06-15T12:00:00.000Z",
    documentKey: "p1:100",
    documentBaseAmount: 1000,
    documentCommissionTotal: 25,
    itemBaseAmount: 1000,
    itemCommissionAmount: 25,
    itemRatePercent: 2.5,
    productCode: "PROD-1",
    nomusReceivableId: 98765,
    installmentNumber: 1,
    dueDate: "2026-07-10T00:00:00.000Z",
    settlementDate: null,
    receivableAmount: 500,
    receivedAmount: 0,
    openBalance: 500,
    allocationPercent: 50,
    commissionExpected: 12.5,
    commissionReleased: 0,
    hasArLink: true,
    hasSchedule: true,
    customerNoCommission: false,
    isCommissionable: true,
    exclusionReason: null,
    exclusionRuleId: null,
    ...overrides,
  };
}

describe("commissionVisualAudit", () => {
  it("resolveReceivableTitleStatus para título baixado", () => {
    assert.equal(
      resolveReceivableTitleStatus({
        nomusReceivableId: 1,
        hasArLink: true,
        receivableAmount: 500,
        receivedAmount: 500,
        openBalance: 0,
        dueDate: "2026-06-01T00:00:00.000Z",
        settlementDate: "2026-06-05T00:00:00.000Z",
      }),
      "BAIXADO"
    );
  });

  it("resolveReceivableTitleStatus SEM_VINCULO sem AR", () => {
    assert.equal(
      resolveReceivableTitleStatus({
        nomusReceivableId: null,
        hasArLink: false,
        receivableAmount: 0,
        receivedAmount: 0,
        openBalance: 0,
        dueDate: null,
        settlementDate: null,
      }),
      "SEM_VINCULO"
    );
  });

  it("gera alerta quando comissão liberada excede prevista", () => {
    const input = baseInput({ commissionExpected: 10, commissionReleased: 15 });
    const { alerts } = resolveVisualAuditAlerts(input);
    assert.ok(alerts.includes("COMISSAO_LIBERADA_ACIMA_PREVISTA"));
  });

  it("buildVisualAuditRow calcula comissão pendente e base rateada", () => {
    const row = buildVisualAuditRow(
      baseInput({
        commissionExpected: 12.5,
        commissionReleased: 5,
        // Vencimento futuro: evita BLOQUEADA_INADIMPLENCIA quando o relógio do CI passa da dueDate fixa.
        dueDate: "2099-07-10T00:00:00.000Z",
      })
    );
    assert.equal(row.commissionPending, 7.5);
    assert.equal(row.allocatedBaseAmount, 500);
    assert.equal(row.commissionStatus, "PARCIALMENTE_LIBERADA");
  });

  it("resolveCommissionVisualStatus BLOQUEADA_INADIMPLENCIA", () => {
    const input = baseInput({
      dueDate: "2020-01-01T00:00:00.000Z",
      commissionExpected: 10,
      commissionReleased: 0,
    });
    const { alerts } = resolveVisualAuditAlerts(input);
    assert.equal(resolveCommissionVisualStatus(input, alerts), "BLOQUEADA_INADIMPLENCIA");
  });

  it("valor títulos soma CR único", () => {
    const row1 = buildVisualAuditRow(baseInput());
    const row2 = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s1",
        recordId: "r2",
        scheduleId: "s2",
        itemBaseAmount: 800,
        itemCommissionAmount: 20,
        commissionExpected: 10,
        allocationPercent: 50,
      })
    );
    const cards = computeVisualAuditCards([row1, row2], "GENERATED");
    assert.equal(cards.receivableAmountTotal, 500);
    assert.equal(cards.receivableCount, 1);
  });

  it("valor NFs soma NF única com múltiplas parcelas", () => {
    const row1 = buildVisualAuditRow(baseInput({ scheduleId: "s1", lineId: "r1:s1" }));
    const row2 = buildVisualAuditRow(
      baseInput({
        scheduleId: "s2",
        lineId: "r1:s2",
        installmentNumber: 2,
        allocationPercent: 50,
        commissionExpected: 12.5,
        receivableAmount: 500,
      })
    );
    const cards = computeVisualAuditCards([row1, row2], "GENERATED");
    assert.equal(cards.documentAmountTotal, 1000);
    assert.equal(cards.documentCount, 1);
    assert.equal(cards.scheduleCount, 2);
  });

  it("base comissionável usa base rateada pela parcela", () => {
    const row1 = buildVisualAuditRow(baseInput({ allocationPercent: 60, commissionExpected: 15 }));
    const row2 = buildVisualAuditRow(
      baseInput({
        lineId: "r1:s2",
        scheduleId: "s2",
        installmentNumber: 2,
        allocationPercent: 40,
        commissionExpected: 10,
      })
    );
    const cards = computeVisualAuditCards([row1, row2], "GENERATED");
    assert.equal(cards.commissionableBaseTotal, 1000);
    assert.equal(resolveAllocatedBaseAmount(baseInput({ allocationPercent: 60 })), 600);
  });

  it("comissão calculada soma commissionExpected por parcela sem duplicar schedule", () => {
    const row1 = buildVisualAuditRow(baseInput({ scheduleId: "s1", commissionExpected: 12.5 }));
    const row2 = buildVisualAuditRow(
      baseInput({
        lineId: "r1:s2",
        scheduleId: "s2",
        installmentNumber: 2,
        nomusReceivableId: 98766,
        commissionExpected: 7.5,
        allocationPercent: 30,
        itemBaseAmount: 600,
      })
    );
    const cards = computeVisualAuditCards([row1, row2], "GENERATED");
    assert.equal(cards.commissionCalculatedTotal, 20);
    assert.equal(cards.commissionExpectedTotal, 20);
  });

  it("visão PAYABLE filtra por settlementDate no período", () => {
    const inside = buildVisualAuditRow(
      baseInput({ settlementDate: "2026-06-10T00:00:00.000Z", commissionReleased: 12.5 })
    );
    const outside = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s2",
        recordId: "r2",
        scheduleId: "s2",
        nomusReceivableId: 111,
        settlementDate: "2026-05-10T00:00:00.000Z",
      })
    );
    const period = {
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-30T23:59:59.999Z"),
    };
    const filtered = filterRowsByAppraisalMode([inside, outside], "PAYABLE", period);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.nomusReceivableId, 98765);
  });

  it("visão FORECAST exclui títulos baixados", () => {
    const open = buildVisualAuditRow(baseInput());
    const settledRow = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s2",
        recordId: "r2",
        scheduleId: "s2",
        nomusReceivableId: 222,
        settlementDate: "2026-06-10T00:00:00.000Z",
        receivedAmount: 500,
        openBalance: 0,
        commissionReleased: 12.5,
      })
    );
    const filtered = filterRowsByAppraisalMode([open, settledRow], "FORECAST", null);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.lineId, open.lineId);
  });

  it("export CSV inclui summary e bate com cards", () => {
    const row = buildVisualAuditRow(baseInput());
    const cards = computeVisualAuditCards([row], "GENERATED");
    const csv = buildVisualAuditCsv([row], cards);
    assert.match(csv, /# apuracao=GENERATED/);
    assert.match(csv, /# valor_cr_unico=500/);
    assert.match(csv, /# comissao_prevista=12.5/);
    assert.match(csv, /baseRateada/);
    assert.match(csv, /apuracao/);
  });

  it("referência Nomus comparável apenas em PAYABLE", () => {
    const cards = computeVisualAuditCards(
      [buildVisualAuditRow(baseInput({ commissionReleased: 12.5 }))],
      "PAYABLE"
    );
    const payableRef = buildVisualAuditNomusReference({
      mode: "PAYABLE",
      cards,
      nomusBase: 500,
      nomusCommission: 10,
    });
    assert.equal(payableRef.comparable, true);
    assert.equal(payableRef.commissionDiff, 2.5);

    const generatedRef = buildVisualAuditNomusReference({
      mode: "GENERATED",
      cards,
      nomusBase: 500,
      nomusCommission: 10,
    });
    assert.equal(generatedRef.comparable, false);
  });

  it("parseVisualAuditAppraisalMode aceita aliases", () => {
    assert.equal(parseVisualAuditAppraisalMode("payable"), "PAYABLE");
    assert.equal(parseVisualAuditAppraisalMode("FORECAST"), "FORECAST");
    assert.equal(parseVisualAuditAppraisalMode(undefined), "PAYABLE");
  });

  it("cliente excluído mantém base e zera comissão na linha", () => {
    const row = buildVisualAuditRow(
      baseInput({
        customerNoCommission: true,
        isCommissionable: false,
        exclusionReason: "Política comercial",
        exclusionRuleId: "ex-1",
        itemBaseAmount: 1000,
        commissionExpected: 0,
        commissionReleased: 0,
        itemRatePercent: 0,
      })
    );
    assert.equal(row.commissionStatus, "SEM_COMISSAO");
    assert.equal(row.itemBaseAmount, 1000);
    assert.equal(row.commissionExpected, 0);
    assert.match(row.alertLabels.join(" "), /Cliente excluído de comissionamento/);
  });

  it("export CSV inclui motivo de exclusão", () => {
    const row = buildVisualAuditRow(
      baseInput({
        customerNoCommission: true,
        isCommissionable: false,
        exclusionReason: "Política ESMALTEC",
        exclusionRuleId: "rule-1",
        commissionExpected: 0,
        itemRatePercent: 0,
      })
    );
    const csv = buildVisualAuditCsv([row], computeVisualAuditCards([row], "GENERATED"));
    assert.match(csv, /comissionavel/);
    assert.match(csv, /motivoExclusao/);
    assert.match(csv, /regraExclusaoId/);
    assert.match(csv, /Política ESMALTEC/);
  });
});
