/**
 * Calibração do RH: autoavaliação e líder lado a lado, divergências, evidências, validação
 * do técnico, confirmação ou ajuste justificado, devolução para revisão e homologação.
 * Toda decisão gera nova versão do resultado; a anterior fica consultável.
 */
import React, { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, Scale, ShieldCheck } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader, OverlayField, OverlaySelect } from "@/src/components/ui/overlay";
import { NINE_BOX_BANDS, NINE_BOX_BAND_LABELS, PILLARS, PILLAR_SHORT_LABELS, scoreLabel, NOT_OBSERVED_LABEL, type Pillar } from "@/src/lib/hrPerformance/performanceDomain";
import {
  calibratePerformance,
  fetchCalibrationQueue,
  fetchResultHistory,
  homologatePerformanceCycle,
  returnPerformanceAssignment,
  validatePerformanceTechnical,
  type CalibrationRow,
  type ResultHistory,
} from "@/src/lib/hrPerformance/performanceClient";
import {
  AssignmentBadge,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CultureBadge,
  ErrorBanner,
  InfoBanner,
  OfficialBadge,
  PANEL,
  PERF_EYEBROW,
  PanelState,
  PerformanceModal,
  ReasonField,
  TableScroll,
  ValidationBadge,
  dateBr,
  quadrantText,
} from "./performanceUi";
import { ReasonDialog } from "./CycleDesk";

type Dialog =
  | { kind: "validate"; row: CalibrationRow }
  | { kind: "calibrate"; row: CalibrationRow }
  | { kind: "return"; row: CalibrationRow }
  | { kind: "history"; row: CalibrationRow }
  | { kind: "homologate" }
  | null;

