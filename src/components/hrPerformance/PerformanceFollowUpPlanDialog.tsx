/**
 * Etapa "Calibração e devolutiva" no lado do líder: ele vê a posição preliminar do liderado, propõe confirmar ou
 * ajustar (o RH decide na calibração), agenda a conversa e deixa devolutiva e PDI preparados. Depois da
 * homologação, o rascunho preenche os formulários de devolutiva e de PDI. Nada aqui torna resultado oficial.
 */
import React, { useState } from "react";
import { OverlayField, OverlayFieldGrid, OverlayInput, OverlaySelect, OverlayTextarea } from "@/src/components/ui/overlay";
import { NINE_BOX_BAND_LABELS, NINE_BOX_BANDS, quadrantLabel } from "@/src/lib/hrPerformance/performanceDomain";
import { savePerformancePlan, type LeaderProposal, type LeaderQueueItem, type NineBand } from "@/src/lib/hrPerformance/performanceClient";
import { PerformanceModal, quadrantText } from "./performanceUi";
import { cn } from "@/src/lib/utils";

export function planSummary(item: LeaderQueueItem): string | null {
  const plan = item.plan;
  if (!plan) return null;
  const parts = [
    plan.proposalDecision === "CONFIRM" ? "Proposta: confirmar a posição" : plan.proposalDecision === "ADJUST" ? "Proposta: ajustar a posição" : null,
    plan.meetingAt ? `Conversa ${plan.meetingAt.slice(8, 10)}/${plan.meetingAt.slice(5, 7)} às ${plan.meetingAt.slice(11, 16)}${plan.meetingPlace ? ` · ${plan.meetingPlace}` : ""}` : null,
    plan.draftStrength || plan.draftImprovement || plan.draftAction || plan.draftPdiTitle ? "Devolutiva/PDI em rascunho" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function FollowUpPlanDialog({ item, onClose, onDone }: { item: LeaderQueueItem; onClose: () => void; onDone: (message: string) => void }) {
  const plan = item.plan ?? null;
  const proposalEditable = Boolean(item.proposalEditable);
  const [decision, setDecision] = useState<"" | "CONFIRM" | "ADJUST">(plan?.proposalDecision ?? "");
  const [nineX, setNineX] = useState<"" | NineBand>(plan?.proposalNineX ?? item.preliminaryResult?.nineX ?? "");
  const [nineY, setNineY] = useState<"" | NineBand>(plan?.proposalNineY ?? item.preliminaryResult?.nineY ?? "");
  const [note, setNote] = useState(plan?.proposalNote ?? "");
  const [meetingAt, setMeetingAt] = useState(plan?.meetingAt ?? "");
  const [meetingPlace, setMeetingPlace] = useState(plan?.meetingPlace ?? "");
  const [draft, setDraft] = useState({
    strength: plan?.draftStrength ?? "",
    improvement: plan?.draftImprovement ?? "",
    action: plan?.draftAction ?? "",
    pdiTitle: plan?.draftPdiTitle ?? "",
    pdiObjective: plan?.draftPdiObjective ?? "",
    pdiDueAt: plan?.draftPdiDueAt ?? "",
  });
  const adjustIncomplete = decision === "ADJUST" && (!nineX || !nineY || note.trim().length < 8);
  const first = item.employeeName.split(" ")[0];
  return (
    <PerformanceModal
      open
      title="Calibração e devolutiva"
      subtitle={`${item.employeeName} · ${item.cycleName}. Sua proposta vai para o RH, que decide a posição oficial.`}
      saveLabel="Salvar"
      footerHint={adjustIncomplete ? "Para propor ajuste, escolha as duas faixas e explique em pelo menos 8 caracteres." : "Você pode voltar e completar depois."}
      canSave={!adjustIncomplete}
      size="lg"
      testId="perf-plan-dialog"
      onClose={onClose}
      onSave={async () => {
        await savePerformancePlan(item.participantId, {
          proposal: proposalEditable && decision ? { decision, nineX: decision === "ADJUST" ? (nineX as NineBand) : null, nineY: decision === "ADJUST" ? (nineY as NineBand) : null, note: note || null } : null,
          meeting: { at: meetingAt || null, place: meetingPlace || null },
          draft: {
            strength: draft.strength || null,
            improvement: draft.improvement || null,
            action: draft.action || null,
            pdiTitle: draft.pdiTitle || null,
            pdiObjective: draft.pdiObjective || null,
            pdiDueAt: draft.pdiDueAt || null,
          },
        });
        onDone("Calibração e devolutiva salvas");
      }}
    >
      <section className="space-y-2" data-testid="perf-plan-position">
        <h4 className="text-sm font-semibold">1. Posição de {first}</h4>
        <p className="text-sm">
          {item.officialResult
            ? `Resultado oficial: ${quadrantText(item.officialResult.quadrant)}.`
            : item.preliminaryResult
              ? `Posição preliminar: ${quadrantText(item.preliminaryResult.quadrant)}${item.preliminaryResult.calibrated ? " (já calibrada pelo RH)" : ""}.`
              : "A posição preliminar aparece quando a coleta fechar."}
        </p>
        {proposalEditable ? (
          <>
            <div role="radiogroup" aria-label="Sua proposta" className="flex flex-wrap gap-2">
              {(
                [
                  ["CONFIRM", "Confirmo a posição"],
                  ["ADJUST", "Proponho ajuste"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={decision === value}
                  onClick={() => setDecision(value)}
                  className={cn("rounded-md border px-3 py-1.5 text-sm font-medium", decision === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                  data-testid={`perf-plan-decision-${value}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {decision === "ADJUST" ? (
              <OverlayFieldGrid columns={2}>
                <OverlayField label="Desempenho técnico" required>
                  {(p) => (
                    <OverlaySelect {...p} value={nineX} onChange={(e) => setNineX(e.target.value as NineBand)} data-testid="perf-plan-ninex">
                      <option value="">Escolha…</option>
                      {NINE_BOX_BANDS.map((band) => (
                        <option key={band} value={band}>
                          {NINE_BOX_BAND_LABELS[band]}
                        </option>
                      ))}
                    </OverlaySelect>
                  )}
                </OverlayField>
                <OverlayField label="Potencial" required>
                  {(p) => (
                    <OverlaySelect {...p} value={nineY} onChange={(e) => setNineY(e.target.value as NineBand)} data-testid="perf-plan-niney">
                      <option value="">Escolha…</option>
                      {NINE_BOX_BANDS.map((band) => (
                        <option key={band} value={band}>
                          {NINE_BOX_BAND_LABELS[band]}
                        </option>
                      ))}
                    </OverlaySelect>
                  )}
                </OverlayField>
              </OverlayFieldGrid>
            ) : null}
            <OverlayField label={decision === "ADJUST" ? "Por que ajustar (fatos observados)" : "Observação para o RH (opcional)"} required={decision === "ADJUST"}>
              {(p) => <OverlayTextarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="perf-plan-note" />}
            </OverlayField>
          </>
        ) : plan?.proposalDecision ? (
          <p className="text-xs text-muted-foreground">Sua proposta ({plan.proposalDecision === "CONFIRM" ? "confirmar" : "ajustar"}) já foi para o RH.</p>
        ) : null}
      </section>

      <section className="space-y-2" data-testid="perf-plan-meeting">
        <h4 className="text-sm font-semibold">2. Agende a conversa</h4>
        <OverlayFieldGrid columns={2}>
          <OverlayField label="Data e hora">
            {(p) => <OverlayInput {...p} type="datetime-local" value={meetingAt} onChange={(e) => setMeetingAt(e.target.value)} data-testid="perf-plan-meeting-at" />}
          </OverlayField>
          <OverlayField label="Local">
            {(p) => <OverlayInput {...p} value={meetingPlace} placeholder="Ex.: sala de reunião da fábrica" onChange={(e) => setMeetingPlace(e.target.value)} data-testid="perf-plan-meeting-place" />}
          </OverlayField>
        </OverlayFieldGrid>
      </section>

      <section className="space-y-2" data-testid="perf-plan-draft">
        <h4 className="text-sm font-semibold">3. Prepare a devolutiva e o PDI</h4>
        <p className="text-xs text-muted-foreground">Rascunho só seu e do RH. Depois do resultado oficial, ele preenche “Registrar devolutiva” e “Criar PDI”.</p>
        <OverlayField label="Principal ponto forte">
          {(p) => <OverlayTextarea {...p} rows={2} value={draft.strength} onChange={(e) => setDraft({ ...draft, strength: e.target.value })} data-testid="perf-plan-strength" />}
        </OverlayField>
        <OverlayField label="Ponto de desenvolvimento prioritário">
          {(p) => <OverlayTextarea {...p} rows={2} value={draft.improvement} onChange={(e) => setDraft({ ...draft, improvement: e.target.value })} data-testid="perf-plan-improvement" />}
        </OverlayField>
        <OverlayField label="Ação combinada">
          {(p) => <OverlayTextarea {...p} rows={2} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} data-testid="perf-plan-action" />}
        </OverlayField>
        <OverlayFieldGrid columns={2}>
          <OverlayField label="Ação do PDI">
            {(p) => <OverlayInput {...p} value={draft.pdiTitle} onChange={(e) => setDraft({ ...draft, pdiTitle: e.target.value })} data-testid="perf-plan-pdi-title" />}
          </OverlayField>
          <OverlayField label="Prazo do PDI">
            {(p) => <OverlayInput {...p} type="date" value={draft.pdiDueAt} onChange={(e) => setDraft({ ...draft, pdiDueAt: e.target.value })} data-testid="perf-plan-pdi-due" />}
          </OverlayField>
        </OverlayFieldGrid>
        <OverlayField label="Objetivo do PDI">
          {(p) => <OverlayTextarea {...p} rows={2} value={draft.pdiObjective} onChange={(e) => setDraft({ ...draft, pdiObjective: e.target.value })} data-testid="perf-plan-pdi-objective" />}
        </OverlayField>
      </section>
    </PerformanceModal>
  );
}

/** No lado do RH (calibração): a proposta do líder ao lado da decisão, com o atalho para usá-la. */
export function LeaderProposalNote({
  proposal,
  canAdjust,
  onUse,
  testId,
}: {
  proposal: LeaderProposal | null | undefined;
  canAdjust: boolean;
  onUse: (input: { decision: "CONFIRM" | "ADJUST"; technicalBand: string | null; potentialBand: string | null; note: string }) => void;
  testId: string;
}) {
  if (!proposal) return null;
  const adjust = proposal.decision === "ADJUST" && proposal.nineX && proposal.nineY;
  const usable = proposal.decision === "CONFIRM" || (adjust && canAdjust);
  const who = proposal.leaderName ? proposal.leaderName.split(" ")[0] : "O líder";
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-sm dark:border-sky-800 dark:bg-sky-950/30" data-testid={testId}>
      <p className="font-medium">
        Proposta do líder ({who}):{" "}
        {adjust ? `ajustar para ${quadrantLabel(proposal.nineX as NineBand, proposal.nineY as NineBand)}` : "confirmar a posição calculada"}
      </p>
      {proposal.note ? <p className="mt-1 text-muted-foreground">“{proposal.note}”</p> : null}
      {proposal.meetingAt ? <p className="mt-1 text-xs text-muted-foreground">Conversa agendada para {proposal.meetingAt.slice(8, 10)}/{proposal.meetingAt.slice(5, 7)} às {proposal.meetingAt.slice(11, 16)}.</p> : null}
      {usable ? (
        <button
          type="button"
          className="mt-2 text-sm font-medium text-primary underline underline-offset-2"
          onClick={() =>
            onUse({
              decision: adjust ? "ADJUST" : "CONFIRM",
              technicalBand: adjust ? proposal.nineX : null,
              potentialBand: adjust ? proposal.nineY : null,
              note: `Proposta do líder${proposal.leaderName ? ` (${proposal.leaderName})` : ""}${proposal.note ? `: ${proposal.note}` : "."}`,
            })
          }
          data-testid={`${testId}-use`}
        >
          Usar a proposta do líder
        </button>
      ) : null}
    </div>
  );
}
