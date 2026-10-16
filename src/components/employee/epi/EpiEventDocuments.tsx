import React, { useState } from "react";
import { CheckCircle2, Download, ExternalLink, FileUp, History, Loader2, Printer, XCircle } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { EPI_BTN_LINK, EPI_BTN_PRIMARY, EPI_BTN_SECONDARY, EPI_INPUT, EpiDocumentBadge, formatIsoDay, type EpiEvent } from "./epiUi";

export function formPdfUrl(employeeId: string, eventId: string, formId: string, download = false): string {
  return `/api/employees/${employeeId}/epi-events/${eventId}/forms/${formId}/pdf${download ? "?download=1" : ""}`;
}

function receiptUrl(employeeId: string, documentId: string): string {
  return `/api/employees/${employeeId}/documents/${documentId}/download?inline=1`;
}

const formatDateTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";

/** Conferência do comprovante: aprovar ou rejeitar (rejeitar exige motivo). */
function ValidatePrompt({ onClose, onConfirm }: { onClose: () => void; onConfirm: (result: "APPROVED" | "REJECTED", note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (result: "APPROVED" | "REJECTED") => {
    setBusy(result);
    setError(null);
    try {
      await onConfirm(result, note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a conferência.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Overlay open onClose={onClose} size="sm" ariaLabelledBy="epi-validate-title" testId="epi-validate-prompt">
      <OverlayHeader titleId="epi-validate-title" eyebrow="EPI / Uniformes · Conferência" title="Conferir ficha assinada" onClose={onClose} />
      <OverlayBody>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Abra o comprovante e confira: número da ficha, itens, assinatura do colaborador, do responsável e a data do recebimento.
          </p>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Observação (obrigatória para rejeitar)</span>
            <textarea className={EPI_INPUT} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: falta a assinatura do colaborador" />
          </label>
          {error ? <p className="text-xs font-medium text-rose-700">{error}</p> : null}
        </div>
      </OverlayBody>
      <OverlayFooter>
        <button type="button" className={EPI_BTN_SECONDARY} onClick={onClose} disabled={busy !== null}>
          Voltar
        </button>
        <button
          type="button"
          className={cn(EPI_BTN_PRIMARY, "bg-rose-600 hover:bg-rose-700")}
          disabled={busy !== null || note.trim().length < 5}
          onClick={() => void run("REJECTED")}
        >
          {busy === "REJECTED" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Rejeitar
        </button>
        <button type="button" className={cn(EPI_BTN_PRIMARY, "bg-emerald-600 hover:bg-emerald-700")} disabled={busy !== null} onClick={() => void run("APPROVED")}>
          {busy === "APPROVED" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Aprovar
        </button>
      </OverlayFooter>
    </Overlay>
  );
}

/** Documentação da entrega (evento): ficha, comprovante vigente, conferência e histórico documental. */
export function EpiEventDocuments({
  employeeId,
  event,
  canManage,
  onAttach,
  onChanged,
}: {
  employeeId: string;
  event: EpiEvent;
  canManage: boolean;
  onAttach: (event: EpiEvent) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const active = event.forms.find((f) => f.status === "ACTIVE") ?? null;
  const current = event.receipts.find((r) => r.status === "CURRENT") ?? null;
  const allCancelled = event.activeItemCount === 0;
  const status = event.document.status;

  const issue = async () => {
    // Janela aberta no clique (bloqueador de pop-up); recebe o PDF quando a emissão termina.
    const win = window.open("", "_blank");
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJsonOk<{ form: { id: string } }>(`/api/employees/${employeeId}/epi-events/${event.id}/form`, { method: "POST" });
      const url = formPdfUrl(employeeId, event.id, r.form.id);
      if (win) win.location.href = url;
      else window.open(url, "_blank");
      onChanged();
    } catch (err) {
      win?.close();
      setError(err instanceof Error ? err.message : "Não foi possível emitir a ficha.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5" data-testid="epi-event-documents">
      <div className="flex flex-wrap items-center gap-2">
        {allCancelled ? <span className="text-xs text-muted-foreground">Entrega cancelada</span> : <EpiDocumentBadge status={status} />}
        {active ? (
          <span className="text-xs">
            <span className="font-mono font-semibold" data-testid="epi-form-number">
              {active.documentNumber}
            </span>
            <span className="text-muted-foreground"> · {active.printCount}× impressa</span>
          </span>
        ) : null}
      </div>
      {event.document.outdatedReceipt ? <p className="text-[11px] text-amber-800">O comprovante anexado é de uma revisão anterior da ficha.</p> : null}
      {event.document.rejected && current ? (
        <p className="text-[11px] text-rose-700">
          Comprovante rejeitado{current.validatedByName ? ` por ${current.validatedByName}` : ""}: {current.validationNote}. Anexe um novo.
        </p>
      ) : null}
      {current ? (
        <p className="text-[11px] text-muted-foreground">
          Anexado em {formatDateTime(current.uploadedAt)}
          {current.uploadedByName ? ` por ${current.uploadedByName}` : ""}
          {current.validationResult === "APPROVED"
            ? ` · validado em ${formatDateTime(current.validatedAt)}${current.validatedByName ? ` por ${current.validatedByName}` : ""}`
            : ""}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {active ? (
          <>
            <a className={EPI_BTN_LINK} href={formPdfUrl(employeeId, event.id, active.id)} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-0.5 inline h-3 w-3" />
              Ver ficha
            </a>
            <a className={EPI_BTN_LINK} href={formPdfUrl(employeeId, event.id, active.id, true)}>
              <Download className="mr-0.5 inline h-3 w-3" />
              Baixar PDF
            </a>
          </>
        ) : null}
        {canManage && !allCancelled ? (
          <button type="button" className={EPI_BTN_LINK} onClick={() => void issue()} disabled={busy} data-testid="epi-issue-form">
            {busy ? <Loader2 className="mr-0.5 inline h-3 w-3 animate-spin" /> : <Printer className="mr-0.5 inline h-3 w-3" />}
            {active ? "Reimprimir" : "Emitir ficha de entrega"}
          </button>
        ) : null}
        {canManage && !allCancelled ? (
          <button type="button" className={EPI_BTN_LINK} onClick={() => onAttach(event)} data-testid="epi-attach-receipt">
            <FileUp className="mr-0.5 inline h-3 w-3" />
            {current && status !== "AWAITING_SIGNATURE" ? "Substituir comprovante" : "Anexar ficha assinada"}
          </button>
        ) : null}
        {current ? (
          <a className={EPI_BTN_LINK} href={receiptUrl(employeeId, current.documentId)} target="_blank" rel="noreferrer">
            Ver comprovante
          </a>
        ) : null}
        {canManage && status === "ATTACHED" ? (
          <button type="button" className={cn(EPI_BTN_LINK, "text-emerald-700")} onClick={() => setValidating(true)} data-testid="epi-validate">
            Conferir
          </button>
        ) : null}
        {event.forms.length + event.receipts.length > 0 ? (
          <button type="button" className={cn(EPI_BTN_LINK, "text-muted-foreground")} onClick={() => setShowHistory((v) => !v)}>
            <History className="mr-0.5 inline h-3 w-3" />
            {showHistory ? "Ocultar histórico documental" : "Histórico documental"}
          </button>
        ) : null}
      </div>
      {showHistory ? (
        <ul className="space-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px]" data-testid="epi-document-history">
          {event.forms.map((f) => (
            <li key={f.id}>
              Ficha{" "}
              <a className="font-mono underline" href={formPdfUrl(employeeId, event.id, f.id)} target="_blank" rel="noreferrer">
                {f.documentNumber}
              </a>{" "}
              · emitida em {formatDateTime(f.issuedAt)}
              {f.issuedByName ? ` por ${f.issuedByName}` : ""} · {f.printCount}× impressa ·{" "}
              {f.status === "ACTIVE" ? <strong>vigente</strong> : "substituída"}
            </li>
          ))}
          {event.receipts.map((r) => (
            <li key={r.id}>
              Comprovante{" "}
              <a className="underline" href={receiptUrl(employeeId, r.documentId)} target="_blank" rel="noreferrer">
                {r.originalFileName}
              </a>
              {r.formDocumentNumber ? ` (ficha ${r.formDocumentNumber})` : " (sem ficha)"} · {formatDateTime(r.uploadedAt)}
              {r.uploadedByName ? ` por ${r.uploadedByName}` : ""}
              {r.batchId ? " · envio em lote" : ""} · SHA-256 {r.fileSha256.slice(0, 12)}… ·{" "}
              {r.status === "CURRENT" ? <strong>vigente</strong> : `substituído em ${formatDateTime(r.supersededAt)}`}
              {r.validationResult
                ? ` · ${r.validationResult === "APPROVED" ? "aprovado" : "rejeitado"}${r.validatedByName ? ` por ${r.validatedByName}` : ""}${
                    r.validationNote ? ` (${r.validationNote})` : ""
                  }`
                : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-[11px] font-medium text-rose-700">{error}</p> : null}
      {validating ? (
        <ValidatePrompt
          onClose={() => setValidating(false)}
          onConfirm={async (result, note) => {
            await fetchJsonOk(`/api/employees/${employeeId}/epi-events/${event.id}/receipt/validate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ result, note: note || null }),
            });
            setValidating(false);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
