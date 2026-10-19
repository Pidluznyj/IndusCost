/**
 * Mesa do ciclo: etapas, pessoas, convites e ações por pessoa. Nenhuma ação usa
 * window.prompt nem pede identificador interno: tudo por formulário do design system.
 * O código falado nunca vai para a folha impressa.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, ClipboardCopy, FileDown, Pencil, Printer, QrCode, RotateCcw, Search, ShieldOff, UserMinus, UserPlus, UserRoundCog, Users } from "lucide-react";
import { OverlayBadge, OverlayField, OverlayFieldGrid, OverlayInput, OverlaySelect, OverlayTextarea } from "@/src/components/ui/overlay";
import { CYCLE_STATUSES, CYCLE_STATUS_LABELS, ELIGIBILITY_LABELS, forwardStatus, reversalStatus, type CycleStatus } from "@/src/lib/hrPerformance/performanceDomain";
import {
  fetchCycleWorkspace,
  issuePerformanceInvite,
  issuePerformanceInvitesBatch,
  homologatePerformanceCycle,
  openAssistedPerformance,
  performanceExportUrl,
  performanceReportPrintUrl,
  previewPerformanceParticipants,
  reassignPerformanceLeader,
  removePerformanceParticipant,
  revokePerformanceInvite,
  savePerformanceParticipants,
  searchPerformanceDirectory,
  setPerformanceEligibilityException,
  transitionPerformanceCycle,
  updatePerformanceCycle,
  type CycleWorkspace,
  type DirectoryPerson,
  type IssuedInvite,
  type PerformanceMe,
  type WorkspacePerson,
} from "@/src/lib/hrPerformance/performanceClient";
import {
  AssignmentBadge,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CultureBadge,
  CycleStatusBadge,
  EligibilityBadge,
  EmployeePicker,
  ErrorBanner,
  InfoBanner,
  InviteBadge,
  KpiTile,
  OfficialBadge,
  PANEL,
  PanelState,
  PerformanceModal,
  ReasonField,
  TableScroll,
  copyText,
  dateBr,
  quadrantText,
  rateText,
} from "./performanceUi";
import { cn } from "@/src/lib/utils";

export const PRINT_CARDS_KEY = "ic-perf-print-cards";

type PrintCard = { name: string; role: string; cycle: string; url: string; expiresAt: string };

/**
 * Abre as fichas em outra aba SEM "noopener": só assim o navegador copia o sessionStorage
 * (onde ficam os links emitidos nesta sessão). A página de fichas corta o window.opener ao abrir.
 */
function openInvitePrint() {
  window.open("/performance-cycle/convites", "_blank");
}

function rememberCards(cycleName: string, issued: IssuedInvite[]) {
  let current: PrintCard[] = [];
  try {
    current = JSON.parse(sessionStorage.getItem(PRINT_CARDS_KEY) || "[]") as PrintCard[];
  } catch {
    current = [];
  }
  const names = new Set(issued.map((i) => `${cycleName}|${i.employeeName}`));
  const next = [
    ...current.filter((card) => !names.has(`${card.cycle}|${card.name}`)),
    ...issued.map((i) => ({ name: i.employeeName, role: i.roleName, cycle: cycleName, url: i.url, expiresAt: i.expiresAt })),
  ];
  sessionStorage.setItem(PRINT_CARDS_KEY, JSON.stringify(next));
}

type Dialog =
  | { kind: "transition"; to: CycleStatus; reversal: boolean }
  | { kind: "edit" }
  | { kind: "add" }
  | { kind: "exception"; person: WorkspacePerson }
  | { kind: "leader"; person: WorkspacePerson }
  | { kind: "remove"; person: WorkspacePerson }
  | { kind: "assist"; person: WorkspacePerson }
  | { kind: "revoke"; person: WorkspacePerson }
  | null;

const NEXT_LABEL: Partial<Record<CycleStatus, string>> = {
  DRAFT: "Preparar ciclo",
  PREPARED: "Abrir ciclo",
  OPEN: "Encerrar coleta",
  CONSOLIDATION: "Iniciar calibração",
  CALIBRATION: "Homologar resultados",
  HOMOLOGATED: "Encerrar ciclo",
};

