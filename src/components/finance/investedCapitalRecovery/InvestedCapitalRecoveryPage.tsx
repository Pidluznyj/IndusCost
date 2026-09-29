/**
 * Financeiro > Recuperação do Dinheiro Investido — tela analítica somente
 * leitura. Backend é autoridade: este componente só envia filtros e
 * renderiza o DTO; nenhum capitalRecovered/moneyOnStreet/percent/status/
 * aging/KPI/margem/decomposição é recalculado aqui.
 *
 * Leitura em blocos (decomposição econômica do PV): 1. Economia dos pedidos,
 * 2. O que já aconteceu, 3. O que ainda tem para entrar, 4. Leitura
 * gerencial, 5. Detalhamento por pedido (auditoria). As igualdades entre os
 * blocos já chegam reconciliadas do backend (população comparável = pedidos
 * com custo resolvido) — ver docs/finance/invested-capital-recovery.md.
 *
 * Filtros: seguem o padrão draft/applied já usado em Contas a Receber >
 * Títulos — os inputs só alteram estado local (`draftFilters`); a busca
 * (rede) só dispara quando o usuário clica "Pesquisar" (ou no primeiro
 * carregamento). `economicStatus` também é filtro de backend (não só da
 * tabela) — assim cards, aging e top clientes ficam sempre consistentes com
 * a mesma população da tabela.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModulePageLoading,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildFinanceArYearOptions,
  FINANCE_AR_MONTH_OPTIONS,
} from "@/src/lib/financeAccountsReceivableDashboardTypes";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import { financePersonFieldsFromSelection } from "@/src/lib/customerSearch";
import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { InvestedCapitalRecoveryPrintDocument } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument";
import { InvestedCapitalRecoveryCustomerPanel } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPanel";
import { InvestedCapitalRecoveryCustomerPrintDocument } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPrintDocument";
import { InvestedCapitalRecoveryEconomicSection } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryEconomicSection";
import { InvestedCapitalRecoveryRealizedSection } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryRealizedSection";
import { InvestedCapitalRecoveryReceivablesSection } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryReceivablesSection";
import { InvestedCapitalRecoveryExecutiveSection } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryExecutiveSection";
import type {
  InvestedCapitalRecoveryPayload,
  InvestedCapitalRecoveryRow,
  InvestedCapitalRecoveryStatus,
} from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";
import "@/src/components/sales/sales-order-report-print.css";
import { cn } from "@/src/lib/utils";

const SalesOrderDetailDialog = React.lazy(() =>
  import("@/src/components/sales/SalesOrderDetailDialog").then((mod) => ({
    default: mod.SalesOrderDetailDialog,
  }))
);

const STATUS_META: Record<
  InvestedCapitalRecoveryStatus,
  { label: string; dotClass: string; className: string }
> = {
  SEM_RECUPERACAO: { label: "Sem recuperação", dotClass: "bg-rose-500 shadow-rose-200", className: "bg-red-100 text-red-800" },
  EM_RECUPERACAO: { label: "Em recuperação", dotClass: "bg-amber-500 shadow-amber-200", className: "bg-amber-100 text-amber-800" },
  CAPITAL_RECUPERADO: { label: "Capital recuperado", dotClass: "bg-emerald-500 shadow-emerald-200", className: "bg-emerald-100 text-emerald-800" },
  DADOS_INSUFICIENTES: { label: "Dados insuficientes", dotClass: "bg-zinc-400 shadow-zinc-200", className: "bg-zinc-200 text-zinc-700" },
};

function StatusBadge({ status }: { status: InvestedCapitalRecoveryStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className="inline-flex items-center justify-center p-1 cursor-help"
    >
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full ring-2 ring-background shadow-xs",
          meta.dotClass
        )}
      />
    </span>
  );
}

function money(value: number | null): string {
  if (value == null) return "—";
  return formatFinanceCurrency(value);
}

function formatMonthYear(dateStr: string | null | undefined): string {
  if (!dateStr || typeof dateStr !== "string") return "—";
  const trimmed = dateStr.trim();
  if (!trimmed) return "—";
  const match = trimmed.match(/^(\d{4})-(\d{2})/);
  if (match) {
    const [, year, month] = match;
    return `${month}/${year.slice(-2)}`;
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return "—";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${month}/${year}`;
}

function RecoveryProgressBar({ percent }: { percent: number | null }) {
  if (percent == null || !Number.isFinite(percent)) return <span className="text-muted-foreground">—</span>;
  const clamped = Math.min(Math.max(percent, 0), 100);
  const colorClass =
    clamped >= 100
      ? "bg-emerald-500"
      : clamped > 0
      ? "bg-amber-500"
      : "bg-rose-400";

  return (
    <div className="flex items-center justify-end gap-1.5">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200 border border-slate-300/60 shrink-0">
        <div
          className={cn("h-full rounded-full transition-all", colorClass)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="font-semibold tabular-nums text-xs min-w-[28px] text-right">
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="opacity-30 text-[10px] ml-0.5">↕</span>;
  return <span className="text-sky-300 text-[10px] ml-0.5">{dir === "asc" ? "▲" : "▼"}</span>;
}

type InvestedCapitalRecoveryUiFilters = {
  startDate: string;
  endDate: string;
  q: string;
  year: string;
  month: string;
  customerId: string;
  customerName: string;
  customerCnpj: string;
  economicStatus: InvestedCapitalRecoveryStatus | "";
};

function defaultFilters(): InvestedCapitalRecoveryUiFilters {
  const now = new Date();
  return {
    startDate: "",
    endDate: "",
    q: "",
    year: String(now.getFullYear()),
    // Mês corrente por padrão — carregamento inicial rápido (população menor
    // que "ano inteiro"); usuário troca para "Todos" se quiser o ano completo.
    month: String(now.getMonth() + 1),
    customerId: "",
    customerName: "",
    customerCnpj: "",
    economicStatus: "",
  };
}

function buildQuery(filters: InvestedCapitalRecoveryUiFilters): string {
  const params = new URLSearchParams();
  const hasDateRange = !!filters.startDate || !!filters.endDate;

  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.q) params.set("q", filters.q);

  if (!hasDateRange) {
    if (filters.year) params.set("year", filters.year);
    if (filters.month) params.set("month", filters.month);
  }

  if (filters.customerId) params.set("customerId", filters.customerId);
  if (filters.economicStatus) params.set("economicStatus", filters.economicStatus);
  return params.toString();
}

function buildFilterLabels(filters: InvestedCapitalRecoveryUiFilters): string {
  const lines: string[] = [];
  const hasDateRange = !!filters.startDate || !!filters.endDate;

  if (!hasDateRange) {
    if (filters.year) lines.push(`Ano: ${filters.year}`);
    if (filters.month) {
      const label = FINANCE_AR_MONTH_OPTIONS.find((o) => o.value === filters.month)?.label;
      if (label) lines.push(`Mês: ${label}`);
    }
  } else {
    lines.push(`Emissão: ${filters.startDate || "…"} — ${filters.endDate || "…"}`);
  }

  if (filters.customerName) lines.push(`Cliente: ${filters.customerName}`);
  if (filters.q) lines.push(`Busca: ${filters.q}`);
  if (filters.economicStatus) lines.push(`Status econômico: ${STATUS_META[filters.economicStatus].label}`);
  return lines.join(" · ");
}

const PAGE_SIZE = 25;

/** Cabeçalho de coluna da tabela de pedidos — ordenável, com tooltip da regra. */
function OrderTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  title,
  align = "right",
  className,
}: {
  label: string;
  sortKey: keyof InvestedCapitalRecoveryRow;
  activeKey: keyof InvestedCapitalRecoveryRow;
  dir: "asc" | "desc";
  onSort: (key: keyof InvestedCapitalRecoveryRow) => void;
  title: string;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={cn(
        "sticky top-6 z-20 bg-slate-900 px-1.5 py-2 whitespace-nowrap cursor-pointer select-none",
        align === "right" && "text-right",
        className
      )}
      onClick={() => onSort(sortKey)}
      title={title}
    >
      <div className={cn("flex items-center gap-0.5", align === "right" && "justify-end")}>
        {label}
        <SortIcon active={activeKey === sortKey} dir={dir} />
      </div>
    </th>
  );
}

