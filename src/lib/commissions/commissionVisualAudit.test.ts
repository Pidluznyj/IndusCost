import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVisualAuditRow,
  computeVisualAuditCards,
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

  it("buildVisualAuditRow calcula comissão pendente no backend", () => {
    const row = buildVisualAuditRow(baseInput({ commissionExpected: 12.5, commissionReleased: 5 }));
    assert.equal(row.commissionPending, 7.5);
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

  it("computeVisualAuditCards agrega documentos e divergências", () => {
    const row1 = buildVisualAuditRow(baseInput());
    const row2 = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s2",
        recordId: "r2",
        scheduleId: "s2",
        documentKey: "p1:200",
        documentBaseAmount: 2000,
        documentCommissionTotal: 50,
        itemBaseAmount: 2000,
        itemCommissionAmount: 50,
      })
    );
    const cards = computeVisualAuditCards([row1, row2]);
    assert.equal(cards.documentCount, 2);
    assert.equal(cards.scheduleCount, 2);
    assert.ok(cards.commissionableBaseTotal >= 3000);
    assert.ok(cards.averageRatePercent > 0);
  });
});
