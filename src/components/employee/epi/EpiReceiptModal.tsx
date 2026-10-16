import React, { useState } from "react";
import { FileUp, Loader2, ScanLine, Search } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import { fetchJsonOk } from "@/src/lib/http";
import { formatIsoDay, EPI_BTN_PRIMARY, EPI_BTN_SECONDARY, EPI_INPUT, type EpiEvent } from "./epiUi";

type Resolved = {
  formId: string;
  documentNumber: string;
  revision: number;
  status: "ACTIVE" | "SUPERSEDED";
  eventId: string;
  employeeId: string;
  employeeName: string;
  deliveredOn: string;
  itemCount: number;
  items: string[];
  activeDocumentNumber: string | null;
};

const ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

/**
 * Anexar ficha assinada. Pela entrega (`event`) ou pelo código impresso (`event` ausente): o número
 * (ou o texto do QR lido por um leitor) é conferido no servidor antes de anexar.
 */
export function EpiReceiptModal({
  open,
  employeeId,
  event,
  onClose,
  onSaved,
}: {
  open: boolean;
  employeeId: string;
  event: EpiEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeForm = event?.forms.find((f) => f.status === "ACTIVE") ?? null;
  const needsReference = !event || Boolean(activeForm);
  const [reference, setReference] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    setBusy(true);
    setError(null);
    setResolved(null);
    try {
      const r = await fetchJsonOk<Resolved>(`/api/hr/epi-forms/lookup?reference=${encodeURIComponent(reference.trim())}`, { cache: "no-store" });
      if (r.employeeId !== employeeId) {
        setError(`A ficha ${r.documentNumber} é de outro colaborador (${r.employeeName}). Nada será anexado aqui.`);
      } else if (event && r.eventId !== event.id) {
        setError(`A ficha ${r.documentNumber} é de outra entrega (${formatIsoDay(r.deliveredOn)}, ${r.itemCount} item(ns)).`);
      } else if (r.status !== "ACTIVE") {
        setError(`A ficha ${r.documentNumber} foi substituída por ${r.activeDocumentNumber ?? "outra revisão"}. Colha a assinatura na revisão vigente.`);
      }
      setResolved(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ficha não localizada.");
    } finally {
      setBusy(false);
    }
  };

  const okResolved = resolved && resolved.employeeId === employeeId && resolved.status === "ACTIVE" && (!event || resolved.eventId === event.id);
  const eventId = event?.id ?? (okResolved ? resolved!.eventId : null);
  const canSend = Boolean(file && eventId && (!needsReference || okResolved));

  const send = async () => {
    if (!file || !eventId) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (needsReference) fd.append("reference", reference.trim());
      await fetchJsonOk(`/api/employees/${employeeId}/epi-events/${eventId}/receipt`, { method: "POST", body: fd });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível anexar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay open={open} onClose={onClose} size="md" ariaLabelledBy="epi-receipt-title" testId="epi-receipt-modal">
      <OverlayHeader
        titleId="epi-receipt-title"
        eyebrow="EPI / Uniformes · Comprovante"
        title={event ? "Anexar ficha assinada" : "Anexar ficha assinada pelo código"}
        subtitle={
          event
            ? `Entrega de ${formatIsoDay(event.deliveredAt)} · ${event.activeItemCount} item(ns)`
            : "Informe o número impresso na ficha ou leia o QR Code com o leitor; o sistema localiza a entrega."
        }
        onClose={onClose}
      />
      <OverlayBody>
        <div className="space-y-4 text-sm">
          {needsReference ? (
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Número da ficha (impresso no topo) *</span>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className={`${EPI_INPUT} pl-9 font-mono`}
                    value={reference}
                    onChange={(e) => {
                      setReference(e.target.value);
                      setResolved(null);
                      setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (reference.trim()) void lookup();
                      }
                    }}
                    placeholder="FE-2026-00001-R01"
                    autoFocus
                    data-testid="epi-receipt-reference"
                  />
                </div>
                <button type="button" className={EPI_BTN_SECONDARY} onClick={() => void lookup()} disabled={busy || !reference.trim()}>
                  <Search className="h-4 w-4" /> Conferir
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                O número precisa ser o da ficha vigente {event ? "desta entrega" : "de uma entrega deste colaborador"}; caso contrário nada é anexado.
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Esta entrega não tem ficha emitida pelo sistema: o arquivo será anexado como comprovante da entrega, sem identificador. Para ter o
              identificador único, emita a ficha antes e colha a assinatura nela.
            </p>
          )}

          {okResolved ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900" data-testid="epi-receipt-resolved">
              <p className="font-semibold">
                Ficha {resolved!.documentNumber} conferida · {resolved!.employeeName} · entrega de {formatIsoDay(resolved!.deliveredOn)}
              </p>
              <ul className="mt-1 list-disc pl-4">
                {resolved!.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Ficha assinada digitalizada (PDF, JPG ou PNG, até 10 MB) *</span>
            <input
              type="file"
              accept={ACCEPT}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="epi-receipt-file"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            O arquivo fica em Documentos do colaborador (acesso autenticado), vinculado a esta entrega, e não pode ser excluído enquanto for
            comprovante. Um novo envio substitui o vigente, que continua no histórico. Anexar não valida: a conferência é uma etapa própria.
          </p>
          {error ? (
            <p className="text-sm font-medium text-rose-700" data-testid="epi-receipt-error">
              {error}
            </p>
          ) : null}
        </div>
      </OverlayBody>
      <OverlayFooter>
        <button type="button" className={EPI_BTN_SECONDARY} onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className={EPI_BTN_PRIMARY} onClick={() => void send()} disabled={busy || !canSend} data-testid="epi-receipt-send">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          Anexar
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
