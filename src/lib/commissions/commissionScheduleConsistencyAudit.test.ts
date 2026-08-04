/**
 * Auditoria de consistência snapshot × schedule + guarda estrutural do seletor
 * oficial de vigência.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  auditCommissionScheduleConsistency,
  type ScheduleAuditScheduleRow,
  type ScheduleAuditSnapshotRow,
} from "./commissionScheduleConsistencyAudit.js";

function snap(
  over: Partial<ScheduleAuditSnapshotRow> = {}
): ScheduleAuditSnapshotRow {
  return {
    snapshotId: "snap-atual",
    salesOrderId: "order-1",
    orderCode: "PD 02747",
    nfeId: 7521,
    status: "ACTIVE",
    totalFinalCommissionAmount: 100,
    ...over,
  };
}

function sched(
  over: Partial<ScheduleAuditScheduleRow> = {}
): ScheduleAuditScheduleRow {
  return {
    scheduleId: "sch-1",
    orderSnapshotId: "snap-atual",
    receivableId: 9001,
    salesOrderId: "order-1",
    status: "ACTIVE",
    scheduledCommissionAmount: 100,
    ...over,
  };
}

describe("auditoria — base íntegra não acusa nada", () => {
  it("snapshot ACTIVE com schedules que fecham → zero achados", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap()],
      schedules: [
        sched({ scheduleId: "a", receivableId: 1, scheduledCommissionAmount: 60 }),
        sched({ scheduleId: "b", receivableId: 2, scheduledCommissionAmount: 40 }),
      ],
    });
    assert.deepEqual(r.findings, []);
    assert.equal(r.affectedOrderCount, 0);
  });

  it("schedule de snapshot SUPERSEDED em status não-ACTIVE é situação normal", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap(), snap({ snapshotId: "snap-velho", status: "SUPERSEDED" })],
      schedules: [
        sched(),
        sched({
          scheduleId: "velho",
          orderSnapshotId: "snap-velho",
          status: "SUPERSEDED",
        }),
      ],
    });
    assert.deepEqual(r.findings, []);
  });
});

describe("auditoria — detecta o defeito dos órfãos", () => {
  it("ACTIVE sob snapshot SUPERSEDED é achado de risco alto", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap({ snapshotId: "snap-velho", status: "SUPERSEDED" })],
      schedules: [
        sched({ orderSnapshotId: "snap-velho", scheduledCommissionAmount: 0 }),
      ],
    });
    assert.equal(r.countsByKind.ACTIVE_SCHEDULE_UNDER_NON_ACTIVE_SNAPSHOT, 1);
    assert.equal(r.findings[0]!.risk, "HIGH");
    assert.match(r.findings[0]!.suggestedAction, /Não apagar/i);
  });

  it("soma o valor preso em órfãos", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap({ snapshotId: "s", status: "SUPERSEDED" })],
      schedules: [
        sched({ scheduleId: "a", orderSnapshotId: "s", scheduledCommissionAmount: 137.79 }),
        sched({ scheduleId: "b", orderSnapshotId: "s", receivableId: 2, scheduledCommissionAmount: 137.79 }),
      ],
    });
    assert.equal(r.orphanScheduledAmount, 275.58);
  });

  it("agrupa por pedido em vez de uma linha por schedule", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap({ snapshotId: "s", status: "SUPERSEDED" })],
      schedules: [
        sched({ scheduleId: "a", orderSnapshotId: "s", receivableId: 1 }),
        sched({ scheduleId: "b", orderSnapshotId: "s", receivableId: 2 }),
      ],
    });
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0]!.scheduleIds.length, 2);
  });
});

describe("auditoria — demais inconsistências", () => {
  it("snapshot ACTIVE com comissão e sem schedule = materialização interrompida", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap({ totalFinalCommissionAmount: 688.96 })],
      schedules: [],
    });
    assert.equal(r.countsByKind.ACTIVE_SNAPSHOT_WITHOUT_SCHEDULES, 1);
  });

  it("snapshot ACTIVE zerado sem schedule NÃO é achado (é legítimo)", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap({ totalFinalCommissionAmount: 0 })],
      schedules: [],
    });
    assert.deepEqual(r.findings, []);
  });

  it("mesmo título vigente em dois snapshots ACTIVE é ambiguidade real", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap(), snap({ snapshotId: "snap-2", nfeId: 7522 })],
      schedules: [
        sched({ scheduleId: "a" }),
        sched({ scheduleId: "b", orderSnapshotId: "snap-2" }),
      ],
    });
    assert.equal(r.countsByKind.MULTIPLE_EFFECTIVE_SETS_FOR_RECEIVABLE, 1);
    assert.equal(r.findings.some((f) => f.receivableId === 9001), true);
  });

  it("schedule sem snapshot na carga é sinalizado", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [],
      schedules: [sched({ orderSnapshotId: "fantasma" })],
    });
    assert.equal(r.countsByKind.SCHEDULE_WITHOUT_SNAPSHOT, 1);
  });

  it("rateio que não fecha no centavo é sinalizado", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap({ totalFinalCommissionAmount: 100 })],
      schedules: [sched({ scheduledCommissionAmount: 99.9 })],
    });
    assert.equal(r.countsByKind.SCHEDULE_TOTAL_DIVERGES_FROM_SNAPSHOT, 1);
  });

  it("diferença de meio centavo não vira ruído", () => {
    const r = auditCommissionScheduleConsistency({
      snapshots: [snap({ totalFinalCommissionAmount: 100 })],
      schedules: [sched({ scheduledCommissionAmount: 100.004 })],
    });
    assert.deepEqual(r.findings, []);
  });
});

describe("auditoria — contrato", () => {
  it("é pura: não muta a entrada", () => {
    const snapshots = [snap({ status: "SUPERSEDED" })];
    const schedules = [sched()];
    const antes = JSON.stringify({ snapshots, schedules });
    auditCommissionScheduleConsistency({ snapshots, schedules });
    assert.equal(JSON.stringify({ snapshots, schedules }), antes);
  });

  it("é determinística", () => {
    const input = {
      snapshots: [snap({ status: "SUPERSEDED" })],
      schedules: [sched()],
    };
    assert.deepEqual(
      auditCommissionScheduleConsistency(input),
      auditCommissionScheduleConsistency(input)
    );
  });

  it("entrada vazia não quebra", () => {
    const r = auditCommissionScheduleConsistency({ snapshots: [], schedules: [] });
    assert.equal(r.snapshotsAnalyzed, 0);
    assert.deepEqual(r.findings, []);
  });
});

describe("guarda estrutural — seletor oficial de vigência", () => {
  const base = "src/lib/commissions/";

  it("o motor carrega schedules exigindo snapshot ACTIVE", () => {
    const src = readFileSync(`${base}commissionReceiptEngine.server.ts`, "utf8");
    assert.match(src, /commissionActiveSnapshotWhere\(\)/);
  });

  it("o seletor do motor puro descarta schedule de snapshot substituído", () => {
    const src = readFileSync(`${base}commissionReceiptEngine.ts`, "utf8");
    assert.match(src, /keepSchedulesFromActiveSnapshot/);
    assert.match(src, /isCommissionScheduleFromActiveSnapshot/);
  });

  it("o orquestrador exige pai vigente nas consultas de cobertura", () => {
    const src = readFileSync(
      `${base}commissionMaterializationOrchestrator.server.ts`,
      "utf8"
    );
    assert.match(src, /commissionActiveSnapshotWhere\(\)/);
  });

  it("a auditoria de rastreio usa o seletor oficial, não índice cru", () => {
    const src = readFileSync(`${base}commissionTraceAudit.server.ts`, "utf8");
    assert.match(src, /pickMaterializedScheduleForReceivable/);
    assert.doesNotMatch(
      src,
      /materializedByReceivableId\.get\([^)]*\)\?\.\[0\]/,
      "voltar a pegar [0] duplica a regra de seleção"
    );
  });

  it("a regra de vigência vive num módulo único", () => {
    const src = readFileSync(`${base}commissionScheduleVigency.ts`, "utf8");
    assert.match(src, /export function commissionActiveSnapshotWhere/);
    assert.match(src, /export function keepSchedulesFromActiveSnapshot/);
  });
});
