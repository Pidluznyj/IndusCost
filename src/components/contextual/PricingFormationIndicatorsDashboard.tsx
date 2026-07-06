import React, { useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type { PricingRow } from "@/src/lib/pricingFormationIndicatorsStats";
import { pricingFormationRollup } from "@/src/lib/pricingFormationIndicatorsStats";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";

export function PricingFormationIndicatorsDashboard() {
  const [rows, setRows] = useState<PricingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJsonOk("/api/pricing");
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar formação de preço.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const roll = useMemo(() => (rows ? pricingFormationRollup(rows) : null), [rows]);

  if (error) {
    return (
      <ContextualDashboardLayout moduleLabel="Formação de preço — indicadores" backPath="/pricing">
        <p className="text-sm text-destructive">{error}</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows === null) {
    return (
      <ContextualDashboardLayout moduleLabel="Formação de preço — indicadores" backPath="/pricing">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </ContextualDashboardLayout>
    );
  }

  if (rows.length === 0) {
    return (
      <ContextualDashboardLayout moduleLabel="Formação de preço — indicadores" backPath="/pricing">
        <ContextualDashboardEmpty message="Não há premissas de formação de preço cadastradas." />
      </ContextualDashboardLayout>
    );
  }

  return (
    <ContextualDashboardLayout moduleLabel="Formação de preço — indicadores" backPath="/pricing">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Cobertura de premissas</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Contagens sobre vínculos produto × regra fiscal (GET /api/pricing). Não recalcula preços.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ContextualDashboardKpiCard label="Premissas cadastradas" value={String(roll!.premissas)} />
        <ContextualDashboardKpiCard label="Produtos com premissa" value={String(roll!.produtosDistintos)} />
        <ContextualDashboardKpiCard label="Regras fiscais usadas" value={String(roll!.regrasFiscaisDistintas)} />
      </div>
    </ContextualDashboardLayout>
  );
}
