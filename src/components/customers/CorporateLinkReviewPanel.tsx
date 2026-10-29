import React, { useState } from "react";
import { CheckCircle2, History, Link2, Lock, ShieldQuestion } from "lucide-react";
import type { CommercialCreditIntelligenceView } from "@/src/lib/commercial/commercialCreditIntelligenceView";
import type { CorporateRelationView } from "@/src/lib/commercial/corporateRelation.server";
import { cn } from "@/src/lib/utils";

export const CORPORATE_LINK_MIN_JUSTIFICATION = 20;
const NO_PERMISSION = "Esta validação requer autorização de Financeiro ou Diretoria.";

type Action = "confirm" | "reject" | "close";

const ACTION_COPY: Record<Action, { title: string; submit: string; placeholder: string; done: string }> = {
  confirm: {
    title: "Confirmar vínculo",
    submit: "Registrar confirmação",
    placeholder: "Ex.: contrato social conferido em 29/10 — mesmo sócio administrador nas duas empresas.",
    done: "Vínculo confirmado. A empresa passa a compor o grupo de risco.",
  },
  reject: {
    title: "Rejeitar vínculo",
    submit: "Registrar rejeição",
    placeholder: "Ex.: endereço é de condomínio empresarial; sócios e administradores diferentes.",
    done: "Vínculo rejeitado. O mesmo indício não volta a ficar pendente; indício novo reabre a revisão.",
  },
  close: {
    title: "Encerrar vínculo",
    submit: "Registrar encerramento",
    placeholder: "Ex.: sócio em comum saiu da sociedade em 09/2026 (alteração contratual conferida).",
    done: "Vínculo encerrado. A empresa sai do grupo de risco e o histórico fica registrado.",
  },
};

export type CorporateLinkReviewSubmit = (input: {
  relatedCustomerId: string;
  action: Action;
  justification: string;
}) => Promise<void>;

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="break-words text-xs text-slate-800">{value}</dd>
    </div>
  );
}

