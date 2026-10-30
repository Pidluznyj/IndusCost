/**
 * Conciliação por lote: busca, marcação de linhas e decisão única para os itens marcados.
 * O servidor confere cada item de novo; o que não puder receber a decisão volta explicado.
 */
import React, { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { FISCAL360_TAX_LABELS, FISCAL360_TAX_TYPES } from "@/src/lib/finance/fiscal360/fiscal360Constants";
import { normalizeFiscal360Amount, postFiscal360 } from "@/src/lib/finance/fiscal360/fiscal360Client";
import {
  FISCAL360_BATCH_MAX,
  FISCAL360_DECISION_LABELS,
  type Fiscal360BatchDecisionType,
  type Fiscal360BatchResult,
} from "@/src/lib/finance/fiscal360/fiscal360Types";
import { ButtonLike, Callout } from "./Fiscal360Shared";

export type Fiscal360SearchValue = { q: string; minAmount: string; maxAmount: string };
export const EMPTY_FISCAL360_SEARCH: Fiscal360SearchValue = { q: "", minAmount: "", maxAmount: "" };

const SEARCH_DEBOUNCE_MS = 350;

export function Fiscal360SearchFields({
  placeholder,
  amountLabel,
  onChange,
  testId,
}: {
  placeholder: string;
  amountLabel: string;
  onChange: (value: Fiscal360SearchValue) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState<Fiscal360SearchValue>(EMPTY_FISCAL360_SEARCH);
  // Só avisa quando a pesquisa muda de fato: avisar à toa limparia a marcação.
  const applied = useRef<string>(JSON.stringify(EMPTY_FISCAL360_SEARCH));
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = {
        q: draft.q.trim(),
        minAmount: normalizeFiscal360Amount(draft.minAmount),
        maxAmount: normalizeFiscal360Amount(draft.maxAmount),
      };
      const serialized = JSON.stringify(next);
      if (serialized === applied.current) return;
      applied.current = serialized;
      onChange(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, onChange]);
  const hasValue = draft.q !== "" || draft.minAmount !== "" || draft.maxAmount !== "";
  const field = "rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px]";
  return (
    <div className="mb-2 flex flex-wrap items-end gap-2" data-testid={testId}>
      <label className="min-w-[220px] flex-1 text-[11px] font-semibold text-[#374151]">
        Pesquisar
        <span className="relative mt-0.5 block">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden />
          <input
            className={`${field} w-full pl-7`}
            value={draft.q}
            maxLength={80}
            placeholder={placeholder}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            data-testid={`${testId}-q`}
          />
        </span>
      </label>
      <label className="text-[11px] font-semibold text-[#374151]">
        {amountLabel} de
        <input className={`${field} mt-0.5 block w-[110px]`} inputMode="decimal" placeholder="0,00" value={draft.minAmount} onChange={(e) => setDraft({ ...draft, minAmount: e.target.value })} data-testid={`${testId}-min`} />
      </label>
      <label className="text-[11px] font-semibold text-[#374151]">
        até
        <input className={`${field} mt-0.5 block w-[110px]`} inputMode="decimal" placeholder="0,00" value={draft.maxAmount} onChange={(e) => setDraft({ ...draft, maxAmount: e.target.value })} data-testid={`${testId}-max`} />
      </label>
      {hasValue ? <ButtonLike onClick={() => setDraft(EMPTY_FISCAL360_SEARCH)}>Limpar pesquisa</ButtonLike> : null}
    </div>
  );
}

export function Fiscal360Checkbox({
  checked,
  indeterminate,
  label,
  onChange,
  testId,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  testId?: string;
}) {
  return (
    // A linha da tabela é clicável: marcar não pode abrir o detalhe.
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer accent-[#1e3a8a]"
        checked={checked}
        aria-label={label}
        data-testid={testId}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate);
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
    </span>
  );
}

export function Fiscal360SelectionBar({
  count,
  onSelectAll,
  selectingAll,
  onClear,
  children,
  testId,
}: {
  count: number;
  onSelectAll: () => void;
  selectingAll: boolean;
  onClear: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  const tooMany = count > FISCAL360_BATCH_MAX;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-[#DBEAFE] bg-[#F8FAFF] px-3 py-2 text-[12px]" data-testid={testId}>
      <b className="tabular-nums" data-testid={`${testId}-count`}>
        {count === 0 ? "Nenhum item marcado" : `${count.toLocaleString("pt-BR")} marcado(s)`}
      </b>
      <button type="button" className="text-[11px] font-semibold text-[#1D4ED8] hover:underline disabled:opacity-50" disabled={selectingAll} onClick={onSelectAll} data-testid={`${testId}-all`}>
        {selectingAll ? "Marcando…" : "Marcar todos do filtro"}
      </button>
      {count > 0 ? (
        <button type="button" className="text-[11px] font-semibold text-[#4B5563] hover:underline" onClick={onClear} data-testid={`${testId}-clear`}>
          Limpar marcação
        </button>
      ) : null}
      {tooMany ? <span className="text-[11px] text-[#B91C1C]">Máximo de {FISCAL360_BATCH_MAX} itens por lote.</span> : null}
      <fieldset className={`ml-auto flex flex-wrap gap-2 ${count === 0 || tooMany ? "opacity-50" : ""}`} disabled={count === 0 || tooMany}>
        {children}
      </fieldset>
    </div>
  );
}

export function Fiscal360BatchForm({
  decisionType,
  itemKeys,
  apExternalIds,
  onDone,
  onCancel,
}: {
  decisionType: Fiscal360BatchDecisionType;
  itemKeys?: string[];
  apExternalIds?: number[];
  onDone: (result: Fiscal360BatchResult) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [taxType, setTaxType] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = itemKeys?.length ?? apExternalIds?.length ?? 0;
  const field = "w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-[12px]";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onDone(
        await postFiscal360<Fiscal360BatchResult>("decisions/batch", {
          decisionType,
          itemKeys,
          apExternalIds,
          payload: decisionType === "AP_CONFIRM_TAX" && taxType ? { taxType } : {},
          reason,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar o lote.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-2 space-y-2 rounded-md border border-[#DBEAFE] bg-[#F8FAFF] p-3" data-testid="fiscal360-batch-form">
      <p className="text-[12px] font-bold text-[#111827]">
        {FISCAL360_DECISION_LABELS[decisionType]}: {count.toLocaleString("pt-BR")} item(ns)
      </p>
      {decisionType === "AP_CONFIRM_TAX" ? (
        <label className="block text-[11px] font-semibold text-[#374151]">
          Tributo
          <select className={field} value={taxType} onChange={(e) => setTaxType(e.target.value)} data-testid="fiscal360-batch-tax">
            <option value="">Usar a sugestão de cada título</option>
            {FISCAL360_TAX_TYPES.map((t) => (
              <option key={t} value={t}>
                {FISCAL360_TAX_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block text-[11px] font-semibold text-[#374151]">
        Motivo e evidência (obrigatório, vale para todos os itens do lote)
        <textarea className={field} rows={3} minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} required data-testid="fiscal360-batch-reason" />
      </label>
      <Callout>Cada item recebe a própria decisão, com usuário, data e motivo, e pode ser revogado depois. Nada é alterado no Nomus. O efeito aparece após o próximo processamento.</Callout>
      {error ? <p className="text-[11px] text-[#B91C1C]" role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <ButtonLike type="submit" variant="primary" disabled={saving || reason.trim().length < 10} testId="fiscal360-batch-submit">
          {saving ? "Registrando…" : `Registrar em ${count.toLocaleString("pt-BR")} item(ns)`}
        </ButtonLike>
        <ButtonLike onClick={onCancel} disabled={saving}>Cancelar</ButtonLike>
      </div>
    </form>
  );
}

export function Fiscal360BatchResultNotice({ result }: { result: Fiscal360BatchResult }) {
  const issues = [...result.skipped, ...result.failed];
  return (
    <Callout tone={issues.length ? "warn" : "info"}>
      <span data-testid="fiscal360-batch-result">
        {result.applied.toLocaleString("pt-BR")} de {result.requested.toLocaleString("pt-BR")} decisão(ões) registrada(s) com trilha de auditoria. O efeito aparece após o próximo processamento.
      </span>
      {issues.length ? (
        <details className="mt-1">
          <summary className="cursor-pointer font-semibold">{issues.length.toLocaleString("pt-BR")} item(ns) não receberam a decisão</summary>
          <ul className="mt-1 list-disc pl-4">
            {issues.map((issue) => (
              <li key={issue.target}>
                {issue.label}: {issue.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Callout>
  );
}
