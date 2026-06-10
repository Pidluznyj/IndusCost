import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  FolderKanban,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  getProjectTabPath,
  parseProjectTabFromPath,
  PROJECT_TABS,
  PROJECTS_BASE_PATH,
  type ProjectTabId,
} from "@/src/lib/projectsNavigation";
import { canManageProjects } from "@/src/lib/projectsPermissions";
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
import { ProjectLaborLineModal } from "@/src/components/projects/ProjectLaborLineModal";
import { ProjectMoldFormModal } from "@/src/components/projects/ProjectMoldFormModal";
import { ProjectSimulatedItemFormModal } from "@/src/components/projects/ProjectSimulatedItemFormModal";
import { ProjectSimulatedProductFormModal } from "@/src/components/projects/ProjectSimulatedProductFormModal";
import { ProjectStructureLineEditModal } from "@/src/components/projects/ProjectStructureLineEditModal";
import { ProjectProductSimulationPanel } from "@/src/components/projects/ProjectProductSimulationPanel";
import { ProjectStructureLineModal } from "@/src/components/projects/ProjectStructureLineModal";
import { MOLD_CHARGE_MODE_OPTIONS, structureLineTypeLabel } from "@/src/lib/projectsUiUtils";
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

const MOLD_CHARGE_LABEL = Object.fromEntries(
  MOLD_CHARGE_MODE_OPTIONS.map((o) => [o.value, o.label])
) as Record<string, string>;

type DeleteTarget =
  | { kind: "product"; id: string; label: string }
  | { kind: "item"; id: string; label: string }
  | { kind: "structure"; id: string; label: string }
  | { kind: "mold"; id: string; label: string };

function RowActions({
  canManage,
  onEdit,
  onDelete,
}: {
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!canManage) return null;
  return (
    <td className="px-3 py-2">
      <div className="flex justify-end gap-1">
        <button
          type="button"
          title="Editar"
          onClick={onEdit}
          className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Excluir"
          onClick={onDelete}
          className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </td>
  );
}

const SOURCE_BADGE: Record<ProjectStructureSourceType, { label: string; className: string }> = {
  EXISTING_PRODUCT: { label: "Existente", className: "bg-blue-100 text-blue-800" },
  EXISTING_MATERIAL: { label: "Existente", className: "bg-blue-100 text-blue-800" },
  SIMULATED_ITEM: { label: "Simulado", className: "bg-amber-100 text-amber-800" },
  MANUAL: { label: "Manual", className: "bg-slate-100 text-slate-700" },
};

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

