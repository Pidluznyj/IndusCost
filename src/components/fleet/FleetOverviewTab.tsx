import React, { useMemo, useState } from "react";
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
import { AlertTriangle, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import type {
  FleetDashboardResponse,
  FleetExecutiveVehicleRow,
  FleetVehicleStatus,
} from "@/src/types/fleet";
import { FleetVehicleDetailSheet } from "@/src/components/fleet/FleetVehicleDetailSheet";
import {
  FleetStatusBadge,
  formatFleetKm,
} from "@/src/components/fleet/fleetUi";
import { sortFleetExecutiveGridRows } from "@/src/lib/fleetExecutiveDashboard.presentation";
import { cn } from "@/src/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Disponível",
  RESERVED: "Reservado",
  IN_USE: "Em uso",
  MAINTENANCE: "Manutenção",
  BLOCKED: "Bloqueado",
  CLAIMED: "Sinistrado",
  INACTIVE: "Inativo",
  RETURNED: "Devolvido",
  SOLD: "Vendido",
};

const RES_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Solicitada",
  PENDING_APPROVAL: "Aguard. aprovação",
  APPROVED: "Aprovada",
  IN_USE: "Em uso",
  FINISHED: "Finalizada",
  FINISHED_WITH_PENDING: "Finalizada c/ pend.",
  CANCELED: "Cancelada",
  REJECTED: "Rejeitada",
  NO_SHOW: "No-show",
};

type SortKey = "plate" | "monthlyReservations" | "monthlyKm" | "status";

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "ok" | "warn" | "danger" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-4 shadow-sm",
        tone === "danger" && "border-red-200",
        tone === "warn" && "border-amber-200",
        tone === "ok" && "border-emerald-200"
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "danger" && "text-red-700",
          tone === "warn" && "text-amber-700",
          tone === "ok" && "text-emerald-700",
          !tone && "text-slate-900"
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

type Props = {
  dashboard: FleetDashboardResponse;
  canFinancial: boolean;
  onNavigateTab: (tab: "reservations" | "vehicles" | "drivers" | "checklists" | "publicRequests") => void;
  filters: {
    year: number;
    month: number;
    status: string;
    plate: string;
    unit: string;
    vehicleType: string;
  };
  onFiltersChange: (patch: Partial<Props["filters"]>) => void;
};

