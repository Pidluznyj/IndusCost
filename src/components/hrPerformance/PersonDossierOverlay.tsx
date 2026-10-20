/**
 * Dossiê da pessoa na calibração: todos os ângulos numa ficha só (auto × líder, liderança auto ×
 * superior × equipe, como ela avalia os outros, posição preliminar, ciclos anteriores, PDI, versões).
 * Só para quem calibra ou consulta resultados; a equipe aparece só como média divulgável.
 */
import React, { useEffect, useState } from "react";
import { Overlay, OverlayBadge, OverlayBody, OverlayFooter, OverlayHeader } from "@/src/components/ui/overlay";
import { PILLARS, PILLAR_SHORT_LABELS, NOT_OBSERVED_LABEL, scoreLabel } from "@/src/lib/hrPerformance/performanceDomain";
import { fetchPersonDossier, type BiasFlag, type EvaluatorStat, type PersonDossier } from "@/src/lib/hrPerformance/performanceClient";
import { formatScore } from "@/src/lib/hrPerformance/performanceLeadership";
import { BTN_GHOST, BTN_SECONDARY, CultureBadge, ErrorBanner, OfficialBadge, PANEL, PERF_EYEBROW, PanelState, PdiBadge, dateBr, quadrantText } from "./performanceUi";
import { DossierCalibrateInline } from "./DossierCalibrateInline";

const BIAS_LABEL: Record<BiasFlag, string> = {
  LENIENT: "Tende a notas altas",
  SEVERE: "Tende a notas baixas",
  CENTRAL: "Quase tudo no meio da escala",
  HALO: "Mesma nota em todas as competências",
};

export function EvaluatorBiasBadges({ stat }: { stat: EvaluatorStat }) {
  if (stat.flags.length === 0) return <OverlayBadge tone="emerald" variant="outline">Sem sinal de viés</OverlayBadge>;
  return (
    <span className="flex flex-wrap gap-1">
      {stat.flags.map((f) => (
        <span key={f}>
          <OverlayBadge tone="amber">{BIAS_LABEL[f]}</OverlayBadge>
        </span>
      ))}
    </span>
  );
}

