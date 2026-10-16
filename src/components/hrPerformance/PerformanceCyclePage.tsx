/**
 * Gestão de pessoas › Desempenho e Cultura.
 * A tela só aparece com a feature ligada. Cortes e perguntas seguem em validação.
 */
import React, { useEffect, useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY, PANEL, PanelState } from "@/src/components/competencies/competencyUi";
import { usePerformanceFeature } from "./usePerformanceFeature";
import {
  createPerformanceCycle,
  createPerformanceModel,
  fetchLeaderQueue,
  fetchPerformanceCycles,
  fetchPerformanceDashboard,
  fetchPerformanceModels,
  publishPerformanceModel,
  transitionPerformanceCycle,
  savePerformanceQuestion,
  duplicatePerformanceModel,
} from "@/src/lib/hrPerformance/performanceClient";
import { CYCLE_STATUS_LABELS, type CycleStatus } from "@/src/lib/hrPerformance/performanceDomain";
import { LeaderAssignmentPanel } from "./LeaderAssignmentPanel";
import { CycleDesk } from "./CycleDesk";

type Tab = "ciclos" | "modelos" | "equipe" | "painel";

export function PerformanceCyclePage() {
  const enabled = usePerformanceFeature();
  if (enabled === null) return <PanelState kind="loading" message="Carregando…" />;
  if (!enabled) return <PanelState kind="empty" message="Desempenho e Cultura não está ativado neste ambiente." />;
  return <PerformanceModule />;
}

