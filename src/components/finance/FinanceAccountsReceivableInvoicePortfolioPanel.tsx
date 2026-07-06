import React from "react";
import { FileCheck, FileQuestion } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { FinanceArDashboardPayload } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";

export function FinanceArInvoicePortfolioPanel({
  cards,
  activeFilter,
  loading,
  onFilterInvoiceIssued,
}: {
  cards: FinanceArDashboardPayload["cards"] | undefined;
  activeFilter: string;
  loading: boolean;
  onFilterInvoiceIssued: (value: "all" | "yes" | "no") => void;
}) {
  if (loading && !cards) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Carregando segmentação por NF…
      </div>
    );
  }

  const withAmount = cards?.openWithInvoiceAmount ?? 0;
  const withoutAmount = cards?.openWithoutInvoiceAmount ?? 0;
  const withCount = cards?.openWithInvoiceCount ?? 0;
  const withoutCount = cards?.openWithoutInvoiceCount ?? 0;
  const preShare = cards?.preInvoiceShareOfOpenPercent ?? 0;

  return (
    <section className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Carteira por NF emitida
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 max-w-3xl">
          Títulos podem existir antes da expedição/NF no Nomus. Use os cartões abaixo para filtrar a
          carteira faturada (com NF vinculada) ou pré-NF (aguardando faturamento).
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PortfolioCard
          icon={FileCheck}
          title="Com NF emitida"
          subtitle="idNfe ou número de NF de origem preenchidos"
          count={withCount}
          amount={withAmount}
          overdueAmount={cards?.overdueWithInvoiceAmount ?? 0}
          active={activeFilter === "yes"}
          tone="primary"
          onClick={() => onFilterInvoiceIssued(activeFilter === "yes" ? "all" : "yes")}
        />
        <PortfolioCard
          icon={FileQuestion}
          title="Pré-NF (sem nota vinculada)"
          subtitle="Recebível antes da expedição — estado operacional esperado"
          count={withoutCount}
          amount={withoutAmount}
          overdueAmount={cards?.overdueWithoutInvoiceAmount ?? 0}
          extra={`${formatFinancePercent(preShare)} da carteira em aberto`}
          active={activeFilter === "no"}
          tone="amber"
          onClick={() => onFilterInvoiceIssued(activeFilter === "no" ? "all" : "no")}
        />
      </div>
    </section>
  );
}

function PortfolioCard({
  icon: Icon,
  title,
  subtitle,
  count,
  amount,
  overdueAmount,
  extra,
  active,
  tone,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  count: number;
  amount: number;
  overdueAmount: number;
  extra?: string;
  active: boolean;
  tone: "primary" | "amber";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-4 text-left transition-colors w-full",
        active
          ? tone === "primary"
            ? "border-primary bg-primary/5 ring-1 ring-primary/30"
            : "border-amber-500 bg-amber-50/80 ring-1 ring-amber-500/30"
          : "border-border bg-background/60 hover:bg-muted/40"
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "h-5 w-5 shrink-0 mt-0.5",
            tone === "primary" ? "text-primary" : "text-amber-700"
          )}
        />
        <div className="min-w-0 space-y-2 flex-1">
          <div>
            <p className="text-sm font-bold">{title}</p>
            <p className="text-[11px] text-muted-foreground leading-snug">{subtitle}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">Títulos: </span>
              <span className="font-semibold tabular-nums">{formatFinanceInteger(count)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Em aberto: </span>
              <span className="font-semibold tabular-nums">{formatFinanceCurrency(amount)}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Vencido: </span>
              <span className="font-semibold tabular-nums">{formatFinanceCurrency(overdueAmount)}</span>
            </div>
            {extra ? <p className="col-span-2 text-[11px] text-muted-foreground">{extra}</p> : null}
          </div>
          <p className="text-[10px] font-semibold text-primary">
            {active ? "Filtro ativo — clique para limpar" : "Clique para filtrar"}
          </p>
        </div>
      </div>
    </button>
  );
}
