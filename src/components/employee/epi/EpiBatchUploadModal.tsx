import React, { useState } from "react";
import { FileStack, Loader2, RefreshCw, Upload } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { EPI_RECEIPT_MAX_BYTES, epiFormReferenceFromFileName } from "@/src/lib/epi/epiForm";
import { EPI_BTN_PRIMARY, EPI_BTN_SECONDARY, EPI_INPUT, formatIsoDay } from "./epiUi";

/** Espelho de `EpiBatchRow` (epiForms.server.ts) — o servidor é a fonte da conferência. */
type PlanStatus = "READY" | "NEEDS_REVIEW" | "INVALID" | "DUPLICATE_IN_BATCH" | "ALREADY_ATTACHED" | "CONFLICT";
type PlanRow = {
  index: number;
  name: string;
  reference: string | null;
  referenceSource: "INFORMED" | "FILE_NAME" | null;
  status: PlanStatus;
  message: string;
  documentNumber: string | null;
  employeeId: string | null;
  employeeName: string | null;
  eventId: string | null;
  deliveredOn: string | null;
  itemCount: number | null;
  replacesExisting: boolean;
};
type ResultRow = PlanRow & { outcome: "ATTACHED" | "SKIPPED" | "NOT_ATTACHED" | "FAILED" };

type Entry = { file: File; sha256: string; reference: string; qr: boolean };

export const EPI_BATCH_MAX_FILES = 30;
const ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

const STATUS_LABEL: Record<PlanStatus, string> = {
  READY: "Pronto",
  NEEDS_REVIEW: "Revisar",
  INVALID: "Inválido",
  DUPLICATE_IN_BATCH: "Duplicado no lote",
  ALREADY_ATTACHED: "Já anexado",
  CONFLICT: "Conflito",
};
const STATUS_TONE: Record<PlanStatus, string> = {
  READY: "bg-emerald-50 text-emerald-700 border-emerald-200",
  NEEDS_REVIEW: "bg-amber-50 text-amber-800 border-amber-200",
  INVALID: "bg-rose-50 text-rose-700 border-rose-200",
  DUPLICATE_IN_BATCH: "bg-rose-50 text-rose-700 border-rose-200",
  ALREADY_ATTACHED: "bg-slate-100 text-slate-600 border-slate-200",
  CONFLICT: "bg-rose-50 text-rose-700 border-rose-200",
};
const OUTCOME_LABEL: Record<ResultRow["outcome"], string> = {
  ATTACHED: "Anexado",
  SKIPPED: "Ignorado (já anexado)",
  NOT_ATTACHED: "Não anexado",
  FAILED: "Falhou",
};

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => { detect: (source: ImageBitmap) => Promise<Array<{ rawValue?: string }>> };

/**
 * Lê o QR Code de uma IMAGEM com a capability nativa do navegador (BarcodeDetector), quando existe.
 * PDF não é lido (não há decodificador de PDF no sistema): para PDF vale o nome do arquivo ou a digitação.
 */
async function readQrFromImage(file: File): Promise<string | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor || !/^image\/(png|jpeg)$/.test(file.type) || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const codes = await new Ctor({ formats: ["qr_code"] }).detect(bitmap);
    bitmap.close?.();
    const values = [...new Set(codes.map((c) => c.rawValue ?? "").filter((v) => v.toUpperCase().startsWith("INDUSCOST-HR-EPI:")))];
    return values.length === 1 ? values[0] : null; // vários QR distintos → revisão manual
  } catch {
    return null;
  }
}

/**
 * Anexar fichas assinadas em lote (Dashboard de Pessoas › EPI). Cada arquivo é UM documento: o
 * identificador vem do nome do arquivo, do QR (imagens, quando o navegador suporta) ou da digitação.
 * O servidor confere tudo de novo no envio; só linhas "Pronto" são anexadas — nada ambíguo é vinculado.
 */
