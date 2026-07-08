import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Factory, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { MaterialProductFinancialImpactResponse } from "@/src/lib/materialProductFinancialImpact";
import { getMaterialMarketIntelligenceFinancialImpactApiPath } from "@/src/lib/materialsNavigation";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";

const DEBOUNCE_MS = 350;

type Props = {
  materialId: string;
  unit: string;
  defaultSimulatedPrice?: number | null;
  defaultBaselinePrice?: number | null;
};

function formatMargin(value: number | null): string {
  if (value == null) return "—";
  return `${formatNumber(value, 2)}%`;
}

function formatPct(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2)}%`;
}

export function MaterialIntelligenceFinancialImpactSection({
  materialId,
  unit,
  defaultSimulatedPrice,
  defaultBaselinePrice,
}: Props) {
  const [simulatedPrice, setSimulatedPrice] = useState(
    defaultSimulatedPrice != null ? String(defaultSimulatedPrice) : ""
  );
  const [baselinePrice, setBaselinePrice] = useState(
    defaultBaselinePrice != null ? String(defaultBaselinePrice) : ""
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MaterialProductFinancialImpactResponse | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      if (defaultSimulatedPrice != null && !simulatedPrice) {
        setSimulatedPrice(String(defaultSimulatedPrice));
      }
      if (defaultBaselinePrice != null && !baselinePrice) {
        setBaselinePrice(String(defaultBaselinePrice));
      }
      initializedRef.current = true;
    }
  }, [defaultSimulatedPrice, defaultBaselinePrice, simulatedPrice, baselinePrice]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const data = await fetchJsonOk<MaterialProductFinancialImpactResponse>(
            getMaterialMarketIntelligenceFinancialImpactApiPath(materialId, {
              simulatedPrice: simulatedPrice.trim() || undefined,
              baselinePrice: baselinePrice.trim() || undefined,
            })
          );
          setResult(data);
          if (!simulatedPrice.trim() && data.simulatedMaterialPriceBRL != null) {
            setSimulatedPrice(String(data.simulatedMaterialPriceBRL));
          }
          if (!baselinePrice.trim() && data.baselineMaterialPriceBRL != null) {
            setBaselinePrice(String(data.baselineMaterialPriceBRL));
          }
        } catch (e: unknown) {
          setError(
            e instanceof Error ? e.message : "Não foi possível calcular o impacto financeiro."
          );
          setResult(null);
        } finally {
          setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [materialId, simulatedPrice, baselinePrice]);

  return (
    <MaterialIntelligence360Section
      id="impactedProducts"
      title="Impacto financeiro"
      description="Produtos que consomem esta matéria-prima e efeito estimado na margem com preço simulado."
      className="xl:col-span-2"
    >
      <div className="space-y-4" data-testid="material-intelligence-financial-impact">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Simulação — não altera custo padrão nem tabela comercial.
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">
              Preço base da matéria ({unit})
            </span>
            <input
              type="number"
              min={0}
              step="any"
              value={baselinePrice}
              onChange={(e) => setBaselinePrice(e.target.value)}
              placeholder="Custo atual ou cotação anterior"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              data-testid="material-financial-impact-baseline-input"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">
              Preço simulado da matéria ({unit})
            </span>
            <input
              type="number"
              min={0}
              step="any"
              value={simulatedPrice}
              onChange={(e) => setSimulatedPrice(e.target.value)}
              placeholder="Última cotação ou valor desejado"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              data-testid="material-financial-impact-simulated-input"
            />
          </label>
        </div>

        {loading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center"
            data-testid="material-financial-impact-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Calculando impacto nos produtos…
          </div>
        ) : error ? (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
            data-testid="material-financial-impact-error"
          >
            {error}
          </div>
        ) : result ? (
          <>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>
                <Factory className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />
                {result.impactedProductCount} produto(s) impactado(s)
              </span>
              {result.marginLossCount > 0 ? (
                <span className="text-amber-800 font-medium">
                  {result.marginLossCount} com perda de margem
                </span>
              ) : null}
              {result.reajusteCount > 0 ? (
                <span className="text-red-800 font-medium">
                  {result.reajusteCount} com reajuste necessário
                </span>
              ) : null}
              <span>
                Limiar de reajuste: {formatNumber(result.marginThresholdPct, 0)}% (ou margem
                publicada)
              </span>
            </div>

            {result.items.length === 0 ? (
              <p
                className="text-sm text-muted-foreground py-4 text-center"
                data-testid="material-financial-impact-empty"
              >
                Nenhum produto utiliza esta matéria-prima diretamente na BOM.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table
                  className="min-w-full text-xs"
                  data-testid="material-financial-impact-table"
                >
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Produto</th>
                      <th className="px-3 py-2 text-right font-semibold">Qtd BOM</th>
                      <th className="px-3 py-2 text-right font-semibold">Custo anterior</th>
                      <th className="px-3 py-2 text-right font-semibold">Custo simulado</th>
                      <th className="px-3 py-2 text-right font-semibold">Δ custo</th>
                      <th className="px-3 py-2 text-right font-semibold">Preço venda</th>
                      <th className="px-3 py-2 text-right font-semibold">Margem ant.</th>
                      <th className="px-3 py-2 text-right font-semibold">Margem sim.</th>
                      <th className="px-3 py-2 text-center font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((row) => {
                      const rowClass = row.marginLoss
                        ? row.reajusteNecessario
                          ? "bg-red-50/80"
                          : "bg-amber-50/60"
                        : "";
                      const missingLabel =
                        row.missingData.sellingPrice || row.missingData.cost
                          ? "Dados indisponíveis"
                          : null;

                      return (
                        <tr
                          key={row.productId}
                          className={`border-t border-border ${rowClass}`}
                          data-testid={`material-financial-impact-row-${row.productId}`}
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium text-foreground">{row.sku}</div>
                            <div className="text-muted-foreground">{row.productName}</div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNumber(row.bomQuantity, 4)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.previousCost != null
                              ? formatCurrency(row.previousCost, 4)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.simulatedCost != null
                              ? formatCurrency(row.simulatedCost, 4)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.costDifferenceBRL != null ? (
                              <span
                                className={
                                  row.costDifferenceBRL > 0
                                    ? "text-red-700"
                                    : row.costDifferenceBRL < 0
                                      ? "text-emerald-700"
                                      : ""
                                }
                              >
                                {formatCurrency(row.costDifferenceBRL, 4)}
                                {row.costDifferencePct != null ? (
                                  <span className="block text-[10px]">
                                    {formatPct(row.costDifferencePct)}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.sellingPrice != null ? (
                              <>
                                {formatCurrency(row.sellingPrice, 2)}
                                {row.sellingPriceTableCode ? (
                                  <span className="block text-[10px] text-muted-foreground">
                                    {row.sellingPriceTableCode}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="text-muted-foreground">Dados indisponíveis</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatMargin(row.previousMargin)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatMargin(row.simulatedMargin)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {missingLabel ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {missingLabel}
                              </span>
                            ) : row.reajusteNecessario ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-900">
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                Reajuste
                              </span>
                            ) : row.marginLoss ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                                Perda margem
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">OK</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </MaterialIntelligence360Section>
  );
}
