/**
 * Financeiro > Recuperação do Dinheiro Investido — tela analítica somente
 * leitura. Backend é autoridade: este componente só envia filtros e
 * renderiza o DTO; nenhum capitalRecovered/moneyOnStreet/percent/status/
 * aging/KPI é recalculado aqui.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModulePageLoading,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { formatFinanceCurrency, formatFinanceDate } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";

type InvestedCapitalRecoveryStatus =
  | "SEM_RECUPERACAO"
  | "EM_RECUPERACAO"
  | "CAPITAL_RECUPERADO"
  | "DADOS_INSUFICIENTES";

type InvestedCapitalRecoveryRow = {
  salesOrderId: string;
  orderCode: string;
  customerName: string | null;
  sellerName: string | null;
  saleValue: number;
  investedCapital: number | null;
  investedCapitalSource: "INDUSTRIAL_RESULT";
  investedCapitalUnavailableReason: string | null;
  actualReceived: number;
  outstandingReceivable: number;
  capitalRecovered: number | null;
  moneyOnStreet: number | null;
  recoveryPercent: number | null;
  status: InvestedCapitalRecoveryStatus;
  capitalRecoveryDate: string | null;
  forecastCapitalRecoveryDate: string | null;
  forecastSource: "REAL_RECEIVABLES" | "REAL_AND_FORECAST" | "FORECAST_ONLY" | "NONE";
  orderStatusLabel: string;
};

type InvestedCapitalRecoveryPayload = {
  ok: true;
  generatedAt: string;
  totalOrdersInScope: number;
  truncated: boolean;
  kpis: {
    moneyOnStreetToday: number;
    capitalRecoveredTotal: number;
    investedCapitalAnalyzedTotal: number;
    totalOutstandingReceivable: number;
    ordersFullyRecoveredCount: number;
    ordersPartiallyRecoveredCount: number;
    ordersInsufficientDataCount: number;
    averageDaysToRecoverCapital: number | null;
  };
  agingBuckets: Array<{ key: string; label: string; amount: number }>;
  topCustomers: Array<{ customerName: string; moneyOnStreet: number; percentOfTotal: number }>;
  rows: InvestedCapitalRecoveryRow[];
};

const STATUS_META: Record<InvestedCapitalRecoveryStatus, { label: string; className: string }> = {
  SEM_RECUPERACAO: { label: "Sem recuperação", className: "bg-red-100 text-red-800" },
  EM_RECUPERACAO: { label: "Em recuperação", className: "bg-amber-100 text-amber-800" },
  CAPITAL_RECUPERADO: { label: "Capital recuperado", className: "bg-emerald-100 text-emerald-800" },
  DADOS_INSUFICIENTES: { label: "Dados insuficientes", className: "bg-zinc-200 text-zinc-700" },
};

function StatusBadge({ status }: { status: InvestedCapitalRecoveryStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}

function money(value: number | null): string {
  if (value == null) return "—";
  return formatFinanceCurrency(value);
}

function KpiCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "in" | "out" | "neutral" }) {
  const toneClass =
    tone === "in"
      ? "border-emerald-200 text-emerald-800"
      : tone === "out"
        ? "border-red-200 text-red-800"
        : "border-border text-foreground";
  return (
    <div className={cn("rounded-lg border bg-card px-3 py-2.5 shadow-sm", toneClass)}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

const PAGE_SIZE = 25;

export function InvestedCapitalRecoveryPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvestedCapitalRecoveryStatus | "">("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<keyof InvestedCapitalRecoveryRow>("moneyOnStreet");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [data, setData] = useState<InvestedCapitalRecoveryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      const res = await fetch(`/api/finance/invested-capital-recovery?${params.toString()}`, {
        credentials: "include",
      });
      const json = (await res.json()) as InvestedCapitalRecoveryPayload | { ok: false; message?: string };
      if (!res.ok || json.ok !== true) {
        throw new Error("message" in json ? (json.message ?? "Erro ao carregar dados.") : "Erro ao carregar dados.");
      }
      setData(json);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar Recuperação do Dinheiro Investido.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return statusFilter ? data.rows.filter((r) => r.status === statusFilter) : data.rows;
  }, [data, statusFilter]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
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
  }, [filteredRows, sortKey, sortDir]);

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

  return (
    <div className="flex flex-col gap-3" data-testid="invested-capital-recovery-page">
      <div>
        <h1 className="text-lg font-bold text-foreground">Recuperação do Dinheiro Investido</h1>
        <p className="text-sm text-muted-foreground">
          Quanto do capital aplicado nos pedidos já retornou e quanto ainda está na rua.
        </p>
        <p className="mt-1 rounded-md border border-dashed border-border/60 bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          Fonte oficial: motor de Pedido de Venda (custo industrial oficial + Contas a Receber reais).
          Esta tela apenas consolida dados oficiais — não cria títulos, não dá baixa, não altera o Pedido.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Data do Pedido (de)</span>
            <input
              type="date"
              className="block h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Data do Pedido (até)</span>
            <input
              type="date"
              className="block h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <label className="min-w-[12rem] space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Buscar (PV ou cliente)</span>
            <input
              type="text"
              className="block h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="PD 1234 ou nome do cliente"
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Status econômico</span>
            <select
              className="block h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as InvestedCapitalRecoveryStatus | "")}
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
            onClick={() => void load()}
            className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-semibold hover:bg-muted/40"
          >
            Pesquisar
          </button>
        </div>
      </section>

      {loading ? (
        <FinanceModulePageLoading label="Carregando Recuperação do Dinheiro Investido…" />
      ) : error ? (
        <FinanceModuleErrorBanner message={error} onRetry={() => void load()} />
      ) : !data || data.rows.length === 0 ? (
        <FinanceModuleEmptyState />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Dinheiro na Rua Hoje" value={money(data.kpis.moneyOnStreetToday)} tone="out" />
            <KpiCard label="Capital Recuperado" value={money(data.kpis.capitalRecoveredTotal)} tone="in" />
            <KpiCard label="Capital Total Analisado" value={money(data.kpis.investedCapitalAnalyzedTotal)} />
            <KpiCard label="Total a Receber" value={money(data.kpis.totalOutstandingReceivable)} />
            <KpiCard label="Recuperaram capital" value={String(data.kpis.ordersFullyRecoveredCount)} />
            <KpiCard label="Parcialmente recuperados" value={String(data.kpis.ordersPartiallyRecoveredCount)} />
            <KpiCard label="Dados insuficientes" value={String(data.kpis.ordersInsufficientDataCount)} />
            <KpiCard
              label="Prazo médio realizado"
              value={
                data.kpis.averageDaysToRecoverCapital == null
                  ? "—"
                  : `${data.kpis.averageDaysToRecoverCapital} dias`
              }
            />
          </div>

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

          <section className="rounded-lg border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="invested-capital-recovery-table">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-2 py-1.5">PV</th>
                    <th className="px-2 py-1.5">Cliente</th>
                    <th className="px-2 py-1.5">Vendedor</th>
                    <th className="px-2 py-1.5 text-right cursor-pointer" onClick={() => toggleSort("saleValue")}>
                      Venda
                    </th>
                    <th
                      className="px-2 py-1.5 text-right cursor-pointer"
                      onClick={() => toggleSort("investedCapital")}
                    >
                      Capital Investido
                    </th>
                    <th className="px-2 py-1.5 text-right">Recebido</th>
                    <th className="px-2 py-1.5 text-right">Capital Recuperado</th>
                    <th
                      className="px-2 py-1.5 text-right cursor-pointer"
                      onClick={() => toggleSort("moneyOnStreet")}
                    >
                      Dinheiro na Rua
                    </th>
                    <th className="px-2 py-1.5 text-right">A Receber</th>
                    <th className="px-2 py-1.5 text-right">% Recuperado</th>
                    <th className="px-2 py-1.5">Pagou-se em</th>
                    <th className="px-2 py-1.5">Prev. recuperação</th>
                    <th className="px-2 py-1.5">Status Econômico</th>
                    <th className="px-2 py-1.5">Situação</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.salesOrderId} className="border-b border-border/50">
                      <td className="px-2 py-1.5 font-medium">{row.orderCode}</td>
                      <td className="px-2 py-1.5">{row.customerName ?? "—"}</td>
                      <td className="px-2 py-1.5">{row.sellerName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(row.saleValue)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {row.investedCapital == null ? (
                          <span title={row.investedCapitalUnavailableReason ?? undefined}>—</span>
                        ) : (
                          money(row.investedCapital)
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(row.actualReceived)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(row.capitalRecovered)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-red-700">
                        {money(row.moneyOnStreet)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(row.outstandingReceivable)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {row.recoveryPercent == null ? "—" : `${row.recoveryPercent.toFixed(0)}%`}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {row.capitalRecoveryDate ? formatFinanceDate(row.capitalRecoveryDate) : "—"}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {row.forecastCapitalRecoveryDate
                          ? formatFinanceDate(row.forecastCapitalRecoveryDate)
                          : "Sem cobertura prevista"}
                      </td>
                      <td className="px-2 py-1.5">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-2 py-1.5">{row.orderStatusLabel}</td>
                      <td className="px-2 py-1.5">
                        <a
                          href={`/sales-orders/${row.salesOrderId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-primary underline"
                        >
                          Abrir PV
                        </a>
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
    </div>
  );
}
