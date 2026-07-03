import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, X } from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { ExecutiveAlert } from "@/src/components/ui/ExecutiveAlert";
import { fetchJsonOk } from "@/src/lib/http";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";
import type { CommissionsVisualAuditPayload } from "@/src/components/commissions/commissionsTypes";
import {
  VISUAL_AUDIT_APPRAISAL_MODES,
  VISUAL_AUDIT_MODE_DESCRIPTIONS,
  VISUAL_AUDIT_MODE_LABELS,
  type VisualAuditAppraisalMode,
} from "@/src/lib/commissions/commissionVisualAudit.shared";
import {
  buildVisualAuditQueryString,
  EMPTY_VISUAL_AUDIT_FILTERS,
  type VisualAuditFilters,
} from "@/src/components/commissions/visualAudit/commissionsVisualAuditFilters";

const inputClass = COMMISSIONS_FILTER_FIELD_CLASS;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function statusBadgeClass(kind: "title" | "commission", value: string): string {
  if (kind === "title") {
    if (value === "BAIXADO") return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
    if (value === "VENCIDO") return "bg-red-50 text-red-800 ring-1 ring-red-200";
    if (value === "SEM_VINCULO") return "bg-gray-100 text-gray-700 ring-1 ring-gray-200";
    return "bg-amber-50 text-amber-900 ring-1 ring-amber-200";
  }
  if (value === "DIVERGENTE") return "bg-red-50 text-red-800 ring-1 ring-red-200";
  if (value === "LIBERADA") return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
  if (value === "BLOQUEADA_INADIMPLENCIA") return "bg-orange-50 text-orange-900 ring-1 ring-orange-200";
  return "bg-blue-50 text-blue-800 ring-1 ring-blue-200";
}

