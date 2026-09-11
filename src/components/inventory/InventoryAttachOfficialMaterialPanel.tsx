/**
 * Vínculo administrativo de InventoryItem existente (órfão) à MP oficial.
 * Não cria item. Não adivinha. Confirmação explícita antes do POST.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  formatInventoryApiError,
  formatInventoryQuantity,
  inventoryFilterInputClass,
} from "@/src/components/inventory/inventoryUi";
import type { OfficialMaterialSearchRow } from "@/src/components/inventory/InventoryMaterialLinkSheet";
import type { InventoryItemRow } from "@/src/types/inventory";

type Props = {
  item: InventoryItemRow;
  physicalQuantity: number;
  canManage: boolean;
  onLinked: () => void;
};

type ConfirmState = {
  material: OfficialMaterialSearchRow;
  materialQuantity: string;
  alreadyLinkedItemId: string | null;
  unitCompatible: boolean;
  canonicalPhysicalQuantity: string;
};

export function InventoryAttachOfficialMaterialPanel({
  item,
  physicalQuantity,
  canManage,
  onLinked,
}: Props) {
  const linked = Boolean(item.materialId);
  const isRaw = item.itemType === "RAW_MATERIAL";
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<OfficialMaterialSearchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [saving, setSaving] = useState(false);

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

  if (!isRaw) return null;

  const choose = async (material: OfficialMaterialSearchRow) => {
    setError(null);
    try {
      const preview = await fetchJsonOk<{
        material: { quantity: string };
        otherActiveItemId: string | null;
        unitCompatible: boolean;
        canonicalPhysicalQuantity: string;
      }>(
        `/api/inventory/items/${item.id}/link-existing-material-preview?materialId=${encodeURIComponent(material.id)}`
      );
      setConfirm({
        material,
        materialQuantity: preview.material.quantity,
        alreadyLinkedItemId: preview.otherActiveItemId,
        unitCompatible: preview.unitCompatible,
        canonicalPhysicalQuantity: preview.canonicalPhysicalQuantity,
      });
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível validar a matéria-prima selecionada."));
    }
  };

  const submit = async () => {
    if (!confirm || confirm.alreadyLinkedItemId) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/inventory/items/${item.id}/link-existing-material`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId: confirm.material.id }),
      });
      setOpen(false);
      setConfirm(null);
      onLinked();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível vincular a matéria-prima oficial."));
    } finally {
      setSaving(false);
    }
  };

  const unitBlocked = confirm ? !confirm.unitCompatible : false;
  const codesDiffer = confirm ? item.code.trim() !== confirm.material.code.trim() : false;
  const confirmPhysical = confirm
    ? Number(confirm.canonicalPhysicalQuantity)
    : physicalQuantity;

  return (
    <section
      className="rounded-lg border border-slate-200 p-4"
      data-testid="inventory-item-official-material-link"
    >
      <h4 className="text-sm font-semibold text-slate-900">Matéria-prima oficial</h4>
      {linked ? (
        <p className="mt-1 text-sm text-slate-700">
          Vinculada:{" "}
          <span className="font-mono">
            {item.materialCodeSnapshot ?? item.materialId}
          </span>
          {item.materialDescriptionSnapshot ? ` — ${item.materialDescriptionSnapshot}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-sm font-medium text-amber-800">NÃO VINCULADA</p>
      )}

      {!linked && canManage ? (
        <button
          type="button"
          className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
          data-testid="inventory-item-attach-official-material"
          onClick={() => {
            setOpen(true);
            setConfirm(null);
            setError(null);
          }}
        >
          Vincular matéria-prima
        </button>
      ) : null}

      {open ? (
        <div className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          {!confirm ? (
            <>
              <p className="text-xs text-slate-500">
                Pesquisa somente leitura no cadastro oficial. Nenhum material é escolhido automaticamente.
              </p>
              <input
                className={cn(inventoryFilterInputClass, "w-full")}
                placeholder="Código ou descrição"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                data-testid="inventory-attach-material-search"
              />
              {searching ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                </div>
              ) : (
                <ul className="max-h-48 overflow-y-auto divide-y divide-slate-200 rounded border border-slate-200 bg-white">
                  {results.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => void choose(row)}
                      >
                        <span className="font-mono font-medium">{row.code}</span>
                        <span className="ml-2 text-slate-600">{row.description}</span>
                        <span className="ml-2 text-xs text-slate-400">{row.unit}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="text-sm text-slate-600 underline"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
            </>
          ) : (
            <div className="space-y-2 text-sm" data-testid="inventory-attach-material-confirm">
              <div>
                <p className="font-semibold text-slate-900">ITEM DE ESTOQUE</p>
                <p>
                  Código: <span className="font-mono font-medium">{item.code}</span>
                  <br />
                  Descrição: {item.description}
                  <br />
                  Unidade: {item.unit}
                  <br />
                  Saldo físico canônico: {formatInventoryQuantity(confirmPhysical, item.unit)}
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">MATERIAL OFICIAL</p>
                <p>
                  Código: <span className="font-mono font-medium">{confirm.material.code}</span>
                  <br />
                  Descrição: {confirm.material.description}
                  <br />
                  Unidade: {confirm.material.unit}
                  <br />
                  Saldo cadastral atual (Material.quantity):{" "}
                  {formatInventoryQuantity(Number(confirm.materialQuantity), confirm.material.unit)}
                </p>
              </div>
              {codesDiffer ? (
                <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                  O código do item de estoque é diferente do código da matéria-prima oficial.
                  <br />
                  Item: {item.code}
                  <br />
                  Material: {confirm.material.code}
                  <br />
                  Confirme somente se os dois registros representam a mesma matéria-prima. O item não será
                  renomeado.
                </p>
              ) : null}
              {unitBlocked ? (
                <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-800">
                  Unidade incompatível ({item.unit} × {confirm.material.unit}). Vínculo bloqueado.
                </p>
              ) : null}
              {confirm.alreadyLinkedItemId ? (
                <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-800">
                  Esta matéria-prima já possui item ativo no estoque. Vínculo bloqueado.
                </p>
              ) : null}
              {!unitBlocked && !confirm.alreadyLinkedItemId ? (
                <p className="text-slate-700">
                  Saldo físico atual: {formatInventoryQuantity(confirmPhysical, item.unit)}
                  <br />
                  Saldo cadastral atual:{" "}
                  {formatInventoryQuantity(Number(confirm.materialQuantity), confirm.material.unit)}
                  <br />
                  Após o vínculo: Material.quantity será reconciliado para{" "}
                  {formatInventoryQuantity(confirmPhysical, item.unit)}. Nenhuma movimentação de estoque
                  será criada.
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5"
                  onClick={() => setConfirm(null)}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={saving || Boolean(unitBlocked) || Boolean(confirm.alreadyLinkedItemId)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50"
                  data-testid="inventory-attach-material-submit"
                  onClick={() => void submit()}
                >
                  {saving ? "Vinculando…" : "Confirmar vínculo"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
