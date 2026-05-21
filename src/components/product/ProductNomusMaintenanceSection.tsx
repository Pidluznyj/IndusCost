import React, { useCallback, useRef, useState } from "react";
import { Check, Loader2, Package, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { NomusBomApplyPlanPanel } from "@/src/components/product/NomusBomApplyPlanPanel";
import { NomusEffectivePricingBomPanel } from "@/src/components/product/NomusEffectivePricingBomPanel";
import { NomusEffectiveBomCostImpactPanel } from "@/src/components/product/NomusEffectiveBomCostImpactPanel";
import { NomusMaintenanceOverviewPanel } from "@/src/components/product/NomusMaintenanceOverviewPanel";
import { NomusMaintenancePendingPanel } from "@/src/components/product/NomusMaintenancePendingPanel";
import { NomusMaintenanceDiagnosticPanel } from "@/src/components/product/NomusMaintenanceDiagnosticPanel";
import { NomusProductImportSimulationPanel } from "@/src/components/product/NomusProductImportSimulationPanel";
import { NomusEngineeringSyncPanel } from "@/src/components/product/NomusEngineeringSyncPanel";
import { useNomusParentCodeResolver } from "@/src/hooks/useNomusParentCodeResolver";
import type { NomusParentCodeOption } from "@/src/lib/nomusParentCodeOptionsTypes";
import type {
  NomusMaintenanceTab,
  NomusWorkspaceParentSelection,
} from "@/src/lib/nomusMaintenanceWorkspaceTypes";

export type { NomusMaintenanceTab } from "@/src/lib/nomusMaintenanceWorkspaceTypes";

const NOMUS_MAINTENANCE_SUBTABS: { id: NomusMaintenanceTab; label: string }[] = [
  { id: "overview", label: "Visão Geral" },
  { id: "pending", label: "Pendências" },
  { id: "effective-pricing-bom", label: "BOM efetiva" },
  { id: "cost-impact", label: "Impacto de custo" },
  { id: "apply-plan", label: "Plano de aplicação" },
  { id: "product-import", label: "Importar produto" },
  { id: "engineering-sync", label: "Atualizar engenharia pelo Nomus" },
  { id: "diagnostic", label: "Diagnóstico técnico" },
];

type ProductNomusMaintenanceSectionProps = {
  onOpenProduct?: (productId: string) => void;
  /** Recarrega a listagem de engenharia (CIU) após aplicação controlada ou refresh manual amplo. */
  onEngineeringListRefresh?: () => void;
};

export const ProductNomusMaintenanceSection: React.FC<ProductNomusMaintenanceSectionProps> = ({
  onOpenProduct,
  onEngineeringListRefresh,
}) => {
  const [activeNomusMaintenanceTab, setActiveNomusMaintenanceTab] =
    useState<NomusMaintenanceTab>("overview");

  const [workspaceSearchInput, setWorkspaceSearchInput] = useState("");
  const [selectedParentCode, setSelectedParentCode] = useState("");
  const [selectedParentDescription, setSelectedParentDescription] = useState<string | null>(null);
  const [selectedIndusProductId, setSelectedIndusProductId] = useState<string | null>(null);
  const [selectedParentOption, setSelectedParentOption] = useState<NomusParentCodeOption | null>(
    null
  );
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [selectingProduct, setSelectingProduct] = useState(false);
  const [changeProductMode, setChangeProductMode] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [listRefreshHint, setListRefreshHint] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { resolveThen, pickerModal, notFoundMessage } = useNomusParentCodeResolver();

  const applyWorkspaceSelection = useCallback((selection: NomusWorkspaceParentSelection) => {
    setSelectedParentCode(selection.parentCode);
    setWorkspaceSearchInput(selection.parentCode);
    setSelectedParentDescription(selection.parentDescription);
    setSelectedIndusProductId(selection.indusProductId);
    setSelectedParentOption(selection.option ?? null);
    setWorkspaceError(null);
    setChangeProductMode(false);
  }, []);

  const handleWorkspaceParentChange = useCallback(
    (selection: NomusWorkspaceParentSelection | null) => {
      if (!selection) {
        setSelectedParentCode("");
        setSelectedParentDescription(null);
        setSelectedIndusProductId(null);
        setSelectedParentOption(null);
        return;
      }
      applyWorkspaceSelection(selection);
    },
    [applyWorkspaceSelection]
  );

  const handleSelectProduct = useCallback(async () => {
    setSelectingProduct(true);
    setWorkspaceError(null);
    try {
      const outcome = await resolveThen(
        workspaceSearchInput,
        async (code, option) => {
          applyWorkspaceSelection({
            parentCode: code,
            parentDescription: option?.parentDescription ?? null,
            indusProductId: option?.indusProductId ?? null,
            option: option ?? null,
          });
        },
        {
          title: "Selecione o produto em análise",
          description: "Escolha qual parentCode Nomus deseja analisar na manutenção.",
          selectLabel: "Selecionar",
        }
      );
      if (!outcome.ok && outcome.reason === "none") {
        setWorkspaceError(notFoundMessage);
      }
    } catch (e) {
      setWorkspaceError(e instanceof Error ? e.message : "Erro ao selecionar produto.");
    } finally {
      setSelectingProduct(false);
    }
  }, [applyWorkspaceSelection, notFoundMessage, resolveThen, workspaceSearchInput]);

  const clearSelection = () => {
    setSelectedParentCode("");
    setSelectedParentDescription(null);
    setSelectedIndusProductId(null);
    setSelectedParentOption(null);
    setWorkspaceSearchInput("");
    setWorkspaceError(null);
    setChangeProductMode(false);
  };

  const hasSelection = Boolean(selectedParentCode.trim());
  const showWorkspacePicker = changeProductMode || !hasSelection;

  const handleRefreshAnalyses = useCallback(() => {
    if (!hasSelection) return;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setIsRefreshing(true);
    setRefreshToken((n) => n + 1);
    onEngineeringListRefresh?.();
    refreshTimerRef.current = setTimeout(() => setIsRefreshing(false), 1500);
  }, [hasSelection, onEngineeringListRefresh]);

  const handleControlledApplySuccess = useCallback(() => {
    setRefreshToken((n) => n + 1);
    onEngineeringListRefresh?.();
    setListRefreshHint(
      "BOM e custos das abas Nomus foram recarregados. A listagem de engenharia também foi atualizada; se o CIU na grade ainda parecer antigo, volte à aba Produtos e aguarde o carregamento."
    );
  }, [onEngineeringListRefresh]);

  const workspaceProps = {
    selectedParentCode: hasSelection ? selectedParentCode : undefined,
    selectedParentDescription,
    selectedIndusProductId,
    onWorkspaceParentChange: handleWorkspaceParentChange,
    refreshToken,
  };

  const goToPending = () => setActiveNomusMaintenanceTab("pending");

  return (
    <div className="space-y-4 pb-10" data-tour="products-nomus-maintenance">
      <div className="rounded-xl border border-border bg-card/40 px-4 py-3 space-y-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground">Manutenção Nomus</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Selecione o produto uma vez para analisar todas as subtabs. Ações somente leitura/dry-run
              — nenhuma alteração é aplicada ao IndusCost.
            </p>
          </div>
          {hasSelection && !changeProductMode ? (
            <div className="flex flex-col items-stretch sm:items-end gap-1 shrink-0">
              <button
                type="button"
                disabled={isRefreshing}
                onClick={handleRefreshAnalyses}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Atualizar BOM e custo
              </button>
              <p className="text-xs text-muted-foreground text-right max-w-xs">
                Recarrega Visão Geral, Pendências, BOM efetiva, Impacto, Plano e Diagnóstico da aba
                atual. Não altera ProductBOM, custo oficial ou preço.
              </p>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
            Produto em análise / parentCode
          </p>

          {showWorkspacePicker ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1">
                <input
                  type="text"
                  value={workspaceSearchInput}
                  onChange={(e) => setWorkspaceSearchInput(e.target.value)}
                  placeholder="Ex.: 610.73 ou 610.73BA"
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSelectProduct();
                  }}
                />
              </div>
              <button
                type="button"
                disabled={selectingProduct || !workspaceSearchInput.trim()}
                onClick={() => void handleSelectProduct()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {selectingProduct ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                Selecionar produto
              </button>
              {hasSelection ? (
                <button
                  type="button"
                  onClick={() => setChangeProductMode(false)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent"
                >
                  Cancelar
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceSearchInput(selectedParentCode);
                  setChangeProductMode(true);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Trocar produto
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
                Limpar seleção
              </button>
            </div>
          )}

          {workspaceError ? (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {workspaceError}
            </p>
          ) : null}
        </div>

        {hasSelection && !changeProductMode ? (
          <div className="rounded-lg border border-green-200 bg-green-50/80 px-3 py-2.5 flex flex-wrap items-start gap-3">
            <Package className="h-4 w-4 text-green-800 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-green-200/80 px-2 py-0.5 text-[10px] font-bold text-green-900">
                  <Check className="h-3 w-3" />
                  Produto selecionado
                </span>
                <span className="text-sm font-bold text-green-950">{selectedParentCode}</span>
              </div>
              {selectedParentDescription ? (
                <p className="text-xs text-green-900/90 mt-1">{selectedParentDescription}</p>
              ) : null}
              <p className="text-[10px] text-green-800/80 mt-1">
                {selectedIndusProductId
                  ? `ID IndusCost: ${selectedIndusProductId}`
                  : "Sem cadastro IndusCost vinculado"}
                {selectedParentOption?.nomusLinesCount != null
                  ? ` · ${selectedParentOption.nomusLinesCount} linha(s) Nomus`
                  : ""}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Selecione um produto no topo para iniciar a manutenção Nomus.
          </p>
        )}
      </div>

      {isRefreshing ? (
        <p className="text-sm text-primary font-medium flex items-center gap-2 px-1">
          <Loader2 className="h-4 w-4 animate-spin" />
          Atualizando análise…
        </p>
      ) : null}

      {listRefreshHint ? (
        <p className="text-xs text-muted-foreground bg-accent/40 border border-border rounded-lg px-3 py-2">
          {listRefreshHint}
        </p>
      ) : null}

      <div
        className="flex flex-wrap gap-2 border-b border-border pb-2"
        role="tablist"
        aria-label="Subáreas de manutenção Nomus"
      >
        {NOMUS_MAINTENANCE_SUBTABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeNomusMaintenanceTab === tab.id}
            onClick={() => setActiveNomusMaintenanceTab(tab.id)}
            className={cn(
              "h-9 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors",
              activeNomusMaintenanceTab === tab.id
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="min-h-[12rem] pt-1">
        {activeNomusMaintenanceTab === "overview" ? (
          <NomusMaintenanceOverviewPanel
            {...workspaceProps}
            onNavigateTab={setActiveNomusMaintenanceTab}
          />
        ) : null}
        {activeNomusMaintenanceTab === "pending" ? (
          <NomusMaintenancePendingPanel {...workspaceProps} />
        ) : null}
        {activeNomusMaintenanceTab === "effective-pricing-bom" ? (
          <NomusEffectivePricingBomPanel
            {...workspaceProps}
            hideLocalReviewSection
            onGoToPending={goToPending}
            onViewCostImpact={(code) => {
              handleWorkspaceParentChange({
                parentCode: code,
                parentDescription: selectedParentDescription,
                indusProductId: selectedIndusProductId,
                option: selectedParentOption,
              });
              setActiveNomusMaintenanceTab("cost-impact");
            }}
          />
        ) : null}
        {activeNomusMaintenanceTab === "cost-impact" ? (
          <NomusEffectiveBomCostImpactPanel {...workspaceProps} onGoToPending={goToPending} />
        ) : null}
        {activeNomusMaintenanceTab === "apply-plan" ? (
          <NomusBomApplyPlanPanel
            onOpenProduct={onOpenProduct}
            onControlledApplySuccess={handleControlledApplySuccess}
            {...workspaceProps}
          />
        ) : null}
        {activeNomusMaintenanceTab === "product-import" ? (
          <NomusProductImportSimulationPanel
            onOpenProduct={onOpenProduct}
            onImportSuccess={() => {
              handleControlledApplySuccess();
              onEngineeringListRefresh?.();
            }}
            {...workspaceProps}
          />
        ) : null}
        {activeNomusMaintenanceTab === "engineering-sync" ? (
          <NomusEngineeringSyncPanel
            onOpenProduct={onOpenProduct}
            onApplySuccess={() => {
              handleControlledApplySuccess();
              onEngineeringListRefresh?.();
            }}
            {...workspaceProps}
          />
        ) : null}
        {activeNomusMaintenanceTab === "diagnostic" ? (
          <NomusMaintenanceDiagnosticPanel onOpenProduct={onOpenProduct} {...workspaceProps} />
        ) : null}
      </div>

      {pickerModal}
    </div>
  );
};
