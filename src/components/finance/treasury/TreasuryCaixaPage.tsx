/**
 * Página — Caixa (Tesouraria).
 * Filtro Ano/(Mês)/(Dia) por vencimento → duas tabelas planas (CR e CP),
 * sem agrupar por banco, via motor oficial (financeAccountsReceivable/PayableRulesEngine).
 */

import React, { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchTreasuryCaixa, type TreasuryCaixaPayload } from "@/src/lib/treasury/treasuryCaixaApi.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import { cn } from "@/src/lib/utils";

const MONTH_OPTIONS = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
] as const;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

function TotalizerCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "receivable" | "payable" | "net" | "neutral";
}) {
  const toneClass =
    tone === "receivable"
      ? "border-[#A7F3D0] text-[#065F46]"
      : tone === "payable"
        ? "border-[#FECACA] text-[#991B1B]"
        : tone === "net"
          ? "border-[#BFDBFE] text-[#1E3A8A]"
          : "border-border text-foreground";
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 shadow-sm",
        toneClass
      )}
      data-testid={`caixa-card-${label}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-extrabold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}

export function TreasuryCaixaPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState<number | "">("");
  const [day, setDay] = useState<number | "">("");
  const [data, setData] = useState<TreasuryCaixaPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearOptions = useMemo(() => {
    const base = today.getFullYear();
    const out: number[] = [];
    for (let y = base - 3; y <= base + 3; y += 1) out.push(y);
    return out;
  }, [today]);

  const dayOptions = useMemo(() => {
    if (month === "") return [];
    const max = daysInMonth(year, month);
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [year, month]);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTreasuryCaixa({
        year,
        month: month === "" ? undefined : month,
        day: day === "" ? undefined : day,
      });
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar o caixa.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year, month, day]);

  function handleMonthChange(value: string) {
    setMonth(value === "" ? "" : Number(value));
    setDay("");
  }

  return (
    <FinanceBiDashboardShell>
      <div className="flex flex-col gap-3" data-testid="treasury-caixa-page">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title="Caixa"
          subtitle="Contas a pagar e a receber por vencimento — motor oficial, sem agrupar por banco."
          compact
          actions={[]}
        />

        <section
          className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm"
          data-testid="caixa-filters"
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-[6rem] space-y-0.5">
              <span className={financeModuleFilterLabelClass()}>Ano</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                data-testid="caixa-filter-year"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[9rem] space-y-0.5">
              <span className={financeModuleFilterLabelClass()}>Mês (opcional)</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={month}
                onChange={(e) => handleMonthChange(e.target.value)}
                data-testid="caixa-filter-month"
              >
                <option value="">Todos os meses</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-[6rem] space-y-0.5">
              <span className={financeModuleFilterLabelClass()}>Dia (opcional)</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={day}
                onChange={(e) =>
                  setDay(e.target.value === "" ? "" : Number(e.target.value))
                }
                disabled={month === ""}
                data-testid="caixa-filter-day"
              >
                <option value="">Todos os dias</option>
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void search()}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
              data-testid="caixa-search-button"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Pesquisar
            </button>
          </div>
        </section>

        {error ? (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TotalizerCard
                label="Total a Receber"
                value={formatMoney(data.totals.totalReceivable)}
                tone="receivable"
              />
              <TotalizerCard
                label="Total a Pagar"
                value={formatMoney(data.totals.totalPayable)}
                tone="payable"
              />
              <TotalizerCard
                label="Saldo Líquido"
                value={formatMoney(data.totals.netBalance)}
                tone="net"
              />
              <TotalizerCard
                label="Qtd. Títulos (CR / CP)"
                value={`${data.totals.receivableCount} / ${data.totals.payableCount}`}
              />
            </div>

            <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-foreground">
                Contas a Receber ({data.receivables.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="caixa-receivables-table">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-2 py-1.5">Vencimento</th>
                      <th className="px-2 py-1.5">Cliente</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.receivables.map((r) => (
                      <tr key={r.externalId} className="border-b border-border/50">
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatCivilDate(r.dueDate)}
                        </td>
                        <td className="px-2 py-1.5">{r.personName ?? "—"}</td>
                        <td className="px-2 py-1.5">{r.calculatedStatus}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {formatMoney(r.balanceReceivable)}
                        </td>
                      </tr>
                    ))}
                    {data.receivables.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-2 py-4 text-center text-muted-foreground"
                        >
                          Sem títulos no período.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-foreground">
                Contas a Pagar ({data.payables.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="caixa-payables-table">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-2 py-1.5">Vencimento</th>
                      <th className="px-2 py-1.5">Fornecedor</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payables.map((p) => (
                      <tr key={p.externalId} className="border-b border-border/50">
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatCivilDate(p.dueDate)}
                        </td>
                        <td className="px-2 py-1.5">{p.personName ?? "—"}</td>
                        <td className="px-2 py-1.5">{p.calculatedStatus}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {formatMoney(p.balancePayable)}
                        </td>
                      </tr>
                    ))}
                    {data.payables.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-2 py-4 text-center text-muted-foreground"
                        >
                          Sem títulos no período.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : !loading ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
            Selecione o período e clique em Pesquisar.
          </div>
        ) : null}
      </div>
    </FinanceBiDashboardShell>
  );
}
