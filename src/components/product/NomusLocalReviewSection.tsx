import React, { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  LocalReviewCatalogItem,
  NomusBomReviewDecisionType,
} from "@/src/lib/nomusEffectivePricingBomTypes";
import {
  REVIEW_DECISION_BADGE,
  REVIEW_DECISION_OPTIONS,
  isLocalAssemblyComponentCode,
} from "@/src/lib/nomusEffectivePricingBomTypes";

type ReviewDraft = {
  decision: NomusBomReviewDecisionType;
  relatedNomusComponentCode: string;
  notes: string;
};

function formatQty(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function placementBadgeClass(placement: LocalReviewCatalogItem["placement"]): string {
  switch (placement) {
    case "included":
      return "bg-green-100 text-green-800";
    case "excluded":
      return "bg-muted text-muted-foreground";
    case "engineering_review":
      return "bg-blue-100 text-blue-900";
    default:
      return "bg-amber-100 text-amber-900";
  }
}

function localItemContextHint(item: LocalReviewCatalogItem): string {
  if (item.indusComponentKind === "PRODUCT") {
    return "Subproduto na ProductBOM, ausente na BOM Nomus efetiva atual deste pai.";
  }
  if (item.indusComponentKind === "MATERIAL") {
    return "Matéria-prima na ProductBOM, ausente na BOM Nomus efetiva atual deste pai.";
  }
  return "Item na ProductBOM do IndusCost, não encontrado na BOM Nomus efetiva atual deste pai.";
}

function placementLabel(placement: LocalReviewCatalogItem["placement"]): string {
  switch (placement) {
    case "included":
      return "Na BOM efetiva";
    case "excluded":
      return "Excluído";
    case "engineering_review":
      return "Engenharia";
    default:
      return "Pendente";
  }
}

export type NomusLocalReviewSectionProps = {
  parentCode: string;
  parentProductId?: string | null;
  catalog: LocalReviewCatalogItem[];
  disabled?: boolean;
  onSaved: () => void;
  /** Oculta título/descrição quando já exibidos pelo container pai. */
  compactHeader?: boolean;
};

export const NomusLocalReviewSection: React.FC<NomusLocalReviewSectionProps> = ({
  parentCode,
  parentProductId,
  catalog,
  disabled,
  onSaved,
  compactHeader = false,
}) => {
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getDraft = (item: LocalReviewCatalogItem): ReviewDraft => {
    const key = item.productBomLineId;
    if (drafts[key]) return drafts[key];
    const saved = item.savedDecision;
    const defaultDecision: NomusBomReviewDecisionType = isLocalAssemblyComponentCode(
      item.componentCode
    )
      ? "INCLUDE_AS_LOCAL_EXCEPTION"
      : "PENDING";
    return {
      decision: saved?.decision ?? defaultDecision,
      relatedNomusComponentCode: saved?.relatedNomusComponentCode ?? "",
      notes: saved?.notes ?? "",
    };
  };

  const setDraftField = (productBomLineId: string, patch: Partial<ReviewDraft>) => {
    setDrafts((prev) => {
      const item = catalog.find((c) => c.productBomLineId === productBomLineId);
      const current = prev[productBomLineId] ?? (item ? getDraft(item) : {
        decision: "PENDING" as const,
        relatedNomusComponentCode: "",
        notes: "",
      });
      return { ...prev, [productBomLineId]: { ...current, ...patch } };
    });
  };

  const saveItem = async (item: LocalReviewCatalogItem) => {
    const draft = getDraft(item);
    setSavingId(item.productBomLineId);
    setError(null);
    try {
      await fetchJsonOk("/api/nomus/effective-pricing-bom/review-decisions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentCode,
          parentProductId: parentProductId ?? null,
          productBomLineId: item.productBomLineId,
          componentCode: item.componentCode,
          componentDescription: item.componentDescription,
          quantitySnapshot: item.quantity,
          decision: draft.decision,
          relatedNomusComponentCode:
            draft.decision === "DUPLICATED_BY_NOMUS_COMPONENT"
              ? draft.relatedNomusComponentCode.trim() || null
              : null,
          notes: draft.notes.trim() || null,
        }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar decisão.");
    } finally {
      setSavingId(null);
    }
  };

  const items = catalog ?? [];
  if (items.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Nenhum item exclusivo do IndusCost (ProductBOM) para revisar neste produto.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {!compactHeader ? (
        <div>
          <p className="text-xs font-bold">Itens locais para revisão</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Itens na ProductBOM do IndusCost que não constam na BOM Nomus efetiva atual do produto.
            Use &quot;Manter na BOM&quot; para incluir na precificação e preservar a linha no apply.
            Matérias-primas conhecidas no Nomus mas fora desta BOM podem ser sugeridas para exclusão
            automática; subprodutos exigem decisão explícita.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        {items.map((item) => {
          const draft = getDraft(item);
          const savedType = item.savedDecision?.decision ?? "PENDING";
          const badgeLabel =
            savedType === "PENDING" ? "Pendente" : REVIEW_DECISION_BADGE[savedType] ?? "Resolvido";
          const isAutoObsoleteSuggestion =
            savedType === "EXCLUDE_FROM_PRICING" &&
            !item.savedDecision?.id &&
            (item.savedDecision?.reason?.startsWith("Item existe no universo Nomus") ?? false);

          return (
            <div
              key={item.productBomLineId}
              className="rounded-lg border border-border bg-background p-3 space-y-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">
                    {item.componentCode}
                    {item.componentDescription ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        — {item.componentDescription}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Qtd IndusCost: {formatQty(item.quantity)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {localItemContextHint(item)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                      placementBadgeClass(item.placement)
                    )}
                  >
                    {placementLabel(item.placement)}
                  </span>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                      savedType === "PENDING"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-slate-100 text-slate-800"
                    )}
                  >
                    {badgeLabel}
                  </span>
                </div>
              </div>

              {isAutoObsoleteSuggestion ? (
                <p className="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Sugestão automática: não considerar na precificação (código no ecossistema Nomus,
                  ausente nesta BOM). Salve &quot;Manter na BOM&quot; para preservar na estrutura e
                  no apply.
                </p>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Decisão
                  </label>
                  <select
                    value={draft.decision}
                    onChange={(e) =>
                      setDraftField(item.productBomLineId, {
                        decision: e.target.value as NomusBomReviewDecisionType,
                      })
                    }
                    className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs"
                  >
                    {REVIEW_DECISION_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                {draft.decision === "DUPLICATED_BY_NOMUS_COMPONENT" ? (
                  <div>
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Componente Nomus relacionado
                    </label>
                    <input
                      value={draft.relatedNomusComponentCode}
                      onChange={(e) =>
                        setDraftField(item.productBomLineId, {
                          relatedNomusComponentCode: e.target.value,
                        })
                      }
                      placeholder="Ex.: 309.81BB"
                      className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs"
                    />
                  </div>
                ) : null}
                <div
                  className={
                    draft.decision === "DUPLICATED_BY_NOMUS_COMPONENT" ? "" : "sm:col-span-2"
                  }
                >
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Observação
                  </label>
                  <input
                    value={draft.notes}
                    onChange={(e) =>
                      setDraftField(item.productBomLineId, { notes: e.target.value })
                    }
                    placeholder="Motivo ou contexto da decisão"
                    className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={disabled || savingId === item.productBomLineId}
                onClick={() => void saveItem(item)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {savingId === item.productBomLineId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Salvar decisão
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
