/**
 * FASE 3 — cliente HTTP do Collector (frontend).
 *
 * Todas as rotas passam pelo deviceAuth do servidor (Tailscale + Registry).
 * O browser NÃO envia identidade: nem deviceId, nem actorType, nem StableID —
 * o servidor deriva tudo do peer real.
 */
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import type { CollectorLineInfo, CollectorSubmission } from "./collectorCountFlow";

export type CollectorContext = { device: { id: string; name: string } | null };

export type CollectorSessionSummary = {
  id: string;
  code: string;
  startedAt: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  totalLines: number;
  countedLines: number;
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

export async function fetchCollectorSessions(): Promise<CollectorSessionSummary[]> {
  const data = await fetchJsonOk<{ sessions: CollectorSessionSummary[] }>(
    "/api/inventory/collector/count-sessions",
    { suppressAuthEvent: true }
  );
  return data.sessions ?? [];
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
  // Replay idempotente é sucesso normal — o chamador não distingue.
  return { replayed: data.replayed === true };
}
