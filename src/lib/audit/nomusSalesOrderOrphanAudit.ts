/**
 * OP-81 — Comparação pura Local × Nomus para candidatos a órfãos.
 * Sem I/O; read-only por construção.
 */

import { canonicalNomusOrderCodeKey } from "@/src/lib/salesOrderNomusSync.server.js";
import type {
  NomusPedidoIdentity,
  NomusPedidosFetchCompleteness,
} from "@/src/lib/nomusSalesOrdersClient.js";

export type LocalSalesOrderIdentity = {
  id: string;
  externalSalesOrderId: number | null;
  orderCode: string;
  externalSalesOrderCode: string | null;
  issueDateIso: string;
  status: string;
  totalNetValue: number;
  customerName: string | null;
  sellerName: string | null;
  itemCount: number;
};

export type OrphanRowClassification =
  | "MATCHED"
  | "LOCAL_ONLY_CANDIDATE"
  | "NOMUS_ONLY"
  | "IDENTITY_MISMATCH"
  | "INCONCLUSIVE_FETCH"
  | "CONFIRMED_MISSING_IN_NOMUS"
  | "CANDIDATE_MISSING_IN_NOMUS";

export type OrphanCompareRow = {
  classification: OrphanRowClassification;
  matchKey: string;
  local: LocalSalesOrderIdentity | null;
  nomus: NomusPedidoIdentity | null;
  notes: string[];
  /** Ausente na origem — nunca usar a palavra "excluído" aqui. */
  absenceObserved: boolean;
  autoActionRisk: "none" | "low" | "medium" | "high";
};

export type LocalImpactSnapshot = {
  nfeLinkCount: number;
  productionOrderLinkCount: number;
  commissionSnapshotCount: number;
  commissionReceivableCount: number;
  hasFlowSnapshot: boolean;
  orderToCashFactCount: number;
  portfolioFactCount: number;
  /** CR: apenas correspondência textual informativa, nunca vínculo oficial. */
  arTextualHints: number;
  highRisk: boolean;
};

export type OrphanAuditSummary = {
  localCount: number;
  nomusCount: number;
  matchedCount: number;
  localOnlyCandidateCount: number;
  confirmedMissingCount: number;
  candidateMissingCount: number;
  nomusOnlyCount: number;
  identityMismatchCount: number;
  inconclusiveCount: number;
  totalValueConfirmedMissing: number;
  fetchCompleteness: NomusPedidosFetchCompleteness;
  durationMs: number;
  http429Count: number;
  errors: string[];
};

function codeKeyOf(local: LocalSalesOrderIdentity): string | null {
  return (
    canonicalNomusOrderCodeKey(local.orderCode) ??
    canonicalNomusOrderCodeKey(local.externalSalesOrderCode)
  );
}

/**
 * Compara universos. Se a coleta Nomus for incompleta, nenhum LOCAL_ONLY
 * vira órfão confirmado — todos viram INCONCLUSIVE_FETCH.
 */
