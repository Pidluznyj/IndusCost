import React, { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import type { CashBridgeLine, CashBridgeReport } from "@/src/lib/financeDreCashBridgeTypes";
import {
  cashBridgeBadgeLabel,
  formatCashBridgeAccountingMoney,
} from "@/src/lib/financeDreCashBridgeMath";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  FinanceModuleErrorBanner,
  FinanceModulePageLoading,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { cn } from "@/src/lib/utils";

type Props = {
  report: CashBridgeReport | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

function BridgeKpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "muted";
}) {
  return (
    <div className={cn(financeBiCardClass, "p-4")}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-xl font-semibold tabular-nums",
          tone === "positive" && "text-emerald-700",
          tone === "negative" && "text-rose-700",
          tone === "muted" && "text-muted-foreground"
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function badgeToneClass(badge: CashBridgeReport["badge"]): string {
  switch (badge) {
    case "reconciled":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "not_reconciled":
      return "border-rose-200 bg-rose-50 text-rose-900";
    default:
      return "border-amber-200 bg-amber-50 text-amber-950";
  }
}

function LineDetail({ line }: { line: CashBridgeLine }) {
  return (
    <div className="space-y-2 border-t border-border/60 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
      <p>
        <span className="font-semibold text-foreground">Critério: </span>
        {line.criteria}
      </p>
      <p>
        <span className="font-semibold text-foreground">Fontes: </span>
        {line.sources.length > 0 ? line.sources.join(" · ") : "—"}
      </p>
      <p>
        <span className="font-semibold text-foreground">Limitações: </span>
        {line.limitations.length > 0 ? line.limitations.join(" ") : "—"}
      </p>
      {line.missingReason ? (
        <p>
          <span className="font-semibold text-foreground">Motivo da ausência: </span>
          {line.missingReason}
        </p>
      ) : null}
      <p>
        <span className="font-semibold text-foreground">Última sync: </span>
        {line.lastSyncedAt
          ? new Date(line.lastSyncedAt).toLocaleString("pt-BR")
          : "—"}
      </p>
      <p>
        <span className="font-semibold text-foreground">Classificação: </span>
        {line.classification}
        {" · "}
        {line.includeInExplained ? "entra no explicado" : "fora do explicado"}
      </p>
    </div>
  );
}

export function FinanceDreCashBridgePanel({ report, loading, error, onRetry }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading && !report) {
    return <FinanceModulePageLoading label="Montando Ponte Lucro × Caixa…" />;
  }

  if (error && !report) {
    return (
      <div className="space-y-3">
        <FinanceModuleErrorBanner message={error} />
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!report) return null;

  const net = report.cards.netResult;
  const wc = report.cards.workingCapitalEffect;
  const invest = report.cards.investmentsPaid;
  const cash = report.cards.actualCashVariation;

  return (
    <div className="space-y-4" data-testid="finance-dre-cash-bridge-panel">
      {error ? <FinanceModuleErrorBanner message={error} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{report.title}</h2>
          <p className="text-xs text-muted-foreground">{report.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold",
              badgeToneClass(report.badge)
            )}
            data-testid="finance-dre-cash-bridge-badge"
          >
            {cashBridgeBadgeLabel(report.badge)}
          </span>
          <span className="inline-flex rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            Implementação parcial
          </span>
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Atualizar ponte
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BridgeKpiCard
          label={net != null && net < 0 ? "Prejuízo (DRE)" : "Lucro (DRE)"}
          value={formatFinanceKpiCurrency(net)}
          hint="Lucro líquido aproximado do mês destaque"
          tone={net == null ? "muted" : net >= 0 ? "positive" : "negative"}
        />
        <BridgeKpiCard
          label="Capital de giro"
          value={wc == null ? "Indisponível" : formatFinanceKpiCurrency(wc)}
          hint="Δ CR + estoque + fornecedores (as-of)"
          tone={wc == null ? "muted" : "default"}
        />
        <BridgeKpiCard
          label="Investimentos pagos"
          value={invest == null ? "Indisponível" : formatFinanceKpiCurrency(invest)}
          hint="Proxy parcial — sem evidência as-of na v1"
          tone={invest == null ? "muted" : "default"}
        />
        <BridgeKpiCard
          label="Variação do caixa"
          value={cash == null ? "Variação do caixa indisponível" : formatFinanceKpiCurrency(cash)}
          hint="Sem saldo bancário histórico"
          tone="muted"
        />
      </div>

      {report.warnings.length > 0 ? (
        <div className="space-y-2">
          {report.warnings.map((w) => (
            <div
              key={w.code}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                w.severity === "critical"
                  ? "border-rose-200 bg-rose-50 text-rose-950"
                  : w.severity === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-950"
                    : "border-border bg-muted/40 text-foreground"
              )}
            >
              {w.message}
            </div>
          ))}
        </div>
      ) : null}

      <section className={cn(financeBiCardClass, "overflow-hidden")}>
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Tabela da ponte</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Valores ausentes exibem “—” (nunca zero inventado). Negativos entre parênteses.
          </p>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-3 py-2">Linha</th>
                <th className="px-3 py-2 text-right">Abertura</th>
                <th className="px-3 py-2 text-right">Fechamento</th>
                <th className="px-3 py-2 text-right">Efeito caixa</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((line) => {
                const open = expandedId === line.id;
                return (
                  <React.Fragment key={line.id}>
                    <tr
                      className="cursor-pointer border-b border-border/70 hover:bg-accent/40"
                      onClick={() => setExpandedId(open ? null : line.id)}
                      data-testid={`finance-dre-cash-bridge-line-${line.id}`}
                    >
                      <td className="px-3 py-2 font-medium text-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          {line.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCashBridgeAccountingMoney(line.openingBalance)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCashBridgeAccountingMoney(line.closingBalance)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {formatCashBridgeAccountingMoney(line.cashEffect)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {line.classification}
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <LineDetail line={line} />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 border-t border-border px-4 py-3 text-xs sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Explicado: </span>
            <span className="font-semibold tabular-nums">
              {formatCashBridgeAccountingMoney(report.explainedCashVariation)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Caixa real: </span>
            <span className="font-semibold tabular-nums">
              {formatCashBridgeAccountingMoney(report.actualCashVariation)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Residual: </span>
            <span className="font-semibold tabular-nums">
              {formatCashBridgeAccountingMoney(report.residual)}
            </span>
          </div>
        </div>
      </section>

      <section className={cn(financeBiCardClass, "p-4")}>
        <h3 className="text-sm font-semibold text-foreground">Explicação automática</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{report.explanation}</p>
      </section>

      <section className={cn(financeBiCardClass, "p-4")} data-testid="finance-dre-cash-bridge-annex">
        <h3 className="text-sm font-semibold text-foreground">
          Anexo — movimentos do período (não patrimonial)
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {report.periodCashMovementsReference.note}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <BridgeKpiCard
            label="Recebimentos (AR)"
            value={formatCashBridgeAccountingMoney(
              report.periodCashMovementsReference.receivablesCollected
            )}
            tone="muted"
          />
          <BridgeKpiCard
            label="Pagamentos (AP)"
            value={formatCashBridgeAccountingMoney(
              report.periodCashMovementsReference.payablesPaid
            )}
            tone="muted"
          />
          <BridgeKpiCard
            label="Líquido movimentos"
            value={formatCashBridgeAccountingMoney(
              report.periodCashMovementsReference.netMovements
            )}
            tone="muted"
          />
        </div>
        {report.periodCashMovementsReference.missingReason ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {report.periodCashMovementsReference.missingReason}
          </p>
        ) : null}
      </section>

      <section className={cn(financeBiCardClass, "p-4")}>
        <h3 className="text-sm font-semibold text-foreground">Matriz de cobertura</h3>
        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase text-muted-foreground">
                <th className="py-2 pr-3">Componente</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Fonte</th>
                <th className="py-2">Limitação</th>
              </tr>
            </thead>
            <tbody>
              {report.coverage.map((row) => (
                <tr key={row.componentId} className="border-b border-border/70 align-top">
                  <td className="py-2 pr-3 font-medium">{row.label}</td>
                  <td className="py-2 pr-3 text-xs uppercase text-muted-foreground">
                    {row.status}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{row.sourceLabel}</td>
                  <td className="py-2 text-xs text-muted-foreground">{row.limitation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
