/**
 * Ficha funcional › Certificados. Junta, numa lista só:
 *   - os certificados emitidos pelo sistema nos treinamentos (Competências; conteúdo congelado, imprimível);
 *   - os certificados externos anexados pelo RH (arquivo no dossiê + dados do curso).
 * Cada origem respeita a própria permissão: sem acesso a uma delas, a outra continua aparecendo.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Award, Download, Eye, FileUp, Loader2, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { fetchCompetencyCatalog, fetchEmployeeTrainingCertificates } from "@/src/lib/competencies/competencyClient";
import type { CompetencyDto } from "@/src/lib/competencies/competencyTypes";
import { printTrainingCertificates } from "@/src/components/competencies/certificate/trainingCertificatePrint";
import {
  CERTIFICATE_VALIDITY_LABELS,
  EXTERNAL_CERTIFICATE_INSTITUTION_MAX,
  EXTERNAL_CERTIFICATE_NOTES_MAX,
  EXTERNAL_CERTIFICATE_TITLE_MAX,
  sortEmployeeCertificates,
  summarizeEmployeeCertificates,
  type CertificateValidity,
  type EmployeeCertificateItemDto,
} from "@/src/lib/hrEmployeeCertificates";
import { HttpError } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { downloadEmployeeDocument, profileDelete, profileFetchJson, profilePatchJson } from "./profileClient";
import { PROFILE_INPUT_CLASS, PROFILE_LABEL_CLASS, ProfileState, formatProfileDate } from "./profileUi";

type SourceState<T> = { status: "off" } | { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };
type Filter = "ALL" | "SYSTEM" | "UPLOAD";

const VALIDITY_TONE: Record<CertificateValidity, string> = {
  NO_EXPIRY: "bg-muted text-muted-foreground",
  VALID: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  EXPIRING: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  EXPIRED: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError && (error.status === 403 || error.status === 404)) return "Sem acesso a esta origem de certificados.";
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatHours(hours: number | null): string | null {
  if (hours == null) return null;
  return `${Number.isInteger(hours) ? hours : String(hours).replace(".", ",")}h`;
}

function Kpi({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

type FormState = {
  title: string;
  institution: string;
  workloadHours: string;
  completedOn: string;
  expiresOn: string;
  competencyId: string;
  notes: string;
};

const EMPTY_FORM: FormState = { title: "", institution: "", workloadHours: "", completedOn: "", expiresOn: "", competencyId: "", notes: "" };

function formFrom(item: EmployeeCertificateItemDto): FormState {
  return {
    title: item.title,
    institution: item.issuer,
    workloadHours: item.workloadHours == null ? "" : String(item.workloadHours).replace(".", ","),
    completedOn: item.completedOn,
    expiresOn: item.expiresOn ?? "",
    competencyId: item.competencyId ?? "",
    notes: item.notes ?? "",
  };
}

function CertificateForm({
  employeeId,
  editing,
  competencies,
  onDone,
  onCancel,
}: {
  employeeId: string;
  editing: EmployeeCertificateItemDto | null;
  competencies: CompetencyDto[] | null;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => (editing ? formFrom(editing) : EMPTY_FORM));
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const canSave = Boolean(form.title.trim() && form.institution.trim() && form.completedOn && (editing || file));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await profilePatchJson(`/api/employees/${employeeId}/certificates/${editing.id}`, { ...form });
        onDone("Certificado atualizado.");
      } else {
        const fd = new FormData();
        fd.append("file", file!);
        for (const [k, v] of Object.entries(form) as [keyof FormState, string][]) if (v.trim()) fd.append(k, v.trim());
        await profileFetchJson(`/api/employees/${employeeId}/certificates`, { method: "POST", body: fd });
        onDone("Certificado anexado.");
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Não foi possível salvar o certificado.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-primary/30 bg-primary/[0.03] p-4" data-testid="people-certificate-form">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{editing ? "Editar certificado" : "Anexar certificado externo"}</h4>
        <button type="button" onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Fechar formulário">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {!editing ? (
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={PROFILE_LABEL_CLASS}>Arquivo do certificado (PDF, JPG ou PNG, até 10 MB) *</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="people-certificate-file"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={PROFILE_LABEL_CLASS}>Nome do curso *</span>
          <input className={PROFILE_INPUT_CLASS} maxLength={EXTERNAL_CERTIFICATE_TITLE_MAX} value={form.title} onChange={(e) => set({ title: e.target.value })} data-testid="people-certificate-title" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={PROFILE_LABEL_CLASS}>Instituição *</span>
          <input className={PROFILE_INPUT_CLASS} maxLength={EXTERNAL_CERTIFICATE_INSTITUTION_MAX} value={form.institution} onChange={(e) => set({ institution: e.target.value })} data-testid="people-certificate-institution" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={PROFILE_LABEL_CLASS}>Carga horária (h)</span>
          <input className={PROFILE_INPUT_CLASS} inputMode="decimal" placeholder="Ex.: 16" value={form.workloadHours} onChange={(e) => set({ workloadHours: e.target.value })} data-testid="people-certificate-hours" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={PROFILE_LABEL_CLASS}>Conclusão *</span>
          <input type="date" className={PROFILE_INPUT_CLASS} value={form.completedOn} onChange={(e) => set({ completedOn: e.target.value })} data-testid="people-certificate-completed" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={PROFILE_LABEL_CLASS}>Validade (opcional)</span>
          <input type="date" className={PROFILE_INPUT_CLASS} value={form.expiresOn} onChange={(e) => set({ expiresOn: e.target.value })} data-testid="people-certificate-expires" />
        </label>
        {competencies ? (
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={PROFILE_LABEL_CLASS}>Competência relacionada (opcional, informativa)</span>
            <select className={PROFILE_INPUT_CLASS} value={form.competencyId} onChange={(e) => set({ competencyId: e.target.value })}>
              <option value="">Nenhuma</option>
              {competencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={PROFILE_LABEL_CLASS}>Observações</span>
          <textarea className={cn(PROFILE_INPUT_CLASS, "min-h-[64px]")} maxLength={EXTERNAL_CERTIFICATE_NOTES_MAX} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!canSave || saving}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-testid="people-certificate-save"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {editing ? "Salvar alterações" : "Anexar certificado"}
        </button>
      </div>
    </form>
  );
}

export function PeopleCertificatesTab({
  employeeId,
  canViewUploads,
  canManageUploads,
  canViewSystem,
  canViewCompetencyCatalog,
}: {
  employeeId: string;
  canViewUploads: boolean;
  canManageUploads: boolean;
  canViewSystem: boolean;
  canViewCompetencyCatalog: boolean;
}) {
  const [system, setSystem] = useState<SourceState<EmployeeCertificateItemDto[]>>({ status: canViewSystem ? "loading" : "off" });
  const [uploads, setUploads] = useState<SourceState<EmployeeCertificateItemDto[]>>({ status: canViewUploads ? "loading" : "off" });
  const [competencies, setCompetencies] = useState<CompetencyDto[] | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [form, setForm] = useState<{ editing: EmployeeCertificateItemDto | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const tasks: Promise<void>[] = [];
      if (canViewSystem) {
        tasks.push(
          fetchEmployeeTrainingCertificates(employeeId, signal)
            .then((r) => void (!signal?.aborted && setSystem({ status: "ready", data: r.items })))
            .catch((err) => void (!signal?.aborted && setSystem({ status: "error", message: errorMessage(err, "Não foi possível carregar os certificados do sistema.") }))),
        );
      }
      if (canViewUploads) {
        tasks.push(
          (profileFetchJson(`/api/employees/${employeeId}/certificates`, { signal }) as Promise<{ items: EmployeeCertificateItemDto[] }>)
            .then((r) => void (!signal?.aborted && setUploads({ status: "ready", data: r.items })))
            .catch((err) => void (!signal?.aborted && setUploads({ status: "error", message: errorMessage(err, "Não foi possível carregar os certificados anexados.") }))),
        );
      }
      await Promise.all(tasks);
    },
    [employeeId, canViewSystem, canViewUploads],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    if (!canManageUploads || !canViewCompetencyCatalog || !form || competencies) return;
    fetchCompetencyCatalog()
      .then((r) => setCompetencies(r.competencies)) // o catálogo já devolve só as ativas
      .catch(() => setCompetencies([]));
  }, [canManageUploads, canViewCompetencyCatalog, form, competencies]);

  const items = useMemo(
    () =>
      sortEmployeeCertificates([
        ...(system.status === "ready" ? system.data : []),
        ...(uploads.status === "ready" ? uploads.data : []),
      ]),
    [system, uploads],
  );
  const summary = summarizeEmployeeCertificates(items);
  const shown = items.filter((i) => filter === "ALL" || i.origin === filter);

  if (!canViewSystem && !canViewUploads) {
    return <ProfileState kind="forbidden" message="🔒 Sem permissão para ver certificados deste colaborador." />;
  }
  const loading = system.status === "loading" || uploads.status === "loading";

  const act = async (key: string, fn: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice({ kind: "ok", text: msg });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error && err.message ? err.message : "Não foi possível concluir a ação." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="people-certificates-tab">
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="people-certificates-kpis">
        <Kpi label="Certificados" value={summary.total} />
        <Kpi label="Horas de formação" value={formatHours(summary.hours) ?? "0h"} />
        <Kpi label="A vencer (30 dias)" value={summary.expiring} tone={summary.expiring > 0 ? "text-amber-700" : undefined} />
        <Kpi label="Vencidos" value={summary.expired} tone={summary.expired > 0 ? "text-rose-700" : undefined} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="radiogroup" aria-label="Origem">
          {(
            [
              ["ALL", `Todos (${summary.total})`],
              ["SYSTEM", `Treinamentos do sistema (${summary.system})`],
              ["UPLOAD", `Anexados (${summary.upload})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                filter === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {canManageUploads && !form ? (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setForm({ editing: null });
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            data-testid="people-certificate-add"
          >
            <Plus className="h-4 w-4" aria-hidden /> Anexar certificado
          </button>
        ) : null}
      </div>

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={cn(
            "mb-4 rounded-lg border px-3 py-2 text-sm",
            notice.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          {notice.text}
        </p>
      ) : null}

      {form ? (
        <React.Fragment key={form.editing?.key ?? "new"}>
        <CertificateForm
          employeeId={employeeId}
          editing={form.editing}
          competencies={canViewCompetencyCatalog ? competencies : null}
          onCancel={() => setForm(null)}
          onDone={(msg) => {
            setForm(null);
            setNotice({ kind: "ok", text: msg });
            void load();
          }}
        />
        </React.Fragment>
      ) : null}

      {system.status === "error" || uploads.status === "error" ? (
        <div className="mb-4 space-y-1 text-xs text-muted-foreground">
          {system.status === "error" ? <p>Treinamentos do sistema: {system.message}</p> : null}
          {uploads.status === "error" ? <p>Anexados: {uploads.message}</p> : null}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <ProfileState kind="loading" message="Carregando certificados…" />
      ) : shown.length === 0 ? (
        <ProfileState
          kind="empty"
          message={
            filter === "SYSTEM"
              ? "Nenhum certificado emitido pelos treinamentos do sistema."
              : filter === "UPLOAD"
                ? "Nenhum certificado externo anexado."
                : "Nenhum certificado registrado para este colaborador."
          }
        />
      ) : (
        <ul className="space-y-2" data-testid="people-certificates-list">
          {shown.map((c) => {
            const hours = formatHours(c.workloadHours);
            const isSystem = c.origin === "SYSTEM";
            return (
              <li
                key={c.key}
                className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-center"
                data-testid="people-certificate-item"
                data-origin={c.origin}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    isSystem ? "bg-primary/10 text-primary" : "bg-violet-50 text-violet-700",
                  )}
                  aria-hidden
                >
                  {isSystem ? <Award className="h-5 w-5" /> : <FileUp className="h-5 w-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">{c.title}</p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        isSystem ? "bg-primary/10 text-primary" : "bg-violet-50 text-violet-700",
                      )}
                    >
                      {isSystem ? "Sistema" : "Anexado"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {c.issuer}
                    {c.number ? <span className="font-mono"> · {c.number}</span> : null}
                    {c.competencyName ? ` · ${c.competencyName}` : ""}
                  </p>
                  {c.notes ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.notes}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm sm:justify-end">
                  {hours ? (
                    <span className="tabular-nums">
                      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Carga</span>
                      {hours}
                    </span>
                  ) : null}
                  <span className="tabular-nums">
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Conclusão</span>
                    {formatProfileDate(c.completedOn)}
                  </span>
                  <span>
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                      {c.expiresOn ? `Validade ${formatProfileDate(c.expiresOn)}` : "Validade"}
                    </span>
                    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", VALIDITY_TONE[c.validity])}>
                      {CERTIFICATE_VALIDITY_LABELS[c.validity]}
                    </span>
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1 sm:ml-2">
                  {isSystem && c.trainingId ? (
                    <IconButton
                      label="Imprimir certificado"
                      busy={busy === `print:${c.id}`}
                      onClick={() => void act(`print:${c.id}`, async () => (await printTrainingCertificates(c.trainingId!, [c.id], `Certificado ${c.number ?? ""}`), null))}
                    >
                      <Printer className="h-4 w-4" aria-hidden />
                    </IconButton>
                  ) : null}
                  {!isSystem && c.downloadUrl ? (
                    <>
                      <IconButton label="Ver arquivo" onClick={() => window.open(`${c.downloadUrl}?inline=1`, "_blank", "noopener")}>
                        <Eye className="h-4 w-4" aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Baixar arquivo"
                        busy={busy === `dl:${c.id}`}
                        onClick={() => void act(`dl:${c.id}`, async () => (await downloadEmployeeDocument(c.downloadUrl!, c.fileName ?? c.title), null))}
                      >
                        <Download className="h-4 w-4" aria-hidden />
                      </IconButton>
                    </>
                  ) : null}
                  {!isSystem && canManageUploads ? (
                    <>
                      <IconButton label="Editar" onClick={() => setForm({ editing: c })}>
                        <Pencil className="h-4 w-4" aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Excluir"
                        danger
                        busy={busy === `del:${c.id}`}
                        onClick={() => {
                          if (!window.confirm(`Excluir o certificado "${c.title}"? O arquivo anexado também é removido do dossiê.`)) return;
                          void act(`del:${c.id}`, async () => {
                            await profileDelete(`/api/employees/${employeeId}/certificates/${c.id}`);
                            await load();
                            return "Certificado excluído.";
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </IconButton>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  busy,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors disabled:opacity-50",
        danger ? "hover:bg-rose-50 hover:text-rose-700" : "hover:bg-muted hover:text-foreground",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : children}
    </button>
  );
}
