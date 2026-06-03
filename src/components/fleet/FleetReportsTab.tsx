import { formatFleetApiError } from "@/src/lib/fleetApiError";
import React, { useCallback, useState } from "react";
import { AlertTriangle, Download, Loader2, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useFleetPermissions } from "@/src/components/fleet/fleetPermissions";
import { FLEET_REPORT_TYPES } from "@/src/types/fleet";

type ReportId = (typeof FLEET_REPORT_TYPES)[number]["id"];

const EMPTY_FILTERS = {
  start: "",
  end: "",
  status: "",
  unit: "",
  costCenter: "",
  origin: "",
  vehicleId: "",
  driverId: "",
  competence: "",
  includeInactive: false,
  onlyExpiring: false,
};

const FINANCIAL_KEYS = new Set([
  "amount",
  "totalAmount",
  "estimatedValue",
  "finalValue",
  "costPerKm",
  "costPerKmLabel",
]);

const COLUMN_LABELS: Record<string, string> = {
  vehicleId: "ID veículo",
  plate: "Placa",
  brand: "Marca",
  model: "Modelo",
  status: "Status",
  origin: "Origem",
  unit: "Unidade",
  costCenter: "Centro de custo",
  currentKm: "Km atual",
  activeContractNumber: "Contrato",
  contractType: "Tipo contrato",
  contractEndDate: "Fim contrato",
  documentsExpired: "Docs vencidos",
  documentsExpiring: "Docs vencendo",
  documentsTotal: "Total docs",
  reservationsCount: "Reservas",
  kmDriven: "Km rodado",
  usageHours: "Horas uso",
  usageDays: "Dias uso",
  idlenessDays: "Ociosidade (dias)",
  drivers: "Motoristas",
  periodStart: "Início período",
  periodEnd: "Fim período",
  costType: "Tipo custo",
  competence: "Competência",
  totalAmount: "Valor total",
  kmInPeriod: "Km no período",
  costPerKm: "Custo/km",
  costPerKmLabel: "Custo/km",
  supplierName: "Fornecedor",
  downtimeDays: "Dias parado",
  isOpen: "Aberta",
  maintenanceType: "Tipo manutenção",
  kind: "Tipo",
  reference: "Referência",
  complianceStatus: "Situação",
  expirationDate: "Vencimento",
};

export function FleetReportsTab() {
  const { canFinancial } = useFleetPermissions();

  const [reportId, setReportId] = useState<ReportId>("fleet");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reportMeta = FLEET_REPORT_TYPES.find((r) => r.id === reportId)!;

  const buildQuery = (format?: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (typeof v === "boolean") {
        if (v) q.set(k, "true");
      } else if (String(v).trim()) {
        q.set(k, String(v).trim());
      }
    }
    if (format) q.set("format", format);
    return q.toString();
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<{ rows: Record<string, unknown>[]; count: number }>(
        `${reportMeta.path}?${buildQuery()}`
      );
      setRows(data.rows ?? []);
      setLoaded(true);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao gerar relatório."));
      setRows([]);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [reportMeta.path, filters]);

  const exportCsv = () => {
    const url = `${reportMeta.path}?${buildQuery("csv")}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  const formatCell = (key: string, value: unknown) => {
    if (!canFinancial && FINANCIAL_KEYS.has(key)) {
      if (key === "costPerKmLabel" && value === "não calculável") return value;
      return "••••••";
    }
    if (value == null || value === "") return "—";
    if (typeof value === "boolean") return value ? "Sim" : "Não";
    return String(value);
  };

  const headerLabel = (key: string) => COLUMN_LABELS[key] ?? key;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Relatórios exportáveis da frota. Use os filtros e exporte CSV com os mesmos critérios da
        visualização.
      </p>

      <div className="flex flex-wrap gap-1">
        {FLEET_REPORT_TYPES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => {
              setReportId(r.id);
              setLoaded(false);
              setRows([]);
              setError(null);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium touch-manipulation min-h-[40px]",
              reportId === r.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {(reportId === "costs" || reportId === "maintenance") && !canFinancial && (
        <p className="text-sm text-amber-700 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          Valores financeiros ocultos — permissão <code className="text-xs">fleet.financial.view</code>{" "}
          necessária.
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="text-slate-600">Data início</span>
          <input
            type="date"
            className="mt-1 w-full rounded-lg border px-3 py-2 touch-manipulation"
            value={filters.start}
            onChange={(e) => setFilters({ ...filters, start: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Data fim</span>
          <input
            type="date"
            className="mt-1 w-full rounded-lg border px-3 py-2 touch-manipulation"
            value={filters.end}
            onChange={(e) => setFilters({ ...filters, end: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Status</span>
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            placeholder="Ex.: AVAILABLE, EXPIRED"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Unidade</span>
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={filters.unit}
            onChange={(e) => setFilters({ ...filters, unit: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Centro de custo</span>
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={filters.costCenter}
            onChange={(e) => setFilters({ ...filters, costCenter: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">ID veículo</span>
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs"
            value={filters.vehicleId}
            onChange={(e) => setFilters({ ...filters, vehicleId: e.target.value })}
          />
        </label>
        {reportId === "fleet" && (
          <label className="block text-sm">
            <span className="text-slate-600">Origem</span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="OWNED, RENTED…"
              value={filters.origin}
              onChange={(e) => setFilters({ ...filters, origin: e.target.value })}
            />
          </label>
        )}
        {reportId === "costs" && (
          <label className="block text-sm">
            <span className="text-slate-600">Competência</span>
            <input
              type="month"
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={filters.competence}
              onChange={(e) => setFilters({ ...filters, competence: e.target.value })}
            />
          </label>
        )}
        {reportId === "fleet" && (
          <label className="flex items-end gap-2 pb-2 text-sm min-h-[52px]">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={filters.includeInactive}
              onChange={(e) =>
                setFilters({ ...filters, includeInactive: e.target.checked })
              }
            />
            <span>Incluir inativos/vendidos (histórico)</span>
          </label>
        )}
        {reportId === "documents" && (
          <label className="flex items-end gap-2 pb-2 text-sm min-h-[52px]">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={filters.onlyExpiring}
              onChange={(e) => setFilters({ ...filters, onlyExpiring: e.target.checked })}
            />
            <span>Somente vencidos/vencendo</span>
          </label>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white min-h-[44px] touch-manipulation disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Gerar relatório
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm min-h-[44px] touch-manipulation"
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-500">
          <Loader2 className="h-7 w-7 animate-spin" />
          <span className="text-sm">Gerando relatório…</span>
        </div>
      )}

      {!loading && loaded && rows.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center">
          <p className="text-sm text-slate-500">Nenhum registro para os filtros selecionados.</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2 whitespace-nowrap">
                    {headerLabel(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/50">
                  {headers.map((h) => (
                    <td key={h} className="px-3 py-2 whitespace-nowrap">
                      {formatCell(h, row[h])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-slate-500 border-t border-slate-100">
            {rows.length} registro(s) — exportação CSV usa os mesmos filtros.
          </p>
        </div>
      )}
    </div>
  );
}
