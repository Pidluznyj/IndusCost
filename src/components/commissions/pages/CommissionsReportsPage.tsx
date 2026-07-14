import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Download,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  COMMISSIONS_FILTER_FIELD_CLASS,
  COMMISSIONS_FILTER_LABEL_CLASS,
  buildCommissionsYearOptions,
} from "@/src/lib/commissionsPeriodFilter";
import { CommissionsMonthsMultiSelect } from "@/src/components/commissions/CommissionsMonthsMultiSelect";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import {
  SystemTotalizerCard,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
} from "@/src/components/ui/SystemTotalizerCard";
import { cn } from "@/src/lib/utils";
import type {
  CommissionReportRecord,
  CommissionReportsMonthsFilter,
  CommissionReportsPayload,
} from "@/src/lib/commissions/commissionReports.shared";
import { buildCommissionReportsExportFilename } from "@/src/lib/commissions/commissionReports.shared";
import {
  SalesOrderMarginDetailDrawer,
  type SalesOrderMarginDetailCommissionContext,
} from "@/src/components/sales/SalesOrderMarginDetailDrawer";
import { formatSalesOrderDisplayCode } from "@/src/lib/salesOrderListUi";

const MONTH_LABELS = [
  "",
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "CLOSED", label: "Fechado" },
  { value: "PREVIEW", label: "Prévia" },
  { value: "COMMISSIONABLE", label: "Comissionável" },
  { value: "CUSTOMER_EXCLUDED", label: "Cliente excluído" },
  { value: "GROUP_COMPANY_EXCLUDED", label: "Empresa do grupo" },
  { value: "SELLER_UNRESOLVED", label: "Vendedor não resolvido" },
  { value: "NO_SELLER", label: "Sem vendedor" },
  { value: "NO_SALES_LINK", label: "Sem vínculo com pedido" },
  { value: "NO_SCHEDULE", label: "Sem programação de comissão" },
  { value: "NO_RULE", label: "Sem regra de comissão" },
  { value: "NO_MARGIN", label: "Sem margem/tabela" },
  { value: "COMMISSION_SOURCE_MISMATCH", label: "Divergente do snapshot" },
  { value: "STALE_SCHEDULE", label: "Programação desatualizada" },
  { value: "ZERO_AMOUNT", label: "Comissão zerada" },
  { value: "ERROR", label: "Erro no cálculo" },
] as const;

/** Motivos técnicos → texto acionável para o usuário arrumar o cadastro. */
const REASON_LABELS: Record<string, string> = {
  CLIENTE_EXCLUIDO_POR_REGRA:
    "Cliente excluído de comissionamento — revise exclusões de cliente.",
  EMPRESA_GRUPO_EXCLUIDA:
    "Empresa do grupo econômico — não gera comissão.",
  VENDEDOR_NOMUS_NAO_INFORMADO:
    "Pedido sem vendedor Nomus — informe o vendedor no pedido.",
  NO_SALES_LINK: "Título sem vínculo com pedido de venda — revise NF × pedido.",
  NO_SCHEDULE:
    "Sem programação de comissão materializada — rode o fechamento/reprocesso.",
  NO_RULE: "Sem regra ou percentual de comissão aplicável ao pedido/vendedor.",
  NO_MARGIN:
    "Margem ou tabela comercial indisponível na data — publique a tabela.",
  COMMISSION_SOURCE_MISMATCH:
    "Comissão divergente do snapshot oficial do pedido — reprocessar/materializar (não altera comissão paga).",
  COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT:
    "Comissão divergente do snapshot oficial do pedido — reprocessar/materializar.",
  STALE_SCHEDULE: "Programação de comissão desatualizada — reprocessar fechamento.",
  ZERO_AMOUNT: "Base/comissão programada zerada — confira valor do CR e rateio.",
  "Base recebida zerada":
    "Base recebida zerada — o título não gerou base comissionável.",
  "Base comissionável zerada":
    "Base comissionável zerada — confira itens/regra e valor do CR.",
  "Comissão programada zerada":
    "Comissão programada zerada — percentual ou base sem valor.",
  "Percentual de comissão zerado":
    "Percentual de comissão zerado na regra — ajuste a regra do vendedor.",
  "Título recebido sem schedule de comissão materializado":
    "Sem programação de comissão — materialize/reprocesse o fechamento.",
  "Título recebido sem vínculo com pedido de venda":
    "CR sem vínculo com pedido — associe NF/pedido corretamente.",
  "Nenhuma regra de comissão aplicável ao pedido/NF":
    "Nenhuma regra de comissão aplicável — cadastre regra para o vendedor.",
  "Vendedor não resolvido no snapshot materializado":
    "Vendedor não resolvido — corrija o vendedor Nomus do pedido.",
};

