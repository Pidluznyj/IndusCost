import React, { useCallback, useEffect, useState } from "react";
import { Clock, Link2, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatMaterialIntelligenceQuoteDate } from "@/src/lib/materialIntelligence360Sections";
import type { MaterialMarketPurchaseLinkApiItem } from "@/src/lib/materialMarketPurchaseLink";
import {
  buildMaterialMarketPurchaseTimeline,
  MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA,
} from "@/src/lib/materialMarketPurchaseLink";
import { getMaterialMarketIntelligencePurchaseLinksApiPath } from "@/src/lib/materialsNavigation";
import { formatCurrency } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";

type Props = {
  materialId: string;
  refreshKey?: number;
};

export function MaterialIntelligencePurchaseTimelineSection({
  materialId,
  refreshKey = 0,
}: Props) {
  const [links, setLinks] = useState<MaterialMarketPurchaseLinkApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<{ items: MaterialMarketPurchaseLinkApiItem[] }>(
        getMaterialMarketIntelligencePurchaseLinksApiPath(materialId)
      );
      setLinks(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      setLinks([]);
      setError(e instanceof Error ? e.message : "Não foi possível carregar a timeline.");
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const timeline = buildMaterialMarketPurchaseTimeline(links);

  return (
    <MaterialIntelligence360Section
      id="timeline"
      title="Timeline de compras"
      description="Compras reais vinculadas a cotações de mercado e economia obtida."
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando timeline…
        </div>
      ) : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : timeline.items.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
          data-testid="material-intelligence-360-timeline-empty"
        >
          <Clock className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            Nenhuma compra vinculada ainda.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use “Vincular compra” nas cotações para registrar a decisão de compra.
          </p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="material-intelligence-360-timeline">
          <p className="text-xs text-muted-foreground">
            Economia total obtida:{" "}
            <span className="font-semibold text-emerald-800">
              {formatCurrency(timeline.totalEstimatedSavings)} BRL
            </span>
            <span className="ml-2 text-[10px] opacity-80">
              ({MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA})
            </span>
          </p>
          <ol className="space-y-2 border-l border-border pl-4">
            {timeline.items.map((event) => (
              <li
                key={event.id}
                className="relative"
                data-testid={`material-intelligence-timeline-event-${event.id}`}
              >
                <span className="absolute -left-[1.35rem] top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card">
                  <Link2 className="h-3 w-3 text-primary" aria-hidden="true" />
                </span>
                <div className="rounded-lg border border-border bg-muted/10 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{event.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatMaterialIntelligenceQuoteDate(event.purchaseDate)}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>
                  <p
                    className={`mt-1 text-xs font-semibold ${
                      event.hasSavings ? "text-emerald-800" : "text-muted-foreground"
                    }`}
                  >
                    Economia obtida: {formatCurrency(event.estimatedSavings)} BRL
                  </p>
                  {event.purchaseOrderNumber ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Pedido: {event.purchaseOrderNumber}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </MaterialIntelligence360Section>
  );
}
