/**
 * Gestão de pessoas › Desempenho e Cultura.
 * A tela só aparece com a feature ligada. As abas seguem as capacidades devolvidas pelo
 * servidor (/me); o servidor recusa o resto mesmo que alguém chame a API direto.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthOptional } from "@/src/contexts/AuthContext";
import {
  fetchMyPerformancePending,
  fetchPerformanceCycles,
  fetchPerformanceMe,
  myPerformanceApi,
  PERFORMANCE_NAVIGATE_EVENT,
  type PerformanceMe,
  type TeamNotices,
} from "@/src/lib/hrPerformance/performanceClient";
import { PerformancePortalPage } from "./PerformancePortalPage";
import { usePerformanceFeature } from "./usePerformanceFeature";
import { InfoBanner, PanelState, useToast } from "./performanceUi";
import { cn } from "@/src/lib/utils";
import { PerformanceCyclesTab } from "./PerformanceCyclesTab";
import { PerformanceModelsTab } from "./PerformanceModelsTab";
import { PerformanceTeamTab } from "./PerformanceTeamTab";
import { PerformanceCalibrationTab } from "./PerformanceCalibrationTab";
import { PerformanceNineBoxTab } from "./PerformanceNineBoxTab";
import { PerformancePdiTab } from "./PerformancePdiTab";
import { PerformanceDashboardTab } from "./PerformanceDashboardTab";
import { PerformanceTrackingTab } from "./PerformanceTrackingTab";

type TabId = "acompanhamento" | "ciclos" | "minha" | "equipe" | "calibracao" | "ninebox" | "pdi" | "painel" | "modelos";
const TAB_KEY = "ic-perf-tab";
const CYCLE_KEY = "ic-perf-cycle";

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* navegação privada: sem memória da aba */
  }
}

export function PerformanceCyclePage() {
  const enabled = usePerformanceFeature();
  if (enabled === null) return <PanelState kind="loading" message="Carregando…" />;
  if (!enabled) return <PanelState kind="empty" testId="perf-disabled" message="Desempenho e Cultura não está ativado neste ambiente." />;
  return <PerformanceModule />;
}

