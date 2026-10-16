import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import { fetchJsonOk } from "@/src/lib/http";
import { EPI_DELIVERY_SIZE_SUGGESTIONS } from "@/src/lib/employeeHrUi";
import { EPI_ITEM_TYPE_LABELS, EPI_LIMITS, EPI_UNIT_LABELS, computeReplacementDueDate } from "@/src/lib/epi/epiRules";
import { EPI_BTN_LINK, EPI_BTN_PRIMARY, EPI_BTN_SECONDARY, EPI_INPUT, formatIsoDay, type EpiEvent, type EpiItem } from "./epiUi";

export type EpiEventModalMode = { kind: "new" } | { kind: "edit"; event: EpiEvent };

type Row = { key: number; itemId: string; quantity: string; size: string; days: string; dueDate: string; adjustReason: string };

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let rowKey = 0;
const emptyRow = (): Row => ({ key: ++rowKey, itemId: "", quantity: "1", size: "", days: "", dueDate: "", adjustReason: "" });

/** Nova entrega (um ou vários itens na mesma ocasião, uma ficha) ou correção da data/observações. */
export function EpiEventModal({
  open,
  mode,
  employeeId,
  onClose,
  onSaved,
  onManageCatalog,
}: {
  open: boolean;
  mode: EpiEventModalMode;
  employeeId: string;
  onClose: () => void;
  onSaved: () => void;
  onManageCatalog?: () => void;
}) {
  const today = localTodayIso();
  const editing = mode.kind === "edit" ? mode.event : null;
  const [items, setItems] = useState<EpiItem[] | null>(null);
  const [deliveredOn, setDeliveredOn] = useState(editing ? editing.deliveredAt.slice(0, 10) : today);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || editing) return;
    let alive = true;
    void fetchJsonOk<{ items: EpiItem[] }>("/api/hr/epi-items", { cache: "no-store" })
      .then((r) => alive && setItems(r.items))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Não foi possível carregar os itens."));
    return () => {
      alive = false;
    };
  }, [open, editing]);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const rowState = (r: Row) => {
    const item = byId.get(r.itemId) ?? null;
    const catalogDays = item?.replacementDays ?? null;
    const daysNum = r.days === "" ? null : Number(r.days);
    const validDays = daysNum && Number.isInteger(daysNum) && daysNum > 0 ? daysNum : null;
    const autoDue = computeReplacementDueDate(deliveredOn, validDays);
    const adjusted = Boolean(item) && ((daysNum ?? null) !== catalogDays || (r.dueDate !== "" && r.dueDate !== autoDue));
    const errors: string[] = [];
    if (!item) errors.push("selecione o item");
    if (!Number.isInteger(Number(r.quantity)) || Number(r.quantity) < 1) errors.push("quantidade inválida");
    if (adjusted && r.adjustReason.trim().length < EPI_LIMITS.reasonMin) errors.push("justifique o prazo diferente do cadastro");
    return { item, catalogDays, daysNum, autoDue, adjusted, errors };
  };

  const formErrors: string[] = [];
  if (!deliveredOn) formErrors.push("Informe a data da entrega.");
  else if (deliveredOn > today) formErrors.push("A data da entrega não pode ser futura.");
  if (!editing) {
    rows.forEach((r, i) => {
      const st = rowState(r);
      if (st.errors.length) formErrors.push(`Item ${i + 1}: ${st.errors.join(", ")}.`);
    });
  }

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await fetchJsonOk(`/api/employees/${employeeId}/epi-events/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deliveredOn, notes: notes.trim() || null }),
        });
      } else {
        await fetchJsonOk(`/api/employees/${employeeId}/epi-events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deliveredOn,
            notes: notes.trim() || null,
            items: rows.map((r) => {
              const st = rowState(r);
              return {
                itemId: r.itemId,
                quantity: Number(r.quantity),
                size: r.size.trim() || null,
                replacementDays: st.daysNum,
                ...(r.dueDate ? { replacementDueDate: r.dueDate } : {}),
                adjustReason: st.adjusted ? r.adjustReason.trim() : null,
              };
            }),
          }),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a entrega.");
    } finally {
      setSaving(false);
    }
  };

  const activeItems = (items ?? []).filter((i) => i.active);

  return (
    <Overlay open={open} onClose={onClose} size="lg" ariaLabelledBy="epi-event-title" testId="epi-event-modal">
      <OverlayHeader
        titleId="epi-event-title"
        eyebrow="EPI / Uniformes"
        title={editing ? "Corrigir entrega" : "Nova entrega"}
        subtitle={
          editing
            ? `Entrega de ${formatIsoDay(editing.deliveredAt)} com ${editing.itemCount} item(ns). A data vale para todos os itens; a próxima troca calculada acompanha. Ficha já emitida não muda: a próxima emissão gera nova revisão.`
            : "Todos os itens entregues nesta ocasião ficam em uma única ficha. Cada item mantém prazo e troca próprios. O responsável é o seu usuário."
        }
        onClose={onClose}
      />
      <OverlayBody>
        <form
          id="epi-event-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation(); // o submit de React atravessa o portal até o formulário do cadastro
            if (formErrors.length === 0) void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Data da entrega *</span>
              <input className={EPI_INPUT} type="date" max={today} value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} data-testid="epi-event-date" />
            </label>
            <label className="space-y-1 sm:col-span-3">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Observações da entrega</span>
              <input className={EPI_INPUT} value={notes} maxLength={EPI_LIMITS.notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: integração da célula 4" />
            </label>
          </div>

          {editing ? (
            <ul className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
              {editing.items.map((i) => (
                <li key={i.id}>
                  {i.itemCode ? <span className="mr-1 font-mono text-xs text-muted-foreground">{i.itemCode}</span> : null}
                  {i.item} · qtd. {i.quantity}
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Itens entregues ({rows.length})</p>
                {onManageCatalog ? (
                  <button type="button" className={EPI_BTN_LINK} onClick={onManageCatalog}>
                    Gerenciar EPIs / Uniformes
                  </button>
                ) : null}
              </div>
              {rows.map((r, index) => {
                const st = rowState(r);
                return (
                  <div key={r.key} className="space-y-2 rounded-xl border border-border p-3" data-testid="epi-event-row">
                    <div className="grid gap-2 sm:grid-cols-12">
                      <label className="space-y-1 sm:col-span-6">
                        <span className="text-[11px] font-semibold uppercase text-muted-foreground">Item {index + 1} *</span>
                        <select
                          className={EPI_INPUT}
                          value={r.itemId}
                          onChange={(e) => {
                            const item = byId.get(e.target.value);
                            setRow(r.key, { itemId: e.target.value, days: item?.replacementDays ? String(item.replacementDays) : "", dueDate: "", adjustReason: "" });
                          }}
                          data-testid="epi-event-item"
                        >
                          <option value="">{items ? "Selecione…" : "Carregando…"}</option>
                          {activeItems.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.code} · {i.description}
                              {i.caNumber ? ` (CA ${i.caNumber})` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 sm:col-span-2">
                        <span className="text-[11px] font-semibold uppercase text-muted-foreground">Qtd. *</span>
                        <input className={EPI_INPUT} type="number" min={1} step={1} value={r.quantity} onChange={(e) => setRow(r.key, { quantity: e.target.value })} />
                      </label>
                      <label className="space-y-1 sm:col-span-2">
                        <span className="text-[11px] font-semibold uppercase text-muted-foreground">Tamanho</span>
                        <input className={EPI_INPUT} value={r.size} maxLength={40} list="epi-event-size-suggestions" onChange={(e) => setRow(r.key, { size: e.target.value })} />
                      </label>
                      <label className="space-y-1 sm:col-span-2">
                        <span className="text-[11px] font-semibold uppercase text-muted-foreground">Prazo (dias)</span>
                        <input
                          className={EPI_INPUT}
                          type="number"
                          min={1}
                          step={1}
                          value={r.days}
                          placeholder="Sem troca"
                          onChange={(e) => setRow(r.key, { days: e.target.value, dueDate: "" })}
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {st.item ? (
                        <span>
                          {EPI_ITEM_TYPE_LABELS[st.item.type]} · {EPI_UNIT_LABELS[st.item.unit]}
                          {st.item.caNumber ? ` · CA ${st.item.caNumber}` : ""}
                        </span>
                      ) : null}
                      <label className="inline-flex items-center gap-1.5">
                        Próxima troca:
                        <input
                          type="date"
                          className="h-7 rounded border border-border bg-background px-1.5 text-xs"
                          min={deliveredOn}
                          value={r.dueDate || st.autoDue || ""}
                          disabled={!st.autoDue && !r.dueDate}
                          onChange={(e) => setRow(r.key, { dueDate: e.target.value === st.autoDue ? "" : e.target.value })}
                        />
                        {!st.autoDue && !r.dueDate ? "sem troca programada" : r.dueDate ? "ajustada" : "calculada"}
                      </label>
                      {rows.length > 1 ? (
                        <button
                          type="button"
                          className="ml-auto inline-flex items-center gap-1 text-rose-700 hover:underline"
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        >
                          <Trash2 className="h-3 w-3" /> Remover
                        </button>
                      ) : null}
                    </div>
                    {st.adjusted ? (
                      <input
                        className={EPI_INPUT}
                        value={r.adjustReason}
                        maxLength={EPI_LIMITS.reason}
                        onChange={(e) => setRow(r.key, { adjustReason: e.target.value })}
                        placeholder={`Justificativa do prazo (o cadastro prevê ${st.catalogDays ? `${st.catalogDays} dias` : "sem troca programada"})`}
                      />
                    ) : null}
                  </div>
                );
              })}
              <datalist id="epi-event-size-suggestions">
                {EPI_DELIVERY_SIZE_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <button type="button" className={EPI_BTN_SECONDARY} onClick={() => setRows((rs) => [...rs, emptyRow()])} data-testid="epi-event-add-row">
                <Plus className="h-4 w-4" /> Adicionar item
              </button>
            </div>
          )}

          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Este lançamento registra o fornecimento. A comprovação de recebimento (NR-6) é a ficha assinada: emita a ficha da entrega, colha as
            assinaturas e anexe a ficha digitalizada.
          </p>
          {formErrors.length && (editing || rows.some((r) => r.itemId)) ? (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-700" data-testid="epi-event-errors">
              {formErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
        </form>
      </OverlayBody>
      <OverlayFooter>
        <button type="button" className={EPI_BTN_SECONDARY} onClick={onClose} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" form="epi-event-form" className={EPI_BTN_PRIMARY} disabled={saving || formErrors.length > 0} data-testid="epi-event-save">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {editing ? "Salvar correção" : `Registrar entrega (${rows.length} ${rows.length === 1 ? "item" : "itens"})`}
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
