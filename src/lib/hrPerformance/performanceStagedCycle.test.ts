/**
 * Fluxo em etapas: calendário do ciclo, janelas de cada etapa, autoavaliação dentro do sistema e a etapa
 * "Calibração e devolutiva" do líder (proposta, conversa agendada, rascunho de devolutiva/PDI).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentStage, kindWindowOpen, localDay, stageScheduleProblem, stageWindows, type StageCycle } from "./performanceStages.js";
import { emptyPerformanceDatabase, type PerformanceDatabase } from "./performanceState.js";
import {
  createCycle,
  leaderQueue,
  myForm,
  myJourneySummary,
  mySave,
  mySubmit,
  publicForm,
  saveAnswers,
  saveFollowUpPlan,
  teamNotices,
  transitionCycle,
  updateCycle,
} from "./performanceService.js";
import { NOW, allAnswers, anaScope, assignmentOf, brunoScope, hrScope, marcosScope, must, openCycle, openOptions, participantOf, publishedModel, submitLeader, submitSelf } from "./performanceTestFixtures.js";

const TODAY = localDay(NOW); // 2026-10-16 em São Paulo

/** Calendário: autoavaliação aberta hoje, líder só depois, calibração no fim. */
const SCHEDULE = {
  selfStartAt: "2026-10-10",
  selfDueAt: "2026-10-20",
  leaderStartAt: "2026-10-21",
  leaderDueAt: "2026-10-30",
  leadershipStartAt: null,
  leadershipDueAt: null,
  calibrationStartAt: "2026-11-01",
  calibrationDueAt: "2026-11-10",
};

function stagedOpen(schedule: Partial<typeof SCHEDULE> = {}) {
  const open = openCycle();
  const db = structuredClone(open.db) as PerformanceDatabase;
  Object.assign(db.cycles.find((c) => c.id === open.cycleId)!, { ...SCHEDULE, ...schedule });
  return { ...open, db };
}

function stageCycle(extra: Partial<StageCycle> = {}): StageCycle {
  return { status: "OPEN", leadershipModelId: null, ...SCHEDULE, ...extra };
}

describe("calendário das etapas (regra pura)", () => {
  it("aceita calendário em ordem e ciclo sem calendário", () => {
    assert.equal(stageScheduleProblem(stageCycle(), false), null);
    assert.equal(stageScheduleProblem({ ...stageCycle(), selfStartAt: null, leaderStartAt: null, calibrationStartAt: null, calibrationDueAt: null }, false), null);
  });

  it("recusa calendário incompleto, fim antes do início, ordem trocada e calibração antes do fim da coleta", () => {
    assert.match(stageScheduleProblem({ ...stageCycle(), calibrationDueAt: null }, false)!, /Preencha início e fim/);
    assert.match(stageScheduleProblem({ ...stageCycle(), selfStartAt: "2026-10-25" }, false)!, /Autoavaliação: o fim não pode vir antes/);
    assert.match(stageScheduleProblem({ ...stageCycle(), leaderStartAt: "2026-10-01" }, false)!, /não pode começar antes da autoavaliação/);
    assert.match(stageScheduleProblem({ ...stageCycle(), calibrationStartAt: "2026-10-30" }, false)!, /calibração começa depois do fim da coleta/);
  });

  it("com liderança, a etapa 180° entra no calendário e na ordem", () => {
    const withLeadership = stageCycle({ leadershipModelId: "lm", leadershipStartAt: "2026-10-21", leadershipDueAt: "2026-10-30" });
    assert.equal(stageScheduleProblem(withLeadership, true), null);
    assert.deepEqual(
      stageWindows(withLeadership).map((w) => w.label),
      ["Autoavaliação", "Avaliação do líder", "Avaliação da liderança", "Calibração e devolutiva"]
    );
    assert.match(stageScheduleProblem({ ...withLeadership, leadershipStartAt: "2026-10-12" }, true)!, /liderança não pode começar antes/);
  });

  it("janela por tarefa: autoavaliação aberta hoje, líder ainda fechado; sem calendário, tudo aberto", () => {
    assert.equal(kindWindowOpen(stageCycle(), "SELF", TODAY), true);
    assert.equal(kindWindowOpen(stageCycle(), "LEADER", TODAY), false);
    assert.equal(kindWindowOpen(stageCycle({ selfStartAt: null, leaderStartAt: null, calibrationStartAt: null, calibrationDueAt: null }), "LEADER", TODAY), true);
  });

  it("etapa atual e próximo passo para o RH", () => {
    assert.equal(currentStage(stageCycle(), TODAY).key, "SELF");
    assert.equal(currentStage(stageCycle(), "2026-10-25").key, "LEADER");
    assert.match(currentStage(stageCycle(), "2026-10-31").advice!, /feche a coleta/);
    assert.equal(currentStage(stageCycle({ status: "CALIBRATION" }), "2026-11-05").key, "CALIBRATION");
    assert.equal(currentStage(stageCycle({ status: "PREPARED" }), TODAY).key, "PREPARATION");
  });
});

