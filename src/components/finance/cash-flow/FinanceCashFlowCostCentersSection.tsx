import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, Layers } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildDailyRadarQuery,
  type DailyRadarSelectionKey,
} from "@/src/lib/financeCashFlowDailyRadar";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
// DAILY_RADAR_CUSTOM_RANGE_KEY is only used server-side; the frontend passes rangeKey as string.
import { cn } from "@/src/lib/utils";

type Props = {
  range?: DailyRadarSelectionKey;
  customStartDate?: string | null;
  customEndDate?: string | null;
  day?: string | null;
  search?: string;
  /** Quando falso ou sem escopo, a seção não é renderizada. */
  visible: boolean;
};

type CostCenterSummaryItem = {
  costCenterId: string;
  code: string | null;
  name: string;
  amount: number;
  titlesCount: number;
  sharePercentage: number;
  status: string | null;
  unclassified: boolean;
};

type CostCenterSummaryPayload = {
  ok: boolean;
  items: CostCenterSummaryItem[];
  totalAmount: number;
  totalTitles: number;
  totalTitlesWithAllocation: number;
  unclassifiedAmount: number;
  unclassifiedTitles: number;
  scope: {
    level: "range" | "day" | "custom" | null;
    rangeKey: string | null;
    rangeLabel: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    day: string | null;
    search: string | null;
  };
};

type CostCenterTitleDetail = {
  accountsPayableExternalId: number;
  supplier: string | null;
  company: string | null;
  description: string | null;
  document: string | null;
  dueDate: string | null;
  amount: number;
  status: string | null;
  paymentMethod: string | null;
};

type CostCenterTitlesPayload = {
  ok: boolean;
  costCenterId: string;
  titles: CostCenterTitleDetail[];
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  ARCHIVED: "Arquivado",
};

function formatStatus(status: string | null): string | null {
  if (!status?.trim()) return null;
  return STATUS_LABEL[status.trim().toUpperCase()] ?? status;
}

