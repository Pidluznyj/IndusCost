import React from "react";
import { formatCurrency } from "@/src/lib/utils";
import type { CommissionsPaymentBatchesPayload } from "@/src/components/commissions/commissionsTypes";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { useCommissionsFetch } from "@/src/components/commissions/useCommissionsFetch";

export function CommissionsPaymentsPage() {
  const { data, loading, error, reload } = useCommissionsFetch<CommissionsPaymentBatchesPayload>(
    "/api/commissions/payment-batches?page=1&pageSize=20",
    "Não foi possível carregar lotes de pagamento."
  );

  return (
    <div className="space-y-4" data-testid="commissions-payments-page">
      <CommissionsSectionIntro
        title="Pagamentos"
        description="Lotes de pagamento de comissões liberadas, com status de aprovação e quitação."
      />

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading ? <CommissionsLoading /> : null}

      {!loading && !error && data ? (
        data.items.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhum lote de pagamento"
            description="Crie um lote quando houver comissões liberadas disponíveis para pagamento."
          />
        ) : (
          <CommissionsTableScroll>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Pessoa</th>
                <th className="px-3 py-2 text-left font-medium">Período</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Selecionado</th>
                <th className="px-3 py-2 text-right font-medium">Pago</th>
                <th className="px-3 py-2 text-right font-medium">Itens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">{row.commissionPersonName}</td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(row.periodStart).toLocaleDateString("pt-BR")} –{" "}
                    {new Date(row.periodEnd).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(row.totalSelected, 2)}
                  </td>
                  <td className="px-3 py-2 text-right">{formatCurrency(row.totalPaid, 2)}</td>
                  <td className="px-3 py-2 text-right">{row.itemsCount}</td>
                </tr>
              ))}
            </tbody>
          </CommissionsTableScroll>
        )
      ) : null}
    </div>
  );
}
