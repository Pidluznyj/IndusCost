import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Copy, FileText, History, KeyRound, Loader2, ShieldCheck, Truck, UserRound, Wallet } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { LinkCard } from "@/src/components/employee/EmployeeSystemLinksPanel";
import { useAdminStepUp } from "@/src/components/settings/useAdminStepUp";
import { MergeDialog, RelinkDialog, RevertMergeDialog, UnlinkDialog } from "@/src/components/people/PersonLinkDialogs";
import { AttachAccountDialog, EnableAccessDialog, EnableDriverDialog, PersonFormDialog, PersonStatusDialog } from "@/src/components/people/PersonMasterDialogs";
import type { SystemLinkCard } from "@/src/lib/employeeSystemLinks";
import {
  EVENT_KIND_LABEL,
  fetchPersonProfile,
  LINK_STATE_LABEL,
  PERSON_FLAG_LABEL,
  PERSON_STATUS_LABEL,
  type LinkEntityKind,
  type PendingLink,
  type PersonLinkState,
  type PersonProfile,
} from "@/src/lib/people/peopleClient";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function stateBadge(state: PersonLinkState) {
  const tone =
    state === "LINKED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : state === "CONFLICT"
        ? "border-red-200 bg-red-50 text-red-800"
        : state === "PENDING_REVIEW"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : state === "INACTIVE"
            ? "border-border bg-muted text-muted-foreground"
            : "border-dashed border-border bg-background text-muted-foreground";
  return <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone)}>{LINK_STATE_LABEL[state]}</span>;
}

type RoleKey = "employee" | "appUser" | "fleetDriver" | "commissionPerson";

const ROLE_META: Record<RoleKey, { label: string; icon: React.ComponentType<{ className?: string }>; kinds: string[]; pendingKind: PendingLink["kind"]; help: string }> = {
  employee: { label: "Funcionário", icon: UserRound, kinds: ["employee_self"], pendingKind: "employee", help: "Vínculo trabalhista. Dados do RH ficam no cadastro de origem." },
  appUser: { label: "Usuário IndusCost", icon: KeyRound, kinds: ["app_user"], pendingKind: "app_user", help: "Conta de acesso. Permissões e senha só em Configurações › Usuários." },
  fleetDriver: { label: "Motorista", icon: Truck, kinds: ["fleet_driver"], pendingKind: "fleet_driver", help: "Habilitação operacional. CNH e histórico ficam na Frota." },
  commissionPerson: { label: "Comissionável", icon: Wallet, kinds: ["commission_person", "seller_alias"], pendingKind: "commission_person", help: "Identidade comercial do Nomus. Regras e valores de comissão não mudam por vínculo." },
};

