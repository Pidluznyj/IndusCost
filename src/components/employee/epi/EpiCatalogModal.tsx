import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  EPI_ITEM_TYPES,
  EPI_ITEM_TYPE_LABELS,
  EPI_LIMITS,
  EPI_UNITS,
  EPI_UNIT_LABELS,
  type EpiItemType,
  type EpiUnit,
} from "@/src/lib/epi/epiRules";
import { EPI_BTN_LINK, EPI_BTN_PRIMARY, EPI_BTN_SECONDARY, EPI_INPUT, type EpiItem } from "./epiUi";

type Draft = {
  id: string | null;
  description: string;
  type: EpiItemType;
  caNumber: string;
  unit: EpiUnit;
  replacementDays: string;
  notes: string;
};

const EMPTY: Draft = { id: null, description: "", type: "EPI", caNumber: "", unit: "UNIT", replacementDays: "", notes: "" };

function ItemForm({
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
  error,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <form
      className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation(); // o submit de React atravessa o portal até o formulário do cadastro
        onSave();
      }}
      data-testid="epi-item-form"
    >
      <p className="text-sm font-semibold">{draft.id ? "Editar item" : "Novo EPI / uniforme"}</p>
      <div className="grid gap-3 sm:grid-cols-6">
        <label className="space-y-1 sm:col-span-4">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Descrição *</span>
          <input
            className={EPI_INPUT}
            value={draft.description}
            maxLength={EPI_LIMITS.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Ex.: Protetor auricular tipo plug"
            autoFocus
          />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Tipo *</span>
          <select
            className={EPI_INPUT}
            value={draft.type}
            disabled={Boolean(draft.id)}
            title={draft.id ? "O código já identifica o tipo; cadastre outro item para mudar o tipo." : undefined}
            onChange={(e) => set({ type: e.target.value as EpiItemType })}
          >
            {EPI_ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {EPI_ITEM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            Nº do CA {draft.type === "EPI" ? "" : "(se houver)"}
          </span>
          <input
            className={EPI_INPUT}
            value={draft.caNumber}
            maxLength={EPI_LIMITS.caNumber}
            onChange={(e) => set({ caNumber: e.target.value })}
            placeholder="Ex.: 5745"
          />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Unidade *</span>
          <select className={EPI_INPUT} value={draft.unit} onChange={(e) => set({ unit: e.target.value as EpiUnit })}>
            {EPI_UNITS.map((u) => (
              <option key={u} value={u}>
                {EPI_UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Prazo de troca (dias)</span>
          <input
            className={EPI_INPUT}
            type="number"
            min={1}
            max={EPI_LIMITS.replacementDaysMax}
            step={1}
            value={draft.replacementDays}
            onChange={(e) => set({ replacementDays: e.target.value })}
            placeholder="Vazio = sem troca programada"
          />
        </label>
        <label className="space-y-1 sm:col-span-6">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Observações</span>
          <textarea
            className={EPI_INPUT}
            rows={2}
            maxLength={EPI_LIMITS.notes}
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        O prazo de troca é a periodicidade definida pela empresa (não é validade legal). O CA identifica o EPI aprovado e não
        indica validade nem vida útil. Alterar o cadastro não muda entregas já registradas.
      </p>
      {error ? <p className="text-xs font-medium text-rose-700">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={EPI_BTN_SECONDARY} onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className={EPI_BTN_PRIMARY} disabled={saving || !draft.description.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {draft.id ? "Salvar item" : "Cadastrar item"}
        </button>
      </div>
    </form>
  );
}

/** Gerenciar EPIs / Uniformes — catálogo global, aberto a partir da ficha do colaborador. */
export function EpiCatalogModal({
  open,
  onClose,
  canManage,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<EpiItem[] | null>(null);
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (includeInactive) params.set("includeInactive", "1");
      const r = await fetchJsonOk<{ items: EpiItem[] }>(`/api/hr/epi-items?${params.toString()}`, { cache: "no-store" });
      setItems(r.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o cadastro.");
    } finally {
      setLoading(false);
    }
  }, [q, includeInactive]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [open, load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      description: draft.description,
      ...(draft.id ? {} : { type: draft.type }),
      caNumber: draft.caNumber || null,
      unit: draft.unit,
      replacementDays: draft.replacementDays === "" ? null : Number(draft.replacementDays),
      notes: draft.notes || null,
    };
    try {
      await fetchJsonOk(draft.id ? `/api/hr/epi-items/${draft.id}` : "/api/hr/epi-items", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDraft(null);
      await load();
      onChanged?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const rowAction = async (item: EpiItem, action: "toggle" | "delete") => {
    if (action === "delete" && !window.confirm(`Excluir "${item.code} · ${item.description}"? Esta ação não pode ser desfeita.`)) return;
    if (action === "toggle" && item.active && !window.confirm(`Inativar "${item.description}"? Ele deixa de aparecer em novas entregas; o histórico e as trocas vigentes continuam.`)) return;
    setRowBusy(item.id);
    setRowError(null);
    try {
      await fetchJsonOk(`/api/hr/epi-items/${item.id}`, {
        method: action === "delete" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: action === "delete" ? undefined : JSON.stringify({ active: !item.active }),
      });
      await load();
      onChanged?.();
    } catch (err) {
      setRowError({ id: item.id, message: err instanceof Error ? err.message : "Não foi possível concluir." });
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <Overlay open={open} onClose={onClose} size="xl" ariaLabelledBy="epi-catalog-title" testId="epi-catalog-modal">
      <OverlayHeader
        titleId="epi-catalog-title"
        eyebrow="RH · EPI / Uniformes"
        title="Gerenciar EPIs / Uniformes"
        subtitle="Cadastro único para toda a empresa. Itens já entregues não são excluídos: inative-os."
        onClose={onClose}
      />
      <OverlayBody>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className={cn(EPI_INPUT, "pl-9")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Pesquisar por descrição, código ou CA"
                aria-label="Pesquisar itens"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Mostrar inativos
            </label>
            {canManage ? (
              <button
                type="button"
                className={EPI_BTN_PRIMARY}
                onClick={() => {
                  setFormError(null);
                  setDraft({ ...EMPTY });
                }}
                data-testid="epi-item-new"
              >
                <Plus className="h-4 w-4" /> Novo item
              </button>
            ) : null}
          </div>

          {draft ? (
            <ItemForm draft={draft} onChange={setDraft} onCancel={() => setDraft(null)} onSave={save} saving={saving} error={formError} />
          ) : null}

          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <div className="relative overflow-x-auto rounded-xl border border-border">
            <table className="min-w-full text-sm" data-testid="epi-catalog-table">
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">CA</th>
                  <th className="px-3 py-2">Unidade</th>
                  <th className="px-3 py-2">Troca</th>
                  <th className="px-3 py-2">Situação</th>
                  {canManage ? <th className="px-3 py-2 text-right">Ações</th> : null}
                </tr>
              </thead>
              <tbody>
                {loading && !items ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </td>
                  </tr>
                ) : items && items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                      Nenhum item encontrado.{canManage ? " Use “Novo item” para cadastrar." : ""}
                    </td>
                  </tr>
                ) : (
                  (items ?? []).map((item) => (
                    <tr key={item.id} className={cn("border-t border-border/70 align-top", !item.active && "bg-muted/30 text-muted-foreground")}>
                      <td className="px-3 py-2 font-mono text-xs">{item.code}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{item.description}</p>
                        {item.notes ? <p className="text-xs text-muted-foreground">{item.notes}</p> : null}
                        {rowError?.id === item.id ? <p className="text-xs font-medium text-rose-700">{rowError.message}</p> : null}
                      </td>
                      <td className="px-3 py-2">{EPI_ITEM_TYPE_LABELS[item.type]}</td>
                      <td className="px-3 py-2">{item.caNumber ?? "—"}</td>
                      <td className="px-3 py-2">{EPI_UNIT_LABELS[item.unit]}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.replacementDays ? `${item.replacementDays} dias` : "Sem troca programada"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            item.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"
                          )}
                        >
                          {item.active ? "Ativo" : "Inativo"}
                        </span>
                        {item.deliveryCount ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">{item.deliveryCount} entrega(s)</p>
                        ) : null}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap justify-end gap-3">
                            <button
                              type="button"
                              className={EPI_BTN_LINK}
                              disabled={rowBusy === item.id}
                              onClick={() => {
                                setFormError(null);
                                setDraft({
                                  id: item.id,
                                  description: item.description,
                                  type: item.type,
                                  caNumber: item.caNumber ?? "",
                                  unit: item.unit,
                                  replacementDays: item.replacementDays ? String(item.replacementDays) : "",
                                  notes: item.notes ?? "",
                                });
                              }}
                            >
                              <Pencil className="mr-1 inline h-3 w-3" />
                              Editar
                            </button>
                            <button type="button" className={EPI_BTN_LINK} disabled={rowBusy === item.id} onClick={() => void rowAction(item, "toggle")}>
                              {item.active ? "Inativar" : "Reativar"}
                            </button>
                            {item.canDelete ? (
                              <button
                                type="button"
                                className={cn(EPI_BTN_LINK, "text-rose-700")}
                                disabled={rowBusy === item.id}
                                onClick={() => void rowAction(item, "delete")}
                              >
                                <Trash2 className="mr-1 inline h-3 w-3" />
                                Excluir
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </OverlayBody>
      <OverlayFooter hint="Excluir só aparece para itens nunca entregues.">
        <button type="button" className={EPI_BTN_SECONDARY} onClick={onClose}>
          Fechar
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
