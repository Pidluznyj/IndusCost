import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  Loader2,
  Network,
  Percent,
  RefreshCw,
  Scale,
  Search,
  Users,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  canViewEmployeeCompensation,
  canViewEmployeesDashboard,
} from "@/src/lib/operationsAdminPermissions";
import {
  EMPLOYEES_ACTIONS,
  EMPLOYEES_RESOURCE_KEYS,
} from "@/src/lib/employeesAccess";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCompactCurrency } from "@/src/lib/formatFinancialMetric";
import { CONTRACT_TYPE_OPTIONS } from "@/src/lib/employeeHrUi";
import type { EmployeesDashboardSummary } from "@/src/lib/employeesDashboardSummary";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { cn } from "@/src/lib/utils";
import "./employees-dashboard.css";

const CLASSIFICATION_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "DIRETO", label: "Direto" },
  { value: "INDIRETO", label: "Indireto" },
  { value: "APOIO", label: "Apoio" },
];

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Ativos" },
  { value: "INACTIVE", label: "Inativos" },
  { value: "ALL", label: "Todos" },
];

const PIE_COLORS = ["#0f766e", "#0369a1", "#b45309", "#7c3aed"];

const PAYROLL_TYPE_LABEL: Record<string, string> = {
  BENEFIT: "Benefício",
  CHARGE: "Encargo",
  PROVISION: "Provisão",
};

type UiFilters = {
  status: string;
  classification: string;
  contractType: string;
  costCenterId: string;
  departmentId: string;
  directorateId: string;
  q: string;
  admissionFrom: string;
  admissionTo: string;
  payrollType: string;
};

const DEFAULT_FILTERS: UiFilters = {
  status: "ACTIVE",
  classification: "",
  contractType: "",
  costCenterId: "",
  departmentId: "",
  directorateId: "",
  q: "",
  admissionFrom: "",
  admissionTo: "",
  payrollType: "",
};

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCompactCurrency(value);
}

function formatPct(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

function buildQuery(filters: UiFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.classification) params.set("classification", filters.classification);
  if (filters.contractType) params.set("contractType", filters.contractType);
  if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
  if (filters.departmentId) params.set("departmentId", filters.departmentId);
  if (filters.directorateId) params.set("directorateId", filters.directorateId);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.admissionFrom) params.set("admissionFrom", filters.admissionFrom);
  if (filters.admissionTo) params.set("admissionTo", filters.admissionTo);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const selectClass =
  "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/25";

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/25";

function qualityGapHref(
  gap: string,
  filters: UiFilters
): string {
  const params = new URLSearchParams();
  if (filters.status === "ACTIVE" || filters.status === "INACTIVE") {
    params.set("status", filters.status);
  }
  if (filters.classification) params.set("classification", filters.classification);
  params.set("gap", gap);
  const qs = params.toString();
  return qs ? `/employees?${qs}` : "/employees";
}

