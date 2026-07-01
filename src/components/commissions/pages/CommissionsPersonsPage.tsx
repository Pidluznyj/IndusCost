import React from "react";
import type { CommissionsPersonsPayload } from "@/src/components/commissions/commissionsTypes";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { useCommissionsFetch } from "@/src/components/commissions/useCommissionsFetch";

export function CommissionsPersonsPage() {
  const { data, loading, error, reload } = useCommissionsFetch<CommissionsPersonsPayload>(
    "/api/commissions/persons?page=1&pageSize=50",
    "Não foi possível carregar pessoas comissionadas."
  );

  return (
    <div className="space-y-4" data-testid="commissions-persons-page">
      <CommissionsSectionIntro
        title="Pessoas comissionadas"
        description="Cadastro de vendedores, representantes e demais beneficiários de comissão."
      />

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading ? <CommissionsLoading /> : null}

      {!loading && !error && data ? (
        data.items.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma pessoa cadastrada"
            description="Cadastre pessoas comissionadas manualmente ou aguarde a resolução automática via cálculo."
          />
        ) : (
          <CommissionsTableScroll>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Nome</th>
                <th className="px-3 py-2 text-left font-medium">Tipo</th>
                <th className="px-3 py-2 text-left font-medium">Origem</th>
                <th className="px-3 py-2 text-left font-medium">Nomus ID</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">{row.type}</td>
                  <td className="px-3 py-2">{row.source}</td>
                  <td className="px-3 py-2">{row.nomusPersonId ?? "—"}</td>
                  <td className="px-3 py-2">{row.active ? "Ativo" : "Inativo"}</td>
                </tr>
              ))}
            </tbody>
          </CommissionsTableScroll>
        )
      ) : null}
    </div>
  );
}