function formatLineStatus(status: string): string {
  const found = STATUS_OPTIONS.find((o) => o.value === status);
  return found?.label ?? status;
}

function resolveCommissionBlockReason(row: CommissionReportRecord): string | null {
  if (row.lineStatus === "COMMISSIONABLE" && row.finalCommissionAmount > 0.009) {
    return null;
  }
  const raw =
    row.statusReason?.trim() ||
    row.exclusionReason?.trim() ||
    row.lineStatus ||
    "";
  if (!raw) {
    return "Comissão não gerada — abra o Detalhe para investigar.";
  }
  const byCode = REASON_LABELS[raw];
  if (byCode) return byCode;
  const byStatus = REASON_LABELS[row.lineStatus];
  if (byStatus && (raw === row.lineStatus || !row.statusReason)) return byStatus;
  // Motivo livre já legível (ex.: exclusão com texto do usuário)
  if (/[a-záàâãéêíóôõúç\s]/i.test(raw) && raw.length > 8 && !/^[A-Z0-9_]+$/.test(raw)) {
    return raw;
  }
  return `${formatLineStatus(row.lineStatus)}: ${raw}`;
}

function CommissionAmountCell({ row }: { row: CommissionReportRecord }): JSX.Element {
  const blockReason = resolveCommissionBlockReason(row);
  const showHint =
    Boolean(blockReason) &&
    (row.finalCommissionAmount <= 0.009 || row.lineStatus !== "COMMISSIONABLE");

  return (
    <td
      className="px-3 py-2 font-medium"
      data-testid="commissions-reports-commission-cell"
    >
      <span className="inline-flex max-w-[16rem] items-center gap-1.5">
        <span
          className={cn(showHint && "text-amber-900/90")}
          title={showHint ? blockReason ?? undefined : undefined}
        >
          {formatFinanceCurrency(row.finalCommissionAmount)}
        </span>
        {showHint ? (
          <span
            className="inline-flex max-w-[11rem] cursor-help items-center gap-0.5 rounded border border-amber-200/80 bg-amber-50 px-1 py-0.5 text-[10px] font-semibold leading-tight text-amber-900"
            title={blockReason ?? undefined}
            aria-label={`Motivo sem comissão: ${blockReason}`}
            data-testid="commissions-reports-commission-reason-hint"
          >
            <AlertCircle className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
            <span className="truncate">{blockReason}</span>
          </span>
        ) : null}
        {row.isZeroCommission && !showHint ? (
          <span className="text-[10px] text-muted-foreground">zerada</span>
        ) : null}
        {row.isPayable ? (
          <span className="text-[10px] text-emerald-700">a pagar</span>
        ) : null}
        {row.divergesFromOrderSnapshot ? (
          <span
            className="rounded border border-amber-300/80 bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-950"
            title="Comissão divergente do snapshot oficial do pedido"
            data-testid="commissions-reports-snapshot-mismatch-badge"
          >
            Divergente do snapshot
          </span>
        ) : row.source === "ORDER_SNAPSHOT" || row.source === "MATERIALIZED_SCHEDULE" ? (
          <span
            className="text-[10px] text-muted-foreground"
            title="Valor alinhado à materialização oficial"
          >
            Snapshot oficial
          </span>
        ) : null}
      </span>
    </td>
  );
}

