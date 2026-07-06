import React, { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Play, RefreshCw, X, Zap } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  countLineHasDivergence,
  normalizeInventoryCountDetailResponse,
  type InventoryCountDetailResponse,
} from "@/src/components/inventory/inventoryCountPresentation";
import {
  formatInventoryCountStatus,
  INVENTORY_COUNT_STATUS_STYLES,
} from "@/src/components/inventory/inventoryCountLabels";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryQuantity,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryCountLineRow, InventoryCountSessionStatus } from "@/src/types/inventory";

type Props = {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
};

type LineDraft = {
  countedQuantity: string;
  justification: string;
};

function InventoryCountStatusBadge({ status }: { status: InventoryCountSessionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        INVENTORY_COUNT_STATUS_STYLES[status] ?? "bg-slate-50 text-slate-700 ring-slate-200"
      )}
    >
      {formatInventoryCountStatus(status)}
    </span>
  );
}

export function InventoryCountDetailSheet({ sessionId, open, onClose, onUpdated }: Props) {
  const { canManageCounts, canApproveCount } = useInventoryPermissions();
  const [data, setData] = useState<InventoryCountDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchJsonOk<unknown>(`/api/inventory/count-sessions/${sessionId}`);
      const detail = normalizeInventoryCountDetailResponse(raw);
      setData(detail);
      const nextDrafts: Record<string, LineDraft> = {};
      for (const line of detail.lines) {
        nextDrafts[line.id] = {
          countedQuantity:
            line.countedQuantity != null ? String(line.countedQuantity) : String(line.systemQuantity),
          justification: line.justification ?? "",
        };
      }
      setDrafts(nextDrafts);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao carregar conferência."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (open && sessionId) void load();
  }, [open, sessionId, load]);

  const runAction = async (key: string, path: string, method = "POST") => {
    setActionLoading(key);
    setError(null);
    try {
      await fetchJsonOk(path, { method });
      await load();
      onUpdated();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao executar ação."));
    } finally {
      setActionLoading(null);
    }
  };

  const saveLine = async (line: InventoryCountLineRow) => {
    const draft = drafts[line.id];
    if (!draft) return;
    const counted = Number(draft.countedQuantity);
    if (!Number.isFinite(counted) || counted < 0) {
      setError("Quantidade contada deve ser >= 0.");
      return;
    }
    setActionLoading(`line-${line.id}`);
    setError(null);
    try {
      await fetchJsonOk(`/api/inventory/count-sessions/${sessionId}/lines/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countedQuantity: counted,
          justification: draft.justification.trim() || null,
        }),
      });
      await load();
      onUpdated();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao salvar linha."));
    } finally {
      setActionLoading(null);
    }
  };

  if (!open) return null;

  const session = data?.session;
  const lines = data?.lines ?? [];
  const isLocked = session?.status === "ADJUSTED" || session?.status === "CANCELED";
  const canEditLines = canManageCounts && session?.status === "COUNTING";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" data-testid="inventory-count-detail-sheet">
      <button type="button" className="flex-1" aria-label="Fechar" onClick={onClose} />
      <div className="flex h-full w-full max-w-4xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Conferência física</p>
            <h2 className="text-lg font-semibold text-slate-900">{session?.code ?? "…"}</h2>
            {session ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <InventoryCountStatusBadge status={session.status} />
                <span>
                  {session.warehouseCode ?? "—"} — {session.warehouseName ?? "—"}
                </span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Fechar painel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {loading && !session ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Carregando…
          </div>
        ) : session ? (
          <>
            <div className="space-y-3 border-b border-slate-200 px-4 py-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-500">Responsável</p>
                  <p className="font-medium text-slate-900">{session.responsibleUserId ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Início</p>
                  <p>{formatInventoryDateTime(session.startedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Finalização</p>
                  <p>{formatInventoryDateTime(session.finishedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Aprovação</p>
                  <p>{formatInventoryDateTime(session.approvedAt)}</p>
                </div>
              </div>
              {session.notes ? (
                <p className="rounded-md bg-slate-50 px-3 py-2 text-slate-700">{session.notes}</p>
              ) : null}
              <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-slate-700">
                Ajustes de divergência são gerados por movimentação (
                <code className="text-xs">POSITIVE_ADJUSTMENT</code> /{" "}
                <code className="text-xs">NEGATIVE_ADJUSTMENT</code>) vinculada à conferência — o saldo
                nunca é alterado diretamente.                 Aprovação exige permissão{" "}
                <code className="text-xs">inventory.count.approve</code>,{" "}
                <code className="text-xs">inventory.count.manage</code> ou{" "}
                <code className="text-xs">inventory.manage</code>.
              </div>
              {canManageCounts && !isLocked ? (
                <div className="flex flex-wrap gap-2">
                  {session.status === "OPEN" ? (
                    <button
                      type="button"
                      disabled={!!actionLoading}
                      onClick={() => void runAction("start", `/api/inventory/count-sessions/${sessionId}/start`)}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {actionLoading === "start" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      Iniciar contagem
                    </button>
                  ) : null}
                  {session.status === "COUNTING" ? (
                    <button
                      type="button"
                      disabled={!!actionLoading}
                      onClick={() =>
                        void runAction("finalize", `/api/inventory/count-sessions/${sessionId}/finalize`)
                      }
                      className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {actionLoading === "finalize" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Finalizar contagem
                    </button>
                  ) : null}
                  {session.status === "WAITING_APPROVAL" && canApproveCount ? (
                    <button
                      type="button"
                      disabled={!!actionLoading}
                      onClick={() =>
                        void runAction("approve", `/api/inventory/count-sessions/${sessionId}/approve`)
                      }
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {actionLoading === "approve" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Aprovar
                    </button>
                  ) : session.status === "WAITING_APPROVAL" && !canApproveCount ? (
                    <p className="text-sm text-amber-700">
                      Aguardando aprovação de um gestor com permissão de aprovação de conferência.
                    </p>
                  ) : null}
                  {session.status === "APPROVED" && canManageCounts ? (
                    <button
                      type="button"
                      disabled={!!actionLoading}
                      onClick={() =>
                        void runAction(
                          "adjust",
                          `/api/inventory/count-sessions/${sessionId}/generate-adjustments`
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      {actionLoading === "adjust" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                      Gerar ajustes
                    </button>
                  ) : null}
                  {session.status !== "ADJUSTED" ? (
                    <button
                      type="button"
                      disabled={!!actionLoading}
                      onClick={() =>
                        void runAction("cancel", `/api/inventory/count-sessions/${sessionId}/cancel`)
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      Cancelar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void load()}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Atualizar
                  </button>
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-auto px-4 py-3">
              <table className={inventoryTableClassName}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Saldo sistema</th>
                    <th className="text-right">Saldo contado</th>
                    <th className="text-right">Diferença</th>
                    <th>Justificativa</th>
                    <th>Status</th>
                    {canEditLines ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={canEditLines ? 7 : 6} className="py-8 text-center text-slate-500">
                        {session.status === "OPEN"
                          ? "Inicie a contagem para carregar os itens do almoxarifado."
                          : "Nenhum item na conferência."}
                      </td>
                    </tr>
                  ) : (
                    lines.map((line) => {
                      const draft = drafts[line.id];
                      const diff = line.differenceQuantity;
                      const divergent = countLineHasDivergence(line);
                      return (
                        <tr key={line.id}>
                          <td>
                            <div className="font-medium text-slate-900">{line.itemCode ?? line.itemId}</div>
                            <div className="text-xs text-slate-500">{line.itemDescription}</div>
                          </td>
                          <td className="text-right tabular-nums">
                            {formatInventoryQuantity(line.systemQuantity, line.itemUnit)}
                          </td>
                          <td className="text-right">
                            {canEditLines && draft ? (
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={draft.countedQuantity}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [line.id]: { ...prev[line.id], countedQuantity: e.target.value },
                                  }))
                                }
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                              />
                            ) : (
                              <span className="tabular-nums">
                                {formatInventoryQuantity(line.countedQuantity, line.itemUnit)}
                              </span>
                            )}
                          </td>
                          <td
                            className={cn(
                              "text-right tabular-nums",
                              divergent && diff != null && diff > 0 && "text-emerald-700",
                              divergent && diff != null && diff < 0 && "text-red-700"
                            )}
                          >
                            {formatInventoryQuantity(line.differenceQuantity, line.itemUnit)}
                            {line.differencePercent != null ? (
                              <span className="ml-1 text-xs text-slate-500">
                                ({line.differencePercent.toLocaleString("pt-BR")}%)
                              </span>
                            ) : null}
                          </td>
                          <td>
                            {canEditLines && draft ? (
                              <input
                                type="text"
                                value={draft.justification}
                                placeholder={divergent ? "Obrigatória se divergir" : "Opcional"}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [line.id]: { ...prev[line.id], justification: e.target.value },
                                  }))
                                }
                                className="w-full min-w-[140px] rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            ) : (
                              <span className="text-sm text-slate-700">{line.justification ?? "—"}</span>
                            )}
                          </td>
                          <td className="text-xs">
                            {line.generatedMovementId ? (
                              <span className="text-emerald-700">Ajuste gerado</span>
                            ) : divergent ? (
                              <span className="text-amber-700">Divergente</span>
                            ) : line.countedQuantity != null ? (
                              <span className="text-slate-500">OK</span>
                            ) : (
                              <span className="text-slate-400">Pendente</span>
                            )}
                          </td>
                          {canEditLines ? (
                            <td>
                              <button
                                type="button"
                                disabled={actionLoading === `line-${line.id}`}
                                onClick={() => void saveLine(line)}
                                className="rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                              >
                                Salvar
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
