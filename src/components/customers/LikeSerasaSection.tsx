import React, { useCallback, useEffect, useState } from "react";
import { formatCreditDateTime } from "@/src/lib/commercial/commercialCreditIntelligenceView";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { generateIdempotencyKey, SecureRandomUnavailableError } from "@/src/lib/quodDossier/idempotencyKey";
import { BOA_VISTA_DEFINE_LIMITE_ATTRIBUTION, BOA_VISTA_DEFINE_LIMITE_PRODUCT, LIKE_SERASA_DISPLAY_NAME } from "@/src/lib/boaVistaDefineLimite/config";
import type { BoaVistaMonthlyPoint, BoaVistaOccurrenceGroup, BoaVistaSections } from "@/src/lib/boaVistaDefineLimite/parse";
import { likeSerasaMessage } from "@/src/lib/boaVistaDefineLimite/messages";
import { LIKE_SERASA_STATE_LABEL, type LikeSerasaHistoryLine, type LikeSerasaPostResponse, type LikeSerasaReportView, type LikeSerasaStatusPayload } from "@/src/lib/boaVistaDefineLimite/view";
import { cn } from "@/src/lib/utils";

function cents(value: number | null | undefined): string {
  if (value == null) return "Informação indisponível";
  return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function text(value: string | null | undefined, fallback = "Informação indisponível"): string {
  return value && value.trim() ? value : fallback;
}

function when(value: string | null | undefined): string {
  return value ? formatCreditDateTime(value) : "—";
}

// ---------------------------------------------------------------------------------------------------
// Estado e chamadas (um único ponto de entrada para o painel do cliente)
// ---------------------------------------------------------------------------------------------------

export type LikeSerasaController = {
  status: LikeSerasaStatusPayload | null;
  message: string | null;
  submitting: boolean;
  confirming: { forceRefresh: boolean; demo: boolean } | null;
  showReport: boolean;
  setShowReport: (value: boolean) => void;
  openConfirm: (options: { forceRefresh: boolean; demo: boolean }) => void;
  cancel: () => void;
  confirm: () => Promise<void>;
  reload: () => Promise<void>;
};

export function useLikeSerasa({ customerId, isSuperAdmin }: { customerId: string | null; isSuperAdmin: boolean }): LikeSerasaController {
  const [status, setStatus] = useState<LikeSerasaStatusPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState<{ forceRefresh: boolean; demo: boolean } | null>(null);
  const [showReport, setShowReport] = useState(false);

  const reload = useCallback(async () => {
    if (!customerId) return;
    const payload = await fetchJsonOk<LikeSerasaStatusPayload>(`/api/customers/${customerId}/like-serasa`);
    setStatus(payload);
  }, [customerId]);

  useEffect(() => {
    void reload().catch(() => setStatus(null));
  }, [reload]);

  const confirm = useCallback(async () => {
    if (!customerId || submitting || !isSuperAdmin || !confirming) return;
    setMessage(null);
    let idempotencyKey: string;
    try {
      idempotencyKey = generateIdempotencyKey();
    } catch (error) {
      setMessage(error instanceof SecureRandomUnavailableError ? error.message : "Não foi possível gerar a chave de idempotência. A consulta paga foi bloqueada.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetchJsonOk<LikeSerasaPostResponse>(`/api/customers/${customerId}/like-serasa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, idempotencyKey, forceRefresh: confirming.forceRefresh, demo: confirming.demo }),
      });
      setConfirming(null);
      setShowReport(true);
      if (response.code === "CACHE_VALID") setMessage(response.message);
      await reload();
    } catch (error) {
      if (error instanceof HttpError) {
        const raw = error.message.trim();
        setMessage(raw && !/^Erro HTTP \d+/.test(raw) ? raw : likeSerasaMessage(error.code ?? "HTTP_ERROR"));
      } else {
        setMessage(error instanceof Error ? error.message : "A consulta LIKE SERASA não foi concluída.");
      }
      await reload().catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  }, [confirming, customerId, isSuperAdmin, reload, submitting]);

  return {
    status,
    message,
    submitting,
    confirming,
    showReport,
    setShowReport,
    openConfirm: (options) => {
      if (!isSuperAdmin) return;
      setMessage(null);
      setConfirming(options);
    },
    cancel: () => {
      if (!submitting) setConfirming(null);
    },
    confirm,
    reload,
  };
}

// ---------------------------------------------------------------------------------------------------
// Botão (fica na mesma linha de ações do pacote QUOD + IEPTB)
// ---------------------------------------------------------------------------------------------------

export function LikeSerasaActionButton({
  status,
  canConsult,
  onRequest,
}: {
  status: LikeSerasaStatusPayload | null;
  canConsult: boolean;
  onRequest: (options: { forceRefresh: boolean; demo: boolean }) => void;
}) {
  if (!canConsult || !status) return null;
  const documentOk = status.document.kind === "CNPJ" && status.document.valid;
  const cacheValid = status.state === "VALID" && status.consultation?.mode === "LIVE";
  const live = status.live.allowed;
  const demo = !live && status.demo.allowed;
  const disabled = !documentOk || (!live && !demo);
  const label = demo ? `${LIKE_SERASA_DISPLAY_NAME} — simulação` : cacheValid ? `${LIKE_SERASA_DISPLAY_NAME} — atualizar (${status.priceLabel})` : `${LIKE_SERASA_DISPLAY_NAME} — ${status.priceLabel}`;
  const hint = !documentOk
    ? status.document.kind === "CPF"
      ? "Produto exclusivamente para pessoa jurídica (CNPJ): cliente pessoa física não pode ser consultado."
      : "CNPJ ausente ou inválido: consulta bloqueada."
    : !live && !demo
      ? status.live.message
      : demo
        ? "Ambiente sem consulta real: resultado SIMULADO, sem cobrança."
        : BOA_VISTA_DEFINE_LIMITE_ATTRIBUTION;
  return (
    <>
      <button
        type="button"
        className={cn("rounded px-3 py-2 text-xs disabled:opacity-40", demo ? "border border-amber-400 bg-amber-50 text-amber-950" : "bg-indigo-700 text-white")}
        disabled={disabled}
        title={hint}
        onClick={() => onRequest({ forceRefresh: cacheValid, demo })}
        data-testid="like-serasa-request-paid"
      >
        {label}
      </button>
      {disabled || demo ? (
        <p className="w-full text-xs text-slate-500" data-testid="like-serasa-request-hint">
          {hint}
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------
// Confirmação antes da cobrança
// ---------------------------------------------------------------------------------------------------

export function LikeSerasaPaidConsultationDialog({
  companyName,
  cnpj,
  requestedBy,
  requestedAt,
  priceLabel,
  forceRefresh,
  demo,
  submitting = false,
  onCancel,
  onConfirm,
}: {
  companyName: string;
  cnpj: string;
  requestedBy: string;
  requestedAt: string;
  priceLabel: string;
  forceRefresh: boolean;
  demo: boolean;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center" data-testid="like-serasa-paid-dialog">
      <div role="dialog" aria-modal="true" aria-labelledby="like-serasa-paid-title" className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
        <h3 id="like-serasa-paid-title" className="text-base font-semibold">
          Consulta {LIKE_SERASA_DISPLAY_NAME}
          {demo ? <span className="ml-2 rounded bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-950">simulação</span> : null}
        </h3>
        <dl className="mt-3 space-y-1 text-sm text-slate-700">
          <div><dt className="inline text-slate-500">Fonte: </dt><dd className="inline">Boa Vista via Direct Data.</dd></div>
          <div><dt className="inline text-slate-500">Produto: </dt><dd className="inline">{BOA_VISTA_DEFINE_LIMITE_PRODUCT}</dd></div>
          <div><dt className="inline text-slate-500">Cliente: </dt><dd className="inline">{companyName}</dd></div>
          <div><dt className="inline text-slate-500">CNPJ: </dt><dd className="inline">{cnpj}</dd></div>
          <div><dt className="inline text-slate-500">Valor: </dt><dd className="inline font-semibold" data-testid="like-serasa-paid-price">{demo ? "R$ 0,00 (simulação, sem cobrança)" : priceLabel}</dd></div>
          <div><dt className="inline text-slate-500">Usuário: </dt><dd className="inline">{requestedBy}</dd></div>
          <div><dt className="inline text-slate-500">Data e hora: </dt><dd className="inline">{requestedAt}</dd></div>
        </dl>
        {demo ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Este ambiente não executa a consulta real. O resultado será SIMULADO, com dados fictícios, sem contato com a Direct Data e sem cobrança. Registros simulados ficam identificados no histórico.
          </p>
        ) : (
          <p className="mt-3 text-sm text-amber-900">Aviso: uma nova consulta poderá gerar cobrança pelo fornecedor. O valor acima é o autorizado; a cobrança efetiva é da Direct Data.</p>
        )}
        {forceRefresh && !demo ? <p className="mt-2 text-sm text-red-800">Há uma consulta válida em cache. Confirmar gera uma nova consulta paga.</p> : null}
        <p className="mt-2 text-xs text-slate-500">Abrir esta janela não consulta o provedor.</p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} data-testid="like-serasa-paid-consent" />
          <span>{demo ? "Estou ciente de que o resultado é uma simulação." : `Estou ciente do valor de ${priceLabel} e autorizo a consulta paga.`}</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-40" disabled={submitting} onClick={onCancel}>Cancelar</button>
          <button type="button" className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!accepted || submitting} onClick={onConfirm} data-testid="like-serasa-paid-confirm">
            {submitting ? "Consultando…" : demo ? "Confirmar simulação" : `Confirmar consulta de ${priceLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Cartão de fonte (ao lado dos cartões QUOD e IEPTB)
// ---------------------------------------------------------------------------------------------------

export function LikeSerasaSourceCard({ status, onView }: { status: LikeSerasaStatusPayload | null; onView: () => void }) {
  const report = status?.consultation ?? null;
  const state = status?.state ?? "NOT_CONSULTED";
  const demo = report?.mode === "DEMO";
  return (
    <article className={cn("rounded-xl border border-l-4 p-4 text-sm shadow-sm", demo ? "border-amber-200 border-l-amber-500 bg-amber-50/60" : "border-slate-200 border-l-indigo-600 bg-white")} data-testid="like-serasa-source-card">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-800">{LIKE_SERASA_DISPLAY_NAME}</h4>
        <span className="flex items-center gap-1">
          {demo ? <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-950">simulado</span> : null}
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-800">{LIKE_SERASA_STATE_LABEL[state] ?? state}</span>
        </span>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Limite de crédito sugerido pela Boa Vista</p>
      <p className="text-2xl font-extrabold tabular-nums text-slate-900" data-testid="like-serasa-card-limit">
        {report?.sections?.limit.available ? cents(report.suggestedLimitCents) : "Informação indisponível"}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div><dt className="text-slate-400">Score Boa Vista</dt><dd className="font-semibold">{report ? `${text(report.scoreRaw, "—")}${report.scoreClass ? ` · Classe ${report.scoreClass}` : ""}` : "—"}</dd></div>
        <div><dt className="text-slate-400">Risco</dt><dd className="font-semibold">{text(report?.riskText, "—")}</dd></div>
        <div><dt className="text-slate-400">Consulta</dt><dd>{when(report?.consultedAt)}</dd></div>
        <div><dt className="text-slate-400">Validade</dt><dd>{when(report?.validUntil)}</dd></div>
      </dl>
      <p className="mt-2 text-[11px] text-slate-500">{BOA_VISTA_DEFINE_LIMITE_ATTRIBUTION}</p>
      {report ? (
        <button type="button" className="mt-3 rounded border bg-white px-2 py-1 text-xs" onClick={onView} data-testid="like-serasa-view-report">
          Ver relatório {LIKE_SERASA_DISPLAY_NAME}
        </button>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------------------------------
// Relatório completo (seções A–F)
// ---------------------------------------------------------------------------------------------------

function Tile({ label, value, tone = "neutral", testId }: { label: string; value: React.ReactNode; tone?: "neutral" | "alert" | "info"; testId?: string }) {
  return (
    <div className={cn("rounded-lg border p-3", tone === "alert" ? "border-amber-200 bg-amber-50 text-amber-950" : tone === "info" ? "border-indigo-200 bg-indigo-50 text-indigo-950" : "border-slate-200 bg-white text-slate-900")} data-testid={testId}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-lg font-extrabold leading-tight">{value}</p>
    </div>
  );
}

function Series({ title, indicator }: { title: string; indicator: { score: string | null; series: BoaVistaMonthlyPoint[] } | null }) {
  if (!indicator) return <p className="text-xs text-slate-500">{title}: informação indisponível.</p>;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-700">
        {title} <span className="font-normal text-slate-500">· pontuação do provedor: {text(indicator.score, "—")} (unidade não documentada)</span>
      </p>
      {indicator.series.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {indicator.series.map((point, index) => (
            <span key={`${point.period}-${index}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-700">
              {text(point.period, "?")}: {text(point.value, "—")}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Sem série mensal neste retorno.</p>
      )}
    </div>
  );
}

function OccurrenceTable({ title, group, columns }: { title: string; group: BoaVistaOccurrenceGroup; columns: Array<[string, string]> }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-600">{title}</p>
        <p className="text-xs text-slate-700">
          {!group.present ? "Informação indisponível neste retorno" : `${text(group.count, "—")} ocorrência(s) · total ${group.totalCents != null ? cents(group.totalCents) : text(group.totalLabel, "não informado")}`}
          {group.present && (group.firstDate || group.lastDate) ? ` · ${text(group.firstDate, "?")} → ${text(group.lastDate, "?")}` : ""}
        </p>
      </div>
      {group.items.length > 0 ? (
        <div className="max-h-72 overflow-auto border-t border-slate-100">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>{columns.map(([key, label]) => <th key={key} className="px-3 py-2">{label}</th>)}</tr>
            </thead>
            <tbody>
              {group.items.map((item, index) => (
                <tr key={index} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/70">
                  {columns.map(([key]) => <td key={key} className="px-3 py-1.5 whitespace-nowrap">{text(item[key], "—")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : group.present && group.countNumber === 0 ? (
        <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Nenhuma ocorrência informada pelo provedor nesta categoria.</p>
      ) : (
        <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Sem detalhamento individual neste retorno.</p>
      )}
    </div>
  );
}

export function LikeSerasaReport({ report, internalCreditLabel, customerId }: { report: LikeSerasaReportView; internalCreditLabel?: string | null; customerId?: string | null }) {
  const sections: BoaVistaSections | null = report.sections;
  const demo = report.mode === "DEMO";
  const restrictionTone = report.confirmedRestriction ? "alert" : "neutral";
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-sm" data-testid="like-serasa-report">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Relatório {LIKE_SERASA_DISPLAY_NAME}</h3>
          <p className="text-xs text-slate-500">{BOA_VISTA_DEFINE_LIMITE_ATTRIBUTION} Produto: {BOA_VISTA_DEFINE_LIMITE_PRODUCT}.</p>
        </div>
        {demo ? (
          <span className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-bold uppercase text-amber-950" data-testid="like-serasa-demo-badge">
            Resultado simulado — sem consulta real e sem cobrança
          </span>
        ) : null}
      </header>
      {report.status === "PARTIAL" || report.insufficient ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">Retorno parcial do provedor: parte das seções está indisponível. Campos ausentes não significam situação regular.</p>
      ) : null}

      <div data-testid="like-serasa-section-limit">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">A · Limite sugerido</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Tile label="Limite de crédito sugerido pela Boa Vista" tone="info" testId="like-serasa-limit" value={sections?.limit.available ? cents(report.suggestedLimitCents) : "Informação indisponível"} />
          <Tile label="Limite aprovado internamente (IndusCost)" value="Não cadastrado" />
          <Tile label="Situação de crédito interna" value={text(internalCreditLabel, "Não informada")} />
        </div>
        <p className="mt-2 text-xs text-slate-500">{sections?.limit.note ?? ""} {sections?.limit.description ? `· ${sections.limit.description}` : ""} {sections?.limit.text ? `· ${sections.limit.text}` : ""}</p>
      </div>

      <div data-testid="like-serasa-section-score">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">B · Score e risco</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Tile label="Score Boa Vista" value={text(report.scoreRaw, "Informação indisponível")} testId="like-serasa-score" />
          <Tile label="Classificação" value={sections?.score.classABC ? `${sections.score.classABC}${sections.score.classNumber ? ` (${sections.score.classNumber})` : ""}` : "Informação indisponível"} />
          <Tile label="Probabilidade de inadimplência" value={sections?.score.defaultProbability ? `${sections.score.defaultProbability}${/%/.test(sections.score.defaultProbability) ? "" : " (como informado)"}` : "Informação indisponível"} />
          <Tile label="Risco" tone={report.confirmedRestriction ? "alert" : "neutral"} value={text(report.riskText)} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {sections?.score.scaleNote} {sections?.score.description ? `· ${sections.score.description}` : ""} {sections?.score.model ? `· Modelo: ${sections.score.model}` : ""} {sections?.score.text ? `· ${sections.score.text}` : ""}
        </p>
        {sections?.decision.description || sections?.decision.result ? (
          <p className="mt-1 text-xs text-slate-700">Interpretação do fornecedor: {text(sections.decision.description, "—")} · {text(sections.decision.result, "—")}</p>
        ) : null}
        {sections?.alerts.length ? (
          <ul className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
            {sections.alerts.map((alert, index) => <li key={index}>{text(alert.title, "Alerta")}{alert.note ? ` — ${alert.note}` : ""}</li>)}
          </ul>
        ) : null}
      </div>

      <div data-testid="like-serasa-section-behavior">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">C · Comportamento financeiro</h4>
        {sections?.financialBehavior.present ? (
          <div className="mt-2 space-y-2">
            <Series title="Pagamento pontual" indicator={sections.financialBehavior.punctualPayments} />
            <Series title="Compromissos" indicator={sections.financialBehavior.commitments} />
            <Series title="Crédito obtido" indicator={sections.financialBehavior.creditObtained} />
            {sections.financialBehavior.latePayments.length > 0 ? (
              sections.financialBehavior.latePayments.map((late, index) => (
                <div key={index}>
                  <Series title={`Atrasos · ${text(late.description, "faixa não informada")}`} indicator={{ score: late.score, series: late.series }} />
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500">Atrasos: informação indisponível.</p>
            )}
            <p className="text-xs text-slate-500">
              Relacionamento com fornecedores: {sections.financialBehavior.supplierRelationship ? `${text(sections.financialBehavior.supplierRelationship.score, "—")} · ${sections.financialBehavior.supplierRelationship.items.map((item) => `${text(item.period, "?")}: ${text(item.value, "—")}`).join("; ") || "sem detalhe"}` : "informação indisponível"}
            </p>
            <p className="text-xs text-slate-500">Capacidade estimada / faturamento presumido: {sections.revenue.presumedCents != null ? cents(sections.revenue.presumedCents) : text(sections.revenue.range ?? sections.revenue.annualLabel)} {sections.revenue.referenceDate ? `(ref. ${sections.revenue.referenceDate})` : ""} — estimativa externa, não faturamento realizado.</p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">Informação indisponível neste retorno.</p>
        )}
      </div>

      <div data-testid="like-serasa-section-restrictions" className="space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">D · Restrições</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <Tile label="Restrições informadas" tone={restrictionTone} value={report.restrictionCount == null ? "Informação indisponível" : report.restrictionCount} testId="like-serasa-restriction-count" />
          <Tile label="Falência / recuperação judicial" tone={(sections?.restrictions.bankruptcyRecovery.countNumber ?? 0) > 0 ? "alert" : "neutral"} value={sections?.restrictions.bankruptcyRecovery.present ? `${text(sections.restrictions.bankruptcyRecovery.count, "—")} ocorrência(s)` : "Informação indisponível"} />
          <Tile label="Cheques sem fundos (BACEN / varejo)" value={sections ? `${sections.restrictions.bouncedChecksBacen.present ? text(sections.restrictions.bouncedChecksBacen.count, "—") : "indisponível"} / ${sections.restrictions.bouncedChecksRetail.present ? text(sections.restrictions.bouncedChecksRetail.count, "—") : "indisponível"}` : "Informação indisponível"} />
        </div>
        <p className="text-xs text-slate-500">Categorias independentes: pendências, protestos, ações e falência/RJ não são somados como dívida líquida. Ausência de um nó não confirma inexistência de restrição.</p>
        {sections ? (
          <>
            <OccurrenceTable title="Pendências financeiras (negativações)" group={sections.restrictions.financialPending} columns={[["dataVencimento", "Vencimento"], ["informante", "Informante"], ["credor", "Credor"], ["modalidade", "Modalidade"], ["valor", "Valor"], ["origem", "Origem"], ["subjudice", "Sub judice"]]} />
            <OccurrenceTable title="Protestos" group={sections.restrictions.protests} columns={[["data", "Data"], ["cartorio", "Cartório"], ["origem", "Origem"], ["credor", "Credor"], ["valor", "Valor"], ["tipoAnotacao", "Anotação"], ["subjudice", "Sub judice"]]} />
            <OccurrenceTable title="Ações cíveis" group={sections.restrictions.civilLawsuits} columns={[["dataDistribuicao", "Distribuição"], ["acao", "Ação"], ["autor", "Autor"], ["comarca", "Comarca"], ["vara", "Vara"], ["valor", "Valor"], ["processo", "Processo"]]} />
            <OccurrenceTable title="Falência e recuperação judicial" group={sections.restrictions.bankruptcyRecovery} columns={[["tipo", "Tipo"], ["data", "Data"], ["origem", "Origem"], ["vara", "Vara"]]} />
          </>
        ) : null}
      </div>

      <div data-testid="like-serasa-section-company">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">E · Cadastro empresarial</h4>
        {sections ? (
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-700 sm:grid-cols-2">
            <div><dt className="inline text-slate-400">Razão social: </dt><dd className="inline">{text(sections.identification.companyName)}</dd></div>
            <div><dt className="inline text-slate-400">Nome fantasia: </dt><dd className="inline">{text(sections.identification.tradeName)}</dd></div>
            <div><dt className="inline text-slate-400">CNPJ: </dt><dd className="inline">{report.cnpjFormatted}</dd></div>
            <div><dt className="inline text-slate-400">Situação cadastral: </dt><dd className="inline">{text(sections.identification.registrationStatus)}{sections.identification.registrationStatusDate ? ` (${sections.identification.registrationStatusDate})` : ""}</dd></div>
            <div><dt className="inline text-slate-400">Data de abertura: </dt><dd className="inline">{text(sections.identification.foundedAt)}</dd></div>
            <div><dt className="inline text-slate-400">Natureza jurídica: </dt><dd className="inline">{text(sections.identification.legalNature)}</dd></div>
            <div><dt className="inline text-slate-400">Porte: </dt><dd className="inline">{text(sections.identification.companySize)}</dd></div>
            <div><dt className="inline text-slate-400">Capital social: </dt><dd className="inline">{text(sections.identification.capitalLabel)}</dd></div>
            <div><dt className="inline text-slate-400">Filiais: </dt><dd className="inline">{text(sections.identification.branchesCount)}</dd></div>
            <div><dt className="inline text-slate-400">Atividade principal: </dt><dd className="inline">{text(sections.identification.mainActivity)}{sections.identification.mainCnae ? ` (${sections.identification.mainCnae})` : ""}</dd></div>
            <div><dt className="inline text-slate-400">Sócios: </dt><dd className="inline">{sections.governance.present ? `${text(sections.governance.partnersCount, "—")} · ${sections.governance.partners.map((partner) => `${text(partner.name, "—")} (${text(partner.share, "—")}%, doc. ${text(partner.document, "—")})`).join("; ") || "sem detalhe"}` : "Informação indisponível"}</dd></div>
            <div><dt className="inline text-slate-400">Administradores: </dt><dd className="inline">{sections.governance.present ? `${text(sections.governance.adminsCount, "—")} · ${sections.governance.admins.map((admin) => `${text(admin.name, "—")} (${text(admin.role, "—")})`).join("; ") || "sem detalhe"}` : "Informação indisponível"}</dd></div>
          </dl>
        ) : (
          <p className="mt-2 text-xs text-slate-500">Informação indisponível.</p>
        )}
      </div>

      <div data-testid="like-serasa-section-evidence">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">F · Evidências e histórico</h4>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-700 sm:grid-cols-2">
          <div><dt className="inline text-slate-400">Data e hora da consulta: </dt><dd className="inline">{when(report.consultedAt)}</dd></div>
          <div><dt className="inline text-slate-400">Usuário responsável: </dt><dd className="inline">{report.requestedByUserId}</dd></div>
          <div><dt className="inline text-slate-400">Produto: </dt><dd className="inline">{report.product}</dd></div>
          <div><dt className="inline text-slate-400">Provedor / fonte: </dt><dd className="inline">{report.provider} / {report.source}</dd></div>
          <div><dt className="inline text-slate-400">Identificador no fornecedor: </dt><dd className="inline">{text(report.providerQueryId, "—")}</dd></div>
          <div><dt className="inline text-slate-400">Situação da resposta: </dt><dd className="inline">{report.status}{report.providerResult ? ` · ${report.providerResult}` : ""}{report.failureCode ? ` · ${report.failureCode}` : ""}</dd></div>
          <div><dt className="inline text-slate-400">Situação da cobrança: </dt><dd className="inline" data-testid="like-serasa-billing">{report.billingLabel} · autorizado {cents(report.authorizedCostCents)}{report.chargedCostCents != null ? ` · estimado ${cents(report.chargedCostCents)}` : ""}</dd></div>
          <div><dt className="inline text-slate-400">Validade do resultado: </dt><dd className="inline">{when(report.validUntil)}</dd></div>
          <div><dt className="inline text-slate-400">Versão do parser: </dt><dd className="inline">{text(report.parserVersion, "—")}</dd></div>
          <div><dt className="inline text-slate-400">Consultas registradas pelo fornecedor: </dt><dd className="inline">{sections?.queryHistory.present ? `${text(sections.queryHistory.count, "—")} (${text(sections.queryHistory.from, "?")} → ${text(sections.queryHistory.to, "?")}) — histórico do provedor, não consultas pagas do IndusCost` : "Informação indisponível"}</dd></div>
          <div><dt className="inline text-slate-400">Comprovante: </dt><dd className="inline">
            {report.hasReceipt && customerId ? (
              <a className="underline" href={`/api/customers/${customerId}/like-serasa/${report.id}/receipt`} target="_blank" rel="noreferrer">obter comprovante do fornecedor (autenticado)</a>
            ) : (
              "não emitido nesta consulta"
            )}
          </dd></div>
          {sections?.unavailable.length ? (
            <div className="sm:col-span-2"><dt className="inline text-slate-400">Informações indisponíveis ou inconclusivas: </dt><dd className="inline">{sections.unavailable.join(", ")}</dd></div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------------------------------

export function LikeSerasaHistory({ history }: { history: LikeSerasaHistoryLine[] }) {
  if (history.length === 0) return <p className="text-xs text-slate-500">Nunca consultado.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="like-serasa-history">
      <div className="max-h-64 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Modo</th>
              <th className="px-3 py-2">Situação</th>
              <th className="px-3 py-2">Cobrança</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Limite sugerido</th>
              <th className="px-3 py-2">Usuário</th>
              <th className="px-3 py-2">Id fornecedor</th>
            </tr>
          </thead>
          <tbody>
            {history.map((line) => (
              <tr key={line.id} className={cn("border-t border-slate-100", line.mode === "DEMO" ? "bg-amber-50/60" : "odd:bg-white even:bg-slate-50/70")}>
                <td className="px-3 py-1.5 whitespace-nowrap">{when(line.consultedAt ?? line.createdAt)}</td>
                <td className="px-3 py-1.5">{line.mode === "DEMO" ? "Simulação" : "Real"}</td>
                <td className="px-3 py-1.5">{line.status}{line.failureCode ? ` · ${line.failureCode}` : ""}</td>
                <td className="px-3 py-1.5">{line.billingLabel}{line.mode === "LIVE" ? ` · ${cents(line.authorizedCostCents)}` : ""}</td>
                <td className="px-3 py-1.5 tabular-nums">{line.score ?? "—"}</td>
                <td className="px-3 py-1.5">{text(line.suggestedLimitLabel, "—")}</td>
                <td className="px-3 py-1.5">{line.requestedByUserId}</td>
                <td className="px-3 py-1.5 text-slate-500">{text(line.providerQueryId, "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Seção montada no painel do cliente (cartão + relatório + histórico + diálogo)
// ---------------------------------------------------------------------------------------------------

export function LikeSerasaSection({
  controller,
  customerId,
  companyName,
  cnpj,
  requestedBy,
  isSuperAdmin,
  internalCreditLabel,
}: {
  controller: LikeSerasaController;
  customerId: string | null;
  companyName: string;
  cnpj: string;
  requestedBy: string;
  isSuperAdmin: boolean;
  internalCreditLabel?: string | null;
}) {
  const { status, message, submitting, confirming, showReport, setShowReport, cancel, confirm } = controller;
  const [showHistory, setShowHistory] = useState(false);
  if (!customerId) return null;
  return (
    <section className="space-y-3" data-testid="like-serasa-section">
      <div className="grid gap-3 lg:grid-cols-2">
        <LikeSerasaSourceCard status={status} onView={() => setShowReport(true)} />
        <article className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Histórico {LIKE_SERASA_DISPLAY_NAME}</h4>
            <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setShowHistory((value) => !value)} data-testid="like-serasa-toggle-history">
              {showHistory ? "Ocultar" : "Ver histórico"}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {status ? `${status.history.length} tentativa(s) registrada(s) · situação atual: ${status.stateLabel}` : "Carregando…"}
          </p>
          {status && !status.live.allowed ? <p className="mt-1 text-xs text-slate-500" data-testid="like-serasa-live-note">{status.live.message}</p> : null}
          {showHistory && status ? <div className="mt-3"><LikeSerasaHistory history={status.history} /></div> : null}
        </article>
      </div>
      {showReport && status?.consultation ? <LikeSerasaReport report={status.consultation} internalCreditLabel={internalCreditLabel} customerId={customerId} /> : null}
      {message ? <p className="text-sm text-red-700" data-testid="like-serasa-message">{message}</p> : null}
      {confirming && status && isSuperAdmin ? (
        <LikeSerasaPaidConsultationDialog
          companyName={companyName}
          cnpj={status.document.formatted !== "—" ? status.document.formatted : cnpj}
          requestedBy={requestedBy}
          requestedAt={formatCreditDateTime(new Date().toISOString())}
          priceLabel={status.priceLabel}
          forceRefresh={confirming.forceRefresh}
          demo={confirming.demo}
          submitting={submitting}
          onCancel={cancel}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </section>
  );
}
