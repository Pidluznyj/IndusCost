import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { createBrowserSafeId } from "@/src/lib/browserSafeId";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  appendGuidedComponentKind,
  appendGuidedReferenceOrigin,
  buildProjectGuidedItems,
  buildSimulatedProductRefNotes,
  type ProjectGuidedItemRow,
} from "@/src/lib/projectsGuidedFlow";
import { resolveReferencedSimulatedProductUnitCost } from "@/src/lib/projectsSimulatedProductRefs";
import {
  buildOtherCostNotes,
  findOtherCostBatchItems,
  isGuidedOtherCostItem,
  loadOtherCostBatchLines,
  parseOtherCostMeta,
  type ProjectOtherCostLine,
} from "@/src/lib/projectsOtherCostGroups";
import {
  getProjectTabPath,
  parseLegacyTabSegment,
  parseProjectTabFromPath,
  PROJECT_TABS,
  PROJECTS_BASE_PATH,
  type ProjectTabId,
} from "@/src/lib/projectsNavigation";
import { ProjectDocuments } from "@/src/components/projects/ProjectDocuments";
import { ProjectEngineeringItemModal } from "@/src/components/projects/ProjectEngineeringItemModal";
import { ProjectGuidedCostsTab } from "@/src/components/projects/ProjectGuidedCostsTab";
import { ProjectGuidedMoldModal } from "@/src/components/projects/ProjectGuidedMoldModal";
import { ProjectHistory } from "@/src/components/projects/ProjectHistory";
import { ProjectHomeAssistant } from "@/src/components/projects/ProjectHomeAssistant";
import { ProjectItemsTab } from "@/src/components/projects/ProjectItemsTab";
import { ProjectOtherCostsModal } from "@/src/components/projects/ProjectOtherCostsModal";
import { canDeleteProject, canManageProjects } from "@/src/lib/projectsPermissions";
import {
  ProjectCustomerLookupField,
  projectCustomerSelectionToPayload,
  type ProjectCustomerSelection,
} from "@/src/components/projects/ProjectCustomerLookupField";
import {
  ProjectCommercialOwnerLookupField,
  projectCommercialOwnerSelectionToPayload,
  type ProjectCommercialOwnerSelection,
} from "@/src/components/projects/ProjectCommercialOwnerLookupField";
import { ProjectDeleteConfirmModal } from "@/src/components/projects/ProjectDeleteConfirmModal";
import { ProjectDetailErrorBoundary } from "@/src/components/projects/ProjectDetailErrorBoundary";
import { ProjectSimulatedItemFormModal } from "@/src/components/projects/ProjectSimulatedItemFormModal";
import { ProjectProductSimulationPanel } from "@/src/components/projects/ProjectProductSimulationPanel";
import { ProjectSimulatedProductWorkspace } from "@/src/components/projects/ProjectSimulatedProductWorkspace";
import { ProjectStructureLineEditModal } from "@/src/components/projects/ProjectStructureLineEditModal";
import { ProjectStructureLineModal } from "@/src/components/projects/ProjectStructureLineModal";
import type {
  ProjectDashboardPayload,
  ProjectDetail,
  ProjectListResponse,
  ProjectMoldRow,
  ProjectSimulatedItemRow,
  ProjectSimulatedProductRow,
  ProjectStatus,
  ProjectStructureLineRow,
  ProjectStructureSourceType,
  ProjectType,
} from "@/src/types/projects";

const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  NEW_PRODUCT: "Novo produto",
  NEW_COMPONENT: "Novo componente",
  MOLD: "Molde",
  PRODUCT_CHANGE: "Alteração de produto",
  PRODUCT_WITH_NEW_COMPONENT: "Produto com componente novo",
  FULL_DEVELOPMENT: "Desenvolvimento completo",
  QUICK_ESTIMATE: "Estimativa rápida",
};

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "Rascunho",
  TECHNICAL_ANALYSIS: "Análise técnica",
  WAITING_QUOTATION: "Aguardando cotação",
  WAITING_INTERNAL_APPROVAL: "Aguardando aprovação interna",
  SENT_TO_CUSTOMER: "Enviado ao cliente",
  NEGOTIATION: "Negociação",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  CANCELLED: "Cancelado",
  CONVERTED: "Convertido",
};