export function compareLocalAndNomusSalesOrders(args: {
  local: readonly LocalSalesOrderIdentity[];
  nomus: readonly NomusPedidoIdentity[];
  completeness: NomusPedidosFetchCompleteness;
}): OrphanCompareRow[] {
  const rows: OrphanCompareRow[] = [];
  const nomusByExternalId = new Map<number, NomusPedidoIdentity>();
  const nomusByCode = new Map<string, NomusPedidoIdentity[]>();
  const matchedNomus = new Set<NomusPedidoIdentity>();

  for (const n of args.nomus) {
    if (n.externalSalesOrderId != null) {
      nomusByExternalId.set(n.externalSalesOrderId, n);
    }
    if (n.orderCodeKey) {
      const list = nomusByCode.get(n.orderCodeKey) ?? [];
      list.push(n);
      nomusByCode.set(n.orderCodeKey, list);
    }
  }

  const incomplete = !args.completeness.complete;

  for (const local of args.local) {
    const notes: string[] = [];
    const byId =
      local.externalSalesOrderId != null
        ? nomusByExternalId.get(local.externalSalesOrderId) ?? null
        : null;
    const key = codeKeyOf(local);
    const byCodeList = key ? nomusByCode.get(key) ?? [] : [];
    const byCode = byCodeList[0] ?? null;

    if (byId && byCode && byId !== byCode) {
      notes.push(
        "externalSalesOrderId e código apontam para identidades Nomus distintas."
      );
      matchedNomus.add(byId);
      matchedNomus.add(byCode);
      rows.push({
        classification: "IDENTITY_MISMATCH",
        matchKey: `id:${local.externalSalesOrderId}|code:${key}`,
        local,
        nomus: byId,
        notes,
        absenceObserved: false,
        autoActionRisk: "high",
      });
      continue;
    }

    if (byId) {
      const remoteKey = byId.orderCodeKey;
      const localKey = key;
      if (remoteKey && localKey && remoteKey !== localKey) {
        notes.push(
          `Mesmo externalSalesOrderId=${local.externalSalesOrderId} com código divergente ` +
            `(local=${local.orderCode}, nomus=${byId.orderCode ?? "—"}).`
        );
        matchedNomus.add(byId);
        rows.push({
          classification: "IDENTITY_MISMATCH",
          matchKey: `id:${local.externalSalesOrderId}`,
          local,
          nomus: byId,
          notes,
          absenceObserved: false,
          autoActionRisk: "high",
        });
        continue;
      }
      matchedNomus.add(byId);
      rows.push({
        classification: "MATCHED",
        matchKey: `id:${local.externalSalesOrderId}`,
        local,
        nomus: byId,
        notes,
        absenceObserved: false,
        autoActionRisk: "none",
      });
      continue;
    }

    if (byCode) {
      if (
        byCode.externalSalesOrderId != null &&
        local.externalSalesOrderId != null &&
        byCode.externalSalesOrderId !== local.externalSalesOrderId
      ) {
        notes.push(
          `Mesmo código (${local.orderCode}) com external ID diferente ` +
            `(local=${local.externalSalesOrderId}, nomus=${byCode.externalSalesOrderId}).`
        );
        matchedNomus.add(byCode);
        rows.push({
          classification: "IDENTITY_MISMATCH",
          matchKey: `code:${key}`,
          local,
          nomus: byCode,
          notes,
          absenceObserved: false,
          autoActionRisk: "high",
        });
        continue;
      }
      matchedNomus.add(byCode);
      notes.push("Casado por código canônico (sem externalSalesOrderId local ou remoto).");
      rows.push({
        classification: "MATCHED",
        matchKey: `code:${key}`,
        local,
        nomus: byCode,
        notes,
        absenceObserved: false,
        autoActionRisk: "none",
      });
      continue;
    }

    if (incomplete) {
      notes.push(
        "Coleta Nomus incompleta/inconclusiva — não classificar como órfão confirmado."
      );
      rows.push({
        classification: "INCONCLUSIVE_FETCH",
        matchKey: `local:${local.id}`,
        local,
        nomus: null,
        notes,
        absenceObserved: false,
        autoActionRisk: "none",
      });
      continue;
    }

    notes.push("Ausente no payload completo do Nomus no período.");
    rows.push({
      classification: "LOCAL_ONLY_CANDIDATE",
      matchKey: `local:${local.id}`,
      local,
      nomus: null,
      notes,
      absenceObserved: true,
      autoActionRisk: "medium",
    });
  }

  for (const n of args.nomus) {
    if (matchedNomus.has(n)) continue;
    rows.push({
      classification: incomplete ? "INCONCLUSIVE_FETCH" : "NOMUS_ONLY",
      matchKey:
        n.externalSalesOrderId != null
          ? `nomus-id:${n.externalSalesOrderId}`
          : `nomus-code:${n.orderCodeKey ?? n.orderCode ?? "?"}`,
      local: null,
      nomus: n,
      notes: incomplete
        ? ["Coleta incompleta — presença remota registrada sem reconciliar."]
        : ["Presente no Nomus e ausente no universo local do período."],
      absenceObserved: false,
      autoActionRisk: "none",
    });
  }

  return rows;
}

