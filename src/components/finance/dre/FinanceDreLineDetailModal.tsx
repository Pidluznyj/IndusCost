import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceDreLineId } from "@/src/lib/financeDreTypes";
import type { FinanceDreDrilldownPayload } from "@/src/lib/financeDreDrilldownTypes";
import {
  buildFinanceDreQuery,
  getFinanceDreLineDrilldownPath,
  getFinanceDreSourceCheckDrilldownPath,
  type FinanceDreUiFilters,
} from "@/src/lib/financeDreViewModel";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { CostCenterDialog } from "@/src/components/finance/cost-centers/financeUnclassifiedModalUi";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { cn } from "@/src/lib/utils";

type Props = {
  open: boolean;
  /** Detalhe de linha do DRE (mutuamente exclusivo com sourceCheckId). */
  lineId?: FinanceDreLineId | null;
  /** Detalhe de validação de fonte oficial. */
  sourceCheckId?: string | null;
  filters: FinanceDreUiFilters;
  scope?: "highlight" | "ytd";
  onClose: () => void;
};

function cellValue(
  row: FinanceDreDrilldownPayload["rows"][number],
  key: string
): string {
  switch (key) {
    case "orderCode":
      return row.orderCode?.trim() || "—";
    case "customerName":
      return row.customerName?.trim() || "—";
    case "nfeNumber": {
      if (!row.nfeNumber) return "—";
      return row.nfeSerie ? `${row.nfeNumber}/${row.nfeSerie}` : row.nfeNumber;
    }
    case "documentLabel":
      return row.documentLabel?.trim() || "—";
    case "competenceDate":
      return row.competenceDate
        ? new Date(`${row.competenceDate}T12:00:00`).toLocaleDateString("pt-BR")
        : "—";
    case "extra":
      return row.extra?.trim() || "—";
    case "amount":
      return formatFinanceKpiCurrency(row.amount);
    default:
      return "—";
  }
}

