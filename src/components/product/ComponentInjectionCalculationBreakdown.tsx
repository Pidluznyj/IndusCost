import React, { useEffect, useMemo, useState } from "react";
import { Gauge, AlertCircle } from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type { OfficialDefaultIndustrialCostsReference } from "@/src/lib/componentStandardProcessCost";
import { computeComponentInjectionCalculationBreakdown } from "@/src/lib/componentInjectionCalculationBreakdown";

type Props = {
  cycleTimeSeconds: string | number | null | undefined;
  cavities: string | number | null | undefined;
  efficiencyExpectedPercent: string | number | null | undefined;
  disabled?: boolean;
};

function formatPiecesPerHour(value: number): string {
  return `${formatNumber(value, 0)} peças/h`;
}

function formatCyclesPerHour(value: number): string {
  return `${formatNumber(value, 2)} ciclos/h`;
}

function formatCostPerPiece(value: number): string {
  const decimals = value < 1 ? 4 : 2;
  return `${formatCurrency(value, decimals)} por peça`;
}

function BreakdownTile({
  label,
  value,
  formula,
  emphasis,
}: {
  label: string;
  value: string;
  formula: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3 shadow-sm",
        emphasis ? "border-primary/30 bg-primary/5" : "border-border"
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1.5 text-lg font-black tabular-nums", emphasis ? "text-primary" : "text-foreground")}>
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{formula}</p>
    </div>
  );
}

export function ComponentInjectionCalculationBreakdown({
  cycleTimeSeconds,
  cavities,
  efficiencyExpectedPercent,
  disabled = false,
}: Props) {
  const [hourCosts, setHourCosts] = useState<OfficialDefaultIndustrialCostsReference | null>(null);
  const [hourCostsError, setHourCostsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = (await fetchJsonOk(
          "/api/transformation-simulator/official-reference-costs"
        )) as OfficialDefaultIndustrialCostsReference & { error?: string };
        if (cancelled) return;
        if (data.available) {
          setHourCosts(data);
          setHourCostsError(null);
        } else {
          setHourCosts(null);
          setHourCostsError(
            data.error ??
              "Não foi possível carregar HH/HM default do sistema. Verifique Configurações Gerais."
          );
        }
      } catch {
        if (!cancelled) {
          setHourCosts(null);
          setHourCostsError(
            "Não foi possível carregar HH/HM default do sistema. Verifique Configurações Gerais."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const breakdown = useMemo(
    () =>
      computeComponentInjectionCalculationBreakdown({
        cycleTimeSeconds,
        cavities,
        efficiencyExpectedPercent,
        hourCosts: hourCosts?.available
          ? {
              globalHhCostPerHour: hourCosts.hhDefault,
              machineHourCostPerHour: hourCosts.hmDefault,
              available: true,
            }
          : null,
      }),
    [cycleTimeSeconds, cavities, efficiencyExpectedPercent, hourCosts]
  );

  const displayError =
    !loading && (!breakdown.ok ? breakdown.message : hourCostsError);

  return (
    <div
      className={cn(
        "mt-4 border border-border rounded-xl bg-card overflow-hidden",
        disabled && "opacity-60"
      )}
    >
      <div className="bg-muted px-4 py-3 border-b border-border">
        <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          Cálculo da Injeção
        </h4>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Entenda como ciclo, cavidades e os parâmetros atuais do sistema formam a capacidade produtiva e o
          custo estimado por peça.
        </p>
      </div>

      <div className="p-4 space-y-4 bg-muted/20">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando HH/HM do sistema...</p>
        ) : displayError ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{displayError}</span>
          </div>
        ) : breakdown.ok ? (
          <>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                Capacidade produtiva
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                <BreakdownTile
                  label="Ciclos por hora"
                  value={formatCyclesPerHour(breakdown.cyclesPerHour)}
                  formula={`3600 / ${formatNumber(breakdown.cycleTimeSeconds, 2)}`}
                />
                <BreakdownTile
                  label="Peças teóricas por hora"
                  value={formatPiecesPerHour(breakdown.theoreticalPiecesPerHour)}
                  formula={`${formatNumber(breakdown.cyclesPerHour, 2)} × ${formatNumber(breakdown.cavities, 0)}`}
                />
                <BreakdownTile
                  label="Peças boas por hora"
                  value={formatPiecesPerHour(breakdown.goodPiecesPerHour)}
                  formula={`${formatNumber(breakdown.theoreticalPiecesPerHour, 0)} × ${formatNumber(breakdown.efficiencyPercent, 0)}%`}
                />
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                Custo estimado de injeção
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <BreakdownTile
                  label="HH usado"
                  value={`${formatCurrency(breakdown.hhUsedPerHour)}/h`}
                  formula="Parâmetro atual do sistema (Configurações Gerais)"
                />
                <BreakdownTile
                  label="HM usado"
                  value={`${formatCurrency(breakdown.hmUsedPerHour)}/h`}
                  formula="Energia / horas úteis (Configurações Gerais)"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <BreakdownTile
                  label="Custo hora de injeção"
                  value={`${formatCurrency(breakdown.injectionHourlyCost)}/h`}
                  formula="HH + HM, conforme parâmetros atuais do sistema."
                />
                <BreakdownTile
                  label="Custo de injeção por peça"
                  value={formatCostPerPiece(breakdown.injectionCostPerPiece)}
                  formula={`${formatCurrency(breakdown.injectionHourlyCost)} / ${formatNumber(breakdown.goodPiecesPerHour, 0)}`}
                  emphasis
                />
              </div>
            </div>
          </>
        ) : null}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Este cálculo é informativo e usa os parâmetros atuais do sistema para demonstrar como ciclo e
          cavidades impactam o custo unitário de injeção. Setup não altera a capacidade por hora exibida; ele
          pode impactar custo por lote conforme regra oficial do processo padrão, se aplicável.
        </p>
      </div>
    </div>
  );
}
