import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { NomusOptionalPricingSelectionPanel } from "@/src/components/product/NomusOptionalPricingSelectionPanel";
import { NomusLocalReviewSection } from "@/src/components/product/NomusLocalReviewSection";
import { NomusMaintenanceErrorCard } from "@/src/components/product/NomusMaintenanceErrorCard";
import {
  OPTIONAL_PRICING_STATUS_LABEL,
  formatNomusStatusLabel,
} from "@/src/lib/nomusMaintenanceStatusLabels";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type { EffectivePricingBomResult } from "@/src/lib/nomusEffectivePricingBomTypes";

type NomusMaintenancePendingPanelProps = NomusMaintenanceWorkspaceProps & {
  disabled?: boolean;
};

export const NomusMaintenancePendingPanel: React.FC<NomusMaintenancePendingPanelProps> = ({
  selectedParentCode = "",
  selectedParentDescription,
  selectedIndusProductId,
  onWorkspaceParentChange,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bom, setBom] = useState<EffectivePricingBomResult | null>(null);

  const loadBom = useCallback(async (code: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJsonOk<EffectivePricingBomResult>(
        `/api/nomus/effective-pricing-bom?${new URLSearchParams({ parentCode: code }).toString()}`
      );
      setBom(data);
    } catch (e) {
      setBom(null);
      setLoadError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedParentCode.trim()) {
      void loadBom(selectedParentCode);
    } else {
      setBom(null);
    }
  }, [loadBom, selectedParentCode]);

  if (!selectedParentCode.trim()) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Selecione um produto no cabeçalho para ver e resolver pendências.
        </p>
      </div>
    );
  }

  const optionalStatus = bom?.optionalPricingStatus;
  const optionalResolved =
    optionalStatus === "RESOLVED" || optionalStatus === "NO_OPTIONALS";
  const localPending = bom?.summary?.localReviewPendingCount ?? 0;
  const catalog = bom?.localReviewCatalog ?? [];

  return (
    <div className="space-y-4">
      {loadError && !loading ? (
        <NomusMaintenanceErrorCard onRetry={() => void loadBom(selectedParentCode)} />
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-bold">Pendências do produto</h4>
          <p className="text-[11px] text-muted-foreground mt-1">
            Decisões humanas necessárias para <span className="font-semibold">{selectedParentCode}</span>
            {selectedParentDescription ? ` — ${selectedParentDescription}` : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void loadBom(selectedParentCode)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </button>
      </div>

      <section className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="text-sm font-bold">Opcionais de Precificação</h5>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Escolha quais opcionais Nomus entram na precificação deste produto. Itens opcionais
              nunca entram automaticamente.
            </p>
          </div>
          {optionalResolved ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-bold text-green-800">
              <CheckCircle2 className="h-3 w-3" />
              Opcionais resolvidos
            </span>
          ) : (
            <span
              className={cn(
                "inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold",
                optionalStatus === "STALE"
                  ? "bg-orange-100 text-orange-900"
                  : "bg-amber-100 text-amber-900"
              )}
            >
              {formatNomusStatusLabel(optionalStatus, OPTIONAL_PRICING_STATUS_LABEL)}
            </span>
          )}
        </div>

        <NomusOptionalPricingSelectionPanel
          disabled={disabled}
          selectedParentCode={selectedParentCode}
          selectedParentDescription={selectedParentDescription}
          selectedIndusProductId={selectedIndusProductId}
          onWorkspaceParentChange={onWorkspaceParentChange}
          productFocusMode
          embedded
        />
      </section>

      <section className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="text-sm font-bold">Itens locais para revisão</h5>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Linhas só no ProductBOM (ex.: montagem 800.01). Decisão altera apenas o preview da
              BOM efetiva.
            </p>
          </div>
          {localPending === 0 && catalog.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-bold text-green-800">
              <CheckCircle2 className="h-3 w-3" />
              Revisão local concluída
            </span>
          ) : localPending > 0 ? (
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-900">
              {localPending} pendente(s)
            </span>
          ) : null}
        </div>

        {bom || catalog.length > 0 ? (
          <NomusLocalReviewSection
            parentCode={bom?.parentCode ?? selectedParentCode}
            parentProductId={bom?.indusProductId}
            catalog={catalog}
            disabled={disabled || loading}
            compactHeader
            onSaved={() => void loadBom(selectedParentCode)}
          />
        ) : loading ? (
          <p className="text-xs text-muted-foreground">Carregando itens locais…</p>
        ) : null}
      </section>
    </div>
  );
};
