/**
 * Calibração dentro do dossiê: a ficha de um lado, a decisão do outro. Mesmas regras e mesma API
 * do diálogo "Calibrar" da lista (decisão, posição, exceção sem avaliação do líder, comitê, motivo).
 */
import React, { useState } from "react";
import { OverlayField, OverlayInput, OverlaySelect } from "@/src/components/ui/overlay";
import { NINE_BOX_BANDS, NINE_BOX_BAND_LABELS } from "@/src/lib/hrPerformance/performanceDomain";
import { calibratePerformance, validatePerformanceTechnical, type CalibrationRow } from "@/src/lib/hrPerformance/performanceClient";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorBanner, InfoBanner, ReasonField, quadrantText } from "./performanceUi";
import { Term } from "./performanceGlossary";

export function DossierCalibrateInline({ row, onDone }: { row: CalibrationRow; onDone: (message: string) => void }) {
  const result = row.result;
  const withoutLeader = row.leaderStatus !== "SUBMITTED";
  const needsValidation = result?.technicalValidation === "PENDING_VALIDATION";
  const canAdjust = Boolean(result && result.nineX && result.nineY) && !withoutLeader;
  const [acceptMissingLeader, setAcceptMissingLeader] = useState(false);
  const [decision, setDecision] = useState<"CONFIRM" | "ADJUST">("CONFIRM");
  const [technicalBand, setTechnicalBand] = useState(result?.nineX ?? "MID");
  const [potentialBand, setPotentialBand] = useState(result?.nineY ?? "MID");
  const [note, setNote] = useState("");
  const [committee, setCommittee] = useState("");
  const [validationNote, setValidationNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = technicalBand !== result?.nineX || potentialBand !== result?.nineY;
  const canSave = note.trim().length >= 8 && (decision === "CONFIRM" || changed) && (!withoutLeader || acceptMissingLeader);

  if (result?.official) {
    return <InfoBanner tone="slate" testId="perf-dossier-calibrate-official">Resultado oficial: só uma revisão formal do ciclo reabre.</InfoBanner>;
  }
  if (result?.reviewStatus === "CALIBRATED") {
    return (
      <InfoBanner tone="sky" testId="perf-dossier-calibrated">
        Já calibrado: {quadrantText(result.quadrant)}. Para mudar, registre uma nova versão pela lista.
      </InfoBanner>
    );
  }
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };
  if (needsValidation) {
    return (
      <div className="space-y-3" data-testid="perf-dossier-validate">
        <p className="text-sm">
          Antes de <Term k="calibrar" />, confirme o desempenho técnico com o padrão da função.
        </p>
        <ReasonField label="Critério da função usado" value={validationNote} onChange={setValidationNote} placeholder="Ex.: refugo do posto e auditoria de qualidade do semestre" testId="perf-dossier-validate-note" />
        <ErrorBanner message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={busy || validationNote.trim().length < 8} onClick={() => void run(async () => (await validatePerformanceTechnical(row.participantId, "VALIDATED", validationNote), "Técnico validado"))} data-testid="perf-dossier-validate-ok">
            Validar o técnico
          </button>
          <button type="button" className={BTN_SECONDARY} disabled={busy || validationNote.trim().length < 8} onClick={() => void run(async () => (await validatePerformanceTechnical(row.participantId, "INSUFFICIENT", validationNote), "Marcado como evidência insuficiente"))}>
            Evidência insuficiente
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="perf-dossier-calibrate">
      <p className="text-sm">
        Posição calculada: <strong>{quadrantText(result?.quadrant)}</strong>. <Term k="calibrar">Calibrar</Term> é confirmar ou ajustar com justificativa; a versão original fica guardada.
      </p>
      <OverlayField label="Decisão" required>
        {(p) => (
          <OverlaySelect {...p} value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} data-testid="perf-dossier-decision">
            <option value="CONFIRM">Confirmar a posição calculada</option>
            {canAdjust ? <option value="ADJUST">Ajustar a posição</option> : null}
          </OverlaySelect>
        )}
      </OverlayField>
      {withoutLeader ? (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={acceptMissingLeader} onChange={(e) => setAcceptMissingLeader(e.target.checked)} data-testid="perf-dossier-accept-missing-leader" />
          Não há avaliação do líder enviada. Registrar como exceção: a pessoa fica sem classificação e a decisão vai para a auditoria.
        </label>
      ) : !canAdjust ? (
        <InfoBanner tone="slate">Sem evidência suficiente não há quadrante para ajustar. A pessoa fica sem classificação.</InfoBanner>
      ) : null}
      {decision === "ADJUST" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <OverlayField label="Desempenho (eixo horizontal)" required>
            {(p) => (
              <OverlaySelect {...p} value={technicalBand} onChange={(e) => setTechnicalBand(e.target.value)} data-testid="perf-dossier-x">
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
              <OverlaySelect {...p} value={potentialBand} onChange={(e) => setPotentialBand(e.target.value)} data-testid="perf-dossier-y">
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
      <OverlayField label="Quem participou desta calibração (comitê)" hint="Líder de líderes da área, pares e RH. Fica na nota e na auditoria.">
        {(p) => <OverlayInput {...p} value={committee} onChange={(e) => setCommittee(e.target.value)} placeholder="Ex.: Carla (diretora), Marcos (par), Rita (RH)" data-testid="perf-dossier-committee" />}
      </OverlayField>
      <ReasonField label="Justificativa" value={note} onChange={setNote} placeholder="Fatos e evidências considerados" testId="perf-dossier-note" />
      <ErrorBanner message={error} />
      <button
        type="button"
        className={BTN_PRIMARY}
        disabled={busy || !canSave}
        onClick={() =>
          void run(async () => {
            const out = await calibratePerformance(
              row.participantId,
              decision === "ADJUST" ? { note, decision, technicalBand, potentialBand, committee: committee || undefined } : { note, decision, acceptMissingLeader: withoutLeader && acceptMissingLeader, committee: committee || undefined }
            );
            return decision === "ADJUST" ? `Ajustado para ${out.quadrant}` : withoutLeader ? "Exceção registrada: sem avaliação do líder" : "Nota confirmada";
          })
        }
        data-testid="perf-dossier-save"
      >
        {decision === "ADJUST" ? "Registrar o ajuste" : "Confirmar a nota"}
      </button>
    </div>
  );
}
