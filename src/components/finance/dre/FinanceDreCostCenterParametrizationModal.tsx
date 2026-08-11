/**
 * Modal "Parametrizar centros de custo na DRE".
 *
 * Permite direcionar cada Centro de Custo para um dos níveis da DRE (à esquerda),
 * ou deixá-lo como "Nenhum nível (Fora da DRE / Já considerado em outra etapa)".
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Filter, Loader2, Save, Search, XCircle, CheckCircle2 } from "lucide-react";
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

const ROLE_DESCRIPTIONS: Record<DreCostCenterRole, string> = {
  none: "Fora da DRE (desconsiderado ou já considerado no CMV/outra etapa).",
  logistics: "Entra nos Custos de Fretes e Transportes da DRE.",
  packaging: "Entra nos Custos de Embalagens da DRE.",
  admin: "Entra em Despesas Operacionais / Administrativas.",
  partner_investment: "Entra em Despesas e é somado como Add-back no EBITDA.",
  payroll: "Relatório informativo de Folha de Pagamento.",
  benefits: "Relatório informativo de Benefícios.",
  assembly: "Relatório informativo de Montagem de Produção.",
  labor: "Relatório informativo de Mão de Obra Direta.",
  tax: "Relatório informativo de Impostos do CC.",
  raw_material: "Relatório informativo de Matéria-prima no CC.",
};

const ROLE_ICONS: Record<DreCostCenterRole, string> = {
  none: "🚫",
  logistics: "🚚",
  packaging: "📦",
  admin: "🏢",
  partner_investment: "⭐",
  payroll: "📄",
  benefits: "💳",
  assembly: "⚙️",
  labor: "🛠️",
  tax: "🧾",
  raw_material: "🧱",
};

const ROLE_OPTION_LABELS: Record<DreCostCenterRole, string> = {
  none: "🚫 Nenhum nível (Fora da DRE / Já considerado)",
  logistics: "🚚 Logística / Fretes (Custos)",
  packaging: "📦 Embalagens (Custos)",
  admin: "🏢 Despesas Administrativas (Operacional)",
  partner_investment: "⭐ Investimento sócios (Add-back EBITDA)",
  payroll: "📄 Folha (Informativo Pessoal)",
  benefits: "💳 Benefícios (Informativo Pessoal)",
  assembly: "⚙️ Montagem (Informativo Produção)",
  labor: "🛠️ Mão de obra (Informativo Produção)",
  tax: "🧾 Imposto (Informativo CC)",
  raw_material: "🧱 Matéria-prima (Informativo CC)",
};

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
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<DreCostCenterRole | "ALL">("ALL");

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
    setSelectedRoleFilter("ALL");
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
    let list = draftedRows;

    if (selectedRoleFilter !== "ALL") {
      list = list.filter((r) => r.role === selectedRoleFilter);
    }

    if (term) {
      list = list.filter(
        (r) =>
          r.code.toLowerCase().includes(term) || r.name.toLowerCase().includes(term)
      );
    }

    // Sem nível primeiro, depois por código
    return [...list].sort((a, b) => {
      const aNone = a.role === "none" ? 0 : 1;
      const bNone = b.role === "none" ? 0 : 1;
      if (aNone !== bNone) return aNone - bNone;
      return a.code.localeCompare(b.code);
    });
  }, [draftedRows, search, selectedRoleFilter]);

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
      setSavedMsg("Salvo! A DRE utilizará o novo direcionamento dos centros de custo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar direcionamento.");
    } finally {
      setSaving(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <CostCenterDialog
      testId="finance-dre-parametrization-modal"
      title="Parametrizar centros de custo na DRE"
      subtitle="Escolha exatamente em qual nível da DRE cada centro de custo entra 100%, ou selecione 'Nenhum nível (Fora da DRE)' caso já tenha sido considerado."
      maxWidthClass="max-w-6xl"
      stacked
      onClose={onClose}
      closeDisabled={saving}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="space-y-0.5">
            {savedMsg ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {savedMsg}
              </span>
            ) : canManage ? (
              <span className="text-muted-foreground">
                {dirtyCount > 0
                  ? `${dirtyCount} centro(s) de custo alterado(s) aguardando salvamento.`
                  : "Nenhuma alteração pendente."}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Somente leitura — sem permissão de edição.
              </span>
            )}
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || dirtyCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50 transition-opacity"
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
        <FinanceModuleLoadingBlock label="Carregando mapeamento dos centros de custo…" />
      ) : null}
      {error ? <FinanceModuleErrorBanner message={error} /> : null}

      {!loading && !error ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
          {/* Coluna Esquerda — Estrutura de Níveis da DRE */}
          <div className="space-y-2.5" data-testid="finance-dre-parametrization-structure">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Níveis / Etapas da DRE (Clique para filtrar)
              </h4>
              {selectedRoleFilter !== "ALL" ? (
                <button
                  type="button"
                  onClick={() => setSelectedRoleFilter("ALL")}
                  className="text-xs text-primary hover:underline font-medium inline-flex items-center gap-1"
                >
                  <XCircle className="h-3.5 w-3.5" /> Limpar filtro ({DRE_COST_CENTER_ROLE_LABELS[selectedRoleFilter]})
                </button>
              ) : null}
            </div>

            <div className="max-h-[580px] space-y-2 overflow-y-auto pr-1">
              {DRE_COST_CENTER_ROLES.map((role) => {
                const ccs = byRole.get(role) ?? [];
                const isSelected = selectedRoleFilter === role;
                const isNone = role === "none";

                return (
                  <div
                    key={role}
                    onClick={() => setSelectedRoleFilter(isSelected ? "ALL" : role)}
                    className={cn(
                      "group cursor-pointer rounded-xl border p-3 transition-all",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : isNone
                        ? "border-slate-200 bg-slate-50/70 hover:border-slate-300"
                        : "border-border bg-card hover:border-primary/40 hover:bg-accent/30"
                    )}
                    data-testid={`finance-dre-parametrization-role-${role}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm" aria-hidden="true">
                            {ROLE_ICONS[role]}
                          </span>
                          <p className={cn("text-sm font-bold", isSelected ? "text-primary" : "text-foreground")}>
                            {DRE_COST_CENTER_ROLE_LABELS[role]}
                          </p>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {ROLE_DESCRIPTIONS[role]}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-bold shrink-0",
                          ccs.length > 0
                            ? isNone
                              ? "bg-amber-100 text-amber-800"
                              : "bg-primary/10 text-primary"
                            : "bg-accent text-muted-foreground"
                        )}
                      >
                        {ccs.length}
                      </span>
                    </div>

                    {ccs.length === 0 ? (
                      <p className="mt-1.5 text-[11px] italic text-muted-foreground/70">
                        Nenhum centro de custo direcionado para esta etapa.
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {ccs.map((cc) => (
                          <span
                            key={cc.costCenterId}
                            className={cn(
                              "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                              isNone
                                ? "border-amber-200 bg-amber-50 text-amber-900"
                                : "border-border bg-background text-foreground"
                            )}
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
          </div>

          {/* Coluna Direita — Lista de Centros de Custo e Seleção de Nível */}
          <div className="space-y-2.5" data-testid="finance-dre-parametrization-picker">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Centros de Custo ({filteredRows.length} de {rows.length})
              </h4>
            </div>

            {/* Filtros rápidos por grupo */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setSelectedRoleFilter("ALL")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors border",
                  selectedRoleFilter === "ALL"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                )}
              >
                Todos ({rows.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedRoleFilter("none")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors border",
                  selectedRoleFilter === "none"
                    ? "border-amber-500 bg-amber-500 text-white font-semibold"
                    : "border-amber-200 bg-amber-50/60 text-amber-900 hover:bg-amber-100/60"
                )}
              >
                🚫 Sem nível ({(byRole.get("none") ?? []).length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedRoleFilter("admin")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors border",
                  selectedRoleFilter === "admin"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                )}
              >
                🏢 Admin ({(byRole.get("admin") ?? []).length})
              </button>
            </div>

            {/* Busca por Texto */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por código ou nome do CC…"
                className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs"
                data-testid="finance-dre-parametrization-search"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            {filteredRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
                <p>Nenhum centro de custo encontrado para os filtros aplicados.</p>
                {selectedRoleFilter !== "ALL" || search ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setSelectedRoleFilter("ALL");
                    }}
                    className="mt-2 font-medium text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Restaurar filtros de busca
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {filteredRows.map((row) => {
                  const isNone = row.role === "none";
                  const isDirty = (draft[row.costCenterId] ?? row.role) !== row.role;

                  return (
                    <div
                      key={row.costCenterId}
                      className={cn(
                        "flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border p-3 transition-colors",
                        isNone
                          ? "border-amber-200 bg-amber-50/40"
                          : isDirty
                          ? "border-blue-300 bg-blue-50/30"
                          : "border-border bg-card"
                      )}
                      data-testid={`finance-dre-parametrization-row-${row.costCenterId}`}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="truncate text-xs font-bold text-foreground">
                            {row.name}
                          </p>
                          <span className="font-mono text-[10px] text-muted-foreground bg-accent/60 px-1.5 py-0.5 rounded">
                            {row.code}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <span aria-hidden="true">{ROLE_ICONS[row.role]}</span>
                          <span>{DRE_COST_CENTER_ROLE_LABELS[row.role]}</span>
                        </p>
                      </div>

                      {/* Dropdown de Seleção de Nível DRE */}
                      <select
                        className={cn(
                          "h-8.5 shrink-0 rounded-lg border bg-background px-2.5 text-xs font-medium focus:ring-1 focus:ring-primary min-w-[210px]",
                          isNone
                            ? "border-amber-400 font-semibold text-amber-900 bg-amber-50/80"
                            : "border-border text-foreground"
                        )}
                        value={row.role}
                        disabled={!canManage || saving}
                        onChange={(e) =>
                          setRole(row.costCenterId, e.target.value as DreCostCenterRole)
                        }
                        aria-label={`Etapa DRE de ${row.code}`}
                      >
                        {DRE_COST_CENTER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_OPTION_LABELS[role]}
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
