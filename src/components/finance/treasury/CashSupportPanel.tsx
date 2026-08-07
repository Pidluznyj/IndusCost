/**
 * Apoio ao Caixa — painel de apresentação (CS-007). Puramente apresentacional:
 * recebe o `CashSupportReadModel` já resolvido e desenha. Não soma dinheiro,
 * não recalcula residual, não decide capacidade — tudo vem pronto do backend.
 */

import React, { useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { formatTreasuryBankMoney } from "@/src/lib/treasury/treasuryBankMovementsUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import type {
  CashSupportReadModel,
  CashSupportResourceType,
  CashSupportUnifiedRow,
} from "@/src/lib/treasury/contracts/cashSupportContracts.js";

function money(value: string | null): string {
  if (value == null) return "—";
  return formatTreasuryBankMoney(value);
}

export const CASH_SUPPORT_RESOURCE_TYPE_LABELS: Record<CashSupportResourceType, string> = {
  FORECAST: "Previsão",
  OFFICIAL_RECEIVABLE: "A receber (oficial)",
  OFFICIAL_PAYABLE: "A pagar (oficial)",
  BANK_MOVEMENT: "Movimento bancário",
  INTERNAL_TRANSFER: "Transferência interna",
  ADJUSTMENT: "Ajuste",
  UNIDENTIFIED: "Não identificado",
};

function ResourceTypeBadge({ type }: { type: CashSupportResourceType }) {
  if (type === "FORECAST") {
    return (
      <span
        className="rounded border border-dashed border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#92400E]"
        title="Contexto de previsão — nunca conciliável"
      >
        Previsão
      </span>
    );
  }
  if (type === "BANK_MOVEMENT") {
    return (
      <span className="rounded bg-[#1E3A8A] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        Banco
      </span>
    );
  }
  if (type === "OFFICIAL_RECEIVABLE" || type === "OFFICIAL_PAYABLE") {
    return (
      <span className="rounded border border-[#A7F3D0] bg-[#ECFDF5] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#065F46]">
        Oficial
      </span>
    );
  }
  return (
    <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#475569]">
      {CASH_SUPPORT_RESOURCE_TYPE_LABELS[type]}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: "in" | "out" | "neutral";
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid={testId}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "in" && "text-[#059669]",
          tone === "out" && "text-[#DC2626]"
        )}
      >
        {money(value)}
      </p>
    </div>
  );
}

export type CashSupportPanelProps = {
  civilDateFrom: string;
  civilDateTo: string;
  loading?: boolean;
  error?: string | null;
  data: CashSupportReadModel | null;
  /** Abre o diálogo de conciliação manual com os movimentos marcados. */
  onReconcileSelected?: (movements: CashSupportUnifiedRow[]) => void;
  /** Pede desfazer (soft-unmatch) do match ativo referenciado pela linha. */
  onUnmatchRequested?: (row: CashSupportUnifiedRow, matchId: string) => void;
  /** Pede reversão do match ativo referenciado pela linha. */
  onReverseRequested?: (row: CashSupportUnifiedRow, matchId: string) => void;
};

function activeMatchId(row: CashSupportUnifiedRow): string | null {
  return (
    row.sourceReferences.find((r) => r.source === "TreasuryReconciliationMatch")?.id ??
    null
  );
}

