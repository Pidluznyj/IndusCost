/**
 * Gestão de pessoas › Competências e Desenvolvimento.
 * Números vêm só da engine oficial, calculados no servidor.
 * A página só formata e recarrega após cada gravação.
 */
import React, { useCallback, useMemo, useState } from "react";
import { ClipboardCheck, FileSpreadsheet, GraduationCap, Plus } from "lucide-react";
import { OverlayTabs } from "@/src/components/ui/overlay";
import { usePermissions } from "@/src/hooks/usePermissions";
import type { UiPermissionAction } from "@/src/lib/actionPermissionAccess";
import { resolveCompetencyCapabilities } from "@/src/lib/competencies/competencyAccess";
import { deleteAssessment, deleteTraining, setCompetencyLevel, setTrainingStatus } from "@/src/lib/competencies/competencyClient";
import { businessTodayIso } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyAssessmentDto, TrainingDto } from "@/src/lib/competencies/competencyTypes";
import { CompetencyAssessmentOverlay, type AssessmentPreset } from "./CompetencyAssessmentOverlay";
import { CompetencyAssessmentsTab } from "./CompetencyAssessmentsTab";
import { CompetencyApprovalsTab } from "./CompetencyApprovalsTab";
import { CompetencyCatalogOverlay } from "./CompetencyCatalogOverlay";
import { CompetencyDepartmentsTab } from "./CompetencyDepartmentsTab";
import { CompetencyImportOverlay } from "./CompetencyImportOverlay";
import { CompetencyMatrixTab } from "./CompetencyMatrixTab";
import { CompetencyViewFilters } from "./CompetencyViewFilters";
import { CompetencyOverviewTab } from "./CompetencyOverviewTab";
import { CompetencyTrainingOverlay, type TrainingPreset } from "./CompetencyTrainingOverlay";
import { CompetencyTrainingsTab } from "./CompetencyTrainingsTab";
import { BTN_PRIMARY, BTN_SECONDARY, PanelState, Toast } from "./competencyUi";
import { useCompetencyWorkspace } from "./useCompetencyWorkspace";
import { useCompetenciesFeature } from "./useCompetenciesFeature";

type TabId = "visao" | "matriz" | "avaliacoes" | "treinamentos" | "aprovacoes" | "departamentos";

type Modal =
  | { kind: "assessment"; mode: "complete" | "schedule"; preset: AssessmentPreset | null }
  | { kind: "training"; preset: TrainingPreset | null }
  | { kind: "competency" }
  | { kind: "import" }
  | null;

/** Rota /competencies: só monta o módulo com a feature flag ligada no servidor. */
export function CompetenciesPage() {
  const enabled = useCompetenciesFeature();
  if (enabled === null) return <PanelState kind="loading" message="Carregando…" />;
  if (!enabled) {
    return (
      <PanelState
        kind="empty"
        testId="competencies-disabled"
        message="Competências e Desenvolvimento não está ativado neste ambiente."
      />
    );
  }
  return <CompetenciesModule />;
}

