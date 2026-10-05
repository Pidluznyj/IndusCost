import React from "react";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import {
  isServerComputedSnapshot,
  LEGACY_SNAPSHOT_NOTICE,
  type NewProductSimulationSnapshot,
  type NewProductSnapshotLine,
  type PersistedSimulationStatus,
  type SnapshotLineType,
} from "@/src/lib/newProductSimulationSnapshot";
import { displayResultFromSnapshot, marginSignLabel } from "@/src/lib/newProductSimulationInputs";
import { productCostBaselineLabel } from "@/src/lib/productCostBaseline";

function formatIsoDatePt(iso?: string) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function lineTypeLabel(type: SnapshotLineType): string {
  switch (type) {
    case "EXISTING_COMPONENT":
      return "Componente existente";
    case "SIMULATED_COMPONENT":
      return "Componente simulado";
    case "DIRECT_MATERIAL":
      return "Material direto";
    default:
      return String(type);
  }
}

function lineIdentification(line: NewProductSnapshotLine): string {
  if (line.type === "DIRECT_MATERIAL") return line.description?.trim() || "—";
  return line.referenceLabel?.trim() || "—";
}

function lineSkuOrCode(line: NewProductSnapshotLine): string {
  if (line.referenceSku && String(line.referenceSku).trim()) return String(line.referenceSku);
  // Snapshot legado: o SKU vinha embutido no rótulo "SKU — Nome".
  const label = line.referenceLabel ?? "";
  const separator = label.indexOf(" — ");
  if (line.type !== "DIRECT_MATERIAL" && separator > 0) return label.slice(0, separator);
  return "—";
}

/** Origem do custo da linha — LIVE nunca é chamado de oficial. */
function lineCostOrigin(line: NewProductSnapshotLine, legacy: boolean): string {
  if (line.type === "DIRECT_MATERIAL") return "Digitado na simulação";
  if (line.type === "SIMULATED_COMPONENT") return "Componente simulado";
  if (!line.baseline) return legacy ? "Base não registrada (legado)" : "—";
  if (line.baseline.source === "PUBLISHED") {
    return `${productCostBaselineLabel("PUBLISHED")} · versão ${line.baseline.productionCostVersionCode ?? "—"} rev. ${
      line.baseline.productionCostRevision ?? "—"
    }`;
  }
  return `${productCostBaselineLabel("LIVE")} · ${formatIsoDatePt(line.baseline.calculatedAt ?? undefined)}`;
}

function moneyOrDash(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatCurrency(value) : "—";
}