function ReviewForm({
  action,
  busy,
  onCancel,
  onSubmit,
}: {
  action: Action;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (justification: string) => void;
}) {
  const [text, setText] = useState("");
  const length = text.trim().length;
  const valid = length >= CORPORATE_LINK_MIN_JUSTIFICATION && length <= 2000;
  const copy = ACTION_COPY[action];
  return (
    <form
      className="cnpj-intelligence-no-print mt-2 rounded-md border border-slate-200 bg-slate-50 p-2"
      data-testid={`corporate-link-form-${action}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onSubmit(text.trim());
      }}
    >
      <label className="block text-xs font-semibold text-slate-700">
        {copy.title} · justificativa obrigatória
        <textarea
          className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm font-normal"
          rows={3}
          value={text}
          placeholder={copy.placeholder}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          required
          aria-describedby={`corporate-link-hint-${action}`}
        />
      </label>
      <p id={`corporate-link-hint-${action}`} className={cn("mt-1 text-[11px]", valid ? "text-slate-500" : "text-amber-800")}>
        {valid
          ? "Fica registrada com o seu nome, a data e as duas empresas."
          : `Descreva o que foi conferido (mínimo ${CORPORATE_LINK_MIN_JUSTIFICATION} caracteres · ${length}/${CORPORATE_LINK_MIN_JUSTIFICATION}).`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          disabled={!valid || busy}
        >
          {busy ? "Registrando…" : copy.submit}
        </button>
        <button type="button" className="rounded border px-3 py-1 text-xs" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function RelationCard({
  relation,
  actions,
  canReview,
  busy,
  openKey,
  setOpenKey,
  submit,
}: {
  key?: string;
  relation: CorporateRelationView;
  actions: Action[];
  canReview: boolean;
  busy: boolean;
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
  submit: (relatedCustomerId: string, action: Action, justification: string) => void;
}) {
  const id = relation.relatedCustomerId;
  const pending = relation.origin === "PENDING";
  const open = actions.find((action) => openKey === `${action}:${id}`) ?? null;
  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        pending ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"
      )}
      data-testid={pending ? "corporate-link-pending" : "corporate-link-confirmed"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold text-slate-900">{relation.companyName ?? relation.relatedCompany}</p>
          <p className="text-xs text-slate-600">CNPJ {relation.cnpjLabel ?? "—"}</p>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            pending ? "bg-amber-100 text-amber-900" : relation.origin === "MANUAL" ? "bg-sky-100 text-sky-900" : "bg-emerald-100 text-emerald-900"
          )}
        >
          {relation.kindLabel}
        </span>
      </div>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Tipo de evidência" value={relation.evidenceTypeLabel} />
        <Detail label="Data" value={relation.dateLabel} />
        <Detail label="Fonte" value={relation.sourceLabel} />
        <Detail label="Confiabilidade" value={relation.reliabilityLabel} />
      </dl>
      <p className="mt-2 text-xs text-slate-600">{relation.evidence}</p>
      {!pending ? <p className="mt-1 text-xs text-slate-600">Crédito da relacionada: {relation.creditStatusLabel}</p> : null}
      {relation.reviewNote ? <p className="mt-1 text-xs text-slate-700" data-testid="corporate-link-note">{relation.reviewNote}</p> : null}
      {id && actions.length > 0 && canReview && !open ? (
        <div className="cnpj-intelligence-no-print mt-2 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={cn(
                "rounded border px-3 py-1 text-xs font-semibold",
                action === "confirm" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : action === "reject" ? "border-slate-300 bg-white text-slate-800" : "border-red-200 bg-white text-red-800"
              )}
              disabled={busy}
              onClick={() => setOpenKey(`${action}:${id}`)}
              data-testid={`corporate-link-${action}`}
            >
              {action === "confirm" ? "Confirmar" : action === "reject" ? "Rejeitar" : "Encerrar vínculo"}
            </button>
          ))}
        </div>
      ) : null}
      {id && open ? (
        <ReviewForm
          action={open}
          busy={busy}
          onCancel={() => setOpenKey(null)}
          onSubmit={(justification) => submit(id, open, justification)}
        />
      ) : null}
    </li>
  );
}

/**
 * Revisão de vínculos empresariais na Ficha CNPJ.
 * Indício (endereço, telefone, e-mail, nome) nunca vira prova sozinho: só a pessoa autorizada confirma ou rejeita,
 * com justificativa. A permissão vem do servidor (mesma regra da gravação).
 */
export function CorporateLinkReviewPanel({
  credit,
  customerId,
  canReview,
  onSubmit,
}: {
  credit: CommercialCreditIntelligenceView;
  customerId: string | null;
  canReview: boolean;
  onSubmit: CorporateLinkReviewSubmit;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const reviewable = canReview && Boolean(customerId);
  const pending = credit.pendingCorporateRelations;
  const confirmed = credit.corporateRelations;
  const history = credit.corporateLinkHistory ?? [];

  const submit = async (relatedCustomerId: string, action: Action, justification: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await onSubmit({ relatedCustomerId, action, justification });
      setOpenKey(null);
      setDone(ACTION_COPY[action].done);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível registrar a decisão do vínculo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4 rounded-lg border p-3 text-sm" data-testid="cnpj-credit-relations">
      <div>
        <h4 className="font-semibold">Risco de crédito e empresas relacionadas</h4>
        <p className="mt-1 text-xs text-slate-600">
          Decisão individual: {credit.ownDecisionTitle}. Decisão consolidada: {credit.decisionTitle}. Dívida de empresa
          relacionada não é dívida deste CNPJ.
        </p>
        {credit.relatedRiskNote ? <p className="mt-1 text-xs text-amber-900">{credit.relatedRiskNote}</p> : null}
        {credit.relatedRestrictionLines.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs text-slate-700">
            {credit.relatedRestrictionLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {done ? (
        <p className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-900" role="status" data-testid="corporate-link-done">
          <CheckCircle2 className="h-3.5 w-3.5" /> {done}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800" role="alert" data-testid="corporate-link-error">
          {error}
        </p>
      ) : null}

      <section data-testid="corporate-link-pending-section">
        <h5 className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-amber-900">
          <ShieldQuestion className="h-3.5 w-3.5" /> Vínculos pendentes de validação ({pending.length})
        </h5>
        {pending.length === 0 && !credit.pendingRelationReadIncomplete ? (
          <p className="mt-1 text-xs text-slate-600">Nenhum indício pendente.</p>
        ) : null}
        {credit.pendingRelationReadIncomplete ? (
          <p className="mt-1 text-xs text-amber-900" data-testid="corporate-link-read-incomplete">
            A leitura dos vínculos não terminou por completo (Radar ou quadro societário indisponível). Por segurança o
            crédito fica em análise até a próxima atualização; não há indício a validar nesta tela.
          </p>
        ) : null}
        {pending.length > 0 ? (
          <>
            <p className="mt-1 text-xs text-slate-600">
              Indício não é prova: endereço, telefone ou e-mail em comum mantêm o crédito em análise até alguém
              autorizado confirmar ou rejeitar. A decisão vale para todas as evidências da empresa.
            </p>
            <ul className="mt-2 space-y-2">
              {pending.map((relation) => (
                <RelationCard
                  key={`pending-${relation.relatedCustomerId ?? relation.relatedCompany}`}
                  relation={relation}
                  actions={["confirm", "reject"]}
                  canReview={reviewable}
                  busy={busy}
                  openKey={openKey}
                  setOpenKey={setOpenKey}
                  submit={(id, action, text) => void submit(id, action, text)}
                />
              ))}
            </ul>
            {!reviewable ? (
              <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-slate-700" data-testid="corporate-link-no-permission">
                <Lock className="h-3.5 w-3.5" /> {credit.corporateLinkReviewBlockedReason ?? NO_PERMISSION}
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section data-testid="corporate-link-confirmed-section">
        <h5 className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-700">
          <Link2 className="h-3.5 w-3.5" /> Empresas relacionadas confirmadas ({confirmed.length})
        </h5>
        {confirmed.length === 0 ? (
          <p className="mt-1 text-xs text-slate-600">Nenhum vínculo societário confirmado entre CNPJs cadastrados.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {confirmed.map((relation) => (
              <RelationCard
                key={`confirmed-${relation.relatedCustomerId ?? relation.relatedCompany}-${relation.kindLabel}`}
                relation={relation}
                actions={relation.closable ? ["close"] : []}
                canReview={reviewable}
                busy={busy}
                openKey={openKey}
                setOpenKey={setOpenKey}
                submit={(id, action, text) => void submit(id, action, text)}
              />
            ))}
          </ul>
        )}
        {confirmed.some((relation) => relation.origin === "FORMAL") ? (
          <p className="mt-1 text-[11px] text-slate-500">
            Vínculo comprovado por documento (quadro societário ou mesma raiz de CNPJ) não se encerra aqui: muda quando a
            fonte pública mudar.
          </p>
        ) : null}
      </section>

      {history.length > 0 ? (
        <section data-testid="corporate-link-history-section">
          <h5 className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-500">
            <History className="h-3.5 w-3.5" /> Histórico de vínculos rejeitados e encerrados ({history.length})
          </h5>
          <ul className="mt-2 space-y-1">
            {history.map((row) => (
              <li key={`history-${row.relatedCustomerId}`} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700" data-testid="corporate-link-history">
                <span className="font-semibold">{row.companyName}</span> · CNPJ {row.cnpjLabel} ·{" "}
                <span className="font-semibold">{row.statusLabel}</span>. {row.reviewNote}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
