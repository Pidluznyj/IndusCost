import React from "react";
import type { CommissionsSettingsPayload } from "@/src/components/commissions/commissionsTypes";
import {
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsSummaryGrid,
} from "@/src/components/commissions/commissionsUi";
import { useCommissionsFetch } from "@/src/components/commissions/useCommissionsFetch";

const RELEASE_RULE_LABELS: Record<string, string> = {
  SALES_ORDER_CREATED: "Na criação do pedido",
  OUTPUT_DOCUMENT_CREATED: "No documento de saída",
  FIRST_RECEIVABLE_PAID: "No primeiro recebimento",
  EACH_RECEIVABLE_PAID: "A cada recebimento",
};

export function CommissionsSettingsPage() {
  const { data, loading, error, reload } = useCommissionsFetch<CommissionsSettingsPayload>(
    "/api/commissions/settings",
    "Não foi possível carregar configurações de comissões."
  );

  return (
    <div className="space-y-4" data-testid="commissions-settings-page">
      <CommissionsSectionIntro
        title="Configurações"
        description="Parâmetros globais do módulo de comissões. Alterações avançadas serão disponibilizadas nesta tela."
      />

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading ? <CommissionsLoading label="Carregando configurações…" /> : null}

      {!loading && !error && data ? (
        <CommissionsSummaryGrid
          items={[
            {
              label: "Regra padrão de liberação",
              value: RELEASE_RULE_LABELS[data.releaseDefaultRule] ?? data.releaseDefaultRule,
            },
            {
              label: "Previsão habilitada",
              value: data.forecastEnabled ? "Sim" : "Não",
            },
            {
              label: "Documento de saída substitui previsão",
              value: data.outputDocumentSupersedesForecast ? "Sim" : "Não",
            },
            {
              label: "Bloquear alteração de comissão paga",
              value: data.paidCommissionBlockAutoChange ? "Sim" : "Não",
            },
          ]}
        />
      ) : null}
    </div>
  );
}