export function EpiBatchUploadModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [busy, setBusy] = useState<"read" | "plan" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Número editado depois da última conferência: exige conferir de novo antes de enviar. */
  const [dirty, setDirty] = useState(false);

  const runPlan = async (list: Entry[]) => {
    setBusy("plan");
    setError(null);
    try {
      const r = await fetchJsonOk<{ rows: PlanRow[] }>("/api/hr/epi-receipts/batch/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: list.map((e) => ({ name: e.file.name, sha256: e.sha256, size: e.file.size, reference: e.reference.trim() || null })),
        }),
      });
      setPlan(r.rows);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível conferir o lote.");
    } finally {
      setBusy(null);
    }
  };

  const pick = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    setResults(null);
    setPlan(null);
    if (list.length === 0) return;
    if (list.length > EPI_BATCH_MAX_FILES) {
      setError(`Selecione no máximo ${EPI_BATCH_MAX_FILES} arquivos por lote.`);
      return;
    }
    const tooBig = list.filter((f) => f.size > EPI_RECEIPT_MAX_BYTES || f.size === 0);
    if (tooBig.length) {
      setError(`Arquivo(s) vazio(s) ou acima de 10 MB: ${tooBig.map((f) => f.name).join(", ")}.`);
      return;
    }
    setBusy("read");
    setError(null);
    try {
      const next: Entry[] = [];
      for (const file of list) {
        const fromName = epiFormReferenceFromFileName(file.name);
        const qr = fromName ? null : await readQrFromImage(file);
        next.push({ file, sha256: await sha256(file), reference: fromName ? "" : qr ?? "", qr: Boolean(qr) });
      }
      setEntries(next);
      setBusy(null);
      await runPlan(next);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Não foi possível ler os arquivos.");
    }
  };

  const setReference = (index: number, value: string) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, reference: value } : e)));
    setDirty(true);
  };

  const send = async () => {
    setBusy("send");
    setError(null);
    try {
      const fd = new FormData();
      entries.forEach((e) => fd.append("files", e.file, e.file.name));
      fd.append("manifest", JSON.stringify(entries.map((e, index) => ({ index, reference: e.reference.trim() || null }))));
      const r = await fetchJsonOk<{ batchId: string; results: ResultRow[] }>("/api/hr/epi-receipts/batch", { method: "POST", body: fd });
      setResults(r.results);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o lote.");
    } finally {
      setBusy(null);
    }
  };

  const ready = plan?.filter((r) => r.status === "READY").length ?? 0;
  const pending = (plan?.length ?? 0) - ready;
  const editable = (s: PlanStatus) => s === "NEEDS_REVIEW" || s === "INVALID" || s === "DUPLICATE_IN_BATCH";

  return (
    <Overlay open={open} onClose={onClose} size="xl" ariaLabelledBy="epi-batch-title" testId="epi-batch-modal">
      <OverlayHeader
        titleId="epi-batch-title"
        eyebrow="EPI / Uniformes · Comprovantes"
        title="Anexar fichas assinadas em lote"
        subtitle="Cada arquivo é uma ficha (PDF, JPG ou PNG, até 10 MB). O número da ficha é lido do nome do arquivo ou do QR Code (imagens); quando não for possível, digite-o."
        onClose={onClose}
      />
      <OverlayBody>
        <div className="space-y-4 text-sm">
          {results ? null : (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-5 text-center hover:bg-muted/30">
              <FileStack className="h-6 w-6 text-muted-foreground" />
              <span className="font-medium">Selecionar arquivos digitalizados</span>
              <span className="text-xs text-muted-foreground">
                Até {EPI_BATCH_MAX_FILES} arquivos. Um PDF com várias fichas não é separado automaticamente: envie um arquivo por ficha.
              </span>
              <input
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  void pick(e.target.files);
                  e.target.value = "";
                }}
                data-testid="epi-batch-files"
              />
            </label>
          )}

          {busy === "read" || (busy === "plan" && !plan) ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {busy === "read" ? "Lendo os arquivos…" : "Conferindo os identificadores…"}
            </p>
          ) : null}

          {plan && !results ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground" data-testid="epi-batch-summary">
                  {plan.length} arquivo(s) · <strong className="text-emerald-700">{ready} pronto(s)</strong>
                  {pending ? ` · ${pending} não será(ão) anexado(s) sem revisão` : ""}
                  {dirty ? <strong className="text-amber-800"> · número alterado: confira novamente antes de anexar</strong> : null}
                </p>
                <button type="button" className={EPI_BTN_SECONDARY} onClick={() => void runPlan(entries)} disabled={busy !== null}>
                  {busy === "plan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Conferir novamente
                </button>
              </div>
              <div className="relative overflow-x-auto rounded-xl border border-border">
                <table className="min-w-full text-sm" data-testid="epi-batch-review">
                  <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Arquivo</th>
                      <th className="px-3 py-2">Número da ficha</th>
                      <th className="px-3 py-2">Colaborador / entrega</th>
                      <th className="px-3 py-2">Conferência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((r) => {
                      const entry = entries[r.index];
                      return (
                        <tr key={r.index} className="border-t border-border/70 align-top" data-testid="epi-batch-row" data-status={r.status}>
                          <td className="max-w-[220px] px-3 py-2">
                            <p className="truncate font-medium" title={r.name}>
                              {r.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {entry ? `${Math.max(1, Math.round(entry.file.size / 1024))} KB` : ""}
                              {r.referenceSource === "FILE_NAME" ? " · número lido do nome" : entry?.qr ? " · número lido do QR" : ""}
                            </p>
                          </td>
                          <td className="min-w-[210px] px-3 py-2">
                            {editable(r.status) || entry?.reference ? (
                              <input
                                className={cn(EPI_INPUT, "py-1 font-mono text-xs")}
                                value={entry?.reference ?? ""}
                                onChange={(e) => setReference(r.index, e.target.value)}
                                placeholder={r.reference ?? "Digite: FE-AAAA-00000-R01"}
                                aria-label={`Número da ficha de ${r.name}`}
                                data-testid="epi-batch-reference"
                              />
                            ) : (
                              <span className="font-mono text-xs">{r.reference}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {r.employeeName ? (
                              <>
                                <p className="font-medium">{r.employeeName}</p>
                                <p className="text-muted-foreground">
                                  {r.documentNumber} · entrega de {formatIsoDay(r.deliveredOn)} · {r.itemCount} item(ns)
                                </p>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="max-w-[260px] px-3 py-2">
                            <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[r.status])}>
                              {STATUS_LABEL[r.status]}
                            </span>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {r.message}
                              {r.status === "READY" && r.replacesExisting ? " Substitui o comprovante vigente (que fica no histórico)." : ""}
                            </p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Ao enviar, o servidor recalcula o SHA-256 e confere cada número de novo. Só as linhas “Pronto” são anexadas; as demais ficam de fora
                e podem ser enviadas depois. Anexar não valida: a conferência de cada ficha é feita na entrega.
              </p>
            </>
          ) : null}

          {results ? (
            <div className="relative overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full text-sm" data-testid="epi-batch-results">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Arquivo</th>
                    <th className="px-3 py-2">Ficha</th>
                    <th className="px-3 py-2">Colaborador</th>
                    <th className="px-3 py-2">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.index} className="border-t border-border/70 align-top" data-testid="epi-batch-result" data-outcome={r.outcome}>
                      <td className="max-w-[220px] truncate px-3 py-2" title={r.name}>
                        {r.name}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.documentNumber ?? r.reference ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.employeeName ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        <p className={cn("font-semibold", r.outcome === "ATTACHED" ? "text-emerald-700" : r.outcome === "FAILED" ? "text-rose-700" : "")}>
                          {OUTCOME_LABEL[r.outcome]}
                        </p>
                        <p className="text-muted-foreground">{r.message}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {error ? (
            <p className="text-sm font-medium text-rose-700" data-testid="epi-batch-error">
              {error}
            </p>
          ) : null}
        </div>
      </OverlayBody>
      <OverlayFooter>
        <button type="button" className={EPI_BTN_SECONDARY} onClick={onClose} disabled={busy === "send"}>
          {results ? "Fechar" : "Cancelar"}
        </button>
        {results ? null : (
          <button
            type="button"
            className={EPI_BTN_PRIMARY}
            onClick={() => void send()}
            disabled={busy !== null || !plan || ready === 0 || dirty}
            data-testid="epi-batch-send"
          >
            {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Anexar {ready} ficha(s)
          </button>
        )}
      </OverlayFooter>
    </Overlay>
  );
}
