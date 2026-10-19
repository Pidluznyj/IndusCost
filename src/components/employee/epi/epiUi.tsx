import React, { useState } from "react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import { cn } from "@/src/lib/utils";
import {
  EPI_DELIVERY_STATUS_LABELS,
  EPI_DUE_BAND_LABELS,
  EPI_LIMITS,
  type EpiDeliveryStatus,
  type EpiDueBand,
  type EpiItemType,
  type EpiUnit,
} from "@/src/lib/epi/epiRules";
import { EPI_DOCUMENT_STATUS_LABELS, type EpiDocumentStatus } from "@/src/lib/epi/epiForm";

export const EPI_BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60";
export const EPI_BTN_SECONDARY =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60";
export const EPI_BTN_LINK = "text-xs font-medium text-primary hover:underline disabled:opacity-50";
export const EPI_INPUT =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-muted/40";

export type EpiItem = {
  id: string;
  code: string;
  description: string;
  type: EpiItemType;
  caNumber: string | null;
  unit: EpiUnit;
  replacementDays: number | null;
  notes: string | null;
  active: boolean;
  deliveryCount: number;
  canDelete: boolean;
};

export type EpiDelivery = {
  id: string;
  item: string;
  itemId: string | null;
  itemCode: string | null;
  itemType: EpiItemType | null;
  itemCaNumber: string | null;
  itemUnit: EpiUnit | null;
  deliveredAt: string;
  quantity: number;
  size: string | null;
  responsibleName: string | null;
  createdByName: string | null;
  notes: string | null;
  validUntil: string | null;
  returnedAt: string | null;
  replacementDays: number | null;
  replacementDueDate: string | null;
  replacementAdjustReason: string | null;
  status: EpiDeliveryStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedByName: string | null;
  replacedByDeliveryId: string | null;
  eventId: string;
  dueBand: EpiDueBand | null;
  daysLeft: number | null;
};

export type EpiReceiptRow = {
  id: string;
  formId: string | null;
  formDocumentNumber: string | null;
  documentId: string;
  originalFileName: string;
  mimeType: string | null;
  fileSize: number;
  fileSha256: string;
  status: "CURRENT" | "SUPERSEDED";
  supersededAt: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
  batchId: string | null;
  validationResult: "APPROVED" | "REJECTED" | null;
  validatedAt: string | null;
  validatedByName: string | null;
  validationNote: string | null;
};

/** Entrega (evento): data, itens (cada um com vencimento próprio), ficha e comprovantes. */
export type EpiEvent = {
  id: string;
  deliveredAt: string;
  responsibleName: string | null;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  itemCount: number;
  activeItemCount: number;
  items: EpiDelivery[];
  forms: EpiFormRevision[];
  receipts: EpiReceiptRow[];
  document: { status: EpiDocumentStatus; outdatedReceipt: boolean; rejected: boolean };
};

export type EpiFormRevision = {
  id: string;
  documentNumber: string;
  revision: number;
  status: "ACTIVE" | "SUPERSEDED";
  issuedAt: string;
  issuedByName: string | null;
  printCount: number;
  lastPrintedAt: string;
};

const DOC_TONE: Record<EpiDocumentStatus, string> = {
  NOT_ISSUED: "bg-slate-100 text-slate-600 border-slate-200",
  AWAITING_SIGNATURE: "bg-amber-50 text-amber-800 border-amber-200",
  ATTACHED: "bg-sky-50 text-sky-700 border-sky-200",
  VALIDATED: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function EpiDocumentBadge({ status }: { status: EpiDocumentStatus }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", DOC_TONE[status])}
      data-testid="epi-document-badge"
      data-status={status}
    >
      {EPI_DOCUMENT_STATUS_LABELS[status]}
    </span>
  );
}

export function formatIsoDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const STATUS_TONE: Record<EpiDeliveryStatus, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REPLACED: "bg-slate-100 text-slate-700 border-slate-200",
  CLOSED: "bg-slate-100 text-slate-600 border-slate-200",
  CANCELLED: "bg-rose-50 text-rose-700 border-rose-200",
};

const BAND_TONE: Record<EpiDueBand, string> = {
  OVERDUE: "bg-rose-50 text-rose-700 border-rose-200",
  DUE_30: "bg-amber-50 text-amber-800 border-amber-200",
  DUE_60: "bg-sky-50 text-sky-700 border-sky-200",
};

export function EpiStatusBadge({ status, title }: { status: EpiDeliveryStatus; title?: string | null }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[status])}
      title={title ?? undefined}
      data-testid="epi-status-badge"
    >
      {EPI_DELIVERY_STATUS_LABELS[status]}
    </span>
  );
}

export function EpiDueBadge({ band, daysLeft }: { band: EpiDueBand; daysLeft: number | null }) {
  const text =
    band === "OVERDUE"
      ? `Vencido há ${Math.abs(daysLeft ?? 0)} dia(s)`
      : daysLeft === 0
        ? "Vence hoje"
        : `${EPI_DUE_BAND_LABELS[band]} · ${daysLeft} dia(s)`;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", BAND_TONE[band])}>
      {text}
    </span>
  );
}

/** Pergunta o motivo (cancelar / encerrar). */
export function EpiReasonPrompt({
  open,
  title,
  description,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = reason.trim().length < EPI_LIMITS.reasonMin;
  return (
    <Overlay open={open} onClose={onCancel} size="sm" ariaLabelledBy="epi-reason-title" testId="epi-reason-prompt">
      <OverlayHeader titleId="epi-reason-title" eyebrow="EPI / Uniformes" title={title} onClose={onCancel} />
      <OverlayBody>
        <div className="space-y-3 text-sm">
          <div className="text-muted-foreground">{description}</div>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Motivo (obrigatório)</span>
            <textarea
              className={EPI_INPUT}
              rows={3}
              maxLength={EPI_LIMITS.reason}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`Mínimo de ${EPI_LIMITS.reasonMin} caracteres`}
              autoFocus
            />
          </label>
          {error ? <p className="text-xs font-medium text-rose-700">{error}</p> : null}
        </div>
      </OverlayBody>
      <OverlayFooter>
        <button type="button" className={EPI_BTN_SECONDARY} onClick={onCancel} disabled={busy}>
          Voltar
        </button>
        <button
          type="button"
          className={cn(EPI_BTN_PRIMARY, danger && "bg-rose-600 hover:bg-rose-700")}
          disabled={busy || tooShort}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm(reason.trim());
            } catch (err) {
              setError(err instanceof Error ? err.message : "Não foi possível concluir.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
