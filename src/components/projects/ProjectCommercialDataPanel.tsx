import React, { useMemo, useState } from "react";
import { Building2, Link2, Link2Off, Pencil } from "lucide-react";
import type { ProjectDetail } from "@/src/types/projects";
import {
  COMMERCIAL_TERM_UNDEFINED,
  PROJECT_FREIGHT_CONDITIONS,
  PROJECT_FREIGHT_LABELS,
  PROJECT_PRIORITIES,
  PROJECT_PRIORITY_LABELS,
  isProjectFreightCondition,
  projectPriorityLabel,
} from "@/src/lib/projectsCommercialTerms";
import { formatTaxId } from "@/src/lib/projectsCustomerLink";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";
import {
  ProjectCustomerLookupField,
  type ProjectCustomerSelection,
} from "@/src/components/projects/ProjectCustomerLookupField";

type Props = {
  detail: ProjectDetail;
  canManage: boolean;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
};

type Draft = {
  proposalValidityDays: string;
  paymentTerms: string;
  deliveryTimeDays: string;
  deliveryLocation: string;
  freightCondition: string;
  desiredDeadline: string;
  priority: string;
  application: string;
  clientNotes: string;
};

function toDraft(d: ProjectDetail): Draft {
  return {
    proposalValidityDays: d.proposalValidityDays != null ? String(d.proposalValidityDays) : "",
    paymentTerms: d.paymentTerms ?? "",
    deliveryTimeDays: d.deliveryTimeDays != null ? String(d.deliveryTimeDays) : "",
    deliveryLocation: d.deliveryLocation ?? "",
    freightCondition: d.freightCondition ?? "",
    desiredDeadline: d.desiredDeadline ?? "",
    priority: d.priority ?? "",
    application: d.application ?? "",
    clientNotes: d.clientNotes ?? "",
  };
}

/** Só as chaves alteradas; vazio → null (limpa). */
export function buildCommercialPatchBody(before: Draft, after: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof Draft)[]) {
    if (after[key].trim() === before[key].trim()) continue;
    const v = after[key].trim();
    if (key === "proposalValidityDays" || key === "deliveryTimeDays") body[key] = v === "" ? null : Number(v);
    else body[key] = v === "" ? null : v;
  }
  return body;
}

function formatDateBr(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : null;
}

function Term({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={value ? "text-sm font-medium" : "text-sm italic text-muted-foreground"}>
        {value ?? COMMERCIAL_TERM_UNDEFINED}
      </dd>
    </div>
  );
}

