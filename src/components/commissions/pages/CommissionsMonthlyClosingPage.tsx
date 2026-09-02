import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, X } from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { ExecutiveAlert } from "@/src/components/ui/ExecutiveAlert";
import { fetchJsonOk } from "@/src/lib/http";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";
import type {
  CommissionsMonthlyClosingGroupRow,
  CommissionsMonthlyClosingPayload,
} from "@/src/components/commissions/commissionsTypes";
import {
  buildMonthlyClosingExportQueryString,
  buildMonthlyClosingQueryString,
  EMPTY_MONTHLY_CLOSING_FILTERS,
  type MonthlyClosingFilters,
} from "@/src/components/commissions/monthlyClosing/commissionsMonthlyClosingFilters";

const inputClass = COMMISSIONS_FILTER_FIELD_CLASS;

type GroupTab = "seller" | "customer" | "nfe" | "receivable" | "product";

const GROUP_TABS: { id: GroupTab; label: string }[] = [
  { id: "seller", label: "Por vendedor" },
  { id: "customer", label: "Por cliente" },
  { id: "nfe", label: "Por NF" },
  { id: "receivable", label: "Por CR" },
  { id: "product", label: "Por produto" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function ClosingDetailDrawer({
  lineId,
  onClose,
}: {
  lineId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<{ explanation: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lineId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    void fetchJsonOk<{ explanation: string }>(
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
          <h4 className="text-lg font-bold">Detalhe do título</h4>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {loading ? <CommissionsLoading label="Carregando detalhe…" /> : null}
        {detail ? <p className="rounded-lg bg-muted/40 p-3 text-sm">{detail.explanation}</p> : null}
      </div>
    </div>
  );
}

function WorkflowStatusBadge({ label, status }: { label: string; status: string }) {
  const tone =
    status === "PAID"
      ? "bg-emerald-100 text-emerald-800"
      : status === "APPROVED"
        ? "bg-blue-100 text-blue-800"
        : status === "REVIEWED"
          ? "bg-sky-100 text-sky-800"
          : status === "DIVERGENT"
            ? "bg-amber-100 text-amber-900"
            : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>
      {label}
    </span>
  );
}

function SellerWorkflowTable({
  rows,
}: {
  rows: NonNullable<CommissionsMonthlyClosingPayload["workflow"]>["sellerRows"];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum vendedor no período.</p>;
  }
  return (
    <CommissionsTableScroll>
      <table className="min-w-[1000px] text-xs">
        <thead>
          <tr className="border-b text-left uppercase text-muted-foreground">
            <th className="px-2 py-2">Vendedor</th>
            <th className="px-2 py-2 text-right">Títulos</th>
            <th className="px-2 py-2 text-right">Recebido</th>
            <th className="px-2 py-2 text-right">Base</th>
            <th className="px-2 py-2 text-right">Comissão a pagar</th>
            <th className="px-2 py-2">Status fechamento</th>
            <th className="px-2 py-2">Lote pagamento</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sellerId} className="border-b">
              <td className="px-2 py-2 font-medium">{row.sellerName}</td>
              <td className="px-2 py-2 text-right">{row.receivedTitlesCount}</td>
              <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.receivedAmount)}</td>
              <td className="px-2 py-2 text-right">
                {formatFinanceCurrency(row.allocatedBaseAmount)}
              </td>
              <td className="px-2 py-2 text-right font-semibold">
                {formatFinanceCurrency(row.releasedCommissionAmount)}
              </td>
              <td className="px-2 py-2">
                <WorkflowStatusBadge
                  label={row.workflow.statusLabel}
                  status={row.workflow.status}
                />
              </td>
              <td className="px-2 py-2 text-muted-foreground">
                {row.workflow.paymentBatchId
                  ? `${row.workflow.paymentBatchStatus ?? "—"} · ${row.workflow.paymentBatchId.slice(0, 8)}…`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CommissionsTableScroll>
  );
}

function GroupingsTable({ rows }: { rows: CommissionsMonthlyClosingGroupRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum agrupamento no período.</p>;
  }
  return (
    <CommissionsTableScroll>
      <table className="min-w-[900px] text-xs">
        <thead>
          <tr className="border-b text-left uppercase text-muted-foreground">
            <th className="px-2 py-2">Grupo</th>
            <th className="px-2 py-2 text-right">Linhas</th>
            <th className="px-2 py-2 text-right">Títulos</th>
            <th className="px-2 py-2 text-right">Recebido</th>
            <th className="px-2 py-2 text-right">Base rateada</th>
            <th className="px-2 py-2 text-right">Comissão a pagar</th>
            <th className="px-2 py-2 text-right">% médio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.groupKey} className="border-b">
              <td className="px-2 py-2 font-medium">{row.groupLabel}</td>
              <td className="px-2 py-2 text-right">{row.lineCount}</td>
              <td className="px-2 py-2 text-right">{row.receivedTitlesCount}</td>
              <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.receivedAmount)}</td>
              <td className="px-2 py-2 text-right">
                {formatFinanceCurrency(row.allocatedBaseAmount)}
              </td>
              <td className="px-2 py-2 text-right font-semibold">
                {formatFinanceCurrency(row.releasedCommissionAmount)}
              </td>
              <td className="px-2 py-2 text-right">{row.averageCommissionRate.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CommissionsTableScroll>
  );
}