function PerformanceModule() {
  const [tab, setTab] = useState<Tab>("ciclos");
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<Awaited<ReturnType<typeof fetchPerformanceModels>>["models"]>([]);
  const [cycles, setCycles] = useState<Awaited<ReturnType<typeof fetchPerformanceCycles>> | null>(null);
  const [team, setTeam] = useState<Awaited<ReturnType<typeof fetchLeaderQueue>>["items"]>([]);
  const [selected, setSelected] = useState<string>("");
  const [board, setBoard] = useState<Awaited<ReturnType<typeof fetchPerformanceDashboard>> | null>(null);
  const [name, setName] = useState("Ciclo em validação");
  const [openAssignment, setOpenAssignment] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const [nextModels, nextCycles, nextTeam] = await Promise.all([
        fetchPerformanceModels(),
        fetchPerformanceCycles(),
        fetchLeaderQueue().catch(() => ({ items: [] })),
      ]);
      setModels(nextModels.models);
      setCycles(nextCycles);
      setTeam(nextTeam.items);
      if (!selected && nextCycles.cycles[0]) setSelected(nextCycles.cycles[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!selected) return;
    void fetchPerformanceDashboard(selected).then(setBoard).catch(() => setBoard(null));
  }, [selected]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <p className="text-sm text-muted-foreground">Gestão de pessoas › Desempenho e Cultura</p>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Desempenho, cultura e potencial</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Três resultados separados. A cultura não entra na Nine-Box. Perguntas e cortes ainda estão em validação com o RH.
          </p>
        </div>
      </header>
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["ciclos", "Ciclos"],
            ["modelos", "Modelos"],
            ["equipe", "Minha equipe"],
            ["painel", "Painel"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? BTN_PRIMARY : BTN_SECONDARY} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "modelos" && (
        <section className={`${PANEL} p-4`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input className="h-10 rounded-lg border border-border px-3 text-sm" value={name} onChange={(event) => setName(event.target.value)} aria-label="Nome do modelo" />
            <button type="button" className={BTN_PRIMARY} onClick={() => void createPerformanceModel(name).then(reload).catch((cause) => setError(cause.message))}>
              Novo rascunho
            </button>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr><th className="py-2">Modelo</th><th>Versão</th><th>Situação</th><th>Perguntas</th><th></th></tr>
            </thead>
            <tbody>
              {models.length === 0 && <tr><td className="py-6 text-muted-foreground" colSpan={5}>Nenhum modelo ainda.</td></tr>}
              {models.map((model) => (
                <tr key={model.id} className="border-t border-border">
                  <td className="py-2 font-medium">{model.name}</td>
                  <td>{model.version}</td>
                  <td>{model.status === "DRAFT" ? "Rascunho · em validação" : model.status === "PUBLISHED" ? "Publicado · não homologado" : "Arquivado"}</td>
                  <td>{model.questionCount}</td>
                  <td>
                    {model.status === "DRAFT" && (
                      <>
                        <button type="button" className={BTN_SECONDARY} onClick={() => {
                          const selfText = window.prompt("Texto para a pessoa (DT-01)") ?? "";
                          const leaderText = window.prompt("Texto para o líder (DT-01)") ?? "";
                          if (selfText.length < 8 || leaderText.length < 8) return setError("A pergunta precisa de texto para a pessoa e para o líder.");
                          void savePerformanceQuestion(model.id, "DT-01", selfText, leaderText, "").then(reload).catch((cause) => setError(cause.message));
                        }}>Editar DT-01</button>
                        <button type="button" className={BTN_SECONDARY} onClick={() => void publishPerformanceModel(model.id).then(reload).catch((cause) => setError(cause.message))}>
                          Publicar versão
                        </button>
                      </>
                    )}
                    {model.status === "PUBLISHED" && (
                      <button type="button" className={BTN_SECONDARY} onClick={() => void duplicatePerformanceModel(model.id).then(reload).catch((cause) => setError(cause.message))}>
                        Duplicar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {tab === "ciclos" && (
        <section className={`${PANEL} p-4`}>
          <CycleForm models={models} onCreated={reload} onError={setError} />
          <ul className="mt-4 divide-y divide-border">
            {(cycles?.cycles ?? []).map((cycle) => (
              <li key={cycle.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">{cycle.name}</p>
                  <p className="text-sm text-muted-foreground">{cycle.periodLabel} · {CYCLE_STATUS_LABELS[cycle.status as CycleStatus] ?? cycle.status}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={BTN_SECONDARY} onClick={() => setSelected(cycle.id)}>Ver painel</button>
                  {cycle.status === "DRAFT" && <button type="button" className={BTN_PRIMARY} onClick={() => void transitionPerformanceCycle(cycle.id, "PREPARED").then(reload).catch((cause) => setError(cause.message))}>Preparar</button>}
                  {cycle.status === "PREPARED" && <button type="button" className={BTN_PRIMARY} onClick={() => {
                    if (!window.confirm("As perguntas e os cortes ainda estão em proposta. Abrir este ciclo como piloto?")) return;
                    void transitionPerformanceCycle(cycle.id, "OPEN", undefined, true).then(reload).catch((cause) => setError(cause.message));
                  }}>Abrir piloto</button>}
                </div>
              </li>
            ))}
            {(cycles?.cycles.length ?? 0) === 0 && <li className="py-6 text-sm text-muted-foreground">Nenhum ciclo. A abertura pede confirmação de que as regras ainda estão em proposta.</li>}
          </ul>
          {selected && <CycleDesk cycleId={selected} onError={setError} />}
        </section>
      )}
      {tab === "equipe" && (
        <section className={`${PANEL} p-4`}>
          {team.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma avaliação de liderado para você. A autoavaliação da equipe não aparece aqui antes do seu envio.</p>}
          <ul className="divide-y divide-border">
            {team.map((item) => (
              <li key={item.assignmentId} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">{item.employeeName}</p>
                  <p className="text-sm text-muted-foreground">{item.roleName} · {item.departmentName}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm">{item.status === "SUBMITTED" ? "Enviada" : item.status === "IN_PROGRESS" ? "Em andamento" : "Não iniciada"}</span>
                  <button type="button" className={BTN_SECONDARY} onClick={() => setOpenAssignment(item.assignmentId)}>Abrir</button>
                </div>
              </li>
            ))}
          </ul>
          {openAssignment && <LeaderAssignmentPanel assignmentId={openAssignment} onClose={() => { setOpenAssignment(null); void reload(); }} />}
        </section>
      )}
      {tab === "painel" && board && (
        <section className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Count label="Elegíveis" value={board.eligible} />
            <Count label="Não elegíveis" value={board.notEligible} />
            <Count label="Evidência insuficiente" value={board.insufficient} />
            <Count label="Autoavaliações enviadas" value={board.selfSubmitted} />
            <Count label="Avaliações do líder" value={board.leaderSubmitted} />
          </div>
          <NineBox cells={board.cells} />
        </section>
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className={`${PANEL} p-3`}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

const BOXES = [
  ["Desempenho baixo · Potencial alto", "Desempenho médio · Potencial alto", "Desempenho alto · Potencial alto"],
  ["Desempenho baixo · Potencial médio", "Desempenho médio · Potencial médio", "Desempenho alto · Potencial médio"],
  ["Desempenho baixo · Potencial baixo", "Desempenho médio · Potencial baixo", "Desempenho alto · Potencial baixo"],
];

function NineBox({ cells }: { cells: { name: string; quadrant: string; official: boolean; cultureBand: string | null }[] }) {
  return (
    <section className={`${PANEL} p-4`}>
      <h2 className="font-semibold">Nine-Box preliminar</h2>
      <p className="mb-3 text-sm text-muted-foreground">Eixo horizontal: desempenho técnico validado. Eixo vertical: potencial. Cultura fica ao lado, fora da matriz. Posição oficial só depois da homologação.</p>
      <div className="grid grid-cols-3 gap-2">
        {BOXES.flat().map((label) => {
          const people = cells.filter((cell) => cell.quadrant === label);
          return (
            <div key={label} className="min-h-24 rounded-lg border border-border p-2">
              <p className="text-xs font-medium">{label}</p>
              <p className="text-lg font-semibold">{people.length}</p>
              <ul className="text-xs text-muted-foreground">
                {people.map((person) => (
                  <li key={person.name}>{person.name}{person.official ? "" : " · preliminar"}{person.cultureBand ? ` · cultura ${person.cultureBand}` : ""}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-sm">Sem classificação: {cells.filter((cell) => cell.quadrant === "SEM_CLASSIFICACAO").length}</p>
    </section>
  );
}

function CycleForm({ models, onCreated, onError }: { models: { id: string; name: string; status: string }[]; onCreated: () => Promise<void>; onError: (message: string) => void }) {
  const published = models.filter((model) => model.status === "PUBLISHED");
  const [modelId, setModelId] = useState(published[0]?.id ?? "");
  const [name, setName] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  return (
    <form
      className="grid gap-2 md:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        void createPerformanceCycle({ name, periodLabel, modelId, selfDueAt: "2026-11-30", leaderDueAt: "2026-12-15" })
          .then(onCreated)
          .catch((cause) => onError(cause instanceof Error ? cause.message : "Não foi possível criar o ciclo."));
      }}
    >
      <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Nome do ciclo" aria-label="Nome do ciclo" value={name} onChange={(event) => setName(event.target.value)} />
      <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Referência, ex. 2º semestre" aria-label="Referência do ciclo" value={periodLabel} onChange={(event) => setPeriodLabel(event.target.value)} />
      <select className="h-10 rounded-lg border border-border px-3 text-sm" aria-label="Modelo publicado" value={modelId} onChange={(event) => setModelId(event.target.value)}>
        <option value="">Modelo publicado</option>
        {published.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      <button type="submit" className={BTN_PRIMARY}>Criar rascunho</button>
    </form>
  );
}