function RoleSection({ roleKey, state, cards, pending, canView, canManage, linked, onRelink, onUnlink, actions, onAttach }: { onAttach?: (accountId: string) => void; roleKey: RoleKey; state: PersonLinkState; cards: SystemLinkCard[]; pending: PendingLink[]; canView: boolean; canManage: boolean; linked: Array<{ kind: LinkEntityKind; id: string }>; onRelink: (kind: LinkEntityKind, id: string) => void; onUnlink: (kind: LinkEntityKind, id: string, label: string) => void; actions?: React.ReactNode }) {
  const meta = ROLE_META[roleKey];
  const Icon = meta.icon;
  return (
    <section className="rounded-xl border border-border bg-card p-3 space-y-2" data-testid={`person-card-${roleKey}`} data-state={state}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 font-semibold text-foreground">
          <Icon className="h-4 w-4" /> {meta.label}
        </h3>
        {stateBadge(state)}
      </header>
      {!canView ? (
        <p className="text-xs text-muted-foreground">Você não tem permissão para ver os detalhes deste vínculo; apenas a existência é mostrada.</p>
      ) : cards.length === 0 ? (
        <p className="text-xs text-muted-foreground">{state === "NOT_LINKED" ? `Nenhum cadastro de ${meta.label.toLowerCase()} ligado a esta pessoa.` : "Sem detalhes disponíveis."}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {cards.map((card) => (
            <div key={card.cardKey}>
              <LinkCard card={card} />
            </div>
          ))}
        </div>
      )}
      {pending.length > 0 ? (
        <ul className="space-y-1" data-testid={`person-pending-${roleKey}`}>
          {pending.map((p) => (
            <li key={`${p.kind}:${p.entityId}`} className={cn("rounded-lg border px-2.5 py-2 text-xs", p.severity === "CONFLICT" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900")}>
              <span className="inline-flex items-center gap-1 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" /> {p.severity === "CONFLICT" ? "Conflito" : "Pendente"} · {p.label}
              </span>
              <p className="mt-0.5">{p.hint}</p>
              {p.currentPersonId ? (
                <p className="mt-0.5">
                  Aponta hoje para{" "}
                  <Link to={`/people/${p.currentPersonId}`} className="underline">
                    {p.currentPersonLabel ?? p.currentPersonId.slice(0, 8)}
                  </Link>{" "}
                  ({p.currentPersonId.slice(0, 8)}…).
                </p>
              ) : null}
              <p className="mt-0.5 text-[11px] opacity-80">Evidência: {p.evidence === "CPF_EXACT" ? "CPF igual" : p.evidence === "EMAIL_EXACT" ? "e-mail igual (não decide sozinho)" : p.evidence === "ACCOUNT_WITHOUT_EMPLOYEE" ? "conta já é desta Pessoa; falta ligar ao colaborador" : "vínculo colaborador ↔ conta"}.</p>
              {p.evidence === "ACCOUNT_WITHOUT_EMPLOYEE" ? (
                onAttach ? (
                  <button type="button" onClick={() => onAttach(p.entityId)} className="mt-1 rounded-lg border border-current px-2 py-1 text-[11px] font-semibold hover:bg-white/50" data-testid={`person-attach-employee-${p.entityId}`}>
                    Ligar conta ao colaborador
                  </button>
                ) : null
              ) : canManage && p.kind !== "person" ? (
                <button type="button" onClick={() => onRelink(p.kind as LinkEntityKind, p.entityId)} className="mt-1 rounded-lg border border-current px-2 py-1 text-[11px] font-semibold hover:bg-white/50" data-testid={`person-relink-open-${p.kind}-${p.entityId}`}>
                  {p.currentPersonId ? "Corrigir vínculo para esta pessoa" : "Vincular a esta pessoa"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      {canManage && linked.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {linked.map((l) => (
            <button key={l.id} type="button" onClick={() => onUnlink(l.kind, l.id, cards[0]?.entityLabel ?? meta.label)} className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted" data-testid={`person-unlink-open-${l.kind}`}>
              Desvincular
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{meta.help}</p>
    </section>
  );
}

export function PersonProfilePage({ personId }: { personId: string }) {
  const [data, setData] = useState<PersonProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dialog, setDialog] = useState<
    | { type: "relink"; kind: LinkEntityKind; id: string }
    | { type: "unlink"; kind: LinkEntityKind; id: string; label: string }
    | { type: "merge"; otherPersonId: string }
    | { type: "revert"; eventId: string }
    | { type: "edit" }
    | { type: "status"; next: "ACTIVE" | "INACTIVE" }
    | { type: "enable-access" }
    | { type: "attach-account"; accountId: string | null }
    | { type: "enable-driver" }
    | null
  >(null);
  const stepUp = useAdminStepUp();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPersonProfile(personId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar a pessoa.");
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cardsByKind = useMemo(() => {
    const map = new Map<string, SystemLinkCard[]>();
    for (const group of data?.cards.groups ?? []) {
      for (const card of group.cards) {
        const list = map.get(card.kind) ?? [];
        list.push(card);
        map.set(card.kind, list);
      }
    }
    return map;
  }, [data]);

  const cardsFor = (kinds: string[]) => kinds.flatMap((k) => cardsByKind.get(k) ?? []);
  const pendingFor = (kind: PendingLink["kind"]) => (data?.pending ?? []).filter((p) => p.kind === kind);
  const otherCards = useMemo(() => {
    const known = new Set(Object.values(ROLE_META).flatMap((m) => m.kinds));
    return (data?.cards.groups ?? []).flatMap((g) => g.cards).filter((c) => !known.has(c.kind));
  }, [data]);

  if (loading) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground" data-testid="person-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando pessoa…
      </p>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error ?? "Pessoa não encontrada."}
        </p>
        <Link to="/people" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Voltar à lista
        </Link>
      </div>
    );
  }

  const { person, linkStates, caps } = data;
  const personPending = data.pending.filter((p) => p.kind === "person");

  return (
    <div className="space-y-4" data-testid="person-profile">
      <Link to="/people" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Pessoas
      </Link>

      <header className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-base font-bold text-muted-foreground" aria-hidden>
          {initials(person.displayName)}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-xl font-bold text-foreground" data-testid="person-display-name">
            {person.displayName}
          </h2>
          {person.socialName && person.socialName !== person.civilName ? (
            <p className="text-sm text-muted-foreground">Nome civil: {person.civilName}</p>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-mono">
              ID {person.shortId}…
              <button
                type="button"
                className="rounded border border-border px-1 py-0.5 hover:bg-muted"
                title="Copiar identificador completo"
                onClick={() => {
                  void navigator.clipboard?.writeText(person.id).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                <Copy className="h-3 w-3" />
              </button>
              {copied ? <span className="text-emerald-700">copiado</span> : null}
            </span>
            <span data-testid="person-cpf">CPF {caps.canViewPii && person.cpf ? person.cpf : person.cpfMasked ?? "—"}</span>
            <span>E-mail {caps.canViewPii && person.corporateEmail ? person.corporateEmail : person.corporateEmailMasked ?? "—"}</span>
            <span>Situação: <strong className="text-foreground">{PERSON_STATUS_LABEL[person.status] ?? person.status}</strong></span>
            <span>Origem: {person.origin}</span>
            <span>Criada em {new Date(person.createdAt).toLocaleDateString("pt-BR")}</span>
            <span>Atualizada em {new Date(person.updatedAt).toLocaleDateString("pt-BR")}</span>
          </p>
          {person.mergedInto ? (
            <p className="text-xs text-amber-900 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
              Esta pessoa foi unificada em{" "}
              <Link to={`/people/${person.mergedInto.id}`} className="underline">
                {person.mergedInto.displayName}
              </Link>
              . Os vínculos atuais estão lá.
            </p>
          ) : null}
          {data.flags.filter((f) => f !== "NO_LINKS" && f !== "MERGED").length > 0 ? (
            <p className="flex flex-wrap gap-1">
              {data.flags
                .filter((f) => f !== "NO_LINKS" && f !== "MERGED")
                .map((f) => (
                  <span key={f} className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", f === "USER_ON_OTHER_PERSON" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
                    {PERSON_FLAG_LABEL[f] ?? f}
                  </span>
                ))}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1"><UserRound className="h-3.5 w-3.5" /> {LINK_STATE_LABEL[linkStates.employee]}</span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1"><KeyRound className="h-3.5 w-3.5" /> {LINK_STATE_LABEL[linkStates.appUser]}</span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1"><Truck className="h-3.5 w-3.5" /> {LINK_STATE_LABEL[linkStates.fleetDriver]}</span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1"><Wallet className="h-3.5 w-3.5" /> {LINK_STATE_LABEL[linkStates.commissionPerson]}</span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1"><FileText className="h-3.5 w-3.5" /> {data.documentsCount} doc(s)</span>
          {person.status !== "MERGED" && (caps.canEditPerson || caps.canManagePersonStatus) ? (
            <span className="basis-full flex flex-wrap gap-2 pt-1" data-testid="person-master-actions">
              {caps.canEditPerson ? (
                <button type="button" onClick={() => setDialog({ type: "edit" })} className="rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted" data-testid="person-edit-open">
                  Editar dados
                </button>
              ) : null}
              {caps.canManagePersonStatus && person.status === "ACTIVE" ? (
                <button type="button" onClick={() => setDialog({ type: "status", next: "INACTIVE" })} className="rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted" data-testid="person-inactivate-open">
                  Inativar identidade
                </button>
              ) : null}
              {caps.canManagePersonStatus && person.status === "INACTIVE" ? (
                <button type="button" onClick={() => setDialog({ type: "status", next: "ACTIVE" })} className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100" data-testid="person-reactivate-open">
                  Reativar identidade
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      </header>

      {data.flags.includes("PERSON_INACTIVE_WITH_ACTIVE_LINKS") ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="person-inactive-conflict">
          <p className="inline-flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" /> Pessoa inativa com vínculos ativos</p>
          <p className="mt-1 text-xs">
            Esta identidade está inativa, mas há colaborador ativo, conta ativa ou motorista ligado a ela — estado herdado do legado. Nenhum vínculo novo é aceito enquanto a Pessoa estiver inativa.
            {caps.canManagePersonStatus ? " Se a pessoa de fato está na empresa, reative a identidade (com justificativa); se o colaborador deveria estar desligado, trate isso no RH." : ""}
          </p>
        </div>
      ) : null}

      {personPending.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="person-duplicates">
          <p className="inline-flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" /> Possível duplicidade de identidade</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {personPending.map((p) => (
              <li key={p.entityId}>
                <Link to={`/people/${p.entityId}`} className="underline">{p.label}</Link> ({p.entityId.slice(0, 8)}…) — {p.hint}
              </li>
            ))}
          </ul>
          {caps.canMerge && caps.canManagePersonLink ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {personPending.map((p) => (
                <button key={p.entityId} type="button" onClick={() => setDialog({ type: "merge", otherPersonId: p.entityId })} className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-900 hover:bg-red-100" data-testid="person-merge-open">
                  Unificar com {p.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs">A unificação é uma operação controlada (prévia, confirmação com senha e auditoria) feita por um Super Administrador. Nada é unificado automaticamente.</p>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <RoleSection roleKey="employee" state={linkStates.employee} cards={cardsFor(ROLE_META.employee.kinds)} pending={pendingFor("employee")} canView={caps.canViewEmployees} canManage={caps.canManagePersonLink} linked={data.linkedEntities.filter((l) => l.kind === "employee")} onRelink={(kind, id) => setDialog({ type: "relink", kind, id })} onUnlink={(kind, id, label) => setDialog({ type: "unlink", kind, id, label })} />
        <RoleSection
          roleKey="appUser"
          onAttach={caps.canAttachAccount ? (accountId) => setDialog({ type: "attach-account", accountId }) : undefined}
          state={linkStates.appUser}
          cards={cardsFor(ROLE_META.appUser.kinds)}
          pending={pendingFor("app_user")}
          canView={caps.canViewUsers}
          canManage={caps.canManagePersonLink}
          linked={data.linkedEntities.filter((l) => l.kind === "app_user")}
          onRelink={(kind, id) => setDialog({ type: "relink", kind, id })}
          onUnlink={(kind, id, label) => setDialog({ type: "unlink", kind, id, label })}
          actions={
            person.status === "ACTIVE" && !data.linkedEntities.some((l) => l.kind === "app_user") ? (
              <>
                {caps.canCreateUsers ? (
                  <button type="button" onClick={() => setDialog({ type: "enable-access" })} className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground" data-testid="person-enable-access-open">
                    Habilitar acesso ao IndusCost
                  </button>
                ) : null}
                {caps.canAttachAccount ? (
                  <button type="button" onClick={() => setDialog({ type: "attach-account", accountId: null })} className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold hover:bg-muted" data-testid="person-attach-account-open">
                    Regularizar vínculo existente
                  </button>
                ) : null}
              </>
            ) : null
          }
        />
        <RoleSection
          roleKey="fleetDriver"
          state={linkStates.fleetDriver}
          cards={cardsFor(ROLE_META.fleetDriver.kinds)}
          pending={pendingFor("fleet_driver")}
          canView={caps.canViewFleet}
          canManage={caps.canManagePersonLink}
          linked={data.linkedEntities.filter((l) => l.kind === "fleet_driver")}
          onRelink={(kind, id) => setDialog({ type: "relink", kind, id })}
          onUnlink={(kind, id, label) => setDialog({ type: "unlink", kind, id, label })}
          actions={
            person.status === "ACTIVE" && caps.canManageDrivers && linkStates.fleetDriver !== "LINKED" ? (
              <button type="button" onClick={() => setDialog({ type: "enable-driver" })} className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground" data-testid="person-enable-driver-open">
                Habilitar motorista
              </button>
            ) : null
          }
        />
        <RoleSection roleKey="commissionPerson" state={linkStates.commissionPerson} cards={cardsFor(ROLE_META.commissionPerson.kinds)} pending={pendingFor("commission_person")} canView={caps.canViewCommissions} canManage={caps.canManagePersonLink} linked={data.linkedEntities.filter((l) => l.kind === "commission_person")} onRelink={(kind, id) => setDialog({ type: "relink", kind, id })} onUnlink={(kind, id, label) => setDialog({ type: "unlink", kind, id, label })} />
      </div>

      {otherCards.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-3 space-y-2" data-testid="person-card-other">
          <h3 className="font-semibold text-foreground">Outros vínculos e relações</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {otherCards.map((card) => (
              <div key={card.cardKey}>
                <LinkCard card={card} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-3 space-y-2" data-testid="person-card-documents">
        <h3 className="inline-flex items-center gap-2 font-semibold text-foreground"><FileText className="h-4 w-4" /> Documentos</h3>
        <p className="text-xs text-muted-foreground">
          {data.documentsCount} documento(s) no RH ligados ao vínculo de colaborador. A lista e os arquivos ficam na ficha do colaborador, com a permissão de documentos do RH.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-3 space-y-2" data-testid="person-card-history">
        <h3 className="inline-flex items-center gap-2 font-semibold text-foreground"><History className="h-4 w-4" /> Histórico de identidade</h3>
        {data.events.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum evento de identidade registrado ainda. Vínculos feitos antes da auditoria de identidade (criada em 2026-10) não aparecem aqui — esta lista não reconstrói o passado.
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {data.events.map((ev) => (
              <li key={ev.id} className="rounded-lg border border-border px-2.5 py-1.5">
                <span className="font-semibold">{EVENT_KIND_LABEL[ev.eventKind] ?? ev.eventKind}</span>
                {ev.entityKind ? <span className="text-muted-foreground"> · {ev.entityKind}</span> : null}
                <span className="text-muted-foreground"> · {new Date(ev.createdAt).toLocaleString("pt-BR")}</span>
                {ev.actorName ? <span className="text-muted-foreground"> · por {ev.actorName}</span> : null}
                {ev.reason ? <p className="text-muted-foreground">Motivo: {ev.reason}</p> : null}
                {ev.evidence ? <p className="text-muted-foreground">Evidência: {ev.evidence}</p> : null}
                {ev.revertedAt ? <p className="text-amber-800">Revertido em {new Date(ev.revertedAt).toLocaleString("pt-BR")}</p> : null}
                {ev.eventKind === "MERGED" && ev.reversible && !ev.revertedAt && ev.toPersonId === person.id && caps.canMerge && caps.canManagePersonLink ? (
                  <button type="button" onClick={() => setDialog({ type: "revert", eventId: ev.id })} className="mt-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted" data-testid="person-revert-open">
                    Reverter unificação
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <ShieldCheck className="h-3.5 w-3.5" /> Cada cartão aplica a permissão do módulo de origem no servidor; a ficha não concede acesso a salário, documentos privados ou permissões.
      </p>

      {dialog?.type === "relink" ? <RelinkDialog personId={person.id} entityKind={dialog.kind} entityId={dialog.id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} /> : null}
      {dialog?.type === "unlink" ? <UnlinkDialog personId={person.id} entityKind={dialog.kind} entityId={dialog.id} label={dialog.label} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} /> : null}
      {dialog?.type === "merge" ? <MergeDialog personId={person.id} otherPersonId={dialog.otherPersonId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} runWithStepUp={stepUp.run} /> : null}
      {dialog?.type === "revert" ? <RevertMergeDialog personId={person.id} eventId={dialog.eventId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} runWithStepUp={stepUp.run} /> : null}
      {dialog?.type === "edit" ? <PersonFormDialog personId={person.id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} /> : null}
      {dialog?.type === "status" ? <PersonStatusDialog personId={person.id} nextStatus={dialog.next} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} /> : null}
      {dialog?.type === "enable-access" ? <EnableAccessDialog personId={person.id} suggestedName={person.displayName} suggestedEmail={caps.canViewPii ? person.corporateEmail : null} hasEmployee={data.linkedEntities.some((l) => l.kind === "employee")} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} /> : null}
      {dialog?.type === "attach-account" ? <AttachAccountDialog personId={person.id} initialAccountId={dialog.accountId} runWithStepUp={stepUp.run} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} /> : null}
      {dialog?.type === "enable-driver" ? <EnableDriverDialog personId={person.id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} /> : null}
      {stepUp.dialog}
    </div>
  );
}