export function CashSupportPanel({
  civilDateFrom,
  civilDateTo,
  loading = false,
  error = null,
  data,
  onReconcileSelected,
  onUnmatchRequested,
  onReverseRequested,
}: CashSupportPanelProps) {
  const [selected, setSelected] = useState<CashSupportUnifiedRow | null>(null);
  const [resourceTypeFilter, setResourceTypeFilter] =
    useState<CashSupportResourceType | "">("");
  const [checkedMovementIds, setCheckedMovementIds] = useState<ReadonlySet<string>>(
    new Set()
  );

  const visibleRows = useMemo(() => {
    if (!data) return [];
    if (!resourceTypeFilter) return data.rows;
    return data.rows.filter((r) => r.resourceType === resourceTypeFilter);
  }, [data, resourceTypeFilter]);

  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm"
      data-testid="cash-support-workspace"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Apoio ao Caixa</h1>
          <p className="text-xs text-muted-foreground" data-testid="cash-support-period">
            {civilDateFrom} – {civilDateTo}
            {data
              ? ` · atualizado ${new Date(data.analysisAsOfDateTime).toLocaleString("pt-BR")}`
              : ""}
          </p>
        </div>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Tipo</span>
          <select
            className={financeModuleFilterFieldClass()}
            value={resourceTypeFilter}
            onChange={(e) =>
              setResourceTypeFilter(e.target.value as CashSupportResourceType | "")
            }
            data-testid="cash-support-resource-type-filter"
          >
            <option value="">Todos</option>
            {Object.entries(CASH_SUPPORT_RESOURCE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </header>

      <p className="text-[11px] text-muted-foreground">
        Transferência entre contas próprias — sem receita/despesa, consolidado zero — é feita na
        tela oficial:{" "}
        <a href="/finance/treasury/transfers" className="text-primary underline">
          Transferências
        </a>
        .
      </p>

      {data?.warnings.length ? (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          data-testid="cash-support-warnings"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <ul className="space-y-0.5">
            {data.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading ? (
        <p
          className="py-6 text-center text-xs text-muted-foreground"
          data-testid="cash-support-loading"
        >
          Carregando…
        </p>
      ) : error ? (
        <p
          className="py-6 text-center text-xs text-red-600"
          data-testid="cash-support-error"
          role="alert"
        >
          {error}
        </p>
      ) : !data || data.rows.length === 0 ? (
        <p
          className="py-6 text-center text-xs text-muted-foreground"
          data-testid="cash-support-empty"
        >
          Nenhum registro no período selecionado.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              testId="cash-support-summary-inflows"
              label="Entradas bancárias"
              value={data.summary.bankPosition.inflows}
              tone="in"
            />
            <SummaryCard
              testId="cash-support-summary-outflows"
              label="Saídas bancárias"
              value={data.summary.bankPosition.outflows}
              tone="out"
            />
            <SummaryCard
              testId="cash-support-summary-unreconciled"
              label="Não conciliado"
              value={data.summary.bankPosition.unreconciled}
            />
            <SummaryCard
              testId="cash-support-summary-expected"
              label="Títulos esperados"
              value={data.summary.canonicalPosition.expectedTitles}
            />
          </div>

          {onReconcileSelected && checkedMovementIds.size > 0 ? (
            <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 text-xs">
              <span>{checkedMovementIds.size} movimento(s) selecionado(s)</span>
              <button
                type="button"
                className="rounded bg-primary px-2.5 py-1 font-semibold text-primary-foreground"
                data-testid="cash-support-reconcile-selected"
                onClick={() =>
                  onReconcileSelected(
                    data.rows.filter((r) => checkedMovementIds.has(r.displayId))
                  )
                }
              >
                Conciliar selecionados
              </button>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="cash-support-grid">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  {onReconcileSelected ? <th className="px-2 py-1.5" /> : null}
                  <th className="px-2 py-1.5">Data</th>
                  <th className="px-2 py-1.5">Tipo</th>
                  <th className="px-2 py-1.5">Descrição</th>
                  <th className="px-2 py-1.5 text-right">Valor</th>
                  <th className="px-2 py-1.5 text-right">Residual</th>
                  <th className="px-2 py-1.5">Estado</th>
                  <th className="px-2 py-1.5">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const reconcileAction = row.availableActions.find(
                    (a) => a.kind === "RECONCILE"
                  );
                  const Icon = row.direction === "IN" ? ArrowDownCircle : ArrowUpCircle;
                  const checkable = onReconcileSelected && row.resourceType === "BANK_MOVEMENT";
                  return (
                    <tr
                      key={row.displayId}
                      className="cursor-pointer border-b border-border/40 hover:bg-muted/40"
                      onClick={() => setSelected(row)}
                      data-testid={`cash-support-row-${row.displayId}`}
                    >
                      {onReconcileSelected ? (
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          {checkable ? (
                            <input
                              type="checkbox"
                              checked={checkedMovementIds.has(row.displayId)}
                              onChange={() =>
                                setCheckedMovementIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row.displayId)) next.delete(row.displayId);
                                  else next.add(row.displayId);
                                  return next;
                                })
                              }
                              data-testid={`cash-support-checkbox-${row.displayId}`}
                            />
                          ) : null}
                        </td>
                      ) : null}
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                        {row.bankDate ?? row.dueDate ?? row.expectedDate ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <ResourceTypeBadge type={row.resourceType} />
                      </td>
                      <td className="max-w-[220px] truncate px-2 py-1.5">
                        <span className="inline-flex items-center gap-1">
                          <Icon
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              row.direction === "IN" ? "text-emerald-600" : "text-red-500"
                            )}
                            aria-hidden
                          />
                          {row.description ?? "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                        {money(row.bankAmount ?? row.officialAmount ?? row.expectedAmount)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                        {money(row.residualAmount)}
                      </td>
                      <td className="px-2 py-1.5">{row.reconciliationState}</td>
                      <td className="px-2 py-1.5">
                        {row.resourceType === "FORECAST" ? (
                          <span
                            className="text-[10px] text-muted-foreground"
                            data-testid={`cash-support-forecast-no-action-${row.displayId}`}
                            title="Previsão nunca é conciliável"
                          >
                            Contexto de previsão
                          </span>
                        ) : reconcileAction?.enabled ? (
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-primary underline"
                            data-testid={`cash-support-reconcile-${row.displayId}`}
                          >
                            Conciliar
                          </button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            {reconcileAction?.disabledReason ?? "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected ? (
        <aside
          className="fixed inset-y-0 right-0 w-full max-w-sm overflow-y-auto border-l border-border bg-background p-4 shadow-xl"
          data-testid="cash-support-detail-drawer"
        >
          <button
            type="button"
            className="text-xs text-muted-foreground"
            onClick={() => setSelected(null)}
            data-testid="cash-support-detail-close"
          >
            Fechar
          </button>
          <h2 className="mt-2 text-sm font-semibold">{selected.description ?? selected.displayId}</h2>
          <dl className="mt-3 space-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Tipo</dt>
              <dd>{CASH_SUPPORT_RESOURCE_TYPE_LABELS[selected.resourceType]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Data bancária (realizado)</dt>
              <dd>{selected.bankDate ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Vencimento</dt>
              <dd>{selected.dueDate ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Residual</dt>
              <dd>{money(selected.residualAmount)}</dd>
            </div>
            {selected.warnings.length > 0 ? (
              <div>
                <dt className="text-muted-foreground">Avisos</dt>
                <dd className="space-y-1">
                  {selected.warnings.map((w, i) => (
                    <p key={i} className="text-amber-700">
                      {w.message}
                    </p>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>

          {selected.resourceType === "BANK_MOVEMENT" && activeMatchId(selected) ? (
            <div className="mt-3 flex gap-2">
              {onUnmatchRequested ? (
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-[11px] font-semibold"
                  data-testid="cash-support-detail-unmatch"
                  onClick={() => onUnmatchRequested(selected, activeMatchId(selected)!)}
                >
                  Desfazer
                </button>
              ) : null}
              {onReverseRequested ? (
                <button
                  type="button"
                  className="rounded border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-700"
                  data-testid="cash-support-detail-reverse"
                  onClick={() => onReverseRequested(selected, activeMatchId(selected)!)}
                >
                  Reverter
                </button>
              ) : null}
            </div>
          ) : null}

          <p className="mt-4 rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
            A conciliação bancária do Apoio ao Caixa não altera baixa, vencimento ou saldo
            oficial no Nomus.
          </p>
        </aside>
      ) : null}
    </section>
  );
}