function ProjectDetailView({ projectId, tab, canManage }: { projectId: string; tab: ProjectTabId; canManage: boolean }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [moldModalOpen, setMoldModalOpen] = useState(false);
  const [moldModalMode, setMoldModalMode] = useState<"create" | "edit">("create");
  const [editingMold, setEditingMold] = useState<ProjectMoldRow | null>(null);
  const [moldModalError, setMoldModalError] = useState<string | null>(null);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productModalMode, setProductModalMode] = useState<"create" | "edit">("create");
  const [editingProduct, setEditingProduct] = useState<ProjectSimulatedProductRow | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<"create" | "edit">("create");
  const [editingItem, setEditingItem] = useState<ProjectSimulatedItemRow | null>(null);
  const [structureModalSource, setStructureModalSource] =
    useState<ProjectStructureSourceType | null>(null);
  const [editingStructureLine, setEditingStructureLine] = useState<ProjectStructureLineRow | null>(
    null
  );
  const [laborModalOpen, setLaborModalOpen] = useState(false);
  const [laborModalMode, setLaborModalMode] = useState<"create" | "edit">("create");
  const [editingLaborLine, setEditingLaborLine] = useState<ProjectStructureLineRow | null>(null);
  const [simulationProductId, setSimulationProductId] = useState<string | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesStatus, setNotesStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

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
      if (deleteTarget.kind === "product") {
        await fetchJsonOk(`${base}/simulated-products/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.kind === "item") {
        await fetchJsonOk(`${base}/simulated-items/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.kind === "structure") {
        await fetchJsonOk(`${base}/structure-lines/${deleteTarget.id}`, { method: "DELETE" });
      } else if (deleteTarget.kind === "mold") {
        await fetchJsonOk(`${base}/molds/${deleteTarget.id}`, { method: "DELETE" });
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

  const cost = detail.costBreakdown;

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

      {tab === "summary" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h4 className="font-semibold">Dados principais</h4>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Cliente</dt>
                <dd>{detail.customerName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{PROJECT_STATUS_LABEL[detail.status]}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Comercial</dt>
                <dd>{detail.commercialOwner ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Técnico</dt>
                <dd>{detail.technicalOwner ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Volume mensal est.</dt>
                <dd>{detail.expectedMonthlyVolume ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Margem alvo</dt>
                <dd>{formatPercent(detail.targetMarginPercent)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Preço alvo</dt>
                <dd>{formatMoney(detail.targetPrice)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Versão atual</dt>
                <dd>
                  {detail.currentVersion
                    ? `v${detail.currentVersion.versionNumber}`
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>
          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h4 className="font-semibold">Resumo de custo</h4>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Custo unitário</dt>
                <dd className="font-medium">{formatMoney(cost.unitCost)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Preço sugerido</dt>
                <dd className="font-medium">{formatMoney(cost.suggestedPrice)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Molde amortizado/un.</dt>
                <dd>{formatMoney(cost.amortizedMoldCostPerUnit)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Molde separado</dt>
                <dd>{formatMoney(cost.separateMoldCost)}</dd>
              </div>
            </dl>
            {detail.alerts.length ? (
              <div className="space-y-2 pt-2">
                <h5 className="text-sm font-medium">Alertas</h5>
                {detail.alerts.map((a) => (
                  <div
                    key={`${a.code}-${a.message}`}
                    className={cn(
                      "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
                      a.severity === "warning"
                        ? "bg-amber-50 text-amber-900"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {a.message}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-emerald-700">
                <BadgeCheck className="h-4 w-4" />
                Nenhum alerta pendente.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "products" ? (
        <EntitySection
          title="Produtos simulados"
          canManage={canManage}
          isEmpty={detail.simulatedProducts.length === 0}
          empty="Nenhum produto simulado."
          onAddClick={() => {
            setModalError(null);
            setProductModalMode("create");
            setEditingProduct(null);
            setProductModalOpen(true);
          }}
          rows={detail.simulatedProducts.map((p) => (
            <tr key={p.id} className="border-b border-border/60">
              <td className="px-3 py-2">{p.provisionalCode ?? "—"}</td>
              <td className="px-3 py-2">{p.description}</td>
              <td className="px-3 py-2">{p.unit}</td>
              <td className="px-3 py-2">{p.expectedVolume ?? "—"}</td>
              <td className="px-3 py-2">{p.batchSize ?? "—"}</td>
              <RowActions
                canManage={canManage}
                onEdit={() => {
                  setModalError(null);
                  setProductModalMode("edit");
                  setEditingProduct(p);
                  setProductModalOpen(true);
                }}
                onDelete={() =>
                  setDeleteTarget({ kind: "product", id: p.id, label: p.description })
                }
              />
            </tr>
          ))}
          headers={["Código prov.", "Descrição", "Un.", "Volume", "Lote", ""]}
        />
      ) : null}

      {tab === "structure" ? (
        <StructureTab
          detail={detail}
          canManage={canManage}
          onAddLine={(sourceType) => {
            setModalError(null);
            setStructureModalSource(sourceType);
          }}
          onAddLabor={() => {
            setModalError(null);
            setLaborModalMode("create");
            setEditingLaborLine(null);
            setLaborModalOpen(true);
          }}
          onEditLine={(line) => {
            setModalError(null);
            if (line.existingProductId && line.sourceType === "EXISTING_PRODUCT") {
              setSimulationProductId(line.existingProductId);
              return;
            }
            if (line.unitSnapshot === "HH" || (line.sourceType === "MANUAL" && (line.lineType === "PROCESS" || line.lineType === "SERVICE"))) {
              setLaborModalMode("edit");
              setEditingLaborLine(line);
              setLaborModalOpen(true);
            } else {
              setEditingStructureLine(line);
            }
          }}
          onDeleteLine={(line) =>
            setDeleteTarget({
              kind: "structure",
              id: line.id,
              label: line.descriptionSnapshot,
            })
          }
          onOpenProductSimulation={(productId) => {
            setSimulationError(null);
            setSimulationProductId(productId);
            setStructureModalSource(null);
          }}
        />
      ) : null}

      {tab === "items" ? (
        <EntitySection
          title="Itens simulados (não viram cadastro oficial)"
          canManage={canManage}
          isEmpty={detail.simulatedItems.length === 0}
          empty="Nenhum item simulado."
          onAddClick={() => {
            setModalError(null);
            setItemModalMode("create");
            setEditingItem(null);
            setItemModalOpen(true);
          }}
          rows={detail.simulatedItems.map((i) => (
            <tr key={i.id} className="border-b border-border/60">
              <td className="px-3 py-2">
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  Simulado
                </span>
              </td>
              <td className="px-3 py-2">{i.description}</td>
              <td className="px-3 py-2">{i.itemType}</td>
              <td className="px-3 py-2">{formatMoney(i.quotedUnitCost ?? i.estimatedUnitCost)}</td>
              <td className="px-3 py-2">{i.requiresQuotation ? "Sim" : "Não"}</td>
              <RowActions
                canManage={canManage}
                onEdit={() => {
                  setModalError(null);
                  setItemModalMode("edit");
                  setEditingItem(i);
                  setItemModalOpen(true);
                }}
                onDelete={() =>
                  setDeleteTarget({ kind: "item", id: i.id, label: i.description })
                }
              />
            </tr>
          ))}
          headers={["Origem", "Descrição", "Tipo", "Custo", "Cotação?", ""]}
        />
      ) : null}

      {tab === "molds" ? (
        <EntitySection
          title="Molde / Ferramental"
          canManage={canManage}
          isEmpty={detail.molds.length === 0}
          empty="Nenhum molde cadastrado."
          onAddClick={() => {
            setMoldModalError(null);
            setMoldModalMode("create");
            setEditingMold(null);
            setMoldModalOpen(true);
          }}
          rows={detail.molds.map((m) => (
            <tr key={m.id} className="border-b border-border/60">
              <td className="px-3 py-2">{m.name}</td>
              <td className="px-3 py-2">{MOLD_CHARGE_LABEL[m.chargeMode] ?? m.chargeMode}</td>
              <td className="px-3 py-2">{formatMoney(m.constructionCost)}</td>
              <td className="px-3 py-2">{m.amortizationQuantity ?? "—"}</td>
              <td className="px-3 py-2">{formatMoney(m.amortizedCostPerUnit)}</td>
              <td className="px-3 py-2">{m.ownership}</td>
              <RowActions
                canManage={canManage}
                onEdit={() => {
                  setMoldModalError(null);
                  setMoldModalMode("edit");
                  setEditingMold(m);
                  setMoldModalOpen(true);
                }}
                onDelete={() => setDeleteTarget({ kind: "mold", id: m.id, label: m.name })}
              />
            </tr>
          ))}
          headers={["Nome", "Cobrança", "Construção", "Qtd amort.", "Custo/un.", "Propriedade", ""]}
        />
      ) : null}

      {tab === "costs" ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Custo MP" value={formatMoney(cost.rawMaterialCost)} />
          <StatCard label="Custo componentes" value={formatMoney(cost.componentCost)} />
          <StatCard label="Custo serviços" value={formatMoney(cost.serviceCost)} />
          <StatCard label="Custo embalagem" value={formatMoney(cost.packagingCost)} />
          <StatCard label="Molde separado" value={formatMoney(cost.separateMoldCost)} />
          <StatCard label="Molde amortizado/un." value={formatMoney(cost.amortizedMoldCostPerUnit)} />
          <StatCard label="Custo unitário total" value={formatMoney(cost.unitCost)} />
          <StatCard label="Margem alvo" value={formatPercent(cost.targetMarginPercent)} />
          <StatCard label="Preço sugerido" value={formatMoney(cost.suggestedPrice)} />
          <StatCard label="Markup" value={formatPercent(cost.markupPercent)} />
          <StatCard label="Preço alvo" value={formatMoney(cost.targetPrice)} />
          <StatCard label="Diferença sugerido − alvo" value={formatMoney(cost.priceGap)} />
        </div>
      ) : null}

      {tab === "versions" ? (
        <div className="space-y-4">
          {canManage ? (
            <button
              type="button"
              disabled={saving}
              onClick={createVersion}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar nova versão
            </button>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Nova versão copia a versão atual e congela os custos anteriores.
          </p>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-3">Versão</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Atual</th>
                  <th className="px-4 py-3">Custo un.</th>
                  <th className="px-4 py-3">Preço sug.</th>
                  <th className="px-4 py-3">Margem</th>
                  <th className="px-4 py-3">Criada em</th>
                </tr>
              </thead>
              <tbody>
                {detail.versions.map((v) => (
                  <tr key={v.id} className="border-b border-border/60">
                    <td className="px-4 py-3">v{v.versionNumber}</td>
                    <td className="px-4 py-3">{PROJECT_STATUS_LABEL[v.status]}</td>
                    <td className="px-4 py-3">{v.isCurrent ? "Sim" : "—"}</td>
                    <td className="px-4 py-3">{formatMoney(v.unitCost)}</td>
                    <td className="px-4 py-3">{formatMoney(v.suggestedPrice)}</td>
                    <td className="px-4 py-3">{formatPercent(v.marginPercent)}</td>
                    <td className="px-4 py-3">{formatDate(v.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold">Observações técnicas e comerciais</h4>
            {canManage ? (
              <div className="flex items-center gap-2">
                {notesStatus === "saved" ? (
                  <span className="text-xs text-emerald-700">Salvo</span>
                ) : null}
                {notesStatus === "error" ? (
                  <span className="text-xs text-destructive">Erro ao salvar</span>
                ) : null}
                <button
                  type="button"
                  disabled={saving || notesStatus === "saving"}
                  onClick={() => void saveNotes()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
                >
                  {notesStatus === "saving" ? "Salvando..." : "Salvar"}
                </button>
              </div>
            ) : null}
          </div>
          {canManage ? (
            <textarea
              className="mt-3 min-h-[160px] w-full rounded-lg border border-border px-3 py-2 text-sm"
              value={notesDraft}
              onChange={(e) => {
                setNotesDraft(e.target.value);
                setNotesStatus("idle");
              }}
            />
          ) : (
            <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {detail.notes ?? "Sem observações."}
            </p>
          )}
        </div>
      ) : null}

      <ProjectMoldFormModal
        open={moldModalOpen}
        mode={moldModalMode}
        initial={editingMold}
        saving={saving}
        error={moldModalError}
        onClose={() => {
          setMoldModalOpen(false);
          setEditingMold(null);
        }}
        onSubmit={async (payload) => {
          setSaving(true);
          setMoldModalError(null);
          try {
            if (moldModalMode === "edit" && editingMold) {
              await fetchJsonOk(`/api/projects/${projectId}/molds/${editingMold.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
            } else {
              await fetchJsonOk(`/api/projects/${projectId}/molds`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
            }
            setMoldModalOpen(false);
            setEditingMold(null);
            await load();
          } catch (e) {
            setMoldModalError(e instanceof Error ? e.message : "Erro ao salvar molde.");
          } finally {
            setSaving(false);
          }
        }}
      />

      <ProjectSimulatedProductFormModal
        open={productModalOpen}
        mode={productModalMode}
        initial={editingProduct}
        saving={saving}
        error={modalError}
        onClose={() => {
          setProductModalOpen(false);
          setEditingProduct(null);
        }}
        onSubmit={async (payload) => {
          setSaving(true);
          setModalError(null);
          try {
            if (productModalMode === "edit" && editingProduct) {
              await fetchJsonOk(
                `/api/projects/${projectId}/simulated-products/${editingProduct.id}`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                }
              );
            } else {
              await fetchJsonOk(`/api/projects/${projectId}/simulated-products`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
            }
            setProductModalOpen(false);
            setEditingProduct(null);
            await load();
          } catch (e) {
            setModalError(e instanceof Error ? e.message : "Erro ao salvar produto.");
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

      <ProjectLaborLineModal
        open={laborModalOpen}
        mode={laborModalMode}
        initial={editingLaborLine}
        saving={saving}
        error={modalError}
        onClose={() => {
          setLaborModalOpen(false);
          setEditingLaborLine(null);
        }}
        onSubmit={async (body) => {
          setSaving(true);
          setModalError(null);
          try {
            await fetchJsonOk(`/api/projects/${projectId}/structure-lines`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            setLaborModalOpen(false);
            await load();
          } catch (e) {
            setModalError(e instanceof Error ? e.message : "Erro ao adicionar HH.");
          } finally {
            setSaving(false);
          }
        }}
        onSubmitEdit={
          laborModalMode === "edit" && editingLaborLine
            ? async (body) => {
                setSaving(true);
                setModalError(null);
                try {
                  await fetchJsonOk(
                    `/api/projects/${projectId}/structure-lines/${editingLaborLine.id}`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    }
                  );
                  setLaborModalOpen(false);
                  setEditingLaborLine(null);
                  await load();
                } catch (e) {
                  setModalError(e instanceof Error ? e.message : "Erro ao salvar HH.");
                } finally {
                  setSaving(false);
                }
              }
            : undefined
        }
      />

      <ProjectStructureLineEditModal
        open={editingStructureLine != null}
        line={editingStructureLine}
        saving={saving}
        error={modalError}
        onClose={() => setEditingStructureLine(null)}
        onSubmit={async (body) => {
          if (!editingStructureLine) return;
          setSaving(true);
          setModalError(null);
          try {
            await fetchJsonOk(
              `/api/projects/${projectId}/structure-lines/${editingStructureLine.id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            );
            setEditingStructureLine(null);
            await load();
          } catch (e) {
            setModalError(e instanceof Error ? e.message : "Erro ao salvar linha.");
          } finally {
            setSaving(false);
          }
        }}
      />

      <ProjectDeleteConfirmModal
        open={deleteTarget != null}
        itemLabel={deleteTarget?.label}
        saving={saving}
        error={deleteError}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={handleDelete}
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

      <ProjectStructureLineModal
        open={structureModalSource != null}
        sourceType={structureModalSource}
        simulatedItems={detail.simulatedItems}
        saving={saving}
        error={modalError}
        onClose={() => setStructureModalSource(null)}
        onOpenProductSimulation={(productId) => {
          setModalError(null);
          setStructureModalSource(null);
          setSimulationError(null);
          setSimulationProductId(productId);
        }}
        onSubmit={async (body) => {
          setSaving(true);
          setModalError(null);
          try {
            await fetchJsonOk(`/api/projects/${projectId}/structure-lines`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            setStructureModalSource(null);
            await load();
          } catch (e) {
            setModalError(e instanceof Error ? e.message : "Erro ao adicionar linha.");
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}

function EntitySection({
  title,
  headers,
  rows,
  empty,
  isEmpty,
  canManage,
  onAddClick,
}: {
  title: string;
  headers: string[];
  rows: React.ReactNode;
  empty: string;
  isEmpty?: boolean;
  canManage: boolean;
  onAddClick?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">{title}</h4>
        {canManage && onAddClick ? (
          <button
            type="button"
            onClick={onAddClick}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isEmpty ? (
              <tr>
                <td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              rows
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StructureTab({
  detail,
  canManage,
  onAddLine,
  onAddLabor,
  onEditLine,
  onDeleteLine,
  onOpenProductSimulation,
}: {
  detail: ProjectDetail;
  canManage: boolean;
  onAddLine: (sourceType: ProjectStructureSourceType) => void;
  onAddLabor: () => void;
  onEditLine: (line: ProjectStructureLineRow) => void;
  onDeleteLine: (line: ProjectStructureLineRow) => void;
  onOpenProductSimulation: (productId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">Estrutura / BOM simulada</h4>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => onAddLine("EXISTING_MATERIAL")}>
              + Material existente
            </button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => onAddLine("EXISTING_PRODUCT")}>
              + Produto existente
            </button>
            {detail.structureLines.some((l) => l.existingProductId) ? (
              <button
                type="button"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-950"
                onClick={() => {
                  const pid = detail.structureLines.find((l) => l.existingProductId)?.existingProductId;
                  if (pid) onOpenProductSimulation(pid);
                }}
              >
                Editar simulação do produto
              </button>
            ) : null}
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => onAddLine("SIMULATED_ITEM")}>
              + Item simulado
            </button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => onAddLine("MANUAL")}>
              + Manual
            </button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={onAddLabor}>
              + HH / Mão de obra
            </button>
          </div>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Origem</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Qtd</th>
              <th className="px-3 py-2">Un.</th>
              <th className="px-3 py-2">Perda</th>
              <th className="px-3 py-2">Custo un.</th>
              <th className="px-3 py-2">Total</th>
              {canManage ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {detail.structureLines.map((line) => {
              const badge = SOURCE_BADGE[line.sourceType];
              return (
                <tr key={line.id} className="border-b border-border/60">
                  <td className="px-3 py-2">
                    <span className={cn("rounded px-2 py-0.5 text-xs", badge.className)}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">{structureLineTypeLabel(line)}</td>
                  <td className="px-3 py-2">{line.descriptionSnapshot}</td>
                  <td className="px-3 py-2">{line.quantity}</td>
                  <td className="px-3 py-2">{line.unitSnapshot}</td>
                  <td className="px-3 py-2">{formatPercent(line.lossPercent)}</td>
                  <td className="px-3 py-2">{formatMoney(line.unitCostSnapshot)}</td>
                  <td className="px-3 py-2">{formatMoney(line.totalCost)}</td>
                  <RowActions
                    canManage={canManage}
                    onEdit={() => onEditLine(line)}
                    onDelete={() => onDeleteLine(line)}
                  />
                </tr>
              );
            })}
            {!detail.structureLines.length ? (
              <tr>
                <td colSpan={canManage ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhuma linha de estrutura.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProjectsModule() {
  const auth = useAuth();
  const canManage = canManageProjects(auth);
  const params = useParams();
  const projectId = params.projectId;
  const tab = useMemo(
    () => parseProjectTabFromPath(window.location.pathname),
    [params.tab, projectId]
  );

  if (projectId) {
    return <ProjectDetailView projectId={projectId} tab={tab} canManage={canManage} />;
  }

  return <ProjectsListView canManage={canManage} />;
}
