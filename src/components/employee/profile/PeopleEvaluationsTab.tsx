import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Printer } from "lucide-react";
import {
  HR_EVALUATION_ACTION_STATUSES,
  HR_EVALUATION_ACTION_STATUS_LABELS,
  HR_EVALUATION_NA_LABEL,
  HR_EVALUATION_PROMPTS,
  HR_EVALUATION_SCORE_LEGEND,
  evaluationStatusLabel,
  isoDateInSaoPaulo,
  formatAverageLabel,
  formatScoreDelta,
  recommendationsFor,
  type EvaluationAlert,
  type HrEmployeeEvaluationDto,
  type HrEvaluationUpdateInput,
} from "@/src/lib/hrEvaluation";
import { cn } from "@/src/lib/utils";
import { profileFetchJson, profilePostJson } from "./profileClient";
import { PROFILE_INPUT_CLASS, PROFILE_LABEL_CLASS, ProfileState } from "./profileUi";

type ComparisonRow = {
  code: string;
  name: string;
  fortyFive: number | null;
  fortyFiveNotApplicable: boolean;
  final: number | null;
  finalNotApplicable: boolean;
  delta: number | null;
  direction: "up" | "down" | "flat" | "none";
};

export type PeopleEvaluationsPayload = {
  items: HrEmployeeEvaluationDto[];
  comparison: {
    rows: ComparisonRow[];
    fortyFiveAverage: number | null;
    finalAverage: number | null;
    averageDelta: number | null;
    averageDirection: "up" | "down" | "flat" | "none";
  } | null;
  alerts: EvaluationAlert[];
};

type Draft = {
  evaluationDate: string;
  evaluatorName: string;
  evaluatorRole: string;
  dueDate: string;
  recommendation: string;
  recommendationNotes: string;
  strengths: string;
  developmentPoints: string;
  actionGuidance: string;
  employeeAcknowledged: boolean;
  employeeAcknowledgedAt: string;
  employeeAcknowledgementNotes: string;
  answers: Array<{ id: string; score: string; notApplicable: boolean; comment: string }>;
};

function formatBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, month, day] = iso.split("T")[0].split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return formatBr(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATED: "Criação",
  UPDATED: "Alteração",
  TRANSCRIBED: "Transcrição",
  COMPLETED: "Conclusão",
  AMENDED: "Alteração após conclusão",
  PRINTED: "Impressão",
  CANCELLED: "Cancelamento",
  ACTION_PLAN: "Plano de acompanhamento",
  ATTACHMENT_ADDED: "Anexo",
};

function badgeClass(status: string, dueDate: string | null): string {
  const today = isoDateInSaoPaulo(new Date());
  if (status === "COMPLETED") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "CANCELLED") return "bg-muted text-muted-foreground border-border";
  if (dueDate && dueDate < today && status !== "COMPLETED" && status !== "CANCELLED") {
    return "bg-red-50 text-red-800 border-red-200";
  }
  if (status === "WAITING_RETURN" || status === "PRINTED") {
    return "bg-amber-50 text-amber-900 border-amber-200";
  }
  if (status === "TRANSCRIBING") return "bg-primary/10 text-primary border-primary/20";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function badgeLabel(status: string, dueDate: string | null): string {
  const today = isoDateInSaoPaulo(new Date());
  if (dueDate && dueDate < today && status !== "COMPLETED" && status !== "CANCELLED") return "Vencida";
  return evaluationStatusLabel(status);
}

function draftFrom(item: HrEmployeeEvaluationDto): Draft {
  return {
    evaluationDate: item.evaluationDate ?? "",
    evaluatorName: item.evaluatorName ?? "",
    evaluatorRole: item.evaluatorRole ?? "",
    dueDate: item.dueDate ?? "",
    recommendation: item.recommendation ?? "",
    recommendationNotes: item.recommendationNotes ?? "",
    strengths: item.strengths ?? "",
    developmentPoints: item.developmentPoints ?? "",
    actionGuidance: item.actionGuidance ?? "",
    employeeAcknowledged: item.employeeAcknowledged,
    employeeAcknowledgedAt: item.employeeAcknowledgedAt ?? "",
    employeeAcknowledgementNotes: item.employeeAcknowledgementNotes ?? "",
    answers: item.answers.map((answer) => ({
      id: answer.id,
      score: answer.score == null ? "" : String(answer.score),
      notApplicable: answer.notApplicable,
      comment: answer.comment ?? "",
    })),
  };
}

