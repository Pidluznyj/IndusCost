import React from "react";
import { formatCurrency } from "@/src/lib/utils";
import type { CommissionsDashboardPayload } from "@/src/components/commissions/commissionsTypes";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsSummaryGrid,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { useCommissionsFetch } from "@/src/components/commissions/useCommissionsFetch";

function hasDashboardActivity(data: CommissionsDashboardPayload): boolean {
  const c = data.cards;
  return (
    c.forecastAmount > 0 ||
    c.confirmedAmount > 0 ||
    c.releasedAmount > 0 ||
    c.paidAmount > 0 ||
    data.monthlySeries.length > 0 ||
    data.byPerson.length > 0 ||
    data.byStatus.length > 0 ||
    data.topCustomers.length > 0 ||
    data.auditSummary.total > 0
  );
}

export function CommissionsDashboardPage() {
  const { data, loading, error, reload } = useCommissionsFetch<CommissionsDashboardPayload>(
    "/api/commissions/dashboard",
    "Não foi possível carregar o dashboard de comissões."
  );

  return (
    <div className="space-y-4">
      <CommissionsSectionIntro
        title="Dashboard executivo"
        description="Visão consolidada de comissões previstas, confirmadas, liberadas e pagas."
        testId="commissions-dashboard-intro"
      />

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading ? <CommissionsLoading label="Carregando dashboard…" /> : null}

      {!loading && !error && data ? (
        <>
          <CommissionsSummaryGrid
            items={[
              { label: "Comissão prevista", value: formatCurrency(data.cards.forecastAmount, 2) },
              { label: "Comissão confirmada", value: formatCurrency(data.cards.confirmedAmount, 2) },
              { label: "Aguardando NF-e", value: formatCurrency(data.cards.waitingNfeAmount, 2) },
              {
                label: "Aguardando recebimento",
                value: formatCurrency(data.cards.waitingReceivableAmount, 2),
              },
              { label: "Liberada", value: formatCurrency(data.cards.releasedAmount, 2) },
              { label: "Paga", value: formatCurrency(data.cards.paidAmount, 2) },
              { label: "Saldo a pagar", value: formatCurrency(data.cards.balanceToPayAmount, 2) },
              {
                label: "Divergências críticas",
                value: String(data.cards.criticalDivergencesCount),
                hint: `${data.auditSummary.unresolved} issue(s) em aberto`,
              },
            ]}
          />

          {!hasDashboardActivity(data) ? (
            <CommissionsEmptyState
              title="Sem movimentação de comissões"
              description="Não há registros calculados no período. Execute um recálculo ou aguarde a sincronização dos pedidos."
              testId="commissions-dashboard-empty"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Por status</h3>
                {data.byStatus.length === 0 ? (
                  <CommissionsEmptyState description="Nenhum agrupamento por status." />
                ) : (
                  <CommissionsTableScroll>
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-right font-medium">Qtd</th>
                        <th className="px-3 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {data.byStatus.map((row) => (
                        <tr key={row.status}>
                          <td className="px-3 py-2">{row.status}</td>
                          <td className="px-3 py-2 text-right">{row.count}</td>
                          <td className="px-3 py-2 text-right">
                            {formatCurrency(row.commissionAmount, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </CommissionsTableScroll>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Top comissionados</h3>
                {data.byPerson.length === 0 ? (
                  <CommissionsEmptyState description="Nenhum comissionado com valor no período." />
                ) : (
                  <CommissionsTableScroll>
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Pessoa</th>
                        <th className="px-3 py-2 text-right font-medium">Comissão</th>
                        <th className="px-3 py-2 text-right font-medium">Liberado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {data.byPerson.map((row) => (
                        <tr key={row.commissionPersonId}>
                          <td className="px-3 py-2">{row.personName}</td>
                          <td className="px-3 py-2 text-right">
                            {formatCurrency(row.commissionAmount, 2)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatCurrency(row.releasedAmount, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </CommissionsTableScroll>
                )}
              </section>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