function formatPeriodStatus(status: string): string {
  if (status === "CLOSED") return "Fechado";
  if (status === "PREVIEW") return "Prévia";
  return status;
}

function formatDateBr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function buildReportsQuery(params: {
  year: string;
  months: CommissionReportsMonthsFilter;
  sellerId: string;
  status: string;
  search: string;
  page: number;
  pageSize: number;
}): string {
  const qs = new URLSearchParams();
  qs.set("year", params.year);
  if (params.months === "all" || (Array.isArray(params.months) && params.months.length === 0)) {
    qs.set("months", "all");
  } else {
    qs.set("months", params.months.join(","));
  }
  qs.set("sellerId", params.sellerId || "all");
  qs.set("status", params.status || "all");
  if (params.search.trim()) qs.set("search", params.search.trim());
  qs.set("page", String(params.page));
  qs.set("pageSize", String(params.pageSize));
  return qs.toString();
}

export function CommissionsReportsPage() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [months, setMonths] = useState<CommissionReportsMonthsFilter>([now.getMonth() + 1]);
  const [sellerId, setSellerId] = useState("all");
  const [status, setStatus] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedSellerKey, setSelectedSellerKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommissionReportRecord | null>(null);
  const [orderDetailRow, setOrderDetailRow] = useState<CommissionReportRecord | null>(null);

  const [data, setData] = useState<CommissionReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const pageSize = 50;
  const yearOptions = useMemo(
    () => buildCommissionsYearOptions(Number.parseInt(year, 10) || new Date().getFullYear()),
    [year]
  );

  const queryString = useMemo(
    () =>
      buildReportsQuery({
        year,
        months,
        sellerId,
        status,
        search,
        page,
        pageSize,
      }),
    [year, months, sellerId, status, search, page, pageSize]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionReportsPayload>(
        `/api/commissions/reports?${queryString}`
      );
      setData({
        ...payload,
        sellers: payload.sellers ?? [],
        records: payload.records ?? [],
        sellerOptions: payload.sellerOptions ?? [],
      });
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar o relatório de comissões."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function clearFilters() {
    setYear(String(now.getFullYear()));
    setMonths("all");
    setSellerId("all");
    setStatus("all");
    setSearchInput("");
    setSearch("");
    setSelectedSellerKey(null);
    setPage(1);
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  function toggleSellerFilter(row: { sellerGroupKey: string; sellerId: string | null }) {
    const value = row.sellerId ?? row.sellerGroupKey;
    if (selectedSellerKey === row.sellerGroupKey) {
      setSellerId("all");
      setSelectedSellerKey(null);
    } else {
      setSellerId(value);
      setSelectedSellerKey(row.sellerGroupKey);
    }
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const qs = buildReportsQuery({
        year,
        months,
        sellerId,
        status,
        search,
        page: 1,
        pageSize: 100000,
      });
      const res = await fetch(`/api/commissions/reports/export.xlsx?${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Falha ao exportar XLSX.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const yearNum = Number.parseInt(year, 10) || now.getFullYear();
      a.download = buildCommissionReportsExportFilename(yearNum, months);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível exportar o relatório."));
    } finally {
      setExporting(false);
    }
  }

  const summary = data?.summary;
  const sellers = data?.sellers ?? [];
  const records = data?.records ?? [];
  const sellerOptions = data?.sellerOptions ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5" data-testid="commissions-reports-page">
      <CommissionsSectionIntro
        title="Relatórios de comissão"
        description="Consulta dos registros materializados pelo Fechamento do mês (data de recebimento/baixa). Não recalcula comissão no navegador."
        testId="commissions-reports-intro"
      />

      <div
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
        data-testid="commissions-reports-filters"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Ano</span>
            <select
              className={COMMISSIONS_FILTER_FIELD_CLASS}
              value={year}
              onChange={(e) => {
                setYear(e.target.value || String(now.getFullYear()));
                setPage(1);
              }}
              aria-label="Ano"
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <CommissionsMonthsMultiSelect
            value={months}
            onChange={(next) => {
              setMonths(next);
              setPage(1);
            }}
          />
          <label className="space-y-1">
            <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Vendedor</span>
            <select
              className={COMMISSIONS_FILTER_FIELD_CLASS}
              value={sellerId}
              onChange={(e) => {
                setSellerId(e.target.value);
                setSelectedSellerKey(null);
                setPage(1);
              }}
              aria-label="Vendedor"
              data-testid="commissions-reports-seller-filter"
            >
              {sellerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Status</span>
            <select
              className={COMMISSIONS_FILTER_FIELD_CLASS}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              aria-label="Status"
              data-testid="commissions-reports-status-filter"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <form className="flex flex-wrap items-end gap-2" onSubmit={applySearch}>
          <label className="min-w-[220px] flex-1 space-y-1">
            <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Busca</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                className={cn(COMMISSIONS_FILTER_FIELD_CLASS, "pl-8")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cliente, pedido, NF-e, CR…"
                aria-label="Busca livre"
                data-testid="commissions-reports-search"
              />
            </div>
          </label>
          <button type="submit" className={financeBiButtonOutlineClass}>
            Buscar
          </button>
          <button type="button" className={financeBiButtonOutlineClass} onClick={clearFilters}>
            Limpar filtros
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void reload()}
            disabled={loading}
          >
            <RefreshCw className={cn("mr-1 inline h-3.5 w-3.5", loading && "animate-spin")} />
            Atualizar
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void handleExport()}
            disabled={exporting || loading}
            data-testid="commissions-reports-export"
          >
            {exporting ? (
              <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 inline h-3.5 w-3.5" />
            )}
            Exportar XLSX
          </button>
        </form>
        {selectedSellerKey ? (
          <p className="text-xs text-muted-foreground">
            Filtrado pelo vendedor na tabela de resumo. Clique novamente na linha para limpar.
          </p>
        ) : null}
      </div>

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} onDismiss={() => setError(null)} />
      ) : null}

      {loading && !data ? <CommissionsLoading label="Carregando relatório…" /> : null}

      {summary ? (
        <CommissionsKpiSection title="Resumo" testId="commissions-reports-summary">
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Comissão total"
            amount={summary.totalCommission}
            amountFormat="currency"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Base comissionável"
            amount={summary.commissionableBase}
            amountFormat="currency"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Valor recebido"
            amount={summary.receivedAmount}
            amountFormat="currency"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Registros"
            amount={summary.recordCount}
            amountFormat="number"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Vendedores"
            amount={summary.sellerCount}
            amountFormat="number"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Clientes excluídos"
            amount={summary.excludedCustomerCount}
            amountFormat="number"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Empresas do grupo"
            amount={summary.groupCompanyExcludedCount}
            amountFormat="number"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Vendedor não resolvido"
            amount={summary.unresolvedSellerCount}
            amountFormat="number"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Comissão excluída"
            amount={summary.excludedCommission}
            amountFormat="currency"
          />
        </CommissionsKpiSection>
      ) : null}

      <section className="space-y-2" data-testid="commissions-reports-sellers">
        <h3 className="text-sm font-semibold text-foreground">Resumo por vendedor</h3>
        {sellers.length === 0 && !loading ? (
          <CommissionsEmptyState
            title="Nenhum registro encontrado para os meses selecionados."
            description="Ajuste ano, meses ou vendedor. Meses sem fechamento usam a prévia do Fechamento, quando disponível."
          />
        ) : (
          <CommissionsTableScroll testId="commissions-reports-sellers-table">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Vendedor</th>
                <th className="px-3 py-2">Registros</th>
                <th className="px-3 py-2">Valor recebido</th>
                <th className="px-3 py-2">Base</th>
                <th className="px-3 py-2">Comissão bruta</th>
                <th className="px-3 py-2">Excluída</th>
                <th className="px-3 py-2">Comissão final</th>
                <th className="px-3 py-2">% médio</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sellers.map((row) => (
                <tr
                  key={row.sellerGroupKey}
                  className={cn(
                    "cursor-pointer hover:bg-accent/40",
                    selectedSellerKey === row.sellerGroupKey && "bg-primary/10"
                  )}
                  onClick={() => toggleSellerFilter(row)}
                  data-testid="commissions-reports-seller-row"
                >
                  <td className="px-3 py-2 font-medium">{row.sellerName}</td>
                  <td className="px-3 py-2">{row.recordCount}</td>
                  <td className="px-3 py-2">{formatFinanceCurrency(row.receivedAmount)}</td>
                  <td className="px-3 py-2">{formatFinanceCurrency(row.commissionableBase)}</td>
                  <td className="px-3 py-2">{formatFinanceCurrency(row.grossCommission)}</td>
                  <td className="px-3 py-2">{formatFinanceCurrency(row.excludedCommission)}</td>
                  <td className="px-3 py-2 font-semibold">
                    {formatFinanceCurrency(row.finalCommission)}
                  </td>
                  <td className="px-3 py-2">
                    {row.avgRatePercent != null ? `${row.avgRatePercent.toFixed(2)}%` : "—"}
                  </td>
                  <td className="px-3 py-2">{formatLineStatus(row.primaryStatus)}</td>
                </tr>
              ))}
            </tbody>
          </CommissionsTableScroll>
        )}
      </section>

      <section className="space-y-2" data-testid="commissions-reports-records">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Registros de comissão</h3>
          {pagination ? (
            <p className="text-xs text-muted-foreground">
              {pagination.total} registro(s) · página {pagination.page} de{" "}
              {Math.max(pagination.totalPages, 1)}
            </p>
          ) : null}
        </div>

        {records.length === 0 && !loading ? (
          <CommissionsEmptyState
            title="Nenhum registro de comissão encontrado para os filtros selecionados."
            description="Tente outro período ou limpe a busca."
          />
        ) : (
          <CommissionsTableScroll testId="commissions-reports-records-table">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Mês</th>
                <th className="px-3 py-2">Recebimento</th>
                <th className="px-3 py-2">Vendedor</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Pedido</th>
                <th className="px-3 py-2">NF-e</th>
                <th className="px-3 py-2">CR</th>
                <th className="px-3 py-2">Recebido</th>
                <th className="px-3 py-2">Base</th>
                <th className="px-3 py-2">%</th>
                <th className="px-3 py-2">Comissão</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {records.map((row) => (
                <tr key={row.lineKey} data-testid="commissions-reports-record-row">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {MONTH_LABELS[row.month] ?? row.month}/{row.year}
                    <div className="text-[11px] text-muted-foreground">
                      {formatPeriodStatus(row.periodStatus)}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateBr(row.settlementDate)}</td>
                  <td className="px-3 py-2">
                    {row.sellerName}
                    {row.isNoSeller || row.isSellerUnresolved ? (
                      <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                        Sem vendedor
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {row.customerName ?? "—"}
                    {row.isCustomerExcluded ? (
                      <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                        Excluído
                      </span>
                    ) : null}
                    {row.isGroupCompany ? (
                      <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                        Grupo
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {row.orderCode &&
                    row.localOrderId &&
                    row.linkResolutionStatus !== "AMBIGUOUS" ? (
                      <button
                        type="button"
                        data-testid="commissions-reports-order-link"
                        className="min-h-9 rounded px-0.5 text-left font-medium text-sky-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                        onClick={() => setOrderDetailRow(row)}
                        title={`Ver detalhe do pedido ${formatSalesOrderDisplayCode(row.orderCode)}`}
                      >
                        {formatSalesOrderDisplayCode(row.orderCode)}
                      </button>
                    ) : row.orderCode ? (
                      <span
                        className="text-muted-foreground"
                        title={
                          row.linkResolutionStatus === "AMBIGUOUS"
                            ? row.statusReason ?? "Vínculo ambíguo com o pedido"
                            : undefined
                        }
                        data-testid="commissions-reports-order-ambiguous"
                      >
                        {formatSalesOrderDisplayCode(row.orderCode)}
                        {row.linkResolutionStatus === "AMBIGUOUS" ? (
                          <span className="ml-1 text-[10px] font-semibold text-amber-800">
                            vínculo ambíguo
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">{row.nfeNumber ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.receivableNumber ??
                      (row.nomusReceivableId != null ? String(row.nomusReceivableId) : "—")}
                  </td>
                  <td className="px-3 py-2">{formatFinanceCurrency(row.receivedAmount)}</td>
                  <td className="px-3 py-2">
                    {formatFinanceCurrency(row.commissionableBaseAmount)}
                  </td>
                  <td className="px-3 py-2">{row.ratePercent.toFixed(2)}%</td>
                  <CommissionAmountCell row={row} />
                  <td className="px-3 py-2">{formatLineStatus(row.lineStatus)}</td>
                  <td
                    className="max-w-[220px] truncate px-3 py-2 text-xs text-muted-foreground"
                    title={
                      resolveCommissionBlockReason(row) ??
                      row.statusReason ??
                      row.exclusionReason ??
                      undefined
                    }
                  >
                    {resolveCommissionBlockReason(row) ||
                      row.statusReason ||
                      row.exclusionReason ||
                      "—"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-primary underline"
                      onClick={() => setDetail(row)}
                    >
                      Detalhe
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </CommissionsTableScroll>
        )}

        {pagination && pagination.totalPages > 1 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={financeBiButtonOutlineClass}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className={financeBiButtonOutlineClass}
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        ) : null}
      </section>

      {detail ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Detalhe do registro de comissão"
          data-testid="commissions-reports-detail-drawer"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h4 className="text-base font-semibold">Detalhe do registro</h4>
              <button type="button" onClick={() => setDetail(null)} aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Cliente</dt>
                <dd>{detail.customerName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Pedido</dt>
                <dd>{detail.orderCode ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">NF-e</dt>
                <dd>{detail.nfeNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">CR / título</dt>
                <dd>
                  {detail.receivableNumber ??
                    (detail.nomusReceivableId != null ? String(detail.nomusReceivableId) : "—")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Vendedor</dt>
                <dd>{detail.sellerName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Data recebimento</dt>
                <dd>{formatDateBr(detail.settlementDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Base</dt>
                <dd>{formatFinanceCurrency(detail.commissionableBaseAmount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Percentual</dt>
                <dd>{detail.ratePercent.toFixed(2)}%</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Comissão final</dt>
                <dd>{formatFinanceCurrency(detail.finalCommissionAmount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd>
                  {formatPeriodStatus(detail.periodStatus)} · {formatLineStatus(detail.lineStatus)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Motivo / observação</dt>
                <dd>{detail.statusReason ?? detail.exclusionReason ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Origem</dt>
                <dd>{detail.source}</dd>
              </div>
              {detail.divergesFromOrderSnapshot ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Divergência</dt>
                  <dd className="text-amber-950">
                    Comissão divergente do snapshot oficial do pedido. Ação sugerida:
                    reprocessar/materializar comissão (comissão já paga não é alterada).
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      ) : null}

      <SalesOrderMarginDetailDrawer
        open={Boolean(orderDetailRow)}
        salesOrderId={orderDetailRow?.localOrderId ?? null}
        orderCodeFallback={orderDetailRow?.orderCode ?? null}
        commissionContext={
          orderDetailRow
            ? ({
                orderCode: orderDetailRow.orderCode,
                customerName: orderDetailRow.customerName,
                sellerName: orderDetailRow.sellerName,
                nfeNumber: orderDetailRow.nfeNumber,
                receivableNumber: orderDetailRow.receivableNumber,
                nomusReceivableId: orderDetailRow.nomusReceivableId,
                settlementDate: orderDetailRow.settlementDate,
                receivedAmount: orderDetailRow.receivedAmount,
                ratePercent: orderDetailRow.ratePercent,
                finalCommissionAmount: orderDetailRow.finalCommissionAmount,
                commissionableBaseAmount: orderDetailRow.commissionableBaseAmount,
                lineStatus: orderDetailRow.lineStatus,
              } satisfies SalesOrderMarginDetailCommissionContext)
            : null
        }
        onClose={() => setOrderDetailRow(null)}
      />
    </div>
  );
}
