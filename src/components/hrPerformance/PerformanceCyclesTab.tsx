/**
 * Ciclos: lista, criação e a mesa de operação do ciclo selecionado.
 */
import React, { useCallback, useEffect, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { OverlayField, OverlayFieldGrid, OverlayInput, OverlaySelect } from "@/src/components/ui/overlay";
import {
  createPerformanceCycle,
  fetchPerformanceCycles,
  fetchPerformanceModels,
  type CycleClassification,
  type CycleCounts,
  type CycleSummary,
  type ModelSummary,
  type PerformanceMe,
} from "@/src/lib/hrPerformance/performanceClient";
import { BTN_PRIMARY, CycleStatusBadge, ErrorBanner, PANEL, PanelState, PerformanceModal, addDaysIso, dateBr } from "./performanceUi";
import { CycleDesk } from "./CycleDesk";
import { FirstCycleGuide } from "./FirstCycleGuide";
import { GlossaryList } from "./performanceGlossary";
import { fetchCycleReadiness } from "@/src/lib/hrPerformance/performanceClient";
import { CycleGovernanceBadges } from "./CycleLifecyclePanel";
import { PerformanceStageScheduleFields, scheduleBodyOf, scheduleFormProblem, type StageScheduleForm } from "./PerformanceStageScheduleFields";
import { cn } from "@/src/lib/utils";

export function PerformanceCyclesTab({
  me,
  selectedId,
  onSelect,
  onGoToModels,
  onToast,
}: {
  me: PerformanceMe;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Guia do primeiro ciclo: ir para a aba Modelos. */
  onGoToModels?: () => void;
  onToast: (message: string) => void;
}) {
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null);
  const [counts, setCounts] = useState<Record<string, CycleCounts>>({});
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Inativos saem da visão padrão; o RH liga a opção para consultar ou reativar.
  const [showInactive, setShowInactive] = useState(false);
  const [readinessOk, setReadinessOk] = useState<boolean | null>(null);

  const reload = useCallback(async () => {
    try {
      const [payload, modelPayload] = await Promise.all([fetchPerformanceCycles(), fetchPerformanceModels()]);
      setCycles(payload.cycles);
      setCounts(payload.counts);
      setModels(modelPayload.models);
      setError(null);
      const firstActive = payload.cycles.find((c) => c.activation !== "INACTIVE");
      if (selectedId && !payload.cycles.some((c) => c.id === selectedId)) onSelect(firstActive?.id ?? null);
      else if (!selectedId && firstActive) onSelect(firstActive.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os ciclos.");
    }
  }, [selectedId, onSelect]);

  useEffect(() => {
    void reload();
  }, []);

  const canManage = me.capabilities.cycles ?? me.capabilities.manage;
  const published = models.filter((m) => m.status === "PUBLISHED" && m.kind !== "LEADERSHIP");
  const leadershipModels = models.filter((m) => m.status === "PUBLISHED" && m.kind === "LEADERSHIP");
  const inactiveCount = (cycles ?? []).filter((c) => c.activation === "INACTIVE").length;
  // Sem a opção marcada, ciclo inativo não aparece nem quando é o selecionado (a seleção fica guardada no navegador).
  const listed = (cycles ?? []).filter((c) => showInactive || c.activation !== "INACTIVE");
  const activeCycles = (cycles ?? []).filter((c) => c.activation !== "INACTIVE");
  const selectedCycle = (cycles ?? []).find((c) => c.id === selectedId) ?? null;

  // Guia: prontidão do ciclo selecionado enquanto ele ainda não abriu.
  useEffect(() => {
    if (!selectedCycle || (selectedCycle.status !== "DRAFT" && selectedCycle.status !== "PREPARED")) {
      setReadinessOk(null);
      return;
    }
    void fetchCycleReadiness(selectedCycle.id)
      .then((r) => setReadinessOk(!r.blocked))
      .catch(() => setReadinessOk(null));
  }, [selectedCycle?.id, selectedCycle?.status, counts]);

  useEffect(() => {
    if (!cycles || showInactive) return;
    const selected = selectedId ? cycles.find((c) => c.id === selectedId) : null;
    if (selected && selected.activation !== "INACTIVE") return;
    // Selecionado inativo ou excluído: vai para o primeiro ciclo ativo (ou nenhum).
    const next = cycles.find((c) => c.activation !== "INACTIVE")?.id ?? null;
    if (next !== selectedId) onSelect(next);
  }, [cycles, showInactive, selectedId, onSelect]);

  return (
    <section className="space-y-4" data-testid="perf-cycles-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          O ciclo segue uma ordem: preparar, abrir, coletar, calibrar, tornar oficial, conversar e encerrar. Cada passo tem a sua guarda e fica registrado.
        </p>
        {canManage ? (
          <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)} disabled={published.length === 0} title={published.length === 0 ? "Publique um modelo antes" : undefined} data-testid="perf-cycle-new">
            <CalendarPlus className="h-4 w-4" aria-hidden /> Novo ciclo
          </button>
        ) : null}
      </div>
      <ErrorBanner message={error} />
      {canManage && cycles !== null ? (
        <FirstCycleGuide
          models={models}
          cycle={selectedCycle}
          counts={selectedId ? counts[selectedId] ?? null : null}
          readinessOk={readinessOk}
          onGo={(step) => {
            if (step === "model" || step === "leadership") onGoToModels?.();
            else if (step === "cycle") setCreating(true);
            else document.querySelector('[data-testid="perf-cycle-desk"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      ) : null}
      {inactiveCount > 0 ? (
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="h-4 w-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} data-testid="perf-show-inactive" />
          Mostrar ciclos inativos ({inactiveCount})
        </label>
      ) : null}
      {cycles === null ? (
        <div className={PANEL}>
          <PanelState kind="loading" message="Carregando ciclos…" />
        </div>
      ) : cycles.length > 0 && listed.length === 0 ? (
        <div className={PANEL} data-testid="perf-no-active-cycle">
          <PanelState kind="empty" message="Nenhum ciclo ativo. Marque “Mostrar ciclos inativos” para consultar os inativos." />
        </div>
      ) : cycles.length === 0 ? (
        <div className={PANEL}>
          <PanelState kind="empty" message={published.length === 0 ? "Nenhum ciclo. Publique um modelo na aba Modelos e depois crie o ciclo." : "Nenhum ciclo ainda. Crie o primeiro."} />
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Ciclos" data-testid="perf-cycle-list">
          {listed.map((cycle) => {
            const c = counts[cycle.id];
            const active = cycle.id === selectedId;
            return (
              <button
                key={cycle.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(cycle.id)}
                className={cn(
                  "min-w-[220px] shrink-0 rounded-xl border p-3 text-left transition-colors",
                  active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"
                )}
                data-testid={`perf-cycle-card-${cycle.name}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{cycle.name}</span>
                  <CycleStatusBadge status={cycle.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {cycle.periodLabel} · {cycle.modelName} v{cycle.modelVersion}
                </p>
                {cycle.classification === "TEST" || cycle.activation === "INACTIVE" ? (
                  <div className="mt-1">
                    <CycleGovernanceBadges governance={cycle.governance} compact />
                  </div>
                ) : null}
                {c ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.eligible} elegíveis · {c.selfSubmitted} autoavaliações · {c.leaderSubmitted} do líder
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      {selectedId && (showInactive || activeCycles.some((c) => c.id === selectedId)) ? (
        <React.Fragment key={selectedId}>
          <CycleDesk
            cycleId={selectedId}
            me={me}
            onToast={onToast}
            onChanged={(deleted?: boolean) => {
              if (deleted) onSelect(null);
              void reload();
            }}
          />
        </React.Fragment>
      ) : null}
      <CreateCycleOverlay
        open={creating}
        models={published}
        leadershipModels={leadershipModels}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          onToast("Ciclo criado em rascunho");
          onSelect(id);
          void reload();
        }}
      />
      <details className="rounded-xl border border-border bg-card p-3" data-testid="perf-glossary-details">
        <summary className="cursor-pointer text-sm font-medium">Palavras deste processo, em uma linha cada</summary>
        <div className="mt-3">
          <GlossaryList keys={["elegibilidade", "evidencia", "consolidacao", "calibrar", "homologar", "ninebox", "ascendente", "devolutiva", "pdi", "topo"]} />
        </div>
      </details>
    </section>
  );
}

function CreateCycleOverlay({
  open,
  models,
  leadershipModels,
  onClose,
  onCreated,
}: {
  open: boolean;
  models: ModelSummary[];
  leadershipModels: ModelSummary[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [leadershipModelId, setLeadershipModelId] = useState("");
  const [name, setName] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [modelId, setModelId] = useState("");
  // Sugestão de calendário em etapas (duas semanas cada); o RH ajusta ou limpa os inícios para o modo antigo.
  const [schedule, setSchedule] = useState<StageScheduleForm>(() => ({
    selfStartAt: addDaysIso(1),
    selfDueAt: addDaysIso(14),
    leaderStartAt: addDaysIso(15),
    leaderDueAt: addDaysIso(28),
    leadershipStartAt: addDaysIso(15),
    leadershipDueAt: addDaysIso(28),
    calibrationStartAt: addDaysIso(29),
    calibrationDueAt: addDaysIso(42),
  }));
  const { selfDueAt, leaderDueAt } = schedule;
  // Sem padrão: quem cria escolhe se o ciclo é oficial ou de teste.
  const [classification, setClassification] = useState<"" | CycleClassification>("");
  useEffect(() => {
    if (open && !modelId && models[0]) setModelId(models[0].id);
    // 180° vem ligada por padrão: sem ela, ninguém avalia o próprio líder.
    if (open && !leadershipModelId && leadershipModels[0]) setLeadershipModelId(leadershipModels[0].id);
  }, [open, models, modelId, leadershipModels, leadershipModelId]);
  const needsLeadership = classification === "OFFICIAL" && !leadershipModelId;
  const scheduleProblem = scheduleFormProblem(schedule, Boolean(leadershipModelId));
  const valid = name.trim().length >= 3 && periodLabel.trim().length >= 2 && Boolean(modelId) && Boolean(selfDueAt) && leaderDueAt >= selfDueAt && !scheduleProblem && classification !== "" && !needsLeadership;
  return (
    <PerformanceModal
      open={open}
      title="Novo ciclo"
      subtitle="O ciclo usa uma versão publicada do modelo. As pessoas são escolhidas depois, no cadastro oficial."
      saveLabel="Criar rascunho"
      footerHint={
        leaderDueAt < selfDueAt
          ? "O prazo do líder não pode vir antes do prazo da pessoa."
          : needsLeadership
            ? "Ciclo oficial inclui a avaliação de liderança. Publique um modelo de liderança em Modelos."
            : scheduleProblem ?? "Datas podem ser ajustadas depois, com registro."
      }
      canSave={valid}
      onClose={onClose}
      size="lg"
      testId="perf-cycle-create"
      onSave={async () => {
        if (classification === "") return;
        const created = await createPerformanceCycle({ name, periodLabel, modelId, classification, leadershipModelId: leadershipModelId || null, ...scheduleBodyOf(schedule, Boolean(leadershipModelId)) });
        onCreated(created.cycleId);
      }}
    >
      <OverlayFieldGrid columns={2}>
        <OverlayField label="Nome do ciclo" required>
          {(p) => <OverlayInput {...p} value={name} placeholder="Ex.: Ciclo 2026 · 2º semestre" onChange={(e) => setName(e.target.value)} data-testid="perf-cycle-create-name" />}
        </OverlayField>
        <OverlayField label="Referência" required>
          {(p) => <OverlayInput {...p} value={periodLabel} placeholder="2º semestre de 2026" onChange={(e) => setPeriodLabel(e.target.value)} data-testid="perf-cycle-create-period" />}
        </OverlayField>
        <OverlayField label="Tipo do ciclo" required colSpan={2}>
          {(p) => (
            <OverlaySelect {...p} value={classification} onChange={(e) => setClassification(e.target.value as "" | CycleClassification)} data-testid="perf-cycle-create-classification">
              <option value="">Escolha…</option>
              <option value="OFFICIAL">Oficial — pode compor os indicadores oficiais</option>
              <option value="TEST">Teste — nunca compõe indicadores oficiais</option>
            </OverlaySelect>
          )}
        </OverlayField>
        <OverlayField label="Modelo publicado" required colSpan={2}>
          {(p) => (
            <OverlaySelect {...p} value={modelId} onChange={(e) => setModelId(e.target.value)} data-testid="perf-cycle-create-model">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · v{m.version} · publicado em {dateBr(m.publishedAt)}
                </option>
              ))}
            </OverlaySelect>
          )}
        </OverlayField>
        <OverlayField label="Avaliação 180° de liderança" colSpan={2}>
          {(p) => (
            <OverlaySelect {...p} value={leadershipModelId} onChange={(e) => setLeadershipModelId(e.target.value)} data-testid="perf-cycle-create-leadership">
              <option value="">{classification === "OFFICIAL" ? "Obrigatória no ciclo oficial" : "Não incluir (só em ciclo de teste)"}</option>
              {leadershipModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · v{m.version}
                </option>
              ))}
            </OverlaySelect>
          )}
        </OverlayField>
      </OverlayFieldGrid>
      <PerformanceStageScheduleFields value={schedule} leadership={Boolean(leadershipModelId)} onChange={setSchedule} />
    </PerformanceModal>
  );
}
