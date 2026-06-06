import React from "react";
import { Loader2, RefreshCw, ShoppingCart, Receipt } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { EXECUTIVE_DASHBOARD_MIN_YEAR } from "@/src/lib/executiveDashboardYear";
import type { ExecutiveDashboardSummary } from "@/src/lib/executiveDashboardTypes";
import { ExecutiveSalesOrdersTab } from "@/src/components/dashboard/ExecutiveSalesOrdersTab";
import { ExecutiveBillingTab } from "@/src/components/dashboard/ExecutiveBillingTab";

type Props = {
  data: ExecutiveDashboardSummary | null;
  loading: boolean;
  error: string | null;
  selectedYear: number;
  onYearChange: (year: number) => void;
  onRefresh: () => void;
};

type InnerTab = "salesOrders" | "billing";

function buildYearOptions(now = new Date()): number[] {
  const max = now.getFullYear() + 1;
  const years: number[] = [];
  for (let y = max; y >= EXECUTIVE_DASHBOARD_MIN_YEAR; y -= 1) {
    years.push(y);
  }
  return years;
}

export function ExecutiveDashboardPanel({
  data,
  loading,
  error,
  selectedYear,
  onYearChange,
  onRefresh,
}: Props) {
  const [innerTab, setInnerTab] = React.useState<InnerTab>("salesOrders");
  const yearOptions = React.useMemo(() => buildYearOptions(), []);

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">Carregando painel gerencial…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
        <h3 className="text-lg font-semibold">Não foi possível carregar o painel gerencial</h3>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!data) return null;

  const updatedAt = new Date(data.generatedAt).toLocaleString("pt-BR");
  const salesTab = data.tabs.salesOrders;
  const billingTab = data.tabs.billing;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight">Painel Gerencial</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Análise {data.selectedYear} vs {data.previousYear} · Atualizado em {updatedAt}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
            <span className="text-muted-foreground">Ano</span>
            <select
              value={selectedYear}
              onChange={(e) => onYearChange(Number(e.target.value))}
              className="bg-transparent font-semibold outline-none"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent/50 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          Falha ao atualizar — exibindo última carga bem-sucedida.
        </div>
      ) : null}

      {data.unavailableIndicators.length > 0 && !salesTab && !billingTab ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{data.unavailableIndicators.join(" ")}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 border-b border-border pb-1">
            <button
              type="button"
              onClick={() => setInnerTab("salesOrders")}
              className={cn(
                "inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors",
                innerTab === "salesOrders"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ShoppingCart className="h-4 w-4" />
              Pedidos de Venda
            </button>
            <button
              type="button"
              onClick={() => setInnerTab("billing")}
              className={cn(
                "inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors",
                innerTab === "billing"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Receipt className="h-4 w-4" />
              Faturamento
            </button>
          </div>

          {innerTab === "salesOrders" && salesTab?.available ? (
            <ExecutiveSalesOrdersTab tab={salesTab} />
          ) : null}

          {innerTab === "billing" && billingTab?.available ? (
            <ExecutiveBillingTab tab={billingTab} />
          ) : null}

          {innerTab === "salesOrders" && !salesTab?.available ? (
            <p className="text-sm text-muted-foreground">
              {salesTab?.unavailableReason ?? "Aba indisponível para seu perfil."}
            </p>
          ) : null}

          {innerTab === "billing" && !billingTab?.available ? (
            <p className="text-sm text-muted-foreground">
              {billingTab?.unavailableReason ?? "Aba indisponível para seu perfil."}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
