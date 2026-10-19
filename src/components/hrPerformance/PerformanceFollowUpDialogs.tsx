/**
 * Devolutiva, ciência, PDI e acompanhamento. Usados pelo RH e pela liderança; o servidor
 * confere o escopo de cada pessoa.
 */
import React, { useEffect, useState } from "react";
import { OverlayField, OverlayFieldGrid, OverlayInput, OverlaySelect, OverlayTextarea } from "@/src/components/ui/overlay";
import { PDI_STATUSES, PDI_STATUS_LABELS, PILLAR_SHORT_LABELS, type Pillar } from "@/src/lib/hrPerformance/performanceDomain";
import {
  acknowledgePerformanceFeedback,
  addPerformanceCheckin,
  createPerformanceFeedback,
  createPerformancePdi,
  fetchCycleWorkspace,
  updatePerformancePdi,
} from "@/src/lib/hrPerformance/performanceClient";
import { PerformanceModal, ReasonField, addDaysIso, todayIso } from "./performanceUi";

export function FeedbackDialog({ participantId, employeeName, ownerName, onClose, onDone }: { participantId: string; employeeName: string; ownerName: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ strength: "", improvement: "", action: "", ownerName, dueAt: addDaysIso(90), conversationAt: todayIso() });
  const valid = form.strength.trim().length >= 3 && form.improvement.trim().length >= 3 && form.action.trim().length >= 3 && form.ownerName.trim().length >= 2;
  return (
    <PerformanceModal
      open
      title="Registrar devolutiva"
      subtitle={`${employeeName} · resumo simples da conversa. A pessoa vê a própria devolutiva; a Nine-Box não aparece para ela.`}
      saveLabel="Registrar"
      footerHint="Depois de registrada, a devolutiva não é reescrita em silêncio."
      canSave={valid}
      size="md"
      testId="perf-feedback-dialog"
      onClose={onClose}
      onSave={async () => {
        await createPerformanceFeedback(participantId, form);
        onDone();
      }}
    >
      <OverlayField label="Principal ponto forte" required>
        {(p) => <OverlayTextarea {...p} rows={2} value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} data-testid="perf-feedback-strength" />}
      </OverlayField>
      <OverlayField label="Ponto de desenvolvimento prioritário" required>
        {(p) => <OverlayTextarea {...p} rows={2} value={form.improvement} onChange={(e) => setForm({ ...form, improvement: e.target.value })} data-testid="perf-feedback-improvement" />}
      </OverlayField>
      <OverlayField label="Ação combinada" required>
        {(p) => <OverlayTextarea {...p} rows={2} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} data-testid="perf-feedback-action" />}
      </OverlayField>
      <OverlayFieldGrid columns={3}>
        <OverlayField label="Responsável" required>
          {(p) => <OverlayInput {...p} value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />}
        </OverlayField>
        <OverlayField label="Prazo da ação">
          {(p) => <OverlayInput {...p} type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />}
        </OverlayField>
        <OverlayField label="Data da conversa">
          {(p) => <OverlayInput {...p} type="date" value={form.conversationAt} onChange={(e) => setForm({ ...form, conversationAt: e.target.value })} />}
        </OverlayField>
      </OverlayFieldGrid>
    </PerformanceModal>
  );
}

