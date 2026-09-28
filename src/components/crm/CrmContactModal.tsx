/**
 * Modal "Registrar contato" do CRM Comercial.
 *
 * Responsável comercial, registrado por e status aparecem bloqueados e são
 * calculados no servidor (GET …/commercial-activities/context e POST): a tela
 * só envia os campos do contato. Listas, rótulos e validação vêm de
 * crmContactCatalog — a mesma regra do servidor.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  CRM_CONTACT_CHANNEL_OPTIONS,
  CRM_CONTACT_EMAIL_MAX,
  CRM_CONTACT_FIELDS,
  CRM_CONTACT_NEXT_ACTION_DESCRIPTION_MAX,
  CRM_CONTACT_PHONE_MAX,
  CRM_CONTACT_REASON_OPTIONS,
  CRM_CONTACT_SUMMARY_MAX,
  CRM_NEXT_ACTION_NONE,
  crmContactResultOptions,
  crmNextActionOptions,
  type CrmContactFieldErrors,
} from "@/src/lib/commercial/crmContactCatalog";
import {
  applyCrmContactFieldChange,
  buildCrmContactPayload,
  CRM_CONTACT_NO_OWNER_LABEL,
  crmContactDerivedStatusText,
  initialCrmContactForm,
  validateCrmContactForm,
  type CrmContactFormField,
  type CrmContactFormState,
  type CrmContactModalContext,
} from "./crmContactForm";

export type CrmContactModalCustomer = {
  id: string;
  displayName?: string | null;
  taxId?: string | null;
};

export type CrmContactModalLoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; context: CrmContactModalContext };

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground";
const invalidClass = "border-red-400 focus:ring-red-200 focus:border-red-500";
const lockedClass =
  "w-full rounded-xl border border-border bg-muted/40 pl-8 pr-3 py-2.5 text-sm text-foreground cursor-default focus:outline-none focus:ring-2 focus:ring-primary/20";

function fieldId(prefix: string, field: string): string {
  return `${prefix}-${field}`;
}

function Field({
  id,
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string | null;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="text-xs font-semibold uppercase text-muted-foreground">
        {label}
        {required ? (
          <span className="text-red-600" aria-hidden="true">
            {" "}*
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string | null, hint?: string | null): string | undefined {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

/** Valor calculado pelo servidor: legível, focável, nunca editável. */
function LockedField({
  id,
  label,
  value,
  muted,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <div className="relative">
        <Lock
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id={id}
          readOnly
          aria-readonly="true"
          value={value}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cn(lockedClass, muted && "italic text-muted-foreground")}
        />
      </div>
    </Field>
  );
}

