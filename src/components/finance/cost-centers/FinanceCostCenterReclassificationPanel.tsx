import React, { useCallback, useState } from "react";
import { Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { ReclassificationPreviewResult } from "@/src/lib/financeCostCenterReclassificationShared";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceModuleErrorBanner } from "@/src/components/finance/shared/FinanceModuleStates";
import { cn } from "@/src/lib/utils";

type Props = {
  canManage: boolean;
};

export function FinanceCostCenterReclassificationPanel({ canManage }: Props) {
  const [loading, setLoading] = useState(false);
  const [ensuring, setEnsuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReclassificationPreviewResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const runPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fetchJsonOk<ReclassificationPreviewResult>(
        "/api/finance/cost-centers/reclassify-accounts-payable/preview",
        { credentials: "include" }
      );
      setPreview(result);
    } catch (e) {
      setPreview(null);
      setError(buildFinanceTabLoadError("Não foi possível pré-visualizar reclassificações.", e));
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureDefaults = useCallback(async () => {
    if (!canManage) return;
    setEnsuring(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fetchJsonOk<{
        created: boolean;
        ruleId: string;
        targetCostCenterLabel: string;
      }>("/api/finance/cost-centers/reclassification-rules/ensure-defaults", {
        method: "POST",
        credentials: "include",
      });
      setMessage(
        result.created
          ? `Regra padrão criada (${result.targetCostCenterLabel}).`
          : `Regra padrão já existia (${result.targetCostCenterLabel}).`
      );
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível garantir regras padrão.", e));
    } finally {
      setEnsuring(false);
    }
  }, [canManage]);

  const apply = useCallback(async () => {
    if (!canManage) return;
    if (
      !window.confirm(
        "Aplicar reclassificações gerenciais? Classificações manuais não serão alteradas."
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fetchJsonOk<ReclassificationPreviewResult>(
        "/api/finance/cost-centers/reclassify-accounts-payable",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: false }),
        }
      );
      setPreview(result);
      setMessage(`${result.updated} alocação(ões) reclassificada(s).`);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível aplicar reclassificações.", e));
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  return (
    <div className={cn(financeBiCardClass, "space-y-4 p-4")} data-testid="finance-cc-reclassification-panel">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Reclassificação gerencial por regra</h3>
        <p className="text-xs text-muted-foreground">
          Traduz regras do Power BI (ex.: financiamento sócios → INVESTIMENTO SOCIOS). Não altera
          classificações manuais.
        </p>
      </div>

      {error ? <FinanceModuleErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => void runPreview()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Pré-visualizar reclassificações
        </button>
        {canManage ? (
          <>
            <button
              type="button"
              disabled={ensuring}
              onClick={() => void ensureDefaults()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {ensuring ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              Garantir regra padrão
            </button>
            <button
              type="button"
              disabled={loading || !preview || preview.matched === 0}
              onClick={() => void apply()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Aplicar reclassificações
            </button>
          </>
        ) : null}
      </div>

      {preview ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <Stat label="Seriam reclassificados" value={preview.matched} />
          <Stat label="Ignorados (manual)" value={preview.skippedManual} />
          <Stat label="Já no destino" value={preview.alreadyTarget} />
          <Stat label="Com palavra-chave" value={preview.keywordScan.titlesWithKeywords} />
          <Stat label="Em ADMINISTRATIVO" value={preview.keywordScan.inAdministrativeParent} />
          <Stat
            label="Já INVESTIMENTO SOCIOS"
            value={preview.keywordScan.alreadyInvestimentoSocios}
          />
          <Stat label="Destino" value={preview.targetCostCenter ?? "—"} wide />
        </div>
      ) : null}

      {preview && preview.examples.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Título</th>
                <th className="px-3 py-2">Fornecedor</th>
                <th className="px-3 py-2">Atual</th>
                <th className="px-3 py-2">Destino</th>
                <th className="px-3 py-2">Palavra-chave</th>
              </tr>
            </thead>
            <tbody>
              {preview.examples.slice(0, 10).map((row) => (
                <tr key={row.accountsPayableId} className="border-t border-border/60">
                  <td className="px-3 py-2 font-mono">{row.accountsPayableId}</td>
                  <td className="px-3 py-2">{row.personName ?? "—"}</td>
                  <td className="px-3 py-2">{row.currentCostCenter}</td>
                  <td className="px-3 py-2">{row.targetCostCenter}</td>
                  <td className="px-3 py-2">{row.matchedKeyword}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-border/70 bg-background/60 px-3 py-2", wide && "sm:col-span-2")}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
