/**
 * Painel do ciclo. Cada taxa mostra numerador e denominador; a população é a dos
 * participantes elegíveis dentro do escopo e dos filtros. Não elegível nunca vira nota.
 */
import React, { useEffect, useState } from "react";
import { CULTURE_BAND_LABELS, CYCLE_STATUS_LABELS, PDI_STATUS_LABELS, type CycleStatus } from "@/src/lib/hrPerformance/performanceDomain";
import { fetchPerformanceDashboard, fetchPerformanceEvolution, type CycleDashboard, type EvolutionRow } from "@/src/lib/hrPerformance/performanceClient";
import { ErrorBanner, InfoBanner, KpiTile, PANEL, PanelState, TableScroll, rateText } from "./performanceUi";

export function PerformanceDashboardTab({ cycleId }: { cycleId: string | null }) {
  const [board, setBoard] = useState<CycleDashboard | null>(null);
  const [evolution, setEvolution] = useState<EvolutionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ department: "", role: "", manager: "" });

  useEffect(() => {
    void fetchPerformanceEvolution()
      .then((payload) => setEvolution(payload.cycles))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar a evolução."));
  }, []);

  useEffect(() => {
    if (!cycleId) return;
    const params: Record<string, string> = {};
    for (const [field, value] of Object.entries(filters) as [string, string][]) if (value) params[field] = value;
    void fetchPerformanceDashboard(cycleId, params)
      .then((next) => {
        setBoard(next);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar o painel."));
  }, [cycleId, filters]);

  if (!cycleId) return <div className={PANEL}><PanelState kind="empty" message="Escolha um ciclo na aba Ciclos." /></div>;
  const c = board?.counts;

  return (
    <section className="space-y-4" data-testid="perf-dashboard-tab">
      <ErrorBanner message={error} />
      {board && c ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{board.cycle.name}</strong> · {CYCLE_STATUS_LABELS[board.cycle.status as CycleStatus]} · base: {c.eligible} pessoa(s) elegível(is) no seu escopo
            </p>
            <div className="flex flex-wrap gap-2">
              {(["department", "role", "manager"] as const).map((field) => {
                const options = field === "department" ? board.filters.departments : field === "role" ? board.filters.roles : board.filters.managers;
                const label = field === "department" ? "setor" : field === "role" ? "cargo" : "líder";
                return (
                  <select key={field} className="h-9 rounded-lg border border-border bg-card px-2 text-sm" aria-label={`Filtrar ${label}`} value={filters[field]} onChange={(e) => setFilters({ ...filters, [field]: e.target.value })} data-testid={`perf-dash-filter-${field}`}>
                    <option value="">{`Todos: ${label}`}</option>
                    {options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                );
              })}
            </div>
          </div>
          {c.eligible === 0 ? <InfoBanner tone="slate">Sem pessoas elegíveis nesta seleção. Os indicadores aparecem quando houver participantes.</InfoBanner> : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="perf-dash-kpis">
            <KpiTile label="Participação · autoavaliação" value={rateText(c.rates.selfSubmitted)} hint={`${c.selfStarted} iniciadas · ${c.selfPending} pendentes`} />
            <KpiTile label="Avaliações do líder" value={rateText(c.rates.leaderSubmitted)} hint={`${c.leaderPending} pendentes · ${c.withoutLeader} sem líder`} tone={c.withoutLeader ? "warning" : "neutral"} />
            <KpiTile label="Convites emitidos" value={rateText(c.rates.invited)} hint="Convidado não é respondido" />
            <KpiTile label="Calibrados" value={rateText(c.rates.calibrated)} />
            <KpiTile label="Homologados" value={rateText(c.rates.official)} />
            <KpiTile label="Devolutivas" value={rateText(c.rates.feedback)} hint="Base: resultados homologados" />
            <KpiTile label="Ciência registrada" value={rateText(c.rates.acknowledged)} hint="Ciência não é concordância" />
            <KpiTile label="PDI" value={`${c.pdiOpen} abertas`} hint={`${c.pdiDone} concluídas · ${c.pdiLate} vencidas`} tone={c.pdiLate ? "warning" : "neutral"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${PANEL} p-4`}>
              <p className="mb-2 text-sm font-semibold">Cultura e comportamento</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {Object.entries(board.culture).map(([band, count]) => (
                    <tr key={band}>
                      <td className="py-1.5">{band === "NONE" ? "Sem avaliação do líder" : CULTURE_BAND_LABELS[band as keyof typeof CULTURE_BAND_LABELS] ?? band}</td>
                      <td className="py-1.5 text-right tabular-nums">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">Indicador próprio, fora da Nine-Box. Ausência de ocorrência não prova aderência; frequência 1 pede conversa, não punição.</p>
            </div>
            <div className={`${PANEL} p-4`}>
              <p className="mb-2 text-sm font-semibold">PDI por situação</p>
              {Object.keys(board.pdiByStatus).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma ação registrada.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {Object.entries(board.pdiByStatus).map(([status, count]) => (
                      <tr key={status}>
                        <td className="py-1.5">{PDI_STATUS_LABELS[status as keyof typeof PDI_STATUS_LABELS] ?? status}</td>
                        <td className="py-1.5 text-right tabular-nums">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className={PANEL}>
          <PanelState kind="loading" message="Carregando o painel…" />
        </div>
      )}
      <div className={`${PANEL} p-4`}>
        <p className="mb-2 text-sm font-semibold">Evolução por ciclo</p>
        {!evolution ? (
          <PanelState kind="loading" message="Carregando…" />
        ) : evolution.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum ciclo.</p>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[760px] text-left text-sm" data-testid="perf-evolution-table">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">Ciclo</th>
                  <th className="py-2">Situação</th>
                  <th className="py-2">Modelo · regras</th>
                  <th className="py-2 text-right">Elegíveis</th>
                  <th className="py-2 text-right">Auto</th>
                  <th className="py-2 text-right">Líder</th>
                  <th className="py-2 text-right">Homologados</th>
                  <th className="py-2 text-right">Devolutivas</th>
                  <th className="py-2 text-right">PDI concluído</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {evolution.map((row) => (
                  <tr key={row.cycleId}>
                    <td className="py-2 font-medium">
                      {row.name}
                      <span className="block text-xs text-muted-foreground">{row.periodLabel}</span>
                    </td>
                    <td className="py-2">{CYCLE_STATUS_LABELS[row.status as CycleStatus] ?? row.status}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      v{row.modelVersion} · {row.ruleSetId}
                    </td>
                    <td className="py-2 text-right tabular-nums">{row.eligible}</td>
                    <td className="py-2 text-right tabular-nums">{row.selfSubmitted}</td>
                    <td className="py-2 text-right tabular-nums">{row.leaderSubmitted}</td>
                    <td className="py-2 text-right tabular-nums">{row.official}</td>
                    <td className="py-2 text-right tabular-nums">{row.feedback}</td>
                    <td className="py-2 text-right tabular-nums">{row.pdiDone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Ciclos com modelos ou regras diferentes não são comparáveis em média. A coluna Modelo · regras mostra a versão usada.</p>
      </div>
    </section>
  );
}
