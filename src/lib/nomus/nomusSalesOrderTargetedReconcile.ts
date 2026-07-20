/**
 * HOTFIX-02 — Escopo e identidade do reconcile histórico direcionado de Pedidos.
 * Puro: sem HTTP/Prisma.
 */

import {
  canonicalNomusOrderCodeKey,
  normalizeNomusOrderCodeForStorage,
} from "../salesOrderNomusSync.server.js";
import type { NomusSourceSyncScope } from "./nomusSourceLifecycleContract.js";
import type {
  SalesOrderFetchCompletenessAssessment,
  SalesOrderLifecycleLocalSnapshot,
} from "./nomusSalesOrderSourceReconciliation.js";

export type SalesOrderReconcileStrategyLabel =
  | "recent-window"
  | "full-reconciliation"
  | "targeted-lookup";

export type SalesOrderTargetedLookupStatus =
  | "found"
  | "not_found"
  | "inconclusive";

export function hasSalesOrderReconcileTarget(input: {
  externalId?: number | null;
  orderCode?: string | null;
}): boolean {
  return (
    (input.externalId != null && Number.isFinite(input.externalId)) ||
    Boolean(input.orderCode?.trim())
  );
}

export function buildSalesOrderTargetedLookupScope(input: {
  fromIso: string;
  toIso: string;
  externalId: number | null;
  orderCode: string | null;
}): NomusSourceSyncScope {
  return {
    kind: "sales_order_targeted_lookup",
    from: input.fromIso,
    to: input.toIso,
    strategy: "targeted-lookup",
    onlyPending: null,
    extras: {
      externalId: input.externalId,
      orderCode: input.orderCode,
      strategy: "TARGETED_LOOKUP",
    },
  };
}

/**
 * Completude de TARGETED_LOOKUP: conclusivo só com found|not_found sem ambiguidade.
 * Inconclusivo → payloadComplete=false (nenhuma ausência).
 */
export function assessTargetedSalesOrderLookupCompleteness(input: {
  lookupStatus: SalesOrderTargetedLookupStatus;
  reason?: string | null;
}): SalesOrderFetchCompletenessAssessment {
  const reasons: string[] = [];
  if (input.lookupStatus === "inconclusive") {
    reasons.push("TARGETED_LOOKUP_INCONCLUSIVE");
    if (input.reason?.trim()) reasons.push(input.reason.trim());
    return {
      payloadComplete: false,
      status: "INCONCLUSIVE_FETCH",
      strategy: "targeted-lookup",
      reasons: [...new Set(reasons)],
      startPage: 1,
      stoppedBecauseEmpty: false,
      stoppedBecauseNoNext: false,
      stoppedBecauseMaxPages: false,
      http429Count: 0,
      errors: input.reason?.trim() ? [input.reason.trim()] : [],
    };
  }

  reasons.push("TARGETED_LOOKUP_CONCLUSIVE");
  reasons.push(
    input.lookupStatus === "found" ? "TARGET_FOUND_IN_NOMUS" : "TARGET_NOT_FOUND_IN_NOMUS"
  );
  return {
    payloadComplete: true,
    status: "COMPLETE",
    strategy: "targeted-lookup",
    reasons: [...new Set(reasons)],
    startPage: 1,
    stoppedBecauseEmpty: input.lookupStatus === "not_found",
    stoppedBecauseNoNext: input.lookupStatus === "found",
    stoppedBecauseMaxPages: false,
    http429Count: 0,
    errors: [],
  };
}

export type ResolveSalesOrderReconcileTargetResult =
  | {
      ok: true;
      externalId: number | null;
      orderCode: string | null;
      orderCodeKey: string | null;
      local: SalesOrderLifecycleLocalSnapshot | null;
    }
  | {
      ok: false;
      code:
        | "TARGET_ORDER_CODE_INVALID"
        | "TARGET_IDENTITY_DIVERGENCE"
        | "TARGET_REQUIRED";
      message: string;
    };

/**
 * Resolve identidade exata do alvo.
 * Nunca usa includes/startsWith; nunca assume dígitos do código == externalId.
 */
