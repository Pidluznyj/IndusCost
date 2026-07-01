import React from "react";
import type { CommissionsRulesPayload } from "@/src/components/commissions/commissionsTypes";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { useCommissionsFetch } from "@/src/components/commissions/useCommissionsFetch";

export function CommissionsRulesPage() {
  const { data, loading, error, reload } = useCommissionsFetch<CommissionsRulesPayload>(
    "/api/commissions/rules?page=1&pageSize=50",
    "Não foi possível carregar regras de comissão."
  );

  return (
    <div className="space-y-4" data-testid="commissions-rules-page">
      <CommissionsSectionIntro
        title="Regras de comissão"
        description="Regras de percentual, base de cálculo, vigência e condições comerciais."
      />

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading ? <CommissionsLoading /> : null}

      {!loading && !error && data ? (
        data.items.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma regra cadastrada"
            description="Configure regras para calcular comissões de vendedores e representantes."
          />
        ) : (
          <CommissionsTableScroll>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Nome</th>
                <th className="px-3 py-2 text-left font-medium">Beneficiário</th>
                <th className="px-3 py-2 text-right font-medium">%</th>
                <th className="px-3 py-2 text-left font-medium">Base</th>
                <th className="px-3 py-2 text-right font-medium">Prioridade</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">{row.beneficiaryType}</td>
                  <td className="px-3 py-2 text-right">{row.ratePercent}%</td>
                  <td className="px-3 py-2">{row.baseType}</td>
                  <td className="px-3 py-2 text-right">{row.priority}</td>
                  <td className="px-3 py-2">{row.active ? "Ativa" : "Inativa"}</td>
                </tr>
              ))}
            </tbody>
          </CommissionsTableScroll>
        )
      ) : null}
    </div>
  );
}