type DeleteTarget =
  | { kind: "project"; label: string }
  | { kind: "product"; id: string; label: string }
  | { kind: "item"; id: string; label: string }
  | { kind: "structure"; id: string; label: string }
  | { kind: "structureSnapshot"; snapshotRootProductId: string; label: string }
  | { kind: "mold"; id: string; label: string }
  | { kind: "other_cost_batch"; batchId: string; label: string };

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ProjectsListView({ canManage }: { canManage: boolean }) {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<ProjectDashboardPayload | null>(null);
  const [list, setList] = useState<ProjectListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "">("");
  const [projectType, setProjectType] = useState<ProjectType | "">("");
  const [customer, setCustomer] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    projectType: "NEW_PRODUCT" as ProjectType,
    technicalOwner: "",
    targetMarginPercent: "",
  });
  const [customerSelection, setCustomerSelection] = useState<ProjectCustomerSelection>(null);
  const [customerDraft, setCustomerDraft] = useState("");
  const [commercialSelection, setCommercialSelection] = useState<ProjectCommercialOwnerSelection>(null);
  const [commercialDraft, setCommercialDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      if (projectType) params.set("projectType", projectType);
      if (customer.trim()) params.set("customer", customer.trim());
      const [dash, rows] = await Promise.all([
        fetchJsonOk<ProjectDashboardPayload>("/api/projects/dashboard"),
        fetchJsonOk<ProjectListResponse>(`/api/projects?${params.toString()}`),
      ]);
      setDashboard(dash);
      setList(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar projetos.");
    } finally {
      setLoading(false);
    }
  }, [search, status, projectType, customer]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    let customerPayload = projectCustomerSelectionToPayload(customerSelection);
    if (!customerPayload && customerDraft.trim()) {
      customerPayload = {
        customerName: customerDraft.trim(),
        customerDocument: null,
      };
    }
    if (!form.title.trim() || !customerPayload?.customerName) return;
    const commercialOwner =
      projectCommercialOwnerSelectionToPayload(commercialSelection)?.commercialOwner ??
      (commercialDraft.trim() || null);
    setSaving(true);
    try {
      const created = await fetchJsonOk<ProjectDetail>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          customerName: customerPayload.customerName,
          customerDocument: customerPayload.customerDocument,
          projectType: form.projectType,
          commercialOwner,
          technicalOwner: form.technicalOwner.trim() || null,
          targetMarginPercent: form.targetMarginPercent
            ? Number(form.targetMarginPercent)
            : null,
        }),
      });
      setCreateOpen(false);
      navigate(`${PROJECTS_BASE_PATH}/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar projeto.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {dashboard ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Projetos em aberto" value={dashboard.openCount} />
          <StatCard label="Aguardando engenharia" value={dashboard.waitingEngineeringCount} />
          <StatCard label="Aguardando cotação" value={dashboard.waitingQuotationCount} />
          <StatCard label="Enviados ao cliente" value={dashboard.sentToCustomerCount} />
          <StatCard label="Aprovados" value={dashboard.approvedCount} />
          <StatCard label="Valor potencial" value={formatMoney(dashboard.potentialValue)} />
          <StatCard label="Investimento em moldes" value={formatMoney(dashboard.moldInvestment)} />
          <StatCard
            label="Margem média prevista"
            value={formatPercent(dashboard.averageMarginPercent)}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
              placeholder="Buscar código, título, cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus | "")}
          >
            <option value="">Todos os status</option>
            {Object.entries(PROJECT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={projectType}
            onChange={(e) => setProjectType(e.target.value as ProjectType | "")}
          >
            <option value="">Todos os tipos</option>
            {Object.entries(PROJECT_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="Cliente"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setCustomerSelection(null);
              setCustomerDraft("");
              setCommercialSelection(null);
              setCommercialDraft("");
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            Novo projeto
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando projetos...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Título</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Comercial</th>
                <th className="px-4 py-3 font-medium">Técnico</th>
                <th className="px-4 py-3 font-medium">Valor est.</th>
                <th className="px-4 py-3 font-medium">Margem</th>
                <th className="px-4 py-3 font-medium">Atualizado</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {(list?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-b border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                  <td className="px-4 py-3">{row.title}</td>
                  <td className="px-4 py-3">{row.customerName}</td>
                  <td className="px-4 py-3">{PROJECT_TYPE_LABEL[row.projectType]}</td>
                  <td className="px-4 py-3">{PROJECT_STATUS_LABEL[row.status]}</td>
                  <td className="px-4 py-3">{row.commercialOwner ?? "—"}</td>
                  <td className="px-4 py-3">{row.technicalOwner ?? "—"}</td>
                  <td className="px-4 py-3">{formatMoney(row.estimatedValue)}</td>
                  <td className="px-4 py-3">{formatPercent(row.marginPercent)}</td>
                  <td className="px-4 py-3">{formatDate(row.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`${PROJECTS_BASE_PATH}/${row.id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Abrir
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
              {!list?.rows.length ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    Nenhum projeto encontrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl"
          >
            <h3 className="text-lg font-semibold">Novo projeto</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Será criada automaticamente a versão 1 do orçamento.
            </p>
            <div className="mt-4 space-y-3">
              <input
                required
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                placeholder="Título do projeto"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
              <ProjectCustomerLookupField
                value={customerSelection}
                onChange={setCustomerSelection}
                onDraftChange={setCustomerDraft}
                disabled={saving}
              />
              <select
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                value={form.projectType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, projectType: e.target.value as ProjectType }))
                }
              >
                {Object.entries(PROJECT_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <ProjectCommercialOwnerLookupField
                value={commercialSelection}
                onChange={setCommercialSelection}
                onDraftChange={setCommercialDraft}
                disabled={saving}
              />
              <input
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                placeholder="Responsável técnico (opcional)"
                value={form.technicalOwner}
                onChange={(e) => setForm((f) => ({ ...f, technicalOwner: e.target.value }))}
              />
              <input
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                placeholder="Margem alvo (%)"
                type="number"
                step="0.1"
                value={form.targetMarginPercent}
                onChange={(e) => setForm((f) => ({ ...f, targetMarginPercent: e.target.value }))}
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm"
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Criar projeto
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ProjectDetailView({
  projectId,
  tab,
  canManage,
  canDelete,
}: {
  projectId: string;
  tab: ProjectTabId;
  canManage: boolean;
  canDelete: boolean;
}) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingMold, setEditingMold] = useState<ProjectMoldRow | null>(null);
  const [moldModalError, setMoldModalError] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProjectSimulatedProductRow | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<"create" | "edit">("create");
  const [editingItem, setEditingItem] = useState<ProjectSimulatedItemRow | null>(null);
  const [simulationProductId, setSimulationProductId] = useState<string | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesStatus, setNotesStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [engineeringItemModalOpen, setEngineeringItemModalOpen] = useState(false);
  const [engineeringItemModalMode, setEngineeringItemModalMode] = useState<"create" | "edit">(
    "create"
  );
  const [guidedMoldModalOpen, setGuidedMoldModalOpen] = useState(false);
  const [guidedMoldMode, setGuidedMoldMode] = useState<"create" | "edit">("create");
  const [otherCostsModalOpen, setOtherCostsModalOpen] = useState(false);
  const [otherCostsModalMode, setOtherCostsModalMode] = useState<"create" | "edit">("create");
  const [editingOtherCostBatchId, setEditingOtherCostBatchId] = useState<string | null>(null);
  const [editingOtherCostLines, setEditingOtherCostLines] = useState<ProjectOtherCostLine[]>([]);
  const [postSavePrompt, setPostSavePrompt] = useState(false);
  const [simulatedWorkspaceProductId, setSimulatedWorkspaceProductId] = useState<string | null>(
    null
  );
  const [structureLineModalOpen, setStructureLineModalOpen] = useState(false);
  const [structureLineSourceType, setStructureLineSourceType] =
    useState<ProjectStructureSourceType | null>(null);
  const [structureLineContext, setStructureLineContext] = useState<{
    simulatedProductId: string;
    parentLineId?: string;
    contextLabel?: string;
  } | null>(null);
  const [structureLineError, setStructureLineError] = useState<string | null>(null);
  const [structureLineEditOpen, setStructureLineEditOpen] = useState(false);
  const [editingStructureLine, setEditingStructureLine] =
    useState<ProjectStructureLineRow | null>(null);
  const [engineeringDefaultKind, setEngineeringDefaultKind] = useState<
    "PRODUCT" | "COMPONENT" | "RAW_MATERIAL"
  >("PRODUCT");

  const legacyTab = useMemo(
    () => parseLegacyTabSegment(window.location.pathname),
    [tab, projectId]
  );

  const guidedItems = useMemo(
    () => (detail ? buildProjectGuidedItems(detail) : []),
    [detail]
  );

  const workspaceSimulatedItems = useMemo(
    () => (detail ? detail.simulatedItems.filter((i) => !isGuidedOtherCostItem(i.notes)) : []),
    [detail]
  );

  const workspaceProduct = useMemo(
    () =>
      detail && simulatedWorkspaceProductId
        ? detail.simulatedProducts.find((p) => p.id === simulatedWorkspaceProductId) ?? null
        : null,
    [detail, simulatedWorkspaceProductId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<ProjectDetail>(`/api/projects/${projectId}`);
      setDetail(data);
      setNotesDraft(data.notes ?? "");
      setNotesStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar projeto.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detail || !simulatedWorkspaceProductId) return;
    const exists = detail.simulatedProducts.some((p) => p.id === simulatedWorkspaceProductId);
    if (!exists) setSimulatedWorkspaceProductId(null);
  }, [detail, simulatedWorkspaceProductId]);

  const patchProject = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const data = await fetchJsonOk<ProjectDetail>(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setDetail(data);
      return data;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao salvar.";
      setError(message);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError(null);
    try {
      const base = `/api/projects/${projectId}`;
      if (deleteTarget.kind === "project") {
        await fetchJsonOk(base, { method: "DELETE" });
        setDeleteTarget(null);
        navigate(PROJECTS_BASE_PATH);
        return;
      }
      if (deleteTarget.kind === "product") {
        await fetchJsonOk(`${base}/simulated-products/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.kind === "item") {
        await fetchJsonOk(`${base}/simulated-items/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.kind === "structure") {
        await fetchJsonOk(`${base}/structure-lines/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.kind === "structureSnapshot") {
        await fetchJsonOk(
          `${base}/structure-snapshot/${deleteTarget.snapshotRootProductId}`,
          { method: "DELETE" }
        );
      } else if (deleteTarget.kind === "mold") {
        await fetchJsonOk(`${base}/molds/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.kind === "other_cost_batch" && detail) {
        const toDelete = detail.simulatedItems.filter((i) => {
          const meta = parseOtherCostMeta(i.notes);
          return meta.batchId === deleteTarget.batchId;
        });
        for (const item of toDelete) {
          await fetchJsonOk(`${base}/simulated-items/${item.id}`, { method: "DELETE" });
        }
      }
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Erro ao excluir.");
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    setNotesStatus("saving");
    try {
      await patchProject({ notes: notesDraft });
      setNotesStatus("saved");
      window.setTimeout(() => setNotesStatus("idle"), 2000);
    } catch {
      setNotesStatus("error");
    }
  };

  const createVersion = async () => {
    setSaving(true);
    try {
      await fetchJsonOk(`/api/projects/${projectId}/versions`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar versão.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando projeto...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
        {error ?? "Projeto não encontrado."}
      </div>
    );
  }

  const openCreateProduct = () => {
    setModalError(null);
    setEngineeringItemModalMode("create");
    setEditingProduct(null);
    setEngineeringDefaultKind("PRODUCT");
    setEngineeringItemModalOpen(true);
  };

  const openCreateChildComponent = () => {
    setModalError(null);
    setEngineeringItemModalMode("create");
    setEditingProduct(null);
    setEngineeringDefaultKind("COMPONENT");
    setEngineeringItemModalOpen(true);
  };

  const openStructureLineAdd = (
    sourceType: ProjectStructureSourceType,
    context?: { parentLineId?: string }
  ) => {
    if (!simulatedWorkspaceProductId) return;
    setStructureLineError(null);
    setStructureLineSourceType(sourceType);
    setStructureLineContext({
      simulatedProductId: simulatedWorkspaceProductId,
      parentLineId: context?.parentLineId,
      contextLabel: context?.parentLineId
        ? "Adicionando subitem à linha selecionada na árvore."
        : undefined,
    });
    setStructureLineModalOpen(true);
  };

  const openCreateMold = () => {
    setMoldModalError(null);
    setGuidedMoldMode("create");
    setEditingMold(null);
    setGuidedMoldModalOpen(true);
  };

  const openCreateOtherCost = () => {
    setModalError(null);
    setOtherCostsModalMode("create");
    setEditingOtherCostBatchId(null);
    setEditingOtherCostLines([]);
    setOtherCostsModalOpen(true);
  };

  const handleGuidedItemOpen = (item: ProjectGuidedItemRow) => {
    if (item.entityKind === "other_cost" && item.batchId) {
      const lines = loadOtherCostBatchLines(detail.simulatedItems, item.batchId);
      setModalError(null);
      setOtherCostsModalMode("edit");
      setEditingOtherCostBatchId(item.batchId);
      setEditingOtherCostLines(lines.length > 0 ? lines : []);
      setOtherCostsModalOpen(true);
      return;
    }
    if (item.snapshotRootProductId) {
      setSimulationError(null);
      setSimulationProductId(item.snapshotRootProductId);
      return;
    }
    if (item.productId) {
      setSimulatedWorkspaceProductId(item.productId);
      return;
    }
    if (item.moldId) {
      const mold = detail.molds.find((m) => m.id === item.moldId);
      if (mold) {
        setMoldModalError(null);
        setGuidedMoldMode("edit");
        setEditingMold(mold);
        setGuidedMoldModalOpen(true);
      }
      return;
    }
    if (item.simulatedItemId) {
      const simItem = detail.simulatedItems.find((i) => i.id === item.simulatedItemId);
      if (simItem && !isGuidedOtherCostItem(simItem.notes)) {
        setModalError(null);
        setItemModalMode("edit");
        setEditingItem(simItem);
        setItemModalOpen(true);
      }
    }
  };

  const handleGuidedItemDelete = (item: ProjectGuidedItemRow) => {
    if (item.entityKind === "mold" && item.moldId) {
      setDeleteTarget({ kind: "mold", id: item.moldId, label: item.name });
      return;
    }
    if (item.entityKind === "other_cost" && item.batchId) {
      setDeleteTarget({
        kind: "other_cost_batch",
        batchId: item.batchId,
        label: item.name,
      });
      return;
    }
    if (item.entityKind === "engineering_clone" && item.snapshotRootProductId) {
      setDeleteTarget({
        kind: "structureSnapshot",
        snapshotRootProductId: item.snapshotRootProductId,
        label: item.name,
      });
      return;
    }
    if (item.productId) {
      setDeleteTarget({ kind: "product", id: item.productId, label: item.name });
      return;
    }
    if (item.simulatedItemId) {
      setDeleteTarget({ kind: "item", id: item.simulatedItemId, label: item.name });
    }
  };

  if (legacyTab) {
    return <Navigate to={getProjectTabPath(projectId, tab)} replace />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate(PROJECTS_BASE_PATH)}
            className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para lista
          </button>
          <div className="flex items-center gap-3">
            <FolderKanban className="h-8 w-8 text-primary" />
            <div>
              <h3 className="text-2xl font-bold">
                {detail.code} — {detail.title}
              </h3>
              <p className="text-muted-foreground">
                {detail.customerName} · {PROJECT_TYPE_LABEL[detail.projectType]} ·{" "}
                {PROJECT_STATUS_LABEL[detail.status]}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            title="Após aprovação, este projeto poderá gerar produto, componente, BOM e roteiro oficiais mediante revisão de engenharia."
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm opacity-50 cursor-not-allowed"
          >
            <Sparkles className="h-4 w-4" />
            Converter em cadastro oficial
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Em breve</span>
          </button>
          {canDelete ? (
            <button
              type="button"
              onClick={() =>
                setDeleteTarget({
                  kind: "project",
                  label: `${detail.code} — ${detail.title}`,
                })
              }
              className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              Excluir projeto
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {PROJECT_TABS.map((t) => (
          <Link
            key={t.id}
            to={getProjectTabPath(projectId, t.id)}
            className={cn(
              "rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "border border-b-0 border-border bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {postSavePrompt ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          Item salvo no projeto. O que deseja adicionar agora?
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border bg-white px-3 py-1.5 text-sm" onClick={openCreateProduct}>
              Criar novo produto
            </button>
            <button type="button" className="rounded-lg border bg-white px-3 py-1.5 text-sm" onClick={openCreateMold}>
              Criar molde
            </button>
            <button type="button" className="rounded-lg border bg-white px-3 py-1.5 text-sm" onClick={openCreateOtherCost}>
              Criar outros custos
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm text-emerald-800"
              onClick={() => setPostSavePrompt(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      ) : null}

      {tab === "home" ? (
        <ProjectHomeAssistant
          detail={detail}
          canManage={canManage}
          onCreateProduct={openCreateProduct}
          onCreateMold={openCreateMold}
          onCreateOtherCost={openCreateOtherCost}
          onOpenItem={handleGuidedItemOpen}
        />
      ) : null}

      {tab === "items" ? (
        <ProjectItemsTab
          items={guidedItems}
          canManage={canManage}
          onCreateProduct={openCreateProduct}
          onCreateMold={openCreateMold}
          onCreateOtherCost={openCreateOtherCost}
          onOpenItem={handleGuidedItemOpen}
          onDeleteItem={canManage ? handleGuidedItemDelete : undefined}
        />
      ) : null}

      {tab === "costs" ? <ProjectGuidedCostsTab detail={detail} /> : null}

      {tab === "documents" ? <ProjectDocuments canManage={canManage} /> : null}

      {tab === "history" ? (
        <ProjectHistory
          detail={detail}
          canManage={canManage}
          notesDraft={notesDraft}
          notesStatus={notesStatus}
          saving={saving}
          onNotesChange={setNotesDraft}
          onSaveNotes={() => void saveNotes()}
          onCreateVersion={() => void createVersion()}
        />
      ) : null}

      <ProjectGuidedMoldModal
        open={guidedMoldModalOpen}
        mode={guidedMoldMode}
        projectLabel={`${detail.code} — ${detail.title}`}
        initial={editingMold}
        saving={saving}
        error={moldModalError}
        onClose={() => {
          setGuidedMoldModalOpen(false);
          setEditingMold(null);
        }}
        onSubmit={async (payload) => {
          setSaving(true);
          setMoldModalError(null);
          try {
            const body = {
              name: payload.name,
              moldType: payload.moldType,
              cavities: payload.cavities,
              notes: payload.notes,
              constructionCost: payload.constructionCost,
              chargeMode: "CHARGED_SEPARATELY",
            };
            if (guidedMoldMode === "edit" && editingMold) {
              await fetchJsonOk(`/api/projects/${projectId}/molds/${editingMold.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
            } else {
              await fetchJsonOk(`/api/projects/${projectId}/molds`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
            }
            setGuidedMoldModalOpen(false);
            setEditingMold(null);
            await load();
            setPostSavePrompt(true);
          } catch (e) {
            setMoldModalError(e instanceof Error ? e.message : "Erro ao salvar molde.");
          } finally {
            setSaving(false);
          }
        }}
      />

      <ProjectEngineeringItemModal
        open={engineeringItemModalOpen}
        mode={engineeringItemModalMode}
        projectLabel={`${detail.code} — ${detail.title}`}
        initial={editingProduct}
        saving={saving}
        error={modalError}
        onClose={() => {
          setEngineeringItemModalOpen(false);
          setEditingProduct(null);
        }}
        onCloneOfficial={async (productId) => {
          setSaving(true);
          setModalError(null);
          try {
            await fetchJsonOk(`/api/projects/${projectId}/import-product-snapshot`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productId,
                includeBom: true,
                includeRouting: true,
                replaceExisting: false,
              }),
            });
            setEngineeringItemModalOpen(false);
            setEditingProduct(null);
            await load();
            setPostSavePrompt(true);
          } catch (e) {
            setModalError(e instanceof Error ? e.message : "Erro ao clonar item.");
          } finally {
            setSaving(false);
          }
        }}
        defaultItemKind={engineeringDefaultKind}
        onSubmit={async (payload) => {
          setSaving(true);
          setModalError(null);
          try {
            let openWorkspaceId: string | null = null;
            if (payload.itemKind === "PRODUCT" || payload.itemKind === "COMPONENT") {
              let notes =
                payload.originMode === "REFERENCE"
                  ? appendGuidedReferenceOrigin(payload.notes)
                  : payload.notes;
              if (payload.itemKind === "COMPONENT") {
                notes = appendGuidedComponentKind(notes);
              }
              const body = {
                provisionalCode: payload.provisionalCode,
                description: payload.description,
                unit: payload.unit,
                estimatedWeight: payload.estimatedWeight,
                expectedVolume: payload.expectedVolume,
                batchSize: payload.batchSize,
                notes,
              };
              if (engineeringItemModalMode === "edit" && editingProduct) {
                await fetchJsonOk(
                  `/api/projects/${projectId}/simulated-products/${editingProduct.id}`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  }
                );
                openWorkspaceId = editingProduct.id;
              } else {
                const created = await fetchJsonOk<ProjectSimulatedProductRow>(
                  `/api/projects/${projectId}/simulated-products`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  }
                );
                openWorkspaceId = created.id;
              }
            } else {
              const body = {
                provisionalCode: payload.provisionalCode,
                description: payload.description,
                itemType: "RAW_MATERIAL" as const,
                unit: payload.unit,
                estimatedWeight: payload.estimatedWeight,
                notes: payload.notes,
              };
              await fetchJsonOk(`/api/projects/${projectId}/simulated-items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
            }
            setEngineeringItemModalOpen(false);
            setEditingProduct(null);
            await load();
            if (openWorkspaceId) {
              setSimulatedWorkspaceProductId(openWorkspaceId);
            }
            setPostSavePrompt(true);
          } catch (e) {
            setModalError(e instanceof Error ? e.message : "Erro ao salvar item.");
          } finally {
            setSaving(false);
          }
        }}
      />

      <ProjectOtherCostsModal
        open={otherCostsModalOpen}
        mode={otherCostsModalMode}
        projectLabel={`${detail.code} — ${detail.title}`}
        initialLines={editingOtherCostLines}
        initialBatchId={editingOtherCostBatchId}
        saving={saving}
        error={modalError}
        onClose={() => {
          setOtherCostsModalOpen(false);
          setOtherCostsModalMode("create");
          setEditingOtherCostBatchId(null);
          setEditingOtherCostLines([]);
        }}
        onSubmit={async (payload) => {
          if (saving) return;
          setSaving(true);
          setModalError(null);
          try {
            const batchId =
              payload.batchId ?? editingOtherCostBatchId ?? createBrowserSafeId("other-cost-batch");
            if (otherCostsModalMode === "edit" && editingOtherCostBatchId) {
              const existing = findOtherCostBatchItems(detail.simulatedItems, editingOtherCostBatchId);
              for (const item of existing) {
                await fetchJsonOk(`/api/projects/${projectId}/simulated-items/${item.id}`, {
                  method: "DELETE",
                });
              }
            }
            for (const line of payload.lines) {
              await fetchJsonOk(`/api/projects/${projectId}/simulated-items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  description: line.description.trim(),
                  itemType: "OTHER",
                  unit: line.unit,
                  estimatedUnitCost: line.totalCost,
                  quotedUnitCost: line.totalCost,
                  supplierName: line.supplierName,
                  notes: buildOtherCostNotes(line.group, batchId, line.notes),
                }),
              });
            }
            setOtherCostsModalOpen(false);
            setOtherCostsModalMode("create");
            setEditingOtherCostBatchId(null);
            setEditingOtherCostLines([]);
            await load();
            setPostSavePrompt(true);
          } catch (e) {
            setModalError(e instanceof Error ? e.message : "Erro ao salvar custos.");
          } finally {
            setSaving(false);
          }
        }}
      />

      <ProjectSimulatedItemFormModal
        open={itemModalOpen}
        mode={itemModalMode}
        initial={editingItem}
        saving={saving}
        error={modalError}
        onClose={() => {
          setItemModalOpen(false);
          setEditingItem(null);
        }}
        onSubmit={async (payload) => {
          setSaving(true);
          setModalError(null);
          try {
            if (itemModalMode === "edit" && editingItem) {
              await fetchJsonOk(`/api/projects/${projectId}/simulated-items/${editingItem.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
            } else {
              await fetchJsonOk(`/api/projects/${projectId}/simulated-items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
            }
            setItemModalOpen(false);
            setEditingItem(null);
            await load();
          } catch (e) {
            setModalError(e instanceof Error ? e.message : "Erro ao salvar item.");
          } finally {
            setSaving(false);
          }
        }}
      />

      <ProjectDeleteConfirmModal
        open={deleteTarget != null}
        title={
          deleteTarget?.kind === "project"
            ? "Excluir projeto inteiro?"
            : deleteTarget?.kind === "structureSnapshot"
              ? "Remover este produto do projeto?"
              : "Confirmar exclusão"
        }
        description={
          deleteTarget?.kind === "project"
            ? "Esta ação remove o projeto, versões, estruturas simuladas, itens e moldes vinculados. Os cadastros oficiais (produtos, materiais, BOM) não serão alterados. Apenas super administrador pode executar esta exclusão."
            : deleteTarget?.kind === "structureSnapshot"
              ? "Esta ação remove apenas o snapshot de engenharia deste projeto. O cadastro oficial do produto, materiais, BOM e roteiro não será alterado."
              : "Esta ação removerá o item apenas deste projeto/simulação. Nenhum cadastro oficial será alterado."
        }
        itemLabel={deleteTarget?.label}
        saving={saving}
        error={deleteError}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={handleDelete}
      />

      {workspaceProduct ? (
        <ProjectSimulatedProductWorkspace
          open={simulatedWorkspaceProductId != null}
          projectId={projectId}
          product={workspaceProduct}
          structureLines={detail.structureLines}
          simulatedItems={workspaceSimulatedItems}
          simulatedProducts={detail.simulatedProducts}
          saving={saving}
          error={structureLineError}
          canManage={canManage}
          onClose={() => {
            setSimulatedWorkspaceProductId(null);
            setStructureLineError(null);
          }}
          onReload={load}
          onPatchProduct={async (body) => {
            setSaving(true);
            setStructureLineError(null);
            try {
              await fetchJsonOk(
                `/api/projects/${projectId}/simulated-products/${workspaceProduct.id}`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                }
              );
              await load();
            } catch (e) {
              setStructureLineError(e instanceof Error ? e.message : "Erro ao salvar.");
              throw e;
            } finally {
              setSaving(false);
            }
          }}
          onAddLine={openStructureLineAdd}
          onCreateChildComponent={openCreateChildComponent}
          onEditLine={(line) => {
            setStructureLineError(null);
            setEditingStructureLine(line);
            setStructureLineEditOpen(true);
          }}
          onDeleteLine={(line) => {
            setDeleteTarget({ kind: "structure", id: line.id, label: line.descriptionSnapshot });
          }}
          onSaveBomPatches={async (patches) => {
            setSaving(true);
            setStructureLineError(null);
            try {
              for (const patch of patches) {
                await fetchJsonOk(`/api/projects/${projectId}/structure-lines/${patch.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    quantity: patch.quantity,
                    lossPercent: patch.lossPercent,
                    unitCost: patch.unitCost,
                  }),
                });
              }
              await load();
            } catch (e) {
              setStructureLineError(e instanceof Error ? e.message : "Erro ao salvar BOM.");
              throw e;
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}

      <ProjectStructureLineModal
        open={structureLineModalOpen}
        sourceType={structureLineSourceType}
        simulatedItems={workspaceSimulatedItems}
        simulatedProducts={detail.simulatedProducts}
        lineContext={structureLineContext}
        saving={saving}
        error={structureLineError}
        onClose={() => {
          setStructureLineModalOpen(false);
          setStructureLineSourceType(null);
          setStructureLineContext(null);
          setStructureLineError(null);
        }}
        onSubmit={async (body) => {
          setSaving(true);
          setStructureLineError(null);
          try {
            const refId =
              typeof body.referencedSimulatedProductId === "string"
                ? body.referencedSimulatedProductId
                : null;
            if (refId) {
              const refCost = resolveReferencedSimulatedProductUnitCost(
                detail.structureLines,
                refId
              );
              body.unitCost = refCost;
              body.notes = buildSimulatedProductRefNotes(
                refId,
                typeof body.notes === "string" ? body.notes : null
              );
              delete body.referencedSimulatedProductId;
            }
            await fetchJsonOk(`/api/projects/${projectId}/structure-lines`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            setStructureLineModalOpen(false);
            setStructureLineSourceType(null);
            setStructureLineContext(null);
            await load();
          } catch (e) {
            setStructureLineError(e instanceof Error ? e.message : "Erro ao adicionar linha.");
          } finally {
            setSaving(false);
          }
        }}
      />

      <ProjectStructureLineEditModal
        open={structureLineEditOpen}
        line={editingStructureLine}
        saving={saving}
        error={structureLineError}
        onClose={() => {
          setStructureLineEditOpen(false);
          setEditingStructureLine(null);
          setStructureLineError(null);
        }}
        onSubmit={async (body) => {
          if (!editingStructureLine) return;
          setSaving(true);
          setStructureLineError(null);
          try {
            await fetchJsonOk(
              `/api/projects/${projectId}/structure-lines/${editingStructureLine.id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            );
            setStructureLineEditOpen(false);
            setEditingStructureLine(null);
            await load();
          } catch (e) {
            setStructureLineError(e instanceof Error ? e.message : "Erro ao salvar linha.");
          } finally {
            setSaving(false);
          }
        }}
      />

      <ProjectProductSimulationPanel
        open={simulationProductId != null}
        projectId={projectId}
        productId={simulationProductId ?? ""}
        structureLines={detail.structureLines}
        costBreakdown={detail.costBreakdown}
        saving={saving}
        error={simulationError}
        onClose={() => {
          setSimulationProductId(null);
          setSimulationError(null);
        }}
        onReload={load}
        onImportSnapshot={async (options) => {
          if (!simulationProductId) return;
          setSaving(true);
          setSimulationError(null);
          try {
            await fetchJsonOk(`/api/projects/${projectId}/import-product-snapshot`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productId: simulationProductId,
                includeBom: options.includeBom,
                includeRouting: options.includeRouting,
              }),
            });
            await load();
          } catch (e) {
            setSimulationError(e instanceof Error ? e.message : "Erro ao importar snapshot.");
          } finally {
            setSaving(false);
          }
        }}
        onSaveToProject={async ({ linePatches }) => {
          setSaving(true);
          setSimulationError(null);
          try {
            for (const patch of linePatches) {
              await fetchJsonOk(`/api/projects/${projectId}/structure-lines/${patch.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  quantity: patch.quantity,
                  lossPercent: patch.lossPercent,
                  unitCost: patch.unitCost,
                }),
              });
            }
            await load();
          } catch (e) {
            setSimulationError(e instanceof Error ? e.message : "Erro ao salvar no projeto.");
            throw e;
          } finally {
            setSaving(false);
          }
        }}
      />

    </div>
  );
}

export function ProjectsModule() {
  const auth = useAuth();
  const canManage = canManageProjects(auth);
  const canDelete = canDeleteProject(auth);
  const params = useParams();
  const projectId = params.projectId;
  const tab = useMemo(
    () => parseProjectTabFromPath(window.location.pathname),
    [params.tab, projectId]
  );

  if (projectId) {
    return (
      <ProjectDetailErrorBoundary>
        <ProjectDetailView
          projectId={projectId}
          tab={tab}
          canManage={canManage}
          canDelete={canDelete}
        />
      </ProjectDetailErrorBoundary>
    );
  }

  return <ProjectsListView canManage={canManage} />;
}
