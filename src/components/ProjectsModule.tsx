import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  Sparkles,
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
import type {
  ProjectDashboardPayload,
  ProjectDetail,
  ProjectListResponse,
  ProjectMoldChargeMode,
  ProjectMoldOwnership,
  ProjectSimulatedItemType,
  ProjectStatus,
  ProjectStructureLineType,
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
    customerName: "",
    projectType: "NEW_PRODUCT" as ProjectType,
    commercialOwner: "",
    technicalOwner: "",
    targetMarginPercent: "",
  });

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
    if (!form.title.trim() || !form.customerName.trim()) return;
    setSaving(true);
    try {
      const created = await fetchJsonOk<ProjectDetail>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          customerName: form.customerName.trim(),
          projectType: form.projectType,
          commercialOwner: form.commercialOwner.trim() || null,
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
            onClick={() => setCreateOpen(true)}
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
              <input
                required
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                placeholder="Cliente"
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
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
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                  placeholder="Responsável comercial"
                  value={form.commercialOwner}
                  onChange={(e) => setForm((f) => ({ ...f, commercialOwner: e.target.value }))}
                />
                <input
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                  placeholder="Responsável técnico"
                  value={form.technicalOwner}
                  onChange={(e) => setForm((f) => ({ ...f, technicalOwner: e.target.value }))}
                />
              </div>
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<ProjectDetail>(`/api/projects/${projectId}`);
      setDetail(data);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
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
          empty="Nenhum produto simulado."
          onAdd={async () => {
            const description = window.prompt("Descrição do produto simulado:");
            if (!description?.trim()) return;
            await fetchJsonOk(`/api/projects/${projectId}/simulated-products`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ description: description.trim() }),
            });
            await load();
          }}
          rows={detail.simulatedProducts.map((p) => (
            <tr key={p.id} className="border-b border-border/60">
              <td className="px-3 py-2">{p.provisionalCode ?? "—"}</td>
              <td className="px-3 py-2">{p.description}</td>
              <td className="px-3 py-2">{p.unit}</td>
              <td className="px-3 py-2">{p.expectedVolume ?? "—"}</td>
              <td className="px-3 py-2">{p.batchSize ?? "—"}</td>
            </tr>
          ))}
          headers={["Código prov.", "Descrição", "Un.", "Volume", "Lote"]}
        />
      ) : null}

      {tab === "structure" ? (
        <StructureTab projectId={projectId} detail={detail} canManage={canManage} onReload={load} />
      ) : null}

      {tab === "items" ? (
        <EntitySection
          title="Itens simulados (não viram cadastro oficial)"
          canManage={canManage}
          empty="Nenhum item simulado."
          onAdd={async () => {
            const description = window.prompt("Descrição do item simulado:");
            if (!description?.trim()) return;
            await fetchJsonOk(`/api/projects/${projectId}/simulated-items`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                description: description.trim(),
                itemType: "RAW_MATERIAL" as ProjectSimulatedItemType,
              }),
            });
            await load();
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
            </tr>
          ))}
          headers={["Origem", "Descrição", "Tipo", "Custo", "Cotação?"]}
        />
      ) : null}

      {tab === "molds" ? (
        <EntitySection
          title="Molde / Ferramental"
          canManage={canManage}
          empty="Nenhum molde cadastrado."
          onAdd={async () => {
            const name = window.prompt("Nome do molde:");
            if (!name?.trim()) return;
            const costStr = window.prompt("Custo de construção:", "0");
            await fetchJsonOk(`/api/projects/${projectId}/molds`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: name.trim(),
                constructionCost: Number(costStr) || 0,
                chargeMode: "AMORTIZED_IN_PRODUCT" as ProjectMoldChargeMode,
                amortizationQuantity: 10000,
                ownership: "UNDEFINED" as ProjectMoldOwnership,
              }),
            });
            await load();
          }}
          rows={detail.molds.map((m) => (
            <tr key={m.id} className="border-b border-border/60">
              <td className="px-3 py-2">{m.name}</td>
              <td className="px-3 py-2">{m.chargeMode}</td>
              <td className="px-3 py-2">{formatMoney(m.constructionCost)}</td>
              <td className="px-3 py-2">{m.amortizationQuantity ?? "—"}</td>
              <td className="px-3 py-2">{formatMoney(m.amortizedCostPerUnit)}</td>
              <td className="px-3 py-2">{m.ownership}</td>
            </tr>
          ))}
          headers={["Nome", "Cobrança", "Construção", "Qtd amort.", "Custo/un.", "Propriedade"]}
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
          <h4 className="font-semibold">Observações técnicas e comerciais</h4>
          {canManage ? (
            <textarea
              className="mt-3 min-h-[160px] w-full rounded-lg border border-border px-3 py-2 text-sm"
              defaultValue={detail.notes ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (detail.notes ?? "")) {
                  patchProject({ notes: e.target.value });
                }
              }}
            />
          ) : (
            <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {detail.notes ?? "Sem observações."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EntitySection({
  title,
  headers,
  rows,
  empty,
  canManage,
  onAdd,
}: {
  title: string;
  headers: string[];
  rows: React.ReactNode;
  empty: string;
  canManage: boolean;
  onAdd: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">{title}</h4>
        {canManage ? (
          <button
            type="button"
            disabled={adding}
            onClick={async () => {
              setAdding(true);
              try {
                await onAdd();
              } finally {
                setAdding(false);
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
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
          <tbody>{rows}</tbody>
        </table>
        {!rows ? (
          <p className="px-4 py-8 text-center text-muted-foreground">{empty}</p>
        ) : null}
      </div>
    </div>
  );
}

function StructureTab({
  projectId,
  detail,
  canManage,
  onReload,
}: {
  projectId: string;
  detail: ProjectDetail;
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const addLine = async (sourceType: ProjectStructureSourceType) => {
    let body: Record<string, unknown> = {
      sourceType,
      lineType: "RAW_MATERIAL" as ProjectStructureLineType,
      quantity: 1,
      lossPercent: 0,
    };
    if (sourceType === "MANUAL") {
      const description = window.prompt("Descrição da linha manual:");
      if (!description?.trim()) return;
      const unitCost = Number(window.prompt("Custo unitário:", "0") ?? "0");
      body = { ...body, description: description.trim(), unitCost };
    } else if (sourceType === "EXISTING_MATERIAL") {
      const q = window.prompt("Buscar material (código ou descrição):");
      if (!q?.trim()) return;
      const res = await fetchJsonOk<{ rows: { id: string; code: string; description: string }[] }>(
        `/api/projects/lookup/materials?q=${encodeURIComponent(q.trim())}`
      );
      const pick = res.rows[0];
      if (!pick) {
        window.alert("Material não encontrado.");
        return;
      }
      body = { ...body, existingMaterialId: pick.id, lineType: "RAW_MATERIAL" };
    } else if (sourceType === "EXISTING_PRODUCT") {
      const q = window.prompt("Buscar produto (SKU ou nome):");
      if (!q?.trim()) return;
      const res = await fetchJsonOk<{ rows: { id: string; sku: string; name: string }[] }>(
        `/api/projects/lookup/products?q=${encodeURIComponent(q.trim())}`
      );
      const pick = res.rows[0];
      if (!pick) {
        window.alert("Produto não encontrado.");
        return;
      }
      body = { ...body, existingProductId: pick.id, lineType: "COMPONENT" };
    } else if (sourceType === "SIMULATED_ITEM") {
      const item = detail.simulatedItems[0];
      if (!item) {
        window.alert("Cadastre um item simulado antes.");
        return;
      }
      body = { ...body, simulatedItemId: item.id };
    }
    await fetchJsonOk(`/api/projects/${projectId}/structure-lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await onReload();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">Estrutura / BOM simulada</h4>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => addLine("EXISTING_MATERIAL")}>
              + Material existente
            </button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => addLine("EXISTING_PRODUCT")}>
              + Produto existente
            </button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => addLine("SIMULATED_ITEM")}>
              + Item simulado
            </button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => addLine("MANUAL")}>
              + Manual
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
                  <td className="px-3 py-2">{line.lineType}</td>
                  <td className="px-3 py-2">{line.descriptionSnapshot}</td>
                  <td className="px-3 py-2">{line.quantity}</td>
                  <td className="px-3 py-2">{line.unitSnapshot}</td>
                  <td className="px-3 py-2">{formatPercent(line.lossPercent)}</td>
                  <td className="px-3 py-2">{formatMoney(line.unitCostSnapshot)}</td>
                  <td className="px-3 py-2">{formatMoney(line.totalCost)}</td>
                </tr>
              );
            })}
            {!detail.structureLines.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
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