export function FleetOverviewTab({
  dashboard,
  canFinancial,
  onNavigateTab,
  filters,
  onFiltersChange,
}: Props) {
  const exec = dashboard.executive;
  const [detailId, setDetailId] = useState<string | null>(null);
  const [gridSearch, setGridSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("monthlyKm");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const gridRows = useMemo(() => {
    const rows = exec?.vehicles ?? [];
    const term = gridSearch.trim().toLowerCase();
    let filtered = term
      ? rows.filter(
          (r) =>
            r.plate.toLowerCase().includes(term) ||
            r.brand.toLowerCase().includes(term) ||
            r.model.toLowerCase().includes(term)
        )
      : rows;
    filtered = sortFleetExecutiveGridRows(filtered, sortKey, sortDir);
    return filtered;
  }, [exec?.vehicles, gridSearch, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(gridRows.length / pageSize));
  const pageRows = gridRows.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "plate" || key === "status" ? "asc" : "desc");
    }
  };

  if (!exec) {
    return (
      <p className="text-sm text-slate-500 py-8 text-center">
        Carregando painel executivo…
      </p>
    );
  }

  const s = exec.summary;
  const kmChartData = exec.kmByVehicle.slice(0, 8).map((v) => ({ name: v.plate, km: v.km }));
  const statusChartData = exec.reservationsByStatus.slice(0, 8).map((r) => ({
    name: RES_STATUS_LABEL[r.status] ?? r.status,
    value: r.count,
  }));
  const utilChartData = exec.topVehiclesByReservation.slice(0, 8).map((v) => ({
    name: v.plate,
    reservas: v.value,
  }));

  return (
    <div className="space-y-6" data-testid="fleet-overview-tab">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
        <p className="text-sm font-medium text-slate-900">Filtros da visão geral</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Métricas mensais usam {exec.competenceLabel}. Disponibilidade atual reflete a data de hoje.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs space-y-1">
            <span className="font-medium text-slate-600">Ano</span>
            <input
              type="number"
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
              value={filters.year}
              onChange={(e) => onFiltersChange({ year: Number(e.target.value) || filters.year })}
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="font-medium text-slate-600">Mês</span>
            <select
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
              value={filters.month}
              onChange={(e) => onFiltersChange({ month: Number(e.target.value) })}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {String(i + 1).padStart(2, "0")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span className="font-medium text-slate-600">Status veículo</span>
            <select
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
              value={filters.status}
              onChange={(e) => onFiltersChange({ status: e.target.value })}
            >
              <option value="">Todos</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span className="font-medium text-slate-600">Placa</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
              value={filters.plate}
              onChange={(e) => onFiltersChange({ plate: e.target.value })}
              placeholder="ABC1D23"
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="font-medium text-slate-600">Unidade</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
              value={filters.unit}
              onChange={(e) => onFiltersChange({ unit: e.target.value })}
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="font-medium text-slate-600">Tipo</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
              value={filters.vehicleType}
              onChange={(e) => onFiltersChange({ vehicleType: e.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Veículos cadastrados"
          value={s.totalVehicles}
          sub={`${s.activeVehicles} ativos · ${s.inactiveVehicles} inativos`}
        />
        <KpiCard label="Disponíveis agora" value={s.availableVehicles} tone="ok" sub="Status atual" />
        <KpiCard
          label="Em uso / reservados"
          value={s.inUseVehicles + s.reservedVehicles}
          sub={`${s.inUseVehicles} em uso · ${s.reservedVehicles} reservados`}
        />
        <KpiCard
          label="Em manutenção"
          value={s.maintenanceVehicles}
          tone={s.maintenanceVehicles > 0 ? "warn" : undefined}
        />
        <KpiCard label="Reservas abertas" value={s.openReservations} />
        <KpiCard label="Finalizadas no mês" value={s.closedReservationsInMonth} />
        <KpiCard
          label="KM rodados no mês"
          value={s.monthlyKmDataAvailable ? formatFleetKm(s.monthlyKm) : "—"}
          sub={s.monthlyKmDataAvailable ? exec.competenceLabel : "Sem dados suficientes"}
        />
        <KpiCard
          label="Mais reservado"
          value={s.topReservedVehicle?.plate ?? "—"}
          sub={
            s.topReservedVehicle
              ? `${s.topReservedVehicle.value} reserva(s)`
              : "Nenhuma reserva no período"
          }
        />
        <KpiCard
          label="Mais rodou"
          value={s.topKmVehicle?.plate ?? "—"}
          sub={s.topKmVehicle ? formatFleetKm(s.topKmVehicle.value) : "Sem km no período"}
        />
        <KpiCard
          label="Alertas ativos"
          value={s.activeAlerts}
          tone={s.criticalAlerts > 0 ? "danger" : s.warningAlerts > 0 ? "warn" : undefined}
          sub={`${s.criticalAlerts} críticos · ${s.warningAlerts} atenção`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="KM rodado por veículo" subtitle={exec.competenceLabel} empty={kmChartData.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={kmChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="km" fill="#2563EB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Reservas por status" subtitle={exec.competenceLabel} empty={statusChartData.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={statusChartData} dataKey="value" nameKey="name" outerRadius={80} label>
                {statusChartData.map((_, i) => (
                  <Cell key={i} fill={["#2563EB", "#059669", "#D97706", "#DC2626", "#6366F1"][i % 5]!} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Utilização por veículo" subtitle="Top reservas no mês" empty={utilChartData.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={utilChartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="reservas" fill="#059669" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankingPanel title="Top 5 — mais reservados" items={exec.topVehiclesByReservation} suffix=" reservas" />
        <RankingPanel title="Top 5 — mais KM" items={exec.topVehiclesByKm} suffix=" km" formatValue={formatFleetKm} />
        <RankingPanel
          title="Top 5 — mais parados"
          items={exec.topIdleVehicles.map((v) => ({ ...v, value: v.idleDays }))}
          suffix=" dias"
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-900">Top motoristas no mês</h3>
          {exec.topDrivers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Sem reservas com motorista no período.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {exec.topDrivers.map((d) => (
                <li key={d.driverId} className="flex justify-between text-sm">
                  <span>{d.name}</span>
                  <span className="font-semibold tabular-nums">{d.reservations}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Resumo de reservas</h3>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {[
            ["Abertas", exec.reservationSummary.open],
            ["Em andamento", exec.reservationSummary.inProgress],
            ["Finalizadas", exec.reservationSummary.finished],
            ["Canceladas", exec.reservationSummary.canceled],
            ["Atrasadas", exec.reservationSummary.overdue],
            ["Hoje", exec.reservationSummary.today],
            ["Próximas", exec.reservationSummary.upcoming],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-slate-50 px-3 py-2 text-center">
              <p className="text-[10px] uppercase text-slate-500">{label}</p>
              <p className="text-lg font-bold">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-900">Reservas que precisam de atenção</h3>
        {exec.attentionReservations.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma reserva crítica no momento.</p>
        ) : (
          <ul className="space-y-2">
            {exec.attentionReservations.map((r) => (
              <li
                key={`${r.id}-${r.reason}`}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm flex items-start gap-2",
                  r.severity === "critical" && "bg-red-50 text-red-800",
                  r.severity === "warning" && "bg-amber-50 text-amber-900",
                  r.severity === "info" && "bg-slate-50 text-slate-700"
                )}
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <strong>{r.plate}</strong> — {r.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Alertas da frota</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          {s.criticalAlerts} críticos · {s.warningAlerts} atenção · {s.infoAlerts} informativos
        </p>
        {dashboard.alerts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhum alerta no momento.</p>
        ) : (
          <ul className="mt-3 max-h-64 overflow-y-auto space-y-1.5">
            {dashboard.alerts.slice(0, 15).map((a, i) => (
              <li
                key={`${a.code}-${i}`}
                className={cn(
                  "text-sm rounded-lg px-2 py-1.5",
                  a.level === "critical" && "bg-red-50 text-red-800",
                  a.level === "warning" && "bg-amber-50 text-amber-800",
                  a.level === "info" && "bg-slate-50 text-slate-700"
                )}
              >
                {a.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Frota por placa</h3>
          <input
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            placeholder="Buscar placa ou modelo…"
            value={gridSearch}
            onChange={(e) => {
              setGridSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {exec.vehicles.slice(0, 6).map((v) => (
            <VehicleCard key={v.id} vehicle={v} onDetail={() => setDetailId(v.id)} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Grid da frota</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <SortTh label="Placa" active={sortKey === "plate"} dir={sortDir} onClick={() => toggleSort("plate")} />
                <th className="px-3 py-2 text-left">Veículo</th>
                <SortTh label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
                <SortTh label="Reservas" active={sortKey === "monthlyReservations"} dir={sortDir} onClick={() => toggleSort("monthlyReservations")} />
                <SortTh label="KM mês" active={sortKey === "monthlyKm"} dir={sortDir} onClick={() => toggleSort("monthlyKm")} />
                <th className="px-3 py-2 text-left">Alertas</th>
                <th className="px-3 py-2 text-left">Ação</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    Nenhum veículo encontrado.
                  </td>
                </tr>
              ) : (
                pageRows.map((v) => (
                  <tr key={v.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold">{v.plate}</td>
                    <td className="px-3 py-2">
                      {v.brand} {v.model}
                    </td>
                    <td className="px-3 py-2">
                      <FleetStatusBadge status={v.status as FleetVehicleStatus} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{v.monthlyReservations}</td>
                    <td className="px-3 py-2 tabular-nums">{formatFleetKm(v.monthlyKm)}</td>
                    <td className="px-3 py-2">{v.alertCount > 0 ? v.alertCount : "—"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700"
                        onClick={() => setDetailId(v.id)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
          <span>
            {gridRows.length} veículo(s) · Página {page} de {totalPages}
          </span>
          <div className="flex gap-1">
            <button type="button" disabled={page <= 1} className="rounded border p-1 disabled:opacity-40" onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" disabled={page >= totalPages} className="rounded border p-1 disabled:opacity-40" onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {canFinancial && dashboard.financial ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-900">Financeiro do mês ({dashboard.financial.competence})</h3>
          <p className="mt-2 text-xl font-semibold">
            {dashboard.financial.totalMonth != null
              ? dashboard.financial.totalMonth.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
              : "—"}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <ShortcutBtn label="Nova reserva" onClick={() => onNavigateTab("reservations")} />
        <ShortcutBtn label="Veículos" onClick={() => onNavigateTab("vehicles")} />
        <ShortcutBtn label="Motoristas" onClick={() => onNavigateTab("drivers")} />
      </div>

      {detailId ? (
        <FleetVehicleDetailSheet
          vehicleId={detailId}
          onClose={() => setDetailId(null)}
          canEdit={false}
          canManage={false}
          canFinancial={canFinancial}
        />
      ) : null}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {subtitle ? <p className="text-[11px] text-slate-500">{subtitle}</p> : null}
      {empty ? (
        <p className="mt-8 text-center text-sm text-slate-500 py-8">Sem dados no período.</p>
      ) : (
        <div className="mt-2">{children}</div>
      )}
    </div>
  );
}

function RankingPanel({
  title,
  items,
  suffix,
  formatValue,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  suffix: string;
  formatValue?: (n: number) => string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Sem dados no período.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((v) => (
            <li key={v.label} className="flex justify-between gap-2 text-sm">
              <span className="truncate">{v.label}</span>
              <span className="font-semibold tabular-nums shrink-0">
                {formatValue ? formatValue(v.value) : v.value}
                {suffix}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VehicleCard({ vehicle, onDetail }: { vehicle: FleetExecutiveVehicleRow; onDetail: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold">{vehicle.plate}</p>
          <p className="text-sm text-slate-600">
            {vehicle.brand} {vehicle.model}
          </p>
        </div>
        <FleetStatusBadge status={vehicle.status as FleetVehicleStatus} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-600">
        <span>KM mês: {formatFleetKm(vehicle.monthlyKm)}</span>
        <span>Reservas: {vehicle.monthlyReservations}</span>
        <span>KM atual: {vehicle.currentKm != null ? formatFleetKm(vehicle.currentKm) : "—"}</span>
        <span>Alertas: {vehicle.alertCount || "—"}</span>
      </div>
      <button type="button" onClick={onDetail} className="mt-2 text-xs font-semibold text-blue-700">
        Ver detalhes
      </button>
    </div>
  );
}

function SortTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={onClick}>
      {label}
      {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}

function ShortcutBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
    >
      {label}
    </button>
  );
}
