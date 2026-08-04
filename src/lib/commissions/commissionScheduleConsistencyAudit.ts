/**
 * Auditoria de consistência entre snapshots e schedules — lógica pura.
 *
 * GRÃO OFICIAL (provado, ver relatório da Fase C)
 * Snapshot: `(salesOrderId, nfeId)` — há UNIQUE parcial
 * `CommissionOrderSnapshot_salesOrderId_nfeId_active_key`, e o materializador
 * supersede exatamente por essa chave. Um pedido com várias NF-e tem vários
 * snapshots ACTIVE, um por NF-e — "um snapshot por pedido" seria falso.
 *
 * Schedule: `(orderSnapshotId, receivableId)`. Não existe divisão de comissão
 * entre vendedores — `canonicalSellerId` é copiado do snapshot, que tem um
 * único vendedor. Um título (`receivableId`) pertence a uma NF-e
 * (`sourceInvoiceId`), logo a no máximo um snapshot ACTIVE.
 *
 * Portanto o invariante que FALTA proteger é cross-table:
 *   no máximo um schedule ACTIVE por `receivableId` ENTRE snapshots ACTIVE.
 * O índice atual é escopado por snapshot e, por construção, permite N.
 *
 * Este módulo só CLASSIFICA. Não escreve, não repara.
 */

export type ScheduleAuditSnapshotRow = {
  snapshotId: string;
  salesOrderId: string;
  orderCode: string | null;
  nfeId: number | null;
  status: string;
  totalFinalCommissionAmount: number;
};

export type ScheduleAuditScheduleRow = {
  scheduleId: string;
  orderSnapshotId: string;
  receivableId: number;
  salesOrderId: string;
  status: string;
  scheduledCommissionAmount: number;
};

export type ScheduleAuditFindingKind =
  /** ACTIVE sob snapshot não vigente — o defeito dos 638 órfãos. */
  | "ACTIVE_SCHEDULE_UNDER_NON_ACTIVE_SNAPSHOT"
  /** Snapshot vigente com comissão > 0 e nenhum schedule vigente. */
  | "ACTIVE_SNAPSHOT_WITHOUT_SCHEDULES"
  /** Mesmo título com schedule vigente em mais de um snapshot ACTIVE. */
  | "MULTIPLE_EFFECTIVE_SETS_FOR_RECEIVABLE"
  /** Schedule apontando para snapshot inexistente na carga. */
  | "SCHEDULE_WITHOUT_SNAPSHOT"
  /** Soma dos schedules vigentes não fecha com o snapshot. */
  | "SCHEDULE_TOTAL_DIVERGES_FROM_SNAPSHOT";

export type ScheduleAuditFinding = {
  kind: ScheduleAuditFindingKind;
  risk: "HIGH" | "MEDIUM" | "LOW";
  salesOrderId: string;
  orderCode: string | null;
  snapshotId: string | null;
  scheduleIds: string[];
  receivableId: number | null;
  detail: string;
  suggestedAction: string;
};

const CENT = 0.005;

export type ScheduleConsistencyAuditResult = {
  snapshotsAnalyzed: number;
  schedulesAnalyzed: number;
  findings: ScheduleAuditFinding[];
  countsByKind: Record<ScheduleAuditFindingKind, number>;
  affectedOrderCount: number;
  /** Valor em schedules ACTIVE presos a snapshot não vigente. */
  orphanScheduledAmount: number;
};

