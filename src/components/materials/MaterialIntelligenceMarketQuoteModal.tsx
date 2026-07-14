import React from "react";
import type { MaterialMarketQuoteApiItem } from "@/src/lib/materialMarketQuote";
import { MaterialIntelligenceMarketQuoteForm } from "@/src/components/materials/MaterialIntelligenceMarketQuoteForm";
import {
  Overlay,
  OverlayBody,
  OverlayHeader,
} from "@/src/components/ui/overlay";

type Props = {
  open: boolean;
  materialId: string;
  defaultUnit: string;
  quote?: MaterialMarketQuoteApiItem | null;
  onClose: () => void;
  onSaved: () => void;
};

export function MaterialIntelligenceMarketQuoteModal({
  open,
  materialId,
  defaultUnit,
  quote = null,
  onClose,
  onSaved,
}: Props) {
  const isEditMode = quote != null;
  const titleId = "material-intelligence-market-quote-modal-title";

  const handleSaved = () => {
    onSaved();
    onClose();
  };

  return (
    <Overlay
      open={open}
      onClose={onClose}
      size="lg"
      ariaLabelledBy={titleId}
      testId="material-intelligence-market-quote-modal"
    >
      <OverlayHeader
        titleId={titleId}
        eyebrow="Materiais · Inteligência de mercado"
        title={isEditMode ? "Editar cotação manual" : "Registrar cotação manual"}
        subtitle={
          isEditMode
            ? "Alterações recalculam o preço líquido no servidor e não alteram custos oficiais."
            : "Cada registro cria um novo histórico — nunca sobrescreve cotações anteriores."
        }
        onClose={onClose}
        testId="material-intelligence-market-quote-modal-header"
      />
      <OverlayBody>
        <MaterialIntelligenceMarketQuoteForm
          materialId={materialId}
          defaultUnit={defaultUnit}
          quote={quote}
          onCreated={handleSaved}
          onCancel={onClose}
        />
      </OverlayBody>
    </Overlay>
  );
}
