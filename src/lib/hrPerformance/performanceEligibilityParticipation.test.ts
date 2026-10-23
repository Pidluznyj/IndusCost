/**
 * Participação na pesquisa 180° separada da homologação do resultado.
 * O período mínimo é o do ciclo (`minObservationDays`), nunca um segundo 90 fixo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyAbsenceSignal,
  classifyEligibility,
  historyManagerChanged,
  historyRoleOrSectorChanged,
  participationHeadline,
  planSurveyTasks,
  surveyTaskSummary,
} from "./performanceDomain.js";
import { teamPerspective, PROPOSED_LEADERSHIP_RULES } from "./performanceLeadership.js";
import { createLeadershipModel, ensureLeadershipAssignments } from "./performanceLeadershipService.js";
import {
  applyParticipants,
  createCycle,
  createDraftModel,
  issueInvite,
  issueInvitesBatch,
  publishModel,
  reclassifyPreparedParticipants,
  transitionCycle,
} from "./performanceService.js";
import type { PerformanceDatabase } from "./performanceState.js";
import { emptyPerformanceDatabase } from "./performanceState.js";
import { afastado, ana, hrScope, inativo, must, NOW, openCycle, openOptions, participantOf, person, assignmentOf } from "./performanceTestFixtures.js";

const asOf = NOW;
const old = new Date("2024-01-10T12:00:00.000Z");
const base = {
  asOf,
  absenceOverlapsReference: false,
  roleChangedInsideWindow: false,
  exceptionReason: null as string | null,
};

describe("participação da pesquisa 180°", () => {
  it("1. CLT ativo além do mínimo do ciclo, sem alterações, está apto", () => {
    const decision = classifyEligibility({ ...base, employee: person("clt", "CLT", { admissionDate: old, contractType: "CLT" }), minObservationDays: 45 });
    assert.equal(decision.state, "ELIGIBLE");
    assert.equal(participationHeadline({ eligibility: decision.state, reason: decision.reason }).label, "Apto para participar");
    assert.doesNotMatch(decision.reason, /experiência CLT|Mudança de/);
  });

  it("2. PJ ativo cumpre o período de observação do ciclo, sem contrato de experiência", () => {
    const decision = classifyEligibility({
      ...base,
      employee: person("pj", "PJ", { admissionDate: old, contractType: "PJ" }),
      minObservationDays: 45,
    });
    assert.equal(decision.state, "ELIGIBLE");
    assert.match(decision.reason, /prestação de serviços/);
    assert.doesNotMatch(decision.reason, /experiência/);
  });

  it("3, 4 e 5. promoção, transferência e troca de gestor não tiram quem já cumpriu o período", () => {
    const employee = person("ativo", "Ativo", { admissionDate: old });
    for (const extra of [
      { roleChangedInsideWindow: true, managerChangedInsideWindow: false },
      { roleChangedInsideWindow: true, managerChangedInsideWindow: false },
      { roleChangedInsideWindow: false, managerChangedInsideWindow: true },
    ]) {
      const decision = classifyEligibility({ ...base, employee, minObservationDays: 45, ...extra });
      assert.equal(decision.state, "ELIGIBLE");
      assert.equal(participationHeadline({ eligibility: decision.state, reason: decision.reason }).label, "Participa — revisão de RH");
    }
    assert.equal(historyRoleOrSectorChanged({ previousRoleId: "a", newRoleId: "b", previousDepartmentId: "d", newDepartmentId: "d" }), true);
    assert.equal(historyRoleOrSectorChanged({ previousDepartment: "Produção", newDepartment: "Manutenção" }), true);
    assert.equal(historyManagerChanged({ previousManagerId: "sidney", newManagerId: "sidney" }), false);
    assert.equal(historyManagerChanged({ previousManagerId: "sidney", newManagerId: "outro" }), true);
  });

  it("6 e 7. topo não avalia superior; líder intermediário faz as três tarefas", () => {
    const top = planSurveyTasks({ participates: true, hasSuperior: false, isLeader: true, leadershipModel: true });
    const middle = planSurveyTasks({ participates: true, hasSuperior: true, isLeader: true, leadershipModel: true });
    assert.deepEqual(top, { self: true, upward: false, leadershipSelf: true });
    assert.match(surveyTaskSummary(top, true), /Sem tarefa de avaliar um superior/);
    assert.deepEqual(middle, { self: true, upward: true, leadershipSelf: true });
    assert.equal(participationHeadline({ eligibility: "ELIGIBLE", reason: "Vínculo ativo com o período mínimo do ciclo cumprido." }).label, "Apto para participar");
  });

  it("8. desligado não participa", () => {
    const decision = classifyEligibility({ ...base, employee: person("off", "Off", { status: "INACTIVE", terminationDate: NOW }), minObservationDays: 45 });
    assert.equal(decision.state, "NOT_ELIGIBLE");
    assert.equal(participationHeadline({ eligibility: decision.state, reason: decision.reason }).label, "Vínculo inativo");
  });

  it("9. ainda no período mínimo configurado no ciclo, sem um segundo 90", () => {
    const hired = new Date("2026-09-20T12:00:00.000Z");
    const inside = classifyEligibility({ ...base, employee: person("novo", "Novo", { admissionDate: hired }), minObservationDays: 45 });
    const done = classifyEligibility({ ...base, employee: person("novo", "Novo", { admissionDate: hired }), minObservationDays: 20 });
    assert.equal(inside.state, "NOT_ELIGIBLE");
    assert.match(inside.reason, /O ciclo pede 45 dia/);
    assert.equal(participationHeadline({ eligibility: inside.state, reason: inside.reason }).label, "Em período inicial");
    assert.equal(done.state, "ELIGIBLE");
  });

  it("10. cadastro ativo sem data inicial participa e o resultado espera o RH", () => {
    const decision = classifyEligibility({ ...base, employee: person("sem", "Sem data", { admissionDate: null }), minObservationDays: 90 });
    assert.equal(decision.state, "ELIGIBLE");
    assert.match(decision.reason, /sem data inicial/);
    assert.equal(participationHeadline({ eligibility: decision.state, reason: decision.reason }).label, "Participa — revisão de RH");
  });

  it("11. afastamento encerrado observa; afastamento vigente adia só o lote", () => {
    const ended = classifyEligibility({ ...base, employee: person("fim", "Fim", { admissionDate: old }), minObservationDays: 45, endedAbsenceInWindow: true });
    const current = classifyEligibility({ ...base, employee: person("agora", "Agora", { admissionDate: old }), minObservationDays: 45, absenceOverlapsReference: true });
    assert.equal(ended.state, "ELIGIBLE");
    assert.match(ended.reason, /já encerrado/);
    assert.equal(current.state, "ELIGIBLE");
    assert.match(current.reason, /vigente/);
    assert.equal(classifyAbsenceSignal({ endDate: new Date("2026-09-30"), actualReturn: null }, asOf), "ENDED");
    assert.equal(classifyAbsenceSignal({ endDate: null, actualReturn: null }, asOf), "CURRENT");
  });

  it("12, 6 e 7. tarefas 180° nascem uma vez e o topo não recebe superior fictício", () => {
    let db: PerformanceDatabase = emptyPerformanceDatabase();
    const individual = must(createDraftModel(db, { name: "Base", actorUserId: "rh", scope: hrScope }, openOptions));
    db = must(publishModel(individual.db, { modelId: individual.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const leadership = must(createLeadershipModel(db, { name: "180", actorUserId: "rh", scope: hrScope }, openOptions));
    db = must(publishModel(leadership.db, { modelId: leadership.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const cycle = must(
      createCycle(
        db,
        {
          name: "Ciclo 180",
          periodLabel: "2026",
          modelId: individual.value.modelId,
          leadershipModelId: leadership.value.modelId,
          selfDueAt: "2026-11-15",
          leaderDueAt: "2026-11-30",
          actorUserId: "rh",
          classification: "OFFICIAL",
          scope: hrScope,
        },
        openOptions
      )
    );
    const paulo = person("paulo", "Paulo Diretor", { managerId: null, managerName: null, managerSource: "TOPO", admissionDate: old });
    const jose = person("jose", "José Líder", { managerId: "paulo", managerName: "Paulo Diretor", admissionDate: old });
    const equipe = person("equipe", "Equipe", { managerId: "jose", managerName: "José Líder", admissionDate: old });
    db = must(
      applyParticipants(
        cycle.db,
        {
          cycleId: cycle.value.cycleId,
          employees: [paulo, jose, equipe],
          selectedIds: ["paulo", "jose", "equipe"],
          exceptions: {},
          absenceIds: [],
          roleChangeIds: ["jose"],
          actorUserId: "rh",
          scope: hrScope,
        },
        openOptions
      )
    ).db;
    assert.equal(participantOf(db, "paulo").managerId, null);
    assert.equal(participantOf(db, "paulo").managerSource, "TOPO");
    assert.equal(participantOf(db, "jose").eligibility, "ELIGIBLE");
    assert.match(participantOf(db, "jose").eligibilityReason, /Mudança de função/);
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    const snapshot = { paulo: { directReportIds: ["jose"] }, jose: { directReportIds: ["equipe"] } };
    db = must(
      transitionCycle(db, { cycleId: cycle.value.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, leadershipSnapshot: snapshot, scope: hrScope }, openOptions)
    ).db;
    const kinds = (id: string) =>
      db.assignments
        .filter((a) => a.active && db.participants.find((p) => p.id === a.participantId)?.employeeId === id)
        .map((a) => a.kind)
        .sort();
    assert.deepEqual(kinds("paulo"), ["LEADERSHIP_SELF", "SELF"]);
    assert.deepEqual(kinds("jose"), ["LEADER", "LEADERSHIP_SELF", "LEADERSHIP_SUPERIOR", "LEADERSHIP_UPWARD", "SELF"]);
    assert.ok(kinds("equipe").includes("LEADERSHIP_UPWARD"));
    const before = db.assignments.map((a) => a.id).sort();
    const upward = db.assignments.find((a) => a.kind === "LEADERSHIP_UPWARD" && a.active)!;
    upward.status = "SUBMITTED";
    const cycleRow = db.cycles.find((c) => c.id === cycle.value.cycleId)!;
    const again = ensureLeadershipAssignments(db, cycleRow, NOW);
    assert.deepEqual(again, { upward: 0, self: 0, superior: 0 });
    assert.deepEqual(db.assignments.map((a) => a.id).sort(), before);
    assert.equal(upward.status, "SUBMITTED");
    assert.equal(upward.active, true);
  });

  it("13. amostra menor que o mínimo não revela nota individual da equipe", () => {
    const hidden = teamPerspective([[{ questionCode: "L1", kind: "score", score: 4 }]], PROPOSED_LEADERSHIP_RULES, ["L1"]);
    assert.equal(hidden.disclosed, false);
    assert.equal(hidden.competencies[0]!.mean, null);
    assert.equal(JSON.stringify(hidden).includes("evidence"), false);
  });

  it("14. resultado sem calibração não homologa, mesmo com participação apta", () => {
    const draft = must(createDraftModel(emptyPerformanceDatabase(), { name: "Base", actorUserId: "rh", scope: hrScope }, openOptions));
    let db = must(publishModel(draft.db, { modelId: draft.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const cycle = must(
      createCycle(db, { name: "Ciclo", periodLabel: "2026", modelId: draft.value.modelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30", actorUserId: "rh", classification: "OFFICIAL", scope: hrScope }, openOptions)
    );
    const promoted = person("promo", "Promovido", { admissionDate: old });
    db = must(
      applyParticipants(cycle.db, { cycleId: cycle.value.cycleId, employees: [promoted], selectedIds: ["promo"], exceptions: {}, absenceIds: [], roleChangeIds: ["promo"], actorUserId: "rh", scope: hrScope }, openOptions)
    ).db;
    const leader = participantOf(db, "promo");
    leader.managerId = "rh-lider";
    leader.managerName = "Líder";
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    const blocked = transitionCycle(db, { cycleId: cycle.value.cycleId, to: "HOMOLOGATED", actorUserId: "rh", reversalReason: null, canHomologate: true, scope: hrScope }, openOptions);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.ok === false && blocked.code, "CALIBRATION_REQUIRED");
  });

  it("14b. sem data inicial o resultado não homologa", () => {
    const draft = must(createDraftModel(emptyPerformanceDatabase(), { name: "Base", actorUserId: "rh", scope: hrScope }, openOptions));
    let db = must(publishModel(draft.db, { modelId: draft.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const cycle = must(
      createCycle(db, { name: "Ciclo", periodLabel: "2026", modelId: draft.value.modelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30", actorUserId: "rh", classification: "OFFICIAL", scope: hrScope }, openOptions)
    );
    const semData = person("sem", "Sem data", { admissionDate: null, managerId: null, managerName: null, managerSource: "TOPO" });
    db = must(
      applyParticipants(cycle.db, { cycleId: cycle.value.cycleId, employees: [semData], selectedIds: ["sem"], exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions)
    ).db;
    assert.equal(participantOf(db, "sem").eligibility, "ELIGIBLE");
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId: cycle.value.cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    const blocked = transitionCycle(db, { cycleId: cycle.value.cycleId, to: "HOMOLOGATED", actorUserId: "rh", reversalReason: null, canHomologate: true, scope: hrScope }, openOptions);
    assert.equal(blocked.ok === false && blocked.code, "TENURE_VALIDATION_REQUIRED");
  });

  it("15. reclassifica rascunho com diagnóstico e recusa ciclo aberto, homologado e resposta enviada", () => {
    const published = must(createDraftModel(emptyPerformanceDatabase(), { name: "Base", actorUserId: "rh", scope: hrScope }, openOptions));
    let db = must(publishModel(published.db, { modelId: published.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const cycle = must(
      createCycle(db, { name: "Ciclo", periodLabel: "2026", modelId: published.value.modelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30", actorUserId: "rh", classification: "OFFICIAL", scope: hrScope }, openOptions)
    );
    db = must(
      applyParticipants(
        cycle.db,
        { cycleId: cycle.value.cycleId, employees: [ana], selectedIds: ["ana"], exceptions: {}, absenceIds: [], roleChangeIds: ["ana"], actorUserId: "rh", scope: hrScope },
        openOptions
      )
    ).db;
    const row = participantOf(db, "ana");
    row.eligibility = "INSUFFICIENT_EVIDENCE";
    row.eligibilityReason = "Mudança de função ou setor no período. Exige leitura do RH.";
    const answerId = "resp-antiga";
    db.answers.push({ id: answerId, assignmentId: "tarefa", questionCode: "DT-01", pillar: "TECHNICAL", kind: "score", score: 3, evidence: "preservar" });
    const diagnosed = must(
      reclassifyPreparedParticipants(
        db,
        { cycleId: cycle.value.cycleId, employees: [ana], absenceIds: [], roleChangeIds: ["ana"], actorUserId: "rh", scope: hrScope },
        openOptions
      )
    );
    assert.equal(diagnosed.value.changed, 1);
    assert.equal(diagnosed.value.rows[0]!.before, "INSUFFICIENT_EVIDENCE");
    assert.equal(diagnosed.value.rows[0]!.after, "ELIGIBLE");
    assert.equal(participantOf(diagnosed.db, "ana").eligibility, "ELIGIBLE");
    assert.equal(diagnosed.db.answers.find((a) => a.id === answerId)!.evidence, "preservar");
    assert.ok(diagnosed.db.audits.some((a) => a.action === "PARTICIPANTS_RECLASSIFIED"));

    const opened = openCycle();
    const beforeOpen = participantOf(opened.db, "ana").eligibility;
    const refused = reclassifyPreparedParticipants(opened.db, { cycleId: opened.cycleId, employees: [ana], absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(refused.ok === false && refused.code, "CYCLE_STAGE");
    assert.equal(participantOf(opened.db, "ana").eligibility, beforeOpen);

    diagnosed.db.cycles.find((c) => c.id === cycle.value.cycleId)!.status = "HOMOLOGATED";
    const frozen = reclassifyPreparedParticipants(diagnosed.db, { cycleId: cycle.value.cycleId, employees: [ana], absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(frozen.ok === false && frozen.code, "CYCLE_FROZEN");
  });

  it("convite em lote espera o retorno; o convite individual continua da própria pessoa", () => {
    const opened = openCycle();
    assert.equal(participantOf(opened.db, "afastado").eligibility, "ELIGIBLE");
    assert.equal(participantOf(opened.db, "inativo").eligibility, "NOT_ELIGIBLE");
    assert.equal(opened.db.assignments.some((a) => a.employeeId === "inativo" && a.active), false);
    const batch = must(issueInvitesBatch(opened.db, { cycleId: opened.cycleId, participantIds: null, onlyMissing: true, actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(batch.value.deferred >= 1, true);
    assert.equal(batch.value.issued.some((invite) => invite.employeeName === afastado.name), false);
    const self = assignmentOf(batch.db, "afastado", "SELF");
    assert.equal(self.evaluatorEmployeeId, "afastado");
    const one = must(issueInvite(batch.db, { assignmentId: self.id, actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(one.value.employeeName, afastado.name);
  });
});
