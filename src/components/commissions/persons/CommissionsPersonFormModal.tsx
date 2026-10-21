import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
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
  personId: undefined,
};

type PersonSuggestion = { id: string; displayName: string; status: string; cpfMasked: string | null; emailMasked: string | null; evidence: "CPF_EXACT" | "EMAIL_EXACT" };
type PersonSuggestions = { byCpf: PersonSuggestion[]; byEmail: PersonSuggestion[]; cpfValid: boolean };

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
  const [suggestions, setSuggestions] = useState<PersonSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSuggestions(null);
    setSuggestError(null);
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
        personId: initial.personId ?? null,
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initial]);

  async function loadSuggestions() {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const qs = new URLSearchParams();
      if (form.document) qs.set("document", form.document);
      if (form.email) qs.set("email", form.email);
      const data = await fetchJsonOk<PersonSuggestions>(`/api/commissions/persons/person-suggestions?${qs.toString()}`);
      setSuggestions(data);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Não foi possível buscar sugestões.");
    } finally {
      setSuggesting(false);
    }
  }

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

          <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3" data-testid="commission-person-identity">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#6B7280]">Pessoa (identidade canônica)</span>
              <button
                type="button"
                onClick={() => void loadSuggestions()}
                disabled={suggesting || (!form.document && !form.email)}
                className="rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50"
              >
                {suggesting ? "Buscando…" : "Sugerir pelo CPF / e-mail"}
              </button>
            </div>
            {form.personId ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-[#111827]">
                <span>
                  Vinculada: <Link to={`/people/${form.personId}`} className="font-mono text-xs text-[#2563EB] underline">{form.personId.slice(0, 8)}…</Link>
                </span>
                <button type="button" onClick={() => setForm((f) => ({ ...f, personId: null }))} className="text-xs text-[#B91C1C] underline">
                  Remover vínculo
                </button>
              </div>
            ) : (
              <p className="text-xs text-[#6B7280]">
                {form.personId === null ? "Sem vínculo (explícito)." : "Sem vínculo. Ao salvar, o servidor vincula pelo CPF do documento se houver exatamente uma Pessoa com esse CPF."}
              </p>
            )}
            {suggestError ? <p className="text-xs text-[#B91C1C]">{suggestError}</p> : null}
            {suggestions ? (
              <ul className="space-y-1">
                {suggestions.byCpf.length === 0 && suggestions.byEmail.length === 0 ? (
                  <li className="text-xs text-[#6B7280]">Nenhuma Pessoa encontrada{!suggestions.cpfValid && form.document ? " (documento não é um CPF válido)" : ""}. Nunca se vincula por nome.</li>
                ) : null}
                {[...suggestions.byCpf, ...suggestions.byEmail].map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs">
                    <span>
                      <span className="font-medium text-[#111827]">{s.displayName}</span> · {s.cpfMasked ?? "CPF —"} · {s.emailMasked ?? "e-mail —"} ·{" "}
                      <span className={s.evidence === "CPF_EXACT" ? "text-[#047857]" : "text-[#B45309]"}>{s.evidence === "CPF_EXACT" ? "CPF igual (forte)" : "e-mail igual (só sugestão)"}</span>
                    </span>
                    <button type="button" onClick={() => setForm((f) => ({ ...f, personId: s.id }))} className="rounded border border-[#2563EB] px-2 py-0.5 font-medium text-[#2563EB] hover:bg-[#EFF6FF]">
                      Usar
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
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
