import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  canManageFinanceDreMappings,
  canViewFinanceDre,
} from "@/src/lib/financeDrePermissions";
import {
  DRE_COST_CENTER_ROLE_LABELS,
  DRE_COST_CENTER_ROLES,
  type DreCostCenterRole,
} from "@/src/lib/financeDreCostCenterRoles";
import type { FinanceDreCostCenterMappingRow } from "@/src/lib/financeDreCostCenterMappingTypes";
import {
  FinanceModuleErrorBanner,
  FinanceModulePageLoading,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { financeBiCardClass, financeBiShellClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";

type MappingsResponse = {
  schemaVersion: 1;
  mappings: FinanceDreCostCenterMappingRow[];
  note?: string;
};

export function FinanceDreCostCenterMappingPage() {
  const { hasPermission } = useAuth();
  const canView = canViewFinanceDre({ hasPermission });
  const canManage = canManageFinanceDreMappings({ hasPermission });

  const [rows, setRows] = useState<FinanceDreCostCenterMappingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, DreCostCenterRole>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<MappingsResponse>("/api/finance/dre/cost-center-mappings");
      setRows(payload.mappings);
      const next: Record<string, DreCostCenterRole> = {};
      for (const row of payload.mappings) next[row.costCenterId] = row.role;
      setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar mapeamentos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  const dirtyCount = useMemo(() => {
    let n = 0;
    for (const row of rows) {
      if ((draft[row.costCenterId] ?? row.role) !== row.role) n += 1;
    }
    return n;
  }, [draft, rows]);

  const handleSave = async () => {
    if (!canManage || dirtyCount === 0) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const mappings = rows.map((row) => ({
        costCenterId: row.costCenterId,
        role: draft[row.costCenterId] ?? row.role,
      }));
      const payload = await fetchJsonOk<MappingsResponse>("/api/finance/dre/cost-center-mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      setRows(payload.mappings);
      const next: Record<string, DreCostCenterRole> = {};
      for (const row of payload.mappings) next[row.costCenterId] = row.role;
      setDraft(next);
      setSavedMsg("Mapeamentos salvos. A DRE usará os papéis na próxima atualização.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar mapeamentos.");
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return <UnauthorizedAccessGate forceDenied />;
  }

  return (
    <div className={cn(financeBiShellClass, "space-y-4")} data-testid="finance-dre-cc-mapping-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/finance/dre"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar à DRE
          </Link>
          <h1 className="text-xl font-bold tracking-tight">Parametrizar centros de custo na DRE</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Escolha o papel de cada centro de custo nas categorias da DRE (Fretes, Embalagens, Admin,
            Investimento sócios, etc.). Linhas baseadas em NF-e e CMV não são alteradas.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || dirtyCount === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
            data-testid="finance-dre-cc-mapping-save"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar {dirtyCount > 0 ? `(${dirtyCount})` : ""}
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">Somente leitura — sem permissão de gestão.</p>
        )}
      </div>

      {error ? <FinanceModuleErrorBanner message={error} /> : null}
      {savedMsg ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {savedMsg}
        </div>
      ) : null}

      {loading ? <FinanceModulePageLoading label="Carregando centros de custo…" /> : null}

      {!loading ? (
        <section className={cn(financeBiCardClass, "overflow-hidden")}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-accent/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-bold">Código</th>
                  <th className="px-3 py-2 font-bold">Centro de custo</th>
                  <th className="px-3 py-2 font-bold">Papel na DRE</th>
                  <th className="px-3 py-2 font-bold">Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                      Nenhum centro de custo ativo cadastrado.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.costCenterId} className="hover:bg-accent/20">
                      <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">
                        <select
                          className="h-9 w-full max-w-xs rounded-lg border border-border bg-background px-2 text-sm"
                          value={draft[row.costCenterId] ?? row.role}
                          disabled={!canManage || saving}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [row.costCenterId]: e.target.value as DreCostCenterRole,
                            }))
                          }
                          aria-label={`Papel DRE de ${row.code}`}
                        >
                          {DRE_COST_CENTER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {DRE_COST_CENTER_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.source === "MANUAL" ? "Manual" : "Seed (classificador)"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