export function CommissionsMonthlyClosingPage() {
  const [draftFilters, setDraftFilters] = useState<MonthlyClosingFilters>(
    EMPTY_MONTHLY_CLOSING_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<MonthlyClosingFilters>(
    EMPTY_MONTHLY_CLOSING_FILTERS
  );
  const [data, setData] = useState<CommissionsMonthlyClosingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const [groupTab, setGroupTab] = useState<GroupTab>("seller");

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
      const qs = buildMonthlyClosingQueryString(appliedFilters);
      const payload = await fetchJsonOk<CommissionsMonthlyClosingPayload>(
        `/api/commissions/monthly-closing?${qs}`
      );
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar o fechamento mensal."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function exportCsv(format: "summary" | "detail" | "full" | "official") {
    setExporting(format);
    try {
      const qs = buildMonthlyClosingExportQueryString(appliedFilters, format);
      const res = await fetch(`/api/commissions/monthly-closing/export?${qs}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fechamento-comissao-${appliedFilters.year}-${appliedFilters.month}-${format}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }

  const cards = data?.cards;
  const workflow = data?.workflow;
  const nomus = data?.nomusReference;
  const detailRows = data?.detailRows ?? [];
  const pagination = data?.pagination;
  const groupRows =
    groupTab === "seller"
      ? data?.groupings.bySeller
      : groupTab === "customer"
        ? data?.groupings.byCustomer
        : groupTab === "nfe"
          ? data?.groupings.byNfe
          : groupTab === "receivable"
            ? data?.groupings.byReceivable
            : data?.groupings.byProduct;

  return (
    <div className="space-y-5" data-testid="commissions-monthly-closing-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Comissões
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Fechamento do mês
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Esta visão considera os títulos com recebimento real no mês. A data usada é a data do
            recebimento (<code>receiptDate</code>), não a da baixa do Contas a Receber
            (<code>settlementDate</code>). Resumo calculado no backend — sem cálculo no frontend.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Atualizar
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void exportCsv("summary")}
            disabled={exporting != null}
          >
            <Download className="mr-2 h-4 w-4" />
            CSV resumo
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void exportCsv("detail")}
            disabled={exporting != null}
          >
            <Download className="mr-2 h-4 w-4" />
            CSV detalhe
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void exportCsv("official")}
            disabled={exporting != null}
          >
            <Download className="mr-2 h-4 w-4" />
            CSV oficial
          </button>
        </div>
      </div>

      {workflow ? (
        <ExecutiveAlert
          variant={workflow.overallStatus === "DIVERGENT" ? "attention" : "info"}
          density="compact"
          title={`Status do fechamento: ${workflow.overallStatusLabel}`}
          description={`Fechamento calculado em tempo real — aprovação do mês não é gravada nesta tela. Aprovação/pagamento usam lotes existentes (CommissionPaymentBatch). ${
            workflow.approvalBlockedReason ?? "Exporte o CSV oficial para conferência."
          }`}
        />
      ) : null}

      {data ? (
        <ExecutiveAlert
          variant="info"
          density="compact"
          title={`Comissão a pagar em ${data.monthLabelPt}`}
          description={formatFinanceCurrency(data.payableCommissionTotal)}
        />
      ) : null}

      <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-[#6B7280]">
          Comparação Nomus manual (opcional)
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            Base Nomus
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.nomusReferenceBase}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, nomusReferenceBase: e.target.value }))
              }
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
          <div className="text-sm md:col-span-2 space-y-1 self-end">
            {cards ? (
              <p>
                Base IndusCost: {formatFinanceCurrency(cards.allocatedBaseAmountTotal)}
              </p>
            ) : null}
            {cards ? (
              <p>
                Comissão IndusCost: {formatFinanceCurrency(cards.payableCommissionTotal)}
              </p>
            ) : null}
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
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, commissionPersonId: e.target.value }))
              }
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
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.customer}
              onChange={(e) => setDraftFilters((f) => ({ ...f, customer: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Pedido
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.orderCode}
              onChange={(e) => setDraftFilters((f) => ({ ...f, orderCode: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            NF-e
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.nfeNumber}
              onChange={(e) => setDraftFilters((f) => ({ ...f, nfeNumber: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Código CR
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.nomusReceivableId}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, nomusReceivableId: e.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            Status título
            <select
              className={`${inputClass} mt-1`}
              value={draftFilters.receivableTitleStatus}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, receivableTitleStatus: e.target.value }))
              }
            >
              <option value="">Todos</option>
              <option value="BAIXADO">Baixado</option>
              <option value="PARCIAL">Parcial</option>
            </select>
          </label>
          <label className="text-sm">
            Status comissão
            <select
              className={`${inputClass} mt-1`}
              value={draftFilters.commissionStatus}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, commissionStatus: e.target.value }))
              }
            >
              <option value="">Todos</option>
              <option value="LIBERADA">Liberada</option>
              <option value="PARCIALMENTE_LIBERADA">Parcialmente liberada</option>
            </select>
          </label>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draftFilters.onlyDivergences}
            onChange={(e) =>
              setDraftFilters((f) => ({ ...f, onlyDivergences: e.target.checked }))
            }
          />
          Somente divergências
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => setAppliedFilters({ ...draftFilters, page: 1 })}
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => {
              setDraftFilters(EMPTY_MONTHLY_CLOSING_FILTERS);
              setAppliedFilters(EMPTY_MONTHLY_CLOSING_FILTERS);
            }}
          >
            Limpar filtros
          </button>
        </div>
      </div>

      {error ? <CommissionsErrorBanner message={error} onRetry={() => void reload()} /> : null}

      {cards ? (
        <CommissionsKpiSection
          title="Resumo do fechamento mensal"
          eyebrow="Títulos baixados no mês selecionado"
          testId="monthly-closing-cards"
        >
          <FinanceKpiCard
            label="Comissão a pagar no mês"
            value={formatFinanceCurrency(cards.payableCommissionTotal)}
          />
          <FinanceKpiCard
            label="Base comissionável recebida"
            value={formatFinanceCurrency(cards.allocatedBaseAmountTotal)}
          />
          <FinanceKpiCard
            label="Valor recebido/baixado"
            value={formatFinanceCurrency(cards.receivedAmountTotal)}
          />
          <FinanceKpiCard label="Títulos recebidos" value={String(cards.uniqueReceivablesCount)} />
          <FinanceKpiCard label="% médio" value={`${cards.averageCommissionRate.toFixed(2)}%`} />
          <FinanceKpiCard label="Divergências" value={String(cards.divergenceCount)} />
        </CommissionsKpiSection>
      ) : null}

      {data && data.receivedVsBaseDiff !== 0 ? (
        <p className="text-sm text-muted-foreground">
          Diferença valor recebido − base rateada:{" "}
          {formatFinanceCurrency(data.receivedVsBaseDiff)}
        </p>
      ) : null}

      {loading && !data ? <CommissionsLoading label="Carregando fechamento…" /> : null}

      {data && data.warnings.length > 0 ? (
        <ExecutiveAlert
          variant="attention"
          density="compact"
          title="Avisos de inconsistência"
          description={data.warnings.slice(0, 5).join(" · ")}
        />
      ) : null}

      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-[#6B7280]">
          Conferência por vendedor
        </p>
        <SellerWorkflowTable rows={workflow?.sellerRows ?? []} />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {GROUP_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                groupTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-muted/50"
              }`}
              onClick={() => setGroupTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <GroupingsTable rows={groupRows ?? []} />
      </div>

      {!loading && detailRows.length === 0 ? (
        <CommissionsEmptyState
          title="Nenhum título baixado no período"
          description="Ajuste ano, mês ou filtros. Títulos vencidos mas não baixados não entram no fechamento."
        />
      ) : null}

      {detailRows.length > 0 ? (
        <>
          <CommissionsTableScroll>
            <table className="min-w-[1400px] text-xs">
              <thead>
                <tr className="border-b text-left uppercase text-muted-foreground">
                  <th className="px-2 py-2">Vendedor</th>
                  <th className="px-2 py-2">Cliente</th>
                  <th className="px-2 py-2">Pedido</th>
                  <th className="px-2 py-2">NF</th>
                  <th className="px-2 py-2">CR</th>
                  <th className="px-2 py-2">Data NF</th>
                  <th className="px-2 py-2">Vencimento</th>
                  <th className="px-2 py-2">Baixa</th>
                  <th className="px-2 py-2 text-right">Recebido</th>
                  <th className="px-2 py-2 text-right">Base rateada</th>
                  <th className="px-2 py-2 text-right">%</th>
                  <th className="px-2 py-2 text-right">Comissão a pagar</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row) => (
                  <tr
                    key={row.lineId}
                    className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelectedLineId(row.lineId)}
                  >
                    <td className="px-2 py-2">{row.sellerName}</td>
                    <td className="px-2 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-2 py-2">{row.orderCode ?? "—"}</td>
                    <td className="px-2 py-2">{row.nfeNumber ?? "—"}</td>
                    <td className="px-2 py-2">{row.nomusReceivableId ?? "—"}</td>
                    <td className="px-2 py-2">{formatDate(row.confirmedAt)}</td>
                    <td className="px-2 py-2">{formatDate(row.dueDate)}</td>
                    <td className="px-2 py-2">{formatDate(row.settlementDate)}</td>
                    <td className="px-2 py-2 text-right">
                      {formatFinanceCurrency(row.receivedAmount)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {formatFinanceCurrency(row.allocatedBaseAmount)}
                    </td>
                    <td className="px-2 py-2 text-right">{row.itemRatePercent.toFixed(2)}%</td>
                    <td className="px-2 py-2 text-right font-semibold">
                      {formatFinanceCurrency(row.releasedCommissionAmount)}
                    </td>
                    <td className="px-2 py-2">
                      {row.alerts.length > 0 ? row.alerts.join("; ") : "OK"}
                    </td>
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
                  onClick={() =>
                    setAppliedFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))
                  }
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

      <ClosingDetailDrawer lineId={selectedLineId} onClose={() => setSelectedLineId(null)} />
    </div>
  );
}