export function CycleDesk({ cycleId, me, onToast, onChanged }: { cycleId: string; me: PerformanceMe; onToast: (message: string) => void; onChanged: () => void }) {
  const [ws, setWs] = useState<CycleWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [issued, setIssued] = useState<IssuedInvite[]>([]);
  const [filters, setFilters] = useState({ text: "", department: "", role: "", manager: "", state: "" });
  const caps = me.capabilities;

  const reload = useCallback(async () => {
    try {
      setWs(await fetchCycleWorkspace(cycleId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o ciclo.");
    }
  }, [cycleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await fn();
      onToast(message);
      await reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
      void reload();
    }
  };

  const people = ws?.people ?? [];
  const live = people.filter((p) => !p.participant.removedAt);
  const visible = useMemo(() => {
    const text = filters.text.trim().toLowerCase();
    return people.filter((item) => {
      const p = item.participant;
      if (filters.state === "removed" ? !p.removedAt : p.removedAt) return false;
      if (filters.state && filters.state !== "removed" && p.eligibility !== filters.state) return false;
      if (filters.department && p.departmentName !== filters.department) return false;
      if (filters.role && p.roleName !== filters.role) return false;
      if (filters.manager && (p.managerName ?? "") !== filters.manager) return false;
      if (text && !`${p.employeeName} ${p.roleName} ${p.departmentName}`.toLowerCase().includes(text)) return false;
      return true;
    });
  }, [people, filters]);

  if (!ws) return <div className={PANEL}>{error ? <PanelState kind="error" message={error} onRetry={() => void reload()} /> : <PanelState kind="loading" message="Carregando o ciclo…" />}</div>;

  const status = ws.cycle.status as CycleStatus;
  const next = forwardStatus(status);
  const back = reversalStatus(status);
  const preOpen = status === "DRAFT" || status === "PREPARED";
  const counts = ws.counts;
  const unique = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();

  const issueBatch = async () => {
    setError(null);
    try {
      const result = await issuePerformanceInvitesBatch(cycleId, { onlyMissing: true });
      rememberCards(ws.cycle.name, result.issued);
      setIssued((current) => [...result.issued, ...current.filter((c) => !result.issued.some((n) => n.participantId === c.participantId))]);
      onToast(result.issued.length ? `${result.issued.length} convite(s) gerado(s)` : "Todos já têm convite ativo ou já responderam");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível gerar os convites.");
    }
  };

  const issueOne = async (person: WorkspacePerson) => {
    if (!person.self) return;
    setError(null);
    try {
      const result = await issuePerformanceInvite(person.self.id);
      rememberCards(ws.cycle.name, [result]);
      setIssued((current) => [result, ...current.filter((c) => c.participantId !== result.participantId)]);
      onToast(person.invite.status === "NONE" ? "Convite gerado" : "Convite reemitido; o anterior foi revogado");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível gerar o convite.");
    }
  };

  return (
    <section className={`${PANEL} space-y-5 p-4`} data-testid="perf-cycle-desk">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-bold" data-testid="perf-cycle-title">{ws.cycle.name}</h3>
            <CycleStatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {ws.cycle.periodLabel} · {ws.model?.name} v{ws.model?.version} · autoavaliação até {dateBr(ws.cycle.selfDueAt)} · líder até {dateBr(ws.cycle.leaderDueAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {caps.manage && status !== "HOMOLOGATED" && status !== "CLOSED" ? (
            <button type="button" className={BTN_SECONDARY} onClick={() => setDialog({ kind: "edit" })} data-testid="perf-cycle-edit">
              <Pencil className="h-4 w-4" aria-hidden /> Editar
            </button>
          ) : null}
          {caps.manage && back ? (
            <button type="button" className={BTN_SECONDARY} onClick={() => setDialog({ kind: "transition", to: back, reversal: true })} data-testid="perf-cycle-back">
              <RotateCcw className="h-4 w-4" aria-hidden /> Voltar para {CYCLE_STATUS_LABELS[back].toLowerCase()}
            </button>
          ) : null}
          {next && (next === "HOMOLOGATED" ? caps.calibrate : caps.manage) ? (
            <button type="button" className={BTN_PRIMARY} onClick={() => setDialog({ kind: "transition", to: next, reversal: false })} data-testid="perf-cycle-next">
              {NEXT_LABEL[status]}
            </button>
          ) : null}
        </div>
      </header>

      <ol className="flex flex-wrap gap-1" aria-label="Etapas do ciclo" data-testid="perf-cycle-steps">
        {CYCLE_STATUSES.map((step, index) => {
          const reached = CYCLE_STATUSES.indexOf(status) >= index;
          return (
            <li
              key={step}
              aria-current={step === status ? "step" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                step === status ? "border-primary bg-primary text-primary-foreground" : reached ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"
              )}
            >
              {index + 1}. {CYCLE_STATUS_LABELS[step]}
            </li>
          );
        })}
      </ol>

      {status === "PREPARED" && !me.officialPublication ? (
        <InfoBanner tone="amber">A publicação oficial está desligada neste ambiente. Abrir o ciclo pede a confirmação de que perguntas e cortes ainda são proposta (piloto).</InfoBanner>
      ) : null}
      <ErrorBanner message={error} testId="perf-cycle-error" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="perf-cycle-kpis">
        <KpiTile label="Elegíveis" value={counts.eligible} hint={`${counts.notEligible} não elegíveis · ${counts.insufficient} evidência insuficiente`} />
        <KpiTile label="Convidados" value={counts.invited} hint={rateText(counts.rates.invited)} />
        <KpiTile label="Autoavaliações" value={counts.selfSubmitted} hint={rateText(counts.rates.selfSubmitted)} />
        <KpiTile label="Avaliações do líder" value={counts.leaderSubmitted} hint={`${rateText(counts.rates.leaderSubmitted)}${counts.withoutLeader ? ` · ${counts.withoutLeader} sem líder` : ""}`} tone={counts.withoutLeader ? "warning" : "neutral"} />
        <KpiTile label="Calibrados" value={counts.calibrated} hint={rateText(counts.rates.calibrated)} />
        <KpiTile label="Devolutivas" value={counts.feedback} hint={`${counts.acknowledged} com ciência`} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">
            Pessoas <span className="font-normal text-muted-foreground">({live.length} no ciclo{counts.removed ? ` · ${counts.removed} retiradas` : ""})</span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {caps.manage && preOpen ? (
              <button type="button" className={BTN_PRIMARY} onClick={() => setDialog({ kind: "add" })} data-testid="perf-add-people">
                <UserPlus className="h-4 w-4" aria-hidden /> Incluir pessoas
              </button>
            ) : null}
            {caps.invites && status === "OPEN" ? (
              <button type="button" className={BTN_PRIMARY} onClick={() => void issueBatch()} data-testid="perf-invites-batch">
                <QrCode className="h-4 w-4" aria-hidden /> Gerar convites pendentes
              </button>
            ) : null}
            {caps.invites && status === "OPEN" ? (
              <button type="button" className={BTN_SECONDARY} onClick={() => openInvitePrint()} data-testid="perf-invites-print">
                <Printer className="h-4 w-4" aria-hidden /> Imprimir fichas
              </button>
            ) : null}
            {caps.report ? (
              <>
                <a className={BTN_SECONDARY} href={performanceExportUrl(cycleId)} data-testid="perf-export-csv">
                  <FileDown className="h-4 w-4" aria-hidden /> CSV
                </a>
                <a className={BTN_SECONDARY} href={performanceReportPrintUrl(cycleId, "consolidado")} target="_blank" rel="noopener" data-testid="perf-report-cycle">
                  <Printer className="h-4 w-4" aria-hidden /> Relatório do ciclo
                </a>
              </>
            ) : null}
          </div>
        </div>

        {issued.length > 0 ? <IssuedPanel issued={issued} onClear={() => setIssued([])} onToast={onToast} /> : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="relative sm:col-span-2 lg:col-span-1">
            <span className="sr-only">Buscar pessoa</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm"
              placeholder="Nome, cargo ou setor"
              value={filters.text}
              onChange={(e) => setFilters({ ...filters, text: e.target.value })}
              data-testid="perf-people-search"
            />
          </label>
          <FilterSelect label="Setor" value={filters.department} options={unique(people.map((p) => p.participant.departmentName))} onChange={(department) => setFilters({ ...filters, department })} />
          <FilterSelect label="Cargo" value={filters.role} options={unique(people.map((p) => p.participant.roleName))} onChange={(role) => setFilters({ ...filters, role })} />
          <FilterSelect label="Líder" value={filters.manager} options={unique(people.map((p) => p.participant.managerName))} onChange={(manager) => setFilters({ ...filters, manager })} />
          <label>
            <span className="sr-only">Situação</span>
            <select className="h-10 w-full rounded-lg border border-border bg-card px-2 text-sm" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} aria-label="Situação">
              <option value="">Todas as situações</option>
              {Object.entries(ELIGIBILITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="removed">Retiradas do ciclo</option>
            </select>
          </label>
        </div>

        {people.length === 0 ? (
          <PanelState kind="empty" message={preOpen ? "Ninguém no ciclo ainda. Use Incluir pessoas para escolher no cadastro oficial." : "Sem participantes."} />
        ) : (
          <TableScroll>
            <table className="w-full min-w-[980px] text-left text-sm" data-testid="perf-people-table">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2 font-semibold">Pessoa</th>
                  <th className="px-2 py-2 font-semibold">Elegibilidade</th>
                  <th className="px-2 py-2 font-semibold">Líder avaliador</th>
                  <th className="px-2 py-2 font-semibold">Autoavaliação</th>
                  <th className="px-2 py-2 font-semibold">Líder</th>
                  <th className="px-2 py-2 font-semibold">Resultado</th>
                  <th className="py-2 pl-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((item) => (
                  <React.Fragment key={item.participant.id}>
                    <PersonRow item={item} status={status} me={me} cycleId={cycleId} onIssue={() => void issueOne(item)} onDialog={(d) => setDialog(d)} />
                  </React.Fragment>
                ))}
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      Nenhuma pessoa com esses filtros.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>

      {dialog?.kind === "transition" ? (
        <TransitionDialog
          ws={ws}
          to={dialog.to}
          reversal={dialog.reversal}
          officialPublication={me.officialPublication}
          onClose={() => setDialog(null)}
          onDone={async (message) => {
            setDialog(null);
            onToast(message);
            await reload();
            onChanged();
          }}
        />
      ) : null}
      {dialog?.kind === "edit" ? <EditCycleDialog ws={ws} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onToast("Ciclo atualizado"); void reload(); onChanged(); }} /> : null}
      {dialog?.kind === "add" ? (
        <AddPeopleDialog
          ws={ws}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            onToast(message);
            void reload();
            onChanged();
          }}
        />
      ) : null}
      {dialog?.kind === "exception" ? (
        <ExceptionDialog person={dialog.person} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); onToast(m); void reload(); }} />
      ) : null}
      {dialog?.kind === "leader" ? (
        <LeaderDialog person={dialog.person} opened={!preOpen} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onToast("Líder avaliador atualizado"); void reload(); }} />
      ) : null}
      {dialog?.kind === "remove" ? (
        <ReasonDialog
          title={preOpen ? "Remover do ciclo" : "Retirar do ciclo"}
          subtitle={
            preOpen
              ? `${dialog.person.participant.employeeName} sai da lista antes da abertura. O registro fica guardado.`
              : `${dialog.person.participant.employeeName} sai do ciclo. Respostas já dadas ficam preservadas e o convite é revogado.`
          }
          min={preOpen ? 3 : 8}
          label="Motivo"
          placeholder={preOpen ? "Ex.: incluída por engano" : "Ex.: desligamento em 10/11"}
          saveLabel="Confirmar"
          testId="perf-remove-dialog"
          onClose={() => setDialog(null)}
          onSave={async (reason) => {
            await removePerformanceParticipant(dialog.person.participant.id, reason);
            setDialog(null);
            onToast("Pessoa retirada do ciclo");
            await reload();
            onChanged();
          }}
        />
      ) : null}
      {dialog?.kind === "revoke" && dialog.person.self ? (
        <ReasonDialog
          title="Revogar convite"
          subtitle={`O QR de ${dialog.person.participant.employeeName} deixa de funcionar. Respostas salvas continuam guardadas.`}
          min={3}
          label="Motivo"
          placeholder="Ex.: folha perdida"
          saveLabel="Revogar"
          testId="perf-revoke-dialog"
          onClose={() => setDialog(null)}
          onSave={async (reason) => {
            await revokePerformanceInvite(dialog.person.self!.id, reason);
            setDialog(null);
            onToast("Convite revogado");
            await reload();
          }}
        />
      ) : null}
      {dialog?.kind === "assist" && dialog.person.self ? (
        <ReasonDialog
          title="Preencher junto com a pessoa"
          subtitle="Abre o formulário num aparelho da empresa. A resposta é da pessoa; o sistema registra quem ajudou e o motivo. No fim, ela confirma antes do envio."
          min={8}
          label="Motivo da assistência"
          placeholder="Ex.: sem celular; dificuldade de leitura"
          saveLabel="Abrir formulário"
          testId="perf-assist-dialog"
          onClose={() => setDialog(null)}
          onSave={async (reason) => {
            const opened = await openAssistedPerformance(dialog.person.self!.id, reason);
            setDialog(null);
            window.open(`/avaliacao#a=${encodeURIComponent(opened.sessionToken)}`, "_blank", "noopener");
            onToast("Formulário assistido aberto em outra aba");
          }}
        />
      ) : null}
    </section>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select className="h-10 w-full rounded-lg border border-border bg-card px-2 text-sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{`Todos: ${label.toLowerCase()}`}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function PersonRow({
  item,
  status,
  me,
  cycleId,
  onIssue,
  onDialog,
}: {
  item: WorkspacePerson;
  status: CycleStatus;
  me: PerformanceMe;
  cycleId: string;
  onIssue: () => void;
  onDialog: (dialog: Dialog) => void;
}) {
  const p = item.participant;
  const caps = me.capabilities;
  const preOpen = status === "DRAFT" || status === "PREPARED";
  const removed = Boolean(p.removedAt);
  const selfOpen = item.self && item.self.status !== "SUBMITTED";
  return (
    <tr className={cn("align-top", removed && "opacity-60")} data-testid={`perf-person-${p.employeeName}`}>
      <td className="py-3 pr-2">
        <p className="font-semibold">{p.employeeName}</p>
        <p className="text-xs text-muted-foreground">
          {p.roleName} · {p.departmentName}
        </p>
        {removed ? <p className="mt-1 text-xs text-rose-700">Retirada: {p.removedReason}</p> : null}
      </td>
      <td className="px-2 py-3">
        <EligibilityBadge state={p.eligibility} title={p.eligibilityReason} />
        <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">{p.eligibilityReason}</p>
      </td>
      <td className="px-2 py-3">
        <p className="text-sm">{p.managerName ?? <span className="text-amber-700">Sem líder</span>}</p>
        {p.managerSource === "RH" ? <OverlayBadge tone="violet" variant="outline">Exceção do RH</OverlayBadge> : null}
      </td>
      <td className="px-2 py-3">
        {p.eligibility === "ELIGIBLE" ? (
          <div className="flex flex-col items-start gap-1">
            <AssignmentBadge status={item.self?.status ?? (preOpen ? null : undefined)} />
            {item.self && item.self.status !== "SUBMITTED" ? <InviteBadge status={item.invite.status} /> : null}
            {item.invite.expiresAt && item.invite.status === "ACTIVE" ? <span className="text-xs text-muted-foreground">expira {dateBr(item.invite.expiresAt)}</span> : null}
            {item.self?.assisted ? <span className="text-xs text-muted-foreground">com assistência</span> : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Não se aplica</span>
        )}
      </td>
      <td className="px-2 py-3">
        {p.eligibility === "ELIGIBLE" ? (
          <div className="flex flex-col items-start gap-1">
            <AssignmentBadge status={item.leader?.status ?? null} />
            {item.leader && item.leader.revision > 1 ? <span className="text-xs text-muted-foreground">revisão {item.leader.revision}</span> : null}
            {item.divergences.length ? <span className="text-xs text-amber-700">{item.divergences.length} divergência(s)</span> : null}
          </div>
        ) : null}
      </td>
      <td className="px-2 py-3">
        {item.result ? (
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm">{quadrantText(item.result.quadrant)}</span>
            <OfficialBadge official={item.result.official} adjusted={item.result.adjusted} />
            <CultureBadge band={item.result.cultureBand} />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-3 pl-2">
        <div className="flex flex-wrap justify-end gap-1">
          {!removed && caps.manage && preOpen ? (
            <>
              <button type="button" className={BTN_GHOST} onClick={() => onDialog({ kind: "exception", person: item })} data-testid={`perf-exception-${p.employeeName}`}>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Exceção
              </button>
              <button type="button" className={BTN_GHOST} onClick={() => onDialog({ kind: "leader", person: item })} data-testid={`perf-leader-${p.employeeName}`}>
                <UserRoundCog className="h-3.5 w-3.5" aria-hidden /> Líder
              </button>
              <button type="button" className={BTN_GHOST} onClick={() => onDialog({ kind: "remove", person: item })}>
                <UserMinus className="h-3.5 w-3.5" aria-hidden /> Remover
              </button>
            </>
          ) : null}
          {!removed && caps.invites && status === "OPEN" && selfOpen ? (
            <>
              <button type="button" className={BTN_GHOST} onClick={onIssue} data-testid={`perf-invite-${p.employeeName}`}>
                <QrCode className="h-3.5 w-3.5" aria-hidden /> {item.invite.status === "NONE" ? "Gerar convite" : "Reemitir"}
              </button>
              {item.invite.status === "ACTIVE" ? (
                <button type="button" className={BTN_GHOST} onClick={() => onDialog({ kind: "revoke", person: item })}>
                  <ShieldOff className="h-3.5 w-3.5" aria-hidden /> Revogar
                </button>
              ) : null}
              <button type="button" className={BTN_GHOST} onClick={() => onDialog({ kind: "assist", person: item })} data-testid={`perf-assist-${p.employeeName}`}>
                <Users className="h-3.5 w-3.5" aria-hidden /> Preencher junto
              </button>
            </>
          ) : null}
          {!removed && caps.manage && !preOpen && status !== "HOMOLOGATED" && status !== "CLOSED" && p.eligibility === "ELIGIBLE" ? (
            <>
              <button type="button" className={BTN_GHOST} onClick={() => onDialog({ kind: "leader", person: item })} data-testid={`perf-leader-${p.employeeName}`}>
                <UserRoundCog className="h-3.5 w-3.5" aria-hidden /> Trocar líder
              </button>
              <button type="button" className={BTN_GHOST} onClick={() => onDialog({ kind: "remove", person: item })}>
                <UserMinus className="h-3.5 w-3.5" aria-hidden /> Retirar
              </button>
            </>
          ) : null}
          {me.capabilities.report && item.result ? (
            <a className={BTN_GHOST} href={performanceReportPrintUrl(cycleId, "individual", p.id)} target="_blank" rel="noopener" data-testid={`perf-report-${p.employeeName}`}>
              <Printer className="h-3.5 w-3.5" aria-hidden /> PDF
            </a>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function IssuedPanel({ issued, onClear, onToast }: { issued: IssuedInvite[]; onClear: () => void; onToast: (m: string) => void }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-testid="perf-issued-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-amber-900">Convites gerados agora · códigos para falar</p>
        <div className="flex gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={() => openInvitePrint()}>
            <Printer className="h-4 w-4" aria-hidden /> Imprimir fichas (sem o código)
          </button>
          <button type="button" className={BTN_GHOST} onClick={onClear}>
            Ocultar códigos
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-amber-900">
        O código de 6 dígitos aparece só nesta tela e não vai na folha. Fale o código para a pessoa na hora da entrega. Ao reemitir, o convite anterior deixa de valer.
      </p>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {issued.map((invite) => (
          <li key={invite.inviteId} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2" data-testid={`perf-issued-${invite.employeeName}`}>
            <QRCodeSVG value={invite.url} size={64} marginSize={1} aria-label={`QR de ${invite.employeeName}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{invite.employeeName}</p>
              <p className="text-xs text-muted-foreground">expira {dateBr(invite.expiresAt)}</p>
              <p className="mt-1 font-mono text-lg font-bold tracking-widest" data-testid={`perf-otp-${invite.employeeName}`}>
                {invite.otp}
              </p>
            </div>
            <button
              type="button"
              className={BTN_GHOST}
              aria-label={`Copiar link de ${invite.employeeName}`}
              onClick={() => void copyText(invite.url).then((ok) => onToast(ok ? "Link copiado" : "Não foi possível copiar"))}
            >
              <ClipboardCopy className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TransitionDialog({
  ws,
  to,
  reversal,
  officialPublication,
  onClose,
  onDone,
}: {
  ws: CycleWorkspace;
  to: CycleStatus;
  reversal: boolean;
  officialPublication: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [acceptPending, setAcceptPending] = useState(false);
  const counts = ws.counts;
  const pendingCollection = counts.selfPending + counts.leaderPending;
  const pendingFeedback = counts.official - counts.feedback;
  const needsPilotAck = to === "OPEN" && !reversal && !officialPublication;
  const needsPending = !reversal && ((to === "CONSOLIDATION" && pendingCollection > 0) || (to === "CLOSED" && pendingFeedback > 0));
  const canSave = (!reversal || reason.trim().length >= 8) && (!needsPilotAck || ack) && (!needsPending || acceptPending);
  const titles: Partial<Record<CycleStatus, string>> = {
    PREPARED: "Preparar o ciclo",
    OPEN: "Abrir o ciclo",
    CONSOLIDATION: "Encerrar a coleta",
    CALIBRATION: "Iniciar a calibração",
    HOMOLOGATED: "Homologar os resultados",
    CLOSED: "Encerrar o ciclo",
  };
  const descriptions: Partial<Record<CycleStatus, string>> = {
    PREPARED: "Confere o modelo publicado e a lista de pessoas. A lista ainda pode mudar até a abertura.",
    OPEN: "Congela participantes, líderes e elegibilidade e cria as tarefas de autoavaliação e de líder. Depois disso, convites podem ser emitidos.",
    CONSOLIDATION: "Fecha a autoavaliação e revoga convites que não foram usados. O líder ainda pode concluir a avaliação dele.",
    CALIBRATION: "Abre a fila de calibração para o RH comparar perspectivas, validar o técnico e calibrar.",
    HOMOLOGATED: "Torna oficiais os resultados calibrados. Só depois disso existe devolutiva e Nine-Box oficial.",
    CLOSED: "Encerra o ciclo. O histórico fica preservado e nada mais é alterado sem revisão formal.",
  };
  return (
    <PerformanceModal
      open
      title={reversal ? `Voltar para ${CYCLE_STATUS_LABELS[to].toLowerCase()}` : titles[to] ?? CYCLE_STATUS_LABELS[to]}
      subtitle={reversal ? "Voltar uma etapa é excepcional e fica registrado com o motivo." : descriptions[to] ?? ""}
      saveLabel={reversal ? "Voltar etapa" : "Confirmar"}
      footerHint={reversal ? "O motivo vai para a trilha de auditoria." : "A mudança fica registrada com data e responsável."}
      canSave={canSave}
      size="md"
      testId="perf-transition-dialog"
      onClose={onClose}
      onSave={async () => {
        if (to === "HOMOLOGATED" && !reversal) {
          await homologatePerformanceCycle(ws.cycle.id);
        } else {
          await transitionPerformanceCycle(ws.cycle.id, { to, reason: reversal ? reason : undefined, pilotAck: needsPilotAck ? ack : undefined, acceptPending: needsPending ? acceptPending : undefined });
        }
        await onDone(reversal ? "Etapa revertida" : `Ciclo em ${CYCLE_STATUS_LABELS[to].toLowerCase()}`);
      }}
    >
      {reversal ? <ReasonField label="Motivo" value={reason} onChange={setReason} testId="perf-transition-reason" /> : null}
      {to === "OPEN" && !reversal ? (
        <p className="text-sm">
          {counts.eligible} pessoa(s) elegível(is) · {counts.withLeader} com líder · {counts.withoutLeader} sem líder (só autoavaliação).
        </p>
      ) : null}
      {needsPilotAck ? (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="perf-pilot-ack" />
          Entendo que perguntas, escala e cortes ainda são proposta e que este ciclo é um piloto, sem resultado institucional homologado.
        </label>
      ) : null}
      {needsPending ? (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={acceptPending} onChange={(e) => setAcceptPending(e.target.checked)} data-testid="perf-accept-pending" />
          {to === "CONSOLIDATION"
            ? `Há ${counts.selfPending} autoavaliação(ões) e ${counts.leaderPending} avaliação(ões) de líder pendentes. Seguir mesmo assim; pendência não vira nota baixa.`
            : `${pendingFeedback} pessoa(s) ainda sem devolutiva. Encerrar mesmo assim, com a pendência registrada.`}
        </label>
      ) : null}
    </PerformanceModal>
  );
}

function EditCycleDialog({ ws, onClose, onDone }: { ws: CycleWorkspace; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: ws.cycle.name, periodLabel: ws.cycle.periodLabel, selfDueAt: ws.cycle.selfDueAt, leaderDueAt: ws.cycle.leaderDueAt, reason: "" });
  const opened = ws.cycle.status !== "DRAFT" && ws.cycle.status !== "PREPARED";
  const datesChanged = form.selfDueAt !== ws.cycle.selfDueAt || form.leaderDueAt !== ws.cycle.leaderDueAt;
  const needsReason = opened && datesChanged;
  return (
    <PerformanceModal
      open
      title="Editar ciclo"
      subtitle="Mudança de prazo fica registrada com o valor anterior."
      saveLabel="Salvar"
      footerHint={needsReason ? "Prazo alterado depois da abertura pede motivo." : ""}
      canSave={form.name.trim().length >= 3 && form.leaderDueAt >= form.selfDueAt && (!needsReason || form.reason.trim().length >= 8)}
      size="md"
      testId="perf-cycle-edit-dialog"
      onClose={onClose}
      onSave={async () => {
        await updatePerformanceCycle(ws.cycle.id, form);
        onDone();
      }}
    >
      <OverlayFieldGrid columns={2}>
        <OverlayField label="Nome" required>
          {(p) => <OverlayInput {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </OverlayField>
        <OverlayField label="Referência" required>
          {(p) => <OverlayInput {...p} value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} />}
        </OverlayField>
        <OverlayField label="Prazo da autoavaliação" required>
          {(p) => <OverlayInput {...p} type="date" value={form.selfDueAt} onChange={(e) => setForm({ ...form, selfDueAt: e.target.value })} />}
        </OverlayField>
        <OverlayField label="Prazo do líder" required>
          {(p) => <OverlayInput {...p} type="date" value={form.leaderDueAt} onChange={(e) => setForm({ ...form, leaderDueAt: e.target.value })} />}
        </OverlayField>
      </OverlayFieldGrid>
      {needsReason ? <ReasonField label="Motivo da mudança de prazo" value={form.reason} onChange={(reason) => setForm({ ...form, reason })} /> : null}
    </PerformanceModal>
  );
}

type Preview = { employeeId: string; name: string; eligibility: string; reason: string; alreadyInCycle: boolean; managerName: string | null };

function AddPeopleDialog({ ws, onClose, onDone }: { ws: CycleWorkspace; onClose: () => void; onDone: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryPerson[]>([]);
  const [picked, setPicked] = useState<Record<string, DirectoryPerson>>({});
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [exceptions, setExceptions] = useState<Record<string, string>>({} as Record<string, string>);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inCycle = new Set(ws.people.filter((p) => !p.participant.removedAt).map((p) => p.participant.employeeId));

  const search = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await searchPerformanceDirectory(query);
      setResults(payload.employees);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha na busca.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void search();
  }, []);

  const selectable = results.filter((p) => !inCycle.has(p.id));
  const pickedIds = Object.keys(picked);
  const toggle = (person: DirectoryPerson) => {
    setPreview(null);
    setPicked((current) => {
      const next = { ...current };
      if (next[person.id]) delete next[person.id];
      else next[person.id] = person;
      return next;
    });
  };

  const exceptionInvalid = Object.values(exceptions).some((value: string) => value.trim().length > 0 && value.trim().length < 8);

  return (
    <PerformanceModal
      open
      title="Incluir pessoas do cadastro"
      subtitle="Busque por nome, cargo ou setor. Escolha uma a uma ou todas do resultado. Antes de incluir, confira a elegibilidade."
      saveLabel={preview ? `Incluir ${pickedIds.length} pessoa(s)` : "Conferir elegibilidade"}
      footerHint={preview ? "Pessoas não elegíveis entram na lista com o motivo e não recebem convite." : `${pickedIds.length} selecionada(s)`}
      canSave={pickedIds.length > 0 && !exceptionInvalid}
      size="xl"
      testId="perf-add-people-dialog"
      onClose={onClose}
      onSave={async () => {
        if (!preview) {
          const payload = await previewPerformanceParticipants(ws.cycle.id, pickedIds);
          setPreview(payload.people);
          return;
        }
        const cleanExceptions: Record<string, string> = {};
        for (const [employeeId, value] of Object.entries(exceptions) as [string, string][]) if (value.trim().length >= 8) cleanExceptions[employeeId] = value;
        const saved = await savePerformanceParticipants(ws.cycle.id, pickedIds, cleanExceptions);
        onDone(`${saved.added + saved.reactivated} incluída(s) · ${saved.eligible} elegíveis no ciclo${saved.duplicates ? ` · ${saved.duplicates} já estavam` : ""}`);
      }}
    >
      {!preview ? (
        <>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input className="h-10 flex-1 rounded-lg border border-border px-3 text-sm" aria-label="Buscar no cadastro" placeholder="Nome, cargo ou setor (vazio = ativos)" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="perf-add-search" />
            <button type="submit" className={BTN_SECONDARY}>
              <Search className="h-4 w-4" aria-hidden /> Buscar
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={selectable.length === 0}
              onClick={() => {
                setPreview(null);
                setPicked((current) => ({ ...current, ...Object.fromEntries(selectable.map((p) => [p.id, p])) }));
              }}
              data-testid="perf-add-select-all"
            >
              Selecionar todos ({selectable.length})
            </button>
          </form>
          <ErrorBanner message={error} />
          <TableScroll>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-10 py-2"></th>
                  <th className="py-2">Pessoa</th>
                  <th className="py-2">Cargo · setor</th>
                  <th className="py-2">Líder no cadastro</th>
                  <th className="py-2">Admissão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      Buscando…
                    </td>
                  </tr>
                ) : null}
                {results.map((person) => {
                  const already = inCycle.has(person.id);
                  return (
                    <tr key={person.id} className={already ? "opacity-60" : ""}>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          aria-label={`Selecionar ${person.name}`}
                          disabled={already}
                          checked={Boolean(picked[person.id])}
                          onChange={() => toggle(person)}
                          data-testid={`perf-add-pick-${person.name}`}
                        />
                      </td>
                      <td className="py-2 font-medium">
                        {person.name}
                        {already ? <span className="ml-2 text-xs text-muted-foreground">já no ciclo</span> : null}
                        {person.terminated || (person.status ?? "ACTIVE") !== "ACTIVE" ? <span className="ml-2 text-xs text-rose-700">inativo</span> : null}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {person.roleName} · {person.departmentName}
                      </td>
                      <td className="py-2">{person.managerName ?? <span className="text-amber-700">sem líder</span>}</td>
                      <td className="py-2 tabular-nums">{dateBr(person.admissionDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </>
      ) : (
        <div className="space-y-3" data-testid="perf-add-preview">
          <button type="button" className={BTN_GHOST} onClick={() => setPreview(null)}>
            ← Voltar à seleção
          </button>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {preview.map((row) => (
              <li key={row.employeeId} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{row.name}</span>
                  <EligibilityBadge state={row.eligibility} />
                </div>
                <p className="text-xs text-muted-foreground">{row.reason}</p>
                {row.eligibility !== "ELIGIBLE" ? (
                  <OverlayField label="Exceção do RH (opcional)" description="Só se houver motivo real. Desligado não volta por exceção.">
                    {(p) => (
                      <OverlayTextarea
                        {...p}
                        rows={2}
                        value={exceptions[row.employeeId] ?? ""}
                        placeholder="Ex.: transferido de outra unidade com mais de 1 ano de função"
                        onChange={(e) => setExceptions({ ...exceptions, [row.employeeId]: e.target.value })}
                      />
                    )}
                  </OverlayField>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </PerformanceModal>
  );
}

function ExceptionDialog({ person, onClose, onDone }: { person: WorkspacePerson; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState(person.participant.eligibilityException ?? "");
  const has = Boolean(person.participant.eligibilityException);
  return (
    <PerformanceModal
      open
      title="Exceção de elegibilidade"
      subtitle={`${person.participant.employeeName}: ${person.participant.eligibilityReason}`}
      saveLabel={reason.trim() ? "Registrar exceção" : "Remover exceção"}
      footerHint="Exceção não reabre vínculo desligado e fica registrada com o motivo."
      canSave={reason.trim().length === 0 ? has : reason.trim().length >= 8}
      size="md"
      testId="perf-exception-dialog"
      onClose={onClose}
      onSave={async () => {
        await setPerformanceEligibilityException(person.participant.id, reason.trim() || null);
        onDone(reason.trim() ? "Exceção registrada" : "Exceção removida");
      }}
    >
      <ReasonField label="Justificativa" value={reason} onChange={setReason} required={false} testId="perf-exception-reason" description="Deixe em branco para remover a exceção." />
    </PerformanceModal>
  );
}

function LeaderDialog({ person, opened, onClose, onDone }: { person: WorkspacePerson; opened: boolean; onClose: () => void; onDone: () => void }) {
  const [leader, setLeader] = useState<DirectoryPerson | null>(null);
  const [reason, setReason] = useState("");
  return (
    <PerformanceModal
      open
      title="Líder avaliador"
      subtitle={`${person.participant.employeeName} · hoje: ${person.participant.managerName ?? "sem líder"}${person.participant.managerSource === "RH" ? " (exceção do RH)" : " (cadastro)"}`}
      saveLabel="Atribuir líder"
      footerHint={opened ? "Depois da abertura, a avaliação anterior fica preservada e uma nova tarefa nasce para o novo líder." : "A troca vale só para este ciclo; o cadastro não muda."}
      canSave={Boolean(leader) && reason.trim().length >= 8}
      size="md"
      testId="perf-leader-dialog"
      onClose={onClose}
      onSave={async () => {
        await reassignPerformanceLeader(person.participant.id, leader!.id, reason);
        onDone();
      }}
    >
      <EmployeePicker value={leader} onChange={setLeader} excludeIds={[person.participant.employeeId]} label="Novo líder avaliador" testId="perf-leader-picker" />
      <ReasonField label="Motivo" value={reason} onChange={setReason} placeholder="Ex.: gestor do cadastro está afastado; a supervisora acompanha o turno" testId="perf-leader-reason" />
    </PerformanceModal>
  );
}

export function ReasonDialog({
  title,
  subtitle,
  label,
  min,
  placeholder,
  saveLabel,
  testId,
  onClose,
  onSave,
}: {
  title: string;
  subtitle: string;
  label: string;
  min: number;
  placeholder?: string;
  saveLabel: string;
  testId: string;
  onClose: () => void;
  onSave: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  return (
    <PerformanceModal open title={title} subtitle={subtitle} saveLabel={saveLabel} footerHint="Fica registrado com data e responsável." canSave={reason.trim().length >= min} size="md" testId={testId} onClose={onClose} onSave={() => onSave(reason)}>
      <ReasonField label={label} value={reason} onChange={setReason} min={min} placeholder={placeholder} testId={`${testId}-reason`} />
    </PerformanceModal>
  );
}
