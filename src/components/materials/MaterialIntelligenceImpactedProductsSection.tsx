import React, { useCallback, useEffect, useState } from "react";
import { Factory, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MATERIAL_BOM_IMPACT_EMPTY_MESSAGE,
  type MaterialBomImpactResponse,
} from "@/src/lib/materialBomImpact.types";
import { getMaterialMarketIntelligenceImpactedProductsApiPath } from "@/src/lib/materialsNavigation";
import { formatCurrency, formatNumberAdaptive } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { MaterialMarketIntelligenceExportButtons } from "@/src/components/materials/MaterialMarketIntelligenceExportButtons";

type Props = {
  materialId: string;
};

function formatQty(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "—";
  return `${formatNumberAdaptive(value)} ${unit}`.trim();
}

export function MaterialIntelligenceImpactedProductsSection({ materialId }: Props) {
  const [data, setData] = useState<MaterialBomImpactResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJsonOk<MaterialBomImpactResponse>(
        getMaterialMarketIntelligenceImpactedProductsApiPath(materialId)
      );
      setData(response);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error ? e.message : "Não foi possível carregar os produtos impactados."
      );
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <MaterialIntelligence360Section
      id="impactedProducts"
      title="Produtos Impactados"
      description="Produtos e estruturas que consomem esta matéria-prima na BOM oficial."
    >
      <div className="mb-3 flex justify-end">
        <MaterialMarketIntelligenceExportButtons
          scope="impacted-products"
          filters={{ materialId }}
        />
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando produtos impactados…
        </div>
      ) : error ? (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          data-testid="material-impacted-products-error"
        >
          {error}
        </div>
      ) : !data?.hasLinks || data.items.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
          data-testid="material-intelligence-360-impacted-products-empty"
        >
          <Factory className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            {MATERIAL_BOM_IMPACT_EMPTY_MESSAGE}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {data.totalProducts} produto(s) com consumo direto na ProductBOM
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table
              className="w-full text-left text-sm"
              data-testid="material-intelligence-impacted-products-table"
            >
              <thead>
                <tr className="border-b border-border bg-accent/40">
                  <th className="p-3 font-semibold">Componente</th>
                  <th className="p-3 font-semibold">Produto</th>
                  <th className="p-3 font-semibold text-right">Qtd consumida</th>
                  <th className="p-3 font-semibold text-right">Custo estimado</th>
                  <th className="p-3 font-semibold text-right">Impacto potencial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((row) => (
                  <tr
                    key={row.productId}
                    data-testid={`material-impacted-product-row-${row.productId}`}
                  >
                    <td className="p-3 text-muted-foreground">
                      {row.componentName?.trim() || "—"}
                    </td>
                    <td className="p-3">
                      <span className="font-medium">{row.productName}</span>
                      <p className="text-xs text-muted-foreground">{row.productSku}</p>
                    </td>
                    <td className="p-3 text-right">
                      {formatQty(row.quantityConsumed, row.unit)}
                    </td>
                    <td className="p-3 text-right font-semibold text-primary">
                      {formatCurrency(row.estimatedCurrentCost)}
                    </td>
                    <td className="p-3 text-right">
                      {row.potentialImpact != null && row.potentialImpact > 0
                        ? formatCurrency(row.potentialImpact)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </MaterialIntelligence360Section>
  );
}
