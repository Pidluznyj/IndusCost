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
import { CycleGovernanceBadges } from "./CycleLifecyclePanel";
import { cn } from "@/src/lib/utils";

export function PerformanceCyclesTab({
  me,
  selectedId,
  onSelect,
  onToast,
}: {
  me: PerformanceMe;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToast: (message: string) => void;
}) {
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null);
  const [counts, setCounts] = useState<Record<string, CycleCounts>>({});
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Inativos saem da visão padrão; o RH liga a opção para consultar ou reativar.
  const [showInactive, setShowInactive] = useState(false);

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
  const listed = (cycles ?? []).filter((c) => showInactive || c.activation !== "INACTIVE" || c.id === selectedId);

  return (
    <section className="space-y-4" data-testid="perf-cycles-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          O ciclo passa por rascunho, preparação, abertura, consolidação, calibração, homologação e encerramento. Cada etapa tem a sua guarda e fica registrada.
        </p>
        {canManage ? (
          <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)} disabled={published.length === 0} title={published.length === 0 ? "Publique um modelo antes" : undefined} data-testid="perf-cycle-new">
            <CalendarPlus className="h-4 w-4" aria-hidden /> Novo ciclo
          </button>
        ) : null}
      </div>
      <ErrorBanner message={error} />
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
      {selectedId ? (
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
  const [selfDueAt, setSelfDueAt] = useState(addDaysIso(30));
  const [leaderDueAt, setLeaderDueAt] = useState(addDaysIso(45));
  // Sem padrão: quem cria escolhe se o ciclo é oficial ou de teste.
  const [classification, setClassification] = useState<"" | CycleClassification>("");
  useEffect(() => {
    if (open && !modelId && models[0]) setModelId(models[0].id);
  }, [open, models, modelId]);
  const valid = name.trim().length >= 3 && periodLabel.trim().length >= 2 && Boolean(modelId) && Boolean(selfDueAt) && leaderDueAt >= selfDueAt && classification !== "";
  return (
    <PerformanceModal
      open={open}
      title="Novo ciclo"
      subtitle="O ciclo usa uma versão publicada do modelo. As pessoas são escolhidas depois, no cadastro oficial."
      saveLabel="Criar rascunho"
      footerHint={leaderDueAt < selfDueAt ? "O prazo do líder não pode vir antes do prazo da pessoa." : "Prazos podem ser ajustados depois, com registro."}
      canSave={valid}
      onClose={onClose}
      size="md"
      testId="perf-cycle-create"
      onSave={async () => {
        if (classification === "") return;
        const created = await createPerformanceCycle({ name, periodLabel, modelId, selfDueAt, leaderDueAt, classification, leadershipModelId: leadershipModelId || null });
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
              <option value="">Não incluir</option>
              {leadershipModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · v{m.version}
                </option>
              ))}
            </OverlaySelect>
          )}
        </OverlayField>
        <OverlayField label="Prazo da autoavaliação" required>
          {(p) => <OverlayInput {...p} type="date" value={selfDueAt} onChange={(e) => setSelfDueAt(e.target.value)} />}
        </OverlayField>
        <OverlayField label="Prazo da avaliação do líder" required>
          {(p) => <OverlayInput {...p} type="date" value={leaderDueAt} onChange={(e) => setLeaderDueAt(e.target.value)} />}
        </OverlayField>
      </OverlayFieldGrid>
    </PerformanceModal>
  );
}
