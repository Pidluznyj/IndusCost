/**
 * Tela de vínculo: pesquisa MP oficial (read-only) e ativa controle de estoque.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  formatInventoryApiError,
  inventoryFilterInputClass,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryLocationRow, InventoryWarehouseRow } from "@/src/types/inventory";
import { normalizeInventoryLocationListResponse } from "@/src/components/inventory/inventoryLocationForm";

export type OfficialMaterialSearchRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  status: string | null;
  category: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onLinked: () => void;
};

export function InventoryMaterialLinkSheet({ open, onClose, onLinked }: Props) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<OfficialMaterialSearchRow[]>([]);
  const [selected, setSelected] = useState<OfficialMaterialSearchRow | null>(null);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseRow[]>([]);
  const [locations, setLocations] = useState<InventoryLocationRow[]>([]);
  const [defaultWarehouseId, setDefaultWarehouseId] = useState("");
  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [minimumStock, setMinimumStock] = useState("");
  const [safetyStock, setSafetyStock] = useState("");
  const [controlsStock, setControlsStock] = useState(true);
  const [controlsLot, setControlsLot] = useState(false);
  const [allowsReservation, setAllowsReservation] = useState(true);
  const [allowsBlock, setAllowsBlock] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchJsonOk<{ rows?: InventoryWarehouseRow[] }>(
      "/api/inventory/warehouses?pageSize=200&status=ACTIVE"
    )
      .then((res) => setWarehouses(res.rows ?? []))
      .catch(() => setWarehouses([]));
  }, [open]);

  useEffect(() => {
    if (!defaultWarehouseId) {
      setLocations([]);
      setDefaultLocationId("");
      return;
    }
    void fetchJsonOk<unknown>(
      `/api/inventory/warehouses/${defaultWarehouseId}/locations?status=ACTIVE`
    )
      .then((raw) => {
        const data = normalizeInventoryLocationListResponse(raw);
        setLocations(data.rows);
      })
      .catch(() => setLocations([]));
  }, [defaultWarehouseId]);

  const search = useCallback(async () => {
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "40");
      const res = await fetchJsonOk<{ rows?: OfficialMaterialSearchRow[] }>(
        `/api/inventory/official-materials?${params.toString()}`
      );
      setResults(res.rows ?? []);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Falha ao pesquisar matérias-primas oficiais."));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => void search(), 250);
    return () => window.clearTimeout(t);
  }, [open, search]);

  if (!open) return null;

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk("/api/inventory/items/link-material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: selected.id,
          defaultWarehouseId: defaultWarehouseId || null,
          defaultLocationId: defaultLocationId || null,
          controlsStock,
          minimumStock: minimumStock.trim() ? Number(minimumStock) : null,
          safetyStock: safetyStock.trim() ? Number(safetyStock) : null,
          controlsLot,
          allowsReservation,
          allowsBlock,
          status: "ACTIVE",
        }),
      });
      onLinked();
      onClose();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível vincular a matéria-prima."));
    } finally {
      setSaving(false);
    }
  };

  const inputClass = cn(inventoryFilterInputClass, "w-full");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" data-testid="inventory-material-link-sheet">
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Vincular matéria-prima oficial</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Pesquisa somente leitura no cadastro oficial. Não cria nem edita MP.
            </p>
          </div>
          <button type="button" className="rounded p-1 hover:bg-slate-100" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Pesquisar MP oficial</span>
            <div className="relative mt-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className={cn(inputClass, "pl-8")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Código ou descrição…"
                data-testid="inventory-official-material-search"
              />
            </div>
          </label>

          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
            {searching ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : results.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">Nenhuma matéria-prima encontrada.</p>
            ) : (
              <ul className="divide-y divide-slate-100" data-testid="inventory-official-material-results">
                {results.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-slate-50",
                        selected?.id === row.id && "bg-slate-100"
                      )}
                      onClick={() => setSelected(row)}
                    >
                      <div className="font-medium text-slate-900">
                        {row.code} — {row.description}
                      </div>
                      <div className="text-xs text-slate-500">
                        Unidade oficial: {row.unit}
                        {row.category ? ` · ${row.category}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected ? (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-900">
                Selecionada: {selected.code} ({selected.unit})
              </p>
              <p className="text-xs text-slate-500">
                Código, descrição e unidade vêm do cadastro oficial (snapshot no vínculo).
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Almoxarifado padrão</span>
                  <select
                    className={cn(inputClass, "mt-1")}
                    value={defaultWarehouseId}
                    onChange={(e) => setDefaultWarehouseId(e.target.value)}
                  >
                    <option value="">— Opcional —</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Local padrão</span>
                  <select
                    className={cn(inputClass, "mt-1")}
                    value={defaultLocationId}
                    onChange={(e) => setDefaultLocationId(e.target.value)}
                    disabled={!defaultWarehouseId}
                  >
                    <option value="">— Opcional —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Estoque mínimo</span>
                  <input
                    className={cn(inputClass, "mt-1")}
                    value={minimumStock}
                    onChange={(e) => setMinimumStock(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Estoque de segurança</span>
                  <input
                    className={cn(inputClass, "mt-1")}
                    value={safetyStock}
                    onChange={(e) => setSafetyStock(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={controlsStock}
                    onChange={(e) => setControlsStock(e.target.checked)}
                  />
                  Controla estoque
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={controlsLot}
                    onChange={(e) => setControlsLot(e.target.checked)}
                  />
                  Controle de lote
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allowsReservation}
                    onChange={(e) => setAllowsReservation(e.target.checked)}
                  />
                  Permite reserva
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allowsBlock}
                    onChange={(e) => setAllowsBlock(e.target.checked)}
                  />
                  Permite bloqueio
                </label>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!selected || saving}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            onClick={() => void submit()}
            data-testid="inventory-material-link-submit"
          >
            {saving ? "Vinculando…" : "Ativar no estoque"}
          </button>
        </div>
      </div>
    </div>
  );
}
