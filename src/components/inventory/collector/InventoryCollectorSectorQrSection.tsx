/**
 * Estoque → Dispositivos do Coletor → "QR de acesso ao Collector".
 *
 * Seção administrativa acima da lista de dispositivos. O QR NÃO autoriza
 * nada — é só o deep-link público do setor (`response.url`, resolvido
 * inteiramente pelo backend em GET /api/inventory/collector/sector-qr). A
 * autorização do tablet continua 100% a cargo do fluxo Tailscale existente
 * logo abaixo, que esta seção não toca.
 *
 * Puramente apresentacional: recebe o estado já resolvido (sem fetch/hooks
 * de auth aqui dentro) para poder ser testada com renderToStaticMarkup, na
 * convenção deste repo (sem jsdom/testing-library).
 */
import React, { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Printer, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { InventoryErrorBanner, InventoryLoading } from "@/src/components/inventory/inventoryUi";
import type { CollectorSectorQrResponse } from "@/src/lib/inventory/collector/collectorSectorQrUi";
import "./inventory-collector-sector-qr-print.css";

export type InventoryCollectorSectorQrState =
  | { status: "loading" }
  | { status: "ready"; data: CollectorSectorQrResponse }
  /** 401/403 na própria chamada: mesmo guard do backend — seção some, sem erro visível. */
  | { status: "forbidden" }
  | { status: "config"; message: string }
  | { status: "error"; message: string };

const PRINT_BODY_CLASS = "collector-sector-qr-print-route";
const QR_SIZE = 260;
/** Alta correção de erro: o QR sai impresso e fixado fisicamente — precisa
 *  continuar legível mesmo sujo/amassado/com reflexo de luz. */
const QR_ERROR_LEVEL = "H" as const;

function CollectorSectorQrPrintSheet({ data }: { data: CollectorSectorQrResponse }) {
  return (
    <div id="collector-sector-qr-print-root">
      <div className="collector-sector-qr-print-document">
        <p className="collector-sector-qr-print-brand">INDUSCOST</p>
        <p className="collector-sector-qr-print-subbrand">STOCK COLLECTOR</p>
        <h1>{data.label.toUpperCase()}</h1>
        <QRCodeSVG value={data.url} size={QR_SIZE} level={QR_ERROR_LEVEL} marginSize={2} />
        <p className="collector-sector-qr-print-instruction">Escaneie para abrir o Collector</p>
        <p className="collector-sector-qr-print-url">{data.url}</p>
      </div>
    </div>
  );
}

export function InventoryCollectorSectorQrSection({
  state,
  onRefresh,
  refreshing = false,
}: {
  state: InventoryCollectorSectorQrState;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const [printing, setPrinting] = useState(false);
  const printCleanupRef = useRef<number | null>(null);

  const handlePrint = useCallback(() => {
    if (state.status !== "ready" || printing) return;
    setPrinting(true);
    document.body.classList.add(PRINT_BODY_CLASS);

    const cleanup = () => {
      document.body.classList.remove(PRINT_BODY_CLASS);
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

  return (
    <section className="space-y-3" data-testid="collector-sector-qr-section">
      {state.status === "ready"
        ? createPortal(<CollectorSectorQrPrintSheet data={state.data} />, document.body)
        : null}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100">QR de acesso ao Collector</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Imprima este QR e fixe na área correspondente. O operador abre o Collector
            diretamente pelo setor e o dispositivo continua sujeito à autorização do
            Tailscale.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
          data-testid="collector-sector-qr-refresh"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      {state.status === "loading" ? <InventoryLoading label="Carregando QR do Collector…" /> : null}

      {state.status === "config" ? (
        <div
          className="rounded-lg border-2 border-amber-500 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"
          data-testid="collector-sector-qr-config-error"
        >
          <p className="font-semibold">QR do Collector indisponível — configuração do servidor.</p>
          <p className="mt-1">{state.message}</p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <InventoryErrorBanner
          message={state.message}
          testId="collector-sector-qr-error"
        />
      ) : null}

      {state.status === "ready" ? (
        <div
          className="rounded-xl border border-slate-700 bg-slate-900/60 p-6"
          data-testid="collector-sector-qr-ready"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG
                value={state.data.url}
                size={QR_SIZE}
                level={QR_ERROR_LEVEL}
                marginSize={2}
                data-testid="collector-sector-qr-code"
              />
            </div>
            <p className="text-lg font-semibold text-slate-100">{state.data.label}</p>
            <p
              className="max-w-md select-all break-all text-xs text-slate-400"
              data-testid="collector-sector-qr-url"
            >
              {state.data.url}
            </p>

            <div className="mt-2 flex flex-wrap justify-center gap-2">
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
                onClick={handlePrint}
                disabled={printing}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 disabled:opacity-50"
                data-testid="collector-sector-qr-print"
              >
                <Printer className="h-4 w-4" />
                Imprimir QR
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
