import React, { useState } from "react";
import { QUOD_DOSSIER_PRODUCT, QUOD_DOSSIER_PROVIDER, QUOD_PROTEST_COVERAGE_NOTE, QUOD_SCORE_SCALE_NOTE } from "@/src/lib/quodDossier/config";
import type { QuodSections } from "@/src/lib/quodDossier/parse";
import { cn } from "@/src/lib/utils";

export type QuodHeaderState = "NOT_CONSULTED" | "VALID" | "STALE" | "IN_PROGRESS" | "FAILED" | "PARTIAL" | "UNAVAILABLE" | "RESTRICTED";

const STATE_LABEL: Record<QuodHeaderState, string> = {
  NOT_CONSULTED: "Não consultado",
  VALID: "Consulta válida",
  STALE: "Consulta desatualizada",
  IN_PROGRESS: "Consulta em processamento",
  FAILED: "Falha",
  PARTIAL: "Resultado parcial",
  UNAVAILABLE: "Consulta não disponível",
  RESTRICTED: "Restrito",
};

export function QuodIntelligenceHeader({
  cadastralScore,
  cadastralVerdict,
  externalScore,
  externalState,
  creditLabel,
}: {
  cadastralScore: string;
  cadastralVerdict: string | null;
  externalScore: number | null;
  externalState: QuodHeaderState;
  creditLabel: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" data-testid="quod-intelligence-header">
      <article className="rounded-lg border bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Score cadastral</p>
        <p className="mt-1 text-sm font-semibold" data-testid="quod-header-cadastral">{cadastralScore}{cadastralVerdict ? ` · ${cadastralVerdict}` : ""}</p>
        <p className="mt-1 text-[11px] text-slate-500">Estabilidade cadastral. Não autoriza crédito.</p>
      </article>
      <article className="rounded-lg border bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Score externo QUOD</p>
        <p className="mt-1 text-sm font-semibold" data-testid="quod-header-external">
          {externalState === "RESTRICTED" ? "Restrito" : externalScore == null ? STATE_LABEL[externalState] : String(externalScore)}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">{externalScore == null ? "Não consultado não significa sem restrição." : QUOD_SCORE_SCALE_NOTE}</p>
      </article>
      <article className="rounded-lg border bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Situação de crédito</p>
        <p className="mt-1 text-sm font-semibold" data-testid="quod-header-credit">{creditLabel}</p>
        <p className="mt-1 text-[11px] text-slate-500">Decisão interna. Um score externo alto não remove bloqueio.</p>
      </article>
    </div>
  );
}

export function QuodPaidConsultationDialog({
  companyName,
  cnpj,
  priceLabel,
  requestedBy,
  requestedAt,
  previousLabel,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  companyName: string;
  cnpj: string;
  priceLabel: string;
  requestedBy: string;
  requestedAt: string;
  previousLabel: string | null;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center" data-testid="quod-paid-dialog">
      <div role="dialog" aria-modal="true" aria-labelledby="quod-paid-title" className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
        <h3 id="quod-paid-title" className="text-base font-semibold">Confirmar consulta paga — Dossiê QUOD Completo</h3>
        <dl className="mt-3 space-y-1 text-sm text-slate-700">
          <div><dt className="inline text-slate-500">Empresa: </dt><dd className="inline">{companyName}</dd></div>
          <div><dt className="inline text-slate-500">CNPJ: </dt><dd className="inline">{cnpj}</dd></div>
          <div><dt className="inline text-slate-500">Provedor: </dt><dd className="inline">{QUOD_DOSSIER_PROVIDER}</dd></div>
          <div><dt className="inline text-slate-500">Produto: </dt><dd className="inline">{QUOD_DOSSIER_PRODUCT}</dd></div>
          <div><dt className="inline text-slate-500">Valor previsto: </dt><dd className="inline">{priceLabel}</dd></div>
          <div><dt className="inline text-slate-500">Data e hora: </dt><dd className="inline">{requestedAt}</dd></div>
          <div><dt className="inline text-slate-500">Usuário solicitante: </dt><dd className="inline">{requestedBy}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-amber-900">Uma nova consulta pode gerar cobrança. Abrir esta janela não consulta o provedor.</p>
        {previousLabel ? <p className="mt-2 text-sm text-slate-600">{previousLabel}</p> : null}
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} data-testid="quod-paid-consent" />
          <span>Estou ciente do custo informado e autorizo a realização desta consulta.</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-40" disabled={submitting} onClick={onCancel}>Cancelar</button>
          <button type="button" className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!accepted || submitting} onClick={onConfirm} data-testid="quod-paid-confirm">
            {submitting ? "Consultando…" : "Confirmar consulta paga"}
          </button>
        </div>
      </div>
    </div>
  );
}

