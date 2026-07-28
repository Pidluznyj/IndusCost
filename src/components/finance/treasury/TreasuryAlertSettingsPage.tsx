import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  TREASURY_ALERT_KIND_LABELS,
  TREASURY_ALERT_KINDS,
  type TreasuryAlertKind,
} from "@/src/lib/treasury/contracts/treasuryAlertConfig.js";
import {
  fetchTreasuryAlertSettings,
  updateTreasuryAlertSettings,
  type TreasuryAlertSettingsClientDto,
} from "@/src/lib/treasury/treasuryAlertSettingsApi.js";
import {
  canManageTreasuryExceptions,
  canViewTreasuryExceptions,
} from "@/src/lib/treasury/treasuryExceptionsPermissions.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";

/**
 * Configuração global de alertas da Tesouraria (GET/PUT alert-settings).
 */
export function TreasuryAlertSettingsPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryExceptions(permCheck);
  const canManage = canManageTreasuryExceptions(permCheck);

  const [settings, setSettings] =
    useState<TreasuryAlertSettingsClientDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSettings(await fetchTreasuryAlertSettings());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Falha ao carregar configurações."
      );
    }
  }, []);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  if (!canView) {
    return (
      <PermissionDenied message="Sem permissão para consultar configuração de alertas." />
    );
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settings || !canManage) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateTreasuryAlertSettings({
        alertsEnabled: settings.alertsEnabled,
        relevantReceiptMinAmount: settings.relevantReceiptMinAmount,
        customerConcentrationTopN: settings.customerConcentrationTopN,
        customerConcentrationMinSharePercent:
          settings.customerConcentrationMinSharePercent,
        staleBalanceHours: settings.staleBalanceHours,
        syncMaxAgeHours: settings.syncMaxAgeHours,
        severityByKind: settings.severityByKind,
        enabledByKind: settings.enabledByKind,
      });
      setSettings(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao salvar configurações."
      );
    } finally {
      setSaving(false);
    }
  }

  function patchKindEnabled(kind: TreasuryAlertKind, enabled: boolean) {
    if (!settings) return;
    setSettings({
      ...settings,
      enabledByKind: { ...settings.enabledByKind, [kind]: enabled },
    });
  }

  return (
    <div className="space-y-4" data-testid="treasury-alert-settings-page">
      <div>
        <h2 className="text-lg font-semibold">Configuração de alertas</h2>
        <p className="text-sm text-muted-foreground">
          Limiares e tipos usados no dashboard/agenda. Sem notificação externa.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {!settings ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <form className="max-w-xl space-y-4" onSubmit={(e) => void onSave(e)}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.alertsEnabled}
              disabled={!canManage}
              onChange={(e) =>
                setSettings({ ...settings, alertsEnabled: e.target.checked })
              }
            />
            Alertas habilitados
          </label>
          <label className="block text-sm">
            Recebimento relevante (mínimo)
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              value={settings.relevantReceiptMinAmount}
              disabled={!canManage}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  relevantReceiptMinAmount: e.target.value,
                })
              }
            />
          </label>
          <label className="block text-sm">
            Top N concentração
            <input
              type="number"
              className="mt-1 w-full rounded border px-2 py-1"
              value={settings.customerConcentrationTopN}
              disabled={!canManage}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  customerConcentrationTopN: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <label className="block text-sm">
            Participação mínima top N (%)
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              value={settings.customerConcentrationMinSharePercent}
              disabled={!canManage}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  customerConcentrationMinSharePercent: e.target.value,
                })
              }
            />
          </label>
          <label className="block text-sm">
            Horas até saldo stale
            <input
              type="number"
              className="mt-1 w-full rounded border px-2 py-1"
              value={settings.staleBalanceHours}
              disabled={!canManage}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  staleBalanceHours: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <label className="block text-sm">
            Idade máxima sync (h)
            <input
              type="number"
              className="mt-1 w-full rounded border px-2 py-1"
              value={settings.syncMaxAgeHours}
              disabled={!canManage}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  syncMaxAgeHours: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Tipos habilitados</legend>
            {TREASURY_ALERT_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.enabledByKind[kind]}
                  disabled={!canManage}
                  onChange={(e) => patchKindEnabled(kind, e.target.checked)}
                />
                {TREASURY_ALERT_KIND_LABELS[kind]}
              </label>
            ))}
          </fieldset>
          {canManage ? (
            <button
              type="submit"
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              data-testid="treasury-alert-settings-save"
              disabled={saving}
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Somente leitura — sem permissão de manage em exceções.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
