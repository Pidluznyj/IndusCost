/**
 * Estoque → Setores / Collector → QR do setor.
 *
 * O QR é o deep-link fixo do setor (`/collector/sector/<slug>` sobre a base
 * pública canônica do Collector), resolvido inteiramente pelo servidor em
 * GET /api/inventory/collector/sector-qr. Esta tela nunca monta a URL: sem
 * base pública válida o servidor recusa e o erro de configuração aparece aqui.
 *
 * A folha (pré-visualização e impressão) é a mesma de Dispositivos do Coletor
 * e de Etiquetas QR — CollectorSectorQrPrintSheet — com o mesmo CSS de
 * impressão isolada. Além de abrir e imprimir, oferece copiar o link e baixar
 * a imagem do QR.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeCanvas } from "qrcode.react";
import { Copy, Download } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import {
  buildCollectorSectorQrEndpoint,
  classifyCollectorSectorQrError,
  parseCollectorSectorQrPayload,
} from "@/src/lib/inventory/collector/collectorSectorQrUi";
import {
  COLLECTOR_SECTOR_QR_ERROR_LEVEL,
  CollectorSectorQrPrintSheet,
} from "@/src/components/inventory/collector/CollectorSectorQrPrintSheet";
import {
  InventoryCollectorSectorQrModalBody,
  type InventoryCollectorSectorQrState,
} from "@/src/components/inventory/collector/InventoryCollectorSectorQrSection";
import "@/src/components/inventory/collector/collector-sector-qr-sheet.css";
import "@/src/components/inventory/collector/inventory-collector-sector-qr-print.css";

/** Mesmas chaves de impressão isolada de inventory-collector-sector-qr-print.css. */
const PRINT_BODY_CLASS = "collector-sector-qr-print-route";
const PRINT_PAGE_STYLE = "@page { size: A4 portrait; margin: 12mm; }";
const TITLE_ID = "stock-sector-qr-dialog-title";
/** Lado, em px, do PNG baixado — folga para impressão em etiqueta grande. */
const DOWNLOAD_QR_SIZE_PX = 1024;

export type InventoryStockSectorQrDialogProps = {
  /** Slug do setor configurável ou código do setor fixo (ex.: RAW_MATERIAL). */
  sectorKey: string;
  sectorName: string;
  onClose: () => void;
};

export function stockSectorQrFileName(sectorKey: string): string {
  const safe = sectorKey.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return `qr-setor-${safe}.png`;
}

export function InventoryStockSectorQrDialog({
  sectorKey,
  sectorName,
  onClose,
}: InventoryStockSectorQrDialogProps) {
  const [state, setState] = useState<InventoryCollectorSectorQrState>({ status: "loading" });
  const [printing, setPrinting] = useState(false);
  const [copied, setCopied] = useState(false);
  const downloadCanvasWrap = useRef<HTMLDivElement | null>(null);
  const printTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = parseCollectorSectorQrPayload(
        await fetchJsonOk<unknown>(buildCollectorSectorQrEndpoint(sectorKey))
      );
      setState({ status: "ready", data });
    } catch (e: unknown) {
      const classified = classifyCollectorSectorQrError(
        e instanceof HttpError
          ? { status: e.status, code: e.code ?? null, message: e.message }
          : e instanceof Error
            ? { message: e.message }
            : {}
      );
      setState(
        classified.kind === "config"
          ? { status: "config", message: classified.message }
          : {
              status: "error",
              message:
                classified.kind === "forbidden"
                  ? "Sem permissão para emitir o QR do Collector (gestão de conferências)."
                  : classified.message,
            }
      );
    }
  }, [sectorKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePrint = useCallback(() => {
    if (state.status !== "ready" || printing) return;
    setPrinting(true);
    document.body.classList.add(PRINT_BODY_CLASS);
    // `@page` vence pelo último em ordem de documento: garante A4 retrato.
    const pageStyle = document.createElement("style");
    pageStyle.textContent = PRINT_PAGE_STYLE;
    document.head.appendChild(pageStyle);
    const cleanup = () => {
      document.body.classList.remove(PRINT_BODY_CLASS);
      pageStyle.remove();
      window.removeEventListener("afterprint", cleanup);
      if (printTimer.current != null) {
        window.clearTimeout(printTimer.current);
        printTimer.current = null;
      }
      setPrinting(false);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    printTimer.current = window.setTimeout(cleanup, 60_000);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(() => window.print(), 150);
      });
    });
  }, [state, printing]);

  const copyLink = useCallback(async () => {
    if (state.status !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.data.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sem permissão de área de transferência: o link continua selecionável na tela.
      setCopied(false);
    }
  }, [state]);

  const downloadImage = useCallback(() => {
    const canvas = downloadCanvasWrap.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = stockSectorQrFileName(sectorKey);
    link.click();
  }, [sectorKey]);

  const ready = state.status === "ready";

  return (
    <>
      {ready && typeof document !== "undefined"
        ? createPortal(
            <div id="collector-sector-qr-print-root">
              <CollectorSectorQrPrintSheet
                label={state.data.label}
                url={state.data.url}
                mode="print"
                testId="stock-sector-qr-print-sheet"
              />
            </div>,
            document.body
          )
        : null}

      <Overlay open onClose={onClose} size="md" ariaLabelledBy={TITLE_ID} testId="stock-sector-qr-dialog">
        <OverlayHeader
          titleId={TITLE_ID}
          eyebrow="Estoque · Setores / Collector"
          title={`QR do setor — ${sectorName}`}
          subtitle="Imprima e fixe na área. O operador lê o QR com o celular e escolhe contagem ou retirada."
          onClose={onClose}
          closeLabel="Fechar QR"
        />
        <OverlayBody>
          <InventoryCollectorSectorQrModalBody
            state={state}
            printing={printing}
            onPrint={handlePrint}
            onRetry={() => void load()}
          />
          {ready ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
                data-testid="stock-sector-qr-copy"
              >
                <Copy className="h-4 w-4" />
                {copied ? "Link copiado" : "Copiar link"}
              </button>
              <button
                type="button"
                onClick={downloadImage}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
                data-testid="stock-sector-qr-download"
              >
                <Download className="h-4 w-4" />
                Baixar imagem
              </button>
              {/* Canvas fora da tela: só existe para gerar o PNG do download. */}
              <div ref={downloadCanvasWrap} className="hidden" aria-hidden>
                <QRCodeCanvas
                  value={state.data.url}
                  size={DOWNLOAD_QR_SIZE_PX}
                  level={COLLECTOR_SECTOR_QR_ERROR_LEVEL}
                  marginSize={2}
                />
              </div>
            </div>
          ) : null}
        </OverlayBody>
        <OverlayFooter>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Fechar
          </button>
        </OverlayFooter>
      </Overlay>
    </>
  );
}
