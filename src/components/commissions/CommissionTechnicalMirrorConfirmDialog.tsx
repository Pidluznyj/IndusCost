import React from "react";
import { COMMISSION_LEGACY_REPORT_TEXT } from "@/src/lib/commissions/commissionCoverageCutover";

export const COMMISSION_TECHNICAL_MIRROR_CONFIRM_TEST_ID = "commission-technical-mirror-confirm";

/**
 * "TENHO CIÊNCIA" antes de exportar/imprimir o espelho técnico de uma competência do
 * histórico Nomus. A confirmação NÃO é lembrada: cada exportação pede de novo.
 */
export function CommissionTechnicalMirrorConfirmDialog({
  open,
  periodLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** "08/2026". */
  periodLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  const text = COMMISSION_LEGACY_REPORT_TEXT;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="commission-technical-mirror-confirm-title"
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
        data-testid={COMMISSION_TECHNICAL_MIRROR_CONFIRM_TEST_ID}
      >
        <h4 id="commission-technical-mirror-confirm-title" className="text-lg font-extrabold uppercase">
          {text.confirmTitle}
        </h4>
        <p className="mt-1 text-xs font-semibold text-amber-800">
          Competência {periodLabel} · {text.officialSourceLine}
        </p>
        {text.confirmBody.map((paragraph) => (
          <p key={paragraph} className="mt-2 text-sm text-[#111827]">
            {paragraph}
          </p>
        ))}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-sm font-medium text-[#374151] hover:bg-muted/40"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
            onClick={onConfirm}
            data-testid="commission-technical-mirror-confirm-action"
          >
            {text.confirmAction}
          </button>
        </div>
      </div>
    </div>
  );
}