function payloadFrom(draft: Draft): HrEvaluationUpdateInput {
  return {
    evaluationDate: draft.evaluationDate || null,
    evaluatorName: draft.evaluatorName,
    evaluatorRole: draft.evaluatorRole,
    dueDate: draft.dueDate || null,
    recommendation: draft.recommendation || null,
    recommendationNotes: draft.recommendationNotes,
    strengths: draft.strengths,
    developmentPoints: draft.developmentPoints,
    actionGuidance: draft.actionGuidance,
    employeeAcknowledged: draft.employeeAcknowledged,
    employeeAcknowledgedAt: draft.employeeAcknowledgedAt || null,
    employeeAcknowledgementNotes: draft.employeeAcknowledgementNotes,
    answers: draft.answers.map((answer) => ({
      id: answer.id,
      score: answer.notApplicable || answer.score === "" ? null : Number(answer.score),
      notApplicable: answer.notApplicable,
      comment: answer.comment,
    })),
  };
}

function EvolutionMark({
  direction,
  delta,
}: {
  direction: "up" | "down" | "flat" | "none";
  delta: number | null;
}) {
  if (direction === "up") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
        {formatScoreDelta(delta)}
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span className="inline-flex items-center gap-1 text-red-700">
        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
        {formatScoreDelta(delta)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Minus className="h-3.5 w-3.5" aria-hidden />—
    </span>
  );
}

function scoreText(score: number | null, notApplicable: boolean): string {
  if (notApplicable) return "N/A";
  if (score == null) return "—";
  return String(score);
}

