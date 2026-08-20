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
 */
import React, { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchJsonOk } from "@/src/lib/http";

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

export function InventoryCountLabelsPage() {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="mx-auto max-w-5xl">
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
              disabled={labels.length === 0}
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
