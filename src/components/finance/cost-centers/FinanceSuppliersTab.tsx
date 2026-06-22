import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, RefreshCw, Settings2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import type { FinanceSupplierRebuildPreviewPayload } from "@/src/lib/financeSupplierRebuild";
import type { SupplierCostCenterRuleDto } from "@/src/lib/financeSupplierCostCenterRules";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import type { FinanceCostCentersTabId } from "@/src/lib/financeCostCentersPageTypes";

type Props = {
  dashboard: FinanceCostCenterDashboardPayload | null;
  canViewSuppliers: boolean;
  onNavigateTab: (tab: FinanceCostCentersTabId) => void;
};

type SupplierRow = {
  supplierId: string | null;
  name: string;
  document: string | null;
  titlesCount: number;
  amount: number;
  costCenterName: string;
  ruleStatus: string;
  aliasesCount: number;
};

export function FinanceSuppliersTab({ dashboard, canViewSuppliers, onNavigateTab }: Props) {
  const [preview, setPreview] = useState<FinanceSupplierRebuildPreviewPayload | null>(null);
  const [rules, setRules] = useState<SupplierCostCenterRuleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aliasesSupplier, setAliasesSupplier] = useState<SupplierRow | null>(null);

  const load = useCallback(async () => {
    if (!canViewSuppliers) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [previewPayload, rulesPayload] = await Promise.all([
        fetchJsonOk<FinanceSupplierRebuildPreviewPayload>(
          "/api/finance/suppliers/rebuild-from-ap-preview",
          { credentials: "include" }
        ),
        fetchJsonOk<{ items: SupplierCostCenterRuleDto[] }>(
          "/api/finance/supplier-cost-center-rules",
          { credentials: "include" }
        ),
      ]);
      setPreview(previewPayload);
      setRules(rulesPayload.items);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar fornecedores.", e));
    } finally {
      setLoading(false);
    }
  }, [canViewSuppliers]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<SupplierRow[]>(() => {
    const bySupplier = dashboard?.bySupplier ?? [];
    const activeRulesBySupplier = new Map<string, SupplierCostCenterRuleDto[]>();
    for (const rule of rules) {
      if (!rule.isActive) continue;
      const list = activeRulesBySupplier.get(rule.supplierId) ?? [];
      list.push(rule);
      activeRulesBySupplier.set(rule.supplierId, list);
    }

    const previewById = new Map(
      (preview?.items ?? [])
        .filter((item) => item.existingSupplierId)
        .map((item) => [item.existingSupplierId!, item])
    );

    return bySupplier.map((row) => {
      const supplierRules = row.supplierId
        ? activeRulesBySupplier.get(row.supplierId) ?? []
        : [];
      const previewItem = row.supplierId ? previewById.get(row.supplierId) : null;
      return {
        supplierId: row.supplierId,
        name: row.name,
        document: row.document,
        titlesCount: row.titlesCount,
        amount: row.amount,
        costCenterName: row.costCenterName,
        ruleStatus:
          supplierRules.length > 0
            ? supplierRules.length > 1
              ? "Rateio ativo"
              : "Regra ativa"
            : "Sem regra",
        aliasesCount: previewItem ? 1 : 0,
      };
    });
  }, [dashboard, preview, rules]);

  if (!canViewSuppliers) {
    return (
      <FinanceModuleEmptyState
        title="Sem permissão para fornecedores"
        description="Solicite acesso a fornecedores financeiros para gerenciar esta área."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-suppliers-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Fornecedores consolidados com volume de AP e status de classificação por centro de custo.
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      {error ? <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando fornecedores…" /> : null}

      {!loading && rows.length === 0 ? (
        <FinanceModuleEmptyState
          title="Nenhum fornecedor no filtro"
          description="Execute a sincronização de AP ou reconstrua fornecedores a partir dos títulos para popular esta lista."
        />
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className={cn(financeBiCardClass, "overflow-x-auto")}>
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2">Fornecedor</th>
                <th className="px-3 py-2">Documento</th>
                <th className="px-3 py-2">Títulos</th>
                <th className="px-3 py-2">Valor</th>
                <th className="px-3 py-2">Centro padrão</th>
                <th className="px-3 py-2">Regra</th>
                <th className="px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.supplierId ?? row.name}`} className="border-b border-border/60">
                  <td className="px-3 py-2 font-semibold">{row.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.document ?? "—"}</td>
                  <td className="px-3 py-2">{row.titlesCount}</td>
                  <td className="px-3 py-2">{formatFinanceCurrency(row.amount)}</td>
                  <td className="px-3 py-2">{row.costCenterName}</td>
                  <td className="px-3 py-2">{row.ruleStatus}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        data-testid="finance-suppliers-define-rule-button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                        onClick={() => onNavigateTab("rules")}
                      >
                        <Settings2 className="h-3 w-3" />
                        Definir regra
                      </button>
                      <button
                        type="button"
                        data-testid="finance-suppliers-view-aliases-button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"
                        onClick={() => setAliasesSupplier(row)}
                      >
                        <Eye className="h-3 w-3" />
                        Ver aliases
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {aliasesSupplier ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={cn(financeBiCardClass, "w-full max-w-lg space-y-3")}>
            <h3 className="text-lg font-semibold">Aliases — {aliasesSupplier.name}</h3>
            <p className="text-sm text-muted-foreground">
              Documento: {aliasesSupplier.document ?? "—"} · Centro: {aliasesSupplier.costCenterName}
            </p>
            <p className="text-sm">
              Os aliases consolidados são gerados automaticamente a partir dos títulos AP. Use a
              reconstrução de fornecedores para atualizar vínculos quando necessário.
            </p>
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm"
              onClick={() => setAliasesSupplier(null)}
            >
              Fechar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
