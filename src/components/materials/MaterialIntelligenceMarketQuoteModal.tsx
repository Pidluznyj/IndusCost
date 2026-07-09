import React from "react";
import { X } from "lucide-react";
import { MaterialIntelligenceMarketQuoteForm } from "@/src/components/materials/MaterialIntelligenceMarketQuoteForm";

type Props = {
  open: boolean;
  materialId: string;
  defaultUnit: string;
  onClose: () => void;
  onCreated: () => void;
};

export function MaterialIntelligenceMarketQuoteModal({
  open,
  materialId,
  defaultUnit,
  onClose,
  onCreated,
}: Props) {
  if (!open) return null;

  const handleCreated = () => {
    onCreated();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 pt-10 backdrop-blur-sm sm:items-center sm:pt-4"
      data-testid="material-intelligence-market-quote-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="material-intelligence-market-quote-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3
              id="material-intelligence-market-quote-modal-title"
              className="text-base font-semibold"
            >
              Registrar cotação manual
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cada registro cria um novo histórico — nunca sobrescreve cotações anteriores.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted/50"
            data-testid="material-intelligence-market-quote-modal-close"
          >
            <X className="h-3.5 w-3.5" />
            Fechar
          </button>
        </div>
        <div className="px-5 py-4">
          <MaterialIntelligenceMarketQuoteForm
            materialId={materialId}
            defaultUnit={defaultUnit}
            onCreated={handleCreated}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
