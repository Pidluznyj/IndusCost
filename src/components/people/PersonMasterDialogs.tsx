/**
 * Pessoas 360° — diálogos do cadastro mestre: criar/editar Pessoa, mudar situação,
 * habilitar acesso (criar conta), regularizar conta existente e habilitar motorista.
 * Toda escrita passa por prévia/justificativa; nada aqui concede papel ou permissão.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  attachAccount,
  createPerson,
  enableAccess,
  enableDriver,
  fetchCandidateAccounts,
  fetchPersonIdentity,
  previewAttachAccount,
  previewDriverEnable,
  setPersonStatus,
  updatePerson,
  type AttachPreview,
  type CandidateAccount,
  type DriverEnablePreview,
  type DriverFleetForm,
  type PersonIdentityForm,
} from "@/src/lib/people/peopleClient";

export function DialogShell({ title, onClose, children, testId, wide }: { title: string; onClose: () => void; children: React.ReactNode; testId: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn("w-full rounded-2xl border border-border bg-card p-4 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto", wide ? "max-w-3xl" : "max-w-2xl")} data-testid={testId}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-2 py-1 text-xs" aria-label="Fechar">
            Fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReasonField({ value, onChange, testId, label = "Justificativa (obrigatória)" }: { value: string; onChange: (v: string) => void; testId: string; label?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Por que esta operação está correta? Fica na auditoria." data-testid={testId} />
    </label>
  );
}

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
      {error}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const primaryBtn = "rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50";
const secondaryBtn = "rounded-lg border border-border px-3 py-2 text-xs";

const EMPTY_FORM: PersonIdentityForm = { displayName: "", socialName: null, corporateEmail: null, personalEmail: null, cpf: null, phone: null };

/** Criar Pessoa direta (sem colaborador) ou editar dados canônicos. */
export function PersonFormDialog({ personId, onClose, onDone }: { personId: string | null; onClose: () => void; onDone: (id: string) => void }) {
  const editing = Boolean(personId);
  const [form, setForm] = useState<PersonIdentityForm>(EMPTY_FORM);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(editing);
  const [piiHidden, setPiiHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!personId) return;
    let alive = true;
    fetchPersonIdentity(personId)
      .then((p) => {
        if (!alive) return;
        setForm({ displayName: p.displayName, socialName: p.socialName, corporateEmail: p.corporateEmail, personalEmail: p.personalEmail, cpf: p.cpf, phone: p.phone });
        setPiiHidden(!p.cpf && Boolean(p.cpfMasked));
        if (!p.editable) setError("Esta pessoa foi unificada em outra e não pode ser editada.");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Não foi possível carregar a pessoa."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [personId]);

  const set = (k: keyof PersonIdentityForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value === "" ? (k === "displayName" ? "" : null) : e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (editing && personId) {
        const body: Partial<PersonIdentityForm> & { reason?: string } = { ...form, reason: reason.trim() || undefined };
        // Sem permissão de PII os campos sensíveis vêm vazios: não enviar para não apagar.
        if (piiHidden) {
          delete body.cpf;
          delete body.corporateEmail;
          delete body.personalEmail;
          delete body.phone;
        }
        await updatePerson(personId, body);
        onDone(personId);
      } else {
        const created = await createPerson(form);
        onDone(created.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title={editing ? "Editar dados da identidade" : "Nova pessoa"} onClose={onClose} testId="person-form-dialog">
      <p className="text-xs text-muted-foreground">
        A Pessoa é a origem oficial de nome, nome social, CPF, e-mails e telefone. Colaborador, conta, motorista e comissionável guardam cópias para seus fins e não são reescritos por esta tela.
      </p>
      {loading ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Nome (civil)"><input className={inputCls} value={form.displayName} onChange={set("displayName")} data-testid="person-form-name" /></Field>
          <Field label="Nome social"><input className={inputCls} value={form.socialName ?? ""} onChange={set("socialName")} data-testid="person-form-social" /></Field>
          <Field label={piiHidden ? "CPF (oculto: sem permissão de dados pessoais)" : "CPF"}><input className={inputCls} value={form.cpf ?? ""} onChange={set("cpf")} disabled={piiHidden} placeholder="000.000.000-00" data-testid="person-form-cpf" /></Field>
          <Field label="Telefone"><input className={inputCls} value={form.phone ?? ""} onChange={set("phone")} disabled={piiHidden} data-testid="person-form-phone" /></Field>
          <Field label="E-mail principal (corporativo)"><input className={inputCls} type="email" value={form.corporateEmail ?? ""} onChange={set("corporateEmail")} disabled={piiHidden} data-testid="person-form-email" /></Field>
          <Field label="E-mail pessoal"><input className={inputCls} type="email" value={form.personalEmail ?? ""} onChange={set("personalEmail")} disabled={piiHidden} data-testid="person-form-personal-email" /></Field>
        </div>
      )}
      {editing ? <ReasonField value={reason} onChange={setReason} testId="person-form-reason" label="Motivo da alteração (opcional, fica na auditoria)" /> : null}
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryBtn}>Cancelar</button>
        <button type="button" disabled={busy || loading || !form.displayName.trim()} onClick={() => void submit()} className={primaryBtn} data-testid="person-form-submit">
          {busy ? "Salvando…" : editing ? "Salvar" : "Criar pessoa"}
        </button>
      </div>
    </DialogShell>
  );
}

/** Inativar/reativar identidade — nunca desliga colaborador nem revoga conta. */
export function PersonStatusDialog({ personId, nextStatus, onClose, onDone }: { personId: string; nextStatus: "ACTIVE" | "INACTIVE"; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inactivating = nextStatus === "INACTIVE";
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await setPersonStatus(personId, { status: nextStatus, reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível alterar a situação.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogShell title={inactivating ? "Inativar identidade" : "Reativar identidade"} onClose={onClose} testId="person-status-dialog">
      <p className="text-xs text-muted-foreground">
        {inactivating
          ? "Só é possível inativar uma Pessoa sem vínculos ativos (conta ativa, colaborador ativo ou motorista não inativo). Inativar a identidade não desliga ninguém nem revoga acesso: essas regras são separadas e explícitas."
          : "Reativar a identidade permite voltar a vincular cadastros a ela. A conta, o colaborador e o motorista continuam exatamente como estão."}
      </p>
      <ReasonField value={reason} onChange={setReason} testId="person-status-reason" />
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryBtn}>Cancelar</button>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void confirm()} className={cn(primaryBtn, inactivating && "bg-red-600")} data-testid="person-status-confirm">
          {busy ? "Aplicando…" : inactivating ? "Inativar" : "Reativar"}
        </button>
      </div>
    </DialogShell>
  );
}

/** Habilitar acesso ao IndusCost: cria a conta ligada a ESTA Pessoa (papel VIEWER, sem permissões). */
export function EnableAccessDialog({ personId, suggestedName, suggestedEmail, hasEmployee, onClose, onDone }: { personId: string; suggestedName: string; suggestedEmail: string | null; hasEmployee: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(suggestedName);
  const [email, setEmail] = useState(suggestedEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await enableAccess(personId, { name: name.trim(), email: email.trim(), password });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível criar a conta.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogShell title="Habilitar acesso ao IndusCost" onClose={onClose} testId="person-enable-access-dialog">
      <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
        <li>A conta nasce ligada a esta Pessoa{hasEmployee ? " e ao colaborador vinculado" : " (sem colaborador: módulos de RH, Desempenho e Competências permanecem fechados)"}.</li>
        <li>Papel inicial <strong>VIEWER</strong>, sem perfil e sem permissões — o perfil de acesso é definido depois em Configurações › Usuários.</li>
        <li>A senha é temporária: o usuário precisará trocá-la no primeiro acesso. Vínculo comercial (vendedor Nomus) não é definido aqui.</li>
      </ul>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Nome de exibição"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} data-testid="enable-access-name" /></Field>
        <Field label="E-mail de login"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="enable-access-email" /></Field>
        <Field label="Senha inicial (temporária)"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" data-testid="enable-access-password" /></Field>
      </div>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryBtn}>Cancelar</button>
        <button type="button" disabled={busy || !email.trim() || password.length < 8} onClick={() => void confirm()} className={primaryBtn} data-testid="enable-access-confirm">
          {busy ? "Criando…" : "Criar conta"}
        </button>
      </div>
    </DialogShell>
  );
}

const EVIDENCE_LABEL: Record<string, string> = {
  EMPLOYEE_LINK: "conta já ligada ao colaborador desta pessoa (evidência forte)",
  EMAIL_EXACT: "e-mail igual (só sugestão — confirme)",
  MANUAL: "sem evidência automática — decisão humana",
};

/** Regularizar vínculo existente: escolher a conta legada → prévia → confirmar. */
export function AttachAccountDialog({ personId, initialAccountId, runWithStepUp, onClose, onDone }: { personId: string; initialAccountId?: string | null; runWithStepUp?: (fn: () => Promise<void>) => Promise<boolean>; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<CandidateAccount[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialAccountId ?? null);
  const [preview, setPreview] = useState<AttachPreview | null>(null);
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchCandidateAccounts(personId, q)
      .then((r) => alive && setCandidates(r.items))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Não foi possível listar contas."));
    return () => {
      alive = false;
    };
  }, [personId, q]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreview(null);
    setError(null);
    previewAttachAccount(personId, { appUserId: selected })
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Não foi possível pré-visualizar."));
    return () => {
      alive = false;
    };
  }, [personId, selected]);

  async function confirm() {
    if (!preview || !selected) return;
    setBusy(true);
    setError(null);
    const run = async () => {
      await attachAccount(personId, { appUserId: selected, expected: preview.expected, confirmEmailMismatch: confirmMismatch, reason: reason.trim() });
      onDone();
    };
    try {
      if (runWithStepUp && preview.decision.ok && preview.decision.touchesSuperAdmin) {
        // 403 ADMIN_ELEVATION_REQUIRED abre o step-up; a confirmação reexecuta `run`.
        await runWithStepUp(run);
      } else {
        await run();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível regularizar o vínculo.");
    } finally {
      setBusy(false);
    }
  }

  const decisionOk = preview?.decision.ok === true;
  const blocked = preview && !preview.decision.ok ? preview.decision : null;

  return (
    <DialogShell title="Regularizar vínculo existente — conta IndusCost" onClose={onClose} testId="person-attach-dialog" wide>
      <p className="text-xs text-muted-foreground">
        Liga uma conta já existente a esta Pessoa (e ao colaborador, quando houver). Nada mais muda na conta: login, senha, papel, permissões, sessões e vínculo comercial ficam como estão. Nunca vincule por semelhança de nome.
      </p>
      {!selected ? (
        <div className="space-y-2">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conta por nome ou e-mail (contas sem Pessoa)" className={inputCls} data-testid="attach-search" />
          <ul className="max-h-56 overflow-y-auto divide-y divide-border rounded-lg border border-border" data-testid="attach-candidates">
            {candidates == null ? (
              <li className="p-2 text-xs text-muted-foreground">Carregando…</li>
            ) : candidates.length === 0 ? (
              <li className="p-2 text-xs text-muted-foreground">Nenhuma conta sem Pessoa encontrada.</li>
            ) : (
              candidates.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-xs">
                  <span>
                    <strong className="text-foreground">{c.name}</strong> · {c.email ?? c.emailMasked ?? "—"} · {c.role}
                    {!c.isActive ? " · inativa" : ""}
                    {c.employee ? ` · colaborador: ${c.employee.name}` : " · sem colaborador"}
                    <br />
                    <span className={cn(c.evidence === "EMPLOYEE_LINK" ? "text-emerald-700" : c.evidence === "EMAIL_EXACT" ? "text-amber-700" : "text-muted-foreground")}>{EVIDENCE_LABEL[c.evidence]}</span>
                  </span>
                  <button type="button" onClick={() => setSelected(c.id)} className="rounded border border-primary px-2 py-0.5 font-medium text-primary" data-testid={`attach-pick-${c.id}`}>
                    Escolher
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : !preview && !error ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Preparando prévia…</p>
      ) : preview ? (
        <div className="space-y-2 text-xs" data-testid="attach-preview">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="rounded-lg border border-border p-2">
              <p className="font-semibold text-foreground">Conta</p>
              <p>{preview.account.name} · {preview.account.emailMasked ?? "—"}</p>
              <p>{preview.account.role}{preview.account.isActive ? "" : " · inativa"}</p>
              <p>Pessoa atual: {preview.account.currentPerson ? preview.account.currentPerson.displayName : "— (sem Pessoa)"}</p>
              <p>Colaborador atual: {preview.account.currentEmployee ? preview.account.currentEmployee.name : "—"}</p>
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="font-semibold text-foreground">Colaborador</p>
              {preview.employee ? (
                <>
                  <p>{preview.employee.name} · {preview.employee.status}</p>
                  <p>E-mail corporativo: {preview.employee.emailMasked ?? "—"}</p>
                  <p>Pessoa do colaborador: {preview.employee.personId ? (preview.employee.personId === preview.targetPerson.id ? "esta" : "outra ⚠") : "— (será preenchida)"}</p>
                </>
              ) : (
                <p>Sem colaborador (conta só com identidade).</p>
              )}
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
              <p className="font-semibold text-foreground">Pessoa de destino</p>
              <p>{preview.targetPerson.displayName} · {preview.targetPerson.status}</p>
              <p>Evidência: {preview.evidence === "MANUAL" ? "decisão humana (e-mails divergentes)" : preview.evidence === "EMAIL_EXACT" ? "e-mail igual" : "—"}</p>
            </div>
          </div>
          {blocked ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800" data-testid="attach-blocked">
              <AlertTriangle className="inline h-3.5 w-3.5" /> {blocked.message} ({blocked.code})
            </p>
          ) : (
            <>
              <p className="font-semibold text-foreground">O que muda</p>
              <ul className="list-disc pl-5">{preview.changes.map((c) => <li key={c}>{c}</li>)}</ul>
              <p className="font-semibold text-foreground">Não muda</p>
              <ul className="list-disc pl-5">{preview.unchanged.map((c) => <li key={c}>{c}</li>)}</ul>
              {preview.emailMismatch ? (
                <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900">
                  <input type="checkbox" checked={confirmMismatch} onChange={(e) => setConfirmMismatch(e.target.checked)} data-testid="attach-confirm-mismatch" />
                  <span>O e-mail de login difere do e-mail cadastrado no colaborador/Pessoa. Confirmo, por outros dados (colaborador vinculado, CPF, verificação pessoal), que é a mesma pessoa. O login não será alterado.</span>
                </label>
              ) : null}
              {preview.decision.ok && preview.decision.touchesSuperAdmin ? (
                <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Conta de Super Administrador: exige Super Administrador com confirmação de senha (step-up).</p>
              ) : null}
            </>
          )}
          <button type="button" onClick={() => { setSelected(null); setPreview(null); setError(null); }} className="text-[11px] underline">Escolher outra conta</button>
        </div>
      ) : null}
      {selected && decisionOk ? <ReasonField value={reason} onChange={setReason} testId="attach-reason" /> : null}
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryBtn}>Cancelar</button>
        <button type="button" disabled={busy || !decisionOk || reason.trim().length < 5 || (Boolean(preview?.emailMismatch) && !confirmMismatch)} onClick={() => void confirm()} className={primaryBtn} data-testid="attach-confirm">
          {busy ? "Regularizando…" : "Confirmar vínculo"}
        </button>
      </div>
    </DialogShell>
  );
}

const DRIVER_ACTION_LABEL: Record<string, string> = {
  CREATE: "Criar cadastro de motorista ligado a esta pessoa",
  LINK: "Vincular motorista já existente (mesmo CPF, sem Pessoa)",
  REACTIVATE: "Reativar motorista inativo e vincular",
  ALREADY_ENABLED: "Já habilitado",
  CONFLICT: "Conflito: motorista ligado a outra Pessoa",
  BLOCKED: "Bloqueado",
};

/** Habilitar motorista: prévia (ação proposta) → campos da Frota → justificativa → confirmar. */
export function EnableDriverDialog({ personId, onClose, onDone }: { personId: string; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<DriverEnablePreview | null>(null);
  const [form, setForm] = useState<DriverFleetForm>({ cnhNumber: null, cnhCategory: null, cnhExpirationDate: null, unit: null, costCenter: null, notes: null });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    previewDriverEnable(personId)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Não foi possível pré-visualizar."));
    return () => {
      alive = false;
    };
  }, [personId]);

  const action = preview?.plan.action ?? null;
  const canConfirm = action === "CREATE" || action === "LINK" || action === "REACTIVATE";
  const set = (k: keyof DriverFleetForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value || null }));

  async function confirm() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await enableDriver(personId, { ...form, action, reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível habilitar o motorista.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title="Habilitar motorista" onClose={onClose} testId="person-enable-driver-dialog">
      {!preview && !error ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Verificando CPF e motoristas existentes…</p>
      ) : preview ? (
        <div className="space-y-2 text-xs" data-testid="driver-preview">
          <p>
            <strong className="text-foreground">{preview.person.displayName}</strong> · CPF {preview.person.cpfMasked ?? "—"} · {preview.person.status}
          </p>
          <p>Da Pessoa: {preview.fromPerson.join(", ")}. Da Frota: {preview.fleetFields.join(", ")}.</p>
          <p className={cn("rounded-lg border p-2", canConfirm ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800")} data-testid="driver-plan" data-action={preview.plan.action}>
            Ação proposta: <strong>{DRIVER_ACTION_LABEL[preview.plan.action] ?? preview.plan.action}</strong>
            {preview.plan.blockers.length > 0 ? (
              <ul className="list-disc pl-5 mt-1">{preview.plan.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
            ) : null}
          </p>
          {preview.candidates.length > 0 ? (
            <ul className="list-disc pl-5">
              {preview.candidates.map((c) => (
                <li key={c.id}>
                  {c.name} · {c.status} · CPF {c.cpfMasked ?? "—"} {c.linkedToThisPerson ? "· ligado a esta pessoa" : c.linkedToOtherPerson ? "· ligado a OUTRA pessoa" : "· sem Pessoa"}{c.hasCnh ? " · CNH cadastrada" : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {action === "CREATE" ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Field label="CNH (número)"><input className={inputCls} value={form.cnhNumber ?? ""} onChange={set("cnhNumber")} data-testid="driver-cnh" /></Field>
              <Field label="Categoria">
                <select className={inputCls} value={form.cnhCategory ?? ""} onChange={set("cnhCategory")} data-testid="driver-cnh-category">
                  <option value="">—</option>
                  {["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Validade da CNH"><input className={inputCls} type="date" value={form.cnhExpirationDate ?? ""} onChange={set("cnhExpirationDate")} data-testid="driver-cnh-expiration" /></Field>
              <Field label="Unidade"><input className={inputCls} value={form.unit ?? ""} onChange={set("unit")} /></Field>
              <Field label="Centro de custo"><input className={inputCls} value={form.costCenter ?? ""} onChange={set("costCenter")} /></Field>
              <Field label="Observações"><input className={inputCls} value={form.notes ?? ""} onChange={set("notes")} /></Field>
            </div>
          ) : null}
          {canConfirm ? <p className="text-[11px] text-muted-foreground">O motorista nasce/permanece como PENDENTE; a autorização para dirigir continua sendo feita na Frota após conferência da CNH.</p> : null}
        </div>
      ) : null}
      {canConfirm ? <ReasonField value={reason} onChange={setReason} testId="driver-reason" /> : null}
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryBtn}>Cancelar</button>
        <button type="button" disabled={busy || !canConfirm || reason.trim().length < 5} onClick={() => void confirm()} className={primaryBtn} data-testid="driver-confirm">
          {busy ? "Aplicando…" : action === "LINK" ? "Vincular motorista" : action === "REACTIVATE" ? "Reativar e vincular" : "Criar motorista"}
        </button>
      </div>
    </DialogShell>
  );
}

export function PersonLinkTo({ id, label }: { id: string; label: string }) {
  return <Link to={`/people/${id}`} className="underline">{label}</Link>;
}