function VisualAuditDetailDrawer({
  lineId,
  onClose,
}: {
  lineId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<{
    explanation: string;
    record: { productCode: string | null; baseAmount: number; ratePercent: number; commissionAmount: number } | null;
    documentTotals: { base: number; commission: number };
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lineId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    void fetchJsonOk<typeof detail>(
      `/api/commissions/visual-audit/detail?lineId=${encodeURIComponent(lineId)}`
    )
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [lineId]);

  if (!lineId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h4 className="text-lg font-bold">Detalhe auditável</h4>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {loading ? <CommissionsLoading label="Carregando detalhe…" /> : null}
        {detail ? (
          <div className="space-y-4 text-sm">
            <p className="rounded-lg bg-muted/40 p-3">{detail.explanation}</p>
            <div>
              <p className="font-semibold">Documento (NF/pedido)</p>
              <p>Base comissionável: {formatFinanceCurrency(detail.documentTotals.base)}</p>
              <p>Comissão total: {formatFinanceCurrency(detail.documentTotals.commission)}</p>
            </div>
            {detail.record ? (
              <div>
                <p className="font-semibold">Item</p>
                <p>Produto: {detail.record.productCode ?? "—"}</p>
                <p>Base: {formatFinanceCurrency(detail.record.baseAmount)}</p>
                <p>Percentual: {detail.record.ratePercent.toFixed(4)}%</p>
                <p>Comissão: {formatFinanceCurrency(detail.record.commissionAmount)}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VisualAuditModeTabs({
  mode,
  onChange,
}: {
  mode: VisualAuditAppraisalMode;
  onChange: (mode: VisualAuditAppraisalMode) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="commissions-visual-audit-mode-tabs">
      {VISUAL_AUDIT_APPRAISAL_MODES.map((item) => (
        <button
          key={item}
          type="button"
          data-testid={`commissions-visual-audit-mode-${item.toLowerCase()}`}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            mode === item
              ? "bg-primary text-primary-foreground shadow-sm"
              : "border border-border bg-background text-foreground hover:bg-muted/50"
          }`}
          onClick={() => onChange(item)}
        >
          {VISUAL_AUDIT_MODE_LABELS[item]}
        </button>
      ))}
    </div>
  );
}

function VisualAuditCards({
  mode,
  cards,
}: {
  mode: VisualAuditAppraisalMode;
  cards: CommissionsVisualAuditPayload["cards"];
}) {
  const money = formatFinanceCurrency;
  if (mode === "GENERATED") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FinanceKpiCard label="Valor NFs/documentos" value={money(cards.documentAmountTotal)} />
        <FinanceKpiCard label="Valor títulos únicos" value={money(cards.receivableAmountTotal)} />
        <FinanceKpiCard label="Base comissionável gerada" value={money(cards.commissionableBaseTotal)} />
        <FinanceKpiCard label="Comissão prevista gerada" value={money(cards.commissionCalculatedTotal)} />
        <FinanceKpiCard label="% médio" value={`${cards.averageRatePercent.toFixed(2)}%`} />
        <FinanceKpiCard label="Documentos/NFs" value={String(cards.documentCount)} />
        <FinanceKpiCard label="Títulos únicos" value={String(cards.receivableCount)} />
        <FinanceKpiCard label="Parcelas" value={String(cards.scheduleCount)} />
      </div>
    );
  }

  if (mode === "FORECAST") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FinanceKpiCard label="Títulos em aberto/futuros" value={String(cards.receivableCount)} />
        <FinanceKpiCard label="Valor títulos únicos" value={money(cards.receivableAmountTotal)} />
        <FinanceKpiCard label="Base pendente" value={money(cards.commissionableBaseTotal)} />
        <FinanceKpiCard label="Comissão a liberar" value={money(cards.commissionPendingTotal)} />
        <FinanceKpiCard label="Comissão futura" value={money(cards.commissionFutureTotal)} />
        <FinanceKpiCard label="Vencido / bloqueada" value={money(cards.commissionBlockedTotal)} />
        <FinanceKpiCard label="Parcelas" value={String(cards.scheduleCount)} />
        <FinanceKpiCard label="Divergências" value={String(cards.divergenceCount)} />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <FinanceKpiCard label="Títulos baixados no mês" value={String(cards.receivableCount)} />
      <FinanceKpiCard label="Valor recebido/baixado" value={money(cards.receivedAmountTotal)} />
      <FinanceKpiCard label="Base comissionável baixada" value={money(cards.commissionableBaseTotal)} />
      <FinanceKpiCard label="Comissão liberada / a pagar" value={money(cards.commissionReleasedTotal)} />
      <FinanceKpiCard label="% médio" value={`${cards.averageRatePercent.toFixed(2)}%`} />
      <FinanceKpiCard label="Valor títulos únicos" value={money(cards.receivableAmountTotal)} />
      <FinanceKpiCard label="Comissão pendente" value={money(cards.commissionPendingTotal)} />
      <FinanceKpiCard label="Divergências" value={String(cards.divergenceCount)} />
    </div>
  );
}

export function CommissionsVisualAuditPage() {
  const [draftFilters, setDraftFilters] = useState<VisualAuditFilters>(EMPTY_VISUAL_AUDIT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<VisualAuditFilters>(EMPTY_VISUAL_AUDIT_FILTERS);
  const [data, setData] = useState<CommissionsVisualAuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);

  const mode = appliedFilters.appraisalMode;

  useEffect(() => {
    void fetchJsonOk<{ items: Array<{ id: string; name: string }> }>(
      "/api/commissions/persons?page=1&pageSize=200&active=true"
    )
      .then((p) => setPersons(p.items ?? []))
      .catch(() => setPersons([]));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildVisualAuditQueryString(appliedFilters);
      const payload = await fetchJsonOk<CommissionsVisualAuditPayload>(
        `/api/commissions/visual-audit?${qs}`
      );
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar a auditoria visual."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function exportCsv() {
    setExporting(true);
    try {
      const qs = buildVisualAuditQueryString(appliedFilters);
      const res = await fetch(`/api/commissions/visual-audit/export?${qs}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `auditoria-comissao-${appliedFilters.appraisalMode.toLowerCase()}-${appliedFilters.year || "periodo"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  function switchMode(nextMode: VisualAuditAppraisalMode) {
    setDraftFilters((f) => ({ ...f, appraisalMode: nextMode, page: 1 }));
    setAppliedFilters((f) => ({ ...f, appraisalMode: nextMode, page: 1 }));
  }

  const cards = data?.cards;
  const rows = data?.rows ?? [];
  const pagination = data?.pagination;
  const nomus = data?.nomusReference;
  const modeDescription = useMemo(() => VISUAL_AUDIT_MODE_DESCRIPTIONS[mode], [mode]);

  return (
    <div className="space-y-5" data-testid="commissions-visual-audit-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Comissões
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Auditoria Visual por Contas a Receber
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Valide comissão gerada, prevista e a pagar por título, NF, pedido e recebimento.
            Resumo calculado no backend — sem cálculo no frontend.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={financeBiButtonOutlineClass} onClick={() => void reload()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Atualizar
          </button>
          <button type="button" className={financeBiButtonOutlineClass} onClick={() => void exportCsv()} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </button>
        </div>
      </div>

      <VisualAuditModeTabs mode={mode} onChange={switchMode} />
      <p className="text-sm text-muted-foreground">{modeDescription}</p>

      <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-[#6B7280]">
          Referência Nomus manual (opcional)
        </p>
        {!nomus?.comparable && nomus != null ? (
          <ExecutiveAlert
            variant="attention"
            density="compact"
            title="Comparação Nomus"
            description="A referência Nomus normalmente é por títulos baixados no período. Para comparação mensal oficial, use a aba Fechamento do mês ou a visão A pagar no mês."
          />
        ) : null}
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">
            Base Nomus
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.nomusReferenceBase}
              onChange={(e) => setDraftFilters((f) => ({ ...f, nomusReferenceBase: e.target.value }))}
              placeholder="808107.32"
            />
          </label>
          <label className="text-sm">
            Comissão Nomus
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.nomusReferenceCommission}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, nomusReferenceCommission: e.target.value }))
              }
              placeholder="20926.56"
            />
          </label>
          <div className="text-sm md:col-span-2 self-end space-y-1">
            {nomus?.baseDiff != null ? (
              <p>
                Diferença base: {formatFinanceCurrency(nomus.baseDiff)}
                {nomus.baseDiffPercent != null ? ` (${nomus.baseDiffPercent.toFixed(2)}%)` : null}
              </p>
            ) : null}
            {nomus?.commissionDiff != null ? (
              <p>
                Diferença comissão: {formatFinanceCurrency(nomus.commissionDiff)}
                {nomus.commissionDiffPercent != null
                  ? ` (${nomus.commissionDiffPercent.toFixed(2)}%)`
                  : null}
              </p>
            ) : null}
            {nomus?.nomusAverageRatePercent != null ? (
              <p>% médio Nomus: {nomus.nomusAverageRatePercent.toFixed(2)}%</p>
            ) : null}
            {nomus?.indusAverageRatePercent != null ? (
              <p>% médio IndusCost: {nomus.indusAverageRatePercent.toFixed(2)}%</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <CommissionsPeriodFilterFields
          year={draftFilters.year}
          month={draftFilters.month}
          onYearChange={(year) => setDraftFilters((f) => ({ ...f, year }))}
          onMonthChange={(month) => setDraftFilters((f) => ({ ...f, month }))}
        />
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          <label className="text-sm">
            Vendedor
            <select
              className={`${inputClass} mt-1`}
              value={draftFilters.commissionPersonId}
              onChange={(e) => setDraftFilters((f) => ({ ...f, commissionPersonId: e.target.value }))}
            >
              <option value="">Todos</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Cliente
            <input className={`${inputClass} mt-1`} value={draftFilters.customer} onChange={(e) => setDraftFilters((f) => ({ ...f, customer: e.target.value }))} />
          </label>
          <label className="text-sm">
            Pedido
            <input className={`${inputClass} mt-1`} value={draftFilters.orderCode} onChange={(e) => setDraftFilters((f) => ({ ...f, orderCode: e.target.value }))} />
          </label>
          <label className="text-sm">
            NF-e
            <input className={`${inputClass} mt-1`} value={draftFilters.nfeNumber} onChange={(e) => setDraftFilters((f) => ({ ...f, nfeNumber: e.target.value }))} />
          </label>
          <label className="text-sm">
            Código CR Nomus
            <input className={`${inputClass} mt-1`} value={draftFilters.nomusReceivableId} onChange={(e) => setDraftFilters((f) => ({ ...f, nomusReceivableId: e.target.value }))} />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            ["onlySettled", mode === "PAYABLE" ? "Somente baixados (redundante nesta visão)" : "Somente baixados"],
            ["onlyOpen", "Somente em aberto"],
            ["onlyDivergences", "Somente divergências"],
            ["onlyZeroCommission", "Comissão zerada"],
            ["onlyMissingReceivableLink", "Sem vínculo CR"],
          ].map(([key, label]) => (
            <label key={key} className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(draftFilters[key as keyof VisualAuditFilters])}
                onChange={(e) =>
                  setDraftFilters((f) => ({ ...f, [key]: e.target.checked }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className={financeBiButtonOutlineClass} onClick={() => setAppliedFilters({ ...draftFilters, page: 1 })}>
            Aplicar filtros
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => {
              setDraftFilters(EMPTY_VISUAL_AUDIT_FILTERS);
              setAppliedFilters(EMPTY_VISUAL_AUDIT_FILTERS);
            }}
          >
            Limpar filtros
          </button>
        </div>
      </div>

      {error ? <CommissionsErrorBanner message={error} onRetry={() => void reload()} /> : null}

      {cards ? <VisualAuditCards mode={mode} cards={cards} /> : null}

      {loading && !data ? <CommissionsLoading label="Carregando auditoria…" /> : null}

      {!loading && rows.length === 0 ? (
        <CommissionsEmptyState title="Nenhuma linha no período" description="Ajuste ano, mês, visão ou vendedor." />
      ) : null}

      {rows.length > 0 ? (
        <>
          <CommissionsTableScroll>
            <table className="min-w-[1600px] text-xs">
              <thead>
                <tr className="border-b text-left uppercase text-muted-foreground">
                  <th className="px-2 py-2">Vendedor</th>
                  <th className="px-2 py-2">Cliente</th>
                  <th className="px-2 py-2">Pedido</th>
                  <th className="px-2 py-2">NF-e</th>
                  <th className="px-2 py-2">Data NF</th>
                  <th className="px-2 py-2 text-right">Valor NF</th>
                  <th className="px-2 py-2 text-right">Comissão NF</th>
                  <th className="px-2 py-2">Cód. CR</th>
                  <th className="px-2 py-2">Parc.</th>
                  <th className="px-2 py-2">Vencimento</th>
                  <th className="px-2 py-2">Baixa</th>
                  <th className="px-2 py-2 text-right">Título</th>
                  <th className="px-2 py-2 text-right">Recebido</th>
                  <th className="px-2 py-2 text-right">Saldo</th>
                  <th className="px-2 py-2 text-right">% parcela</th>
                  <th className="px-2 py-2 text-right">Base rateada</th>
                  <th className="px-2 py-2 text-right">Com. prevista</th>
                  <th className="px-2 py-2 text-right">Com. liberada</th>
                  <th className="px-2 py-2 text-right">Com. pendente</th>
                  <th className="px-2 py-2">St. título</th>
                  <th className="px-2 py-2">St. comissão</th>
                  <th className="px-2 py-2">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.lineId}
                    className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelectedLineId(row.lineId)}
                  >
                    <td className="px-2 py-2">{row.commissionPersonName}</td>
                    <td className="px-2 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-2 py-2">{row.orderCode ?? "—"}</td>
                    <td className="px-2 py-2">{row.nfeNumber ?? "—"}</td>
                    <td className="px-2 py-2">{formatDate(row.confirmedAt)}</td>
                    <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.documentBaseAmount)}</td>
                    <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.documentCommissionTotal)}</td>
                    <td className="px-2 py-2">{row.nomusReceivableId ?? "—"}</td>
                    <td className="px-2 py-2">{row.installmentNumber ?? "—"}</td>
                    <td className="px-2 py-2">{formatDate(row.dueDate)}</td>
                    <td className="px-2 py-2">{formatDate(row.settlementDate)}</td>
                    <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.receivableAmount)}</td>
                    <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.receivedAmount)}</td>
                    <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.openBalance)}</td>
                    <td className="px-2 py-2 text-right">
                      {row.financialSharePercent != null ? `${row.financialSharePercent.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {formatFinanceCurrency(row.allocatedBaseAmount ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.commissionExpected)}</td>
                    <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.commissionReleased)}</td>
                    <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.commissionPending)}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass("title", row.receivableTitleStatus)}`}>
                        {row.receivableTitleStatus}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass("commission", row.commissionStatus)}`}>
                        {row.commissionStatus}
                      </span>
                    </td>
                    <td className="px-2 py-2">{row.alertLabels.join("; ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CommissionsTableScroll>

          {pagination ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {pagination.page} de {pagination.totalPages} ({pagination.total} linhas)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={financeBiButtonOutlineClass}
                  disabled={pagination.page <= 1}
                  onClick={() => setAppliedFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={financeBiButtonOutlineClass}
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setAppliedFilters((f) => ({ ...f, page: f.page + 1 }))}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <VisualAuditDetailDrawer lineId={selectedLineId} onClose={() => setSelectedLineId(null)} />
    </div>
  );
}
