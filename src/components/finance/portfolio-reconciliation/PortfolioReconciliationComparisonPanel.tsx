import { formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioReconciliationComparison } from "@/src/lib/financePortfolioReconciliationClient";

type Props = {
  comparison: PortfolioReconciliationComparison;
};

function money(n: number): string {
  return formatFinanceCurrencyCompact(n);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

/**
 * Seção simples: compara visão atual (CR rateado) com a nova conciliação.
 * Só renderiza — regras vêm do backend em `comparison`.
 */
export function PortfolioReconciliationComparisonPanel({ comparison }: Props) {
  const { currentView, reconciliationView, differences, orderBreakdown } = comparison;
  const topOrders = orderBreakdown
    .filter(
      (o) =>
        o.headerInflationRiskValue > 0 ||
        o.reviewValue > 0 ||
        o.orderOnlyValue > 0 ||
        o.invoicedWithoutReceivableValue > 0
    )
    .slice(0, 8);

  return (
    <section
      className="mb-4 space-y-3 rounded-lg border border-border bg-card p-3"
      data-testid="portfolio-reconciliation-comparison"
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          Comparativo com a visão atual
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          O que o financeiro já enxerga no CR rateado versus o que a conciliação
          projeta — sem usar cabeçalho de NF como carteira.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5 rounded-md border border-border/80 bg-muted/20 p-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Visão atual
          </h3>
          <Metric label="CR total rateado" value={money(currentView.officialReceivableTotalValue)} />
          <Metric label="CR recebido" value={money(currentView.officialReceivedValue)} />
          <Metric label="CR aberto" value={money(currentView.officialReceivableOpenValue)} />
          <Metric
            label="Títulos vencidos (CR)"
            value={money(currentView.officialOverdueReceivableValue)}
          />
          <Metric label="Pedidos (oficial)" value={money(currentView.officialOrderValue)} />
          <Metric
            label="Cabeçalhos NF (risco)"
            value={money(currentView.officialNfeHeaderValue)}
          />
          <p className="pt-1 text-[10px] leading-snug text-muted-foreground">
            {currentView.explanation}
          </p>
        </div>

        <div className="space-y-1.5 rounded-md border border-border/80 bg-muted/20 p-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Nova conciliação
          </h3>
          <Metric
            label="Saldo projetado"
            value={money(reconciliationView.projectedOpenBalance)}
          />
          <Metric
            label="Já virou CR"
            value={money(reconciliationView.receivableConfirmedValue)}
          />
          <Metric
            label="Faturado sem CR"
            value={money(reconciliationView.invoicedWithoutReceivableValue)}
          />
          <Metric
            label="Só pedido (confiável)"
            value={money(reconciliationView.orderOnlyValue)}
          />
          <Metric
            label="Só pedido em revisão"
            value={money(reconciliationView.orderOnlyReviewValue)}
          />
          <Metric
            label="Precisa revisar"
            value={`${reconciliationView.reviewRequiredOrders} ped. / ${reconciliationView.alertsCount} alertas`}
          />
          <p className="pt-1 text-[10px] leading-snug text-muted-foreground">
            {reconciliationView.explanation}
          </p>
        </div>

        <div className="space-y-1.5 rounded-md border border-amber-200/80 bg-amber-50/50 p-2.5 dark:bg-amber-950/20">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-100">
            Diferença encontrada
          </h3>
          <Metric
            label="Projetado − CR aberto"
            value={money(differences.receivableVsReconciledDifference)}
          />
          <Metric
            label="Fora do CR (ainda)"
            value={money(differences.invisibleToReceivableValue)}
          />
          <Metric
            label="Risco cabeçalho NF"
            value={money(differences.headerInflationRiskValue)}
          />
          <Metric
            label="Pedido em revisão"
            value={money(differences.orderOnlyReviewValue)}
          />
          <Metric
            label="Risco qualidade"
            value={money(differences.dataQualityRiskValue)}
          />
          <p className="pt-1 text-[10px] leading-snug text-muted-foreground">
            {differences.explanation}
          </p>
        </div>
      </div>

      {topOrders.length > 0 ? (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-foreground">
            Pedidos que explicam a diferença
          </h3>
          <ul className="space-y-1.5">
            {topOrders.map((o) => (
              <li
                key={o.orderCode}
                className="rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{o.orderCode}</span>
                  <span className="tabular-nums text-muted-foreground">
                    Pedido {money(o.orderValue)} · Projetado {money(o.projectedOpenBalance)}
                    {o.nfeHeaderValue > 0
                      ? ` · NF cabeçalho ${money(o.nfeHeaderValue)}`
                      : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {o.mainExplanation}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
