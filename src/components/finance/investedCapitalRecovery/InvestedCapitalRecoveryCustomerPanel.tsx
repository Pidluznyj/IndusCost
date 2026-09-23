/**
 * Visão Por Cliente da Recuperação do Dinheiro Investido.
 * Só apresenta o agregado já calculado no backend a partir do snapshot por pedido.
 */
import React, { useMemo, useState } from "react";
import { formatFinanceCurrency, formatFinanceCurrencyCompact, formatFinanceDate } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";
import type {
  InvestedCapitalRecoveryByCustomer,
  InvestedCapitalRecoveryCustomerChartPoint,
  InvestedCapitalRecoveryCustomerRow,
  InvestedCapitalRecoveryRow,
  InvestedCapitalRecoveryStatus,
} from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

const STATUS_META: Record<InvestedCapitalRecoveryStatus, { label: string; dotClass: string }> = {
  SEM_RECUPERACAO: { label: "Sem recuperação", dotClass: "bg-rose-500 shadow-rose-200" },
  EM_RECUPERACAO: { label: "Em recuperação", dotClass: "bg-amber-500 shadow-amber-200" },
  CAPITAL_RECUPERADO: { label: "Capital recuperado", dotClass: "bg-emerald-500 shadow-emerald-200" },
  DADOS_INSUFICIENTES: { label: "Dados insuficientes", dotClass: "bg-zinc-400 shadow-zinc-200" },
};

const PAGE_SIZE = 25;

type SortKey =
  | "customerName"
  | "orders"
  | "invoiced"
  | "investedCapital"
  | "received"
  | "recoveredCapital"
  | "capitalAtRisk"
  | "realizedGain"
  | "potentialResult";

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceCurrency(value);
}

function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceCurrencyCompact(value);
}

function percentLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function KpiCard({
  label,
  value,
  title,
  tone = "neutral",
}: {
  label: string;
  value: string;
  title: string;
  tone?: "in" | "out" | "neutral";
}) {
  const toneClass =
    tone === "in"
      ? "border-emerald-200 text-emerald-800"
      : tone === "out"
        ? "border-red-200 text-red-800"
        : "border-border text-foreground";
  return (
    <div className={cn("rounded-lg border bg-card px-3 py-2.5 shadow-sm", toneClass)} title={title}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="opacity-30 text-[10px] ml-0.5">↕</span>;
  return <span className="text-sky-300 text-[10px] ml-0.5">{dir === "asc" ? "▲" : "▼"}</span>;
}

function HorizontalBars({
  title,
  points,
  barClass,
  empty,
}: {
  title: string;
  points: InvestedCapitalRecoveryCustomerChartPoint[];
  barClass: string;
  empty: string;
}) {
  const max = Math.max(1, ...points.map((point) => point.amount));
  return (
    <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      {points.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {points.map((point) => (
            <div key={point.customerKey} className="flex items-center gap-2 text-xs">
              <span className="w-40 shrink-0 truncate text-muted-foreground" title={point.customerName}>
                {point.customerName}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  className={cn("h-full rounded", barClass)}
                  style={{ width: `${Math.round((point.amount / max) * 100)}%` }}
                />
              </div>
              <span className="w-28 shrink-0 text-right tabular-nums font-medium">{money(point.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function compareCustomer(
  a: InvestedCapitalRecoveryCustomerRow,
  b: InvestedCapitalRecoveryCustomerRow,
  key: SortKey
): number {
  if (key === "customerName") return a.customerName.localeCompare(b.customerName, "pt-BR");
  const av = a[key];
  const bv = b[key];
  const an = typeof av === "number" ? av : av == null ? -Infinity : Number(av);
  const bn = typeof bv === "number" ? bv : bv == null ? -Infinity : Number(bv);
  return an - bn;
}

export function InvestedCapitalRecoveryCustomerPanel({
  byCustomer,
  rows,
  onOpenOrder,
}: {
  byCustomer: InvestedCapitalRecoveryByCustomer;
  rows: InvestedCapitalRecoveryRow[];
  onOpenOrder: (salesOrderId: string, orderCode: string | null) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("invoiced");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const next = [...byCustomer.customers];
    next.sort((a, b) => {
      const diff = compareCustomer(a, b, sortKey);
      return sortDir === "asc" ? diff : -diff;
    });
    return next;
  }, [byCustomer.customers, sortDir, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selected = byCustomer.customers.find((row) => row.customerKey === selectedKey) ?? null;
  const selectedOrders = useMemo(() => {
    if (!selected) return [];
    return rows.filter((row) =>
      selected.unidentified ? !row.customerId : row.customerId === selected.customerId
    );
  }, [rows, selected]);

  function toggleSort(key: SortKey) {
    setPage(1);
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "customerName" ? "asc" : "desc");
    }
  }

  const summary = byCustomer.summary;
  const full = (value: number | null | undefined) => money(value);

  return (
    <div className="flex flex-col gap-3" data-testid="invested-capital-recovery-customer-view">
      <p className="rounded-md border border-dashed border-border/60 bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        Fonte oficial: motor de Pedido de Venda (custo industrial oficial + Contas a Receber reais). A visão apenas
        consolida os dados oficiais por cliente. Operações com empresas do grupo não são consideradas nesta análise.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Clientes faturados" value={String(summary.invoicedCustomers)} title="Clientes do filtro com valor fiscal faturado maior que zero." />
        <KpiCard label="Pedidos" value={String(summary.orders)} title="Pedidos de venda considerados no filtro, os mesmos da visão geral." />
        <KpiCard label="Vendemos" value={compact(summary.sold)} title={full(summary.sold)} />
        <KpiCard label="Faturado" value={compact(summary.invoiced)} title={`Valor fiscal das NF-e do pedido. ${full(summary.invoiced)}`} />
        <KpiCard label="Custo industrial" value={compact(summary.industrialCost)} title={full(summary.industrialCost)} />
        <KpiCard label="Impostos" value={compact(summary.taxes)} title={`Imposto da margem comercial do pedido, já incluído no capital. ${full(summary.taxes)}`} />
        <KpiCard
          label="Capital investido"
          value={compact(summary.investedCapital)}
          title={`Custo industrial + imposto, na mesma regra da visão geral. ${full(summary.investedCapital)}`}
          tone="out"
        />
        <KpiCard label="Recebido" value={compact(summary.received)} title={`Contas a receber já baixadas, somadas por pedido. ${full(summary.received)}`} />
        <KpiCard
          label="Capital recuperado"
          value={compact(summary.recoveredCapital)}
          title={`Parte do recebimento que já cobriu o capital de cada pedido. ${full(summary.recoveredCapital)}`}
          tone="in"
        />
        <KpiCard
          label="Dinheiro na rua"
          value={compact(summary.capitalAtRisk)}
          title={`Capital investido que ainda não voltou, pedido a pedido. ${full(summary.capitalAtRisk)}`}
          tone="out"
        />
        <KpiCard
          label="Ganho realizado"
          value={compact(summary.realizedGain)}
          title={`Parcela dos recebimentos que já excedeu o capital de cada pedido. Não é recebido total menos capital total. ${full(summary.realizedGain)}`}
          tone="in"
        />
        <KpiCard
          label="Saldo econômico atual"
          value={compact(summary.potentialResult)}
          title={`Diferença entre o valor já faturado e o capital total investido nos pedidos considerados. Em pedidos parcialmente faturados, o valor pode ser negativo mesmo que o resultado final esperado da venda seja positivo. ${full(summary.potentialResult)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <HorizontalBars
          title="Top Clientes — Faturamento"
          points={byCustomer.charts.topInvoiced}
          barClass="bg-sky-500"
          empty="Nenhum cliente com faturamento no período."
        />
        <HorizontalBars
          title="Top Clientes — Ganho Realizado"
          points={byCustomer.charts.topRealizedGain}
          barClass="bg-emerald-500"
          empty="Nenhum cliente com ganho realizado no período."
        />
        <HorizontalBars
          title="Capital na Rua por Cliente"
          points={byCustomer.charts.topCapitalAtRisk}
          barClass="bg-red-400"
          empty="Nenhum cliente com capital na rua no período."
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="relative max-h-[600px] overflow-auto">
          <table className="relative w-full min-w-[1400px] border-collapse text-xs" data-testid="invested-capital-recovery-customer-table">
            <thead className="sticky top-0 z-20 bg-slate-900 text-white shadow-sm">
              <tr className="border-b border-slate-800 text-left text-[10px] font-semibold uppercase tracking-wide">
                <CustomerTh label="Cliente" sortKey="customerName" active={sortKey} dir={sortDir} onSort={toggleSort} sticky />
                <CustomerTh label="Pedidos" sortKey="orders" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <CustomerTh label="Vendido" sortKey="invoiced" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" disabled />
                <CustomerTh label="Faturado" sortKey="invoiced" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <CustomerTh label="Custo ind." sortKey="investedCapital" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" disabled />
                <CustomerTh label="Impostos" sortKey="investedCapital" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" disabled />
                <CustomerTh label="Cap. invest." sortKey="investedCapital" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" title="Custo industrial + imposto" />
                <CustomerTh label="Recebido" sortKey="received" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <CustomerTh label="Cap. recup." sortKey="recoveredCapital" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <CustomerTh label="Na rua" sortKey="capitalAtRisk" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <CustomerTh label="Ganho realiz." sortKey="realizedGain" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" title="Excedente do recebimento sobre o capital, pedido a pedido" />
                <CustomerTh label="Saldo atual" sortKey="potentialResult" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" title="Diferença entre o valor já faturado e o capital total investido nos pedidos considerados. Em pedidos parcialmente faturados, o valor pode ser negativo mesmo que o resultado final esperado da venda seja positivo." />
                <th className="sticky top-0 z-20 bg-slate-900 px-1.5 py-2 text-right whitespace-nowrap">% recup.</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={row.customerKey}
                  className="cursor-pointer border-b border-border/70 hover:bg-muted/40"
                  onClick={() => setSelectedKey(row.customerKey)}
                >
                  <td className="sticky left-0 z-10 bg-card px-1.5 py-1.5 font-medium" title={row.customerName}>
                    {row.customerName}
                    {row.insufficientDataOrders > 0 ? (
                      <span className="ml-1 text-[10px] text-muted-foreground" title="Pedidos sem custo industrial resolvido">
                        ({row.insufficientDataOrders} s/ custo)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{row.orders}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.sold)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums font-medium">{money(row.invoiced)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums text-muted-foreground">{money(row.industrialCost)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums text-muted-foreground">{money(row.taxes)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums font-semibold">{money(row.investedCapital)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.received)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums font-medium text-emerald-700">{money(row.recoveredCapital)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums font-bold text-rose-700">{money(row.capitalAtRisk)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums font-medium text-emerald-700">{money(row.realizedGain)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.potentialResult)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{percentLabel(row.recoveredPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>
            {sorted.length} cliente{sorted.length === 1 ? "" : "s"} no filtro
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded border border-border px-2 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>
              Página {safePage} de {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              className="rounded border border-border px-2 py-1 disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      </section>

      {selected ? (
        <CustomerOrdersDialog
          customer={selected}
          orders={selectedOrders}
          onClose={() => setSelectedKey(null)}
          onOpenOrder={onOpenOrder}
        />
      ) : null}
    </div>
  );
}

function CustomerTh({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
  sticky = false,
  title,
  disabled = false,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  sticky?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <th
      className={cn(
        "sticky top-0 z-20 bg-slate-900 px-1.5 py-2 whitespace-nowrap",
        align === "right" && "text-right",
        sticky && "left-0 z-30",
        !disabled && "cursor-pointer select-none"
      )}
      title={title}
      onClick={disabled ? undefined : () => onSort(sortKey)}
    >
      <div className={cn("flex items-center gap-0.5", align === "right" && "justify-end")}>
        {label}
        {disabled ? null : <SortIcon active={active === sortKey} dir={dir} />}
      </div>
    </th>
  );
}

function CustomerOrdersDialog({
  customer,
  orders,
  onClose,
  onOpenOrder,
}: {
  customer: InvestedCapitalRecoveryCustomerRow;
  orders: InvestedCapitalRecoveryRow[];
  onClose: () => void;
  onOpenOrder: (salesOrderId: string, orderCode: string | null) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="mt-6 w-full max-w-6xl rounded-xl border border-border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-foreground">{customer.customerName}</h2>
            <p className="text-xs text-muted-foreground">Pedidos que compõem este cliente no filtro atual.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs font-semibold">
            Fechar
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-5">
          <Mini label="Pedidos" value={String(customer.orders)} />
          <Mini label="Vendido" value={money(customer.sold)} />
          <Mini label="Faturado" value={money(customer.invoiced)} />
          <Mini label="Capital investido" value={money(customer.investedCapital)} />
          <Mini label="Recebido" value={money(customer.received)} />
          <Mini label="Capital recuperado" value={money(customer.recoveredCapital)} />
          <Mini label="Dinheiro na rua" value={money(customer.capitalAtRisk)} />
          <Mini label="Ganho realizado" value={money(customer.realizedGain)} />
          <Mini label="Saldo econômico atual" value={money(customer.potentialResult)} />
        </div>
        <div className="max-h-[50vh] overflow-auto px-4 pb-4">
          <table className="w-full min-w-[1100px] border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900 text-white">
              <tr className="text-left text-[10px] uppercase">
                {["PV", "Data", "Vendido", "Faturado", "Custo ind.", "Impostos", "Cap. invest.", "Recebido", "Cap. recup.", "Na rua", "Ganho", "Saldo atual", "Status"].map((label) => (
                  <th key={label} className="px-1.5 py-2 whitespace-nowrap">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((row) => (
                <tr key={row.salesOrderId} className="border-b border-border/70">
                  <td className="px-1.5 py-1.5">
                    <button
                      type="button"
                      className="font-semibold text-sky-800 underline-offset-2 hover:underline"
                      onClick={() => onOpenOrder(row.salesOrderId, row.orderCode)}
                    >
                      {row.orderCode}
                    </button>
                  </td>
                  <td className="px-1.5 py-1.5 whitespace-nowrap">{formatFinanceDate(row.issueDate)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.saleValue)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.invoicedValue ?? 0)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.industrialCost)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.totalTaxes)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.investedCapital)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.actualReceived)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.capitalRecovered)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.moneyOnStreet)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.realizedGain)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{money(row.potentialResult)}</td>
                  <td className="px-1.5 py-1.5 text-center" title={STATUS_META[row.status].label}>
                    <span className={cn("inline-block h-2.5 w-2.5 rounded-full", STATUS_META[row.status].dotClass)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
