import React, { useCallback, useState } from "react";
import { AlertTriangle, Download, Loader2, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
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
};

export function FleetReportsTab() {
  const auth = useAuth();
  const canFinancial =
    auth.hasPermission("fleet.financial.view") || auth.hasPermission("fleet.manage");

  const [reportId, setReportId] = useState<ReportId>("fleet");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reportMeta = FLEET_REPORT_TYPES.find((r) => r.id === reportId)!;

  const buildQuery = (format?: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters) as [string, string][]) {
      if (v.trim()) q.set(k, v.trim());
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
      setError(e instanceof Error ? e.message : "Erro ao gerar relatório.");
      setRows([]);
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
    if (
      reportId === "costs" &&
      !canFinancial &&
      (key === "amount" || key.endsWith("Value"))
    ) {
      return "••••••";
    }
    if (value == null || value === "") return "—";
    return String(value);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {FLEET_REPORT_TYPES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => {
              setReportId(r.id);
              setLoaded(false);
              setRows([]);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              reportId === r.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {reportId === "costs" && !canFinancial && (
        <p className="text-sm text-amber-700">Valores de custo ocultos sem permissão financeira.</p>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input
          type="date"
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Início"
          value={filters.start}
          onChange={(e) => setFilters({ ...filters, start: e.target.value })}
        />
        <input
          type="date"
          className="rounded border px-2 py-1.5 text-sm"
          value={filters.end}
          onChange={(e) => setFilters({ ...filters, end: e.target.value })}
        />
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Status"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        />
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Unidade"
          value={filters.unit}
          onChange={(e) => setFilters({ ...filters, unit: e.target.value })}
        />
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="Centro de custo"
          value={filters.costCenter}
          onChange={(e) => setFilters({ ...filters, costCenter: e.target.value })}
        />
        {reportId === "fleet" && (
          <input
            className="rounded border px-2 py-1.5 text-sm"
            placeholder="Origem"
            value={filters.origin}
            onChange={(e) => setFilters({ ...filters, origin: e.target.value })}
          />
        )}
        {reportId === "costs" && (
          <input
            type="month"
            className="rounded border px-2 py-1.5 text-sm"
            value={filters.competence}
            onChange={(e) => setFilters({ ...filters, competence: e.target.value })}
          />
        )}
        <div className="flex gap-2 sm:col-span-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Gerar
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {!loading && loaded && rows.length === 0 && (
        <p className="text-sm text-slate-500 py-8 text-center">
          Nenhum registro para os filtros selecionados.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {headers.map((h) => (
                    <td key={h} className="px-3 py-2">
                      {formatCell(h, row[h])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-slate-500">{rows.length} registro(s)</p>
        </div>
      )}
    </div>
  );
}