export function FinanceDreLineDetailModal({
  open,
  lineId = null,
  sourceCheckId = null,
  filters,
  scope,
  onClose,
}: Props) {
  const defaultScope: "highlight" | "ytd" = sourceCheckId ? "ytd" : "highlight";
  const [payload, setPayload] = useState<FinanceDreDrilldownPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLineId, setActiveLineId] = useState<FinanceDreLineId | null>(lineId);
  const [activeSourceCheckId, setActiveSourceCheckId] = useState<string | null>(sourceCheckId);
  const [activeScope, setActiveScope] = useState<"highlight" | "ytd">(scope ?? defaultScope);

  useEffect(() => {
    if (!open) return;
    setActiveLineId(lineId);
    setActiveSourceCheckId(sourceCheckId);
    setActiveScope(scope ?? (sourceCheckId ? "ytd" : "highlight"));
    setPayload(null);
  }, [open, lineId, sourceCheckId, scope]);

  const load = useCallback(async () => {
    if (!open) return;
    if (!activeSourceCheckId && !activeLineId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = buildFinanceDreQuery(filters);
      const url = activeSourceCheckId
        ? getFinanceDreSourceCheckDrilldownPath(activeSourceCheckId, qs, activeScope)
        : getFinanceDreLineDrilldownPath(activeLineId!, qs, activeScope);
      const data = await fetchJsonOk<FinanceDreDrilldownPayload>(url);
      setPayload(data);
    } catch (err) {
      setPayload(null);
      setError(
        buildFinanceTabLoadError(
          activeSourceCheckId
            ? "Falha ao carregar detalhe da validação de fonte."
            : "Falha ao carregar detalhe da linha do DRE.",
          err
        )
      );
    } finally {
      setLoading(false);
    }
  }, [open, activeLineId, activeSourceCheckId, activeScope, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const title =
    payload?.lineLabel ??
    (activeSourceCheckId ? "Validação de fonte" : "Detalhe da linha");
  const subtitle = payload
    ? `${payload.periodLabel} · ${payload.companyLabel}`
    : activeSourceCheckId
      ? "Registros que explicam o status da validação de fontes oficiais"
      : "Origem dos valores que compõem a linha do DRE";

  return createPortal(
    <CostCenterDialog
      testId={
        activeSourceCheckId
          ? "finance-dre-source-check-detail-modal"
          : "finance-dre-line-detail-modal"
      }
      title={title}
      subtitle={subtitle}
      maxWidthClass="max-w-5xl"
      stacked
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="space-y-0.5">
            {payload ? (
              <>
                <div className="font-medium text-foreground">
                  Total do detalhe:{" "}
                  <span className="tabular-nums">
                    {formatFinanceKpiCurrency(payload.rowsTotal)}
                  </span>
                  {activeSourceCheckId ? null : (
                    <>
                      {" · "}
                      Linha DRE:{" "}
                      <span className="tabular-nums">
                        {formatFinanceKpiCurrency(payload.expectedTotal)}
                      </span>
                    </>
                  )}
                </div>
                <div
                  className={cn(
                    "text-xs",
                    payload.totalsMatch ? "text-emerald-700" : "text-amber-800"
                  )}
                >
                  {activeSourceCheckId
                    ? payload.rowCount === 0
                      ? "Nenhum registro problemático no período"
                      : "Lista dos registros que explicam esta validação"
                    : payload.totalsMatch
                      ? "Totais reconciliados com a linha do DRE"
                      : "Atenção: total do detalhe diverge da linha do DRE"}
                  {payload.truncated
                    ? ` · exibindo ${payload.rows.length} de ${payload.rowCount} linhas`
                    : ` · ${payload.rowCount} linha(s)`}
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                activeScope === "highlight"
                  ? "border-sky-700 bg-sky-50 text-sky-900"
                  : "border-border hover:bg-accent"
              )}
              onClick={() => setActiveScope("highlight")}
            >
              Mês destaque
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                activeScope === "ytd"
                  ? "border-sky-700 bg-sky-50 text-sky-900"
                  : "border-border hover:bg-accent"
              )}
              onClick={() => setActiveScope("ytd")}
            >
              YTD
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <FinanceModuleLoadingBlock
          label={
            activeSourceCheckId
              ? "Carregando registros da validação…"
              : "Carregando origem dos valores…"
          }
        />
      ) : null}
      {error ? <FinanceModuleErrorBanner message={error} /> : null}

      {!loading && payload ? (
        <div className="space-y-3" data-testid="finance-dre-line-detail-body">
          <p className="text-xs text-muted-foreground leading-relaxed">{payload.sourceNote}</p>
          {payload.kind === "composition" ? (
            <p className="text-xs text-slate-600">
              Clique em um componente para abrir o detalhe de origem.
            </p>
          ) : null}

          {payload.rows.length === 0 ? (
            <FinanceModuleEmptyState
              title="Sem lançamentos no período"
              description="Não há itens de origem para esta linha nos filtros atuais."
            />
          ) : (
            <div className="overflow-auto rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    {payload.columns.map((col) => (
                      <th
                        key={col.key}
                        className={cn(
                          "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide",
                          col.align === "right" ? "text-right" : "text-left"
                        )}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payload.rows.map((row) => {
                    const clickable = Boolean(row.childLineId);
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          "border-b border-border/70",
                          clickable && "cursor-pointer hover:bg-sky-50/80"
                        )}
                        onClick={() => {
                          if (!row.childLineId) return;
                          setActiveSourceCheckId(null);
                          setActiveLineId(row.childLineId);
                        }}
                        data-testid={
                          row.childLineId
                            ? `finance-dre-drill-child-${row.childLineId}`
                            : undefined
                        }
                      >
                        {payload.columns.map((col) => (
                          <td
                            key={col.key}
                            className={cn(
                              "px-3 py-2",
                              col.align === "right" && "text-right tabular-nums",
                              col.key === "documentLabel" && clickable && "font-medium text-sky-900"
                            )}
                          >
                            {cellValue(row, col.key)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{payload.disclaimer}</p>
        </div>
      ) : null}
    </CostCenterDialog>,
    document.body
  );
}
