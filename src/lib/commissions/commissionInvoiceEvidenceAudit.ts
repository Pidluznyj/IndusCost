/**
 * Auditoria (somente leitura) da evidência oficial do Nomus para alocar o faturamento
 * do pedido por item × NF-e (B5). Classifica cada pedido pela evidência que os
 * documentos de saída trazem — sem criar nem presumir vínculo:
 *
 *   UNEQUIVOCAL  toda NF-e válida do pedido tem linhas com o item oficial
 *                (idItemPedido / sequência), sem linha fraca nem reivindicada;
 *   AMBIGUOUS    há linha ligada ao pedido só por pedido/produto, linha reivindicada
 *                por mais de um pedido da NF-e, ou faturado acumulado acima do pedido;
 *   NO_EVIDENCE  alguma NF-e válida do pedido não tem linha com o item oficial.
 *
 * E o efeito na comissão com a regra B5: LEGACY_FULL (snapshot do pedido inteiro,
 * comprovado), ALLOCATED (só o faturado em cada NF-e) ou HELD (retido até evidência).
 * Lógica pura.
 */
import { roundMoney } from "./commission-money.shared.js";
import type { OrderInvoiceAllocation } from "./commissionInvoiceAllocation.js";

export type InvoiceEvidenceClass = "UNEQUIVOCAL" | "AMBIGUOUS" | "NO_EVIDENCE";
export type InvoiceEvidenceOutcome = "LEGACY_FULL" | "ALLOCATED" | "HELD";
export type OutputDocumentLineRefKind = "ITEM_ID" | "ITEM_SEQUENCE" | "ORDER_ONLY" | "NONE";

export type InvoiceEvidenceClassification = {
  evidenceClass: InvoiceEvidenceClass;
  outcome: InvoiceEvidenceOutcome;
  heldNfeIds: number[];
  reasons: string[];
};

export function classifyOrderInvoiceEvidence(
  allocation: OrderInvoiceAllocation,
  validNfeIds: readonly number[]
): InvoiceEvidenceClassification {
  const entries = validNfeIds.map((id) => allocation.byNfe.get(id)).filter((entry) => entry != null);
  const held = entries.filter((entry) => entry.basis === "ALLOCATION_PENDING");
  const reasons = [...new Set([...allocation.conflicts, ...entries.map((entry) => entry.reason).filter((reason): reason is string => !!reason)])];
  const { strongLines, weakLines } = allocation.evidence;
  const evidenceClass: InvoiceEvidenceClass =
    weakLines > 0 || allocation.conflicts.length > 0
      ? "AMBIGUOUS"
      : strongLines === 0 || held.length > 0
        ? "NO_EVIDENCE"
        : "UNEQUIVOCAL";
  const outcome: InvoiceEvidenceOutcome =
    held.length > 0 ? "HELD" : entries.length > 0 && entries.every((entry) => entry.basis === "FULL_ORDER_LEGACY") ? "LEGACY_FULL" : "ALLOCATED";
  return { evidenceClass, outcome, heldNfeIds: held.map((entry) => entry.nfeExternalId).sort((a, b) => a - b), reasons };
}

/** Que identificador oficial a linha do documento de saída traz (sem resolver nada). */
export function classifyOutputDocumentLineRefs(refs: {
  externalSalesOrderItemId: number | null;
  salesOrderItemSequence: string | null;
  externalSalesOrderId: number | null;
  orderCodeNormalized: string | null;
}): OutputDocumentLineRefKind {
  if (refs.externalSalesOrderItemId != null) return "ITEM_ID";
  if (refs.salesOrderItemSequence) return "ITEM_SEQUENCE";
  if (refs.externalSalesOrderId != null || refs.orderCodeNormalized) return "ORDER_ONLY";
  return "NONE";
}

export type InvoiceEvidenceAuditRow = InvoiceEvidenceClassification & {
  salesOrderId: string;
  orderCode: string;
  validNfeCount: number;
  proofStatus: string | null;
  proofSource: string | null;
  /** Comissão hoje programada nos snapshots ACTIVE do pedido (antes da regra B5). */
  activeSnapshotCommission: number;
};

export type InvoiceEvidenceAuditSummary = {
  orders: number;
  byClass: Record<InvoiceEvidenceClass, number>;
  byOutcome: Record<InvoiceEvidenceOutcome, { orders: number; activeSnapshotCommission: number }>;
  singleNfeProof: Record<string, number>;
  multiNfeOrders: number;
};

export function summarizeInvoiceEvidenceAudit(rows: readonly InvoiceEvidenceAuditRow[]): InvoiceEvidenceAuditSummary {
  const byClass: Record<InvoiceEvidenceClass, number> = { UNEQUIVOCAL: 0, AMBIGUOUS: 0, NO_EVIDENCE: 0 };
  const byOutcome: InvoiceEvidenceAuditSummary["byOutcome"] = {
    LEGACY_FULL: { orders: 0, activeSnapshotCommission: 0 },
    ALLOCATED: { orders: 0, activeSnapshotCommission: 0 },
    HELD: { orders: 0, activeSnapshotCommission: 0 },
  };
  const singleNfeProof: Record<string, number> = {};
  let multiNfeOrders = 0;
  for (const row of rows) {
    byClass[row.evidenceClass] += 1;
    const bucket = byOutcome[row.outcome];
    bucket.orders += 1;
    bucket.activeSnapshotCommission = roundMoney(bucket.activeSnapshotCommission + row.activeSnapshotCommission);
    if (row.validNfeCount > 1) multiNfeOrders += 1;
    if (row.validNfeCount === 1 && row.proofStatus) {
      const key = `${row.proofStatus}${row.proofSource ? ` · ${row.proofSource}` : ""}`;
      singleNfeProof[key] = (singleNfeProof[key] ?? 0) + 1;
    }
  }
  return { orders: rows.length, byClass, byOutcome, singleNfeProof, multiNfeOrders };
}
