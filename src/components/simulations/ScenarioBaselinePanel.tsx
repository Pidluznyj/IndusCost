import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency } from "@/src/lib/utils";
import {
  NO_PUBLISHED_COST_MESSAGE,
  productCostBaselineBadge,
  productCostBaselineLabel,
  type ProductCostBaselineResult,
  type ProductCostBaselineSource,
} from "@/src/lib/productCostBaseline";

type Props = {
  productId: string;
  source: ProductCostBaselineSource;
  onSourceChange: (source: ProductCostBaselineSource) => void;
  /** Avisa a tela se a base escolhida está disponível (habilita "Criar"). */
  onAvailabilityChange?: (available: boolean) => void;
};

const SOURCES: ProductCostBaselineSource[] = ["PUBLISHED", "LIVE"];

/**
 * BASE DA SIMULAÇÃO de um cenário de produto existente. A base é só referência do cenário:
 * escolher "publicado" ou "engenharia atual" não altera nenhum dos dois.
 */
export function ScenarioBaselinePanel({ productId, source, onSourceChange, onAvailabilityChange }: Props) {
  const [state, setState] = useState<{
    loading: boolean;
    result: ProductCostBaselineResult | null;
    error: string | null;
  }>({ loading: false, result: null, error: null });
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!productId) {
      requestSeq.current += 1;
      setState({ loading: false, result: null, error: null });
      onAvailabilityChange?.(false);
      return;
    }
    const seq = ++requestSeq.current;
    const controller = new AbortController();
    setState({ loading: true, result: null, error: null });
    onAvailabilityChange?.(false);
    fetchJsonOk(`/api/simulations/product-baseline?productId=${productId}&source=${source}`, {
      signal: controller.signal,
    })
      .then((payload) => {
        if (seq !== requestSeq.current) return;
        const result = payload as ProductCostBaselineResult;
        setState({ loading: false, result, error: null });
        onAvailabilityChange?.(result?.status === "OK");
      })
      .catch((error: unknown) => {
        if (seq !== requestSeq.current || controller.signal.aborted) return;
        setState({
          loading: false,
          result: null,
          error: error instanceof Error ? error.message : "Não foi possível carregar o custo base.",
        });
        onAvailabilityChange?.(false);
      });
    return () => controller.abort();
    // onAvailabilityChange é estável o suficiente para este uso; refazer só por produto/base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, source]);

  const result = state.result;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-accent/10 p-3" data-testid="scenario-baseline-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Base da simulação
        </span>
        <div className="inline-flex rounded-lg border border-border bg-background p-1">
          {SOURCES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onSourceChange(option)}
              data-testid={`scenario-baseline-${option}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                source === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option === "PUBLISHED" ? "Custo publicado" : "Engenharia atual (não publicada)"}
            </button>
          ))}
        </div>
      </div>

      {!productId ? (
        <p className="text-xs text-muted-foreground">Selecione o produto base para ver o custo de referência.</p>
      ) : state.loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando custo base...
        </p>
      ) : state.error ? (
        <p className="flex items-start gap-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {state.error}
        </p>
      ) : result && result.status === "OK" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-black uppercase",
                result.source === "PUBLISHED" ? "bg-emerald-500/15 text-emerald-800" : "bg-amber-500/15 text-amber-800"
              )}
            >
              {productCostBaselineBadge(result.source)}
            </span>
            <span className="text-muted-foreground">
              {result.source === "PUBLISHED"
                ? `Versão ${result.productionCostVersionCode ?? "—"} · rev. ${result.productionCostRevision ?? "—"} · vigência ${result.effectiveDate ?? "—"}`
                : productCostBaselineLabel("LIVE")}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            {[
              ["MP", result.totalMaterialCost],
              ["HH", result.totalHHUnit],
              ["HM", result.totalHMUnit],
              ["Total", result.totalMaterialCost + result.totalHHUnit + result.totalHMUnit],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-border bg-background p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">{label}</p>
                <p className="font-bold tabular-nums">{formatCurrency(Number(value), 5)}</p>
              </div>
            ))}
          </div>
          {!result.ownProcess ? (
            <p className="text-[11px] text-amber-700">
              Sem dados de transformação × setup para esta base: o ajuste de eficiência não poderá ser aplicado.
            </p>
          ) : null}
          {result.warnings.map((warning) => (
            <p key={warning.code} className="text-[11px] text-amber-700">
              {warning.message}
            </p>
          ))}
        </div>
      ) : result && result.status === "NO_PUBLISHED_COST" ? (
        <div className="space-y-2 text-xs">
          <p className="flex items-start gap-2 font-semibold text-amber-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {NO_PUBLISHED_COST_MESSAGE}
          </p>
          <button
            type="button"
            onClick={() => onSourceChange("LIVE")}
            className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            Usar Engenharia atual (não publicada)
          </button>
        </div>
      ) : result ? (
        <p className="flex items-start gap-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {result.message}
        </p>
      ) : null}
    </div>
  );
}
