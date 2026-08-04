/**
 * Modal "Parametrizar centros" — DRE Gerencial.
 *
 * Mostra a estrutura da DRE por ETAPA (papel do centro de custo), sem
 * valores, com os CCs que estão em cada uma; do lado direito, a lista
 * completa de CCs para reatribuir. Reaproveita a MESMA API/dado da página
 * cheia (`/finance/dre/parametrizacao`, ainda acessível por link direto) —
 * é só uma apresentação diferente sobre o mesmo mapeamento 1 CC → 1 papel.
 *
 * Sem rateio: hoje um CC vale 100% para uma etapa só (schema
 * `FinancialDreCostCenterMapping.costCenterId` é único). "Administrativo" é
 * o papel padrão do classificador (fail-safe) — na prática funciona como
 * "sem etapa específica ainda", por isso os CCs desse papel aparecem
 * destacados na lista da direita como candidatos a mover.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Save, Search } from "lucide-react";
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
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { CostCenterDialog } from "@/src/components/finance/cost-centers/financeUnclassifiedModalUi";
import { cn } from "@/src/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
};

type MappingsResponse = {
  schemaVersion: 1;
  mappings: FinanceDreCostCenterMappingRow[];
  note?: string;
};

/** Papel padrão do classificador — na prática, "sem etapa específica". */
const DEFAULT_ROLE: DreCostCenterRole = "admin";

export function FinanceDreCostCenterParametrizationModal({ open, onClose }: Props) {
  const { hasPermission } = useAuth();
  const canView = canViewFinanceDre({ hasPermission });
  const canManage = canManageFinanceDreMappings({ hasPermission });

  const [rows, setRows] = useState<FinanceDreCostCenterMappingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, DreCostCenterRole>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSavedMsg(null);
    try {
      const payload = await fetchJsonOk<MappingsResponse>(
        "/api/finance/dre/cost-center-mappings"
      );
      setRows(payload.mappings);
      const next: Record<string, DreCostCenterRole> = {};
      for (const row of payload.mappings) next[row.costCenterId] = row.role;
      setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar centros de custo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !canView) return;
    setSearch("");
    void load();
  }, [open, canView, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const dirtyCount = useMemo(() => {
    let n = 0;
    for (const row of rows) {
      if ((draft[row.costCenterId] ?? row.role) !== row.role) n += 1;
    }
    return n;
  }, [draft, rows]);

  /** Linhas com o papel do rascunho aplicado — base para as duas colunas. */
  const draftedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        role: draft[row.costCenterId] ?? row.role,
      })),
    [rows, draft]
  );

  const byRole = useMemo(() => {
    const map = new Map<DreCostCenterRole, FinanceDreCostCenterMappingRow[]>();
    for (const role of DRE_COST_CENTER_ROLES) map.set(role, []);
    for (const row of draftedRows) {
      map.get(row.role)?.push(row);
    }
    return map;
  }, [draftedRows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? draftedRows.filter(
          (r) =>
            r.code.toLowerCase().includes(term) || r.name.toLowerCase().includes(term)
        )
      : draftedRows;
    // Sem etapa específica primeiro — é o que mais provavelmente precisa de ação.
    return [...list].sort((a, b) => {
      const aDefault = a.role === DEFAULT_ROLE ? 0 : 1;
      const bDefault = b.role === DEFAULT_ROLE ? 0 : 1;
      if (aDefault !== bDefault) return aDefault - bDefault;
      return a.code.localeCompare(b.code);
    });
  }, [draftedRows, search]);

  const setRole = (costCenterId: string, role: DreCostCenterRole) => {
    setDraft((prev) => ({ ...prev, [costCenterId]: role }));
  };

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
      const payload = await fetchJsonOk<MappingsResponse>(
        "/api/finance/dre/cost-center-mappings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mappings }),
        }
      );
      setRows(payload.mappings);
      const next: Record<string, DreCostCenterRole> = {};
      for (const row of payload.mappings) next[row.costCenterId] = row.role;
      setDraft(next);
      setSavedMsg("Salvo. A DRE usará as novas etapas na próxima atualização.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <CostCenterDialog
      testId="finance-dre-parametrization-modal"
      title="Parametrizar centros de custo na DRE"
      subtitle="Estrutura da DRE por etapa, sem valores — escolha em qual etapa cada centro de custo entra 100%."
      maxWidthClass="max-w-6xl"
      stacked
      onClose={onClose}
      closeDisabled={saving}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="space-y-0.5">
            {savedMsg ? (
              <span className="font-medium text-emerald-700">{savedMsg}</span>
            ) : canManage ? (
              <span className="text-muted-foreground">
                {dirtyCount > 0
                  ? `${dirtyCount} alteração(ões) não salva(s).`
                  : "Nenhuma alteração pendente."}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Somente leitura — sem permissão de gestão.
              </span>
            )}
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || dirtyCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
              data-testid="finance-dre-parametrization-save"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Salvar {dirtyCount > 0 ? `(${dirtyCount})` : ""}
            </button>
          ) : null}
        </div>
      }
    >
      {loading ? (
        <FinanceModuleLoadingBlock label="Carregando centros de custo…" />
      ) : null}
      {error ? <FinanceModuleErrorBanner message={error} /> : null}

      {!loading && !error ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
          {/* Esquerda — estrutura da DRE por etapa, sem valores. */}
          <div className="space-y-2.5" data-testid="finance-dre-parametrization-structure">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Etapas da DRE
            </h4>
            {DRE_COST_CENTER_ROLES.map((role) => {
              const ccs = byRole.get(role) ?? [];
              return (
                <div
                  key={role}
                  className="rounded-xl border border-border bg-card p-3"
                  data-testid={`finance-dre-parametrization-role-${role}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {DRE_COST_CENTER_ROLE_LABELS[role]}
                    </p>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      {ccs.length}
                    </span>
                  </div>
                  {ccs.length === 0 ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Nenhum centro de custo nesta etapa.
                    </p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {ccs.map((cc) => (
                        <span
                          key={cc.costCenterId}
                          className="inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground"
                          title={cc.name}
                        >
                          {cc.code}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Direita — todos os CCs; sem etapa específica (Administrativo) em destaque. */}
          <div className="space-y-2.5" data-testid="finance-dre-parametrization-picker">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Centros de custo ({filteredRows.length})
            </h4>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por código ou nome…"
                className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm"
                data-testid="finance-dre-parametrization-search"
              />
            </div>
            {filteredRows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                Nenhum centro de custo encontrado.
              </p>
            ) : (
              <div className="max-h-[560px] space-y-1.5 overflow-y-auto pr-1">
                {filteredRows.map((row) => {
                  const isDefault = row.role === DEFAULT_ROLE;
                  return (
                    <div
                      key={row.costCenterId}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                        isDefault
                          ? "border-dashed border-amber-300 bg-amber-50/60"
                          : "border-border bg-card"
                      )}
                      data-testid={`finance-dre-parametrization-row-${row.costCenterId}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {row.name}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {row.code}
                          {isDefault ? " · sem etapa específica" : ""}
                        </p>
                      </div>
                      <select
                        className="h-8 shrink-0 rounded-md border border-border bg-background px-1.5 text-[11px]"
                        value={row.role}
                        disabled={!canManage || saving}
                        onChange={(e) =>
                          setRole(row.costCenterId, e.target.value as DreCostCenterRole)
                        }
                        aria-label={`Etapa DRE de ${row.code}`}
                      >
                        {DRE_COST_CENTER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {DRE_COST_CENTER_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </CostCenterDialog>,
    document.body
  );
}
