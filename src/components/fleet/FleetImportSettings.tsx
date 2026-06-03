import { formatFleetApiError } from "@/src/lib/fleetApiError";
import React, { useState } from "react";
import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  FLEET_IMPORT_CONFIRM_TOKEN,
  type FleetImportSummary,
} from "@/src/lib/fleetCsvImportShared";

type ImportKind = "vehicles" | "drivers";

const TEMPLATES: Record<ImportKind, string> = {
  vehicles: "placa;marca;modelo;origem;status;km_atual;unidade;centro_custo\nABC1D23;Ford;Ranger;OWNED;AVAILABLE;15000;SP;CC-FROTA",
  drivers:
    "nome;cpf;categoria_cnh;cnh_validade;status;unidade;centro_custo\nJoão Silva;12345678901;B;2027-12-31;PENDING;SP;CC-FROTA",
};

export function FleetImportSettings() {
  const [kind, setKind] = useState<ImportKind>("vehicles");
  const [csv, setCsv] = useState("");
  const [allowUpdate, setAllowUpdate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FleetImportSummary | null>(null);
  const [applyConfirm, setApplyConfirm] = useState(false);

  const loadFile = async (file: File) => {
    setError(null);
    const text = await file.text();
    setCsv(text);
    setSummary(null);
    setApplyConfirm(false);
  };

  const runPreview = async () => {
    if (!csv.trim()) {
      setError("Informe ou carregue um arquivo CSV.");
      return;
    }
    setLoading(true);
    setError(null);
    setSummary(null);
    setApplyConfirm(false);
    try {
      const path =
        kind === "vehicles"
          ? "/api/fleet/import/vehicles/preview"
          : "/api/fleet/import/drivers/preview";
      const result = await fetchJsonOk<FleetImportSummary>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, allowUpdate }),
      });
      setSummary(result);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro na pré-visualização."));
    } finally {
      setLoading(false);
    }
  };

  const runApply = async () => {
    if (!csv.trim() || !summary) return;
    setLoading(true);
    setError(null);
    try {
      const path =
        kind === "vehicles"
          ? "/api/fleet/import/vehicles/apply"
          : "/api/fleet/import/drivers/apply";
      const result = await fetchJsonOk<FleetImportSummary>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv,
          allowUpdate,
          confirm: FLEET_IMPORT_CONFIRM_TOKEN,
        }),
      });
      setSummary(result);
      setApplyConfirm(true);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao aplicar importação."));
    } finally {
      setLoading(false);
    }
  };

  const invalidRows = summary?.rows.filter((r) => !r.valid) ?? [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 max-w-3xl">
      <div>
        <h3 className="font-semibold text-slate-900">Importação CSV (cadastro inicial)</h3>
        <p className="text-sm text-slate-600 mt-1">
          UTF-8, separador <code>;</code> ou <code>,</code>. Pré-visualização não altera o banco.
          Aplicação grava apenas linhas válidas.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setKind("vehicles");
            setSummary(null);
            setApplyConfirm(false);
          }}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            kind === "vehicles" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
          )}
        >
          Veículos
        </button>
        <button
          type="button"
          onClick={() => {
            setKind("drivers");
            setSummary(null);
            setApplyConfirm(false);
          }}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            kind === "drivers" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
          )}
        >
          Motoristas
        </button>
        <button
          type="button"
          className="text-sm text-slate-600 underline"
          onClick={() => setCsv(TEMPLATES[kind])}
        >
          Carregar modelo
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allowUpdate}
          onChange={(e) => setAllowUpdate(e.target.checked)}
        />
        Permitir atualizar registros existentes (placa/CPF já cadastrados)
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
          <FileUp className="h-4 w-4" />
          Arquivo CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
            }}
          />
        </label>
        <button
          type="button"
          disabled={loading}
          onClick={() => void runPreview()}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pré-visualizar"}
        </button>
        {summary && summary.validCount > 0 && !applyConfirm && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void runApply()}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Aplicar {summary.validCount} linha(s) válida(s)
          </button>
        )}
      </div>

      <textarea
        className="w-full min-h-[120px] rounded-lg border border-slate-200 p-2 font-mono text-xs"
        placeholder="Cole o conteúdo CSV aqui…"
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setSummary(null);
          setApplyConfirm(false);
        }}
      />

      {error && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {summary && (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Total" value={summary.totalRows} />
            <Stat label="Válidas" value={summary.validCount} />
            <Stat label="Inválidas" value={summary.invalidCount} />
            <Stat
              label={summary.mode === "apply" ? "Criadas" : "Criar"}
              value={summary.mode === "apply" ? summary.created : summary.wouldCreate}
            />
            {(summary.wouldUpdate > 0 || summary.updated > 0) && (
              <Stat
                label={summary.mode === "apply" ? "Atualizadas" : "Atualizar"}
                value={summary.mode === "apply" ? summary.updated : summary.wouldUpdate}
              />
            )}
          </div>
          {applyConfirm && (
            <p className="text-emerald-800 font-medium">Importação aplicada com sucesso.</p>
          )}
          {invalidRows.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 max-h-48 overflow-y-auto">
              <p className="font-medium text-amber-900 mb-2">Erros por linha</p>
              <ul className="space-y-1 text-amber-900">
                {invalidRows.map((r) => (
                  <li key={r.line}>
                    <span className="font-mono">L{r.line}:</span> {r.errors.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <p className="text-[10px] uppercase text-slate-500">{label}</p>
      <p className="font-semibold text-slate-900">{value}</p>
    </div>
  );
}