export function resolveSalesOrderReconcileTargetIdentity(input: {
  externalId: number | null;
  orderCode: string | null;
  locals: ReadonlyArray<SalesOrderLifecycleLocalSnapshot>;
}): ResolveSalesOrderReconcileTargetResult {
  const externalId =
    input.externalId != null && Number.isFinite(input.externalId)
      ? Math.trunc(input.externalId)
      : null;
  const orderCodeRaw = input.orderCode?.trim() || null;
  const orderCodeKey = orderCodeRaw
    ? canonicalNomusOrderCodeKey(orderCodeRaw)
    : null;

  if (externalId == null && !orderCodeRaw) {
    return {
      ok: false,
      code: "TARGET_REQUIRED",
      message: "Informe --externalId e/ou --orderCode para TARGETED_LOOKUP.",
    };
  }
  if (orderCodeRaw && !orderCodeKey) {
    return {
      ok: false,
      code: "TARGET_ORDER_CODE_INVALID",
      message: `orderCode inválido para match canônico: ${orderCodeRaw}`,
    };
  }

  const byExternalId =
    externalId != null
      ? input.locals.find((l) => l.externalSalesOrderId === externalId) ?? null
      : null;
  const byOrderCode = orderCodeKey
    ? input.locals.find((l) => {
        const key =
          canonicalNomusOrderCodeKey(l.orderCode) ??
          canonicalNomusOrderCodeKey(
            (l as { externalSalesOrderCode?: string | null }).externalSalesOrderCode
          );
        return key === orderCodeKey;
      }) ?? null
    : null;

  if (byExternalId && byOrderCode && byExternalId.localId !== byOrderCode.localId) {
    return {
      ok: false,
      code: "TARGET_IDENTITY_DIVERGENCE",
      message: `externalId=${externalId} e orderCode=${orderCodeRaw} resolvem pedidos locais distintos.`,
    };
  }

  const local = byExternalId ?? byOrderCode ?? null;

  if (local && externalId != null && local.externalSalesOrderId !== externalId) {
    return {
      ok: false,
      code: "TARGET_IDENTITY_DIVERGENCE",
      message: `orderCode=${orderCodeRaw} aponta para externalId=${local.externalSalesOrderId}, não ${externalId}.`,
    };
  }

  if (local && orderCodeKey) {
    const localKey = canonicalNomusOrderCodeKey(local.orderCode);
    if (localKey && localKey !== orderCodeKey) {
      return {
        ok: false,
        code: "TARGET_IDENTITY_DIVERGENCE",
        message: `externalId=${externalId} tem orderCode=${local.orderCode}, não ${orderCodeRaw}.`,
      };
    }
  }

  const resolvedOrderCode =
    local?.orderCode ??
    (orderCodeRaw ? normalizeNomusOrderCodeForStorage(orderCodeRaw) : null);

  return {
    ok: true,
    externalId: local?.externalSalesOrderId ?? externalId,
    orderCode: resolvedOrderCode,
    orderCodeKey:
      orderCodeKey ??
      (resolvedOrderCode ? canonicalNomusOrderCodeKey(resolvedOrderCode) : null),
    local,
  };
}

/** Match exato por chave canônica (proíbe PD 027 → PD 02739). */
export function salesOrderOrderCodesMatchExactly(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const a = canonicalNomusOrderCodeKey(left);
  const b = canonicalNomusOrderCodeKey(right);
  return a != null && b != null && a === b;
}

export function assertTargetedNomusIdentityConsistent(input: {
  expectedExternalId: number | null;
  expectedOrderCode: string | null;
  foundExternalId: number | null;
  foundOrderCode: string | null;
}): void {
  if (
    input.expectedExternalId != null &&
    input.foundExternalId != null &&
    input.expectedExternalId !== input.foundExternalId
  ) {
    throw new Error(
      `TARGET_IDENTITY_DIVERGENCE: esperado externalId=${input.expectedExternalId}, Nomus retornou ${input.foundExternalId}.`
    );
  }
  if (
    input.expectedOrderCode?.trim() &&
    input.foundOrderCode?.trim() &&
    !salesOrderOrderCodesMatchExactly(input.expectedOrderCode, input.foundOrderCode)
  ) {
    throw new Error(
      `TARGET_IDENTITY_DIVERGENCE: esperado orderCode=${input.expectedOrderCode}, Nomus retornou ${input.foundOrderCode}.`
    );
  }
}
