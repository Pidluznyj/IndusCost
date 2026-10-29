/**
 * Formulário de revisão manual (decisão auditável). Não altera Nomus, guia nem apuração:
 * registra a decisão e enfileira o reprocessamento do que ela afeta.
 */
import React, { useState } from "react";
import { FISCAL360_COMPANIES, FISCAL360_TAX_LABELS, FISCAL360_TAX_TYPES } from "@/src/lib/finance/fiscal360/fiscal360Constants";
import { postFiscal360 } from "@/src/lib/finance/fiscal360/fiscal360Client";
import { FISCAL360_DECISION_LABELS, type Fiscal360DecisionType } from "@/src/lib/finance/fiscal360/fiscal360Types";
import { ButtonLike, Callout } from "./Fiscal360Shared";

export type DecisionTarget = {
  decisionType: Fiscal360DecisionType;
  apExternalId?: number | null;
  guideId?: string | null;
  itemKey?: string | null;
  suggestedTaxType?: string | null;
};

export function Fiscal360DecisionForm({ target, onDone, onCancel }: { target: DecisionTarget; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [taxType, setTaxType] = useState(target.suggestedTaxType ?? "");
  const [revenueCode, setRevenueCode] = useState("");
  const [competenceMonth, setCompetenceMonth] = useState("");
  const [apExternalId, setApExternalId] = useState(target.apExternalId != null ? String(target.apExternalId) : "");
  const [guideId, setGuideId] = useState(target.guideId ?? "");
  const [companyCnpj, setCompanyCnpj] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsAp = ["LINK_GUIDE_AP", "MARK_DISTINCT"].includes(target.decisionType) && target.apExternalId == null;
  const needsGuide = ["LINK_GUIDE_AP", "MARK_DISTINCT"].includes(target.decisionType) && !target.guideId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (target.decisionType === "AP_CONFIRM_TAX") Object.assign(payload, { taxType, revenueCode, competenceMonth });
      if (target.decisionType === "ASSIGN_GUIDE_COMPANY") payload.companyCnpj = companyCnpj;
      await postFiscal360("decisions", {
        decisionType: target.decisionType,
        apExternalId: apExternalId ? Number(apExternalId) : null,
        guideId: guideId || null,
        itemKey: target.itemKey ?? null,
        payload,
        reason,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar a decisão.");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-[12px]";
  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-[#DBEAFE] bg-[#F8FAFF] p-3" data-testid="fiscal360-decision-form">
      <p className="text-[12px] font-bold text-[#111827]">{FISCAL360_DECISION_LABELS[target.decisionType]}</p>
      {needsAp ? (
        <label className="block text-[11px] font-semibold text-[#374151]">
          Título AP (id Nomus)
          <input className={field} inputMode="numeric" value={apExternalId} onChange={(e) => setApExternalId(e.target.value.replace(/\D/g, ""))} required />
        </label>
      ) : null}
      {needsGuide ? (
        <label className="block text-[11px] font-semibold text-[#374151]">
          Guia (identificador)
          <input className={field} value={guideId} onChange={(e) => setGuideId(e.target.value.trim())} required />
        </label>
      ) : null}
      {target.decisionType === "AP_CONFIRM_TAX" ? (
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
          <label className="block text-[11px] font-semibold text-[#374151]">
            Tributo
            <select className={field} value={taxType} onChange={(e) => setTaxType(e.target.value)} required>
              <option value="">Selecione</option>
              {FISCAL360_TAX_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FISCAL360_TAX_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-[#374151]">
            Código de receita
            <input className={field} inputMode="numeric" value={revenueCode} onChange={(e) => setRevenueCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </label>
          <label className="block text-[11px] font-semibold text-[#374151]">
            Competência
            <input className={field} type="month" value={competenceMonth} onChange={(e) => setCompetenceMonth(e.target.value)} />
          </label>
        </div>
      ) : null}
      {target.decisionType === "ASSIGN_GUIDE_COMPANY" ? (
        <label className="block text-[11px] font-semibold text-[#374151]">
          Empresa responsável
          <select className={field} value={companyCnpj} onChange={(e) => setCompanyCnpj(e.target.value)} required>
            <option value="">Selecione</option>
            {FISCAL360_COMPANIES.map((c) => (
              <option key={c.cnpj} value={c.cnpj}>
                {c.shortName} — {c.displayCnpj}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block text-[11px] font-semibold text-[#374151]">
        Motivo e evidência (obrigatório)
        <textarea className={field} rows={3} minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="Ex.: DARF 2172 conferido no extrato de 20/10, mesmo valor do título." />
      </label>
      <Callout>A decisão fica registrada com usuário, data e motivo, pode ser revogada e não altera lançamentos do Nomus. O efeito aparece após o próximo processamento.</Callout>
      {error ? <p className="text-[11px] text-[#B91C1C]">{error}</p> : null}
      <div className="flex gap-2">
        <ButtonLike type="submit" variant="primary" disabled={saving || reason.trim().length < 10} testId="fiscal360-decision-submit">
          {saving ? "Registrando…" : "Registrar decisão"}
        </ButtonLike>
        <ButtonLike onClick={onCancel}>Cancelar</ButtonLike>
      </div>
    </form>
  );
}
