/**
 * Estoque → Dispositivos do Coletor → "QR de acesso ao Collector".
 *
 * Seção administrativa acima da lista de dispositivos: o operador escolhe o
 * setor e clica em "Emitir QR do setor"; o QR aparece em um MODAL (não mais
 * inline na aba). O QR NÃO autoriza nada — é só o deep-link público do setor
 * (`response.url`, resolvido inteiramente pelo backend em
 * GET /api/inventory/collector/sector-qr). A autorização do tablet continua
 * 100% a cargo do fluxo Tailscale existente logo abaixo, que esta seção não toca.
 *
 * QR FIXO POR SETOR: o conteúdo é determinístico (deep-link do setor); a UI
 * não oferece "regenerar" — só emitir/ver, imprimir e abrir. Uma vez emitido,
 * o QR do setor fica em cache na aba e reemitir mostra o mesmo QR.
 *
 * A folha impressa é a MESMA de Estoque → Etiquetas QR
 * (`CollectorSectorQrPrintSheet`): nome do setor, o que o QR faz, o QR e
 * como ler. A pré-visualização no modal usa o mesmo componente, então o que se
 * vê é o que sai no papel.
 *
 * Puramente apresentacional: recebe o estado já resolvido (sem fetch/hooks
 * de auth aqui dentro) para poder ser testada com renderToStaticMarkup, na
 * convenção deste repo (sem jsdom/testing-library).
 */
import React, { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Printer, QrCode, RefreshCw } from "lucide-react";
import { InventoryErrorBanner, InventoryLoading } from "@/src/components/inventory/inventoryUi";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import {
  COLLECTOR_SECTOR_QR_FIXED_NOTICE,
  type CollectorSectorQrOption,
  type CollectorSectorQrResponse,
} from "@/src/lib/inventory/collector/collectorSectorQrUi";
import { CollectorSectorQrPrintSheet } from "./CollectorSectorQrPrintSheet";
import "./collector-sector-qr-sheet.css";
import "./inventory-collector-sector-qr-print.css";

export type InventoryCollectorSectorQrState =
  /** Nada emitido ainda para o setor selecionado. */
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: CollectorSectorQrResponse }
  /** 401/403 na própria chamada: mesmo guard do backend — seção some, sem erro visível. */
  | { status: "forbidden" }
  | { status: "config"; message: string }
  | { status: "error"; message: string };

const PRINT_BODY_CLASS = "collector-sector-qr-print-route";
/** Marca o <style> injetado durante a impressão (removido no cleanup). */
const PRINT_PAGE_STYLE_ATTR = "data-collector-sector-qr-print-page";
const PRINT_PAGE_STYLE = "@page { size: A4 portrait; margin: 12mm; }";

const MODAL_TITLE_ID = "collector-sector-qr-modal-title";

export type InventoryCollectorSectorQrSectionProps = {
  /** Setores emitíveis (do contrato canônico). */
  sectors: readonly CollectorSectorQrOption[];
  selectedSector: string;
  onSelectSector: (code: string) => void;
  /** Emite (ou reexibe, se já emitido) o QR do setor selecionado e abre o modal. */
  onEmit: () => void;
  /** Estado do QR do setor selecionado. */
  state: InventoryCollectorSectorQrState;
  modalOpen: boolean;
  onCloseModal: () => void;
  /** Nova tentativa após erro de rede/servidor (não é "regenerar": o QR é fixo). */
  onRetry: () => void;
};