export function PerformanceCalibrationTab({ cycleId, onToast }: { cycleId: string | null; onToast: (message: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchCalibrationQueue>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [department, setDepartment] = useState("");
  const [onlyDivergent, setOnlyDivergent] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const reload = useCallback(async () => {
    if (!cycleId) return;
    try {
      setData(await fetchCalibrationQueue(cycleId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a calibração.");
    }
  }, [cycleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!cycleId) return <div className={PANEL}><PanelState kind="empty" message="Escolha um ciclo na aba Ciclos." /></div>;
  if (!data) return <div className={PANEL}>{error ? <PanelState kind="error" message={error} onRetry={() => void reload()} /> : <PanelState kind="loading" message="Carregando a fila…" />}</div>;

  const stageOk = data.cycle.status === "CONSOLIDATION" || data.cycle.status === "CALIBRATION";
  const departments = [...new Set(data.rows.map((r) => r.departmentName))].sort();
  const rows = data.rows.filter((r) => (!department || r.departmentName === department) && (!onlyDivergent || r.divergences.length > 0));
  const calibrated = data.rows.filter((r) => r.result?.reviewStatus === "CALIBRATED").length;
  const pendingValidation = data.rows.filter((r) => r.result?.technicalValidation === "PENDING_VALIDATION").length;
  const openRevisions = data.rows.filter((r) => r.leaderStatus === "RETURNED").length;
  const canHomologate = data.cycle.status === "CALIBRATION" && calibrated === data.rows.length && pendingValidation === 0 && openRevisions === 0;

  return (
    <section className="space-y-4" data-testid="perf-calibration-tab">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">{data.cycle.name}</strong> · {calibrated} de {data.rows.length} calibrados · {pendingValidation} aguardando validação técnica · {openRevisions} revisão(ões) aberta(s)
          </p>
          <p>A nota oficial usa a avaliação do líder; a autoavaliação aparece para comparar. Divergência não muda nota sozinha. Cultura não entra na Nine-Box.</p>
        </div>
        <button type="button" className={BTN_PRIMARY} disabled={!canHomologate} onClick={() => setDialog({ kind: "homologate" })} title={canHomologate ? undefined : "Exige o ciclo em calibração, todos calibrados, técnico validado e nenhuma revisão aberta"} data-testid="perf-homologate">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Homologar ciclo
        </button>
      </div>
      {!stageOk ? <InfoBanner tone="slate">A calibração acontece na consolidação e na calibração. Situação atual: {data.cycle.status === "OPEN" ? "coleta aberta" : data.cycle.status}.</InfoBanner> : null}
      <ErrorBanner message={error} />
      <div className="flex flex-wrap gap-2">
        <select className="h-9 rounded-lg border border-border bg-card px-2 text-sm" aria-label="Setor" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">Todos os setores</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <label className="inline-flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={onlyDivergent} onChange={(e) => setOnlyDivergent(e.target.checked)} /> Só com divergência
        </label>
      </div>
      <div className={PANEL}>
        <TableScroll>
          <table className="w-full min-w-[1040px] text-left text-sm" data-testid="perf-calibration-table">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-semibold">Pessoa</th>
                {PILLARS.map((p) => (
                  <th key={p} className="px-2 py-2 font-semibold">
                    {PILLAR_SHORT_LABELS[p]} <span className="font-normal normal-case">auto / líder</span>
                  </th>
                ))}
                <th className="px-2 py-2 font-semibold">Validação</th>
                <th className="px-2 py-2 font-semibold">Posição</th>
                <th className="px-4 py-2 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <React.Fragment key={row.participantId}>
                  <tr className="align-top" data-testid={`perf-cal-row-${row.employeeName}`}>
                    <td className="px-4 py-3">
                      <button type="button" className="text-left font-semibold hover:underline" onClick={() => setExpanded(expanded === row.participantId ? null : row.participantId)} aria-expanded={expanded === row.participantId}>
                        {row.employeeName}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {row.roleName} · {row.departmentName} · líder {row.managerName ?? "—"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <span>Pessoa</span>
                        <AssignmentBadge status={row.selfStatus} />
                        <span className="ml-1">Líder</span>
                        <AssignmentBadge status={row.leaderStatus} />
                      </div>
                    </td>
                    {PILLARS.map((p) => (
                      <td key={p} className="px-2 py-3 tabular-nums">
                        <span className="text-muted-foreground">{row.self[p]?.display ?? "—"}</span> / <strong>{row.leader[p]?.display ?? "—"}</strong>
                        {row.leader[p]?.insufficient && row.leaderStatus === "SUBMITTED" ? <p className="text-xs text-amber-700">insuficiente</p> : null}
                        {row.leader[p]?.notObserved ? <p className="text-xs text-muted-foreground">{row.leader[p]!.notObserved}× não sei</p> : null}
                      </td>
                    ))}
                    <td className="px-2 py-3">
                      <ValidationBadge value={row.result?.technicalValidation} />
                    </td>
                    <td className="px-2 py-3">
                      {row.result ? (
                        <div className="flex flex-col items-start gap-1">
                          <span>{quadrantText(row.result.quadrant)}</span>
                          <OfficialBadge official={row.result.official} adjusted={row.result.adjusted} />
                          {row.result.reviewStatus === "CALIBRATED" ? <span className="text-xs text-emerald-700">calibrado</span> : null}
                          <CultureBadge band={row.result.cultureBand} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem resultado</span>
                      )}
                      {row.divergences.length ? <p className="mt-1 text-xs text-amber-700">{row.divergences.length} divergência(s)</p> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {stageOk && row.result && !row.result.official && row.result.technicalValidation !== "INSUFFICIENT" ? (
                          <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "validate", row })} data-testid={`perf-cal-validate-${row.employeeName}`}>
                            Validar técnico
                          </button>
                        ) : null}
                        {stageOk && !row.result?.official ? (
                          <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "calibrate", row })} disabled={row.result?.technicalValidation === "PENDING_VALIDATION"} data-testid={`perf-cal-calibrate-${row.employeeName}`}>
                            <Scale className="h-3.5 w-3.5" aria-hidden /> Calibrar
                          </button>
                        ) : null}
                        {stageOk && row.leaderStatus === "SUBMITTED" && row.leaderAssignmentId ? (
                          <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "return", row })} data-testid={`perf-cal-return-${row.employeeName}`}>
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Pedir revisão
                          </button>
                        ) : null}
                        <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "history", row })}>
                          <History className="h-3.5 w-3.5" aria-hidden /> Versões ({row.versions})
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === row.participantId ? (
                    <tr>
                      <td colSpan={7} className="bg-muted/30 px-4 py-3">
                        <CalibrationDetail row={row} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    Ninguém nesta seleção.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroll>
      </div>

      {dialog?.kind === "validate" ? <ValidateDialog row={dialog.row} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); onToast(m); void reload(); }} /> : null}
      {dialog?.kind === "calibrate" ? <CalibrateDialog row={dialog.row} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); onToast(m); void reload(); }} /> : null}
      {dialog?.kind === "return" ? (
        <ReasonDialog
          title="Pedir revisão ao líder"
          subtitle={`A avaliação enviada de ${dialog.row.employeeName} fica preservada; o líder recebe uma nova versão com as respostas atuais para revisar.`}
          label="O que precisa ser revisto"
          min={8}
          saveLabel="Devolver ao líder"
          testId="perf-return-dialog"
          onClose={() => setDialog(null)}
          onSave={async (reason) => {
            await returnPerformanceAssignment(dialog.row.leaderAssignmentId!, reason);
            setDialog(null);
            onToast("Devolvida ao líder para revisão");
            await reload();
          }}
        />
      ) : null}
      {dialog?.kind === "history" ? <HistoryOverlay row={dialog.row} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "homologate" ? (
        <PerformanceModal
          open
          title="Homologar o ciclo"
          subtitle="Os resultados calibrados passam a ser oficiais. A Nine-Box separa oficial de preliminar e a devolutiva fica liberada."
          saveLabel="Homologar"
          footerHint="Quem participa do ciclo não homologa o próprio resultado. Reabrir depois exige motivo."
          canSave
          size="sm"
          testId="perf-homologate-dialog"
          onClose={() => setDialog(null)}
          onSave={async () => {
            await homologatePerformanceCycle(cycleId);
            setDialog(null);
            onToast("Ciclo homologado");
            await reload();
          }}
        >
          <p className="text-sm">{data.rows.length} resultado(s) serão homologados. Nenhuma promoção, remuneração ou penalidade é aplicada automaticamente.</p>
        </PerformanceModal>
      ) : null}
    </section>
  );
}