function percentOrDash(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${formatNumber(value, 2)}%` : "—";
}

function viabilityLabel(v: NewProductSimulationSnapshot["result"]["viability"]): string {
  switch (v) {
    case "VIAVEL":
      return "Viável";
    case "ATENCAO":
      return "Atenção";
    case "INVIAVEL":
      return "Inviável";
    default:
      return String(v);
  }
}

function viabilityPanelClass(v: NewProductSimulationSnapshot["result"]["viability"]): string {
  switch (v) {
    case "VIAVEL":
      return "border-emerald-600/40 bg-emerald-50/80 text-emerald-950";
    case "ATENCAO":
      return "border-amber-600/40 bg-amber-50/80 text-amber-950";
    case "INVIAVEL":
      return "border-red-600/40 bg-red-50/80 text-red-950";
    default:
      return "border-border bg-muted/40";
  }
}

export type NewProductSimulationReportProps = {
  snapshot: NewProductSimulationSnapshot;
  recordStatus?: PersistedSimulationStatus;
};

export function NewProductSimulationReport({ snapshot, recordStatus }: NewProductSimulationReportProps) {
  const { header, commercial, composition, result } = snapshot;
  const legacy = !isServerComputedSnapshot(snapshot);
  // Mesma leitura usada pela tela da simulação congelada: tela e relatório mostram os mesmos números.
  const display = displayResultFromSnapshot(snapshot);
  const premises = commercial.premises ?? null;

  return (
    <article className="np-report max-w-[210mm] mx-auto text-slate-900 bg-white text-[13px] leading-relaxed print:text-black">
      {/* A — Cabeçalho corporativo */}
      <header className="border-b border-slate-300 pb-6 mb-8 reports-print-break">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 mb-2">
          IndusCost · Documento interno
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-1">Relatório de Simulação de Novo Produto</h1>
        <p className="text-xs font-semibold text-slate-700" data-testid="report-simulation-notice">
          SIMULAÇÃO — estimativa de engenharia. Não é custo oficial publicado nem preço oficial.
        </p>
        {legacy ? (
          <p className="mt-1 text-xs text-slate-600" data-testid="report-legacy-notice">
            {LEGACY_SNAPSHOT_NOTICE}.
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-slate-500">Nome da simulação</span>
            <p className="font-semibold">{header.simulationName || "—"}</p>
          </div>
          <div>
            <span className="text-slate-500">Status do registro</span>
            <p className="font-semibold">
              {recordStatus === "SAVED"
                ? "Salvo (congelado)"
                : recordStatus === "ARCHIVED"
                  ? "Arquivada (congelada)"
                  : recordStatus === "DRAFT"
                    ? "Rascunho"
                    : "—"}
            </p>
          </div>
          <div>
            <span className="text-slate-500">Criação (snapshot)</span>
            <p className="font-medium">{formatIsoDatePt(header.createdAt)}</p>
          </div>
          <div>
            <span className="text-slate-500">Salvamento (snapshot)</span>
            <p className="font-medium">{formatIsoDatePt(header.savedAt)}</p>
          </div>
          <div>
            <span className="text-slate-500">Origem</span>
            <p className="font-medium">{header.origin ?? "—"}</p>
          </div>
          <div>
            <span className="text-slate-500">Usuário criador</span>
            <p className="font-medium">{header.createdBy?.trim() || "—"}</p>
          </div>
        </div>
      </header>

      {/* B — Produto simulado */}
      <section className="mb-8 reports-print-break">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200 pb-2 mb-4">
          Identificação do produto simulado
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className="text-slate-500 text-xs">Nome do produto</span>
            <p className="font-semibold text-base">{header.productName || "—"}</p>
          </div>
          <div>
            <span className="text-slate-500 text-xs">SKU provisório</span>
            <p className="font-semibold text-base">{header.productSku?.trim() || "—"}</p>
          </div>
          {header.notes?.trim() ? (
            <div className="sm:col-span-2">
              <span className="text-slate-500 text-xs">Observações</span>
              <p className="mt-1 whitespace-pre-wrap text-slate-800">{header.notes}</p>
            </div>
          ) : null}
        </div>
      </section>

      {/* C — Resumo executivo */}
      <section className="mb-8 reports-print-break">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200 pb-2 mb-4">
          Resumo executivo
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {(
            [
              { label: "MP total", value: formatCurrency(result.mp) },
              { label: "HH total", value: formatCurrency(result.hh) },
              { label: "HM total", value: formatCurrency(result.hm) },
              { label: "Custo base total", value: formatCurrency(result.costBase) },
              { label: display.priceLabel, value: moneyOrDash(display.price) },
              { label: "Margem resultante", value: percentOrDash(display.marginPct) },
            ] as const
          ).map((cell) => (
            <div
              key={cell.label}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3"
            >
              <p className="text-[10px] font-semibold uppercase text-slate-500 tracking-wide">{cell.label}</p>
              <p className="mt-1 font-semibold tabular-nums">{cell.value}</p>
            </div>
          ))}
          <div className="rounded-xl border border-slate-300 bg-white px-4 py-3 md:col-span-3">
            <p className="text-[10px] font-semibold uppercase text-slate-500 tracking-wide">
              {legacy
                ? "Viabilidade (snapshot)"
                : display.analysisKind === "COMMERCIAL_SIMULATED"
                  ? "Análise comercial da simulação"
                  : "Análise industrial preliminar"}
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {legacy && result.viability ? viabilityLabel(result.viability) : marginSignLabel(display.marginSign)}
            </p>
            {display.error ? <p className="mt-1 text-xs font-semibold text-red-700">{display.error}</p> : null}
          </div>
        </div>
      </section>

      {/* D — Composição percentual */}
      <section className="mb-8 reports-print-break">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200 pb-2 mb-4">
          Composição percentual (custo base)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Matéria-prima", pct: result.mpPct, tone: "bg-slate-700" },
            { label: "Mão de obra (HH)", pct: result.hhPct, tone: "bg-slate-500" },
            { label: "Horas máquina (HM)", pct: result.hmPct, tone: "bg-slate-400" },
          ].map((row) => (
            <div key={row.label} className="rounded-xl border border-slate-200 p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium">{row.label}</span>
                <span className="tabular-nums font-semibold">{formatNumber(row.pct, 1)}%</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${row.tone} print:bg-slate-600`}
                  style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* E — Composição do produto final */}
      <section className="mb-8 reports-print-break">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200 pb-2 mb-4">
          Composição do produto final
        </h2>
        <div className="reports-table-wrap overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left border-collapse text-[12px]">
            <thead>
              <tr className="bg-slate-100 text-slate-700 text-[10px] uppercase tracking-wide">
                <th className="p-2.5 font-semibold border-b border-slate-200">Tipo</th>
                <th className="p-2.5 font-semibold border-b border-slate-200">Identificação</th>
                <th className="p-2.5 font-semibold border-b border-slate-200">Ref. / código</th>
                <th className="p-2.5 font-semibold border-b border-slate-200">Origem do custo</th>
                <th className="p-2.5 font-semibold border-b border-slate-200 text-right">Qtd.</th>
                <th className="p-2.5 font-semibold border-b border-slate-200 text-right">Custo unit.</th>
                <th className="p-2.5 font-semibold border-b border-slate-200 text-right">Total linha</th>
              </tr>
            </thead>
            <tbody>
              {composition.lines.map((line, idx) => (
                <tr key={line.id || idx} className="border-b border-slate-100 last:border-0">
                  <td className="p-2.5 align-top text-slate-600">{lineTypeLabel(line.type)}</td>
                  <td className="p-2.5 align-top font-medium">{lineIdentification(line)}</td>
                  <td className="p-2.5 align-top text-slate-600 tabular-nums">{lineSkuOrCode(line)}</td>
                  <td className="p-2.5 align-top text-slate-600">{lineCostOrigin(line, legacy)}</td>
                  <td className="p-2.5 align-top text-right tabular-nums">{formatNumber(line.quantity, 4)}</td>
                  <td className="p-2.5 align-top text-right tabular-nums">{formatCurrency(line.unitCost)}</td>
                  <td className="p-2.5 align-top text-right font-medium tabular-nums">{formatCurrency(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* F — Componentes simulados */}
      <section className="mb-8 reports-print-break">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200 pb-2 mb-4">
          Componentes simulados (sandbox)
        </h2>
        {composition.simulatedComponents.length === 0 ? (
          <p className="text-slate-500 italic">Nenhum componente simulado neste snapshot.</p>
        ) : (
          <div className="space-y-6">
            {composition.simulatedComponents.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-5 break-inside-avoid"
              >
                <div className="flex flex-wrap justify-between gap-2 border-b border-slate-200 pb-3 mb-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-slate-500">Componente simulado</p>
                    <p className="text-lg font-bold text-slate-900">{c.name || "—"}</p>
                    <p className="text-sm text-slate-600">
                      SKU provisório: <span className="font-mono">{c.sku?.trim() || "—"}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase text-slate-500">Custo total</p>
                    <p className="text-xl font-bold tabular-nums">{formatCurrency(c.costBase)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
                  <div>
                    <span className="text-slate-500 text-xs">MP</span>
                    <p className="font-semibold tabular-nums">{formatCurrency(c.mp)}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-xs">HH</span>
                    <p className="font-semibold tabular-nums">{formatCurrency(c.hh)}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-xs">HM</span>
                    <p className="font-semibold tabular-nums">{formatCurrency(c.hm)}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-xs">Composição % (MP/HH/HM)</span>
                    <p className="font-semibold tabular-nums">
                      {formatNumber(c.mpPct, 1)} / {formatNumber(c.hhPct, 1)} / {formatNumber(c.hmPct, 1)}
                    </p>
                  </div>
                </div>
                <div className="reports-table-wrap overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="bg-slate-100 text-[10px] uppercase text-slate-600">
                        <th className="p-2 font-semibold">Código</th>
                        <th className="p-2 font-semibold">Descrição</th>
                        <th className="p-2 font-semibold text-right">Qtd.</th>
                        <th className="p-2 font-semibold">Un.</th>
                        <th className="p-2 font-semibold text-right">Custo unit.</th>
                        <th className="p-2 font-semibold text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.materials.map((m, mi) => (
                        <tr key={`${c.id}-m-${mi}`} className="border-t border-slate-100">
                          <td className="p-2 font-mono text-slate-700">{m.code || "—"}</td>
                          <td className="p-2">{m.description || "—"}</td>
                          <td className="p-2 text-right tabular-nums">{formatNumber(m.quantity, 4)}</td>
                          <td className="p-2">{m.unit || "—"}</td>
                          <td className="p-2 text-right tabular-nums">{formatCurrency(m.unitCost)}</td>
                          <td className="p-2 text-right font-medium tabular-nums">{formatCurrency(m.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* G — Premissas comerciais */}
      <section className="mb-8 reports-print-break">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200 pb-2 mb-4">
          Premissas comerciais
        </h2>
        <div className="rounded-xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-500">Modo</p>
            <p className="font-semibold">
              {commercial.mode === "MARGIN" ? "Margem desejada (% sobre o preço)" : "Preço alvo"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-500">Margem desejada</p>
            <p className="font-semibold tabular-nums">{formatNumber(commercial.desiredMarginPct, 2)}%</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-500">Preço alvo informado</p>
            <p className="font-semibold tabular-nums">{formatCurrency(commercial.targetPrice)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-500">{display.priceLabel}</p>
            <p className="font-semibold tabular-nums text-base">{moneyOrDash(display.price)}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Margem resultante (snapshot)</p>
            <p className="font-semibold tabular-nums">{percentOrDash(display.marginPct)}</p>
          </div>
          <div className="md:col-span-2" data-testid="report-commercial-premises">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Premissas comerciais da simulação</p>
            {premises ? (
              <p className="font-medium">
                Impostos {formatNumber(premises.taxRatePct, 2)}%
                {premises.taxRuleName ? ` (${premises.taxRuleName})` : ""} · Comissão{" "}
                {formatNumber(premises.commissionRatePct, 2)}% · Outras variáveis{" "}
                {formatNumber(premises.otherRatePct, 2)}% · Frete {formatCurrency(premises.freight)}
              </p>
            ) : (
              <p className="font-medium">
                Sem análise comercial: preço e margem acima consideram apenas MP + HH + HM — sem impostos, comissão,
                frete, CIF ou OPEX. Não usar como preço comercial.
              </p>
            )}
          </div>
          {snapshot.hourCosts ? (
            <div className="md:col-span-2" data-testid="report-hour-costs">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Taxas-hora usadas no processo</p>
              <p className="font-medium tabular-nums">
                HH {formatCurrency(snapshot.hourCosts.globalHhCostPerHour)}/h · HM{" "}
                {formatCurrency(snapshot.hourCosts.machineHourCostPerHour)}/h (
                {snapshot.hourCosts.hhSource === "MANUAL" ? "HH definido manualmente" : "HH calculado da folha"})
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {/* H — Resumo de viabilidade */}
      <section className="reports-print-break">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200 pb-2 mb-4">
          Resumo de viabilidade
        </h2>
        <div
          className={`rounded-xl border-2 p-6 ${
            legacy
              ? viabilityPanelClass(result.viability)
              : display.marginSign === "POSITIVA"
                ? "border-emerald-600/40 bg-emerald-50/80 text-emerald-950"
                : display.marginSign === "NULA_OU_NEGATIVA"
                  ? "border-red-600/40 bg-red-50/80 text-red-950"
                  : "border-slate-300 bg-slate-50 text-slate-900"
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                {legacy
                  ? "Parecer do cenário (snapshot)"
                  : display.analysisKind === "COMMERCIAL_SIMULATED"
                    ? "Análise comercial da simulação"
                    : "Análise industrial preliminar"}
              </p>
              <p className="text-2xl font-bold mt-1">
                {legacy && result.viability ? viabilityLabel(result.viability) : marginSignLabel(display.marginSign)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="block text-[10px] font-semibold uppercase opacity-70">Custo base</span>
                <span className="font-bold tabular-nums">{formatCurrency(result.costBase)}</span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase opacity-70">
                  {display.analysisKind === "COMMERCIAL_SIMULATED" ? "Preço simulado" : "Preço industrial preliminar"}
                </span>
                <span className="font-bold tabular-nums">{moneyOrDash(display.price)}</span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase opacity-70">Margem</span>
                <span className="font-bold tabular-nums">{percentOrDash(display.marginPct)}</span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase opacity-70">Composição principal</span>
                <span className="font-bold tabular-nums">
                  MP {formatNumber(result.mpPct, 0)}% · HH {formatNumber(result.hhPct, 0)}% · HM{" "}
                  {formatNumber(result.hmPct, 0)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-10 pt-6 border-t border-slate-200 text-[10px] text-slate-500 text-center">
        Valores e textos reproduzem exclusivamente o snapshot salvo, sem recálculo a partir do cadastro atual.
        {header.createdBy?.trim() ? ` Simulação criada por ${header.createdBy.trim()}.` : ""}
      </footer>
    </article>
  );
}
