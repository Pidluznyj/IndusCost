import React, { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { fetchOk } from "@/src/lib/http";
import {
  MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS,
  MATERIAL_MARKET_QUOTE_RELIABILITY_LEVELS,
  type MaterialMarketQuoteReliabilityLevel,
} from "@/src/lib/materialMarketQuoteReliability";
import { getMaterialMarketQuoteReliabilityApiPath } from "@/src/lib/materialsNavigation";
import { MaterialIntelligenceQuoteReliabilityBadge } from "@/src/components/materials/MaterialIntelligenceQuoteReliabilityBadge";

type Props = {
  materialId: string;
  quoteId: string;
  currentLevel: MaterialMarketQuoteReliabilityLevel;
  suggestedLevel: MaterialMarketQuoteReliabilityLevel | null;
  overrideReason?: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function MaterialIntelligenceQuoteReliabilityModal({
  materialId,
  quoteId,
  currentLevel,
  suggestedLevel,
  overrideReason,
  open,
  onClose,
  onSaved,
}: Props) {
  const [level, setLevel] = useState<MaterialMarketQuoteReliabilityLevel>(currentLevel);
  const [justification, setJustification] = useState(overrideReason ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLevel(currentLevel);
    setJustification(overrideReason ?? "");
    setError(null);
  }, [open, currentLevel, overrideReason]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await fetchOk(getMaterialMarketQuoteReliabilityApiPath(materialId, quoteId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, justification }),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar o ajuste.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      data-testid="material-quote-reliability-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="material-quote-reliability-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg">
        <div className="mb-4 flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <h3
              id="material-quote-reliability-modal-title"
              className="text-base font-semibold"
            >
              Ajustar confiabilidade
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Defina o nível aplicado e informe a justificativa do ajuste.
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Atual</p>
            <MaterialIntelligenceQuoteReliabilityBadge level={currentLevel} showSuggestionHint={false} />
          </div>
          {suggestedLevel ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Sugestão automática</p>
              <MaterialIntelligenceQuoteReliabilityBadge
                level={suggestedLevel}
                showSuggestionHint={false}
              />
            </div>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reliability-level" className="mb-1 block text-sm font-medium">
              Nível de confiabilidade
            </label>
            <select
              id="reliability-level"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={level}
              onChange={(e) =>
                setLevel(e.target.value as MaterialMarketQuoteReliabilityLevel)
              }
              data-testid="material-quote-reliability-level-select"
            >
              {MATERIAL_MARKET_QUOTE_RELIABILITY_LEVELS.map((option) => (
                <option key={option} value={option}>
                  {option} — {MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="reliability-justification" className="mb-1 block text-sm font-medium">
              Justificativa <span className="text-destructive">*</span>
            </label>
            <textarea
              id="reliability-justification"
              className="min-h-[96px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Descreva por que o nível foi ajustado em relação à sugestão automática."
              required
              data-testid="material-quote-reliability-justification"
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted/50"
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              disabled={submitting || !justification.trim()}
              data-testid="material-quote-reliability-save"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Salvar ajuste
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