export function FinanceCashFlowCostCentersSection({
  range,
  customStartDate,
  customEndDate,
  day,
  search,
  visible,
}: Props): JSX.Element | null {
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<CostCenterSummaryPayload | null>(null);
  const [selected, setSelected] = useState<CostCenterSummaryItem | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerTitles, setDrawerTitles] = useState<CostCenterTitleDetail[]>([]);

  const hasScope =
    Boolean(range) ||
    Boolean(customStartDate && customEndDate) ||
    Boolean(day);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    if (!visible || !hasScope) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const qs = buildDailyRadarQuery({
        range,
        customStartDate: customStartDate ?? undefined,
        customEndDate: customEndDate ?? undefined,
        day: day ?? undefined,
        search: search || undefined,
        pageSize: 500,
      });
      const data = await fetchJsonOk<CostCenterSummaryPayload>(
        `/api/finance/cash-flow/daily-radar/cost-centers?${qs}`,
        { signal: ac.signal }
      );
      setPayload(data);
    } catch (e) {
      if ((e as { name?: string } | undefined)?.name === "AbortError") return;
      setPayload(null);
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar os centros de custo do período."
      );
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [customEndDate, customStartDate, day, hasScope, range, search, visible]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const openDrawer = useCallback(
    async (item: CostCenterSummaryItem) => {
      setSelected(item);
      setDrawerError(null);
      setDrawerLoading(true);
      setDrawerTitles([]);
      try {
        const qs = buildDailyRadarQuery({
          range,
          customStartDate: customStartDate ?? undefined,
          customEndDate: customEndDate ?? undefined,
          day: day ?? undefined,
          search: search || undefined,
          pageSize: 500,
        });
        const url =
          `/api/finance/cash-flow/daily-radar/cost-centers/titles?${qs}` +
          `&costCenterId=${encodeURIComponent(item.costCenterId)}`;
        const data = await fetchJsonOk<CostCenterTitlesPayload>(url);
        setDrawerTitles(data.titles);
      } catch (e) {
        setDrawerError(
          e instanceof Error
            ? e.message
            : "Não foi possível carregar os títulos deste centro de custo."
        );
      } finally {
        setDrawerLoading(false);
      }
    },
    [customEndDate, customStartDate, day, range, search]
  );

  const periodLabel = useMemo(() => {
    if (!payload?.scope) return null;
    const s = payload.scope;
    if (s.level === "day" && s.day) {
      return `Dia — ${formatFinanceDate(s.day)}`;
    }
    if (s.level === "custom" && s.dateFrom && s.dateTo) {
      return `Período personalizado — ${formatFinanceDate(s.dateFrom)} a ${formatFinanceDate(s.dateTo)}`;
    }
    return s.rangeLabel ?? "Escopo selecionado";
  }, [payload]);

  if (!visible || !hasScope) return null;

  return (
    <section
      className={cn(financeBiCardClass, "p-4 space-y-3")}
      data-testid="cash-flow-cost-centers-section"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#111827] flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#4B5563]" aria-hidden />
            Centros de custo das saídas
          </h3>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Distribuição dos pagamentos do período selecionado, respeitando os filtros do drilldown.
          </p>
          {periodLabel ? (
            <p className="text-[11px] text-[#374151] mt-1" data-testid="cash-flow-cost-centers-scope">
              {periodLabel}
            </p>
          ) : null}
        </div>
        {payload ? (
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-md bg-[#F3F4F6] px-2 py-1 text-[#111827]">
              Total saídas:{" "}
              <strong>{formatFinanceCurrency(payload.totalAmount)}</strong>
            </span>
            <span className="rounded-md bg-[#F3F4F6] px-2 py-1 text-[#111827]">
              Títulos: <strong>{formatFinanceInteger(payload.totalTitles)}</strong>
            </span>
            {payload.unclassifiedAmount > 0.009 ? (
              <span className="rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-amber-900">
                Sem centro de custo:{" "}
                <strong>{formatFinanceCurrency(payload.unclassifiedAmount)}</strong>{" "}
                ({formatFinanceInteger(payload.unclassifiedTitles)} título
                {payload.unclassifiedTitles === 1 ? "" : "s"})
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando centros de custo...
        </div>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : !payload || payload.items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Nenhuma saída com centro de custo encontrada para o filtro atual.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {payload.items.map((item) => (
            <CostCenterCard
              key={item.costCenterId}
              item={item}
              onClick={() => void openDrawer(item)}
            />
          ))}
        </div>
      )}

      {selected ? (
        <CostCenterTitlesDrawer
          item={selected}
          onClose={() => setSelected(null)}
          loading={drawerLoading}
          error={drawerError}
          titles={drawerTitles}
        />
      ) : null}
    </section>
  );
}

function CostCenterCard({
  item,
  onClick,
}: {
  item: CostCenterSummaryItem;
  onClick: () => void;
}): JSX.Element {
  const statusLabel = formatStatus(item.status);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-[12px] border px-3 py-2.5 transition-colors",
        "hover:bg-[#F9FAFB] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70",
        item.unclassified
          ? "border-amber-200 bg-amber-50/60"
          : "border-[#E5E7EB] bg-white"
      )}
      data-testid={`cash-flow-cost-center-card-${item.costCenterId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wide",
              item.unclassified ? "text-amber-800" : "text-[#6B7280]"
            )}
            title={item.code ?? undefined}
          >
            {item.code ?? (item.unclassified ? "Auditoria" : "—")}
          </p>
          <p
            className="mt-0.5 truncate text-sm font-semibold text-[#111827]"
            title={item.name}
          >
            {item.name}
          </p>
        </div>
        {statusLabel ? (
          <span className="shrink-0 rounded-md border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#6B7280]">
            {statusLabel}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="text-[15px] font-bold tabular-nums text-[#111827]">
          {formatFinanceCurrency(item.amount)}
        </p>
        <p className="text-[11px] text-[#6B7280] tabular-nums">
          {formatFinancePercent(item.sharePercentage)}
        </p>
      </div>
      <p className="mt-0.5 text-[10px] text-[#6B7280]">
        {formatFinanceInteger(item.titlesCount)} título
        {item.titlesCount === 1 ? "" : "s"}
      </p>
    </button>
  );
}

function CostCenterTitlesDrawer({
  item,
  onClose,
  loading,
  error,
  titles,
}: {
  item: CostCenterSummaryItem;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  titles: CostCenterTitleDetail[];
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"
      onClick={onClose}
      data-testid="cash-flow-cost-center-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={`Títulos do centro de custo ${item.name}`}
    >
      <aside
        className="w-full max-w-xl bg-white shadow-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 bg-white border-b border-[#E5E7EB] p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-[#6B7280]">
              Centro de custo
            </p>
            <h4 className="text-sm font-bold text-[#111827] truncate" title={item.name}>
              {item.name}
            </h4>
            <p className="text-[11px] text-[#6B7280]">
              {item.code ?? (item.unclassified ? "Sem código" : "")} ·{" "}
              {formatFinanceCurrency(item.amount)} ·{" "}
              {formatFinanceInteger(item.titlesCount)} título
              {item.titlesCount === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            <X className="h-3.5 w-3.5" />
            Fechar
          </button>
        </header>
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando títulos...
            </div>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : titles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum título encontrado neste centro de custo para o filtro atual.
            </p>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Fornecedor</th>
                  <th className="py-1.5 pr-2 font-semibold">Descrição</th>
                  <th className="py-1.5 pr-2 font-semibold">Empresa</th>
                  <th className="py-1.5 pr-2 font-semibold">Vencimento</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Valor</th>
                  <th className="py-1.5 pr-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {titles.map((t) => (
                  <tr key={t.accountsPayableExternalId} className="border-b border-[#F3F4F6]">
                    <td className="py-1.5 pr-2 max-w-[160px] truncate" title={t.supplier ?? undefined}>
                      {t.supplier ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 max-w-[180px] truncate" title={t.description ?? undefined}>
                      {t.description ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 max-w-[120px] truncate" title={t.company ?? undefined}>
                      {t.company ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {t.dueDate ? formatFinanceDate(t.dueDate) : "—"}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-right">
                      {formatFinanceCurrency(t.amount)}
                    </td>
                    <td className="py-1.5 pr-2 text-[10px] uppercase tracking-wide text-[#6B7280]">
                      {t.status ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>
  );
}
