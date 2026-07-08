import React, { useCallback, useEffect, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { MaterialMarketAlertConfigApiItem } from "@/src/lib/materialMarketAlertConfig";
import { getMaterialMarketAlertConfigApiPath } from "@/src/lib/materialsNavigation";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

type Props = {
  materialId: string;
  canEdit?: boolean;
};

export function MaterialMarketAlertConfigPanel({ materialId, canEdit = true }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<MaterialMarketAlertConfigApiItem | null>(null);
  const [useGlobal, setUseGlobal] = useState(true);
  const [form, setForm] = useState({
    risePercentThreshold: "",
    fallPercentThreshold: "",
    daysWithoutQuote: "",
    alertsEnabled: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<MaterialMarketAlertConfigApiItem>(
        getMaterialMarketAlertConfigApiPath(materialId)
      );
      setConfig(data);
      setUseGlobal(data.usesGlobalConfig ?? true);
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
  }, [materialId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = useGlobal
        ? { clearOverrides: true }
        : {
            risePercentThreshold: Number(form.risePercentThreshold),
            fallPercentThreshold: Number(form.fallPercentThreshold),
            daysWithoutQuote: Number(form.daysWithoutQuote),
            alertsEnabled: form.alertsEnabled,
          };

      const data = await fetchJsonOk<MaterialMarketAlertConfigApiItem>(
        getMaterialMarketAlertConfigApiPath(materialId),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      setConfig(data);
      setUseGlobal(data.usesGlobalConfig ?? true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="rounded-xl border border-border bg-card"
      data-testid="material-market-alert-config-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">Configurar alertas</span>
        </div>
        <span className="text-xs text-muted-foreground">{open ? "Ocultar" : "Abrir"}</span>
      </button>

      {open ? (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : (
            <>
              {useGlobal ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="material-market-alert-using-global"
                >
                  Usando configuração global
                </p>
              ) : null}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useGlobal}
                  disabled={!canEdit}
                  onChange={(e) => setUseGlobal(e.target.checked)}
                  data-testid="material-market-alert-use-global"
                />
                <span>Usar configuração global</span>
              </label>

              {!useGlobal ? (
                <div className="grid gap-4 sm:grid-cols-2">
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
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Dias sem cotação</span>
                    <input
                      type="number"
                      min={1}
                      className={INPUT_CLASS}
                      value={form.daysWithoutQuote}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, daysWithoutQuote: e.target.value }))
                      }
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
                    />
                    <span className="font-medium">Alertas ativos</span>
                  </label>
                </div>
              ) : null}

              {error ? <p className="text-sm text-red-700">{error}</p> : null}

              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  data-testid="material-market-alert-config-save"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
