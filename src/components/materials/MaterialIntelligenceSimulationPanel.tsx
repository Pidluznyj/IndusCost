import React, { useState } from "react";
import { AlertTriangle, FlaskConical, Loader2, RotateCcw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { MaterialMarketSimulationResponse } from "@/src/lib/materialMarketSimulation";
import type { MaterialMarketSimulationMode } from "@/src/lib/materialMarketSimulation";
import { getMaterialMarketIntelligenceSimulateApiPath } from "@/src/lib/materialsNavigation";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { MaterialIntelligenceSimulationComparison } from "@/src/components/materials/MaterialIntelligenceSimulationComparison";

type SimulationModeTab = "PCT_INCREASE" | "PCT_DECREASE" | "MANUAL_PRICE";

type Props = {
  materialId: string;
  unit: string;
};

const MODE_LABELS: Record<SimulationModeTab, string> = {
  PCT_INCREASE: "Aumento %",
  PCT_DECREASE: "Redução %",
  MANUAL_PRICE: "Novo preço manual",
};

export function MaterialIntelligenceSimulationPanel({ materialId, unit }: Props) {
  const [mode, setMode] = useState<SimulationModeTab>("PCT_INCREASE");
  const [value, setValue] = useState("10");
  const [manualUsd, setManualUsd] = useState("");
  const [manualBrent, setManualBrent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MaterialMarketSimulationResponse | null>(null);

  const handleSimulate = async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedValue = Number(value.replace(",", "."));
      if (!Number.isFinite(parsedValue)) {
        throw new Error("Informe um valor numérico válido.");
      }

      const body: {
        mode: MaterialMarketSimulationMode;
        value: number;
        manualUsd?: number;
        manualBrent?: number;
      } = {
        mode,
        value: parsedValue,
      };

      const usd = manualUsd.trim() ? Number(manualUsd.replace(",", ".")) : undefined;
      const brent = manualBrent.trim() ? Number(manualBrent.replace(",", ".")) : undefined;
      if (usd != null && Number.isFinite(usd)) body.manualUsd = usd;
      if (brent != null && Number.isFinite(brent)) body.manualBrent = brent;

      const data = await fetchJsonOk<MaterialMarketSimulationResponse>(
        getMaterialMarketIntelligenceSimulateApiPath(materialId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível executar a simulação.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setResult(null);
    setError(null);
  };

  return (
    <MaterialIntelligence360Section
      id="simulation"
      title="Simulação what-if"
      description="Cenários temporários de preço, impacto em produtos e margem — sem alterar dados oficiais."
      className="xl:col-span-2"
    >
      <div className="space-y-4" data-testid="material-intelligence-simulation-panel">
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
          data-testid="material-intelligence-simulation-disclaimer"
        >
          Simulação temporária — dados oficiais não são alterados.
        </div>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Modo de simulação">
          {(Object.keys(MODE_LABELS) as SimulationModeTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={mode === tab}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === tab
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMode(tab)}
              data-testid={`material-intelligence-simulation-mode-${tab}`}
            >
              {MODE_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {mode === "MANUAL_PRICE" ? `Novo preço (${unit})` : "Percentual (%)"}
            </span>
            <input
              type="number"
              step="any"
              min={0}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              data-testid="material-intelligence-simulation-value"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Novo dólar (opcional)</span>
            <input
              type="number"
              step="any"
              min={0}
              value={manualUsd}
              onChange={(e) => setManualUsd(e.target.value)}
              placeholder="Ex.: 5,45"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              data-testid="material-intelligence-simulation-manual-usd"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Novo Brent (opcional)</span>
            <input
              type="number"
              step="any"
              min={0}
              value={manualBrent}
              onChange={(e) => setManualBrent(e.target.value)}
              placeholder="Contextual"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              data-testid="material-intelligence-simulation-manual-brent"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => void handleSimulate()}
              disabled={loading}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              data-testid="material-intelligence-simulation-run"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
              )}
              Simular
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
              data-testid="material-intelligence-simulation-clear"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Limpar
            </button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-red-700" data-testid="material-intelligence-simulation-error">
            {error}
          </p>
        ) : null}

        <MaterialIntelligenceSimulationComparison
          comparison={result?.comparison ?? null}
          unit={unit}
        />

        {result ? (
          <div className="space-y-4" data-testid="material-intelligence-simulation-results">
            {result.simulationLabel ? (
              <p className="text-xs text-muted-foreground">{result.simulationLabel}</p>
            ) : null}

            {result.brentContextNote ? (
              <p className="text-xs text-muted-foreground">{result.brentContextNote}</p>
            ) : null}

            {result.criticalProducts.length > 0 ? (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                data-testid="material-intelligence-simulation-critical"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {result.criticalProducts.length} produto(s) crítico(s)
                </div>
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {result.criticalProducts.slice(0, 5).map((row) => (
                    <li key={row.productId}>
                      {row.sku} — {row.criticalReason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.productImpacts.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table
                  className="min-w-full text-sm"
                  data-testid="material-intelligence-simulation-products-table"
                >
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Produto</th>
                      <th className="px-3 py-2">Custo anterior</th>
                      <th className="px-3 py-2">Custo simulado</th>
                      <th className="px-3 py-2">Δ custo</th>
                      <th className="px-3 py-2">Margem ant.</th>
                      <th className="px-3 py-2">Margem sim.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.productImpacts.map((row) => (
                      <tr
                        key={row.productId}
                        className={row.isCritical ? "bg-red-50/60" : undefined}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium">{row.sku}</div>
                          <div className="text-xs text-muted-foreground">{row.productName}</div>
                        </td>
                        <td className="px-3 py-2">
                          {row.previousCost != null ? formatCurrency(row.previousCost) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row.simulatedCost != null ? formatCurrency(row.simulatedCost) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row.costDifferenceBRL != null
                            ? formatCurrency(row.costDifferenceBRL)
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row.previousMargin != null
                            ? `${formatNumber(row.previousMargin)}%`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row.simulatedMargin != null
                            ? `${formatNumber(row.simulatedMargin)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum produto com BOM direta encontrado para esta matéria-prima.
              </p>
            )}

            <p className="text-xs text-muted-foreground">{result.disclaimer}</p>
          </div>
        ) : null}
      </div>
    </MaterialIntelligence360Section>
  );
}
