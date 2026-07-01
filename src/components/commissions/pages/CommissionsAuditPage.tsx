import React from "react";
import type { CommissionsAuditPayload } from "@/src/components/commissions/commissionsTypes";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { useCommissionsFetch } from "@/src/components/commissions/useCommissionsFetch";

export function CommissionsAuditPage() {
  const { data, loading, error, reload } = useCommissionsFetch<CommissionsAuditPayload>(
    "/api/commissions/audit?page=1&pageSize=20",
    "Não foi possível carregar auditoria de comissões."
  );

  return (
    <div className="space-y-4" data-testid="commissions-audit-page">
      <CommissionsSectionIntro
        title="Auditoria"
        description="Divergências e alertas detectados durante o cálculo e liberação de comissões."
      />

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading ? <CommissionsLoading /> : null}

      {!loading && !error && data ? (
        data.items.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma issue de auditoria"
            description="Não há divergências registradas. Issues são criadas automaticamente durante o cálculo."
          />
        ) : (
          <CommissionsTableScroll>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Severidade</th>
                <th className="px-3 py-2 text-left font-medium">Tipo</th>
                <th className="px-3 py-2 text-left font-medium">Mensagem</th>
                <th className="px-3 py-2 text-left font-medium">Entidade</th>
                <th className="px-3 py-2 text-left font-medium">Resolvido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">{row.severity}</td>
                  <td className="px-3 py-2">{row.type}</td>
                  <td className="px-3 py-2 max-w-md truncate" title={row.message}>
                    {row.message}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.entityType}
                    {row.entityId ? ` / ${row.entityId}` : ""}
                  </td>
                  <td className="px-3 py-2">{row.resolved ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </CommissionsTableScroll>
        )
      ) : null}
    </div>
  );
}