export function ProjectCommercialDataPanel({ detail, canManage, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(detail));
  const [selection, setSelection] = useState<ProjectCustomerSelection>(null);
  const [unlink, setUnlink] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = useMemo(() => toDraft(detail), [detail]);

  const linked = Boolean(detail.customerId);
  const deliveryText = [
    detail.deliveryTimeDays != null ? `${detail.deliveryTimeDays} dia(s)` : null,
    detail.deliveryLocation,
  ]
    .filter(Boolean)
    .join(" · ");

  const openEditor = () => {
    setDraft(toDraft(detail));
    setSelection(null);
    setUnlink(false);
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    const body = buildCommercialPatchBody(initial, draft);
    if (selection?.mode === "existing" && selection.item.id !== detail.customerId) {
      body.customerId = selection.item.id;
    } else if (selection?.mode === "simulation") {
      // Só por escolha explícita ("Usar … como cliente novo"); texto apenas digitado é ignorado.
      const name = selection.name;
      if (name.trim() && name.trim() !== detail.customerName) {
        if (linked) body.customerId = null;
        body.customerName = name.trim();
        body.customerDocument = null;
      }
    } else if (unlink && linked) {
      body.customerId = null;
    }
    if (Object.keys(body).length === 0) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(body);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const input = "w-full rounded-lg border border-border px-3 py-2 text-sm";
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  return (
    <section className="rounded-xl border border-border bg-card p-5" data-testid="project-commercial-data">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <h4 className="font-semibold">Cliente e condições comerciais</h4>
            <p className="text-xs text-muted-foreground">
              Usados nos documentos do projeto. Campos não definidos aparecem como “{COMMERCIAL_TERM_UNDEFINED}”.
            </p>
          </div>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={openEditor}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Pencil className="h-4 w-4" />
            Editar
          </button>
        ) : null}
      </div>

      <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{detail.customerName}</span>
          {detail.customerDocument ? (
            <span className="text-xs text-muted-foreground">{formatTaxId(detail.customerDocument)}</span>
          ) : null}
          {linked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
              <Link2 className="h-3 w-3" />
              Vinculado ao cadastro de clientes
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              <Link2Off className="h-3 w-3" />
              Sem vínculo com o cadastro
            </span>
          )}
        </div>
        {linked && detail.customer ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Cadastro: {detail.customer.companyName}
            {detail.customer.city ? ` · ${detail.customer.city}${detail.customer.state ? `/${detail.customer.state}` : ""}` : ""}
            {detail.customer.status !== "ACTIVE" ? " · cliente inativo" : ""}
          </p>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Term
          label="Validade da proposta"
          value={detail.proposalValidityDays != null ? `${detail.proposalValidityDays} dia(s)` : null}
        />
        <Term label="Condição de pagamento" value={detail.paymentTerms} />
        <Term label="Entrega" value={deliveryText || null} />
        <Term
          label="Frete"
          value={isProjectFreightCondition(detail.freightCondition) ? PROJECT_FREIGHT_LABELS[detail.freightCondition] : null}
        />
        <Term label="Prazo desejado" value={formatDateBr(detail.desiredDeadline)} />
        <Term label="Prioridade" value={projectPriorityLabel(detail.priority)} />
        <Term label="Aplicação" value={detail.application} />
      </dl>
      <div className="mt-4">
        <p className="text-xs text-muted-foreground">Observações ao cliente</p>
        <p className={detail.clientNotes ? "whitespace-pre-wrap text-sm" : "text-sm italic text-muted-foreground"}>
          {detail.clientNotes ?? "Nenhuma"}
        </p>
      </div>

      {open ? (
        <ProjectModalShell
          title="Cliente e condições comerciais"
          subtitle={`${detail.code} — ${detail.title}`}
          wide
          onClose={() => (saving ? undefined : setOpen(false))}
          testId="project-commercial-data-modal"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg px-4 py-2 text-sm" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="sr-only">Cliente</legend>
              <p className="text-xs text-muted-foreground">
                Atual: {detail.customerName}
                {detail.customerDocument ? ` · ${formatTaxId(detail.customerDocument)}` : ""}
                {linked ? " (vinculado ao cadastro)" : " (sem vínculo)"}
              </p>
              <ProjectCustomerLookupField
                value={selection}
                onChange={(v) => {
                  setSelection(v);
                  if (v) setUnlink(false);
                }}
                disabled={saving}
                commitDraftOnBlur={false}
              />
              <p className="text-xs text-muted-foreground">
                Escolha um cliente do cadastro para vincular. Nome e CNPJ passam a vir do cadastro oficial.
              </p>
              {linked && !selection ? (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={unlink} onChange={(e) => setUnlink(e.target.checked)} />
                  Desvincular do cadastro (mantém o nome e o documento atuais como texto)
                </label>
              ) : null}
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-semibold">Condições comerciais</legend>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Validade da proposta (dias)</span>
                <input type="number" min={0} className={input} value={draft.proposalValidityDays} onChange={set("proposalValidityDays")} />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Condição de pagamento</span>
                <input className={input} placeholder="Ex.: 28 dias DDL" value={draft.paymentTerms} onChange={set("paymentTerms")} />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Prazo de entrega (dias)</span>
                <input type="number" min={0} className={input} value={draft.deliveryTimeDays} onChange={set("deliveryTimeDays")} />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Local de entrega</span>
                <input className={input} value={draft.deliveryLocation} onChange={set("deliveryLocation")} />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Frete</span>
                <select className={input} value={draft.freightCondition} onChange={set("freightCondition")}>
                  <option value="">{COMMERCIAL_TERM_UNDEFINED}</option>
                  {PROJECT_FREIGHT_CONDITIONS.map((f) => (
                    <option key={f} value={f}>
                      {PROJECT_FREIGHT_LABELS[f]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Prazo desejado pelo cliente</span>
                <input type="date" className={input} value={draft.desiredDeadline} onChange={set("desiredDeadline")} />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Prioridade</span>
                <select className={input} value={draft.priority} onChange={set("priority")}>
                  <option value="">{COMMERCIAL_TERM_UNDEFINED}</option>
                  {PROJECT_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PROJECT_PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Aplicação</span>
                <input className={input} placeholder="Onde a peça será usada" value={draft.application} onChange={set("application")} />
              </label>
            </fieldset>

            <label className="block space-y-1 text-xs">
              <span className="font-semibold text-foreground">Observações ao cliente</span>
              <span className="block text-muted-foreground">
                Aparecem na Proposta Cliente. As observações internas ficam no Histórico e nunca vão ao cliente.
              </span>
              <textarea className={`${input} min-h-[90px]`} value={draft.clientNotes} onChange={set("clientNotes")} />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </ProjectModalShell>
      ) : null}
    </section>
  );
}
