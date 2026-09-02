/**
 * FASE 3 — geração/impressão de etiquetas QR do Collector (fluxo HUMANO).
 *
 * Página standalone amigável para impressão. Os DADOS vêm de
 * GET /api/inventory/count-labels, protegido por autenticação humana +
 * permissão de conferência — sem login, a API nega e a página só mostra o
 * aviso. O DEVICE não tem endpoint para gerar QR.
 *
 * Etiqueta: QR grande + código do item + descrição curta + almoxarifado/
 * endereço legíveis, para operação manual quando o scanner falhar.
 *
 * Dois QRs distintos e NÃO intercambiáveis:
 *  - QR de setor: deep-link ABSOLUTO `/collector/sector/raw-material`, lido pela
 *    câmera nativa do tablet. Não carrega identidade nem credencial.
 *  - Etiqueta por item: QR legado `inv-loc` (item × almoxarifado × endereço),
 *    resolvido por POST /api/inventory/collector/resolve-qr no fluxo /collector.
 */
import React, { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { isCollectorPublicBaseUrlErrorCode } from "@/src/lib/inventory/collector/collectorPublicBaseUrl";

type LabelRow = {
  itemId: string;
  itemCode: string;
  itemDescription: string;
  itemUnit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  qrText: string;
};

type WarehouseOption = { id: string; code: string; name: string };

/**
 * Estados do QR de setor. Configuração ausente NÃO pode ser confundida com
 * falta de permissão nem desaparecer da tela em silêncio.
 */
type SectorQrState =
  | { status: "loading" }
  | { status: "ready"; sector: string; label: string; url: string }
  /** 401/403: usuário sem conferência de estoque — QR administrativo fica oculto. */
  | { status: "forbidden" }
  | { status: "config"; message: string }
  | { status: "error"; message: string };

export function InventoryCountLabelsPage() {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectorQr, setSectorQr] = useState<SectorQrState>({ status: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJsonOk<{ rows?: Array<WarehouseOption & { status?: string }> }>(
          "/api/inventory/warehouses?pageSize=200"
        );
        setWarehouses((data.rows ?? []).map((w) => ({ id: w.id, code: w.code, name: w.name })));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Erro ao carregar almoxarifados.");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJsonOk<{ sector: string; label: string; url: string }>(
          "/api/inventory/collector/sector-qr?sector=RAW_MATERIAL"
        );
        setSectorQr({ status: "ready", sector: data.sector, label: data.label, url: data.url });
      } catch (e: unknown) {
        if (e instanceof HttpError) {
          // Sem permissão humana: QR administrativo fica oculto; etiquetas seguem.
          if (e.status === 401 || e.status === 403) {
            setSectorQr({ status: "forbidden" });
            return;
          }
          // Configuração da URL pública ausente/inválida: erro explícito, nunca oculto.
          if (isCollectorPublicBaseUrlErrorCode(e.code)) {
            setSectorQr({ status: "config", message: e.message });
            return;
          }
          setSectorQr({ status: "error", message: e.message || "Erro ao gerar o QR de setor." });
          return;
        }
        setSectorQr({ status: "error", message: "Falha de rede ao consultar o QR de setor." });
      }
    })();
  }, []);

  const loadLabels = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<{ labels: LabelRow[] }>(
        `/api/inventory/count-labels?warehouseId=${encodeURIComponent(id)}`
      );
      setLabels(data.labels ?? []);
    } catch (e: unknown) {
      setLabels([]);
      setError(e instanceof Error ? e.message : "Erro ao gerar etiquetas.");
    } finally {
      setLoading(false);
    }
  }, []);

  const copySectorUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="mx-auto max-w-5xl">
        {sectorQr.status === "ready" ? (
          <div className="mb-8 rounded-xl border-2 border-emerald-600 bg-emerald-50 p-6 print:border print:bg-white">
            <h2 className="text-xl font-bold text-slate-900">
              QR de setor — {sectorQr.label}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Aponte a câmera nativa do tablet (Tailscale) para abrir a contagem cega autônoma
              de matéria-prima. O QR é apenas um link — não concede acesso.
            </p>
            <div className="mt-4 flex flex-col items-center gap-3">
              <QRCodeSVG value={sectorQr.url} size={200} marginSize={2} />
              <p className="break-all text-center text-xs text-slate-700">{sectorQr.url}</p>
              <div className="flex gap-2 print:hidden">
                <a
                  href={sectorQr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-emerald-700 px-3 py-1 text-xs font-semibold text-emerald-800"
                >
                  Abrir link
                </a>
                <button
                  type="button"
                  onClick={() => void copySectorUrl(sectorQr.url)}
                  className="rounded border border-emerald-700 px-3 py-1 text-xs font-semibold text-emerald-800"
                >
                  {copied ? "Copiado!" : "Copiar link"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {sectorQr.status === "config" ? (
          <div
            className="mb-8 rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900 print:hidden"
            data-testid="sector-qr-config-error"
          >
            <p className="font-semibold">QR de setor indisponível — configuração do ambiente.</p>
            <p className="mt-1">{sectorQr.message}</p>
            <p className="mt-1 text-xs">
              Não é bloqueio de dispositivo: o servidor não tem uma URL pública absoluta para
              colocar dentro do QR. As etiquetas por item abaixo seguem funcionando.
            </p>
          </div>
        ) : null}

        {sectorQr.status === "error" ? (
          <div
            className="mb-8 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 print:hidden"
            data-testid="sector-qr-error"
          >
            {sectorQr.message}
          </div>
        ) : null}

        <div className="mb-6 flex flex-wrap items-end justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Etiquetas QR — Inventário</h1>
            <p className="text-sm text-slate-600">
              Selecione o almoxarifado, confira as combinações item × endereço e imprima.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                void loadLabels(e.target.value);
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              data-testid="labels-warehouse-select"
            >
              <option value="">Escolha o almoxarifado…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={labels.length === 0 && sectorQr.status !== "ready"}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Imprimir
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 print:hidden">
            {error} — esta página exige login e permissão de conferência de estoque.
          </div>
        ) : null}
        {loading ? <p className="text-sm text-slate-500 print:hidden">Gerando etiquetas…</p> : null}
        {!loading && warehouseId && labels.length === 0 && !error ? (
          <p className="text-sm text-slate-500 print:hidden">
            Nenhuma combinação item × endereço com saldo neste almoxarifado.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-3">
          {labels.map((label) => (
            <div
              key={`${label.itemId}:${label.locationId ?? "-"}`}
              className="flex flex-col items-center gap-2 rounded-lg border-2 border-slate-300 p-4 text-center"
              style={{ breakInside: "avoid" }}
            >
              <QRCodeSVG value={label.qrText} size={140} marginSize={2} />
              <p className="text-lg font-bold text-slate-900">{label.itemCode}</p>
              <p className="line-clamp-2 text-xs text-slate-700">{label.itemDescription}</p>
              <p className="text-xs font-semibold text-slate-600">
                {label.warehouseCode}
                {label.locationCode ? ` · ${label.locationCode}` : ""}
                {label.locationName ? ` — ${label.locationName}` : ""}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
