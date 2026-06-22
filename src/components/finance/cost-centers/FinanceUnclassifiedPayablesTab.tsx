import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Play, RefreshCw, Settings2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT } from "@/src/lib/financeApAllocationShared";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import type { BatchAllocationPreviewPayload } from "@/src/lib/financeAccountsPayableCostCenterAllocation";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import type { FinanceCostCentersTabId } from "@/src/lib/financeCostCentersPageTypes";

type UnclassifiedItem = {
  externalId: number;
  titleAmount: number;
  companyName: string | null;
  personName: string | null;
};

type Props = {
  dashboard: FinanceCostCenterDashboardPayload | null;
  canApplyBatch: boolean;
  onNavigateTab: (tab: FinanceCostCentersTabId) => void;
  onApplied?: () => void;
};

export function FinanceUnclassifiedPayablesTab({
  dashboard,
  canApplyBatch,
  onNavigateTab,
  onApplied,
}: Props) {
  const [items, setItems] = useState<UnclassifiedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchAllocationPreviewPayload | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<{ items: UnclassifiedItem[] }>(
        "/api/finance/accounts-payable/unclassified",
        { credentials: "include" }
      );
      setItems(payload.items);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar títulos sem classificação.", e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { name: string; titlesCount: number; amount: number; openAmount: number }
    >();
    for (const item of items) {
      const key = item.personName ?? `Título ${item.externalId}`;
      const row = map.get(key) ?? { name: key, titlesCount: 0, amount: 0, openAmount: 0 };
      row.titlesCount += 1;
      row.amount += item.titleAmount;
      row.openAmount += item.titleAmount;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [items]);

  const runPreview = async () => {
    try {
      const payload = await fetchJsonOk<BatchAllocationPreviewPayload>(
        "/api/finance/accounts-payable/classify-batch-preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unclassifiedOnly: true }),
        }
      );
      setPreview(payload);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível gerar o preview em lote.", e));
    }
  };

  const applyBatch = async () => {
    if (!canApplyBatch) return;
    setApplying(true);
    try {
      await fetchJsonOk("/api/finance/accounts-payable/classify-batch-apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unclassifiedOnly: true,
          confirmationText: confirmation,
        }),
      });
      setPreview(null);
      setConfirmation("");
      await load();
      onApplied?.();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível aplicar a classificação em lote.", e));
    } finally {
      setApplying(false);
    }
  };

  const unclassified = dashboard?.unclassified;

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-unclassified-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Títulos AP sem classificação completa. Agrupe por fornecedor e aplique regras em lote com
          confirmação.
        </p>
        <div className="flex gap-2">
          <button type="button" className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          {canApplyBatch ? (
            <>
              <button
                type="button"
                data-testid="finance-unclassified-preview-button"
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"
                onClick={() => void runPreview()}
              >
                <Play className="h-4 w-4" />
                Preview em lote
              </button>
            </>
          ) : null}
        </div>
      </div>

      {error ? <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando títulos sem classificação…" /> : null}

      {!loading && grouped.length === 0 ? (
        <FinanceModuleEmptyState
          title="Nenhum título sem classificação"
          description="Todos os títulos do filtro já possuem classificação por centro de custo — ou cadastre regras para novos fornecedores."
        />
      ) : null}

      {!loading && grouped.length > 0 ? (
        <div className={cn(financeBiCardClass, "overflow-x-auto")}>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2">Fornecedor</th>
                <th className="px-3 py-2">Títulos</th>
                <th className="px-3 py-2">Valor</th>
                <th className="px-3 py-2">Sugestão</th>
                <th className="px-3 py-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((row) => (
                <tr key={row.name} className="border-b border-border/60">
                  <td className="px-3 py-2 font-semibold">{row.name}</td>
                  <td className="px-3 py-2">{row.titlesCount}</td>
                  <td className="px-3 py-2">{formatFinanceCurrency(row.amount)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {unclassified && unclassified.titlesCount > 0
                      ? "Definir regra para o fornecedor"
                      : "Revisar fornecedor"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      data-testid="finance-unclassified-classify-supplier-button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                      onClick={() => onNavigateTab("rules")}
                    >
                      <Settings2 className="h-3 w-3" />
                      Classificar fornecedor
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {preview && canApplyBatch ? (
        <div className={cn(financeBiCardClass, "space-y-3")}>
          <h3 className="font-semibold">Preview em lote</h3>
          <p className="text-sm text-muted-foreground">
            Criar: {preview.summary.wouldCreate} · Substituir: {preview.summary.wouldReplace} ·
            Ignorados: {preview.summary.skipped}
          </p>
          <label className="block space-y-1 text-sm">
            <span className="font-semibold">
              Confirmação — digite: {FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT}
            </span>
            <input
              className="w-full rounded-lg border px-3 py-2 font-mono text-xs"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            type="button"
            data-testid="finance-unclassified-batch-apply-button"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={
              applying || confirmation.trim() !== FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT
            }
            onClick={() => void applyBatch()}
          >
            {applying ? "Aplicando…" : "Aplicar classificação em lote"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
