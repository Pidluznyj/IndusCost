/**
 * Gestão de pessoas › Desempenho e Cultura.
 * A tela só aparece com a feature ligada. As abas seguem as capacidades devolvidas pelo
 * servidor (/me); o servidor recusa o resto mesmo que alguém chame a API direto.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { OverlayTabs } from "@/src/components/ui/overlay";
import { useAuthOptional } from "@/src/contexts/AuthContext";
import { fetchPerformanceMe, type PerformanceMe } from "@/src/lib/hrPerformance/performanceClient";
import { usePerformanceFeature } from "./usePerformanceFeature";
import { InfoBanner, PanelState, useToast } from "./performanceUi";
import { PerformanceCyclesTab } from "./PerformanceCyclesTab";
import { PerformanceModelsTab } from "./PerformanceModelsTab";
import { PerformanceTeamTab } from "./PerformanceTeamTab";
import { PerformanceCalibrationTab } from "./PerformanceCalibrationTab";
import { PerformanceNineBoxTab } from "./PerformanceNineBoxTab";
import { PerformancePdiTab } from "./PerformancePdiTab";
import { PerformanceDashboardTab } from "./PerformanceDashboardTab";
import { PerformanceTrackingTab } from "./PerformanceTrackingTab";

type TabId = "acompanhamento" | "ciclos" | "equipe" | "calibracao" | "ninebox" | "pdi" | "painel" | "modelos";
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

  useEffect(() => {
    void fetchPerformanceMe()
      .then(setMe)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar o seu acesso."));
  }, []);

  const caps = me?.capabilities;
  const tabs = useMemo(
    () =>
      [
        // Abas por capacidade: o RH Operacional vê acompanhamento, ciclos, calibração (situação), painel e modelos;
        // Nine-Box e devolutivas só para quem avalia a equipe ou consulta resultados.
        caps?.track ? { id: "acompanhamento" as const, label: "Acompanhamento" } : null,
        caps?.view ? { id: "ciclos" as const, label: "Ciclos" } : null,
        caps?.evaluate ? { id: "equipe" as const, label: "Minha equipe" } : null,
        caps?.calibrate || caps?.calibrationView ? { id: "calibracao" as const, label: "Calibração" } : null,
        caps?.evaluate || caps?.results ? { id: "ninebox" as const, label: "Nine-Box" } : null,
        caps?.evaluate || caps?.results ? { id: "pdi" as const, label: "Devolutivas e PDI" } : null,
        caps?.view ? { id: "painel" as const, label: "Painel" } : null,
        caps?.view ? { id: "modelos" as const, label: "Modelos" } : null,
      ].filter((t): t is NonNullable<typeof t> => t !== null),
    [caps]
  );
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? "ciclos";
  const selectTab = (id: TabId) => {
    setTab(id);
    store(TAB_KEY, id);
  };
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
      <OverlayTabs<TabId> tabs={tabs} active={active} onChange={selectTab} variant="pill" ariaLabel="Seções de desempenho" testId="perf-tabs" />
      {active === "acompanhamento" ? <PerformanceTrackingTab cycleId={cycleId} caps={caps} onSelectCycle={selectCycle} onToast={toast.setToast} /> : null}
      {active === "ciclos" ? (
        <React.Fragment key={version}>
          <PerformanceCyclesTab me={me} selectedId={cycleId} onSelect={selectCycle} onToast={toast.setToast} />
        </React.Fragment>
      ) : null}
      {active === "equipe" ? <PerformanceTeamTab onToast={toast.setToast} actorName={actorName} linkedEmployee={Boolean(me.actorEmployeeId)} /> : null}
      {active === "calibracao" ? (
        <PerformanceCalibrationTab cycleId={cycleId} onToast={toast.setToast} canCalibrate={Boolean(caps.calibrate)} canHomologate={Boolean(caps.homologate ?? caps.calibrate)} canSeeHistory={Boolean(caps.calibrate || caps.results)} />
      ) : null}
      {active === "ninebox" ? <PerformanceNineBoxTab cycleId={cycleId} canReport={caps.report} /> : null}
      {active === "pdi" ? <PerformancePdiTab cycleId={cycleId} canReport={caps.report} actorName={actorName} onToast={toast.setToast} /> : null}
      {active === "painel" ? <PerformanceDashboardTab cycleId={cycleId} /> : null}
      {active === "modelos" ? <PerformanceModelsTab canManage={Boolean(caps.models ?? caps.manage)} onToast={toast.setToast} onChanged={() => setVersion((v) => v + 1)} /> : null}
      {toast.node}
    </div>
  );
}
