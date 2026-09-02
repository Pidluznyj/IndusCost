/**
 * FASE 3 — cliente HTTP do Collector (frontend).
 *
 * Todas as rotas passam pelo deviceAuth do servidor (Tailscale + Registry).
 * O browser NÃO envia identidade: nem deviceId, nem actorType, nem StableID —
 * o servidor deriva tudo do peer real.
 */
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import type { CollectorLineInfo, CollectorSubmission } from "./collectorCountFlow";

export type CollectorContext = {
  device: {
    id: string;
    name: string;
    canManageCountSessions?: boolean;
    canApplyCountAdjustments?: boolean;
  } | null;
};

export type CollectorWarehouseDto = { id: string; code: string; name: string };

export type CollectorSessionProgressDto = {
  sessionId: string;
  code: string;
  status: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  totalLines: number;
  countedLines: number;
  pendingLines: number;
};

export type CollectorSectorContext = CollectorContext & {
  sector?: { code: string; label: string };
  warehouses?: CollectorWarehouseDto[];
  activeSession?: CollectorSessionProgressDto | null;
  operationalState?:
    | "READY"
    | "NEEDS_WAREHOUSE_SELECTION"
    | "CONFIGURATION_REQUIRED"
    | "NO_ELIGIBLE_ITEMS";
  diagnostics?: {
    activeWarehouses: number;
    warehousesWithRawMaterialPresence: number;
    eligibleMaterials: number;
    linkedRawMaterialItems: number;
  };
};

export type CollectorSessionSummary = {
  id: string;
  code: string;
  startedAt: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  totalLines: number;
  countedLines: number;
};

export type CollectorBlindItemDto = {
  lineId: string;
  itemId: string;
  code: string;
  description: string;
  unit: string;
  counted: boolean;
  countedQuantity: number | null;
  version: number;
  status: "pending" | "counted";
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
};

export type CollectorDivergenceDto = {
  lineId: string;
  itemId: string;
  code: string;
  description: string;
  unit: string;
  countedQuantity: number;
  expectedQuantity: number;
  adjustmentDelta: number;
  justification: string | null;
};

export type CollectorApiError = {
  status: number | null;
  code: string | null;
  message: string | null;
};

export function toCollectorApiError(e: unknown): CollectorApiError {
  if (e instanceof HttpError) {
    return { status: e.status, code: e.code ?? null, message: e.message };
  }
  if (e instanceof Error) return { status: null, code: null, message: e.message };
  return { status: null, code: null, message: null };
}

export async function fetchCollectorContext(): Promise<CollectorContext> {
  return fetchJsonOk<CollectorContext>("/api/inventory/collector/context", {
    suppressAuthEvent: true,
  });
}

export async function fetchCollectorSectorContext(
  sector: string,
  warehouseId?: string
): Promise<CollectorSectorContext> {
  const params = new URLSearchParams({ sector });
  if (warehouseId) params.set("warehouseId", warehouseId);
  return fetchJsonOk<CollectorSectorContext>(
    `/api/inventory/collector/context?${params.toString()}`,
    { suppressAuthEvent: true }
  );
}

export async function fetchCollectorSessions(): Promise<CollectorSessionSummary[]> {
  const data = await fetchJsonOk<{ sessions: CollectorSessionSummary[] }>(
    "/api/inventory/collector/count-sessions",
    { suppressAuthEvent: true }
  );
  return data.sessions ?? [];
}

export async function createCollectorSectorSession(input: {
  sector: string;
  warehouseId?: string;
  operationId: string;
}): Promise<{
  session: {
    id: string;
    code: string;
    status: string;
    warehouseId: string;
    startedAt: string | null;
  };
  reused: boolean;
}> {
  return fetchJsonOk(`/api/inventory/collector/count-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    suppressAuthEvent: true,
  });
}

export async function fetchCollectorSectorItems(
  sessionId: string,
  opts?: { q?: string; filter?: "all" | "pending" | "counted" }
): Promise<{ items: CollectorBlindItemDto[]; progress: CollectorSessionProgressDto }> {
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.filter) params.set("filter", opts.filter);
  const qs = params.toString();
  return fetchJsonOk(
    `/api/inventory/collector/count-sessions/${sessionId}/items${qs ? `?${qs}` : ""}`,
    { suppressAuthEvent: true }
  );
}

export async function submitCollectorSectorCount(input: {
  sessionId: string;
  lineId: string;
  countedQuantity: number;
  expectedVersion: number;
  operationId: string;
  justification?: string | null;
}): Promise<{ replayed: boolean }> {
  const data = await fetchJsonOk<{ replayed: boolean }>("/api/inventory/collector/count", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    suppressAuthEvent: true,
  });
  return { replayed: data.replayed === true };
}

export async function finalizeCollectorSectorSession(
  sessionId: string,
  body: { allowUncounted?: boolean; confirm?: boolean }
): Promise<{
  progress: CollectorSessionProgressDto;
  divergences: CollectorDivergenceDto[];
}> {
  return fetchJsonOk(`/api/inventory/collector/count-sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    suppressAuthEvent: true,
  });
}