export function AckDialog({ feedbackId, employeeName, onClose, onDone }: { feedbackId: string; employeeName: string; onClose: () => void; onDone: () => void }) {
  const [action, setAction] = useState<"VIEWED" | "ACKNOWLEDGED" | "AGREED" | "CONTESTED">("ACKNOWLEDGED");
  const [note, setNote] = useState("");
  const contest = action === "CONTESTED";
  return (
    <PerformanceModal
      open
      title="Registro presencial da pessoa"
      subtitle={`${employeeName} está presente. Ciência quer dizer que a pessoa conheceu a devolutiva; não quer dizer que concorda.`}
      saveLabel="Registrar"
      footerHint="O registro indica que foi feito com assistência do RH ou do líder."
      canSave={!contest || note.trim().length >= 8}
      size="md"
      testId="perf-ack-dialog"
      onClose={onClose}
      onSave={async () => {
        await acknowledgePerformanceFeedback(feedbackId, { action, note: note.trim() || undefined, assisted: true });
        onDone();
      }}
    >
      <OverlayField label="O que a pessoa registra" required>
        {(p) => (
          <OverlaySelect {...p} value={action} onChange={(e) => setAction(e.target.value as typeof action)} data-testid="perf-ack-action">
            <option value="VIEWED">Visualizou</option>
            <option value="ACKNOWLEDGED">Ciência (conheceu a devolutiva)</option>
            <option value="AGREED">Concorda com a devolutiva</option>
            <option value="CONTESTED">Contesta um fato</option>
          </OverlaySelect>
        )}
      </OverlayField>
      <ReasonField
        label={contest ? "Fato contestado" : "Observação da pessoa (opcional)"}
        value={note}
        onChange={setNote}
        min={contest ? 8 : 0}
        required={contest}
        placeholder={contest ? "Descreva o fato, com data se possível" : "Ex.: quer apoio no turno da noite"}
      />
    </PerformanceModal>
  );
}

export function PdiDialog({
  feedbackId,
  cycleId,
  employeeName,
  ownerName,
  hasPriority,
  onClose,
  onDone,
}: {
  feedbackId: string;
  cycleId: string;
  employeeName: string;
  ownerName: string;
  hasPriority: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [questions, setQuestions] = useState<{ code: string; pillar: string; competency: string }[]>([]);
  const [form, setForm] = useState({ title: "", objective: "", competencyCode: "", ownerName, dueAt: addDaysIso(90), justification: "" });
  useEffect(() => {
    void fetchCycleWorkspace(cycleId)
      .then((ws) => {
        // Líder no ciclo também pode ter ação do PDI ligada a uma competência de liderança.
        const isLeader = ws.people.some((p) => p.participant.employeeName === employeeName && p.leadership?.isLeader);
        setQuestions([...ws.questions, ...(isLeader ? ws.leadershipQuestions ?? [] : [])]);
      })
      .catch(() => setQuestions([]));
  }, [cycleId]);
  const valid = form.title.trim().length >= 3 && form.ownerName.trim().length >= 2 && Boolean(form.dueAt) && (!hasPriority || form.justification.trim().length >= 8);
  return (
    <PerformanceModal
      open
      title={hasPriority ? "Nova ação extra do PDI" : "Ação prioritária do PDI"}
      subtitle={`${employeeName} · uma ação objetiva com prazo. ${hasPriority ? "Já existe ação prioritária: esta precisa de justificativa." : "Mais ações são possíveis quando justificadas."}`}
      saveLabel="Criar ação"
      footerHint="O PDI não dispara nenhuma medida disciplinar."
      canSave={valid}
      size="md"
      testId="perf-pdi-dialog"
      onClose={onClose}
      onSave={async () => {
        await createPerformancePdi(feedbackId, {
          title: form.title,
          objective: form.objective || undefined,
          competencyCode: form.competencyCode || undefined,
          priority: !hasPriority,
          justification: hasPriority ? form.justification : undefined,
          ownerName: form.ownerName,
          dueAt: form.dueAt,
        });
        onDone();
      }}
    >
      <OverlayField label="Ação" required>
        {(p) => <OverlayInput {...p} value={form.title} placeholder="Ex.: Treinar o checklist da máquina com o líder" onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="perf-pdi-title" />}
      </OverlayField>
      <OverlayField label="Objetivo">
        {(p) => <OverlayTextarea {...p} rows={2} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} />}
      </OverlayField>
      <OverlayFieldGrid columns={3}>
        <OverlayField label="Competência">
          {(p) => (
            <OverlaySelect {...p} value={form.competencyCode} onChange={(e) => setForm({ ...form, competencyCode: e.target.value })}>
              <option value="">Não vinculada</option>
              {questions.map((q) => (
                <option key={q.code} value={q.code}>
                  {q.pillar === "LEADERSHIP" ? "Liderança" : PILLAR_SHORT_LABELS[q.pillar as Pillar]} · {q.competency}
                </option>
              ))}
            </OverlaySelect>
          )}
        </OverlayField>
        <OverlayField label="Responsável" required>
          {(p) => <OverlayInput {...p} value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />}
        </OverlayField>
        <OverlayField label="Prazo" required>
          {(p) => <OverlayInput {...p} type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} data-testid="perf-pdi-due" />}
        </OverlayField>
      </OverlayFieldGrid>
      {hasPriority ? <ReasonField label="Justificativa da ação extra" value={form.justification} onChange={(justification) => setForm({ ...form, justification })} /> : null}
    </PerformanceModal>
  );
}

