import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import { fetchCustomerByIdForAutocomplete } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import type { CustomerExclusionRuleItem } from "@/src/components/commissions/commissionsTypes";
import {
  CUSTOMER_EXCLUSION_ALERT_MESSAGE,
  emptyCustomerExclusionForm,
  validateCustomerExclusionForm,
  type CustomerExclusionFormInput,
} from "@/src/components/commissions/customerExclusions/commissionsCustomerExclusionLabels";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial?: CustomerExclusionRuleItem | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (form: CustomerExclusionFormInput) => Promise<void>;
};

export function CommissionsCustomerExclusionFormModal({
  open,
  mode,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<CustomerExclusionFormInput>(emptyCustomerExclusionForm());
  const [localError, setLocalError] = useState<string | null>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    if (mode === "edit" && initial) {
      setForm({
        customerSelection: {
          id: initial.customerId ?? undefined,
          name: initial.customerNameSnapshot,
          taxId: initial.customerTaxId ?? undefined,
          code: initial.customerExternalId != null ? String(initial.customerExternalId) : null,
          source: "induscost",
        },
        effectiveFrom: initial.effectiveFrom,
        effectiveTo: initial.effectiveTo ?? "",
        reason: initial.reason,
        notes: initial.notes ?? "",
      });
      if (initial.customerId) {
        setLoadingCustomer(true);
        void fetchCustomerByIdForAutocomplete(initial.customerId)
          .then((selection) => {
            if (selection) {
              setForm((prev) => ({ ...prev, customerSelection: selection }));
            }
          })
          .finally(() => setLoadingCustomer(false));
      }
    } else {
      setForm(emptyCustomerExclusionForm());
    }
  }, [open, mode, initial]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateCustomerExclusionForm(form);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    setLocalError(null);
    await onSubmit(form);
  }

  function patchCustomer(selection: EntityAutocompleteSelection | null) {
    setForm((prev) => ({ ...prev, customerSelection: selection }));
    setLocalError(null);
  }

  const displayError = localError ?? error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="commissions-customer-exclusion-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-exclusion-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-background shadow-xl">
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div>
            <h2 id="customer-exclusion-modal-title" className="text-lg font-semibold">
              {mode === "create" ? "Nova exclusão de cliente" : "Editar exclusão de cliente"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Clientes excluídos geram comissão R$ 0,00 dentro da vigência.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 py-4">
          <div
            className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
            data-testid="customer-exclusion-alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{CUSTOMER_EXCLUSION_ALERT_MESSAGE}</p>
          </div>

          {displayError ? (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
              data-testid="customer-exclusion-form-error"
              role="alert"
            >
              {displayError}
            </div>
          ) : null}

          <CustomerAutocompleteFilter
            label="Cliente"
            htmlFor="customer-exclusion-customer"
            value={form.customerSelection}
            onChange={patchCustomer}
            onClear={() => patchCustomer(null)}
            disabled={saving || loadingCustomer}
            placeholder="Buscar por nome, CNPJ ou código…"
          />

          <label className="block text-sm">
            <span className="font-medium">Vigência inicial</span>
            <input
              id="customer-exclusion-effective-from"
              type="date"
              required
              className="mt-1 w-full rounded-md border px-2 py-1.5"
              value={form.effectiveFrom}
              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
              disabled={saving}
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium">Vigência final (opcional)</span>
            <input
              id="customer-exclusion-effective-to"
              type="date"
              className="mt-1 w-full rounded-md border px-2 py-1.5"
              value={form.effectiveTo}
              onChange={(e) => setForm((f) => ({ ...f, effectiveTo: e.target.value }))}
              disabled={saving}
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium">Motivo</span>
            <textarea
              id="customer-exclusion-reason"
              required
              rows={2}
              className="mt-1 w-full rounded-md border px-2 py-1.5"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Ex.: Cliente excluído de comissionamento — política comercial"
              disabled={saving}
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium">Observações (opcional)</span>
            <textarea
              id="customer-exclusion-notes"
              rows={2}
              className="mt-1 w-full rounded-md border px-2 py-1.5"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              disabled={saving}
            />
          </label>

          <div className="flex justify-end gap-2 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-sm font-medium"
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              disabled={saving || loadingCustomer}
              data-testid="customer-exclusion-submit"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
