/**
 * Painel/drawer simples de histórico de conferência — somente leitura.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  appendHistoryPages,
  fetchMaterialStockHistory,
  formatHistoryReasonLabel,
} from "@/src/lib/materialStockHistoryClient";
import {
  formatStockConferenceDateTime,
  formatStockConferenceQuantity,
} from "@/src/lib/materialStockConferenceUi";
import type { MaterialStockHistoryListItem } from "@/src/lib/materialStockTabletTypes";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes";

export type MaterialStockHistoryPanelProps = {
  item: MaterialStockTabletListItem;
  open: boolean;
  onClose: () => void;
};

export function MaterialStockHistoryPanel({
  item,
  open,
  onClose,
}: MaterialStockHistoryPanelProps) {
  const [rows, setRows] = useState<MaterialStockHistoryListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(open);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number, mode: "replace" | "append") => {
      if (mode === "replace") {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const data = await fetchMaterialStockHistory({
          materialId: item.id,
          page: nextPage,
          pageSize: 20,
        });
        setPage(data.page);
        setTotalPages(data.totalPages);
        setRows((prev) =>
          mode === "append" ? appendHistoryPages(prev, data.rows) : data.rows
        );
      } catch (e: unknown) {
        setError(
          e instanceof Error ? e.message : "Não foi possível carregar o histórico."
        );
        if (mode === "replace") setRows([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [item.id]
  );

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setPage(1);
    void load(1, "replace");
  }, [open, item.id, load]);

  if (!open) return null;

  const hasMore = page < totalPages;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-stretch sm:justify-end"
      role="presentation"
      data-testid="stock-history-backdrop"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-history-title"
        data-testid="stock-history-panel"
        className="flex max-h-[85vh] w-full flex-col rounded-t-xl border border-border bg-card shadow-sm sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:border-l"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 id="stock-history-title" className="text-lg font-semibold">
              Histórico de conferência
            </h3>
            <p className="text-sm text-muted-foreground">
              {item.code} — {item.unit}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border"
            data-testid="stock-history-close"
            aria-label="Fechar histórico"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div
              className="flex flex-col items-center justify-center py-12"
              data-testid="stock-history-loading"
            >
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="mt-2 text-sm text-muted-foreground">Carregando histórico…</p>
            </div>
          ) : null}

          {error ? (
            <div className="space-y-2" data-testid="stock-history-error">
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                {error}
              </div>
              <button
                type="button"
                className="text-sm font-semibold text-primary"
                onClick={() => void load(1, "replace")}
              >
                Tentar novamente
              </button>
            </div>
          ) : null}

          {!loading && !error && rows.length === 0 ? (
            <p
              className="py-10 text-center text-sm text-muted-foreground"
              data-testid="stock-history-empty"
            >
              Nenhuma conferência registrada.
            </p>
          ) : null}

          <ul className="space-y-3" data-testid="stock-history-list">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-border px-3 py-3 text-sm"
                data-testid={`stock-history-row-${row.id}`}
              >
                <p className="font-semibold text-foreground">
                  {formatStockConferenceDateTime(row.recordedAt)}
                </p>
                <p className="text-muted-foreground">
                  {row.userName?.trim() || "Usuário"}
                </p>
                <dl className="mt-2 space-y-1">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Anterior</dt>
                    <dd className="tabular-nums font-medium">
                      {formatStockConferenceQuantity(row.previousQuantity)} {row.unit}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Novo</dt>
                    <dd className="tabular-nums font-medium">
                      {formatStockConferenceQuantity(row.reportedQuantity)} {row.unit}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Diferença</dt>
                    <dd className="tabular-nums font-medium">
                      {formatStockConferenceQuantity(row.difference)} {row.unit}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Motivo</dt>
                    <dd className="text-right font-medium">
                      {formatHistoryReasonLabel(row.reason)}
                    </dd>
                  </div>
                  {row.notes ? (
                    <div className="pt-1">
                      <dt className="text-muted-foreground">Observação</dt>
                      <dd className="mt-0.5 text-foreground">{row.notes}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>

          {hasMore ? (
            <button
              type="button"
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-60"
              disabled={loadingMore}
              onClick={() => void load(page + 1, "append")}
              data-testid="stock-history-load-more"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando…
                </>
              ) : (
                "Carregar mais"
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