export function InventoryCollectorSectorQrSection({
  sectors,
  selectedSector,
  onSelectSector,
  onEmit,
  state,
  modalOpen,
  onCloseModal,
  onRetry,
}: InventoryCollectorSectorQrSectionProps) {
  const [printing, setPrinting] = useState(false);
  const printCleanupRef = useRef<number | null>(null);

  const handlePrint = useCallback(() => {
    if (state.status !== "ready" || printing) return;
    setPrinting(true);
    document.body.classList.add(PRINT_BODY_CLASS);

    // A4 RETRATO garantido mesmo com `@page landscape` de outros CSS globais:
    // `@page` não obedece especificidade, vence o último em ordem de documento —
    // e um <style> no head, montado agora, é o último.
    const pageStyle = document.createElement("style");
    pageStyle.setAttribute(PRINT_PAGE_STYLE_ATTR, "1");
    pageStyle.textContent = PRINT_PAGE_STYLE;
    document.head.appendChild(pageStyle);

    const cleanup = () => {
      document.body.classList.remove(PRINT_BODY_CLASS);
      pageStyle.remove();
      window.removeEventListener("afterprint", cleanup);
      if (printCleanupRef.current != null) {
        window.clearTimeout(printCleanupRef.current);
        printCleanupRef.current = null;
      }
      setPrinting(false);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    // Rede de segurança: alguns navegadores não disparam `afterprint` de forma
    // confiável ao cancelar a caixa de diálogo.
    printCleanupRef.current = window.setTimeout(cleanup, 60_000);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(() => window.print(), 150);
      });
    });
  }, [state, printing]);

  if (state.status === "forbidden") return null;

  const selected = sectors.find((row) => row.code === selectedSector) ?? sectors[0] ?? null;
  const emitting = state.status === "loading";
  const canPortal = typeof document !== "undefined";

  return (
    <section className="space-y-3" data-testid="collector-sector-qr-section">
      {state.status === "ready" && canPortal
        ? createPortal(
            <div id="collector-sector-qr-print-root">
              <CollectorSectorQrPrintSheet
                label={state.data.label}
                url={state.data.url}
                mode="print"
                testId="collector-sector-qr-print-sheet"
              />
            </div>,
            document.body
          )
        : null}

      {/* Paleta CLARA, como o restante da tela (ver InventorySectionIntro): card branco,
          texto escuro. Nunca card escuro com texto claro aqui — contraste ilegível. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">QR de acesso ao Collector</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Escolha o setor e emita o QR para imprimir e fixar na área correspondente. O
              operador abre o Collector diretamente pelo setor e o dispositivo continua
              sujeito à autorização do Tailscale. O QR de cada setor é fixo: emitir de novo
              mostra o mesmo QR.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Setor
              <select
                value={selected?.code ?? ""}
                onChange={(event) => onSelectSector(event.target.value)}
                disabled={emitting}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50"
                data-testid="collector-sector-qr-sector"
              >
                {sectors.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onEmit}
              disabled={emitting || !selected}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              data-testid="collector-sector-qr-emit"
            >
              <QrCode className="h-4 w-4" />
              {emitting ? "Emitindo…" : "Emitir QR do setor"}
            </button>
          </div>
        </div>
      </div>

      <Overlay
        open={modalOpen}
        onClose={onCloseModal}
        size="md"
        ariaLabelledBy={MODAL_TITLE_ID}
        testId="collector-sector-qr-modal"
      >
        <OverlayHeader
          titleId={MODAL_TITLE_ID}
          eyebrow="Estoque · Dispositivos do Coletor"
          title={selected ? `QR do setor — ${selected.label}` : "QR do setor"}
          subtitle="A pré-visualização é exatamente o que sai no papel."
          onClose={onCloseModal}
          closeLabel="Fechar QR"
        />
        <OverlayBody>
          <InventoryCollectorSectorQrModalBody
            state={state}
            printing={printing}
            onPrint={handlePrint}
            onRetry={onRetry}
          />
        </OverlayBody>
        <OverlayFooter>
          <button
            type="button"
            onClick={onCloseModal}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            data-testid="collector-sector-qr-modal-close"
          >
            Fechar
          </button>
        </OverlayFooter>
      </Overlay>
    </section>
  );
}

/**
 * Conteúdo do modal (exportado para teste estático). Mostra a folha canônica
 * em modo `preview`, a URL do deep-link, o aviso de QR fixo e as ações
 * Abrir/Imprimir. Erros de configuração e de rede aparecem aqui, nunca
 * escondidos; não existe ação de "regenerar".
 */
export function InventoryCollectorSectorQrModalBody({
  state,
  printing,
  onPrint,
  onRetry,
}: {
  state: InventoryCollectorSectorQrState;
  printing: boolean;
  onPrint: () => void;
  onRetry: () => void;
}) {
  if (state.status === "idle" || state.status === "loading") {
    return <InventoryLoading label="Emitindo QR do setor…" />;
  }
  if (state.status === "forbidden") return null;

  if (state.status === "config") {
    return (
      <div
        className="rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        data-testid="collector-sector-qr-config-error"
      >
        <p className="font-semibold">QR do Collector indisponível — configuração do servidor.</p>
        <p className="mt-1">{state.message}</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3">
        <InventoryErrorBanner message={state.message} testId="collector-sector-qr-error" />
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
          data-testid="collector-sector-qr-retry"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center" data-testid="collector-sector-qr-ready">
      <CollectorSectorQrPrintSheet
        label={state.data.label}
        url={state.data.url}
        mode="preview"
        testId="collector-sector-qr-preview"
      />
      <p
        className="max-w-md rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
        data-testid="collector-sector-qr-fixed-notice"
      >
        {COLLECTOR_SECTOR_QR_FIXED_NOTICE}
      </p>
      <p className="max-w-md select-all break-all text-xs text-slate-500" data-testid="collector-sector-qr-url">
        {state.data.url}
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        <a
          href={state.data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
          data-testid="collector-sector-qr-open"
        >
          <ExternalLink className="h-4 w-4" />
          Abrir Collector
        </a>
        <button
          type="button"
          onClick={onPrint}
          disabled={printing}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
          data-testid="collector-sector-qr-print"
        >
          <Printer className="h-4 w-4" />
          Imprimir QR
        </button>
      </div>
    </div>
  );
}
