import React from "react";
import { formatCurrency } from "@/src/lib/utils";
import type { CommissionsRecordsPayload } from "@/src/components/commissions/commissionsTypes";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { useCommissionsFetch } from "@/src/components/commissions/useCommissionsFetch";

type CommissionsRecordsPageProps = {
  title: string;
  description: string;
  apiPath: string;
  emptyTitle: string;
  emptyDescription: string;
  testId: string;
};

export function CommissionsRecordsPage({
  title,
  description,
  apiPath,
  emptyTitle,
  emptyDescription,
  testId,
}: CommissionsRecordsPageProps) {
  const url = `${apiPath}?page=1&pageSize=20`;
  const { data, loading, error, reload } = useCommissionsFetch<CommissionsRecordsPayload>(
    url,
    `Não foi possível carregar ${title.toLowerCase()}.`
  );

  return (
    <div className="space-y-4" data-testid={testId}>
      <CommissionsSectionIntro title={title} description={description} />

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading ? <CommissionsLoading /> : null}

      {!loading && !error && data ? (
        <>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>Total filtrado: {formatCurrency(data.totals.commissionAmount, 2)}</span>
            <span>Registros: {data.pagination.total}</span>
            <span>Tipo: {data.kind}</span>
          </div>

          {data.items.length === 0 ? (
            <CommissionsEmptyState title={emptyTitle} description={emptyDescription} />
          ) : (
            <CommissionsTableScroll>
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Pedido</th>
                  <th className="px-3 py-2 text-left font-medium">Pessoa</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Comissão</th>
                  <th className="px-3 py-2 text-right font-medium">Liberado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2">{row.orderCode ?? "—"}</td>
                    <td className="px-3 py-2">{row.commissionPersonName}</td>
                    <td className="px-3 py-2">{row.status}</td>
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
        </>
      ) : null}
    </div>
  );
}
