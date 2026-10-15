import React, { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader, type OverlaySize } from "@/src/components/ui/overlay";
import { BTN_PRIMARY, BTN_SECONDARY } from "./competencyUi";

/**
 * Moldura comum dos modais do módulo: cabeçalho, corpo, rodapé com texto de contexto à
 * esquerda, Cancelar e a ação primária (desabilitada até o formulário ser válido).
 */
export function CompetencyModalFrame({
  open,
  title,
  subtitle,
  saveLabel,
  footerHint,
  canSave,
  onSave,
  onClose,
  size = "lg",
  testId,
  children,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  saveLabel: string;
  footerHint: React.ReactNode;
  canSave: boolean;
  /** Lança erro com mensagem pt-BR para exibir no modal. */
  onSave: () => Promise<void>;
  onClose: () => void;
  size?: OverlaySize;
  testId: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (saving) return;
    setError(null);
    onClose();
  };

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay open={open} onClose={close} size={size} ariaLabelledBy={titleId} testId={testId}>
      <OverlayHeader titleId={titleId} eyebrow="Gestão de pessoas · Competências" title={title} subtitle={subtitle} onClose={close} />
      <OverlayBody>
        {error ? (
          <div role="alert" data-testid={`${testId}-error`} className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        ) : null}
        <div className="space-y-5">{children}</div>
      </OverlayBody>
      <OverlayFooter hint={footerHint}>
        <button type="button" className={BTN_SECONDARY} onClick={close} disabled={saving}>
          Cancelar
        </button>
        <button type="button" className={BTN_PRIMARY} onClick={save} disabled={!canSave || saving} data-testid={`${testId}-save`}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {saveLabel}
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