function CompetenciesModule() {
  const { canPerformAction } = usePermissions();
  const caps = useMemo(
    () => resolveCompetencyCapabilities((rk, action) => canPerformAction(rk, action as UiPermissionAction)),
    [canPerformAction],
  );
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState<string[]>([]);
  const [matrixGroupsOpen, setMatrixGroupsOpen] = useState<string[]>([]);
  const toggleShift = (shift: string) =>
    setShiftFilter((current) => (current.includes(shift) ? current.filter((item) => item !== shift) : [...current, shift].sort()));
  const { ws, reload } = useCompetencyWorkspace(caps, { departmentId: departmentFilter || null, shifts: shiftFilter });
  const [tab, setTab] = useState<TabId>("visao");
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const today = ws.overview.data?.asOf ?? businessTodayIso();

  const rows = ws.matrix.data?.rows ?? [];
  const competencies = ws.catalog.data ?? [];
  const pending = ws.overview.data?.pendingAssessments;
  const openTrainings = ws.overview.data?.openTrainings;
  const pendingApprovals = ws.overview.data?.pendingApprovals;
  const [refreshKey, setRefreshKey] = useState(0);

  const tabs = useMemo(
    () =>
      [
        { id: "visao" as const, label: "Visão geral" },
        { id: "matriz" as const, label: "Matriz de competências" },
        caps.viewAssessments ? { id: "avaliacoes" as const, label: "Avaliações", count: pending || undefined } : null,
        caps.viewTrainings ? { id: "treinamentos" as const, label: "Treinamentos", count: openTrainings || undefined } : null,
        caps.viewApprovals ? { id: "aprovacoes" as const, label: "Aprovações", count: pendingApprovals || undefined } : null,
        { id: "departamentos" as const, label: "Departamentos e Competências" },
      ].filter((t): t is NonNullable<typeof t> => t !== null),
    [caps.viewAssessments, caps.viewTrainings, caps.viewApprovals, pending, openTrainings, pendingApprovals],
  );
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "visao";

  const afterSave = (message: string) => {
    setModal(null);
    setToast(message);
    setRefreshKey((k) => k + 1);
    void reload();
  };

  const runAction = async (fn: () => Promise<unknown>, message: string) => {
    setActionError(null);
    try {
      await fn();
      setToast(message);
      void reload();
    } catch (error) {
      setActionError(error instanceof Error && error.message ? error.message : "Não foi possível concluir a ação.");
    }
  };

  const onSetLevel = async (employeeId: string, competencyId: string, level: number, expectedVersion: number) => {
    setActionError(null);
    try {
      const result = await setCompetencyLevel(employeeId, competencyId, level, expectedVersion);
      setToast(result.outcome === "REQUESTED" ? "Solicitação enviada para aprovação" : "Nível atualizado na matriz");
      setRefreshKey((k) => k + 1);
      void reload(["overview", "matrix"]);
    } catch (error) {
      setActionError(error instanceof Error && error.message ? error.message : "Não foi possível alterar o nível.");
      void reload(["overview", "matrix"]); // 409: mostra o valor atual
      throw error;
    }
  };

  const onCompleteAssessment = (a: CompetencyAssessmentDto) =>
    setModal({
      kind: "assessment",
      mode: "complete",
      preset: { assessmentId: a.id, employeeId: a.employeeId, evaluatorEmployeeId: a.evaluatorEmployeeId, assessmentDate: a.assessmentDate, notes: a.notes },
    });

  const onDeleteAssessment = (a: CompetencyAssessmentDto) => {
    if (!window.confirm(`Excluir a avaliação ${a.status === "PENDING" ? "pendente" : "em andamento"} de ${a.employeeName}?`)) return;
    void runAction(() => deleteAssessment(a.id), "Avaliação excluída");
  };

  const onTrainingStatus = (t: TrainingDto, status: "IN_PROGRESS" | "COMPLETED") => {
    if (status === "COMPLETED" && !window.confirm(`Concluir "${t.title}"? A conclusão vale para os ${t.participants.length} participante(s).`)) return;
    void runAction(() => setTrainingStatus(t.id, status), status === "COMPLETED" ? "Treinamento concluído" : "Treinamento iniciado");
  };

  const onDeleteTraining = (t: TrainingDto) => {
    if (!window.confirm(`Excluir o treinamento "${t.title}"?`)) return;
    void runAction(() => deleteTraining(t.id), "Treinamento excluído");
  };

  if (!caps.view) {
    return <PanelState kind="error" message="Você não tem acesso a Competências e Desenvolvimento." testId="competencies-forbidden" />;
  }

  return (
    <div className="space-y-6" data-testid="competencies-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight">Competências e Desenvolvimento</h2>
          <p className="text-muted-foreground">
            Competências por departamento, avaliações individuais, evolução e treinamentos da equipe.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2" data-testid="competencies-actions">
          {caps.manageCatalog ? (
            <>
              <button type="button" className={BTN_SECONDARY} onClick={() => setModal({ kind: "competency" })}>
                <Plus className="h-4 w-4" aria-hidden /> Competência
              </button>
              <button type="button" className={BTN_SECONDARY} onClick={() => setTab("departamentos")} data-testid="competencies-manage-departments">
                Gerenciar competências
              </button>
            </>
          ) : null}
          {caps.editMatrix ? (
            <button type="button" className={BTN_SECONDARY} onClick={() => setModal({ kind: "import" })} data-testid="competencies-import">
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> Importar planilha
            </button>
          ) : null}
          {caps.manageTrainings ? (
            <button type="button" className={BTN_SECONDARY} onClick={() => setModal({ kind: "training", preset: null })}>
              <GraduationCap className="h-4 w-4" aria-hidden /> Treinamento
            </button>
          ) : null}
          {caps.registerAssessment ? (
            <button type="button" className={BTN_PRIMARY} onClick={() => setModal({ kind: "assessment", mode: "complete", preset: null })}>
              <ClipboardCheck className="h-4 w-4" aria-hidden /> Nova avaliação
            </button>
          ) : null}
        </div>
      </div>

      {activeTab === "visao" || activeTab === "matriz" ? (
        <CompetencyViewFilters
          departmentId={departmentFilter}
          departments={ws.options.data?.departments ?? []}
          shifts={shiftFilter}
          onDepartmentChange={setDepartmentFilter}
          onToggleShift={toggleShift}
        />
      ) : null}

      <OverlayTabs<TabId> tabs={tabs} active={activeTab} onChange={setTab} variant="pill" ariaLabel="Seções de competências" testId="competencies-tabs" />

      {ws.overview.data && ws.overview.data.scope !== "ALL" ? (
        <div role="status" data-testid="competencies-scope-notice" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {ws.overview.data.scope === "TEAM"
            ? "Você está vendo a sua equipe. Avaliações, níveis e treinamentos valem só para os seus liderados."
            : ws.overview.data.scope === "SELF"
              ? "Você está vendo apenas o seu próprio registro, sem permissão de alteração."
              : "Seu usuário não está vinculado a um colaborador com equipe. Não há dados no seu escopo."}
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {actionError}
        </div>
      ) : null}

      {activeTab === "visao" ? (
        <CompetencyOverviewTab overview={ws.overview} onRetry={() => void reload(["overview"])} />
      ) : null}
      {activeTab === "matriz" ? (
        <CompetencyMatrixTab
          matrix={ws.matrix}
          canEdit={caps.editMatrix}
          onSetLevel={onSetLevel}
          onRetry={() => void reload(["matrix"])}
          departmentId={departmentFilter}
          departments={ws.options.data?.departments ?? []}
          shifts={shiftFilter}
          onDepartmentChange={setDepartmentFilter}
          onToggleShift={toggleShift}
          expandedKeys={matrixGroupsOpen}
          onExpandedKeysChange={setMatrixGroupsOpen}
        />
      ) : null}
      {activeTab === "avaliacoes" ? (
        <CompetencyAssessmentsTab
          assessments={ws.assessments}
          canRegister={caps.registerAssessment}
          onSchedule={() => setModal({ kind: "assessment", mode: "schedule", preset: null })}
          onComplete={onCompleteAssessment}
          onDelete={onDeleteAssessment}
          onRetry={() => void reload(["assessments"])}
        />
      ) : null}
      {activeTab === "treinamentos" ? (
        <CompetencyTrainingsTab
          trainings={ws.trainings}
          canManage={caps.manageTrainings}
          onStatus={onTrainingStatus}
          onDelete={onDeleteTraining}
          onRetry={() => void reload(["trainings"])}
        />
      ) : null}
      {activeTab === "aprovacoes" ? (
        <CompetencyApprovalsTab
          canDecide={caps.approveLevels}
          refreshKey={refreshKey}
          onDecided={(message) => {
            setToast(message);
            void reload(["overview", "matrix"]);
          }}
        />
      ) : null}
      {activeTab === "departamentos" ? <CompetencyDepartmentsTab canManage={caps.manageCatalog} /> : null}

      <CompetencyAssessmentOverlay
        open={modal?.kind === "assessment"}
        mode={modal?.kind === "assessment" ? modal.mode : "complete"}
        preset={modal?.kind === "assessment" ? modal.preset : null}
        today={today}
        rows={rows}
        competencies={competencies}
        evaluators={ws.options.data?.employees ?? []}
        onClose={() => setModal(null)}
        onSaved={afterSave}
      />
      <CompetencyTrainingOverlay
        open={modal?.kind === "training"}
        preset={modal?.kind === "training" ? modal.preset : null}
        today={today}
        rows={rows}
        competencies={competencies}
        onClose={() => setModal(null)}
        onSaved={afterSave}
      />
      <CompetencyCatalogOverlay open={modal?.kind === "competency"} onClose={() => setModal(null)} onSaved={afterSave} />
      <CompetencyImportOverlay open={modal?.kind === "import"} onClose={() => setModal(null)} onSaved={afterSave} />
      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}