describe("ciclo com calendário (serviço)", () => {
  it("createCycle grava o calendário e recusa calendário inválido", () => {
    const published = publishedModel();
    const base = { name: "Ciclo em etapas", periodLabel: "2026", modelId: published.modelId, actorUserId: "rh", classification: "OFFICIAL" as const, scope: hrScope };
    const bad = createCycle(published.db, { ...base, ...SCHEDULE, calibrationStartAt: "2026-10-15" }, openOptions);
    assert.equal(bad.ok, false);
    assert.equal(bad.ok === false && bad.code, "INVALID_DATE");
    const ok = must(createCycle(published.db, { ...base, ...SCHEDULE }, openOptions));
    const cycle = ok.db.cycles.find((c) => c.id === ok.value.cycleId)!;
    assert.equal(cycle.selfStartAt, "2026-10-10");
    assert.equal(cycle.calibrationDueAt, "2026-11-10");
  });

  it("depois da abertura, mudar o calendário pede motivo e fica auditado", () => {
    const open = stagedOpen();
    const cycle = open.db.cycles.find((c) => c.id === open.cycleId)!;
    const input = { cycleId: open.cycleId, name: cycle.name, periodLabel: cycle.periodLabel, selfDueAt: cycle.selfDueAt, leaderDueAt: cycle.leaderDueAt, actorUserId: "rh", scope: hrScope };
    const noReason = updateCycle(open.db, { ...input, reason: null, calibrationDueAt: "2026-11-15" }, openOptions);
    assert.equal(noReason.ok, false);
    const changed = must(updateCycle(open.db, { ...input, reason: "Feriado prolongado na fábrica", calibrationDueAt: "2026-11-15" }, openOptions));
    assert.equal(changed.db.cycles.find((c) => c.id === open.cycleId)!.calibrationDueAt, "2026-11-15");
  });

  it("a avaliação do líder fora da janela é recusada com a data de abertura", () => {
    const open = stagedOpen();
    const leader = assignmentOf(open.db, "ana", "LEADER");
    const early = saveAnswers(open.db, { assignmentId: leader.id, expectedVersion: leader.version, answers: allAnswers(3), actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(early.ok, false);
    assert.equal(early.ok === false && early.code, "COLLECTION_CLOSED");
    assert.match(early.ok === false ? early.message : "", /abre em 21\/10/);
    // A autoavaliação está na janela.
    const self = assignmentOf(open.db, "ana", "SELF");
    assert.equal(saveAnswers(open.db, { assignmentId: self.id, expectedVersion: self.version, answers: allAnswers(3), actorUserId: null, scope: anaScope }, openOptions).ok, true);
  });

  it("autoavaliação encerrada: o portal explica que a etapa terminou", () => {
    const open = stagedOpen({ selfStartAt: "2026-10-01", selfDueAt: "2026-10-10" });
    const anaParticipant = participantOf(open.db, "ana");
    const summary = myJourneySummary(open.db, "ana", NOW);
    assert.equal(summary?.open, false);
    assert.match(summary?.message ?? "", /terminou em 10\/10/);
    const form = myForm(open.db, { actorEmployeeId: "ana" }, openOptions);
    assert.equal(form.ok === false && form.code, "STAGE_CLOSED");
    assert.ok(anaParticipant);
  });

  it("ciclo antigo (sem calendário) segue como antes: líder avalia enquanto o ciclo está aberto", () => {
    const open = openCycle();
    const leader = assignmentOf(open.db, "ana", "LEADER");
    assert.equal(saveAnswers(open.db, { assignmentId: leader.id, expectedVersion: leader.version, answers: allAnswers(3), actorUserId: "u-bruno", scope: brunoScope }, openOptions).ok, true);
  });
});

describe("autoavaliação dentro do sistema", () => {
  it("a própria pessoa abre, salva e envia a jornada sem QR", () => {
    const open = stagedOpen();
    const form = must(myForm(open.db, { actorEmployeeId: "ana" }, openOptions));
    assert.equal(form.value.step.kind, "SELF");
    assert.equal(form.value.dueAt, "2026-10-20");
    const saved = must(mySave(open.db, { actorEmployeeId: "ana", actorUserId: "u-ana", expectedVersion: form.value.version, answers: allAnswers(3), step: "SELF" }, openOptions));
    const sent = must(mySubmit(saved.db, { actorEmployeeId: "ana", actorUserId: "u-ana", expectedVersion: saved.value.version, step: "SELF" }, openOptions));
    assert.equal(sent.value.status, "SUBMITTED");
    assert.equal(sent.value.done, true);
    const after = myForm(sent.db, { actorEmployeeId: "ana" }, openOptions);
    assert.equal(after.ok === false && after.code, "NO_PENDING");
  });

  it("sem vínculo usuário → cadastro não há formulário; a etapa errada é recusada", () => {
    const open = stagedOpen();
    assert.equal(myForm(open.db, { actorEmployeeId: null }, openOptions).ok, false);
    const form = must(myForm(open.db, { actorEmployeeId: "ana" }, openOptions));
    const wrongStep = mySave(open.db, { actorEmployeeId: "ana", actorUserId: "u-ana", expectedVersion: form.value.version, answers: allAnswers(3), step: "LEADERSHIP_SELF" }, openOptions);
    assert.equal(wrongStep.ok === false && wrongStep.code, "STEP_CHANGED");
  });

  it("o portal público também recusa etapa fora da janela", () => {
    const open = stagedOpen({ selfStartAt: "2026-10-01", selfDueAt: "2026-10-10" });
    const result = publicForm(open.db, { sessionToken: "sem-sessao" }, openOptions);
    assert.equal(result.ok, false);
  });
});

/** Coleta completa (sem calendário) e fechada: começa a etapa Calibração e devolutiva. */
function consolidated() {
  const open = openCycle();
  let db = submitSelf(open.db, "ana", 4);
  db = submitLeader(db, "ana", 3);
  db = must(transitionCycle(db, { cycleId: open.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
  return { ...open, db };
}

describe("calibração e devolutiva do líder", () => {
  it("durante a coleta ainda não há plano", () => {
    const open = openCycle();
    const result = saveFollowUpPlan(open.db, { participantId: participantOf(open.db, "ana").id, meeting: { at: "2026-11-05T14:00" }, actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(result.ok === false && result.code, "CYCLE_STAGE");
  });

  it("o líder propõe, agenda e prepara a devolutiva; a fila mostra o plano e a posição preliminar", () => {
    const { db } = consolidated();
    const ana = participantOf(db, "ana");
    const saved = must(
      saveFollowUpPlan(
        db,
        {
          participantId: ana.id,
          proposal: { decision: "CONFIRM", note: null },
          meeting: { at: "2026-11-05T14:00", place: "Sala 2" },
          draft: { strength: "Cuidado com a qualidade", improvement: "Comunicação no turno", action: "Reunião rápida diária", pdiTitle: "Curso de comunicação", pdiDueAt: "2027-02-28" },
          actorUserId: "u-bruno",
          scope: brunoScope,
        },
        openOptions
      )
    );
    const item = leaderQueue(saved.db, brunoScope, "bruno", NOW).find((i) => i.participantId === ana.id)!;
    assert.equal(item.plan?.proposalDecision, "CONFIRM");
    assert.equal(item.plan?.meetingAt, "2026-11-05T14:00");
    assert.equal(item.plan?.draftPdiTitle, "Curso de comunicação");
    assert.equal(item.proposalEditable, true);
    assert.ok(item.preliminaryResult, "posição preliminar visível ao líder na calibração");
    assert.ok(saved.db.audits.some((a) => a.action === "FOLLOW_UP_PLAN_SAVED"));
  });

  it("ajuste exige as duas faixas e uma explicação", () => {
    const { db } = consolidated();
    const ana = participantOf(db, "ana");
    const noBands = saveFollowUpPlan(db, { participantId: ana.id, proposal: { decision: "ADJUST", note: "Entregou acima no 2º trimestre" }, actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(noBands.ok === false && noBands.code, "INVALID_BAND");
    const noNote = saveFollowUpPlan(db, { participantId: ana.id, proposal: { decision: "ADJUST", nineX: "HIGH", nineY: "MID", note: "curto" }, actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(noNote.ok === false && noNote.code, "NOTE_REQUIRED");
    const ok = saveFollowUpPlan(db, { participantId: ana.id, proposal: { decision: "ADJUST", nineX: "HIGH", nineY: "MID", note: "Entregou acima no 2º trimestre" }, actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(ok.ok, true);
  });

  it("outro líder e a própria pessoa não conduzem o plano", () => {
    const { db } = consolidated();
    const ana = participantOf(db, "ana");
    const other = saveFollowUpPlan(db, { participantId: ana.id, meeting: { at: "2026-11-05T14:00" }, actorUserId: "u-marcos", scope: marcosScope }, openOptions);
    assert.equal(other.ok === false && other.code, "FORBIDDEN");
    const self = saveFollowUpPlan(db, { participantId: ana.id, meeting: { at: "2026-11-05T14:00" }, actorUserId: "u-ana", scope: anaScope }, openOptions);
    assert.equal(self.ok === false && self.code, "FORBIDDEN");
  });

  it("hora da conversa e prazo do PDI precisam ser válidos", () => {
    const { db } = consolidated();
    const ana = participantOf(db, "ana");
    assert.equal(saveFollowUpPlan(db, { participantId: ana.id, meeting: { at: "05/11 14h" }, actorUserId: "rh", scope: hrScope }, openOptions).ok, false);
    assert.equal(saveFollowUpPlan(db, { participantId: ana.id, draft: { pdiDueAt: "2027-13-40" }, actorUserId: "rh", scope: hrScope }, openOptions).ok, false);
  });

});

describe("avisos de Minha equipe", () => {
  it("ciclo inativo explica por que a avaliação não aparece; sem vínculo, avisa", () => {
    const open = openCycle();
    const db = structuredClone(open.db) as PerformanceDatabase;
    db.cycles.find((c) => c.id === open.cycleId)!.activation = "INACTIVE";
    const notices = teamNotices(db, "bruno", NOW);
    assert.equal(notices.inactiveCycles.length, 1);
    assert.ok(notices.inactiveCycles[0]!.tasks >= 1);
    assert.equal(teamNotices(emptyPerformanceDatabase(), null, NOW).linked, false);
  });

  it("conta as avaliações de liderado pendentes e a própria etapa", () => {
    const open = openCycle();
    const notices = teamNotices(open.db, "bruno", NOW);
    assert.ok(notices.pendingLeader >= 1);
    const anaNotices = teamNotices(open.db, "ana", NOW);
    assert.equal(anaNotices.myJourney?.kind, "SELF");
    assert.equal(anaNotices.myJourney?.open, true);
  });
});