export type CrmContactModalViewProps = {
  idPrefix: string;
  customer: CrmContactModalCustomer;
  load: CrmContactModalLoadState;
  form: CrmContactFormState | null;
  errors: CrmContactFieldErrors;
  submitError: string | null;
  saving: boolean;
  onChange: (field: CrmContactFormField, value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
  onRetry: () => void;
};

/** Tela do modal (pura, sem efeitos) — testável com render estático. */
export function CrmContactModalView(props: CrmContactModalViewProps) {
  const { idPrefix, customer, load, form, errors, submitError, saving, onChange, onSubmit, onCancel, onRetry } =
    props;
  const context = load.phase === "ready" ? load.context : null;
  const title = context?.customer.displayName ?? customer.displayName ?? null;
  const taxId = context?.customer.taxId ?? customer.taxId ?? null;
  const id = (field: string) => fieldId(idPrefix, field);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id("title")}
        className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl border border-border bg-card shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <div className="min-w-0">
            <h4 id={id("title")} className="text-lg font-bold">
              Registrar contato
            </h4>
            {title ? (
              <p className="truncate text-xs text-muted-foreground">
                {title}
                {taxId ? ` · ${taxId}` : ""}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg p-2 hover:bg-accent text-muted-foreground disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {load.phase === "loading" ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Carregando dados do cliente…
          </div>
        ) : load.phase === "error" ? (
          <div className="p-5 space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {load.message}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : form && context ? (
          <form onSubmit={onSubmit} noValidate className="flex flex-col flex-1 min-h-0">
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              {submitError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                  {submitError}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground rounded-xl border border-border/60 bg-muted/30 px-4 py-3 leading-relaxed">
                Registre apenas informações úteis para o atendimento comercial. Evite dados sensíveis,
                íntimos ou desnecessários.
              </p>
              <CrmContactDataSection
                id={id}
                form={form}
                context={context}
                errors={errors}
                disabled={saving}
                onChange={onChange}
              />
              <CrmContactResultSection id={id} form={form} errors={errors} disabled={saving} onChange={onChange} />
              <CrmContactNextActionSection id={id} form={form} errors={errors} disabled={saving} onChange={onChange} />
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-border bg-card shrink-0">
              <button
                type="button"
                disabled={saving}
                onClick={onCancel}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                aria-busy={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {saving ? "Salvando…" : "Salvar contato"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

type SectionProps = {
  id: (field: string) => string;
  form: CrmContactFormState;
  errors: CrmContactFieldErrors;
  disabled: boolean;
  onChange: (field: CrmContactFormField, value: string) => void;
};

function inputProps(
  id: string,
  error: string | undefined,
  hint?: string | null
): { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined } {
  return { id, "aria-invalid": Boolean(error), "aria-describedby": describedBy(id, error, hint) };
}

/** Bloco 1 — Dados do contato. */
function CrmContactDataSection({
  id,
  form,
  context,
  errors,
  disabled,
  onChange,
}: SectionProps & { context: CrmContactModalContext }) {
  const phoneHint = context.customer.phone
    ? "Preenchido pelo cadastro do cliente. Alterar aqui vale só para este contato."
    : "Cliente sem telefone no cadastro.";
  const emailHint = context.customer.email
    ? "Preenchido pelo cadastro do cliente. Alterar aqui vale só para este contato."
    : "Cliente sem e-mail no cadastro.";
  return (
    <section className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4" aria-labelledby={id("data")}>
      <h5 id={id("data")} className="text-sm font-bold text-foreground">
        Dados do contato
      </h5>
      <Field id={id("contactDate")} label="Data do contato" required error={errors.contactDate}>
        <input
          type="datetime-local"
          {...inputProps(id("contactDate"), errors.contactDate)}
          value={form.contactDate}
          disabled={disabled}
          onChange={(e) => onChange("contactDate", e.target.value)}
          className={cn(inputClass, errors.contactDate && invalidClass)}
        />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field id={id("channel")} label="Canal" required error={errors.channel}>
          <select
            {...inputProps(id("channel"), errors.channel)}
            autoFocus
            value={form.channel}
            disabled={disabled}
            onChange={(e) => onChange("channel", e.target.value)}
            className={cn(inputClass, errors.channel && invalidClass)}
          >
            {CRM_CONTACT_CHANNEL_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id("reason")} label="Motivo" required error={errors.reason}>
          <select
            {...inputProps(id("reason"), errors.reason)}
            value={form.reason}
            disabled={disabled}
            onChange={(e) => onChange("reason", e.target.value)}
            className={cn(inputClass, errors.reason && invalidClass)}
          >
            {CRM_CONTACT_REASON_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <LockedField
          id={id("commercialOwner")}
          label="Responsável comercial"
          value={context.commercialOwner?.name ?? CRM_CONTACT_NO_OWNER_LABEL}
          muted={!context.commercialOwner}
          hint="Responsável atual do cliente na carteira."
        />
        <LockedField id={id("registeredBy")} label="Registrado por" value={context.registeredBy.name} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field id={id("phoneUsed")} label="Telefone utilizado" hint={phoneHint} error={errors.phoneUsed}>
          <input
            type="tel"
            {...inputProps(id("phoneUsed"), errors.phoneUsed, phoneHint)}
            value={form.phoneUsed}
            maxLength={CRM_CONTACT_PHONE_MAX}
            disabled={disabled}
            onChange={(e) => onChange("phoneUsed", e.target.value)}
            className={cn(inputClass, errors.phoneUsed && invalidClass)}
          />
        </Field>
        <Field id={id("emailUsed")} label="E-mail utilizado" hint={emailHint} error={errors.emailUsed}>
          <input
            type="email"
            {...inputProps(id("emailUsed"), errors.emailUsed, emailHint)}
            value={form.emailUsed}
            maxLength={CRM_CONTACT_EMAIL_MAX}
            disabled={disabled}
            onChange={(e) => onChange("emailUsed", e.target.value)}
            className={cn(inputClass, errors.emailUsed && invalidClass)}
          />
        </Field>
      </div>
    </section>
  );
}

/** Bloco 2 — Resultado. */
function CrmContactResultSection({ id, form, errors, disabled, onChange }: SectionProps) {
  const results = crmContactResultOptions(form.reason);
  return (
    <section className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4" aria-labelledby={id("result-block")}>
      <h5 id={id("result-block")} className="text-sm font-bold text-foreground">
        Resultado
      </h5>
      <Field id={id("result")} label="Resultado do contato" required error={errors.result}>
        <select
          {...inputProps(id("result"), errors.result)}
          value={form.result}
          disabled={disabled}
          onChange={(e) => onChange("result", e.target.value)}
          className={cn(inputClass, errors.result && invalidClass)}
        >
          <option value="">Selecione o resultado…</option>
          {results.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id={id("summary")}
        label="Resumo da conversa"
        required
        hint="O que foi efetivamente conversado."
        error={errors.summary}
      >
        <textarea
          {...inputProps(id("summary"), errors.summary, "O que foi efetivamente conversado.")}
          value={form.summary}
          rows={4}
          maxLength={CRM_CONTACT_SUMMARY_MAX}
          disabled={disabled}
          onChange={(e) => onChange("summary", e.target.value)}
          placeholder="Ex.: Cliente pretende repor estoque na primeira quinzena de outubro e pediu revisão do prazo de pagamento."
          className={cn(inputClass, errors.summary && invalidClass)}
        />
      </Field>
    </section>
  );
}

/** Bloco 3 — Próxima ação. */
function CrmContactNextActionSection({ id, form, errors, disabled, onChange }: SectionProps) {
  const actions = crmNextActionOptions(form.reason);
  const isNone = form.nextActionType === CRM_NEXT_ACTION_NONE;
  const hasRealAction = Boolean(form.nextActionType) && !isNone;
  const dateHint = isNone ? "Sem próxima ação: não há data." : null;
  const detailHint = isNone ? "Opcional quando não há próxima ação." : null;
  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4" aria-labelledby={id("next-block")}>
      <h5 id={id("next-block")} className="text-sm font-bold text-foreground">
        Próxima ação
      </h5>
      <Field id={id("nextActionType")} label="Próxima ação" required error={errors.nextActionType}>
        <select
          {...inputProps(id("nextActionType"), errors.nextActionType)}
          value={form.nextActionType}
          disabled={disabled}
          onChange={(e) => onChange("nextActionType", e.target.value)}
          className={cn(inputClass, errors.nextActionType && invalidClass)}
        >
          <option value="">Selecione a próxima ação…</option>
          {actions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          id={id("nextActionAt")}
          label="Data/hora da próxima ação"
          required={hasRealAction}
          hint={dateHint}
          error={errors.nextActionAt}
        >
          <input
            type="datetime-local"
            {...inputProps(id("nextActionAt"), errors.nextActionAt, dateHint)}
            value={isNone ? "" : form.nextActionAt}
            min={form.contactDate || undefined}
            disabled={disabled || isNone}
            onChange={(e) => onChange("nextActionAt", e.target.value)}
            className={cn(inputClass, errors.nextActionAt && invalidClass)}
          />
        </Field>
        <LockedField
          id={id("status")}
          label="Status"
          value={crmContactDerivedStatusText(form.nextActionType) ?? "Definido pela próxima ação"}
          muted={!form.nextActionType}
        />
      </div>
      <Field
        id={id("nextActionDescription")}
        label={isNone ? "Detalhamento da próxima ação (opcional)" : "Detalhamento da próxima ação"}
        required={hasRealAction}
        hint={detailHint}
        error={errors.nextActionDescription}
      >
        <textarea
          {...inputProps(id("nextActionDescription"), errors.nextActionDescription, detailHint)}
          value={form.nextActionDescription}
          rows={3}
          maxLength={CRM_CONTACT_NEXT_ACTION_DESCRIPTION_MAX}
          disabled={disabled}
          onChange={(e) => onChange("nextActionDescription", e.target.value)}
          placeholder="Ex.: Revisar prazo para 45 dias e incluir os produtos X e Y."
          className={cn(inputClass, errors.nextActionDescription && invalidClass)}
        />
      </Field>
    </section>
  );
}

/**
 * Modal com dados: carrega o contexto do cliente, valida com a regra canônica e
 * grava. `onSaved` roda depois do POST bem-sucedido (recarregar listas, fechar).
 */
export function CrmContactModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: CrmContactModalCustomer;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const idPrefix = `crm-contact-${useId().replace(/:/g, "")}`;
  const [load, setLoad] = useState<CrmContactModalLoadState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<CrmContactFormState | null>(null);
  const [errors, setErrors] = useState<CrmContactFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ phase: "loading" });
    setForm(null);
    setErrors({});
    setSubmitError(null);
    fetchJsonOk<CrmContactModalContext>(
      `/api/customers/${encodeURIComponent(customer.id)}/commercial-activities/context`
    )
      .then((context) => {
        if (cancelled) return;
        setForm(initialCrmContactForm(context));
        setLoad({ phase: "ready", context });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad({
          phase: "error",
          message: err instanceof Error && err.message ? err.message : "Falha ao carregar os dados do cliente.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [customer.id, attempt]);

  const close = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const handleChange = useCallback((field: CrmContactFormField, value: string) => {
    setForm((prev) => (prev ? applyCrmContactFieldChange(prev, field, value) : prev));
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field as keyof CrmContactFieldErrors];
      return next;
    });
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || savingRef.current) return;
    const found = validateCrmContactForm(form);
    setErrors(found);
    const firstInvalid = CRM_CONTACT_FIELDS.find((field) => found[field]);
    if (firstInvalid) {
      setSubmitError("Revise os campos destacados.");
      window.setTimeout(() => document.getElementById(fieldId(idPrefix, firstInvalid))?.focus(), 0);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSubmitError(null);
    try {
      await fetchJsonOk(`/api/customers/${encodeURIComponent(customer.id)}/commercial-activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCrmContactPayload(form)),
      });
    } catch (err) {
      savingRef.current = false;
      setSaving(false);
      setSubmitError(err instanceof Error && err.message ? err.message : "Falha ao salvar o contato.");
      return;
    }
    // Contato gravado: falha ao recarregar as listas não pode virar "erro ao
    // salvar" (um novo clique duplicaria o registro).
    try {
      await onSaved();
    } catch (err) {
      console.error("CrmContactModal: falha após salvar o contato", err);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <CrmContactModalView
      idPrefix={idPrefix}
      customer={customer}
      load={load}
      form={form}
      errors={errors}
      submitError={submitError}
      saving={saving}
      onChange={handleChange}
      onSubmit={(event) => void handleSubmit(event)}
      onCancel={close}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}
