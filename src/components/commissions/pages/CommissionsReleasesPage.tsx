import React from "react";
import { formatCurrency } from "@/src/lib/utils";
import type { CommissionsReleasesPayload } from "@/src/components/commissions/commissionsTypes";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { useCommissionsFetch } from "@/src/components/commissions/useCommissionsFetch";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

export function CommissionsReleasesPage() {
  const { data, loading, error, reload } = useCommissionsFetch<CommissionsReleasesPayload>(
    "/api/commissions/releases?page=1&pageSize=20",
    "Não foi possível carregar liberações por recebimento."
  );

  return (
    <div className="space-y-4" data-testid="commissions-releases-page">
      <CommissionsSectionIntro
        title="Liberação por recebimento"
        description="Parcelas vinculadas a contas a receber com percentual recebido e comissão liberada proporcionalmente."
      />

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading ? <CommissionsLoading /> : null}

      {!loading && !error && data ? (
        data.items.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma parcela de liberação"
            description="Não há cronogramas de pagamento vinculados a contas a receber."
          />
        ) : (
          <CommissionsTableScroll>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Pessoa</th>
                <th className="px-3 py-2 text-left font-medium">Pedido</th>
                <th className="px-3 py-2 text-left font-medium">NF-e</th>
                <th className="px-3 py-2 text-left font-medium">Vencimento</th>
                <th className="px-3 py-2 text-right font-medium">Recebido</th>
                <th className="px-3 py-2 text-right font-medium">Comissão parcela</th>
                <th className="px-3 py-2 text-right font-medium">Liberada</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {data.items.map((row) => (
                <tr key={row.scheduleId}>
                  <td className="px-3 py-2">{row.commissionPersonName}</td>
                  <td className="px-3 py-2">{row.orderCode ?? "—"}</td>
                  <td className="px-3 py-2">{row.nfeNumber ?? "—"}</td>
                  <td className="px-3 py-2">{formatDate(row.dueDate)}</td>
                  <td className="px-3 py-2 text-right">
                    {row.receivedPercent != null ? `${row.receivedPercent}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(row.commissionParcelAmount, 2)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(row.commissionReleasedAmount, 2)}
                  </td>
                  <td className="px-3 py-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </CommissionsTableScroll>
        )
      ) : null}
    </div>
  );
}