function money(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function QuodDossierReport({
  sections,
  partners,
}: {
  sections: QuodSections;
  partners: Array<{ name: string | null; role: string | null; share: number | null; document: string | null }>;
}) {
  return (
    <div className="space-y-3 text-sm" data-testid="quod-dossier-report">
      <section>
        <h4 className="font-semibold">Identificação cadastral</h4>
        <p>{sections.identification.companyName ?? "—"} · {sections.identification.cnpj ?? "—"}</p>
        <p>Situação cadastral: {sections.identification.registrationStatus ?? "—"}</p>
      </section>
      <section>
        <h4 className="font-semibold">Score e indicadores</h4>
        <p>Score QUOD: {sections.score.value == null ? "não informado pelo provedor" : sections.score.value}</p>
        <p className="text-xs text-slate-600">{sections.score.scaleNote}</p>
        {sections.score.reasons.length > 0 ? <p>Motivos: {sections.score.reasons.join("; ")}</p> : null}
      </section>
      <section>
        <h4 className="font-semibold">Restrições financeiras</h4>
        <p>{sections.restrictions.present ? `Total informado: ${sections.restrictions.total ?? "não quantificado"}` : "A seção de pendências não veio no retorno. Isso não significa ausência de restrição."}</p>
        <ul className="mt-1 space-y-1">
          {sections.restrictions.items.map((item, index) => (
            <li key={`${item.kind}-${index}`}>{item.kind}: {money(item.amount)} · {item.situation ?? "situação não informada"} · {item.source ?? "fonte não informada"}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4 className="font-semibold">Protestos</h4>
        <p className="text-xs text-slate-600">{sections.protests.coverageNote || QUOD_PROTEST_COVERAGE_NOTE}</p>
      </section>
      <section>
        <h4 className="font-semibold">Processos e ocorrências</h4>
        <p>Ações: {sections.proceedings.lawsuits.length}. Recuperação ou falência: {sections.proceedings.bankruptcy.length}. Cheques sem fundo: {sections.proceedings.bouncedChecks.length}.</p>
      </section>
      <section>
        <h4 className="font-semibold">Comportamento de pagamento</h4>
        <p>{sections.paymentBehavior.present ? `Empréstimos informados: ${sections.paymentBehavior.loanCount ?? 0}.` : "O retorno não trouxe indicadores de comportamento de pagamento."}</p>
      </section>
      {partners.length > 0 ? (
        <section>
          <h4 className="font-semibold">Quadro societário informado</h4>
          <ul>{partners.map((partner, index) => <li key={`${partner.name}-${index}`}>{partner.name ?? "—"} · {partner.role ?? "—"} · {partner.document ?? "documento omitido"}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}

export function quodExternalState(isSuperAdmin: boolean, state: QuodHeaderState | null): QuodHeaderState {
  if (!isSuperAdmin) return "RESTRICTED";
  return state ?? "NOT_CONSULTED";
}

export function QuodSuperAdminPanel({
  state,
  consultedAt,
  validUntil,
  score,
  restrictionCount,
  priceLabel,
  canQuery,
  onView,
  onRequestPaid,
  report,
}: {
  state: QuodHeaderState;
  consultedAt: string | null;
  validUntil: string | null;
  score: number | null;
  restrictionCount: number | null;
  priceLabel: string;
  canQuery: boolean;
  onView: () => void;
  onRequestPaid: () => void;
  report: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border p-3" data-testid="quod-super-admin-section">
      <h3 className="text-sm font-semibold">Análise externa de crédito — Dossiê QUOD Completo</h3>
      <dl className={cn("mt-2 grid gap-1 text-sm sm:grid-cols-2")}>
        <div>Situação da consulta: {STATE_LABEL[state]}</div>
        <div>Última consulta: {consultedAt ?? "—"}</div>
        <div>Validade: {validUntil ?? "—"}</div>
        <div>Score QUOD: {score == null ? "—" : score}</div>
        <div>Restrições informadas: {restrictionCount == null ? "não informado" : restrictionCount}</div>
        <div>Próxima consulta: {priceLabel}</div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">{QUOD_PROTEST_COVERAGE_NOTE}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={onView} data-testid="quod-view-last">Ver último dossiê</button>
        <button type="button" className="rounded border px-3 py-1.5 text-xs" disabled={!canQuery} onClick={onRequestPaid} data-testid="quod-request-paid">
          {state === "VALID" || state === "STALE" ? "Atualizar análise" : "Consultar QUOD"}
        </button>
      </div>
      {report}
    </section>
  );
}