export function auditCommissionScheduleConsistency(input: {
  snapshots: readonly ScheduleAuditSnapshotRow[];
  schedules: readonly ScheduleAuditScheduleRow[];
}): ScheduleConsistencyAuditResult {
  const snapshotById = new Map(input.snapshots.map((s) => [s.snapshotId, s]));
  const findings: ScheduleAuditFinding[] = [];
  let orphanScheduledAmount = 0;

  // 1. ACTIVE sob pai não vigente + schedule sem pai.
  const orphansByOrder = new Map<string, ScheduleAuditScheduleRow[]>();
  for (const sch of input.schedules) {
    if (sch.status !== "ACTIVE") continue;
    const snap = snapshotById.get(sch.orderSnapshotId);
    if (!snap) {
      findings.push({
        kind: "SCHEDULE_WITHOUT_SNAPSHOT",
        risk: "HIGH",
        salesOrderId: sch.salesOrderId,
        orderCode: null,
        snapshotId: null,
        scheduleIds: [sch.scheduleId],
        receivableId: sch.receivableId,
        detail: `Schedule ACTIVE aponta para snapshot ${sch.orderSnapshotId}, ausente na carga.`,
        suggestedAction:
          "Verificar integridade referencial antes de qualquer reprocessamento.",
      });
      continue;
    }
    if (snap.status !== "ACTIVE") {
      orphanScheduledAmount += sch.scheduledCommissionAmount;
      const list = orphansByOrder.get(sch.salesOrderId) ?? [];
      list.push(sch);
      orphansByOrder.set(sch.salesOrderId, list);
    }
  }
  for (const [salesOrderId, list] of orphansByOrder) {
    const snap = snapshotById.get(list[0]!.orderSnapshotId)!;
    findings.push({
      kind: "ACTIVE_SCHEDULE_UNDER_NON_ACTIVE_SNAPSHOT",
      risk: "HIGH",
      salesOrderId,
      orderCode: snap.orderCode,
      snapshotId: snap.snapshotId,
      scheduleIds: list.map((s) => s.scheduleId),
      receivableId: null,
      detail: `${list.length} schedule(s) ACTIVE sob snapshot ${snap.status}.`,
      suggestedAction:
        "Rematerializar o pedido; os antigos devem deixar o estado vigente. Não apagar.",
    });
  }

  // 2. Mesmo título com conjunto efetivo em mais de um snapshot ACTIVE.
  const effectiveByReceivable = new Map<number, ScheduleAuditScheduleRow[]>();
  for (const sch of input.schedules) {
    if (sch.status !== "ACTIVE") continue;
    const snap = snapshotById.get(sch.orderSnapshotId);
    if (!snap || snap.status !== "ACTIVE") continue;
    const list = effectiveByReceivable.get(sch.receivableId) ?? [];
    list.push(sch);
    effectiveByReceivable.set(sch.receivableId, list);
  }
  for (const [receivableId, list] of effectiveByReceivable) {
    const distinctSnapshots = new Set(list.map((s) => s.orderSnapshotId));
    if (distinctSnapshots.size <= 1) continue;
    findings.push({
      kind: "MULTIPLE_EFFECTIVE_SETS_FOR_RECEIVABLE",
      risk: "HIGH",
      salesOrderId: list[0]!.salesOrderId,
      orderCode: snapshotById.get(list[0]!.orderSnapshotId)?.orderCode ?? null,
      snapshotId: null,
      scheduleIds: list.map((s) => s.scheduleId),
      receivableId,
      detail: `Título ${receivableId} com schedule vigente em ${distinctSnapshots.size} snapshots ACTIVE.`,
      suggestedAction:
        "Ambiguidade real: o fechamento não tem fonte única. Investigar antes de fechar o mês.",
    });
  }

  // 3. Snapshot vigente com comissão e sem schedule vigente + soma divergente.
  for (const snap of input.snapshots) {
    if (snap.status !== "ACTIVE") continue;
    const own = input.schedules.filter(
      (s) => s.orderSnapshotId === snap.snapshotId && s.status === "ACTIVE"
    );
    if (own.length === 0) {
      if (snap.totalFinalCommissionAmount > CENT) {
        findings.push({
          kind: "ACTIVE_SNAPSHOT_WITHOUT_SCHEDULES",
          risk: "HIGH",
          salesOrderId: snap.salesOrderId,
          orderCode: snap.orderCode,
          snapshotId: snap.snapshotId,
          scheduleIds: [],
          receivableId: null,
          detail: `Snapshot ACTIVE com comissão ${snap.totalFinalCommissionAmount.toFixed(2)} e nenhum schedule vigente — materialização possivelmente interrompida.`,
          suggestedAction:
            "Reconstruir os schedules do snapshot vigente (rebuild), sem tocar no ledger.",
        });
      }
      continue;
    }
    const sum = own.reduce((s, r) => s + r.scheduledCommissionAmount, 0);
    if (Math.abs(sum - snap.totalFinalCommissionAmount) > CENT) {
      findings.push({
        kind: "SCHEDULE_TOTAL_DIVERGES_FROM_SNAPSHOT",
        risk: "MEDIUM",
        salesOrderId: snap.salesOrderId,
        orderCode: snap.orderCode,
        snapshotId: snap.snapshotId,
        scheduleIds: own.map((s) => s.scheduleId),
        receivableId: null,
        detail: `Soma dos schedules ${sum.toFixed(2)} ≠ snapshot ${snap.totalFinalCommissionAmount.toFixed(2)}.`,
        suggestedAction:
          "Rateio não fecha no centavo; reconstruir schedules do snapshot vigente.",
      });
    }
  }

  const countsByKind = {
    ACTIVE_SCHEDULE_UNDER_NON_ACTIVE_SNAPSHOT: 0,
    ACTIVE_SNAPSHOT_WITHOUT_SCHEDULES: 0,
    MULTIPLE_EFFECTIVE_SETS_FOR_RECEIVABLE: 0,
    SCHEDULE_WITHOUT_SNAPSHOT: 0,
    SCHEDULE_TOTAL_DIVERGES_FROM_SNAPSHOT: 0,
  } as Record<ScheduleAuditFindingKind, number>;
  for (const f of findings) countsByKind[f.kind] += 1;

  return {
    snapshotsAnalyzed: input.snapshots.length,
    schedulesAnalyzed: input.schedules.length,
    findings,
    countsByKind,
    affectedOrderCount: new Set(findings.map((f) => f.salesOrderId)).size,
    orphanScheduledAmount: Math.round(orphanScheduledAmount * 100) / 100,
  };
}
