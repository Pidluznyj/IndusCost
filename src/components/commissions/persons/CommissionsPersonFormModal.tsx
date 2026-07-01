import React, { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import type {
  CommissionsPersonFormInput,
  CommissionsPersonItem,
} from "@/src/components/commissions/commissionsTypes";
import {
  COMMISSION_PERSON_SOURCE_OPTIONS,
  COMMISSION_PERSON_TYPE_OPTIONS,
} from "@/src/components/commissions/persons/commissionsPersonsLabels";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial?: CommissionsPersonItem | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: CommissionsPersonFormInput) => Promise<void>;
};

const EMPTY: CommissionsPersonFormInput = {
  name: "",
  type: "SELLER",
  source: "MANUAL",
  nomusPersonId: null,
  email: null,
  document: null,
  active: true,
  notes: null,
};

export function CommissionsPersonFormModal({
  open,
  mode,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        name: initial.name,
        type: initial.type,
        source: initial.source,
        nomusPersonId: initial.nomusPersonId,
        email: initial.email,
        document: initial.document,
        active: initial.active,
        notes: initial.notes,
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initial]);

  if (!open) return null;

  const fieldClass =
    "w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit(form);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commission-person-form-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
          <h2 id="commission-person-form-title" className="text-lg font-bold text-[#111827]">
            {mode === "create" ? "Nova pessoa comissionada" : "Editar pessoa comissionada"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#6B7280] hover:bg-[#F3F4F6]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Nome *</span>
            <input
              required
              className={fieldClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Tipo *</span>
              <select
                required
                className={fieldClass}
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                {COMMISSION_PERSON_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Origem</span>
              <select
                className={fieldClass}
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              >
                {COMMISSION_PERSON_SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">ID Pessoa Nomus</span>
            <input
              type="number"
              className={fieldClass}
              value={form.nomusPersonId ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim();
                setForm((f) => ({
                  ...f,
                  nomusPersonId: raw ? Number.parseInt(raw, 10) : null,
                }));
              }}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">E-mail</span>
              <input
                type="email"
                className={fieldClass}
                value={form.email ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value.trim() || null }))
                }
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Documento</span>
              <input
                className={fieldClass}
                value={form.document ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, document: e.target.value.trim() || null }))
                }
              />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-[#374151]">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Ativo
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Observações</span>
            <textarea
              rows={3}
              className={fieldClass}
              value={form.notes ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value.trim() || null }))
              }
            />
          </label>

          <div className="flex justify-end gap-2 border-t border-[#E5E7EB] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "create" ? "Criar" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