function Block({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className={`${PANEL} p-4`} data-testid={testId}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

export function PersonDossierOverlay({
  participantId,
  onClose,
  calibration,
}: {
  participantId: string;
  onClose: () => void;
  /** Calibrar aqui dentro e percorrer a fila ("próxima pessoa") sem voltar à lista. */
  calibration?: { canCalibrate: boolean; stageOk: boolean; order: string[]; onSelect: (participantId: string) => void; onCalibrated: (message: string) => void };
}) {
  const [d, setD] = useState<PersonDossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    void fetchPersonDossier(participantId)
      .then(setD)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível abrir o dossiê."));
  }, [participantId, reloads]);
  const position = calibration ? calibration.order.indexOf(participantId) : -1;
  const prev = position > 0 ? calibration!.order[position - 1] : null;
  const next = calibration && position >= 0 && position < calibration.order.length - 1 ? calibration.order[position + 1] : null;
  const p = d?.participant;
  const ind = d?.individual ?? null;
  const lead = d?.leadership ?? null;
  return (
    <Overlay open onClose={onClose} size="full" ariaLabel="Dossiê da pessoa" testId="perf-dossier">
      <OverlayHeader
        eyebrow={PERF_EYEBROW}
        title={p ? `Dossiê · ${p.employeeName}` : "Dossiê"}
        subtitle={p ? `${p.roleName} · ${p.departmentName} · líder ${p.managerName ?? (p.managerSource === "TOPO" ? "topo da estrutura" : "—")}${p.isLeader ? ` · lidera ${p.directReportCount}` : ""} · ${d!.cycle.name}` : ""}
        onClose={onClose}
      />
      <OverlayBody>
        <ErrorBanner message={error} />
        {!d && !error ? <PanelState kind="loading" message="Reunindo os ângulos…" /> : null}
        {d && p ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <Block title="1. Pessoa × líder (avaliação individual)" testId="perf-dossier-individual">
              {ind ? (
                <>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-medium">Pilar</th>
                        <th className="py-1 text-right font-medium">Pessoa</th>
                        <th className="py-1 text-right font-medium">Líder</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {PILLARS.map((pl) => (
                        <tr key={pl}>
                          <td className="py-1">{PILLAR_SHORT_LABELS[pl]}</td>
                          <td className="py-1 text-right tabular-nums text-muted-foreground">{ind.self[pl]?.display ?? "—"}</td>
                          <td className="py-1 text-right tabular-nums font-semibold">{ind.leader[pl]?.display ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Pessoa: {ind.selfStatus === "SUBMITTED" ? "enviada" : "pendente"} · Líder: {ind.leaderStatus === "SUBMITTED" ? "enviada" : ind.leaderStatus ? "pendente" : "sem líder"}
                  </p>
                  {ind.divergences.length ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {ind.divergences.map((x) => (
                        <li key={x.questionCode}>
                          <strong>{x.competency}</strong>: pessoa {scoreLabel(x.selfScore).toLowerCase()} · líder {scoreLabel(x.leaderScore).toLowerCase()}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">Sem divergência relevante.</p>
                  )}
                  {ind.evidences.length ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {ind.evidences.map((e) => (
                        <li key={e.questionCode}>
                          <strong>{e.competency}</strong> ({e.notObserved ? NOT_OBSERVED_LABEL : scoreLabel(e.score)}): {e.evidence}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Não elegível neste ciclo.</p>
              )}
            </Block>

            {calibration?.canCalibrate && calibration.stageOk && ind ? (
              <Block title="Decisão da calibração" testId="perf-dossier-decision-block">
                <div key={`${participantId}-${d.versions.length}`}>
                  <DossierCalibrateInline
                    row={ind}
                    onDone={(message) => {
                      calibration.onCalibrated(message);
                      setReloads((n) => n + 1);
                    }}
                  />
                </div>
              </Block>
            ) : null}
            <Block title="2. Posição preliminar e versões" testId="perf-dossier-position">
              {ind?.result ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{quadrantText(ind.result.quadrant)}</span>
                  <OfficialBadge official={ind.result.official} adjusted={ind.result.adjusted} />
                  <CultureBadge band={ind.result.cultureBand} />
                  {ind.result.reviewStatus === "CALIBRATED" ? <OverlayBadge tone="emerald">calibrado</OverlayBadge> : <OverlayBadge tone="amber">aguardando calibração</OverlayBadge>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sem resultado calculado ainda.</p>
              )}
              {ind?.result?.validationNote ? <p className="mt-2 text-sm"><strong>Validação técnica:</strong> {ind.result.validationNote}</p> : null}
              {d.versions.length ? (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {d.versions.map((v) => (
                    <li key={v.version}>
                      v{v.version} · {quadrantText(v.quadrant)} · {v.reviewStatus === "CALIBRATED" ? "calibrado" : "preliminar"}
                      {v.calibrationNote ? ` · ${v.calibrationNote}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Block>

            <Block title="3. Liderança: líder × superior × equipe" testId="perf-dossier-leadership">
              {lead ? (
                <>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-medium">Competência</th>
                        <th className="py-1 text-right font-medium">Equipe</th>
                        <th className="py-1 text-right font-medium">Líder (auto)</th>
                        <th className="py-1 text-right font-medium">Superior</th>
                        <th className="py-1 text-right font-medium">Calibrada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lead.rows.map((r) => (
                        <tr key={r.code}>
                          <td className="py-1">
                            {r.code} · {r.competency}
                          </td>
                          <td className="py-1 text-right tabular-nums">{r.teamDisclosed ? formatScore(r.team) : "—"}</td>
                          <td className="py-1 text-right tabular-nums text-muted-foreground">{r.self ?? "—"}</td>
                          <td className="py-1 text-right tabular-nums">{r.superior ?? "—"}</td>
                          <td className="py-1 text-right tabular-nums font-semibold">{lead.result?.scores[r.code] ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Equipe: {lead.coverage.teamRespondents == null ? "aparece depois da coleta" : `${lead.coverage.teamRespondents} de ${lead.coverage.teamInvited} responderam`}
                    {lead.team.disclosed ? "" : ` · ${lead.team.message ?? "amostra insuficiente"}`} · comentários da equipe nunca são exibidos.
                  </p>
                  {lead.result ? (
                    <p className="mt-1 text-sm">
                      Índice calibrado {formatScore(lead.result.index)} · {lead.result.official ? "homologado" : lead.result.status === "EXCEPTION" ? "exceção registrada" : "calibrado"}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{p.isLeader ? "Ciclo sem avaliação de liderança." : "Não lidera pessoas neste ciclo."}</p>
              )}
            </Block>

            <Block title="4. Como esta pessoa avalia os outros" testId="perf-dossier-evaluator">
              {d.asEvaluator ? (
                <div className="space-y-2 text-sm">
                  <p>
                    Avaliou {d.asEvaluator.submitted} de {d.asEvaluator.evaluated} liderado(s) · média das notas dadas <strong>{d.asEvaluator.mean ?? "—"}</strong> (ciclo: {d.asEvaluator.cycleMean ?? "—"})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Nunca {d.asEvaluator.distribution[1]} · Às vezes {d.asEvaluator.distribution[2]} · Maioria {d.asEvaluator.distribution[3]} · Sempre {d.asEvaluator.distribution[4]} · Não observei {d.asEvaluator.distribution.notObserved}
                  </p>
                  <EvaluatorBiasBadges stat={d.asEvaluator} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Não avalia ninguém neste ciclo.</p>
              )}
            </Block>

            <Block title="5. Ciclos anteriores (oficiais)" testId="perf-dossier-history">
              {d.previousCycles.length === 0 ? (
                <p className="text-sm text-muted-foreground">Primeiro ciclo oficial da pessoa.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {d.previousCycles.map((c) => (
                    <li key={c.cycleId}>
                      <strong>{c.cycleName}</strong> · {c.quadrant ? quadrantText(c.quadrant) : "sem resultado"} · técnico {c.technical ?? "—"} · potencial {c.potential ?? "—"}
                      {c.comparableWithPrevious === false ? " · regras diferentes, não comparável" : ""}
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            <Block title="6. PDI e acompanhamento" testId="perf-dossier-pdi">
              {d.pdis.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem PDI neste ciclo.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.pdis.map((item) => (
                    <li key={item.id}>
                      <span className="flex flex-wrap items-center gap-2">
                        <strong>{item.title}</strong>
                        {item.competencyCode ? <span className="text-xs text-muted-foreground">{item.competencyCode}</span> : null}
                        <PdiBadge status={item.status} />
                        {item.dueAt ? <span className="text-xs text-muted-foreground">até {dateBr(item.dueAt)}</span> : null}
                      </span>
                      {item.checkins.length ? (
                        <ul className="ml-4 mt-1 list-disc text-xs text-muted-foreground">
                          {item.checkins.map((c, i) => (
                            <li key={i}>
                              {dateBr(c.createdAt)}: {c.note}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </div>
        ) : null}
      </OverlayBody>
      <OverlayFooter>
        {calibration ? (
          <span className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            {position >= 0 ? `${position + 1} de ${calibration.order.length}` : ""}
            <button type="button" className={BTN_GHOST} disabled={!prev} onClick={() => prev && calibration.onSelect(prev)} data-testid="perf-dossier-prev">
              ← Anterior
            </button>
            <button type="button" className={BTN_GHOST} disabled={!next} onClick={() => next && calibration.onSelect(next)} data-testid="perf-dossier-next">
              Próxima pessoa →
            </button>
          </span>
        ) : null}
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>
          Fechar
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