export async function applyCollectorAdjustments(
  sessionId: string,
  body: { confirm: true; operationId: string }
): Promise<{ movementsCreated: number; alreadyApplied?: boolean }> {
  return fetchJsonOk(`/api/inventory/collector/count-sessions/${sessionId}/apply-adjustments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    suppressAuthEvent: true,
  });
}

export async function resolveCollectorQr(
  sessionId: string,
  qr: string
): Promise<CollectorLineInfo> {
  const data = await fetchJsonOk<{ line: CollectorLineInfo }>(
    "/api/inventory/collector/resolve-qr",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, qr }),
      suppressAuthEvent: true,
    }
  );
  return data.line;
}

export async function submitCollectorCount(
  sessionId: string,
  submission: CollectorSubmission
): Promise<{ replayed: boolean }> {
  const data = await fetchJsonOk<{ replayed: boolean }>(
    `/api/inventory/collector/count-sessions/${sessionId}/lines/${submission.lineId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countedQuantity: submission.countedQuantity,
        justification: submission.justification,
        expectedVersion: submission.expectedVersion,
        operationId: submission.operationId,
      }),
      suppressAuthEvent: true,
    }
  );
  return { replayed: data.replayed === true };
}

/* ------------------------------------------------------------------ *
 * Enrollment — primeiro acesso de um tablet ainda não autorizado.
 *
 * O browser continua sem enviar identidade: o servidor deriva tudo do peer
 * Tailscale real. Solicitar NÃO autoriza — as demais rotas seguem em 403 até
 * um humano aprovar.
 * ------------------------------------------------------------------ */

export type CollectorEnrollmentStatus = "AUTHORIZED" | "PENDING" | "REJECTED" | "NONE";

export type CollectorEnrollmentResult = {
  status: CollectorEnrollmentStatus;
  message: string;
};

/** Registra/renova a solicitação. `sector` é só contexto do QR aberto. */
export async function requestCollectorEnrollment(
  sector?: string
): Promise<CollectorEnrollmentResult> {
  return fetchJsonOk<CollectorEnrollmentResult>("/api/inventory/collector/enrollment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sector ? { sector } : {}),
    suppressAuthEvent: true,
  });
}

export async function fetchCollectorEnrollmentStatus(): Promise<CollectorEnrollmentResult> {
  return fetchJsonOk<CollectorEnrollmentResult>("/api/inventory/collector/enrollment", {
    suppressAuthEvent: true,
  });
}

/* ------------------------------------------------------------------ *
 * Retirada de material (saída de estoque pelo tablet)
 * ------------------------------------------------------------------ */

/**
 * Item retirável. Sem nenhuma quantidade, de propósito: o mesmo aparelho faz
 * contagem cega no mesmo setor e não pode conhecer o saldo do sistema.
 */
export type CollectorWithdrawItemDto = {
  itemId: string;
  code: string;
  description: string;
  unit: string;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
};

export type CollectorWithdrawResult = {
  ok: true;
  idempotent: boolean;
  item: { code: string; description: string; unit: string };
  quantity: number;
  withdrawnBy: string;
};

export async function fetchCollectorWithdrawItems(input: {
  sector: string;
  warehouseId: string;
  q?: string;
}): Promise<{ items: CollectorWithdrawItemDto[] }> {
  const params = new URLSearchParams({
    sector: input.sector,
    warehouseId: input.warehouseId,
  });
  if (input.q) params.set("q", input.q);
  return fetchJsonOk<{ items: CollectorWithdrawItemDto[] }>(
    `/api/inventory/collector/withdraw/items?${params.toString()}`,
    { suppressAuthEvent: true }
  );
}

/**
 * Executa a retirada. `operationId` é gerado UMA vez por intenção e reenviado
 * no retry — é ele que impede um segundo toque de debitar duas vezes.
 */
export async function submitCollectorWithdrawal(input: {
  operationId: string;
  sector: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  quantity: number;
  person: string;
}): Promise<CollectorWithdrawResult> {
  return fetchJsonOk<CollectorWithdrawResult>("/api/inventory/collector/withdraw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    suppressAuthEvent: true,
  });
}
