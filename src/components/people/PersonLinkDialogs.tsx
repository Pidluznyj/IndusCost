import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  executeMerge,
  previewMerge,
  previewRelink,
  relinkEntity,
  revertMerge,
  unlinkEntity,
  type LinkEntityKind,
  type MergePreview,
  type RelinkPreview,
} from "@/src/lib/people/peopleClient";

const KIND_LABEL: Record<LinkEntityKind, string> = {
  employee: "Funcionário",
  app_user: "Usuário IndusCost",
  fleet_driver: "Motorista",
  commission_person: "Comissionável",
};

const EVIDENCE_LABEL: Record<string, string> = {
  CPF_EXACT: "CPF validado igual (evidência forte)",
  EMAIL_EXACT: "e-mail igual (não prova identidade sozinho — confirme)",
  MANUAL: "sem evidência automática — decisão humana",
};

function Shell({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-4 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto" data-testid={testId}>
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

function ReasonField({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Justificativa (obrigatória)</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Por que esta correção está correta? Fica na auditoria." data-testid={testId} />
    </label>
  );
}

/** Vincular/corrigir um cadastro para ESTA pessoa (prévia → justificativa → confirmar). */
export function RelinkDialog({ personId, entityKind, entityId, onClose, onDone }: { personId: string; entityKind: LinkEntityKind; entityId: string; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<RelinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    previewRelink(personId, { entityKind, entityId })
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Não foi possível pré-visualizar."));
    return () => {
      alive = false;
    };
  }, [personId, entityKind, entityId]);

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await relinkEntity(personId, { entityKind, entityId, expectedCurrentPersonId: preview.expectedCurrentPersonId, reason });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao vincular.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={`${preview?.currentPerson ? "Corrigir vínculo" : "Vincular"} — ${KIND_LABEL[entityKind]}`} onClose={onClose} testId="person-relink-dialog">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
      {!preview ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Pré-visualizando…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <table className="w-full text-xs">
            <tbody>
              <tr><td className="py-1 pr-3 text-muted-foreground">Cadastro</td><td className="py-1 font-medium">{preview.entity.label}{preview.entity.detail ? ` · ${preview.entity.detail}` : ""}{preview.entity.emailMasked ? ` · ${preview.entity.emailMasked}` : ""}</td></tr>
              <tr><td className="py-1 pr-3 text-muted-foreground">Pessoa atual</td><td className="py-1">{preview.currentPerson ? `${preview.currentPerson.displayName} (${preview.currentPerson.id.slice(0, 8)}…)` : "— nenhuma"}</td></tr>
              <tr><td className="py-1 pr-3 text-muted-foreground">Pessoa de destino</td><td className="py-1 font-medium">{preview.targetPerson.displayName} ({preview.targetPerson.id.slice(0, 8)}…)</td></tr>
              <tr><td className="py-1 pr-3 text-muted-foreground">Evidência</td><td className="py-1">{EVIDENCE_LABEL[preview.evidence] ?? preview.evidence}</td></tr>
            </tbody>
          </table>
          {preview.decision.ok ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs space-y-1" data-testid="person-relink-preview">
              <p className="font-semibold">O que muda</p>
              <ul className="list-disc pl-5">{preview.changes.map((c) => <li key={c}>{c}</li>)}</ul>
              <p className="font-semibold mt-1">O que não muda</p>
              <ul className="list-disc pl-5">{preview.unchanged.map((c) => <li key={c}>{c}</li>)}</ul>
              {preview.evidence === "MANUAL" ? (
                <p className="inline-flex items-center gap-1 text-amber-900"><AlertTriangle className="h-3.5 w-3.5" /> Sem evidência automática: confirme que é a mesma pessoa física antes de prosseguir.</p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-testid="person-relink-blocked">{preview.decision.message}</p>
          )}
          <ReasonField value={reason} onChange={setReason} testId="person-relink-reason" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Cancelar</button>
            <button type="button" disabled={busy || !preview.decision.ok || reason.trim().length < 5} onClick={() => void confirm()} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50" data-testid="person-relink-confirm">
              {busy ? "Gravando…" : preview.currentPerson ? "Confirmar correção" : "Confirmar vínculo"}
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

export function UnlinkDialog({ personId, entityKind, entityId, label, onClose, onDone }: { personId: string; entityKind: LinkEntityKind; entityId: string; label: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlinkEntity(personId, entityKind, entityId, reason);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao desvincular.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title={`Desvincular — ${KIND_LABEL[entityKind]}`} onClose={onClose} testId="person-unlink-dialog">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
      <p className="text-sm">O cadastro <strong>{label}</strong> deixa de apontar para esta pessoa. O cadastro em si, seus dados, históricos e permissões não mudam; a operação fica na auditoria e pode ser refeita.</p>
      <ReasonField value={reason} onChange={setReason} testId="person-unlink-reason" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Cancelar</button>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void confirm()} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" data-testid="person-unlink-confirm">
          {busy ? "Gravando…" : "Desvincular"}
        </button>
      </div>
    </Shell>
  );
}

function SideColumn({ title, side, chosen, onChoose }: { title: string; side: MergePreview["winner"]; chosen: boolean; onChoose: () => void }) {
  return (
    <div className={cn("rounded-lg border p-3 text-xs space-y-1", chosen ? "border-primary bg-primary/5" : "border-border")}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-sm">{title}</p>
        <button type="button" onClick={onChoose} className={cn("rounded-full border px-2 py-0.5 text-[11px]", chosen ? "bg-primary text-primary-foreground border-primary" : "border-border")}>
          {chosen ? "Fica" : "Escolher"}
        </button>
      </div>
      <p className="font-medium">{side.displayName} <span className="font-mono text-muted-foreground">({side.id.slice(0, 8)}…)</span></p>
      <p>Situação: {side.status}</p>
      <p>CPF: {side.cpfMasked ?? "—"} · E-mail: {side.emailMasked ?? "—"}</p>
      <p>Colaborador {side.counts.employees} · Usuário {side.counts.users} · Motorista {side.counts.fleetDrivers} · Comissionável {side.counts.commissionPeople} · Cliente {side.counts.customers}</p>
    </div>
  );
}

/** Unificação controlada: comparação lado a lado → escolha → prévia → justificativa → step-up no servidor. */
export function MergeDialog({ personId, otherPersonId, onClose, onDone, runWithStepUp }: { personId: string; otherPersonId: string; onClose: () => void; onDone: () => void; runWithStepUp: (fn: () => Promise<void>) => Promise<boolean> }) {
  const [winnerId, setWinnerId] = useState(personId);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const loserId = winnerId === personId ? otherPersonId : personId;

  useEffect(() => {
    let alive = true;
    setPreview(null);
    previewMerge(winnerId, loserId)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Não foi possível pré-visualizar."));
    return () => {
      alive = false;
    };
  }, [winnerId, loserId]);

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await runWithStepUp(async () => {
        await executeMerge(winnerId, { loserPersonId: loserId, reason, expectedMoveCount: preview.plan.moves.length });
        onDone();
      });
      if (!ok) setError("Confirme sua identidade (senha) para concluir a unificação.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao unificar.");
    } finally {
      setBusy(false);
    }
  };

  const blocked = (preview?.plan.blockers.length ?? 0) > 0;
  return (
    <Shell title="Unificar pessoas (operação controlada)" onClose={onClose} testId="person-merge-dialog">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
      {!preview ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Comparando…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">Evidência: {EVIDENCE_LABEL[preview.plan.evidence] ?? preview.plan.evidence}. Nunca se unifica por nome.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <SideColumn title="Pessoa que fica" side={preview.winner} chosen onChoose={() => undefined} />
            <SideColumn title="Pessoa absorvida" side={preview.loser} chosen={false} onChoose={() => setWinnerId(preview.loser.id)} />
          </div>
          {blocked ? (
            <ul className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 list-disc pl-6" data-testid="person-merge-blocked">
              {preview.plan.blockers.map((b) => <li key={b.code}>{b.message}</li>)}
            </ul>
          ) : (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs space-y-1" data-testid="person-merge-preview">
              <p className="font-semibold">Prévia</p>
              <p>Religar {preview.plan.moves.length} vínculo(s) para a pessoa que fica{preview.plan.moves.length ? `: ${preview.plan.moves.map((m) => m.entityKind).join(", ")}` : ""}.</p>
              {preview.plan.fillFromLoser.length ? <p>Preencher na pessoa que fica (só o que ela não tem): {preview.plan.fillFromLoser.join(", ")}.</p> : null}
              <p>A pessoa absorvida fica marcada como unificada (nunca é apagada). Reversível enquanto não houver vínculos novos.</p>
              <p className="font-semibold mt-1">Não muda</p>
              <ul className="list-disc pl-5">{preview.plan.unchanged.map((u) => <li key={u}>{u}</li>)}</ul>
            </div>
          )}
          <ReasonField value={reason} onChange={setReason} testId="person-merge-reason" />
          <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Exige Super Administrador com confirmação de senha (step-up).</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Cancelar</button>
            <button type="button" disabled={busy || blocked || reason.trim().length < 5} onClick={() => void confirm()} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50" data-testid="person-merge-confirm">
              {busy ? "Unificando…" : "Unificar"}
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

export function RevertMergeDialog({ personId, eventId, onClose, onDone, runWithStepUp }: { personId: string; eventId: string; onClose: () => void; onDone: () => void; runWithStepUp: (fn: () => Promise<void>) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await runWithStepUp(async () => {
        await revertMerge(personId, { eventId, reason });
        onDone();
      });
      if (!ok) setError("Confirme sua identidade (senha) para reverter.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao reverter.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Reverter unificação" onClose={onClose} testId="person-revert-dialog">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
      <p className="text-sm">Os vínculos religados voltam para a pessoa absorvida, que volta a ficar ativa. Só é possível enquanto não houver vínculos novos criados depois da unificação.</p>
      <ReasonField value={reason} onChange={setReason} testId="person-revert-reason" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Cancelar</button>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void confirm()} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50" data-testid="person-revert-confirm">
          {busy ? "Revertendo…" : "Reverter"}
        </button>
      </div>
    </Shell>
  );
}