function CalibrationDetail({ row }: { row: CalibrationRow }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid={`perf-cal-detail-${row.employeeName}`}>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Divergências</p>
        {row.divergences.length === 0 ? (
          <p className="text-sm text-muted-foreground">{row.leaderStatus === "SUBMITTED" && row.selfStatus === "SUBMITTED" ? "Sem divergência relevante." : "Comparação só depois dos dois envios."}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {row.divergences.map((d) => (
              <li key={d.questionCode}>
                <strong>{d.competency}</strong>: pessoa {scoreLabel(d.selfScore).toLowerCase()} · líder {scoreLabel(d.leaderScore).toLowerCase()} ({d.gap} pontos)
              </li>
            ))}
          </ul>
        )}
        {row.result?.validationNote ? <p className="mt-2 text-sm"><strong>Validação técnica:</strong> {row.result.validationNote}</p> : null}
        {row.result?.calibrationNote ? <p className="mt-1 text-sm"><strong>Calibração:</strong> {row.result.calibrationNote}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground">{row.result?.cultureBasis}</p>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Exemplos registrados pelo líder</p>
        {row.evidences.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum exemplo registrado.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {row.evidences.map((e) => (
              <li key={e.questionCode}>
                <strong>{e.competency}</strong> ({e.notObserved ? NOT_OBSERVED_LABEL : scoreLabel(e.score)}): {e.evidence}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ValidateDialog({ row, onClose, onDone }: { row: CalibrationRow; onClose: () => void; onDone: (message: string) => void }) {
  const [decision, setDecision] = useState<"VALIDATED" | "INSUFFICIENT">("VALIDATED");
  const [note, setNote] = useState("");
  return (
    <PerformanceModal
      open
      title="Validação do desempenho técnico"
      subtitle={`${row.employeeName} · confirme com o padrão da função e as evidências de qualidade e produtividade. Nenhum indicador vira nota sozinho.`}
      saveLabel="Registrar validação"
      footerHint="Gera nova versão do resultado, ainda preliminar."
      canSave={note.trim().length >= 8}
      size="md"
      testId="perf-validate-dialog"
      onClose={onClose}
      onSave={async () => {
        await validatePerformanceTechnical(row.participantId, decision, note);
        onDone(decision === "VALIDATED" ? "Técnico validado" : "Marcado como evidência insuficiente");
      }}
    >
      <OverlayField label="Decisão" required>
        {(p) => (
          <OverlaySelect {...p} value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} data-testid="perf-validate-decision">
            <option value="VALIDATED">Validar: a frequência corresponde ao padrão da função</option>
            <option value="INSUFFICIENT">Evidência insuficiente: não posicionar na Nine-Box</option>
          </OverlaySelect>
        )}
      </OverlayField>
      <ReasonField label="Critério da função usado" value={note} onChange={setNote} placeholder="Ex.: refugo do posto e auditoria de qualidade do semestre" testId="perf-validate-note" />
    </PerformanceModal>
  );
}

function CalibrateDialog({ row, onClose, onDone }: { row: CalibrationRow; onClose: () => void; onDone: (message: string) => void }) {
  const result = row.result;
  const canAdjust = Boolean(result && result.nineX && result.nineY);
  const [decision, setDecision] = useState<"CONFIRM" | "ADJUST">("CONFIRM");
  const [technicalBand, setTechnicalBand] = useState(result?.nineX ?? "MID");
  const [potentialBand, setPotentialBand] = useState(result?.nineY ?? "MID");
  const [note, setNote] = useState("");
  const changed = technicalBand !== result?.nineX || potentialBand !== result?.nineY;
  return (
    <PerformanceModal
      open
      title="Calibrar resultado"
      subtitle={`${row.employeeName} · posição atual: ${quadrantText(result?.quadrant)}. Ajuste só com justificativa; a versão original fica guardada.`}
      saveLabel={decision === "ADJUST" ? "Registrar ajuste" : "Confirmar posição"}
      footerHint="A decisão fica registrada com responsável e horário."
      canSave={note.trim().length >= 8 && (decision === "CONFIRM" || changed)}
      size="md"
      testId="perf-calibrate-dialog"
      onClose={onClose}
      onSave={async () => {
        const out = await calibratePerformance(row.participantId, decision === "ADJUST" ? { note, decision, technicalBand, potentialBand } : { note, decision });
        onDone(decision === "ADJUST" ? `Ajustado para ${out.quadrant}` : "Calibração registrada");
      }}
    >
      <OverlayField label="Decisão" required>
        {(p) => (
          <OverlaySelect {...p} value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} data-testid="perf-calibrate-decision">
            <option value="CONFIRM">Confirmar a posição calculada</option>
            {canAdjust ? <option value="ADJUST">Ajustar a posição</option> : null}
          </OverlaySelect>
        )}
      </OverlayField>
      {!canAdjust ? <InfoBanner tone="slate">Sem evidência suficiente não há quadrante para ajustar. A pessoa fica sem classificação.</InfoBanner> : null}
      {decision === "ADJUST" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <OverlayField label="Desempenho (eixo horizontal)" required>
            {(p) => (
              <OverlaySelect {...p} value={technicalBand} onChange={(e) => setTechnicalBand(e.target.value)} data-testid="perf-calibrate-x">
                {NINE_BOX_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {NINE_BOX_BAND_LABELS[b]}
                  </option>
                ))}
              </OverlaySelect>
            )}
          </OverlayField>
          <OverlayField label="Potencial (eixo vertical)" required>
            {(p) => (
              <OverlaySelect {...p} value={potentialBand} onChange={(e) => setPotentialBand(e.target.value)} data-testid="perf-calibrate-y">
                {NINE_BOX_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {NINE_BOX_BAND_LABELS[b]}
                  </option>
                ))}
              </OverlaySelect>
            )}
          </OverlayField>
        </div>
      ) : null}
      <ReasonField label="Justificativa" value={note} onChange={setNote} placeholder="Fatos e evidências considerados" testId="perf-calibrate-note" />
    </PerformanceModal>
  );
}

