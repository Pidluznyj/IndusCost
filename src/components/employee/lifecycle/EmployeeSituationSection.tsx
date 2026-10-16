/**
 * Cadastro do colaborador › Situação: Ativo, Afastado ou Desligado, com as regras legais.
 *
 * - Desligado grava no próprio cadastro (status INACTIVE + data, motivo, aviso prévio).
 * - Afastado NÃO muda o vínculo: registra/encerra o afastamento (HrAbsence) na hora, pela API
 *   da ficha. O colaborador continua ativo na folha, no organograma e nos demais módulos.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Info, Loader2, Scale, ShieldAlert, UserCheck, UserMinus, UserX } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import {
  LEAVE_RULES,
  LEAVE_TYPES,
  NOTICE_TYPE_LABELS,
  TERMINATION_REASONS,
  TERMINATION_RULES,
  addDaysIso,
  describeLeave,
  describeTermination,
  formatDateBr,
  isNoticeType,
  isTerminationReason,
  legalLeaveEnd,
  validateLeave,
  type EmployeeLifecycleDto,
  type LeaveInsight,
  type LeaveType,
  type TerminationInsight,
} from "@/src/lib/employeeLifecycle";
import { cn } from "@/src/lib/utils";

export type SituationChoice = "ACTIVE" | "ON_LEAVE" | "TERMINATED";

export type TerminationFormFields = {
  status?: "ACTIVE" | "INACTIVE";
  admissionDate?: string | null;
  terminationDate?: string | null;
  terminationReason?: string | null;
  terminationNoticeType?: string | null;
  terminationNoticeDate?: string | null;
  terminationDetails?: string | null;
};

const INPUT = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";
const LABEL = "text-xs font-bold uppercase text-muted-foreground";

function today(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10); // America/Sao_Paulo (UTC−3)
}

function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm font-medium", tone === "warn" && "text-amber-700", tone === "ok" && "text-emerald-700")}>{value}</dd>
    </div>
  );
}

/** Nuances legais de um afastamento (prazo, quem paga, INSS, FGTS, estabilidade, providências). */
export function LeaveInsightCard({
  insight,
  title,
  withRecord = true,
}: {
  insight: LeaveInsight;
  title?: string;
  /** Mostra justificativa e documentos (a aba de afastamentos já exibe na própria linha). */
  withRecord?: boolean;
}) {
  const record = withRecord ? insight.record : null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4" data-testid="leave-insight">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">{title ?? "Afastamento"}</p>
          <p className="text-base font-semibold text-foreground">{insight.label}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Scale className="h-3.5 w-3.5" aria-hidden /> {insight.legalBasis}
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">{insight.elapsedDays} dia(s)</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Afastado desde" value={formatDateBr(insight.startDate)} />
        <Fact label="Retorno previsto" value={formatDateBr(insight.expectedReturn)} />
        {insight.employerPaidUntil ? <Fact label="Empresa paga até" value={formatDateBr(insight.employerPaidUntil)} /> : null}
        {insight.inssFrom ? (
          <Fact label="INSS a partir de" value={formatDateBr(insight.inssFrom)} tone={insight.inssReferralNeeded ? "warn" : undefined} />
        ) : null}
        {insight.legalEnd ? <Fact label="Fim do prazo legal" value={formatDateBr(insight.legalEnd)} /> : null}
        <Fact label="FGTS no período" value={insight.fgtsContinues ? "Depósito continua" : "Sem depósito"} />
        {insight.stabilityUntil ? <Fact label="Estabilidade até" value={formatDateBr(insight.stabilityUntil)} tone="warn" /> : null}
        {record?.inssBenefitNumber ? <Fact label="Benefício INSS" value={record.inssBenefitNumber} /> : null}
        {record?.catNumber ? <Fact label="CAT" value={record.catNumber} /> : null}
      </dl>
      {record?.justification ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-background/70 px-3 py-2" data-testid="leave-justification">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Justificativa</p>
          <p className="whitespace-pre-line text-sm text-foreground">{record.justification}</p>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Efeito no contrato:</span> {insight.contractEffect}. {insight.payment}
      </p>
      {insight.stabilityBasis ? <p className="mt-1 text-xs text-muted-foreground">{insight.stabilityBasis}.</p> : null}
      {insight.requirements.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {insight.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {insight.alerts.length ? (
        <div className="mt-3 space-y-1">
          {insight.alerts.map((a) => (
            <p key={a} className="flex items-start gap-1.5 text-xs font-medium text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {a}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Nuances do desligamento (base legal, aviso prévio proporcional, projeção, verbas). */
export function TerminationInsightCard({
  insight,
  terminationDate,
  details,
}: {
  insight: TerminationInsight;
  terminationDate: string;
  details?: string | null;
}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4" data-testid="termination-insight">
      <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">Desligamento</p>
      <p className="text-base font-semibold text-foreground">{insight.label}</p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        <Scale className="h-3.5 w-3.5" aria-hidden /> {insight.legalBasis}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Data de demissão" value={formatDateBr(terminationDate)} />
        <Fact label="Aviso prévio" value={insight.noticeTypeLabel} />
        {insight.noticeDays ? <Fact label="Dias de aviso" value={`${insight.noticeDays} dias`} /> : null}
        {insight.yearsOfService != null ? <Fact label="Tempo de casa" value={`${insight.yearsOfService} ano(s) completo(s)`} /> : null}
        {insight.noticeEnd ? <Fact label="Fim do aviso trabalhado" value={formatDateBr(insight.noticeEnd)} /> : null}
        {insight.projectedEnd ? <Fact label="Projeção do aviso indenizado" value={formatDateBr(insight.projectedEnd)} /> : null}
      </dl>
      {insight.rights.length ? (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {insight.rights.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {insight.projectedEnd ? (
        <p className="mt-2 text-xs text-muted-foreground">O aviso indenizado integra o tempo de serviço (CLT, art. 487, § 1º): use a projeção para férias e 13º.</p>
      ) : null}
      {details ? <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/70 p-2 text-xs text-foreground">{details}</p> : null}
    </div>
  );
}

type LeaveDraft = {
  type: LeaveType;
  startDate: string;
  expectedReturn: string;
  reason: string;
  extendedLicense: boolean;
  inssBenefitNumber: string;
  catNumber: string;
};

function legalReturn(type: LeaveType, start: string, extended: boolean): string {
  const end = start ? legalLeaveEnd(type, start, extended) : null;
  return end ? addDaysIso(end, 1) : "";
}

export function EmployeeSituationSection({
  employeeId,
  value,
  onChange,
  warnings,
  acknowledged,
  onAcknowledge,
  onLeaveChanged,
}: {
  /** null ao criar: afastamento só existe para colaborador já cadastrado. */
  employeeId: string | null;
  value: TerminationFormFields;
  onChange: (patch: TerminationFormFields) => void;
  /** Avisos legais devolvidos pelo servidor (409) que exigem ciência. */
  warnings: string[] | null;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  onLeaveChanged?: () => void;
}) {
  const [lifecycle, setLifecycle] = useState<EmployeeLifecycleDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState<SituationChoice>(value.status === "INACTIVE" ? "TERMINATED" : "ACTIVE");
  const [draft, setDraft] = useState<LeaveDraft>({
    type: "SICK_LEAVE",
    startDate: today(),
    expectedReturn: "",
    reason: "",
    extendedLicense: false,
    inssBenefitNumber: "",
    catNumber: "",
  });
  const [returnDate, setReturnDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const r = await fetchJsonOk<{ lifecycle?: EmployeeLifecycleDto }>(`/api/employees/${employeeId}/professional`, { cache: "no-store" });
      setLifecycle(r.lifecycle ?? null);
      // Afastado abre no afastamento, salvo quando o cadastro já veio para desligar.
      if (r.lifecycle?.situation.code === "ON_LEAVE") setChoice((c) => (c === "TERMINATED" ? c : "ON_LEAVE"));
    } catch {
      setLifecycle(null);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ongoing = lifecycle?.situation.code === "ON_LEAVE" ? lifecycle.situation : null;

  const pick = (next: SituationChoice) => {
    setChoice(next);
    setMessage(null);
    onAcknowledge(false);
    onChange(next === "TERMINATED" ? { status: "INACTIVE" } : { status: "ACTIVE" });
  };

  // —— Afastamento: prévia legal e validação local (o servidor revalida) ——
  const rule = LEAVE_RULES[draft.type];
  const effectiveReturn = draft.expectedReturn || legalReturn(draft.type, draft.startDate, draft.extendedLicense);
  const draftErrors = useMemo(
    () =>
      validateLeave({
        type: draft.type,
        startDate: draft.startDate || null,
        expectedReturn: effectiveReturn || null,
        endDate: null,
        actualReturn: null,
        justification: draft.reason,
        extendedLicense: draft.extendedLicense,
        employee: { status: value.status ?? "ACTIVE", admissionDate: value.admissionDate || null, terminationDate: null },
        others: [],
      }),
    [draft, effectiveReturn, value.status, value.admissionDate],
  );
  const draftInsight = draft.startDate
    ? describeLeave({ type: draft.type, startDate: draft.startDate, expectedReturn: effectiveReturn || null, extendedLicense: draft.extendedLicense }, today())
    : null;

  const registerLeave = async () => {
    if (!employeeId || draftErrors.length) return;
    setBusy(true);
    setMessage(null);
    try {
      await fetchJsonOk(`/api/employees/${employeeId}/absences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: draft.type,
          startDate: draft.startDate,
          expectedReturn: effectiveReturn || null,
          reason: draft.reason.trim(),
          extendedLicense: draft.extendedLicense,
          inssBenefitNumber: draft.inssBenefitNumber.trim() || null,
          catNumber: draft.catNumber.trim() || null,
        }),
      });
      setMessage({ kind: "ok", text: "Afastamento registrado." });
      setDraft((d) => ({ ...d, reason: "", inssBenefitNumber: "", catNumber: "" }));
      await load();
      onLeaveChanged?.();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Não foi possível registrar o afastamento." });
    } finally {
      setBusy(false);
    }
  };

  const registerReturn = async () => {
    if (!employeeId || !ongoing?.leaveId) return;
    setBusy(true);
    setMessage(null);
    try {
      await fetchJsonOk(`/api/employees/${employeeId}/absences/${ongoing.leaveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualReturn: returnDate }),
      });
      setMessage({ kind: "ok", text: "Retorno registrado. O colaborador volta a constar como ativo." });
      setChoice("ACTIVE");
      await load();
      onLeaveChanged?.();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Não foi possível registrar o retorno." });
    } finally {
      setBusy(false);
    }
  };

  // —— Desligamento: prévia legal ——
  const reason = isTerminationReason(value.terminationReason) ? value.terminationReason : null;
  const termRule = reason ? TERMINATION_RULES[reason] : null;
  const noticeOptions = termRule ? termRule.noticeTypes : [];
  const terminationPreview =
    reason && isNoticeType(value.terminationNoticeType) && value.terminationDate
      ? describeTermination(
          {
            reason,
            noticeType: value.terminationNoticeType,
            noticeDate: value.terminationNoticeDate || null,
            details: null,
            terminationDate: value.terminationDate,
          },
          value.admissionDate || null,
        )
      : null;

  const options: { value: SituationChoice; label: string; icon: React.ReactNode; hint: string }[] = [
    { value: "ACTIVE", label: "Ativo", icon: <UserCheck className="h-4 w-4" aria-hidden />, hint: "Vínculo ativo, trabalhando" },
    { value: "ON_LEAVE", label: "Afastado", icon: <UserMinus className="h-4 w-4" aria-hidden />, hint: "Vínculo ativo, contrato suspenso/interrompido" },
    { value: "TERMINATED", label: "Desligado", icon: <UserX className="h-4 w-4" aria-hidden />, hint: "Vínculo encerrado" },
  ];

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4" data-testid="employee-situation-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">Situação do colaborador</h4>
          <p className="text-xs text-muted-foreground">Afastado mantém o vínculo; desligado encerra o vínculo.</p>
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Situação">
        {options.map((o) => {
          const on = choice === o.value;
          const disabled = o.value === "ON_LEAVE" && !employeeId;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => pick(o.value)}
              title={disabled ? "Salve o cadastro antes de registrar um afastamento." : undefined}
              data-testid={`situation-${o.value.toLowerCase()}`}
              className={cn(
                "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                on
                  ? o.value === "TERMINATED"
                    ? "border-rose-400 bg-rose-50"
                    : o.value === "ON_LEAVE"
                      ? "border-amber-400 bg-amber-50"
                      : "border-emerald-400 bg-emerald-50"
                  : "border-border hover:bg-muted/60",
              )}
            >
              <span className="mt-0.5">{o.icon}</span>
              <span>
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            message.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          {message.text}
        </p>
      ) : null}

      {/* —— Ativo com afastamento em aberto: precisa registrar o retorno —— */}
      {choice === "ACTIVE" && ongoing?.leave ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> O colaborador está afastado desde {formatDateBr(ongoing.since)}. Para voltar a Ativo, registre o retorno em “Afastado”.
        </p>
      ) : null}

      {/* —— Afastado —— */}
      {choice === "ON_LEAVE" && employeeId ? (
        ongoing?.leave ? (
          <div className="space-y-3">
            <LeaveInsightCard insight={ongoing.leave} title="Afastamento em andamento" />
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Data do retorno ao trabalho</span>
                <input type="date" className={INPUT} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} data-testid="leave-return-date" />
              </label>
              <button
                type="button"
                onClick={() => void registerReturn()}
                disabled={busy || !returnDate}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                data-testid="leave-register-return"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarClock className="h-4 w-4" aria-hidden />}
                Registrar retorno
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="leave-form">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
                <span className={LABEL}>Tipo de afastamento *</span>
                <select
                  className={INPUT}
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as LeaveType, expectedReturn: "", extendedLicense: false })}
                  data-testid="leave-type"
                >
                  {LEAVE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {LEAVE_RULES[t].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Data do afastamento *</span>
                <input type="date" className={INPUT} value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} data-testid="leave-start" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Retorno previsto</span>
                <input
                  type="date"
                  className={INPUT}
                  value={effectiveReturn}
                  onChange={(e) => setDraft({ ...draft, expectedReturn: e.target.value })}
                  data-testid="leave-expected-return"
                />
              </label>
              {rule.extendedDays ? (
                <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3">
                  <input
                    type="checkbox"
                    checked={draft.extendedLicense}
                    onChange={(e) => setDraft({ ...draft, extendedLicense: e.target.checked, expectedReturn: "" })}
                  />
                  {rule.extendedLabel} — {rule.extendedDays} dias no total
                </label>
              ) : null}
              {draft.type === "SICK_LEAVE" || draft.type === "ACCIDENT" ? (
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Nº do benefício INSS</span>
                  <input className={INPUT} value={draft.inssBenefitNumber} maxLength={40} onChange={(e) => setDraft({ ...draft, inssBenefitNumber: e.target.value })} placeholder="Acima de 15 dias" />
                </label>
              ) : null}
              {draft.type === "ACCIDENT" ? (
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Nº da CAT</span>
                  <input className={INPUT} value={draft.catNumber} maxLength={40} onChange={(e) => setDraft({ ...draft, catNumber: e.target.value })} />
                </label>
              ) : null}
              <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                <span className={LABEL}>Justificativa *</span>
                <textarea
                  className={cn(INPUT, "min-h-[72px]")}
                  value={draft.reason}
                  maxLength={2000}
                  placeholder="Motivo do afastamento, documento apresentado (atestado, certidão, CAT) e observações do RH."
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                  data-testid="leave-reason"
                />
              </label>
            </div>
            {draftInsight ? <LeaveInsightCard insight={draftInsight} title="Prévia das regras legais" /> : null}
            {draftErrors.length ? (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-700" data-testid="leave-errors">
                {draftErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void registerLeave()}
                disabled={busy || draftErrors.length > 0}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                data-testid="leave-register"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserMinus className="h-4 w-4" aria-hidden />}
                Registrar afastamento
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">O afastamento é gravado na hora e aparece também em “Férias &amp; afastamentos” e no histórico.</p>
          </div>
        )
      ) : null}

      {/* —— Desligado —— */}
      {choice === "TERMINATED" ? (
        <div className="space-y-3" data-testid="termination-form">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Data de demissão *</span>
              <input
                type="date"
                className={INPUT}
                value={value.terminationDate ?? ""}
                onChange={(e) => onChange({ terminationDate: e.target.value })}
                data-testid="termination-date"
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={LABEL}>Motivo do desligamento *</span>
              <select
                className={INPUT}
                value={value.terminationReason ?? ""}
                onChange={(e) => {
                  const next = e.target.value;
                  const firstNotice = isTerminationReason(next) ? TERMINATION_RULES[next].noticeTypes[0] : null;
                  onChange({
                    terminationReason: next || null,
                    terminationNoticeType: firstNotice,
                    terminationNoticeDate: firstNotice === "WORKED" || firstNotice === "INDEMNIFIED" ? value.terminationNoticeDate || value.terminationDate || "" : null,
                  });
                }}
                data-testid="termination-reason"
              >
                <option value="">Selecione…</option>
                {TERMINATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {TERMINATION_RULES[r].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Aviso prévio *</span>
              <select
                className={INPUT}
                value={value.terminationNoticeType ?? ""}
                disabled={!termRule}
                onChange={(e) => onChange({ terminationNoticeType: e.target.value || null })}
                data-testid="termination-notice-type"
              >
                {!termRule ? <option value="">Escolha o motivo</option> : null}
                {noticeOptions.map((n) => (
                  <option key={n} value={n}>
                    {NOTICE_TYPE_LABELS[n]}
                  </option>
                ))}
              </select>
            </label>
            {value.terminationNoticeType === "WORKED" || value.terminationNoticeType === "INDEMNIFIED" ? (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Comunicação do aviso *</span>
                <input
                  type="date"
                  className={INPUT}
                  value={value.terminationNoticeDate ?? ""}
                  onChange={(e) => onChange({ terminationNoticeDate: e.target.value })}
                  data-testid="termination-notice-date"
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
              <span className={LABEL}>
                Descrição {termRule?.requiresDetails ? "* (fatos e base legal)" : "(opcional)"}
              </span>
              <textarea
                className={cn(INPUT, "min-h-[64px]")}
                value={value.terminationDetails ?? ""}
                maxLength={4000}
                placeholder={
                  reason === "DISMISSAL_WITH_CAUSE"
                    ? "Descreva a falta grave, a alínea do art. 482 da CLT, datas e documentos (advertências, provas)."
                    : "Observações do desligamento."
                }
                onChange={(e) => onChange({ terminationDetails: e.target.value })}
                data-testid="termination-details"
              />
            </label>
          </div>
          {terminationPreview && value.terminationDate ? <TerminationInsightCard insight={terminationPreview} terminationDate={value.terminationDate} /> : null}
          {ongoing?.leave && termRule?.blockedDuringLeave ? (
            <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Afastamento em andamento desde {formatDateBr(ongoing.since)}: {termRule.label.toLowerCase()} não é permitida enquanto o contrato está suspenso ou interrompido.
            </p>
          ) : null}
          {warnings?.length ? (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="termination-warnings">
              {warnings.map((w) => (
                <p key={w} className="flex items-start gap-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {w}
                </p>
              ))}
              <label className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} data-testid="termination-acknowledge" />
                Estou ciente das restrições legais e quero registrar o desligamento.
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Mensagens dos avisos legais devolvidos pelo servidor (409 TERMINATION_WARNINGS). */
export function terminationWarningsFromError(error: unknown): string[] | null {
  if (!(error instanceof HttpError) || error.code !== "TERMINATION_WARNINGS") return null;
  const details = error.details as { warnings?: unknown } | undefined;
  return Array.isArray(details?.warnings) ? details!.warnings.filter((w): w is string => typeof w === "string") : null;
}
