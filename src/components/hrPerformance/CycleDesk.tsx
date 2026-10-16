/**
 * Operação do ciclo: pessoas, convites, calibração, devolutiva e PDI.
 * O código falado não entra na ficha impressa.
 */
import React, { useEffect, useMemo, useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY, PANEL } from "@/src/components/competencies/competencyUi";
import { CYCLE_STATUS_LABELS, type CycleStatus } from "@/src/lib/hrPerformance/performanceDomain";
import {
  addPerformanceCheckin,
  calibratePerformance,
  createPerformanceFeedback,
  createPerformancePdi,
  fetchCycleWorkspace,
  issuePerformanceInvite,
  openAssistedPerformance,
  performanceReportUrl,
  reassignPerformanceLeader,
  returnPerformanceAssignment,
  savePerformanceParticipants,
  searchPerformanceDirectory,
  transitionPerformanceCycle,
  updatePerformancePdi,
  validatePerformanceTechnical,
  type CycleWorkspace,
} from "@/src/lib/hrPerformance/performanceClient";

const NEXT: Partial<Record<CycleStatus, { to: CycleStatus; label: string }>> = {
  DRAFT: { to: "PREPARED", label: "Preparar" },
  PREPARED: { to: "OPEN", label: "Abrir piloto" },
  OPEN: { to: "CONSOLIDATION", label: "Encerrar coleta" },
  CONSOLIDATION: { to: "CALIBRATION", label: "Ir para calibração" },
  CALIBRATION: { to: "HOMOLOGATED", label: "Homologar ciclo" },
  HOMOLOGATED: { to: "CLOSED", label: "Encerrar ciclo" },
};

