import React, { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE,
  type FleetReservationsCleanupCounts,
} from "@/src/lib/fleetReservationsCleanupShared";
import { formatFleetApiError } from "@/src/components/fleet/fleetUi";

type Preview = FleetReservationsCleanupCounts & { confirmPhraseRequired: string };

const COUNT_LABELS: { key: keyof FleetReservationsCleanupCounts; label: string }[] = [
  { key: "fleetReservation", label: "Reservas internas" },
  { key: "fleetPublicReservationRequest", label: "Solicitações públicas (QR)" },
  { key: "fleetPublicReservationApprovalHistory", label: "Histórico de aprovações QR" },
  { key: "fleetUsage", label: "Registros de uso (retirada/devolução)" },
  { key: "fleetChecklist", label: "Checklists vinculados a reserva/uso" },
  { key: "fleetChecklistItem", label: "Itens de checklist" },
  { key: "fleetAttachment", label: "Anexos de reserva" },
  { key: "fleetAuditLog", label: "Logs de auditoria de reservas" },
];

function formatCount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0";
}

export function FleetReservationsCleanupPanel() {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<FleetReservationsCleanupCounts | null>(null);

  if (!isSuperAdmin()) return null;

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchJsonOk<{ preview: Preview }>(
        "/api/fleet/admin/reservations-cleanup-preview"
      );
      setPreview(data.preview);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Não foi possível carregar o preview da limpeza."));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const executeCleanup = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<{ deleted: FleetReservationsCleanupCounts }>(
        "/api/fleet/admin/reservations-cleanup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation }),
        }
      );
      setResult(data.deleted);
      setPreview(null);
      setConfirmation("");
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Falha ao executar a limpeza."));
    } finally {
      setLoading(false);
    }
  };

  const confirmOk = confirmation.trim() === FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE;
  const totalToDelete =
    preview == null
      ? 0
      : COUNT_LABELS.reduce((sum, row) => {
          const n = preview[row.key];
          return sum + (typeof n === "number" ? n : 0);
        }, 0);

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-4 space-y-3 max-w-2xl">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-red-700 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-red-900">Limpar reservas de teste</h3>
          <p className="text-sm text-red-800 mt-1">
            Remove todas as reservas internas, solicitações públicas QR e registros filhos
            diretamente vinculados. Ação <strong>irreversível</strong>. Veículos, motoristas,
            manutenções, multas, abastecimentos e cadastros mestres são preservados.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 space-y-1">
          <p className="font-medium">Limpeza concluída.</p>
          <ul className="text-xs space-y-0.5">
            {COUNT_LABELS.map((row) => (
              <li key={row.key}>
                {row.label}: {formatCount(result[row.key])}
              </li>
            ))}
            <li>Veículos recalculados: {formatCount(result.vehiclesRecalculated)}</li>
            <li>
              Preservados — veículos: {formatCount(result.preserved?.fleetVehicle)} · motoristas:{" "}
              {formatCount(result.preserved?.fleetDriver)}
            </li>
          </ul>
        </div>
      )}

      {preview && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm space-y-2">
          <p className="font-medium text-slate-900">Preview — registros que serão apagados</p>
          <ul className="grid gap-1 sm:grid-cols-2 text-slate-700 text-xs">
            {COUNT_LABELS.map((row) => (
              <li key={row.key}>
                {row.label}: <span className="font-semibold">{formatCount(preview[row.key])}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 pt-1 border-t border-slate-100">
            Total estimado: {totalToDelete} registros · veículos preservados:{" "}
            {formatCount(preview.preserved?.fleetVehicle)} · motoristas preservados:{" "}
            {formatCount(preview.preserved?.fleetDriver)}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadPreview()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
        >
          {loading && !preview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Carregar preview
        </button>
      </div>

      {preview && (
        <div className="space-y-2 border-t border-red-200 pt-3">
          <label className="block text-xs font-semibold text-red-900">
            Digite exatamente para confirmar:
            <span className="block font-mono text-[11px] mt-1 text-red-800">
              {FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE}
            </span>
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-mono"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            disabled={loading || !confirmOk || totalToDelete === 0}
            onClick={() => void executeCleanup()}
            className="inline-flex items-center gap-1 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Apagar todas as reservas
          </button>
          {totalToDelete === 0 && (
            <p className="text-xs text-slate-600">Não há registros de reserva para apagar.</p>
          )}
        </div>
      )}
    </div>
  );
}
