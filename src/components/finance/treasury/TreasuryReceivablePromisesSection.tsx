import React, { useEffect, useState } from "react";
import type { TreasuryPaymentPromiseDto } from "@/src/lib/treasury/contracts/index.js";
import {
  cancelTreasuryPaymentPromise,
  createTreasuryReceivablePromise,
  fetchTreasuryReceivablePromises,
  markTreasuryPaymentPromiseFulfilled,
} from "@/src/lib/treasury/treasuryReceivablesApi.js";
import {
  TREASURY_PROMISE_STATUS_LABELS,
  formatTreasuryReceivableDate,
  formatTreasuryReceivableMoney,
} from "@/src/lib/treasury/treasuryReceivablesUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import { HttpError } from "@/src/lib/http.js";

type Props = {
  titleId: string;
  openAmount: string | null;
  canPromise: boolean;
  onChanged?: () => void;
};

type FormState = {
  promisedDate: string;
  promisedAmount: string;
  contactNote: string;
  channel: string;
  notes: string;
  responsibleUserId: string;
  confirmAboveBalance: boolean;
  justification: string;
};

const emptyForm = (): FormState => ({
  promisedDate: "",
  promisedAmount: "",
  contactNote: "",
  channel: "",
  notes: "",
  responsibleUserId: "",
  confirmAboveBalance: false,
  justification: "",
});

export function TreasuryReceivablePromisesSection({
  titleId,
  openAmount,
  canPromise,
  onChanged,
}: Props) {
  const [promises, setPromises] = useState<TreasuryPaymentPromiseDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchTreasuryReceivablePromises(titleId);
      setPromises(rows);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao carregar promessas."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [titleId]);

  async function handleCreate() {
    if (!canPromise) return;
    setSaving(true);
    setError(null);
    try {
      await createTreasuryReceivablePromise(titleId, {
        promisedDate: form.promisedDate,
        promisedAmount: form.promisedAmount.trim(),
        contactNote: form.contactNote.trim() || null,
        channel: form.channel.trim() || null,
        notes: form.notes.trim() || null,
        responsibleUserId: form.responsibleUserId.trim() || null,
        confirmAboveBalance: form.confirmAboveBalance,
        justification: form.justification.trim() || null,
      });
      setForm(emptyForm());
      await reload();
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof HttpError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Não foi possível criar a promessa."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(p: TreasuryPaymentPromiseDto) {
    if (!canPromise) return;
    const reason = window.prompt("Motivo do cancelamento (opcional):") ?? "";
    setSaving(true);
    setError(null);
    try {
      await cancelTreasuryPaymentPromise(p.id, {
        reason: reason.trim() || null,
        expectedVersion: p.version,
      });
      await reload();
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao cancelar promessa."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleFulfill(p: TreasuryPaymentPromiseDto) {
    if (!canPromise) return;
    const raw = window.prompt(
      "Valor cumprido acumulado (vazio = total prometido):",
      p.promisedAmount
    );
    if (raw === null) return;
    setSaving(true);
    setError(null);
    try {
      await markTreasuryPaymentPromiseFulfilled(p.id, {
        fulfilledAmount: raw.trim() || null,
        notes: null,
        expectedVersion: p.version,
      });
      await reload();
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao marcar cumprimento."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="treasury-receivable-promises">
      <p className="text-xs text-muted-foreground">
        Promessa não altera o vencimento oficial. Saldo aberto:{" "}
        {formatTreasuryReceivableMoney(openAmount)}. Histórico preservado.
      </p>

      {error ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando promessas…</p>
      ) : promises.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma promessa registrada.</p>
      ) : (
        <ul className="space-y-2">
          {promises.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              data-testid={`treasury-promise-row-${p.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {formatTreasuryReceivableDate(p.promisedDate)} ·{" "}
                  {formatTreasuryReceivableMoney(p.promisedAmount)}
                </p>
                <span className="text-xs text-muted-foreground">
                  {TREASURY_PROMISE_STATUS_LABELS[p.status] ?? p.status}
                </span>
              </div>
              <p className="text-muted-foreground">
                Cumprido: {formatTreasuryReceivableMoney(p.fulfilledAmount)}
                {p.channel ? ` · Meio: ${p.channel}` : ""}
                {p.contactNote ? ` · Contato: ${p.contactNote}` : ""}
              </p>
              {canPromise &&
              (p.status === "ACTIVE" || p.status === "PARTIALLY_FULFILLED") ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    disabled={saving}
                    onClick={() => void handleFulfill(p)}
                  >
                    Marcar cumprimento
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    disabled={saving}
                    onClick={() => void handleCancel(p)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canPromise ? (
        <form
          className="space-y-3 rounded-lg border border-border p-3"
          data-testid="treasury-promise-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <p className="text-sm font-semibold">Nova promessa</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>
                Data prometida
              </span>
              <input
                type="date"
                className={financeModuleFilterFieldClass()}
                value={form.promisedDate}
                onChange={(e) =>
                  setForm({ ...form, promisedDate: e.target.value })
                }
                required
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>
                Valor prometido
              </span>
              <input
                type="text"
                className={financeModuleFilterFieldClass()}
                placeholder="0.00"
                value={form.promisedAmount}
                onChange={(e) =>
                  setForm({ ...form, promisedAmount: e.target.value })
                }
                required
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>Contato</span>
              <input
                type="text"
                className={financeModuleFilterFieldClass()}
                value={form.contactNote}
                onChange={(e) =>
                  setForm({ ...form, contactNote: e.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>Meio</span>
              <input
                type="text"
                className={financeModuleFilterFieldClass()}
                value={form.channel}
                onChange={(e) =>
                  setForm({ ...form, channel: e.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>
                Responsável
              </span>
              <input
                type="text"
                className={financeModuleFilterFieldClass()}
                value={form.responsibleUserId}
                onChange={(e) =>
                  setForm({ ...form, responsibleUserId: e.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className={financeModuleFilterLabelClass()}>
                Observação
              </span>
              <textarea
                className={financeModuleFilterFieldClass()}
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.confirmAboveBalance}
                onChange={(e) =>
                  setForm({
                    ...form,
                    confirmAboveBalance: e.target.checked,
                  })
                }
              />
              Confirmar promessa acima do saldo aberto
            </label>
            {form.confirmAboveBalance ? (
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className={financeModuleFilterLabelClass()}>
                  Justificativa *
                </span>
                <textarea
                  className={financeModuleFilterFieldClass()}
                  rows={2}
                  value={form.justification}
                  onChange={(e) =>
                    setForm({ ...form, justification: e.target.value })
                  }
                  required
                />
              </label>
            ) : null}
          </div>
          <button
            type="submit"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            disabled={saving}
            data-testid="treasury-promise-create-submit"
          >
            {saving ? "Salvando…" : "Registrar promessa"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