export function CycleDesk({ cycleId, onError }: { cycleId: string; onError: (message: string) => void }) {
  const [workspace, setWorkspace] = useState<CycleWorkspace | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; roleName: string; departmentName: string; managerName: string | null }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [sector, setSector] = useState("");
  const [role, setRole] = useState("");
  const [manager, setManager] = useState("");
  const [spoken, setSpoken] = useState<{ name: string; otp: string } | null>(null);

  async function reload() {
    const next = await fetchCycleWorkspace(cycleId);
    setWorkspace(next);
    setPicked(next.people.map((item) => item.participant.employeeId));
  }

  useEffect(() => {
    void reload().catch((cause) => onError(cause instanceof Error ? cause.message : "Não foi possível abrir o ciclo."));
  }, [cycleId]);

  const visible = useMemo(() => {
    return (workspace?.people ?? []).filter((item) => {
      if (sector && item.participant.departmentName !== sector) return false;
      if (role && item.participant.roleName !== role) return false;
      if (manager && (item.participant.managerName ?? "") !== manager) return false;
      return true;
    });
  }, [workspace, sector, role, manager]);

  if (!workspace) return <p className="text-sm text-muted-foreground">Carregando o ciclo…</p>;
  const status = workspace.cycle.status as CycleStatus;
  const next = NEXT[status];
  const sectors = [...new Set(workspace.people.map((item) => item.participant.departmentName))];
  const roles = [...new Set(workspace.people.map((item) => item.participant.roleName))];
  const managers = [...new Set(workspace.people.map((item) => item.participant.managerName).filter(Boolean))] as string[];

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await reload();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    }
  }

  return (
    <section className={`${PANEL} mt-4 flex flex-col gap-4 p-4`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{workspace.cycle.name}</h2>
          <p className="text-sm text-muted-foreground">
            {workspace.cycle.periodLabel} · {CYCLE_STATUS_LABELS[status] ?? status} · prazo da pessoa {workspace.cycle.selfDueAt} · prazo do líder {workspace.cycle.leaderDueAt}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {next && (
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => {
                if (next.to === "OPEN" && !window.confirm("As perguntas e os cortes ainda estão em proposta. Abrir este ciclo como piloto?")) return;
                if (next.to === "CLOSED" && !window.confirm("Encerrar preserva o histórico e impede novas respostas. Continuar?")) return;
                const acceptPending = next.to === "CONSOLIDATION" && window.confirm("Se ainda houver pesquisa pendente, o encerramento da coleta precisa da sua confirmação. Seguir?");
                void run(() => transitionPerformanceCycle(cycleId, next.to, next.to === "CLOSED" ? "Encerramento pelo RH" : undefined, next.to === "OPEN", acceptPending));
              }}
            >
              {next.label}
            </button>
          )}
          <a className={BTN_SECONDARY} href={performanceReportUrl(cycleId, "consolidado")}>PDF do ciclo</a>
          <a className={BTN_SECONDARY} href={performanceReportUrl(cycleId, "ninebox")}>PDF da Nine-Box</a>
        </div>
      </header>

      {(status === "DRAFT" || status === "PREPARED") && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Participantes</p>
          <div className="flex gap-2">
            <input className="h-10 flex-1 rounded-lg border border-border px-3 text-sm" aria-label="Buscar colaborador" placeholder="Nome ou setor" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button type="button" className={BTN_SECONDARY} onClick={() => void searchPerformanceDirectory(query).then((payload) => setFound(payload.employees)).catch((cause) => onError(cause.message))}>Buscar</button>
            <button type="button" className={BTN_PRIMARY} onClick={() => void run(() => savePerformanceParticipants(cycleId, picked, {}))}>Aplicar seleção</button>
          </div>
          <ul className="max-h-48 overflow-auto text-sm">
            {found.map((person) => (
              <li key={person.id}>
                <label className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" checked={picked.includes(person.id)} onChange={(event) => setPicked((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} />
                  {person.name} · {person.roleName} · {person.departmentName} · líder {person.managerName || "não informado"}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <select className="h-10 rounded-lg border border-border px-2 text-sm" aria-label="Filtrar setor" value={sector} onChange={(event) => setSector(event.target.value)}>
          <option value="">Todos os setores</option>
          {sectors.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="h-10 rounded-lg border border-border px-2 text-sm" aria-label="Filtrar cargo" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">Todos os cargos</option>
          {roles.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="h-10 rounded-lg border border-border px-2 text-sm" aria-label="Filtrar gestor" value={manager} onChange={(event) => setManager(event.target.value)}>
          <option value="">Todos os gestores</option>
          {managers.map((item) => <option key={item}>{item}</option>)}
        </select>
        <button
          type="button"
          className={BTN_SECONDARY}
          onClick={() => {
            const cards = visible.filter((item) => item.self).map((item) => ({ name: item.participant.employeeName, role: item.participant.roleName, cycle: workspace.cycle.name }));
            sessionStorage.setItem("ic-perf-print-meta", JSON.stringify({ cycle: workspace.cycle.name, cards }));
            window.open("/performance-cycle/convites", "_blank", "noopener");
          }}
        >
          Abrir lote para impressão
        </button>
      </div>

      {spoken && (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          Fale este código para {spoken.name}. Ele não vai na folha impressa: <strong>{spoken.otp}</strong>
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Pessoa</th>
              <th>Elegibilidade</th>
              <th>Auto</th>
              <th>Líder</th>
              <th>Cultura</th>
              <th>Nine-Box</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const technical = item.result && item.result.technicalCount ? (item.result.technicalSum / item.result.technicalCount).toFixed(2) : "—";
              const potential = item.result && item.result.potentialCount ? (item.result.potentialSum / item.result.potentialCount).toFixed(2) : "—";
              return (
                <tr key={item.participant.id} className="border-t border-border align-top">
                  <td className="py-2">
                    <p className="font-medium">{item.participant.employeeName}</p>
                    <p className="text-muted-foreground">{item.participant.roleName} · {item.participant.departmentName}</p>
                    <p className="text-muted-foreground">Líder: {item.participant.managerName || "não informado"}</p>
                  </td>
                  <td>{item.participant.eligibility}{item.participant.eligibilityReason ? ` · ${item.participant.eligibilityReason}` : ""}</td>
                  <td>{item.self?.status ?? "—"} · convite {item.inviteStatus}{item.divergences.length ? ` · ${item.divergences.length} divergência(s)` : ""}</td>
                  <td>{item.leader?.status ?? "sem líder"}</td>
                  <td>{item.result?.cultureBand ?? "—"}</td>
                  <td>{item.result ? `${item.result.quadrant} · técnico ${technical} · potencial ${potential} · ${item.result.official ? "oficial" : "preliminar"}` : "Sem classificação"}</td>
                  <td className="flex flex-col gap-1 py-2">
                    {item.self && item.self.status !== "SUBMITTED" && (
                      <button type="button" className={BTN_SECONDARY} onClick={() => void run(async () => {
                        const issued = await issuePerformanceInvite(item.self!.id);
                        setSpoken({ name: item.participant.employeeName, otp: issued.otp });
                        const current = JSON.parse(sessionStorage.getItem("ic-perf-print-cards") || "[]") as { name: string; url: string }[];
                        sessionStorage.setItem("ic-perf-print-cards", JSON.stringify([...current.filter((card) => card.name !== item.participant.employeeName), { name: item.participant.employeeName, role: item.participant.roleName, cycle: workspace.cycle.name, url: issued.url }]));
                      })}>Gerar convite</button>
                    )}
                    {item.self && item.self.status !== "SUBMITTED" && (
                      <button type="button" className={BTN_SECONDARY} onClick={() => void run(async () => {
                        const opened = await openAssistedPerformance(item.self!.id);
                        window.open("/avaliacao#a=" + encodeURIComponent(opened.sessionToken), "_blank", "noopener");
                      })}>Preencher junto</button>
                    )}
                    {item.leader?.status === "SUBMITTED" && (
                      <button type="button" className={BTN_SECONDARY} onClick={() => {
                        const reason = window.prompt("O que o líder precisa rever?") ?? "";
                        if (reason.trim().length < 8) return onError("Descreva a revisão com pelo menos 8 caracteres.");
                        void run(() => returnPerformanceAssignment(item.leader!.id, reason));
                      }}>Pedir revisão</button>
                    )}
                    {item.result && !item.result.official && (
                      <>
                        <button type="button" className={BTN_SECONDARY} onClick={() => {
                          const note = window.prompt("Critério da função usado na validação técnica") ?? "";
                          void run(() => validatePerformanceTechnical(item.participant.id, "VALIDATED", note));
                        }}>Validar técnico</button>
                        <button type="button" className={BTN_SECONDARY} onClick={() => {
                          const note = window.prompt("Motivo da calibração") ?? "";
                          void run(() => calibratePerformance(item.participant.id, note));
                        }}>Calibrar</button>
                      </>
                    )}
                    {item.result?.official && !item.feedback && (
                      <button type="button" className={BTN_SECONDARY} onClick={() => {
                        const strength = window.prompt("Principal ponto forte") ?? "";
                        const improvement = window.prompt("Principal ponto a desenvolver") ?? "";
                        const action = window.prompt("Ação combinada") ?? "";
                        void run(() => createPerformanceFeedback({
                          participantId: item.participant.id,
                          strength,
                          improvement,
                          action,
                          ownerName: item.participant.managerName || "Liderança",
                          dueAt: workspace.cycle.leaderDueAt,
                          conversationAt: new Date().toISOString().slice(0, 10),
                          leaderEmployeeId: item.participant.managerId || item.participant.employeeId,
                        }));
                      }}>Registrar devolutiva</button>
                    )}
                    {item.feedback && item.pdis.length === 0 && (
                      <button type="button" className={BTN_SECONDARY} onClick={() => {
                        const title = window.prompt("Ação prioritária do PDI") ?? "";
                        void run(() => createPerformancePdi(item.feedback!.id, title, item.participant.managerName || "Liderança", workspace.cycle.leaderDueAt));
                      }}>Criar PDI</button>
                    )}
                    {item.pdis[0] && item.pdis[0].status !== "DONE" && (
                      <button type="button" className={BTN_SECONDARY} onClick={() => void run(async () => {
                        await addPerformanceCheckin(item.pdis[0].id, "Acompanhamento registrado na tela.");
                        await updatePerformancePdi(item.pdis[0].id, "IN_PROGRESS");
                      })}>Acompanhar PDI</button>
                    )}
                    <button type="button" className={BTN_SECONDARY} onClick={() => {
                      const managerId = window.prompt("Id do novo líder", item.participant.managerId ?? "") ?? "";
                      const managerName = window.prompt("Nome do novo líder", item.participant.managerName ?? "") ?? "";
                      if (!managerId) return;
                      void run(() => reassignPerformanceLeader(item.participant.id, managerId, managerName));
                    }}>Trocar líder</button>
                    <a className="text-sm underline" href={performanceReportUrl(cycleId, "individual", item.participant.id)}>PDF individual</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
