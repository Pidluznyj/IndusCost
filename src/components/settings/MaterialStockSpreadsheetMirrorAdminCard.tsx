/**
 * Painel admin do espelho planilha — somente Configurações / Integrações.
 * Não aparece na tela operacional de conferência.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

type StatusPayload = {
  enabled: boolean;
  configured: boolean;
  counts: { pending: number; processing: number; error: number };
  lastSyncedAt: string | null;
  lastSyncedMaterialCode: string | null;
};

type OutboxRow = {
  id: string;
  materialCode: string;
  eventType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastErrorMessage: string | null;
  syncedAt: string | null;
};

export type MaterialStockSpreadsheetMirrorAdminCardProps = {
  canView: boolean;
  canManage: boolean;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function MaterialStockSpreadsheetMirrorAdminCard({
  canView,
  canManage,
}: MaterialStockSpreadsheetMirrorAdminCardProps) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [st, list] = await Promise.all([
        fetchJson<StatusPayload>(
          "/api/admin/material-stock-spreadsheet-mirror/status"
        ),
        fetchJson<{ rows: OutboxRow[] }>(
          "/api/admin/material-stock-spreadsheet-mirror/outbox?status=ACTIVE&pageSize=30"
        ),
      ]);
      const errors = await fetchJson<{ rows: OutboxRow[] }>(
        "/api/admin/material-stock-spreadsheet-mirror/outbox?status=ERROR&pageSize=20"
      );
      setStatus(st);
      setRows([...list.rows, ...errors.rows]);
    } catch {
      setError("Não foi possível carregar a fila do espelho.");
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) return null;

  return (
    <div
      className="rounded-2xl border border-border bg-card p-6 space-y-4"
      data-testid="material-stock-spreadsheet-mirror-admin"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Espelho planilha — matéria-prima</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Sincronização unidirecional IndusCost → planilha (Power Automate). O estoque
            oficial não depende do Excel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent"
            data-testid="mirror-admin-refresh"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          {canManage ? (
            <button
              type="button"
              disabled={busyId === "drain"}
              onClick={async () => {
                setBusyId("drain");
                try {
                  await fetchJson(
                    "/api/admin/material-stock-spreadsheet-mirror/drain",
                    { method: "POST" }
                  );
                  await load();
                } catch {
                  setError("Falha ao drenar a fila.");
                } finally {
                  setBusyId(null);
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-accent disabled:opacity-60"
              data-testid="mirror-admin-drain"
            >
              Processar agora
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      {status ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">Espelho</p>
            <p className="font-semibold">
              {status.enabled ? "Habilitado" : "Desligado"}
              {status.configured ? "" : " · sem config"}
            </p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">Pendentes</p>
            <p className="font-semibold tabular-nums">{status.counts.pending}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">Erros</p>
            <p className="font-semibold tabular-nums">{status.counts.error}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">Última sync</p>
            <p className="font-semibold text-xs break-words">
              {status.lastSyncedAt
                ? `${status.lastSyncedMaterialCode ?? "—"} · ${new Date(
                    status.lastSyncedAt
                  ).toLocaleString("pt-BR")}`
                : "—"}
            </p>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="mirror-admin-table">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2">Código</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2">Tentativas</th>
              <th className="py-2 pr-2">Erro</th>
              <th className="py-2 pr-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  Nenhuma pendência ou erro.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-2 pr-2 font-medium">{row.materialCode}</td>
                  <td className="py-2 pr-2">{row.status}</td>
                  <td className="py-2 pr-2 tabular-nums">
                    {row.attempts}/{row.maxAttempts}
                  </td>
                  <td className="py-2 pr-2 text-xs text-muted-foreground max-w-[14rem] truncate">
                    {row.lastErrorMessage ?? "—"}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {canManage && (row.status === "ERROR" || row.status === "SYNCED") ? (
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        className="text-xs font-semibold text-primary disabled:opacity-60"
                        data-testid={`mirror-admin-retry-${row.id}`}
                        onClick={async () => {
                          setBusyId(row.id);
                          try {
                            await fetchJson(
                              `/api/admin/material-stock-spreadsheet-mirror/outbox/${encodeURIComponent(row.id)}/retry`,
                              { method: "POST" }
                            );
                            await load();
                          } catch {
                            setError("Falha ao reenviar.");
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        Reenviar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