export function applyDirectedConfirmation(
  row: OrphanCompareRow,
  lookup: { status: "found" | "not_found" | "inconclusive"; reason?: string }
): OrphanCompareRow {
  if (row.classification !== "LOCAL_ONLY_CANDIDATE") return row;
  const notes = [...row.notes];
  if (lookup.status === "found") {
    notes.push("Consulta direcionada encontrou o pedido no Nomus — não é ausência confirmada.");
    return {
      ...row,
      classification: "MATCHED",
      absenceObserved: false,
      autoActionRisk: "none",
      notes,
    };
  }
  if (lookup.status === "not_found") {
    notes.push(
      "Ausente no payload completo e ausente na consulta direcionada (ausente na origem)."
    );
    return {
      ...row,
      classification: "CONFIRMED_MISSING_IN_NOMUS",
      absenceObserved: true,
      autoActionRisk: row.autoActionRisk === "high" ? "high" : "medium",
      notes,
    };
  }
  notes.push(
    `Consulta direcionada inconclusiva${lookup.reason ? `: ${lookup.reason}` : ""}.`
  );
  return {
    ...row,
    classification: "CANDIDATE_MISSING_IN_NOMUS",
    absenceObserved: true,
    notes,
  };
}

export function assessAutoActionRisk(impact: LocalImpactSnapshot): "low" | "medium" | "high" {
  if (
    impact.nfeLinkCount > 0 ||
    impact.commissionReceivableCount > 0 ||
    impact.highRisk
  ) {
    return "high";
  }
  if (
    impact.productionOrderLinkCount > 0 ||
    impact.commissionSnapshotCount > 0 ||
    impact.hasFlowSnapshot ||
    impact.orderToCashFactCount > 0
  ) {
    return "medium";
  }
  return "low";
}

export function summarizeOrphanAudit(args: {
  rows: readonly OrphanCompareRow[];
  completeness: NomusPedidosFetchCompleteness;
  durationMs: number;
}): OrphanAuditSummary {
  const { rows, completeness, durationMs } = args;
  let matchedCount = 0;
  let localOnlyCandidateCount = 0;
  let confirmedMissingCount = 0;
  let candidateMissingCount = 0;
  let nomusOnlyCount = 0;
  let identityMismatchCount = 0;
  let inconclusiveCount = 0;
  let totalValueConfirmedMissing = 0;
  let localCount = 0;
  let nomusCount = 0;

  for (const row of rows) {
    if (row.local) localCount += 1;
    if (row.nomus) nomusCount += 1;
    switch (row.classification) {
      case "MATCHED":
        matchedCount += 1;
        break;
      case "LOCAL_ONLY_CANDIDATE":
        localOnlyCandidateCount += 1;
        break;
      case "CONFIRMED_MISSING_IN_NOMUS":
        confirmedMissingCount += 1;
        totalValueConfirmedMissing += row.local?.totalNetValue ?? 0;
        break;
      case "CANDIDATE_MISSING_IN_NOMUS":
        candidateMissingCount += 1;
        break;
      case "NOMUS_ONLY":
        nomusOnlyCount += 1;
        break;
      case "IDENTITY_MISMATCH":
        identityMismatchCount += 1;
        break;
      case "INCONCLUSIVE_FETCH":
        inconclusiveCount += 1;
        break;
      default:
        break;
    }
  }

  // Contagens de universo: preferir inputs via rows únicos
  const localIds = new Set(rows.filter((r) => r.local).map((r) => r.local!.id));
  const nomusKeys = new Set(
    rows
      .filter((r) => r.nomus)
      .map((r) =>
        r.nomus!.externalSalesOrderId != null
          ? `id:${r.nomus!.externalSalesOrderId}`
          : `code:${r.nomus!.orderCodeKey ?? r.nomus!.orderCode}`
      )
  );

  return {
    localCount: localIds.size || localCount,
    nomusCount: nomusKeys.size || nomusCount,
    matchedCount,
    localOnlyCandidateCount,
    confirmedMissingCount,
    candidateMissingCount,
    nomusOnlyCount,
    identityMismatchCount,
    inconclusiveCount,
    totalValueConfirmedMissing: Number(totalValueConfirmedMissing.toFixed(2)),
    fetchCompleteness: completeness,
    durationMs,
    http429Count: completeness.http429Count,
    errors: [...completeness.errors],
  };
}

/** Guardrail estático: este módulo não deve importar Prisma/write APIs. */
export const ORPHAN_AUDIT_READ_ONLY = true as const;
