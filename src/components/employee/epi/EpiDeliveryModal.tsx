import React, { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import { fetchJsonOk } from "@/src/lib/http";
import { EPI_DELIVERY_SIZE_SUGGESTIONS } from "@/src/lib/employeeHrUi";
import {
  EPI_ITEM_TYPE_LABELS,
  EPI_LIMITS,
  EPI_UNIT_LABELS,
  computeReplacementDueDate,
} from "@/src/lib/epi/epiRules";
import { EPI_BTN_PRIMARY, EPI_BTN_SECONDARY, EPI_INPUT, formatIsoDay, type EpiDelivery, type EpiItem } from "./epiUi";

/** Item de uma entrega: substituição (gera nova entrega de 1 item) ou correção. Entregas novas: EpiEventModal. */
export type EpiDeliveryModalMode =
  | { kind: "replace"; delivery: EpiDelivery }
  | { kind: "edit"; delivery: EpiDelivery };

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`space-y-1 ${className ?? ""}`}>
      <span className="text-xs font-semibold uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function EpiDeliveryModal({
  open,
  mode,
  employeeId,
  employeeName,
  onClose,
  onSaved,
  onManageCatalog,
}: {
  open: boolean;
  mode: EpiDeliveryModalMode;
  employeeId: string;
  employeeName?: string | null;
  onClose: () => void;
  onSaved: () => void;
  onManageCatalog?: () => void;
}) {
  const today = localTodayIso();
  const source = mode.delivery;
  const [items, setItems] = useState<EpiItem[] | null>(null);
  const [itemId, setItemId] = useState(source?.itemId ?? "");
  const [deliveredOn, setDeliveredOn] = useState(mode.kind === "edit" ? source!.deliveredAt.slice(0, 10) : today);
  const [quantity, setQuantity] = useState(String(mode.kind === "edit" ? source!.quantity : source?.quantity ?? 1));
  const [size, setSize] = useState(source?.size ?? "");
  const [days, setDays] = useState<string>(mode.kind === "edit" ? (source!.replacementDays ? String(source!.replacementDays) : "") : "");
  const [dueDate, setDueDate] = useState("");
  const [adjustReason, setAdjustReason] = useState(mode.kind === "edit" ? source!.replacementAdjustReason ?? "" : "");
  const [notes, setNotes] = useState(mode.kind === "edit" ? source!.notes ?? "" : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetchJsonOk<{ items: EpiItem[] }>("/api/hr/epi-items?includeInactive=1", { cache: "no-store" })
      .then((r) => alive && setItems(r.items))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Não foi possível carregar os itens."));
    return () => {
      alive = false;
    };
  }, [open, employeeId]);

  const selected = items?.find((i) => i.id === itemId) ?? null;
  const catalogDays = selected?.replacementDays ?? null;

  // Novo item selecionado (novo / substituição): prazo volta ao do cadastro.
  useEffect(() => {
    if (mode.kind === "edit" || !items) return;
    setDays(catalogDays ? String(catalogDays) : "");
    setDueDate("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, items]);

  // Correção: mostra a data prevista gravada quando ela foi ajustada manualmente.
  useEffect(() => {
    if (mode.kind !== "edit" || !source) return;
    const auto = computeReplacementDueDate(source.deliveredAt.slice(0, 10), source.replacementDays);
    if (source.replacementDueDate && source.replacementDueDate !== auto) setDueDate(source.replacementDueDate);
  }, [mode.kind, source]);

  const daysNum = days === "" ? null : Number(days);
  const autoDue = computeReplacementDueDate(deliveredOn, daysNum && Number.isInteger(daysNum) && daysNum > 0 ? daysNum : null);
  const effectiveDue = dueDate || autoDue;
  const adjusted = (daysNum ?? null) !== catalogDays || (dueDate !== "" && dueDate !== autoDue);
  const activeItems = useMemo(() => (items ?? []).filter((i) => i.active || i.id === source?.itemId), [items, source?.itemId]);

  const localErrors: string[] = [];
  if (mode.kind !== "edit" && !itemId) localErrors.push("Selecione o EPI / uniforme.");
  if (!deliveredOn) localErrors.push("Informe a data da entrega.");
  else if (deliveredOn > today) localErrors.push("A data da entrega não pode ser futura.");
  if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1) localErrors.push("Quantidade deve ser maior que zero.");
  if (adjusted && selected && adjustReason.trim().length < EPI_LIMITS.reasonMin) {
    localErrors.push(`Prazo diferente do cadastro: informe a justificativa (mín. ${EPI_LIMITS.reasonMin} caracteres).`);
  }
  if (mode.kind === "replace" && deliveredOn < source!.deliveredAt.slice(0, 10)) {
    localErrors.push("A substituição não pode ter data anterior à entrega substituída.");
  }

  const submit = async () => {
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      deliveredOn,
      quantity: Number(quantity),
      size: size.trim() || null,
      notes: notes.trim() || null,
      replacementDays: daysNum,
      ...(dueDate ? { replacementDueDate: dueDate } : {}),
      adjustReason: adjusted ? adjustReason.trim() : null,
    };
    try {
      if (mode.kind === "edit") {
        await fetchJsonOk(`/api/employees/${employeeId}/epi-deliveries/${source!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJsonOk(`/api/employees/${employeeId}/epi-deliveries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            itemId,
            ...(mode.kind === "replace" ? { replacesDeliveryId: source!.id } : {}),
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

  const title = mode.kind === "replace" ? "Registrar substituição" : "Corrigir entrega";
  return (
    <Overlay open={open} onClose={onClose} size="md" ariaLabelledBy="epi-delivery-title" testId="epi-delivery-modal">
      <OverlayHeader
        titleId="epi-delivery-title"
        eyebrow={`EPI / Uniformes${employeeName ? ` · ${employeeName}` : ""}`}
        title={title}
        subtitle={
          mode.kind === "replace"
            ? `Substitui a entrega vigente de ${formatIsoDay(source!.deliveredAt)} (${source!.itemCode ? `${source!.itemCode} · ` : ""}${source!.item}). Ela fica no histórico como "Substituído".`
            : "Correção auditada: autor, data/hora e valores anteriores ficam registrados. O item não muda (cancele e registre outra entrega)."
        }
        onClose={onClose}
      />
      <OverlayBody>
        <form
          className="space-y-4"
          id="epi-delivery-form"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation(); // o submit de React atravessa o portal até o formulário do cadastro
            if (localErrors.length === 0) void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="EPI / Uniforme *" className="sm:col-span-4">
              {mode.kind === "edit" ? (
                <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  {source!.itemCode ? `${source!.itemCode} · ` : ""}
                  {source!.item}
                </p>
              ) : (
                <div className="flex gap-2">
                  <select className={EPI_INPUT} value={itemId} onChange={(e) => setItemId(e.target.value)} data-testid="epi-delivery-item">
                    <option value="">{items ? "Selecione…" : "Carregando…"}</option>
                    {activeItems.map((i) => (
                      <option key={i.id} value={i.id} disabled={!i.active}>
                        {i.code} · {i.description}
                        {i.caNumber ? ` (CA ${i.caNumber})` : ""}
                        {i.active ? "" : " — inativo"}
                      </option>
                    ))}
                  </select>
                  {onManageCatalog ? (
                    <button type="button" className={EPI_BTN_SECONDARY} onClick={onManageCatalog} title="Gerenciar EPIs / Uniformes">
                      Cadastro
                    </button>
                  ) : null}
                </div>
              )}
              {selected ? (
                <p className="text-xs text-muted-foreground">
                  {EPI_ITEM_TYPE_LABELS[selected.type]} · {EPI_UNIT_LABELS[selected.unit]}
                  {selected.caNumber ? ` · CA ${selected.caNumber}` : ""} · troca{" "}
                  {selected.replacementDays ? `a cada ${selected.replacementDays} dias` : "não programada"}
                </p>
              ) : null}
            </Field>
            <Field label="Data da entrega *">
              <input className={EPI_INPUT} type="date" max={today} value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} />
            </Field>
            <Field label="Quantidade *">
              <input className={EPI_INPUT} type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Field label="Tamanho">
              <input className={EPI_INPUT} value={size} maxLength={40} list="epi-size-suggestions" onChange={(e) => setSize(e.target.value)} />
              <datalist id="epi-size-suggestions">
                {EPI_DELIVERY_SIZE_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Prazo de troca (dias)">
              <input
                className={EPI_INPUT}
                type="number"
                min={1}
                step={1}
                value={days}
                onChange={(e) => {
                  setDays(e.target.value);
                  setDueDate("");
                }}
                placeholder="Sem troca"
              />
            </Field>
            <Field label="Próxima troca" className="sm:col-span-2">
              <input
                className={EPI_INPUT}
                type="date"
                min={deliveredOn}
                value={dueDate || autoDue || ""}
                onChange={(e) => setDueDate(e.target.value === autoDue ? "" : e.target.value)}
                disabled={!autoDue && !dueDate}
                data-testid="epi-delivery-due"
              />
              <span className="text-xs text-muted-foreground">
                {effectiveDue
                  ? dueDate
                    ? "Data ajustada manualmente."
                    : `Calculada: entrega + ${daysNum} dia(s).`
                  : "Sem troca programada."}
              </span>
            </Field>
            {adjusted && selected !== null ? (
              <Field label="Justificativa do prazo *" className="sm:col-span-4">
                <textarea
                  className={EPI_INPUT}
                  rows={2}
                  maxLength={EPI_LIMITS.reason}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder={`O prazo do cadastro é ${catalogDays ? `${catalogDays} dias` : "sem troca programada"}. Explique o ajuste.`}
                  data-testid="epi-delivery-adjust-reason"
                />
              </Field>
            ) : null}
            <Field label="Observações" className="sm:col-span-4">
              <textarea className={EPI_INPUT} rows={2} maxLength={EPI_LIMITS.notes} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Este lançamento registra o fornecimento. A comprovação de recebimento (NR-6) é a ficha assinada: depois de salvar, use
            “Emitir ficha” na entrega, colha as assinaturas e anexe a ficha digitalizada.
          </p>
          {localErrors.length && (itemId || mode.kind === "edit") ? (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-700">
              {localErrors.map((e) => (
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
        <button type="submit" form="epi-delivery-form" className={EPI_BTN_PRIMARY} disabled={saving || localErrors.length > 0} data-testid="epi-delivery-save">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {mode.kind === "edit" ? "Salvar correção" : mode.kind === "replace" ? "Registrar substituição" : "Registrar entrega"}
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