export function PdiStatusDialog({ pdiId, title, current, onClose, onDone }: { pdiId: string; title: string; current: string; onClose: () => void; onDone: () => void }) {
  const options = PDI_STATUSES.filter((s) => s !== current);
  const [status, setStatus] = useState<string>(options.includes("IN_PROGRESS") ? "IN_PROGRESS" : options[0]!);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const needsNote = status === "DONE" || status === "CANCELLED" || status === "SUSPENDED";
  return (
    <PerformanceModal
      open
      title="Mudar a situação da ação"
      subtitle={`${title} · hoje: ${PDI_STATUS_LABELS[current as keyof typeof PDI_STATUS_LABELS] ?? current}. Concluída ou cancelada fica preservada como está.`}
      saveLabel="Salvar"
      footerHint="A mudança vira um registro no acompanhamento."
      canSave={!needsNote || note.trim().length >= 8}
      size="md"
      testId="perf-pdi-status-dialog"
      onClose={onClose}
      onSave={async () => {
        await updatePerformancePdi(pdiId, { status, note: note.trim() || undefined, evidence: evidence.trim() || undefined });
        onDone();
      }}
    >
      <OverlayField label="Nova situação" required>
        {(p) => (
          <OverlaySelect {...p} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="perf-pdi-status">
            {options.map((s) => (
              <option key={s} value={s}>
                {PDI_STATUS_LABELS[s]}
              </option>
            ))}
          </OverlaySelect>
        )}
      </OverlayField>
      <ReasonField label="O que aconteceu" value={note} onChange={setNote} min={needsNote ? 8 : 0} required={needsNote} testId="perf-pdi-status-note" />
      {status === "DONE" ? (
        <OverlayField label="Evidência do resultado" description="Opcional: o que mostra que a ação deu resultado.">
          {(p) => <OverlayTextarea {...p} rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} />}
        </OverlayField>
      ) : null}
    </PerformanceModal>
  );
}

export function CheckinDialog({ pdiId, title, onClose, onDone }: { pdiId: string; title: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ note: "", obstacle: "", nextStep: "" });
  return (
    <PerformanceModal
      open
      title="Acompanhamento"
      subtitle={`${title} · check-in breve: progresso, obstáculo e próximo passo. Não é uma nova avaliação.`}
      saveLabel="Registrar"
      footerHint="Fica no histórico com data e autor."
      canSave={form.note.trim().length >= 3}
      size="md"
      testId="perf-checkin-dialog"
      onClose={onClose}
      onSave={async () => {
        await addPerformanceCheckin(pdiId, { note: form.note, obstacle: form.obstacle || undefined, nextStep: form.nextStep || undefined });
        onDone();
      }}
    >
      <OverlayField label="Progresso" required>
        {(p) => <OverlayTextarea {...p} rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="perf-checkin-note" />}
      </OverlayField>
      <OverlayFieldGrid columns={2}>
        <OverlayField label="Obstáculo">
          {(p) => <OverlayInput {...p} value={form.obstacle} onChange={(e) => setForm({ ...form, obstacle: e.target.value })} />}
        </OverlayField>
        <OverlayField label="Próximo passo">
          {(p) => <OverlayInput {...p} value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} />}
        </OverlayField>
      </OverlayFieldGrid>
    </PerformanceModal>
  );
}