export function EmployeesDashboardPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const canOpen =
    canViewEmployeesDashboard(auth) ||
    permissions.canPerformAction(
      EMPLOYEES_RESOURCE_KEYS.dashboard,
      EMPLOYEES_ACTIONS.view
    );
  const canSeeCosts =
    canViewEmployeeCompensation(auth) ||
    permissions.canPerformAction(
      EMPLOYEES_RESOURCE_KEYS.sensitiveData,
      EMPLOYEES_ACTIONS.view
    );

  const [draft, setDraft] = useState<UiFilters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<UiFilters>(DEFAULT_FILTERS);
  const [summary, setSummary] = useState<EmployeesDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dimension, setDimension] = useState<"costCenter" | "department">(
    "costCenter"
  );
  const [barMetric, setBarMetric] = useState<"count" | "cost">("count");

  const load = useCallback(async (filters: UiFilters) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<EmployeesDashboardSummary>(
        `/api/employees/dashboard-summary${buildQuery(filters)}`
      );
      setSummary(data);
    } catch (err) {
      setSummary(null);
      setError(err instanceof Error ? err.message : "Falha ao carregar dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canOpen) return;
    void load(applied);
  }, [canOpen, applied, load]);

  const pieData = useMemo(() => {
    if (!summary?.costComposition) return [];
    return summary.costComposition
      .filter((row) => row.amount > 0)
      .map((row) => ({ name: row.label, value: row.amount }));
  }, [summary]);

  const barSource =
    dimension === "costCenter" ? summary?.byCostCenter : summary?.byDepartment;

  const barData = useMemo(() => {
    if (!barSource) return [];
    return barSource.slice(0, 12).map((row) => ({
      name: row.label.length > 22 ? `${row.label.slice(0, 20)}…` : row.label,
      fullName: row.label,
      count: row.count,
      cost: row.totalMonthlyCost ?? 0,
    }));
  }, [barSource]);

  const payrollRows = useMemo(() => {
    const rows = summary?.payrollComponents ?? [];
    if (!draft.payrollType) return rows;
    return rows.filter((r) => r.type === draft.payrollType);
  }, [summary, draft.payrollType]);

  const departmentsForDirectorate = useMemo(() => {
    const opts = summary?.filterOptions.departments ?? [];
    if (!draft.directorateId) return opts;
    return opts.filter((d) => d.directorateId === draft.directorateId);
  }, [summary, draft.directorateId]);

  if (!canOpen) {
    return (
      <div
        className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950"
        data-testid="employees-dashboard-forbidden"
      >
        Sem permissão para o Dashboard de Pessoas. Solicite{" "}
        <span className="font-mono text-xs">employees.dashboard.view</span> (ou{" "}
        <span className="font-mono text-xs">employees.edit</span>) no perfil de
        acesso.
      </div>
    );
  }

  return (
    <div className="employees-dashboard" data-testid="employees-dashboard-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Headcount e custo estimado RH (referência salarial + verbas). Não é
          folha oficial nem ponto.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/employees"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted/50"
          >
            <Users className="h-3.5 w-3.5" />
            Colaboradores
          </Link>
          <Link
            to="/org-chart"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted/50"
          >
            <Network className="h-3.5 w-3.5" />
            Organograma
          </Link>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted/50"
            onClick={() => void load(applied)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Atualizar
          </button>
        </div>
      </div>

      <div className="employees-dashboard__panel">
        <div className="employees-dashboard__filters">
          <Field label="Status">
            <select
              className={selectClass}
              value={draft.status}
              onChange={(e) => setDraft((f) => ({ ...f, status: e.target.value }))}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Classificação">
            <select
              className={selectClass}
              value={draft.classification}
              onChange={(e) =>
                setDraft((f) => ({ ...f, classification: e.target.value }))
              }
            >
              {CLASSIFICATION_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contrato">
            <select
              className={selectClass}
              value={draft.contractType}
              onChange={(e) =>
                setDraft((f) => ({ ...f, contractType: e.target.value }))
              }
            >
              <option value="">Todos</option>
              {CONTRACT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Diretoria">
            <select
              className={selectClass}
              value={draft.directorateId}
              onChange={(e) =>
                setDraft((f) => ({
                  ...f,
                  directorateId: e.target.value,
                  departmentId: "",
                }))
              }
            >
              <option value="">Todas</option>
              {(summary?.filterOptions.directorates ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Departamento">
            <select
              className={selectClass}
              value={draft.departmentId}
              onChange={(e) =>
                setDraft((f) => ({ ...f, departmentId: e.target.value }))
              }
            >
              <option value="">Todos</option>
              {departmentsForDirectorate.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Centro de custo">
            <select
              className={selectClass}
              value={draft.costCenterId}
              onChange={(e) =>
                setDraft((f) => ({ ...f, costCenterId: e.target.value }))
              }
            >
              <option value="">Todos</option>
              {(summary?.filterOptions.costCenters ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Período (de)">
            <input
              type="date"
              className={inputClass}
              value={draft.admissionFrom}
              onChange={(e) =>
                setDraft((f) => ({ ...f, admissionFrom: e.target.value }))
              }
              title="Admissões/desligamentos no período e recorte da tabela por data de admissão"
            />
          </Field>
          <Field label="Período (até)">
            <input
              type="date"
              className={inputClass}
              value={draft.admissionTo}
              onChange={(e) =>
                setDraft((f) => ({ ...f, admissionTo: e.target.value }))
              }
              title="Admissões/desligamentos no período e recorte da tabela por data de admissão"
            />
          </Field>
          <Field label="Busca">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className={cn(inputClass, "pl-8")}
                placeholder="Nome, e-mail, cargo…"
                value={draft.q}
                onChange={(e) => setDraft((f) => ({ ...f, q: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setApplied(draft);
                }}
              />
            </div>
          </Field>
          <div className="employees-dashboard__filter-actions pb-0.5">
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              onClick={() => setApplied(draft)}
              data-testid="employees-dashboard-apply-filters"
            >
              Aplicar filtros
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted/50"
              onClick={() => {
                setDraft(DEFAULT_FILTERS);
                setApplied(DEFAULT_FILTERS);
              }}
            >
              Limpar
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {!canSeeCosts ? (
        <div className="employees-dashboard__muted-banner">
          Valores de custo estimado estão ocultos. Para ver salário, benefícios,
          encargos e provisões, vincule{" "}
          <span className="font-mono">employees.sensitive_data.view</span> (ou{" "}
          <span className="font-mono">employees.edit</span>).
        </div>
      ) : null}

      <SalesOrderKpiSection
        testId="employees-dashboard-kpis"
        title="Indicadores do universo filtrado"
        subtitle="Estimativas administrativas · mesma fórmula da ficha do colaborador"
      >
        <SummaryKpiGrid
          minColumnWidth={168}
          className={SYSTEM_TOTALIZER_GRID_CLASS}
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Headcount"
            amount={loading ? null : summary?.headcount ?? 0}
            amountFormat="number"
            tone="info"
            icon={Users}
            helperText={
              summary
                ? `${summary.activeCount} ativos · ${summary.inactiveCount} inativos no filtro`
                : "Quantidade de colaboradores no filtro"
            }
            loading={loading}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Custo mensal estimado"
            amount={
              loading || !canSeeCosts ? null : summary?.costs?.totalMonthlyCost ?? null
            }
            amountFormat="currency"
            value={
              !loading && !canSeeCosts ? "Sem permissão" : undefined
            }
            tone={canSeeCosts ? "money" : "neutral"}
            icon={Wallet}
            helperText="Σ salário + benefícios + encargos + provisões"
            valueSize={!canSeeCosts ? "text" : "default"}
            loading={loading}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Benefícios (total)"
            amount={
              loading || !canSeeCosts ? null : summary?.costs?.totalBenefits ?? null
            }
            amountFormat="currency"
            value={!loading && !canSeeCosts ? "Sem permissão" : undefined}
            tone={canSeeCosts ? "internal" : "neutral"}
            icon={Scale}
            helperText="Soma das verbas tipo BENEFIT no filtro"
            valueSize={!canSeeCosts ? "text" : "default"}
            loading={loading}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Custo médio / pessoa"
            amount={
              loading || !canSeeCosts
                ? null
                : summary?.costs?.averageCostPerPerson ?? null
            }
            amountFormat="currency"
            value={!loading && !canSeeCosts ? "Sem permissão" : undefined}
            tone={canSeeCosts ? "margin" : "neutral"}
            icon={Percent}
            helperText="Custo mensal estimado ÷ headcount"
            valueSize={!canSeeCosts ? "text" : "default"}
            loading={loading}
          />
        </SummaryKpiGrid>
      </SalesOrderKpiSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="employees-dashboard__panel" data-testid="employees-dashboard-composition">
          <h3 className="employees-dashboard__panel-title">
            Composição do custo mensal
          </h3>
          <p className="employees-dashboard__panel-sub">
            Referência salarial × benefícios × encargos × provisões
          </p>
          {loading ? (
            <div className="flex h-56 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !canSeeCosts || !pieData.length ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
              {!canSeeCosts
                ? "Sem permissão para custos."
                : "Sem valores de custo no filtro."}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
              <div className="h-56 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={2}
                    >
                      {pieData.map((_, idx) => (
                        <Cell
                          key={pieData[idx].name}
                          fill={PIE_COLORS[idx % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => formatMoney(value)}
                      contentStyle={{ fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2 self-center text-xs">
                {summary?.costComposition?.map((row, idx) => {
                  const total = summary.costs?.totalMonthlyCost ?? 0;
                  const share = total > 0 ? row.amount / total : null;
                  return (
                    <li key={row.key} className="flex items-start gap-2">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{
                          background: PIE_COLORS[idx % PIE_COLORS.length],
                        }}
                      />
                      <span>
                        <span className="font-medium text-foreground">
                          {row.label}
                        </span>
                        <br />
                        <span className="text-muted-foreground">
                          {formatMoney(row.amount)}
                          {share != null ? ` · ${formatPct(share)}` : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="employees-dashboard__panel" data-testid="employees-dashboard-by-dimension">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="employees-dashboard__panel-title">
                Distribuição por {dimension === "costCenter" ? "centro de custo" : "departamento"}
              </h3>
              <p className="employees-dashboard__panel-sub mb-0">
                Headcount e custo estimado (top 12)
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                <button
                  type="button"
                  className={cn(
                    "rounded px-2.5 py-1 font-medium",
                    dimension === "costCenter" && "bg-muted text-foreground"
                  )}
                  onClick={() => setDimension("costCenter")}
                >
                  Centro de custo
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded px-2.5 py-1 font-medium",
                    dimension === "department" && "bg-muted text-foreground"
                  )}
                  onClick={() => setDimension("department")}
                >
                  Departamento
                </button>
              </div>
              <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                <button
                  type="button"
                  className={cn(
                    "rounded px-2.5 py-1 font-medium",
                    barMetric === "count" && "bg-muted text-foreground"
                  )}
                  onClick={() => setBarMetric("count")}
                >
                  Pessoas
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded px-2.5 py-1 font-medium",
                    barMetric === "cost" && "bg-muted text-foreground"
                  )}
                  onClick={() => setBarMetric("cost")}
                  disabled={!canSeeCosts}
                  title={
                    !canSeeCosts ? "Requer dados sensíveis" : "Custo estimado"
                  }
                >
                  R$
                </button>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="flex h-56 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !barData.length ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
              Sem dados no filtro.
            </div>
          ) : (
            <div className="h-56 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData}
                  layout="vertical"
                  margin={{ left: 8, right: 12, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={barMetric === "cost"}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) =>
                      barMetric === "cost" ? formatMoney(Number(v)) : String(v)
                    }
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={108}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    formatter={(value: number) =>
                      barMetric === "cost"
                        ? [formatMoney(value), "Custo estimado"]
                        : [value, "Pessoas"]
                    }
                    labelFormatter={(_, payload) =>
                      String(payload?.[0]?.payload?.fullName ?? "")
                    }
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar
                    dataKey={barMetric === "cost" && canSeeCosts ? "cost" : "count"}
                    fill={barMetric === "cost" ? "#0f766e" : "#0369a1"}
                    radius={[0, 3, 3, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="employees-dashboard__panel" data-testid="employees-dashboard-payroll">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="employees-dashboard__panel-title">
                Verbas discriminadas
              </h3>
              <p className="employees-dashboard__panel-sub mb-0">
                Impacto mensal estimado por componente de folha
              </p>
            </div>
            <select
              className={cn(selectClass, "w-auto min-w-[9rem]")}
              value={draft.payrollType}
              onChange={(e) =>
                setDraft((f) => ({ ...f, payrollType: e.target.value }))
              }
              disabled={!canSeeCosts}
            >
              <option value="">Todos os tipos</option>
              <option value="BENEFIT">Benefícios</option>
              <option value="CHARGE">Encargos</option>
              <option value="PROVISION">Provisões</option>
            </select>
          </div>
          {!canSeeCosts ? (
            <p className="text-sm text-muted-foreground">Sem permissão para verbas.</p>
          ) : loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !payrollRows.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma verba vinculada no universo filtrado.
            </p>
          ) : (
            <div className="employees-dashboard__table-wrap">
              <table className="employees-dashboard__table">
                <thead>
                  <tr>
                    <th>Verba</th>
                    <th>Tipo</th>
                    <th>Cálculo</th>
                    <th>Pessoas</th>
                    <th>Valor mensal</th>
                    <th>% custo</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollRows.map((row) => (
                    <tr key={`${row.componentId}-${row.name}-${row.type}`}>
                      <td className="font-medium">{row.name}</td>
                      <td>{PAYROLL_TYPE_LABEL[row.type] ?? row.type}</td>
                      <td>
                        {row.calculationType === "PERCENTAGE"
                          ? `${row.value}%`
                          : formatMoney(row.value)}
                      </td>
                      <td>{row.peopleCount}</td>
                      <td>{formatMoney(row.totalAmount)}</td>
                      <td>{formatPct(row.shareOfTotalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="employees-dashboard__panel" data-testid="employees-dashboard-quality">
          <h3 className="employees-dashboard__panel-title">Qualidade cadastral</h3>
          <p className="employees-dashboard__panel-sub">
            Lacunas no universo filtrado — use a lista de colaboradores para corrigir
          </p>
          <div className="employees-dashboard__quality-grid">
            {(
              [
                ["Sem usuário de acesso", "withoutAppUser", summary?.quality.withoutAppUser],
                [
                  "Sem e-mail corporativo",
                  "withoutCorporateEmail",
                  summary?.quality.withoutCorporateEmail,
                ],
                [
                  "Sem centro de custo",
                  "withoutCostCenter",
                  summary?.quality.withoutCostCenter,
                ],
                [
                  "Sem departamento",
                  "withoutDepartment",
                  summary?.quality.withoutDepartment,
                ],
                ["Sem gestor", "withoutManager", summary?.quality.withoutManager],
                [
                  "Sem referência salarial",
                  "withoutSalary",
                  summary?.quality.withoutSalary,
                ],
                [
                  "Sem verbas",
                  "withoutPayrollComponents",
                  summary?.quality.withoutPayrollComponents,
                ],
              ] as const
            ).map(([label, gap, value]) => (
              <Link
                key={gap}
                to={qualityGapHref(gap, applied)}
                className="employees-dashboard__quality-card"
                title="Abrir lista filtrada"
              >
                <strong>{loading ? "…" : value ?? 0}</strong>
                <span>{label}</span>
              </Link>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Por classificação
              </p>
              <ul className="mt-1 space-y-1 text-xs">
                {(summary?.byClassification ?? []).slice(0, 4).map((row) => (
                  <li key={row.key} className="flex justify-between gap-2">
                    <span className="truncate text-muted-foreground">{row.label}</span>
                    <span className="shrink-0 text-right font-semibold">
                      {row.count}
                      {canSeeCosts && row.totalMonthlyCost != null
                        ? ` · ${formatMoney(row.totalMonthlyCost)}`
                        : ""}
                    </span>
                  </li>
                ))}
                {!summary?.byClassification.length && !loading ? (
                  <li className="text-muted-foreground">—</li>
                ) : null}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Por contrato
              </p>
              <ul className="mt-1 space-y-1 text-xs">
                {(summary?.byContractType ?? []).slice(0, 4).map((row) => (
                  <li key={row.key} className="flex justify-between gap-2">
                    <span className="truncate text-muted-foreground">{row.label}</span>
                    <span className="shrink-0 text-right font-semibold">
                      {row.count}
                      {canSeeCosts && row.totalMonthlyCost != null
                        ? ` · ${formatMoney(row.totalMonthlyCost)}`
                        : ""}
                    </span>
                  </li>
                ))}
                {!summary?.byContractType.length && !loading ? (
                  <li className="text-muted-foreground">—</li>
                ) : null}
              </ul>
            </div>
          </div>

          {summary ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                {applied.admissionFrom || applied.admissionTo ? (
                  <>
                    Movimentação no período (independente do status):{" "}
                    <strong>{summary.movement.admissionsInPeriod}</strong> admissões ·{" "}
                    <strong>{summary.movement.terminationsInPeriod}</strong>{" "}
                    desligamentos
                  </>
                ) : (
                  <>
                    Movimentação: informe o período nos filtros para contar
                    admissões e desligamentos.
                  </>
                )}
              </span>
            </div>
          ) : null}

          {canSeeCosts && summary?.costs ? (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  Horas contratadas / produtivas
                </p>
                <p className="mt-0.5 text-sm font-semibold">
                  {Math.round(summary.costs.totalContractedHours)}h
                  <span className="text-xs font-normal text-muted-foreground">
                    {" "}
                    / {Math.round(summary.costs.totalProductiveHours)}h
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  HH produtiva média
                </p>
                <p className="mt-0.5 text-sm font-semibold">
                  {formatMoney(summary.costs.averageCostPerProductiveHour)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {" "}
                    /h
                  </span>
                </p>
              </div>
              <div className="col-span-2 rounded-lg border border-border px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  Cobertura salarial
                </p>
                <p className="mt-0.5 text-sm font-semibold">
                  {formatPct(summary.costs.salaryCoverageRatio)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {" "}
                    ({summary.costs.salaryCoverageCount} com referência &gt; 0)
                  </span>
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
