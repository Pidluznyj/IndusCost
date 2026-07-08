import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { MaterialMarketAlertConfigApiItem } from "@/src/lib/materialMarketAlertConfig";
import { MATERIAL_MARKET_ALERT_GLOBAL_CONFIG_API } from "@/src/lib/materialsNavigation";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

type Props = {
  canEdit?: boolean;
};

export function MaterialMarketAlertGlobalConfigPanel({ canEdit = true }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<MaterialMarketAlertConfigApiItem | null>(null);
  const [form, setForm] = useState({
    risePercentThreshold: "10",
    fallPercentThreshold: "10",
    daysWithoutQuote: "90",
    alertsEnabled: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<MaterialMarketAlertConfigApiItem>(
        MATERIAL_MARKET_ALERT_GLOBAL_CONFIG_API
      );
      setConfig(data);
      setForm({
        risePercentThreshold: String(data.risePercentThreshold),
        fallPercentThreshold: String(data.fallPercentThreshold),
        daysWithoutQuote: String(data.daysWithoutQuote),
        alertsEnabled: data.alertsEnabled,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar a configuração.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const data = await fetchJsonOk<MaterialMarketAlertConfigApiItem>(
        MATERIAL_MARKET_ALERT_GLOBAL_CONFIG_API,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            risePercentThreshold: Number(form.risePercentThreshold),
            fallPercentThreshold: Number(form.fallPercentThreshold),
            daysWithoutQuote: Number(form.daysWithoutQuote),
            alertsEnabled: form.alertsEnabled,
          }),
        }
      );
      setConfig(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-border bg-card"
      data-testid="material-market-alert-global-config"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        data-testid="material-market-alert-global-config-toggle"
      >
        <div className="flex items-center gap-3">
          <Settings2 className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-foreground">Configurar alertas</p>
            <p className="text-xs text-muted-foreground">
              Limiares globais para geração automática de alertas de mercado.
            </p>
          </div>
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {open ? "Ocultar" : "Abrir"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-border px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Percentual de alta (%)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className={INPUT_CLASS}
                    value={form.risePercentThreshold}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, risePercentThreshold: e.target.value }))
                    }
                    data-testid="material-market-alert-global-rise"
                  />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Percentual de queda (%)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className={INPUT_CLASS}
                    value={form.fallPercentThreshold}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, fallPercentThreshold: e.target.value }))
                    }
                    data-testid="material-market-alert-global-fall"
                  />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Dias sem cotação</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={INPUT_CLASS}
                    value={form.daysWithoutQuote}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, daysWithoutQuote: e.target.value }))
                    }
                    data-testid="material-market-alert-global-days"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm pt-6">
                  <input
                    type="checkbox"
                    checked={form.alertsEnabled}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, alertsEnabled: e.target.checked }))
                    }
                    data-testid="material-market-alert-global-enabled"
                  />
                  <span className="font-medium">Alertas ativos</span>
                </label>
              </div>

              {config?.updatedAt ? (
                <p className="text-xs text-muted-foreground">
                  Última atualização: {new Date(config.updatedAt).toLocaleString("pt-BR")}
                </p>
              ) : null}

              {error ? <p className="text-sm text-red-700">{error}</p> : null}

              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  data-testid="material-market-alert-global-save"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar configuração global
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