/** Cabeçalho de grupo (mesmos blocos da leitura acima da tabela). */
function GroupTh({ label, colSpan, className }: { label: string; colSpan: number; className?: string }) {
  return (
    <th
      colSpan={colSpan}
      scope="colgroup"
      className={cn(
        "sticky top-0 z-30 h-6 border-b border-slate-700 bg-slate-800 px-1.5 py-0 text-center text-[9px] font-semibold uppercase tracking-wider text-slate-300",
        className
      )}
    >
      {label}
    </th>
  );
}

export function InvestedCapitalRecoveryPage() {
  const [draftFilters, setDraftFilters] = useState<InvestedCapitalRecoveryUiFilters>(defaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<InvestedCapitalRecoveryUiFilters>(defaultFilters());
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"summary" | "customer">("summary");
  const [printView, setPrintView] = useState<"summary" | "customer">("summary");
  const [sortKey, setSortKey] = useState<keyof InvestedCapitalRecoveryRow>("moneyOnStreet");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [data, setData] = useState<InvestedCapitalRecoveryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const brandingLoadedRef = useRef(false);
  const [printPayload, setPrintPayload] = useState<InvestedCapitalRecoveryPayload | null>(null);
  const [printFilterLabels, setPrintFilterLabels] = useState("");
  const [printRequestId, setPrintRequestId] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);

  /**
   * Detalhe do Pedido — mesmo modal (quase fullscreen, portalizado no
   * document.body) usado em Comercial > Pedidos de venda e em Comissões >
   * Provisão por pedido. Toggle de estado local: filtros e página desta
   * tela nunca desmontam, então fechar o modal sempre volta no mesmo
   * estado. Responde "quais são os recebíveis e seus status" (aba Geral já
   * traz a tabela de CR real/documentos/previsão, igual ao Pedido de Venda).
   */
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailOrderCode, setDetailOrderCode] = useState<string | null>(null);
  const openOrderDetail = useCallback((salesOrderId: string, code: string | null) => {
    setDetailOrderId(salesOrderId);
    setDetailOrderCode(code);
  }, []);
  const closeOrderDetail = useCallback(() => {
    setDetailOrderId(null);
    setDetailOrderCode(null);
  }, []);

  const query = useMemo(() => buildQuery(appliedFilters), [appliedFilters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/invested-capital-recovery?${query}`, {
        credentials: "include",
      });
      const json = (await res.json()) as InvestedCapitalRecoveryPayload | { ok: false; message?: string };
      if (!res.ok || json.ok !== true) {
        throw new Error("message" in json ? (json.message ?? "Erro ao carregar dados.") : "Erro ao carregar dados.");
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar Recuperação do Dinheiro Investido.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const ensureBranding = useCallback(async () => {
    if (brandingLoadedRef.current) return branding;
    try {
      const next = await fetchUiSessionCachedJson<BrandingSettingsDTO>("/api/branding-settings", {
        ttlMs: 300_000,
      });
      brandingLoadedRef.current = true;
      setBranding(next);
      return next;
    } catch {
      brandingLoadedRef.current = true;
      setBranding(DEFAULT_BRANDING);
      return DEFAULT_BRANDING;
    }
  }, [branding]);

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters(draftFilters);
    setPage(1);
  }, [draftFilters]);

  const handleClearFilters = useCallback(() => {
    const defaults = defaultFilters();
    setDraftFilters(defaults);
    setAppliedFilters(defaults);
    setPage(1);
  }, []);

  const handleExportPdf = useCallback(async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      await ensureBranding();
      const res = await fetch(`/api/finance/invested-capital-recovery?${query}`, {
        credentials: "include",
      });
      const json = (await res.json()) as InvestedCapitalRecoveryPayload | { ok: false; message?: string };
      if (!res.ok || json.ok !== true) {
        throw new Error("message" in json ? (json.message ?? "Erro ao gerar PDF.") : "Erro ao gerar PDF.");
      }
      setPrintFilterLabels(buildFilterLabels(appliedFilters));
      setPrintView(view);
      setPrintPayload(json);
      setPrintRequestId((id) => id + 1);
    } catch (err) {
      console.error(err);
      alert("Não foi possível gerar o PDF de Recuperação do Dinheiro Investido.");
      setExportingPdf(false);
    }
  }, [appliedFilters, ensureBranding, exportingPdf, query, view]);

  useEffect(() => {
    if (printRequestId === 0 || !printPayload) return;

    document.body.classList.add("sales-orders-print-route");
    document.body.classList.add("sales-orders-icr-print-route");
    if (printView === "customer") document.body.classList.add("sales-orders-icr-customer-print-route");

    const onAfterPrint = () => {
      document.body.classList.remove("sales-orders-print-route");
      document.body.classList.remove("sales-orders-icr-print-route");
      document.body.classList.remove("sales-orders-icr-customer-print-route");
      setPrintPayload(null);
      setPrintRequestId(0);
      setExportingPdf(false);
    };

    window.addEventListener("afterprint", onAfterPrint, { once: true });

    const timer = window.setTimeout(() => {
      window.print();
    }, 350);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [printRequestId, printPayload, printView]);

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const rows = [...data.rows];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = typeof av === "number" ? av : av == null ? -Infinity : String(av);
      const bn = typeof bv === "number" ? bv : bv == null ? -Infinity : String(bv);
      if (an < bn) return sortDir === "asc" ? -1 : 1;
      if (an > bn) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(key: keyof InvestedCapitalRecoveryRow) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const maxAging = data ? Math.max(1, ...data.agingBuckets.map((b) => b.amount)) : 1;
  const yearOptions = useMemo(() => buildFinanceArYearOptions(), []);

  const thProps = { activeKey: sortKey, dir: sortDir, onSort: toggleSort } as const;

  return (
    <div className="flex flex-col gap-3" data-testid="invested-capital-recovery-page">
      <p className="rounded-md border border-dashed border-border/60 bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        Fonte oficial: motor de Pedido de Venda (custo industrial oficial + imposto da margem comercial + Contas a Receber reais).
        Esta tela apenas consolida dados oficiais — não cria títulos, não dá baixa, não altera o Pedido.
        Operações com empresas do grupo não são consideradas nesta análise.
      </p>

      <div className="flex gap-1" role="tablist" aria-label="Visões da recuperação do dinheiro investido">
        <button
          type="button"
          role="tab"
          aria-selected={view === "summary"}
          data-testid="invested-capital-recovery-view-summary"
          onClick={() => setView("summary")}
          className={cn(
            "h-8 rounded-md border px-3 text-xs font-semibold",
            view === "summary"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:bg-muted/40"
          )}
        >
          Visão Geral
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "customer"}
          data-testid="invested-capital-recovery-view-customer"
          onClick={() => setView("customer")}
          className={cn(
            "h-8 rounded-md border px-3 text-xs font-semibold",
            view === "customer"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:bg-muted/40"
          )}
        >
          Por Cliente
        </button>
      </div>

      <section className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Data do Pedido (de)</span>
            <input
              type="date"
              className="block h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={draftFilters.startDate}
              onChange={(e) => setDraftFilters((p) => ({ ...p, startDate: e.target.value }))}
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Data do Pedido (até)</span>
            <input
              type="date"
              className="block h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={draftFilters.endDate}
              onChange={(e) => setDraftFilters((p) => ({ ...p, endDate: e.target.value }))}
            />
          </label>
          <label className="min-w-[12rem] space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Buscar (PV ou cliente)</span>
            <input
              type="text"
              className="block h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              value={draftFilters.q}
              onChange={(e) => setDraftFilters((p) => ({ ...p, q: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleApplyFilters();
              }}
              placeholder="PD 1234 ou nome do cliente"
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Ano</span>
            <select
              className="block h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={draftFilters.year}
              onChange={(e) => setDraftFilters((p) => ({ ...p, year: e.target.value }))}
            >
              {yearOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Mês</span>
            <select
              className="block h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={draftFilters.month}
              onChange={(e) => setDraftFilters((p) => ({ ...p, month: e.target.value }))}
            >
              {FINANCE_AR_MONTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="min-w-[14rem]">
            <CustomerAutocompleteFilter
              label="Cliente"
              compact
              personName={draftFilters.customerName}
              personCnpj={draftFilters.customerCnpj}
              customerId={draftFilters.customerId}
              onChange={(selection) => {
                const fields = financePersonFieldsFromSelection(selection);
                setDraftFilters((p) => ({
                  ...p,
                  customerName: fields.personName,
                  customerCnpj: fields.personCnpj,
                  customerId: fields.customerId,
                }));
              }}
              onClear={() => {
                setDraftFilters((p) => ({
                  ...p,
                  customerName: "",
                  customerCnpj: "",
                  customerId: "",
                }));
              }}
            />
          </div>
          <label className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Status econômico</span>
            <select
              className="block h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={draftFilters.economicStatus}
              onChange={(e) =>
                setDraftFilters((p) => ({
                  ...p,
                  economicStatus: e.target.value as InvestedCapitalRecoveryStatus | "",
                }))
              }
            >
              <option value="">Todos</option>
              <option value="SEM_RECUPERACAO">Sem recuperação</option>
              <option value="EM_RECUPERACAO">Em recuperação</option>
              <option value="CAPITAL_RECUPERADO">Capital recuperado</option>
              <option value="DADOS_INSUFICIENTES">Dados insuficientes</option>
            </select>
          </label>
          <button
            type="button"
            onClick={handleApplyFilters}
            className="inline-flex h-8 items-center rounded-md border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            Pesquisar
          </button>
          <button
            type="button"
            onClick={handleClearFilters}
            className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-semibold hover:bg-muted/40"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf || loading || !data}
            className="sales-orders-no-print inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-semibold hover:bg-muted/40 disabled:opacity-50"
          >
            {exportingPdf ? "Gerando PDF…" : "Imprimir PDF"}
          </button>
        </div>
      </section>

      {loading ? (
        <FinanceModulePageLoading label="Carregando Recuperação do Dinheiro Investido…" />
      ) : error ? (
        <FinanceModuleErrorBanner message={error} onRetry={() => void load()} />
      ) : !data || data.rows.length === 0 ? (
        view === "customer" ? (
          <p className="rounded-lg border border-dashed border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum dado encontrado para os filtros selecionados.
          </p>
        ) : (
        <>
          <FinanceModuleEmptyState />
          {data?.populationDiagnostics ? (
            <p className="mt-1 rounded-md border border-dashed border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
              Diagnóstico (temporário): {data.populationDiagnostics.rawTotalSalesOrders} pedido(s) na
              base · {data.populationDiagnostics.totalCandidates} candidato(s) após status/presença
              operacional · {data.populationDiagnostics.intercompanyExcluded} excluído(s) por grupo
              econômico · {data.populationDiagnostics.eligibleOrders} elegível(is) para esta análise.
            </p>
          ) : null}
        </>
        )
      ) : view === "customer" && data.byCustomer ? (
        <InvestedCapitalRecoveryCustomerPanel
          byCustomer={data.byCustomer}
          rows={data.rows}
          onOpenOrder={openOrderDetail}
        />
      ) : (
        <>
          {/*
            Leitura executiva em blocos: 1. como a venda se divide (capital +
            margem econômica), 2. o que já entrou (retorno de capital + ganho),
            3. o que ainda tem para entrar (CR aberto = capital + ganho futuro,
            e capital ainda sem CR), 4. leitura gerencial — tudo do DTO.
          */}
          <InvestedCapitalRecoveryEconomicSection kpis={data.kpis} ordersCount={data.rows.length} />
          <InvestedCapitalRecoveryRealizedSection kpis={data.kpis} />
          <InvestedCapitalRecoveryReceivablesSection kpis={data.kpis}>
            <div className="grid gap-3 xl:grid-cols-2">
              <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-foreground">Capital na Rua por Faixa</h2>
                <div className="flex flex-col gap-1.5">
                  {data.agingBuckets.map((bucket) => (
                    <div key={bucket.key} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 text-muted-foreground">{bucket.label}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
                        <div
                          className="h-full rounded bg-red-400"
                          style={{ width: `${Math.round((bucket.amount / maxAging) * 100)}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right tabular-nums font-medium">{money(bucket.amount)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-foreground">Top Clientes — Capital na Rua</h2>
                <div className="flex flex-col gap-1.5">
                  {data.topCustomers.map((c) => (
                    <div key={c.customerName} className="flex items-center gap-2 text-xs">
                      <span className="w-40 shrink-0 truncate text-muted-foreground">{c.customerName}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
                        <div className="h-full rounded bg-amber-400" style={{ width: `${c.percentOfTotal}%` }} />
                      </div>
                      <span className="w-32 shrink-0 text-right tabular-nums font-medium">
                        {money(c.moneyOnStreet)} ({c.percentOfTotal.toFixed(0)}%)
                      </span>
                    </div>
                  ))}
                  {data.topCustomers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum cliente com capital na rua no período.</p>
                  ) : null}
                </div>
              </section>
            </div>
          </InvestedCapitalRecoveryReceivablesSection>
          <InvestedCapitalRecoveryExecutiveSection kpis={data.kpis} />

          <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden" data-testid="icr-orders-section">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">5 · Detalhamento por pedido</p>
                <h2 className="text-sm font-bold text-foreground">Auditoria pedido a pedido — clique na linha para abrir o Pedido</h2>
              </div>
              <p className="text-[11px] text-muted-foreground">Valores em R$ · colunas seguem os blocos acima</p>
            </div>
            <div className="max-h-[600px] overflow-auto relative">
              <table className="w-full min-w-[1900px] text-xs relative border-collapse" data-testid="invested-capital-recovery-table">
                <thead className="sticky top-0 z-20 bg-slate-900 text-white shadow-sm">
                  <tr>
                    <GroupTh label="Pedido" colSpan={2} />
                    <GroupTh label="Economia do pedido" colSpan={5} className="border-l border-slate-700" />
                    <GroupTh label="O que já aconteceu" colSpan={3} className="border-l border-slate-700" />
                    <GroupTh label="O que ainda tem para entrar" colSpan={5} className="border-l border-slate-700" />
                    <GroupTh label="Acompanhamento" colSpan={4} className="border-l border-slate-700" />
                  </tr>
                  <tr className="border-b border-slate-800 text-left text-[10px] font-semibold uppercase tracking-wide">
                    <OrderTh label="PV" sortKey="orderCode" align="left" title="Pedido de Venda" {...thProps} />
                    <OrderTh label="Cliente" sortKey="customerName" align="left" title="Nome do Cliente" {...thProps} />
                    <OrderTh label="Vendido" sortKey="saleValue" title="Valor líquido do Pedido de Venda" className="border-l border-slate-700" {...thProps} />
                    <OrderTh label="Cap. Invest." sortKey="investedCapital" title="Capital investido = custo industrial + imposto" {...thProps} />
                    <OrderTh label="Custo Prod." sortKey="industrialCost" title="Custo industrial de produção oficial" {...thProps} />
                    <OrderTh label="Imposto" sortKey="totalTaxes" title="Imposto usado no cálculo da margem comercial — já incluído no capital investido" {...thProps} />
                    <OrderTh label="Margem econ." sortKey="economicMargin" title="Margem econômica = vendido − capital investido (pode ser negativa; sem custo resolvido fica vazia)" {...thProps} />
                    <OrderTh label="Recebido" sortKey="actualReceived" title="Valor efetivamente recebido (CR real baixado)" className="border-l border-slate-700" {...thProps} />
                    <OrderTh label="Cap. Recup." sortKey="capitalRecovered" title="Capital recuperado = MIN(recebido, capital investido)" {...thProps} />
                    <OrderTh label="Ganho realiz." sortKey="realizedGain" title="Ganho realizado = MAX(recebido − capital investido, 0)" {...thProps} />
                    <OrderTh label="Cap. na Rua" sortKey="moneyOnStreet" title="Capital na rua = MAX(capital investido − recebido, 0)" className="border-l border-slate-700 text-amber-300" {...thProps} />
                    <OrderTh label="Falta receber" sortKey="outstandingReceivable" title="Saldo dos CR reais em aberto vinculados ao Pedido" {...thProps} />
                    <OrderTh label="Cap. no CR" sortKey="capitalReceivableCovered" title="Capital a recuperar nos recebíveis = MIN(CR aberto, capital na rua)" {...thProps} />
                    <OrderTh label="Ganho a rec." sortKey="gainReceivable" title="Ganho a receber = MAX(CR aberto − capital na rua, 0)" {...thProps} />
                    <OrderTh label="Cap. s/ CR" sortKey="capitalWithoutOpenReceivable" title="Capital na rua sem CR aberto = MAX(capital na rua − CR aberto, 0)" {...thProps} />
                    <OrderTh label="% Rec." sortKey="recoveryPercent" title="Percentual de capital recuperado" className="border-l border-slate-700" {...thProps} />
                    <OrderTh label="Pagou em" sortKey="capitalRecoveryDate" align="left" title="Mês/Ano em que o capital foi recuperado" {...thProps} />
                    <OrderTh label="Prev. Rec." sortKey="forecastCapitalRecoveryDate" align="left" title="Previsão Mês/Ano de recuperação do capital (agenda de CR real aberto)" {...thProps} />
                    <th className="sticky top-6 z-20 bg-slate-900 px-1.5 py-2 text-center whitespace-nowrap" title="Status Econômico">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {pageRows.map((row) => (
                    <tr
                      key={row.salesOrderId}
                      tabIndex={0}
                      aria-label={`Ver recebíveis e status do Pedido ${row.orderCode}`}
                      className="cursor-pointer border-b border-border/50 outline-none hover:bg-muted/40 focus-visible:bg-muted/50 transition-colors"
                      data-testid={`invested-capital-recovery-row-${row.salesOrderId}`}
                      onClick={() => openOrderDetail(row.salesOrderId, row.orderCode)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openOrderDetail(row.salesOrderId, row.orderCode);
                        }
                      }}
                    >
                      <td className="px-1.5 py-1.5 font-medium text-foreground whitespace-nowrap">{row.orderCode}</td>
                      <td className="px-1.5 py-1.5" title={row.customerName ?? undefined}>
                        {row.customerName ? (row.customerName.length > 15 ? row.customerName.slice(0, 15) + "…" : row.customerName) : "—"}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums font-medium whitespace-nowrap border-l border-border/60">
                        {money(row.saleValue)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">
                        {row.investedCapital == null ? (
                          <span title={row.investedCapitalUnavailableReason ?? undefined}>—</span>
                        ) : (
                          money(row.investedCapital)
                        )}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                        {row.industrialCost == null ? "—" : money(row.industrialCost)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                        {row.totalTaxes == null ? (
                          "—"
                        ) : (
                          <span title={row.taxSourceLabel ?? undefined}>{money(row.totalTaxes)}</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap font-medium",
                          row.economicMargin != null && row.economicMargin < 0 ? "text-rose-700" : "text-foreground"
                        )}
                      >
                        {money(row.economicMargin)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap border-l border-border/60">{money(row.actualReceived)}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap font-medium text-emerald-700">
                        {money(row.capitalRecovered)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap font-medium text-emerald-700">
                        {money(row.realizedGain ?? null)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap font-bold text-rose-700 border-l border-border/60">
                        {money(row.moneyOnStreet)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap font-medium">
                        {money(row.outstandingReceivable)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap text-amber-700">
                        {money(row.capitalReceivableCovered)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap text-emerald-700">
                        {money(row.gainReceivable)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap text-rose-700">
                        {money(row.capitalWithoutOpenReceivable)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right whitespace-nowrap border-l border-border/60">
                        <RecoveryProgressBar percent={row.recoveryPercent} />
                      </td>
                      <td className="px-1.5 py-1.5 whitespace-nowrap font-medium text-foreground">
                        {formatMonthYear(row.capitalRecoveryDate)}
                      </td>
                      <td className="px-1.5 py-1.5 whitespace-nowrap text-muted-foreground">
                        {formatMonthYear(row.forecastCapitalRecoveryDate)}
                      </td>
                      <td className="px-1.5 py-1.5 text-center whitespace-nowrap">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span>
                {sortedRows.length} pedido{sortedRows.length === 1 ? "" : "s"} no filtro
                {data.truncated ? ` (limitado a ${data.totalOrdersInScope})` : ""}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-border px-2 py-1 disabled:opacity-40"
                >
                  Anterior
                </button>
                <span>
                  Página {page} de {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded border border-border px-2 py-1 disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {printPayload && printView === "customer" && printPayload.byCustomer
        ? createPortal(
            <InvestedCapitalRecoveryCustomerPrintDocument
              byCustomer={printPayload.byCustomer}
              generatedAt={printPayload.generatedAt}
              branding={branding}
              filterLabels={printFilterLabels}
            />,
            document.body
          )
        : printPayload
        ? createPortal(
            <InvestedCapitalRecoveryPrintDocument
              payload={printPayload}
              branding={branding}
              filterLabels={printFilterLabels}
            />,
            document.body
          )
        : null}

      {detailOrderId != null ? (
        <React.Suspense fallback={null}>
          <SalesOrderDetailDialog
            open
            salesOrderId={detailOrderId}
            orderCode={detailOrderCode}
            onClose={closeOrderDetail}
          />
        </React.Suspense>
      ) : null}
    </div>
  );
}