function PerformanceModule() {
  const auth = useAuthOptional();
  const actorName = auth?.authUser?.name ?? "";
  const [me, setMe] = useState<PerformanceMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>((readStored(TAB_KEY) as TabId) || "ciclos");
  const [cycleId, setCycleId] = useState<string | null>(readStored(CYCLE_KEY));
  const [version, setVersion] = useState(0);
  const toast = useToast();
  // Ciclos ativos e existentes: as outras abas nunca trabalham com ciclo inativo ou excluído.
  const [activeCycleIds, setActiveCycleIds] = useState<string[] | null>(null);
  const [pending, setPending] = useState<TeamNotices | null>(null);

  useEffect(() => {
    void fetchPerformanceMe()
      .then(setMe)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar o seu acesso."));
  }, []);

  const caps = me?.capabilities;
  // Grupos por intenção: operar o ciclo, avaliar e calibrar, ler resultados, configurar.
  const GROUP_OF: Record<TabId, string> = { acompanhamento: "Operar", ciclos: "Operar", minha: "Avaliar e calibrar", equipe: "Avaliar e calibrar", calibracao: "Avaliar e calibrar", ninebox: "Resultados", pdi: "Resultados", painel: "Resultados", modelos: "Configurar" };
  const tabs = useMemo(
    () =>
      [
        // Abas por capacidade: o RH Operacional vê acompanhamento, ciclos, calibração (situação), painel e modelos;
        // Nine-Box e devolutivas só para quem avalia a equipe ou consulta resultados.
        caps?.track ? { id: "acompanhamento" as const, label: "Acompanhamento" } : null,
        caps?.view ? { id: "ciclos" as const, label: "Ciclos" } : null,
        // Autoavaliação dentro do sistema: quem tem o usuário ligado ao próprio cadastro responde aqui, sem QR.
        caps?.view && me?.actorEmployeeId ? { id: "minha" as const, label: "Minha avaliação" } : null,
        caps?.evaluate ? { id: "equipe" as const, label: "Minha equipe" } : null,
        caps?.calibrate || caps?.calibrationView ? { id: "calibracao" as const, label: "Calibração" } : null,
        caps?.evaluate || caps?.results ? { id: "ninebox" as const, label: "Nine-Box" } : null,
        caps?.evaluate || caps?.results ? { id: "pdi" as const, label: "Devolutivas e PDI" } : null,
        caps?.view ? { id: "painel" as const, label: "Painel" } : null,
        caps?.view ? { id: "modelos" as const, label: "Modelos" } : null,
      ].filter((t): t is NonNullable<typeof t> => t !== null),
    [caps, me?.actorEmployeeId]
  );
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? "ciclos";

  // Recarrega ao trocar de aba: um ciclo inativado ou excluído na aba Ciclos some das demais.
  useEffect(() => {
    if (!caps?.view) return;
    void fetchPerformanceCycles()
      .then((payload) => setActiveCycleIds(payload.cycles.filter((c) => c.activation !== "INACTIVE").map((c) => c.id)))
      .catch(() => setActiveCycleIds(null));
  }, [caps?.view, active, version]);
  const workingCycleId = activeCycleIds === null ? null : cycleId && activeCycleIds.includes(cycleId) ? cycleId : activeCycleIds[0] ?? null;
  const selectTab = useCallback((id: TabId) => {
    setTab(id);
    store(TAB_KEY, id);
  }, []);
  // Outras abas pedem a troca (ex.: a dica do ciclo aberto leva a "Minha equipe").
  useEffect(() => {
    const go = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      if (tab && tab in GROUP_OF) selectTab(tab as TabId);
    };
    window.addEventListener(PERFORMANCE_NAVIGATE_EVENT, go);
    return () => window.removeEventListener(PERFORMANCE_NAVIGATE_EVENT, go);
  }, [selectTab]);
  // "Falta com você": recarrega ao trocar de aba (enviar a autoavaliação ou avaliar alguém muda a conta).
  useEffect(() => {
    if (!caps?.view || !me?.actorEmployeeId) return;
    void fetchMyPerformancePending()
      .then(setPending)
      .catch(() => setPending(null));
  }, [caps?.view, me?.actorEmployeeId, active, version]);
  const selectCycle = useCallback((id: string | null) => {
    setCycleId(id);
    store(CYCLE_KEY, id);
  }, []);

  if (error) return <PanelState kind="error" message={error} />;
  if (!me) return <PanelState kind="loading" message="Carregando…" />;
  if (!caps?.view) return <PanelState kind="error" testId="perf-forbidden" message="Você não tem acesso a Desempenho e Cultura." />;

  return (
    <div className="space-y-6" data-testid="perf-page">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm text-muted-foreground">Gestão de pessoas › Desempenho e Cultura</p>
        <h2 className="text-3xl font-bold tracking-tight">Desempenho, Cultura e Potencial</h2>
        <p className="max-w-4xl text-muted-foreground">
          Três resultados separados: desempenho técnico, cultura e potencial. A cultura não entra na Nine-Box. Perguntas, escala e cortes estão em validação com o RH.
        </p>
      </div>
      {me.accessScope !== "ALL" ? (
        <InfoBanner testId="perf-scope-notice">
          {me.actorEmployeeId ? "Você vê a sua equipe e as avaliações atribuídas a você." : "Seu usuário não está ligado a um colaborador. Peça ao RH o vínculo para ver a sua equipe."}
        </InfoBanner>
      ) : null}
      {pending ? <PendingBanner pending={pending} canTeam={Boolean(caps.evaluate)} onGo={selectTab} /> : null}
      <nav role="tablist" aria-label="Seções de desempenho" data-testid="perf-tabs" className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
        {["Operar", "Avaliar e calibrar", "Resultados", "Configurar"].map((group) => {
          const inGroup = tabs.filter((t) => GROUP_OF[t.id] === group);
          if (inGroup.length === 0) return null;
          return (
            <div key={group} className="flex flex-col gap-1" data-testid={`perf-tab-group-${group}`}>
              <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
              <div className="flex flex-wrap gap-1">
                {inGroup.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === active}
                    onClick={() => selectTab(t.id)}
                    data-testid={`perf-tabs-tab-${t.id}`}
                    className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", t.id === active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      {active === "acompanhamento" ? <PerformanceTrackingTab cycleId={workingCycleId} caps={caps} onSelectCycle={selectCycle} onToast={toast.setToast} /> : null}
      {active === "ciclos" ? (
        <React.Fragment key={version}>
          <PerformanceCyclesTab me={me} selectedId={cycleId} onSelect={selectCycle} onToast={toast.setToast} onGoToModels={() => selectTab("modelos")} />
        </React.Fragment>
      ) : null}
      {active === "minha" ? (
        <div className="max-w-2xl">
          {/* Sem remontar a tela: o envio só atualiza o aviso "Falta com você" (a confirmação continua à vista). */}
          <PerformancePortalPage api={myPerformanceApi} embedded onFinished={() => setVersion((v) => v + 1)} />
        </div>
      ) : null}
      {active === "equipe" ? <PerformanceTeamTab onToast={toast.setToast} actorName={actorName} linkedEmployee={Boolean(me.actorEmployeeId)} /> : null}
      {active === "calibracao" ? (
        <PerformanceCalibrationTab cycleId={workingCycleId} onToast={toast.setToast} canCalibrate={Boolean(caps.calibrate)} canHomologate={Boolean(caps.homologate ?? caps.calibrate)} canSeeHistory={Boolean(caps.calibrate || caps.results)} />
      ) : null}
      {active === "ninebox" ? <PerformanceNineBoxTab cycleId={workingCycleId} canReport={caps.report} /> : null}
      {active === "pdi" ? <PerformancePdiTab cycleId={workingCycleId} canReport={caps.report} actorName={actorName} onToast={toast.setToast} /> : null}
      {active === "painel" ? <PerformanceDashboardTab cycleId={workingCycleId} /> : null}
      {active === "modelos" ? <PerformanceModelsTab canManage={Boolean(caps.models ?? caps.manage)} onToast={toast.setToast} onChanged={() => setVersion((v) => v + 1)} /> : null}
      {toast.node}
    </div>
  );
}

/** O que está pendente com a pessoa agora, em linguagem simples e com o atalho para a aba certa. */
function PendingBanner({ pending, canTeam, onGo }: { pending: TeamNotices; canTeam: boolean; onGo: (tab: TabId) => void }) {
  const items: { key: string; text: string; tab: TabId; action: string }[] = [];
  if (pending.myJourney?.open) items.push({ key: "self", text: `${pending.myJourney.title} (${pending.myJourney.cycleName})`, tab: "minha", action: "Minha avaliação" });
  if (canTeam && pending.pendingLeader > 0)
    items.push({ key: "leader", text: `${pending.pendingLeader} avaliação(ões) de liderado(s)`, tab: "equipe", action: "Minha equipe" });
  if (canTeam && pending.pendingCalibration > 0)
    items.push({ key: "calibration", text: `${pending.pendingCalibration} proposta(s) de calibração e devolutiva`, tab: "equipe", action: "Minha equipe" });
  const waiting = pending.myJourney && !pending.myJourney.open ? pending.myJourney.message : null;
  if (items.length === 0 && !waiting) return null;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" data-testid="perf-pending-banner">
      {items.length ? (
        <>
          <p className="font-semibold">Falta com você: {items.length}</p>
          <ul className="mt-1 space-y-1">
            {items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-2" data-testid={`perf-pending-${item.key}`}>
                <span>{item.text}</span>
                <button type="button" className="font-medium underline underline-offset-2" onClick={() => onGo(item.tab)}>
                  → {item.action}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {waiting ? <p className={items.length ? "mt-2 text-amber-900/80 dark:text-amber-100/80" : ""}>Sua próxima etapa: {waiting}</p> : null}
    </div>
  );
}
