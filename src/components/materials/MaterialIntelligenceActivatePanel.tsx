import React from "react";
import { Loader2, Radar } from "lucide-react";
import {
  DEFAULT_MATERIAL_MARKET_CRITICALITY,
  DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
  MATERIAL_MARKET_CRITICALITY_LABELS,
  MATERIAL_MARKET_CRITICALITY_VALUES,
  type MaterialMarketCriticality,
} from "@/src/lib/materialMarketMonitoring";

type Props = {
  criticality: MaterialMarketCriticality;
  frequency: number;
  activating: boolean;
  error: string | null;
  onCriticalityChange: (value: MaterialMarketCriticality) => void;
  onFrequencyChange: (value: number) => void;
  onActivate: () => void;
};

export function MaterialIntelligenceActivatePanel({
  criticality,
  frequency,
  activating,
  error,
  onCriticalityChange,
  onFrequencyChange,
  onActivate,
}: Props) {
  return (
    <div
      className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-5 space-y-4"
      data-testid="materials-market-intelligence-activate-panel"
    >
      <div className="flex items-start gap-3">
        <Radar className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Ativar monitoramento de mercado</p>
          <p className="text-sm text-muted-foreground mt-1">
            Esta matéria-prima ainda não está no radar de Inteligência de Mercado. Ative o
            monitoramento para acompanhá-la na home e desbloquear os sinais desta visão 360º.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Criticidade</span>
          <select
            value={criticality}
            onChange={(e) => onCriticalityChange(e.target.value as MaterialMarketCriticality)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            data-testid="material-intelligence-activate-criticality"
          >
            {MATERIAL_MARKET_CRITICALITY_VALUES.map((value) => (
              <option key={value} value={value}>
                {MATERIAL_MARKET_CRITICALITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Frequência (dias)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={frequency}
            onChange={(e) => onFrequencyChange(parseInt(e.target.value, 10) || 1)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            data-testid="material-intelligence-activate-frequency"
          />
        </label>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="button"
        onClick={onActivate}
        disabled={activating}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        data-testid="material-intelligence-activate-button"
      >
        {activating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Radar className="h-4 w-4" />
        )}
        Ativar monitoramento
      </button>
    </div>
  );
}

export {
  DEFAULT_MATERIAL_MARKET_CRITICALITY,
  DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
};