function HistoryOverlay({ row, onClose }: { row: CalibrationRow; onClose: () => void }) {
  const [history, setHistory] = useState<ResultHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetchResultHistory(row.participantId)
      .then(setHistory)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar."));
  }, [row.participantId]);
  return (
    <Overlay open onClose={onClose} size="lg" ariaLabel="Versões do resultado" testId="perf-history-overlay">
      <OverlayHeader eyebrow={PERF_EYEBROW} title={`Versões do resultado · ${row.employeeName}`} subtitle="Cada validação, calibração ou ajuste cria uma versão nova. Nenhuma é apagada." onClose={onClose} />
      <OverlayBody>
        <ErrorBanner message={error} />
        {!history && !error ? <PanelState kind="loading" message="Carregando…" /> : null}
        {history ? (
          <ol className="space-y-2">
            {history.versions.map((v) => (
              <li key={v.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>Versão {v.version}</strong>
                  <span className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString("pt-BR")}</span>
                </div>
                <p>
                  {quadrantText(v.quadrant)} · {v.reviewStatus === "CALIBRATED" ? "calibrado" : "preliminar"}
                  {v.official ? " · oficial" : ""} · regras {v.ruleSetId ?? "—"}
                </p>
                {v.validationNote ? <p className="text-xs text-muted-foreground">Validação: {v.validationNote}</p> : null}
                {v.calibrationNote ? <p className="text-xs text-muted-foreground">Calibração: {v.calibrationNote}</p> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </OverlayBody>
      <OverlayFooter>
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>
          Fechar
        </button>
      </OverlayFooter>
    </Overlay>
  );
}

export { dateBr };