export function PeopleEvaluationsTab({
  data,
  loading,
  error,
  employeeId,
  canManage,
  canComplete,
  canPrint,
  canAttach,
  onSaved,
}: {
  data: PeopleEvaluationsPayload | null;
  loading: boolean;
  error: string | null;
  employeeId: string;
  canManage: boolean;
  canComplete: boolean;
  canPrint: boolean;
  canAttach: boolean;
  onSaved: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [planTitle, setPlanTitle] = useState("");
  const [planDescription, setPlanDescription] = useState("");
  const [planOwner, setPlanOwner] = useState("");
  const [planDue, setPlanDue] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const ensured = useRef(false);
  const detailRef = useRef<HTMLFormElement>(null);
  const documentsRef = useRef<HTMLElement>(null);

  const items = data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!canManage || ensured.current) return;
    ensured.current = true;
    void profilePostJson(`/api/employees/${employeeId}/evaluations/ensure`, {})
      .then(() => onSaved())
      .catch(() => undefined);
  }, [canManage, employeeId, onSaved]);

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft(draftFrom(selected));
    setFormError(null);
  }, [selected]);

  function openEvaluation(id: string, target: "detail" | "documents" = "detail") {
    setSelectedId(id);
    window.setTimeout(() => {
      const node = target === "documents" ? documentsRef.current : detailRef.current;
      node?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  const locked = selected?.status === "CANCELLED" || (selected?.status === "COMPLETED" && !canComplete);
  const recommendations = useMemo(
    () => (selected ? recommendationsFor(selected.evaluationType) : []),
    [selected]
  );

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFormError(null);
    try {
      await action();
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function createType(evaluationType: string) {
    await run(() =>
      profilePostJson(`/api/employees/${employeeId}/evaluations`, {
        evaluationType,
        confirmDuplicate,
      })
    );
  }

  if (loading && !data) return <ProfileState kind="loading" message="Carregando avaliações…" />;
  if (error && !data) return <ProfileState kind="error" message={error} />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-bold text-foreground">Avaliações</h2>
        <p className="mt-1 text-sm text-muted-foreground">Período de experiência</p>
      </div>

      {data?.alerts?.length ? (
        <ul className="flex flex-col gap-2">
          {data.alerts.map((alert) => (
            <li
              key={alert.evaluationId + alert.message}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                alert.tone === "danger" && "border-red-200 bg-red-50 text-red-900",
                alert.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-950",
                alert.tone === "info" && "border-border bg-muted/40 text-foreground"
              )}
            >
              {alert.message}
            </li>
          ))}
        </ul>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma avaliação registrada.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{item.shortLabel}</p>
                  <p className="text-xs text-muted-foreground">{item.referenceCode}</p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    badgeClass(item.status, item.dueDate)
                  )}
                >
                  {badgeLabel(item.status, item.dueDate)}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div>
                  <dt className="text-muted-foreground">Prevista</dt>
                  <dd>{formatBr(item.dueDate)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Avaliação</dt>
                  <dd>{formatBr(item.evaluationDate)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Média</dt>
                  <dd>{item.status === "COMPLETED" ? item.averageLabel : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Avaliador</dt>
                  <dd>{item.evaluatorName || "—"}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                  onClick={() => openEvaluation(item.id)}
                >
                  Abrir
                </button>
                {canManage && item.status !== "COMPLETED" && item.status !== "CANCELLED" ? (
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                    onClick={() => openEvaluation(item.id)}
                  >
                    Registrar resultado
                  </button>
                ) : null}
                {canManage &&
                (item.status === "TRANSCRIBING" ||
                  item.status === "RETURNED" ||
                  (item.status === "COMPLETED" && canComplete)) ? (
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                    onClick={() => openEvaluation(item.id)}
                  >
                    Editar
                  </button>
                ) : null}
                {canPrint ? (
                  <a
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                    href={`/employees/${employeeId}/evaluations/${item.id}/print`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Printer className="h-3.5 w-3.5" aria-hidden />
                    Imprimir formulário
                  </a>
                ) : null}
                {canAttach && item.status !== "CANCELLED" && (item.status !== "COMPLETED" || canComplete) ? (
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                    onClick={() => openEvaluation(item.id, "documents")}
                  >
                    Anexar documento
                  </button>
                ) : null}
                {canComplete && item.status !== "COMPLETED" && item.status !== "CANCELLED" ? (
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                    onClick={() => openEvaluation(item.id)}
                  >
                    Concluir
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            disabled={busy}
            onClick={() => void createType("EXPERIENCE_45_DAYS")}
          >
            Programar 45 dias
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={busy}
            onClick={() => void createType("EXPERIENCE_FINAL")}
          >
            Programar avaliação final
          </button>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={confirmDuplicate}
              onChange={(event) => setConfirmDuplicate(event.target.checked)}
            />
            Confirmar segunda avaliação no mesmo ciclo
          </label>
        </div>
      ) : null}

      {data?.comparison ? (
        <section className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Critério</th>
                <th className="px-3 py-2">45 dias</th>
                <th className="px-3 py-2">Final</th>
                <th className="px-3 py-2">Evolução</th>
              </tr>
            </thead>
            <tbody>
              {data.comparison.rows.map((row) => (
                <tr key={row.code} className="border-t border-border">
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">{scoreText(row.fortyFive, row.fortyFiveNotApplicable)}</td>
                  <td className="px-3 py-2">{scoreText(row.final, row.finalNotApplicable)}</td>
                  <td className="px-3 py-2">
                    <EvolutionMark direction={row.direction} delta={row.delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-sm">
            Média 45 dias: {formatAverageLabel(data.comparison.fortyFiveAverage)} · Média final:{" "}
            {formatAverageLabel(data.comparison.finalAverage)} · Evolução:{" "}
            <EvolutionMark
              direction={data.comparison.averageDirection}
              delta={data.comparison.averageDelta}
            />
          </p>
        </section>
      ) : null}

      {selected && draft ? (
        <form
          ref={detailRef}
          className="flex flex-col gap-4 rounded-xl border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              profileFetchJson(`/api/employees/${employeeId}/evaluations/${selected.id}`, {
                method: "PATCH",
                body: JSON.stringify(payloadFrom(draft)),
              })
            );
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold">{selected.typeLabel}</h3>
              <p className="text-xs text-muted-foreground">
                {selected.referenceCode} · {selected.employeeName}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                badgeClass(selected.status, selected.dueDate)
              )}
            >
              {badgeLabel(selected.status, selected.dueDate)}
            </span>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className={PROFILE_LABEL_CLASS}>Cargo</dt>
              <dd>{selected.roleName || "—"}</dd>
            </div>
            <div>
              <dt className={PROFILE_LABEL_CLASS}>Departamento</dt>
              <dd>{selected.department || "—"}</dd>
            </div>
            <div>
              <dt className={PROFILE_LABEL_CLASS}>Líder</dt>
              <dd>{selected.managerName || "—"}</dd>
            </div>
            <div>
              <dt className={PROFILE_LABEL_CLASS}>Admissão</dt>
              <dd>{formatBr(selected.admissionDate)}</dd>
            </div>
            <div>
              <dt className={PROFILE_LABEL_CLASS}>Período</dt>
              <dd>
                {formatBr(selected.periodStart)} a {formatBr(selected.periodEnd)}
              </dd>
            </div>
            <div>
              <dt className={PROFILE_LABEL_CLASS}>Média</dt>
              <dd>{selected.averageLabel}</dd>
            </div>
          </dl>
          {selected.scheduleNote ? (
            <p className="text-xs text-muted-foreground">{selected.scheduleNote}</p>
          ) : null}
          {selected.status === "COMPLETED" ? (
            <p className="text-xs text-muted-foreground">
              Transcrição: {selected.transcriptionUserName || "—"} · {formatBr(selected.transcriptionAt)}
              . Alterações posteriores ficam na auditoria.
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block space-y-1">
              <span className={PROFILE_LABEL_CLASS}>Data prevista</span>
              <input
                type="date"
                className={PROFILE_INPUT_CLASS}
                value={draft.dueDate}
                disabled={locked || !canManage}
                onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className={PROFILE_LABEL_CLASS}>Data da avaliação</span>
              <input
                type="date"
                className={PROFILE_INPUT_CLASS}
                value={draft.evaluationDate}
                disabled={locked || !canManage}
                onChange={(event) => setDraft({ ...draft, evaluationDate: event.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className={PROFILE_LABEL_CLASS}>Líder avaliador</span>
              <input
                className={PROFILE_INPUT_CLASS}
                value={draft.evaluatorName}
                disabled={locked || !canManage}
                onChange={(event) => setDraft({ ...draft, evaluatorName: event.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className={PROFILE_LABEL_CLASS}>Cargo do avaliador</span>
              <input
                className={PROFILE_INPUT_CLASS}
                value={draft.evaluatorRole}
                disabled={locked || !canManage}
                onChange={(event) => setDraft({ ...draft, evaluatorRole: event.target.value })}
              />
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Critério</th>
                  <th className="py-1">Nota</th>
                  <th className="py-1">N/A</th>
                  <th className="py-1">Comentário</th>
                </tr>
              </thead>
              <tbody>
                {draft.answers.map((answer, index) => {
                  const meta = selected.answers.find((item) => item.id === answer.id);
                  return (
                    <tr key={answer.id} className="border-t border-border">
                      <td className="py-2 pr-2">{meta?.name}</td>
                      <td className="py-2 pr-2">
                        <select
                          className={PROFILE_INPUT_CLASS}
                          disabled={locked || !canManage || answer.notApplicable}
                          value={answer.score}
                          onChange={(event) => {
                            const answers = [...draft.answers];
                            answers[index] = { ...answer, score: event.target.value };
                            setDraft({ ...draft, answers });
                          }}
                        >
                          <option value="">—</option>
                          {[1, 2, 3, 4, 5].map((score) => (
                            <option key={score} value={score}>
                              {score}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          disabled={locked || !canManage || meta?.allowNotApplicable === false}
                          checked={answer.notApplicable}
                          onChange={(event) => {
                            const answers = [...draft.answers];
                            answers[index] = {
                              ...answer,
                              notApplicable: event.target.checked,
                              score: event.target.checked ? "" : answer.score,
                            };
                            setDraft({ ...draft, answers });
                          }}
                        />
                      </td>
                      <td className="py-2">
                        <input
                          className={PROFILE_INPUT_CLASS}
                          disabled={locked || !canManage}
                          value={answer.comment}
                          onChange={(event) => {
                            const answers = [...draft.answers];
                            answers[index] = { ...answer, comment: event.target.value };
                            setDraft({ ...draft, answers });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              {HR_EVALUATION_SCORE_LEGEND.map((item) => `${item.score} — ${item.label}`).join(" · ")}
              {` · N/A — ${HR_EVALUATION_NA_LABEL}. N/A não entra na média.`}
            </p>
          </div>

          <label className="block space-y-1">
            <span className={PROFILE_LABEL_CLASS}>Pontos fortes</span>
            <span className="block text-xs text-muted-foreground">{HR_EVALUATION_PROMPTS.strengths}</span>
            <textarea
              className={PROFILE_INPUT_CLASS}
              rows={3}
              disabled={locked || !canManage}
              value={draft.strengths}
              onChange={(event) => setDraft({ ...draft, strengths: event.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className={PROFILE_LABEL_CLASS}>Pontos a desenvolver</span>
            <span className="block text-xs text-muted-foreground">{HR_EVALUATION_PROMPTS.development}</span>
            <textarea
              className={PROFILE_INPUT_CLASS}
              rows={3}
              disabled={locked || !canManage}
              value={draft.developmentPoints}
              onChange={(event) => setDraft({ ...draft, developmentPoints: event.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className={PROFILE_LABEL_CLASS}>Orientações / plano</span>
            <span className="block text-xs text-muted-foreground">{HR_EVALUATION_PROMPTS.guidance}</span>
            <textarea
              className={PROFILE_INPUT_CLASS}
              rows={3}
              disabled={locked || !canManage}
              value={draft.actionGuidance}
              onChange={(event) => setDraft({ ...draft, actionGuidance: event.target.value })}
            />
          </label>

          <label className="block space-y-1">
            <span className={PROFILE_LABEL_CLASS}>Recomendação</span>
            <select
              className={PROFILE_INPUT_CLASS}
              disabled={locked || !canManage}
              value={draft.recommendation}
              onChange={(event) => setDraft({ ...draft, recommendation: event.target.value })}
            >
              <option value="">Selecione</option>
              {recommendations.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className={PROFILE_LABEL_CLASS}>Justificativa</span>
            <textarea
              className={PROFILE_INPUT_CLASS}
              rows={2}
              disabled={locked || !canManage}
              value={draft.recommendationNotes}
              onChange={(event) => setDraft({ ...draft, recommendationNotes: event.target.value })}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={locked || !canManage}
                checked={draft.employeeAcknowledged}
                onChange={(event) =>
                  setDraft({ ...draft, employeeAcknowledged: event.target.checked })
                }
              />
              Ciência do colaborador obtida
            </label>
            <label className="block space-y-1">
              <span className={PROFILE_LABEL_CLASS}>Data da ciência</span>
              <input
                type="date"
                className={PROFILE_INPUT_CLASS}
                disabled={locked || !canManage}
                value={draft.employeeAcknowledgedAt}
                onChange={(event) =>
                  setDraft({ ...draft, employeeAcknowledgedAt: event.target.value })
                }
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">{HR_EVALUATION_PROMPTS.acknowledgement}</p>

          {selected.evaluationType === "EXPERIENCE_45_DAYS" ? (
            <section className="rounded-lg border border-border p-3">
              <h4 className="text-sm font-semibold">Plano de acompanhamento</h4>
              {selected.actionPlans.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Nenhuma ação registrada.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {selected.actionPlans.map((plan) => (
                    <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong>{plan.title}</strong>
                        {plan.description ? ` — ${plan.description}` : ""} · {plan.responsibleName || "Sem responsável"} ·{" "}
                        {formatBr(plan.dueDate)} · {plan.statusLabel}
                        {plan.completedAt ? ` · concluída em ${formatDateTime(plan.completedAt)}` : ""}
                        {plan.notes ? ` · ${plan.notes}` : ""}
                      </span>
                      {canManage && !locked ? (
                        <select
                          className={PROFILE_INPUT_CLASS}
                          value={plan.status}
                          onChange={(event) =>
                            void run(() =>
                              profileFetchJson(
                                `/api/employees/${employeeId}/evaluations/${selected.id}/action-plans/${plan.id}`,
                                {
                                  method: "PATCH",
                                  body: JSON.stringify({ status: event.target.value }),
                                }
                              )
                            )
                          }
                        >
                          {HR_EVALUATION_ACTION_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {HR_EVALUATION_ACTION_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canManage && !locked ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input
                    className={PROFILE_INPUT_CLASS}
                    placeholder="Ação"
                    value={planTitle}
                    onChange={(event) => setPlanTitle(event.target.value)}
                  />
                  <input
                    className={PROFILE_INPUT_CLASS}
                    placeholder="Desenvolvimento / descrição"
                    value={planDescription}
                    onChange={(event) => setPlanDescription(event.target.value)}
                  />
                  <input
                    className={PROFILE_INPUT_CLASS}
                    placeholder="Responsável"
                    value={planOwner}
                    onChange={(event) => setPlanOwner(event.target.value)}
                  />
                  <input
                    type="date"
                    className={PROFILE_INPUT_CLASS}
                    value={planDue}
                    onChange={(event) => setPlanDue(event.target.value)}
                  />
                  <input
                    className={PROFILE_INPUT_CLASS}
                    placeholder="Observação"
                    value={planNotes}
                    onChange={(event) => setPlanNotes(event.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
                    disabled={busy || !planTitle.trim()}
                    onClick={() =>
                      void run(async () => {
                        await profilePostJson(
                          `/api/employees/${employeeId}/evaluations/${selected.id}/action-plans`,
                          {
                            title: planTitle,
                            description: planDescription,
                            responsibleName: planOwner,
                            dueDate: planDue || null,
                            notes: planNotes,
                          }
                        );
                        setPlanTitle("");
                        setPlanDescription("");
                        setPlanOwner("");
                        setPlanDue("");
                        setPlanNotes("");
                      })
                    }
                  >
                    Incluir ação
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {selected.priorActionPlans.length > 0 ? (
            <section className="rounded-lg border border-border p-3">
              <h4 className="text-sm font-semibold">Ações da avaliação de 45 dias</h4>
              <ul className="mt-2 space-y-1 text-sm">
                {selected.priorActionPlans.map((plan) => (
                  <li key={plan.id}>
                    {plan.title}
                    {plan.description ? ` — ${plan.description}` : ""} · {plan.responsibleName || "Sem responsável"} ·{" "}
                    {formatBr(plan.dueDate)} · {plan.statusLabel}
                    {plan.completedAt ? ` · concluída em ${formatDateTime(plan.completedAt)}` : ""}
                    {plan.notes ? ` · ${plan.notes}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section ref={documentsRef}>
            <h4 className="text-sm font-semibold">Documento original</h4>
            {selected.documents.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nenhum arquivo anexado.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {selected.documents.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {doc.displayName} · {formatBr(doc.createdAt)} · {doc.uploadedByName || "—"}
                    </span>
                    <span className="flex gap-3">
                      <a className="underline" href={doc.openUrl} target="_blank" rel="noreferrer">
                        Abrir
                      </a>
                      <a className="underline" href={doc.downloadUrl}>
                        Baixar
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canAttach && !locked ? (
              <input
                className="mt-2 block text-sm"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  const body = new FormData();
                  body.append("file", file);
                  void run(() =>
                    profileFetchJson(
                      `/api/employees/${employeeId}/evaluations/${selected.id}/documents`,
                      { method: "POST", body }
                    )
                  );
                }}
              />
            ) : null}
          </section>

          {selected.audit.length > 0 ? (
            <section>
              <h4 className="text-sm font-semibold">Auditoria</h4>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {selected.audit.map((event) => (
                  <li key={event.id}>
                    {AUDIT_ACTION_LABELS[event.action] ?? event.action} · {event.actorName || "—"} ·{" "}
                    {formatDateTime(event.createdAt)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          {formError && formError.includes("mesmo ciclo") ? (
            <p className="text-xs text-muted-foreground">
              Marque a confirmação acima para registrar outra avaliação neste ciclo.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {canManage && !locked ? (
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                Registrar resultado
              </button>
            ) : null}
            {canManage && selected.status !== "COMPLETED" && selected.status !== "CANCELLED" ? (
              <>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      profileFetchJson(`/api/employees/${employeeId}/evaluations/${selected.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: "WAITING_RETURN" }),
                      })
                    )
                  }
                >
                  Aguardando retorno
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      profileFetchJson(`/api/employees/${employeeId}/evaluations/${selected.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: "RETURNED" }),
                      })
                    )
                  }
                >
                  Registrar retorno
                </button>
              </>
            ) : null}
            {canComplete && selected.status !== "CANCELLED" ? (
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    profilePostJson(`/api/employees/${employeeId}/evaluations/${selected.id}/complete`, {
                      ...(payloadFrom(draft) as Record<string, unknown>),
                    })
                  )
                }
              >
                Concluir avaliação
              </button>
            ) : null}
            {canManage && selected.status !== "CANCELLED" && (selected.status !== "COMPLETED" || canComplete) ? (
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    profilePostJson(`/api/employees/${employeeId}/evaluations/${selected.id}/cancel`, {})
                  )
                }
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
      {busy ? <p className="text-xs text-muted-foreground">Salvando…</p> : null}
    </div>
  );
}
