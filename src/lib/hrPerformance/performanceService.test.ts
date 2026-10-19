import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPerformanceScope } from "./performanceAccess.js";
import { PROPOSED_BASE_QUESTIONS, PROPOSED_RULES, UNCLASSIFIED_QUADRANT } from "./performanceDomain.js";
import { calibrationQueue, dashboardCounts, describeCycle, employeeHistory, pdiTracking, reportData } from "./performanceInsights.js";
import { emptyPerformanceDatabase, type PerformanceDatabase } from "./performanceState.js";
import {
  acknowledgeFeedback,
  addCheckin,
  applyParticipants,
  archiveModel,
  calibrate,
  claimAssisted,
  createCycle,
  createDraftModel,
  createFeedback,
  createPdi,
  dispatchReminders,
  duplicateModel,
  exchangeLink,
  issueInvite,
  issueInvitesBatch,
  issueReport,
  leaderQueue,
  moveDraftQuestion,
  openAssisted,
  planReminders,
  publicForm,
  publicLogout,
  publicSave,
  publicSubmit,
  publishModel,
  readLeaderForm,
  reassignLeader,
  recordConduct,
  removeParticipant,
  returnForRevision,
  revokeInvite,
  saveAnswers,
  setEligibilityException,
  submitAssignment,
  transitionCycle,
  updateCycle,
  updateDraftQuestion,
  updateModelDraft,
  updatePdiStatus,
  validateTechnical,
  verifyOtp,
} from "./performanceService.js";
import {
  NOW,
  allAnswers,
  ana,
  anaScope,
  assignmentOf,
  blockedOptions,
  brunoScope,
  draftCycle,
  hrScope,
  marcosScope,
  must,
  openCycle,
  openOptions,
  participantOf,
  submitLeader,
  submitSelf,
} from "./performanceTestFixtures.js";

const tokenOf = (url: string) => decodeURIComponent(new URL(url).hash.slice(3));

/** Ciclo aberto → Ana responde, Bruno avalia, RH valida e calibra todos os elegíveis e homologa. */
function homologatedCycle() {
  const open = openCycle();
  let db = submitSelf(open.db, "ana", 4);
  db = submitLeader(db, "ana", (code) => (code.startsWith("PO") ? 4 : 3));
  db = submitSelf(db, "bia", 3);
  db = submitLeader(db, "bia", 3);
  db = must(transitionCycle(db, { cycleId: open.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
  db = must(transitionCycle(db, { cycleId: open.cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
  for (const employeeId of ["ana", "bia", "semlider", "otavio"]) {
    const participant = participantOf(db, employeeId);
    const result = db.results.find((r) => r.participantId === participant.id && r.active)!;
    if (result.technicalValidation === "PENDING_VALIDATION") {
      db = must(validateTechnical(db, { participantId: participant.id, decision: "VALIDATED", note: "Padrão da função conferido no posto.", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    }
    db = must(calibrate(db, { participantId: participant.id, note: "Leitura do RH sem ajuste de posição.", actorUserId: "rh", actorEmployeeId: null, scope: hrScope }, openOptions)).db;
  }
  db = must(transitionCycle(db, { cycleId: open.cycleId, to: "HOMOLOGATED", actorUserId: "rh", reversalReason: null, canHomologate: true, scope: hrScope }, openOptions)).db;
  return { ...open, db };
}

describe("modelos", () => {
  it("nasce com 12 perguntas, 4 por pilar, competência e regras propostas", () => {
    const created = must(createDraftModel(emptyPerformanceDatabase(), { name: "Modelo", actorUserId: "rh", scope: hrScope }, openOptions));
    const questions = created.db.questions;
    assert.equal(questions.length, 12);
    for (const pillar of ["TECHNICAL", "CULTURE", "POTENTIAL"]) assert.equal(questions.filter((q) => q.pillar === pillar).length, 4);
    assert.deepEqual(
      questions.filter((q) => q.pillar === "TECHNICAL").map((q) => q.competency),
      ["Qualidade", "Produtividade", "Conhecimento técnico", "Responsabilidade operacional"]
    );
    assert.equal(created.db.models[0]!.rules.nineBoxLowCut, 250);
    assert.equal(created.db.models[0]!.status, "DRAFT");
  });

  it("edita, reordena dentro do pilar, valida regras e não altera versão publicada", () => {
    let db = must(createDraftModel(emptyPerformanceDatabase(), { name: "Modelo", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const modelId = db.models[0]!.id;
    db = must(updateDraftQuestion(db, { modelId, code: "DT-02", competency: "Ritmo combinado", selfText: "Eu entrego no ritmo combinado com o líder.", leaderText: "Entrega no ritmo combinado com o líder.", hint: "Considere a meta do turno.", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    assert.equal(db.questions.find((q) => q.code === "DT-02")!.competency, "Ritmo combinado");
    const duplicate = updateDraftQuestion(db, { modelId, code: "DT-03", selfText: "Eu entrego no ritmo combinado com o líder.", leaderText: "Texto do líder diferente.", hint: null, actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(duplicate.ok === false && duplicate.code, "DUPLICATE_QUESTION");
    db = must(moveDraftQuestion(db, { modelId, code: "DT-02", direction: "up", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const order = db.questions.filter((q) => q.modelId === modelId).sort((a, b) => a.sortOrder - b.sortOrder).map((q) => q.code);
    assert.deepEqual(order.slice(0, 2), ["DT-02", "DT-01"]);
    const edge = moveDraftQuestion(db, { modelId, code: "DT-04", direction: "down", actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(edge.ok === false && edge.code, "EDGE_OF_PILLAR");
    const badRules = updateModelDraft(db, { modelId, rules: { ...PROPOSED_RULES, nineBoxLowCut: 360 }, actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(badRules.ok === false && badRules.code, "INVALID_RULES");
    db = must(updateModelDraft(db, { modelId, rules: { ...PROPOSED_RULES, ruleSetId: "piloto-2026", nineBoxHighCut: 340 }, instructions: "Pense nos últimos seis meses de trabalho.", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    db = must(publishModel(db, { modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const locked = updateDraftQuestion(db, { modelId, code: "DT-01", selfText: "Texto novo suficiente", leaderText: "Texto novo do líder", hint: null, actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(locked.ok === false && locked.code, "MODEL_LOCKED");
    const copy = must(duplicateModel(db, { modelId, actorUserId: "rh", scope: hrScope }, openOptions));
    const v2 = copy.db.models.find((m) => m.id === copy.value.modelId)!;
    assert.equal(v2.version, 2);
    assert.equal(v2.status, "DRAFT");
    assert.equal(v2.rules.nineBoxHighCut, 340);
    assert.equal(copy.db.questions.filter((q) => q.modelId === modelId).length, 12);
    const forbidden = createDraftModel(db, { name: "Modelo do líder", actorUserId: "u", scope: brunoScope }, openOptions);
    assert.equal(forbidden.ok === false && forbidden.code, "FORBIDDEN");
  });

  it("não inativa modelo de ciclo em andamento", () => {
    const draft = draftCycle();
    const archived = archiveModel(draft.db, { modelId: draft.modelId, actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(archived.ok === false && archived.code, "MODEL_IN_USE");
  });
});

describe("ciclo, participantes e elegibilidade", () => {
  it("classifica, não duplica, remove sem apagar e aplica exceção justificada", () => {
    const draft = draftCycle();
    assert.equal(draft.counts.eligible, 4);
    assert.equal(draft.counts.notEligible, 2);
    assert.equal(draft.counts.insufficient, 1);
    const again = must(applyParticipants(draft.db, { cycleId: draft.cycleId, employees: [ana], selectedIds: ["ana", "fantasma"], exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(again.value.duplicates, 1);
    assert.equal(again.value.missing, 1);
    assert.equal(again.db.participants.filter((p) => p.employeeId === "ana").length, 1);
    const recem = participantOf(draft.db, "recem");
    assert.match(recem.eligibilityReason, /Mínimo proposto: 90/);
    const shortReason = setEligibilityException(draft.db, { participantId: recem.id, reason: "curta", actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(shortReason.ok === false && shortReason.code, "NOTE_REQUIRED");
    let db = must(setEligibilityException(draft.db, { participantId: recem.id, reason: "Veio transferido com 2 anos na outra unidade.", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    assert.equal(participantOf(db, "recem").eligibility, "ELIGIBLE");
    const inativo = participantOf(db, "inativo");
    const reopen = must(setEligibilityException(db, { participantId: inativo.id, reason: "Tentativa de reabrir convite.", actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(participantOf(reopen.db, "inativo").eligibility, "NOT_ELIGIBLE");
    db = must(removeParticipant(db, { participantId: inativo.id, reason: "Desligado", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const removed = db.participants.find((p) => p.id === inativo.id)!;
    assert.ok(removed.removedAt);
    assert.equal(db.participants.length, draft.db.participants.length, "remoção é lógica");
    const back = must(applyParticipants(db, { cycleId: draft.cycleId, employees: [ana], selectedIds: ["ana"], exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(back.value.duplicates, 1);
  });

  it("valida prazos, audita mudança de prazo e troca líder por pessoa do cadastro com motivo", () => {
    const draft = draftCycle();
    const bad = createCycle(draft.db, { name: "Ciclo", periodLabel: "S1", modelId: draft.modelId, selfDueAt: "2026-12-10", leaderDueAt: "2026-12-01", actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(bad.ok === false && bad.code, "INVALID_DATE");
    const updated = must(updateCycle(draft.db, { cycleId: draft.cycleId, name: "Ciclo 2026-S2", periodLabel: "2º semestre", selfDueAt: "2026-11-20", leaderDueAt: "2026-12-05", reason: null, actorUserId: "rh", scope: hrScope }, openOptions));
    const event = updated.db.audits.find((a) => a.action === "CYCLE_UPDATED")!;
    assert.equal(event.detail.selfDueFrom, "2026-11-15");
    assert.equal(event.detail.selfDueTo, "2026-11-20");
    const fabi = participantOf(draft.db, "semlider");
    const noReason = reassignLeader(draft.db, { participantId: fabi.id, managerId: "bruno", managerName: "Bruno Líder", reason: "", actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(noReason.ok === false && noReason.code, "NOTE_REQUIRED");
    const self = reassignLeader(draft.db, { participantId: fabi.id, managerId: "semlider", managerName: "Fabi", reason: "Tentativa de se avaliar.", actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(self.ok === false && self.code, "SELF_EVALUATOR");
    const done = must(reassignLeader(draft.db, { participantId: fabi.id, managerId: "bruno", managerName: "Bruno Líder", reason: "Cadastro sem gestor; Bruno acompanha o turno.", actorUserId: "rh", scope: hrScope }, openOptions));
    const after = participantOf(done.db, "semlider");
    assert.equal(after.managerId, "bruno");
    assert.equal(after.managerSource, "RH");
  });

  it("abre só com confirmação de piloto, cria tarefas só para elegíveis e congela participantes", () => {
    const draft = draftCycle();
    const prepared = must(transitionCycle(draft.db, { cycleId: draft.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hrScope }, blockedOptions));
    const blocked = transitionCycle(prepared.db, { cycleId: draft.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, scope: hrScope }, blockedOptions);
    assert.equal(blocked.ok === false && blocked.code, "GOVERNANCE_BLOCKED");
    const reversalNoReason = transitionCycle(prepared.db, { cycleId: draft.cycleId, to: "DRAFT", actorUserId: "rh", reversalReason: "curto", scope: hrScope }, blockedOptions);
    assert.equal(reversalNoReason.ok === false && reversalNoReason.code, "NOTE_REQUIRED");
    const opened = must(transitionCycle(prepared.db, { cycleId: draft.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, pilotAck: true, scope: hrScope }, blockedOptions));
    assert.equal(opened.db.audits.some((a) => a.action === "PILOT_OPEN"), true);
    const selfTasks = opened.db.assignments.filter((a) => a.kind === "SELF");
    const leaderTasks = opened.db.assignments.filter((a) => a.kind === "LEADER");
    assert.deepEqual(selfTasks.map((a) => a.employeeId).sort(), ["ana", "bia", "otavio", "semlider"]);
    assert.deepEqual(leaderTasks.map((a) => a.employeeId).sort(), ["ana", "bia", "otavio"], "sem líder não ganha tarefa gerencial");
    assert.equal(opened.db.answers.length, (selfTasks.length + leaderTasks.length) * 12);
    const frozen = applyParticipants(opened.db, { cycleId: draft.cycleId, employees: [ana], selectedIds: ["ana"], exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(frozen.ok === false && frozen.code, "CYCLE_FROZEN");
    const exception = setEligibilityException(opened.db, { participantId: participantOf(opened.db, "recem").id, reason: "Exceção tardia demais.", actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(exception.ok === false && exception.code, "CYCLE_FROZEN");
  });
});

describe("convites e portal", () => {
  it("QR sozinho não abre, 5 erros bloqueiam, reemissão revoga e o lote não reemite convite ativo", () => {
    const open = openCycle();
    const self = assignmentOf(open.db, "ana", "SELF");
    const issued = must(issueInvite(open.db, { assignmentId: self.id, actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(issued.db.invites.some((i) => i.linkDigest === tokenOf(issued.value.url)), false, "token não fica em claro");
    assert.ok(issued.value.expiresAt <= "2026-11-16T03:00:00.000Z", "convite não passa do prazo da pessoa");
    const exchanged = must(exchangeLink(issued.db, { token: tokenOf(issued.value.url) }, openOptions));
    assert.equal(publicForm(exchanged.db, { sessionToken: exchanged.value.sessionToken }, openOptions).ok, false);
    let db = exchanged.db;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = verifyOtp(db, { sessionToken: exchanged.value.sessionToken, otp: "000000" }, openOptions);
      assert.equal(failed.ok, false);
      db = failed.db ?? db;
    }
    assert.equal(db.invites.find((i) => i.id === issued.value.inviteId)!.locked, true);
    assert.equal(verifyOtp(db, { sessionToken: exchanged.value.sessionToken, otp: issued.value.otp }, openOptions).ok, false, "bloqueado nem com o código certo");
    const reissued = must(issueInvite(db, { assignmentId: self.id, actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(exchangeLink(reissued.db, { token: tokenOf(issued.value.url) }, openOptions).ok, false, "convite anterior revogado");
    const batch = must(issueInvitesBatch(reissued.db, { cycleId: open.cycleId, participantIds: null, onlyMissing: true, actorUserId: "rh", scope: hrScope }, openOptions));
    assert.deepEqual(batch.value.issued.map((i) => i.employeeName).sort(), ["Bia Operadora", "Fabi Sem Líder", "Otávio Manutenção"]);
    assert.equal(batch.value.skipped, 1);
    const revoked = must(revokeInvite(batch.db, { assignmentId: self.id, reason: "Folha perdida", actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(exchangeLink(revoked.db, { token: tokenOf(reissued.value.url) }, openOptions).ok, false);
    const leaderTry = issueInvite(open.db, { assignmentId: self.id, actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(leaderTry.ok === false && leaderTry.code, "FORBIDDEN");
  });

  it("salva por resposta, retoma, detecta versão velha, envia uma vez e encerra a sessão", () => {
    const open = openCycle();
    const self = assignmentOf(open.db, "ana", "SELF");
    const issued = must(issueInvite(open.db, { assignmentId: self.id, actorUserId: "rh", scope: hrScope }, openOptions));
    const link = must(exchangeLink(issued.db, { token: tokenOf(issued.value.url) }, openOptions));
    const verified = must(verifyOtp(link.db, { sessionToken: link.value.sessionToken, otp: issued.value.otp }, openOptions));
    const session = verified.value.sessionToken;
    const form = must(publicForm(verified.db, { sessionToken: session }, openOptions));
    assert.equal(form.value.questions.length, 12);
    assert.equal(form.value.employeeName, "Ana", "portal mostra só o primeiro nome");
    assert.ok(form.value.instructions.length > 10);
    const first = must(publicSave(verified.db, { sessionToken: session, expectedVersion: form.value.version, answers: [{ code: "DT-01", answer: { kind: "notObserved" } }] }, openOptions));
    const stale = publicSave(first.db, { sessionToken: session, expectedVersion: form.value.version, answers: [{ code: "DT-02", answer: { kind: "score", score: 2 } }] }, openOptions);
    assert.equal(stale.ok === false && stale.code, "VERSION_CONFLICT");
    const resumed = must(publicForm(first.db, { sessionToken: session }, openOptions));
    assert.equal(resumed.value.answers.find((a) => a.questionCode === "DT-01")!.kind, "notObserved");
    assert.equal(resumed.value.answers.find((a) => a.questionCode === "DT-02")!.kind, "pending", "nada vem pré-selecionado");
    const incomplete = publicSubmit(first.db, { sessionToken: session, expectedVersion: resumed.value.version, confirm: true }, openOptions);
    assert.equal(incomplete.ok === false && incomplete.code, "INCOMPLETE");
    const rest = allAnswers(3).filter((a) => a.code !== "DT-01");
    const saved = must(publicSave(first.db, { sessionToken: session, expectedVersion: resumed.value.version, answers: rest }, openOptions));
    const done = must(publicSubmit(saved.db, { sessionToken: session, expectedVersion: saved.value.version, confirm: true }, openOptions));
    assert.equal(publicForm(done.db, { sessionToken: session }, openOptions).ok, false, "sessão encerrada após o envio");
    assert.equal(publicSubmit(done.db, { sessionToken: session, expectedVersion: 99, confirm: true }, openOptions).ok, false);
    const scores = done.db.answers.filter((a) => a.assignmentId === self.id);
    assert.equal(scores.find((a) => a.questionCode === "DT-01")!.score, null, "não sei não vira zero");
    const result = done.db.results.find((r) => r.active)!;
    assert.equal(result.quadrant, UNCLASSIFIED_QUADRANT, "sem líder não há quadrante");
    assert.equal(result.technicalValidation, "INSUFFICIENT");
  });

  it("modo assistido exige motivo, troca o token de abertura, pede confirmação e preserva a autoria", () => {
    const open = openCycle();
    const self = assignmentOf(open.db, "ana", "SELF");
    const noReason = openAssisted(open.db, { assignmentId: self.id, assistantUserId: "u-rh", actorEmployeeId: null, reason: "", scope: hrScope }, openOptions);
    assert.equal(noReason.ok === false && noReason.code, "NOTE_REQUIRED");
    const opened = must(openAssisted(open.db, { assignmentId: self.id, assistantUserId: "u-rh", actorEmployeeId: null, reason: "Sem celular; preenchimento no tablet do RH.", scope: hrScope }, openOptions));
    const claimed = must(claimAssisted(opened.db, { token: opened.value.sessionToken }, openOptions));
    assert.equal(claimAssisted(claimed.db, { token: opened.value.sessionToken }, openOptions).ok, false, "o token da URL só vale uma vez");
    const session = claimed.value.sessionToken;
    const form = must(publicForm(claimed.db, { sessionToken: session }, openOptions));
    assert.equal(form.value.assisted, true);
    const saved = must(publicSave(claimed.db, { sessionToken: session, expectedVersion: form.value.version, answers: allAnswers(3) }, openOptions));
    const noConfirm = publicSubmit(saved.db, { sessionToken: session, expectedVersion: saved.value.version, confirm: false }, openOptions);
    assert.equal(noConfirm.ok === false && noConfirm.code, "ASSIST_CONFIRMATION");
    const done = must(publicSubmit(saved.db, { sessionToken: session, expectedVersion: saved.value.version, confirm: true }, openOptions));
    const task = done.db.assignments.find((a) => a.id === self.id)!;
    assert.equal(task.employeeId, "ana", "autoria continua da pessoa");
    assert.equal(task.assistedByUserId, "u-rh");
    assert.equal(done.db.audits.some((a) => a.action === "ASSISTED_OPENED" && a.detail.reason === "Sem celular; preenchimento no tablet do RH."), true);
  });

  it("sair encerra a sessão e coleta fechada revoga convites pendentes", () => {
    const open = openCycle();
    const self = assignmentOf(open.db, "bia", "SELF");
    const issued = must(issueInvite(open.db, { assignmentId: self.id, actorUserId: "rh", scope: hrScope }, openOptions));
    const link = must(exchangeLink(issued.db, { token: tokenOf(issued.value.url) }, openOptions));
    const verified = must(verifyOtp(link.db, { sessionToken: link.value.sessionToken, otp: issued.value.otp }, openOptions));
    const out = must(publicLogout(verified.db, { sessionToken: verified.value.sessionToken }, openOptions));
    assert.equal(publicForm(out.db, { sessionToken: verified.value.sessionToken }, openOptions).ok, false);
    const pending = transitionCycle(issued.db, { cycleId: open.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions);
    assert.equal(pending.ok === false && pending.code, "PENDING_ASSIGNMENTS");
    const closed = must(transitionCycle(issued.db, { cycleId: open.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions));
    assert.equal(closed.db.invites.every((i) => i.revokedAt), true);
    assert.equal(closed.db.audits.some((a) => a.action === "PENDING_ACCEPTED"), true);
    assert.equal(exchangeLink(closed.db, { token: tokenOf(issued.value.url) }, openOptions).ok, false);
  });
});

describe("liderança", () => {
  it("fila só com tarefas atribuídas, sem IDOR, evidência nas notas extremas e autoavaliação só depois do envio", () => {
    const open = openCycle();
    let db = submitSelf(open.db, "ana", 4);
    const queue = leaderQueue(db, brunoScope, "bruno");
    assert.deepEqual(queue.map((q) => q.employeeName).sort(), ["Ana Operadora", "Bia Operadora"]);
    assert.equal(leaderQueue(db, marcosScope, "marcos").map((q) => q.employeeName).join(), "Otávio Manutenção");
    const anaLeader = assignmentOf(db, "ana", "LEADER");
    assert.equal(readLeaderForm(db, anaLeader.id, marcosScope, "marcos").ok, false, "líder de outro setor não abre");
    const hidden = readLeaderForm(db, anaLeader.id, brunoScope, "bruno");
    assert.ok(hidden.ok && hidden.selfAnswers.length === 0, "autoavaliação oculta antes do envio do líder");
    const outsiderSave = saveAnswers(db, { assignmentId: anaLeader.id, expectedVersion: 1, answers: allAnswers(3), actorUserId: "u-marcos", scope: marcosScope }, openOptions);
    assert.equal(outsiderSave.ok === false && outsiderSave.code, "FORBIDDEN");
    const noEvidence = saveAnswers(db, { assignmentId: anaLeader.id, expectedVersion: 1, answers: [{ code: "DT-01", answer: { kind: "score", score: 1, evidence: "curto" } }], actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(noEvidence.ok === false && noEvidence.code, "EVIDENCE_REQUIRED");
    db = submitLeader(db, "ana", (code) => (code === "DT-01" ? 1 : 3));
    const released = readLeaderForm(db, anaLeader.id, brunoScope, "bruno");
    assert.ok(released.ok && released.selfAnswers.length === 12);
    assert.ok(released.ok && released.divergences.some((d) => d.questionCode === "DT-01" && d.gap === 3));
    assert.equal(released.ok && released.answers.find((a) => a.questionCode === "DT-01")!.evidence, "Exemplo observado no posto de trabalho.");
    const relocked = saveAnswers(db, { assignmentId: anaLeader.id, expectedVersion: 99, answers: allAnswers(2), actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(relocked.ok === false && relocked.code, "ASSIGNMENT_LOCKED", "finalizada não muda em silêncio");
  });

  it("autoavaliação enviada antes do líder não vira nota técnica; rascunho do líder não conta", () => {
    const open = openCycle();
    const anaLeader = assignmentOf(open.db, "ana", "LEADER");
    const draftScores = must(saveAnswers(open.db, { assignmentId: anaLeader.id, expectedVersion: 1, answers: allAnswers(3), actorUserId: "u-bruno", scope: brunoScope }, openOptions));
    const db = submitSelf(draftScores.db, "ana", 4);
    const result = db.results.find((r) => r.active)!;
    assert.equal(result.technicalCount, 0);
    assert.equal(result.technicalValidation, "INSUFFICIENT");
  });

  it("devolução para revisão cria nova versão com motivo e mantém a anterior; troca de líder preserva a enviada", () => {
    const open = openCycle();
    let db = submitSelf(open.db, "ana", 3);
    db = submitLeader(db, "ana", 3);
    const sent = assignmentOf(db, "ana", "LEADER");
    const returned = must(returnForRevision(db, { assignmentId: sent.id, reason: "Detalhar o exemplo da qualidade.", actorUserId: "rh", scope: hrScope }, openOptions));
    const current = assignmentOf(returned.db, "ana", "LEADER");
    assert.equal(current.status, "RETURNED");
    assert.equal(current.returnReason, "Detalhar o exemplo da qualidade.");
    assert.equal(current.revision, 2);
    assert.equal(returned.db.assignments.find((a) => a.id === sent.id)!.status, "SUBMITTED", "versão enviada fica preservada");
    assert.equal(leaderQueue(returned.db, brunoScope, "bruno").find((q) => q.employeeName === "Ana Operadora")!.returnReason, "Detalhar o exemplo da qualidade.");
    const reassigned = must(reassignLeader(returned.db, { participantId: participantOf(db, "ana").id, managerId: "carla", managerName: "Carla Gerente", reason: "Bruno saiu de férias longas.", actorUserId: "rh", scope: hrScope }, openOptions));
    const carla = assignmentOf(reassigned.db, "ana", "LEADER");
    assert.equal(carla.evaluatorEmployeeId, "carla");
    assert.equal(carla.supersedesId, current.id);
    assert.equal(reassigned.db.assignments.filter((a) => a.employeeId === "ana" && a.kind === "LEADER").length, 3);
    assert.equal(leaderQueue(reassigned.db, brunoScope, "bruno").some((q) => q.employeeName === "Ana Operadora"), false);
  });

  it("só o líder pode salvar na consolidação; a autoavaliação fecha com a coleta", () => {
    const open = openCycle();
    const db = must(transitionCycle(open.db, { cycleId: open.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    const self = assignmentOf(db, "ana", "SELF");
    const blocked = saveAnswers(db, { assignmentId: self.id, expectedVersion: 1, answers: allAnswers(3), actorUserId: null, scope: anaScope }, openOptions);
    assert.equal(blocked.ok === false && blocked.code, "COLLECTION_CLOSED");
    const leader = assignmentOf(db, "ana", "LEADER");
    assert.equal(saveAnswers(db, { assignmentId: leader.id, expectedVersion: 1, answers: allAnswers(3), actorUserId: "u-bruno", scope: brunoScope }, openOptions).ok, true);
  });
});

describe("cálculo, cultura, calibração e homologação", () => {
  it("cultura fica fora da Nine-Box e ocorrência não muda resultado", () => {
    const open = openCycle();
    let db = submitSelf(open.db, "ana", 3);
    db = submitSelf(db, "bia", 3);
    db = submitLeader(db, "ana", (code) => (code.startsWith("CU") ? 1 : 4));
    db = submitLeader(db, "bia", (code) => (code.startsWith("CU") ? 4 : 4));
    for (const id of ["ana", "bia"]) {
      db = must(validateTechnical(db, { participantId: participantOf(db, id).id, decision: "VALIDATED", note: "Padrão da função conferido.", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    }
    const anaResult = db.results.find((r) => r.participantId === participantOf(db, "ana").id && r.active)!;
    const biaResult = db.results.find((r) => r.participantId === participantOf(db, "bia").id && r.active)!;
    assert.equal(anaResult.quadrant, biaResult.quadrant, "cultura diferente, mesma posição");
    assert.equal(anaResult.cultureBand, "NEEDS_REVIEW");
    assert.equal(biaResult.cultureBand, "CONSISTENT");
    assert.equal(anaResult.ruleSnapshot?.nineBoxLowCut, 250);
    const before = db.results.filter((r) => r.active).map((r) => r.quadrant);
    const conduct = must(recordConduct(db, { employeeId: "ana", summary: "Relato ainda não apurado pelo RH.", actorUserId: "rh" }, openOptions));
    assert.deepEqual(conduct.db.results.filter((r) => r.active).map((r) => r.quadrant), before);
    const report = reportData(conduct.db, { cycleId: open.cycleId, kind: "individual", participantId: participantOf(db, "ana").id }, hrScope, NOW);
    assert.equal(JSON.stringify(report).includes("Relato ainda não apurado"), false, "ocorrência não vai para o PDF comum");
  });

  it("validação e ajuste de calibração versionam o resultado e exigem justificativa", () => {
    const open = openCycle();
    let db = submitSelf(open.db, "ana", 3);
    db = submitLeader(db, "ana", 3);
    db = must(transitionCycle(db, { cycleId: open.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId: open.cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    const anaId = participantOf(db, "ana").id;
    const early = calibrate(db, { participantId: anaId, note: "Sem validar ainda o técnico.", actorUserId: "rh", actorEmployeeId: null, scope: hrScope }, openOptions);
    assert.equal(early.ok === false && early.code, "VALIDATION_REQUIRED");
    db = must(validateTechnical(db, { participantId: anaId, decision: "VALIDATED", note: "Padrão da função conferido.", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const preliminary = db.results.find((r) => r.participantId === anaId && r.active)!;
    assert.equal(preliminary.quadrant, "Desempenho médio · Potencial médio");
    const noNote = calibrate(db, { participantId: anaId, note: "curto", decision: "ADJUST", technicalBand: "HIGH", potentialBand: "MID", actorUserId: "rh", actorEmployeeId: null, scope: hrScope }, openOptions);
    assert.equal(noNote.ok === false && noNote.code, "NOTE_REQUIRED");
    const self = calibrate(db, { participantId: anaId, note: "Quero me reposicionar.", actorUserId: "u-ana", actorEmployeeId: "ana", scope: hrScope }, openOptions);
    assert.equal(self.ok === false && self.code, "SELF_HOMOLOGATION");
    db = must(calibrate(db, { participantId: anaId, note: "Indicadores de refugo do semestre mostram entrega acima do padrão.", decision: "ADJUST", technicalBand: "HIGH", potentialBand: "MID", actorUserId: "rh", actorEmployeeId: null, scope: hrScope }, openOptions)).db;
    const versions = db.results.filter((r) => r.participantId === anaId).sort((a, b) => a.version - b.version);
    const last = versions.at(-1)!;
    assert.equal(last.adjusted, true);
    assert.equal(last.quadrant, "Desempenho alto · Potencial médio");
    assert.equal(last.supersedesId, versions.at(-2)!.id);
    assert.equal(versions.at(-2)!.quadrant, "Desempenho médio · Potencial médio", "original preservado");
    assert.equal(db.audits.some((a) => a.action === "RESULT_ADJUSTED"), true);
    const queue = calibrationQueue(db, open.cycleId, hrScope)!;
    assert.equal(queue.rows.find((r) => r.participantId === anaId)!.result!.adjusted, true);
    assert.equal(calibrationQueue(db, open.cycleId, brunoScope), null, "fila de calibração é do RH");
  });

  it("homologa só com permissão, tudo calibrado e sem revisão aberta; reabrir exige motivo", () => {
    const flow = homologatedCycle();
    assert.equal(flow.db.cycles[0]!.status, "HOMOLOGATED");
    assert.equal(flow.db.results.filter((r) => r.active && r.official).length, 4);
    const reopenNoReason = transitionCycle(flow.db, { cycleId: flow.cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions);
    assert.equal(reopenNoReason.ok === false && reopenNoReason.code, "NOTE_REQUIRED");
    const reopened = must(transitionCycle(flow.db, { cycleId: flow.cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: "Erro de digitação apontado pelo líder.", canHomologate: true, scope: hrScope }, openOptions));
    assert.equal(reopened.db.results.filter((r) => r.active && r.official).length, 0);
    const withoutPermission = transitionCycle(reopened.db, { cycleId: flow.cycleId, to: "HOMOLOGATED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions);
    assert.equal(withoutPermission.ok === false && withoutPermission.code, "FORBIDDEN");
  });

  it("revisão aberta do líder impede a homologação", () => {
    const open = openCycle();
    let db = submitSelf(open.db, "ana", 3);
    db = submitLeader(db, "ana", 3);
    db = must(transitionCycle(db, { cycleId: open.cycleId, to: "CONSOLIDATION", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    db = must(transitionCycle(db, { cycleId: open.cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    db = must(returnForRevision(db, { assignmentId: assignmentOf(db, "ana", "LEADER").id, reason: "Rever o exemplo de potencial.", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const blocked = transitionCycle(db, { cycleId: open.cycleId, to: "HOMOLOGATED", actorUserId: "rh", reversalReason: null, canHomologate: true, scope: hrScope }, openOptions);
    assert.equal(blocked.ok === false && blocked.code, "REVISION_OPEN");
  });
});

describe("devolutiva, PDI, encerramento e relatórios", () => {
  it("devolutiva pelo líder no escopo, ciência sem concordância e contestação com fato", () => {
    const flow = homologatedCycle();
    const anaId = participantOf(flow.db, "ana").id;
    const outsider = createFeedback(flow.db, { participantId: anaId, strength: "Qualidade", improvement: "Avisar antes", action: "Checklist", ownerName: "Marcos", dueAt: "2027-01-15", conversationAt: "2026-12-02", actorUserId: "u-marcos", scope: marcosScope }, openOptions);
    assert.equal(outsider.ok === false && outsider.code, "FORBIDDEN");
    const fb = must(createFeedback(flow.db, { participantId: anaId, strength: "Qualidade estável", improvement: "Avisar desvio mais cedo", action: "Treinar o checklist da máquina", ownerName: "Bruno Líder", dueAt: "2027-01-15", conversationAt: "2026-12-02", actorUserId: "u-bruno", scope: brunoScope }, openOptions));
    const twice = createFeedback(fb.db, { participantId: anaId, strength: "x".repeat(5), improvement: "y".repeat(5), action: "z".repeat(5), ownerName: "Bruno", dueAt: null, conversationAt: null, actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(twice.ok === false && twice.code, "FEEDBACK_EXISTS");
    const other = acknowledgeFeedback(fb.db, { feedbackId: fb.value.feedbackId, action: "ACKNOWLEDGED", note: null, actorEmployeeId: "bia" }, openOptions);
    assert.equal(other.ok === false && other.code, "FORBIDDEN");
    const ack = must(acknowledgeFeedback(fb.db, { feedbackId: fb.value.feedbackId, action: "ACKNOWLEDGED", note: "Vou pedir apoio no turno da noite.", actorEmployeeId: "ana" }, openOptions));
    const row = ack.db.feedbacks[0]!;
    assert.ok(row.acknowledgedAt);
    assert.equal(row.agreedAt, null, "ciência não é concordância");
    assert.equal(row.acknowledgedVia, "SELF");
    assert.equal(row.collaboratorNote, "Vou pedir apoio no turno da noite.");
    const contestShort = acknowledgeFeedback(ack.db, { feedbackId: row.id, action: "CONTESTED", note: "não", actorEmployeeId: "ana" }, openOptions);
    assert.equal(contestShort.ok === false && contestShort.code, "NOTE_REQUIRED");
    const assisted = must(acknowledgeFeedback(fb.db, { feedbackId: row.id, action: "ACKNOWLEDGED", note: null, actorEmployeeId: null, actorUserId: "u-rh", assisted: true, scope: hrScope }, openOptions));
    assert.equal(assisted.db.feedbacks[0]!.acknowledgedVia, "ASSISTED");
  });

  it("PDI com uma ação prioritária, extra justificada, conclusão preservada e acompanhamento por prazo", () => {
    const flow = homologatedCycle();
    const anaId = participantOf(flow.db, "ana").id;
    let db = must(createFeedback(flow.db, { participantId: anaId, strength: "Qualidade", improvement: "Avisar antes", action: "Checklist", ownerName: "Bruno Líder", dueAt: "2027-01-15", conversationAt: "2026-12-02", actorUserId: "u-bruno", scope: brunoScope }, openOptions)).db;
    const feedbackId = db.feedbacks[0]!.id;
    const noDue = createPdi(db, { feedbackId, title: "Treinar o checklist", priority: true, justification: null, ownerName: "Bruno", dueAt: null, actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(noDue.ok === false && noDue.code, "INVALID_DATE");
    const badCompetency = createPdi(db, { feedbackId, title: "Treinar", competencyCode: "XX-99", priority: true, justification: null, ownerName: "Bruno", dueAt: "2027-01-15", actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(badCompetency.ok === false && badCompetency.code, "INVALID_COMPETENCY");
    const first = must(createPdi(db, { feedbackId, title: "Treinar o checklist", objective: "Zerar retrabalho no posto 3", competencyCode: "DT-01", priority: true, justification: null, ownerName: "Bruno Líder", dueAt: "2026-10-01", actorUserId: "u-bruno", scope: brunoScope }, openOptions));
    db = first.db;
    const extraNoReason = createPdi(db, { feedbackId, title: "Curso extra", priority: false, justification: null, ownerName: "RH", dueAt: "2027-02-01", actorUserId: "rh", scope: hrScope }, openOptions);
    assert.equal(extraNoReason.ok === false && extraNoReason.code, "JUSTIFICATION_REQUIRED");
    db = must(createPdi(db, { feedbackId, title: "Curso extra", priority: false, justification: "Pedido da própria pessoa na conversa.", ownerName: "RH", dueAt: "2027-02-01", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    assert.equal(pdiTracking(db, brunoScope, { due: "late" }, NOW).map((p) => p.title).join(), "Treinar o checklist", "prazo vencido aparece");
    assert.equal(pdiTracking(db, marcosScope, { due: "all" }, NOW).length, 0, "outro setor não vê");
    db = must(addCheckin(db, { pdiId: first.value.pdiId, note: "Treinou dois turnos.", obstacle: null, nextStep: "Auditar o posto.", actorUserId: "u-bruno", scope: brunoScope }, openOptions)).db;
    assert.equal(db.pdis.find((p) => p.id === first.value.pdiId)!.status, "IN_PROGRESS");
    const doneNoNote = updatePdiStatus(db, { pdiId: first.value.pdiId, status: "DONE", note: null, actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(doneNoNote.ok === false && doneNoNote.code, "NOTE_REQUIRED");
    db = must(updatePdiStatus(db, { pdiId: first.value.pdiId, status: "DONE", note: "Retrabalho zerado em novembro.", actorUserId: "u-bruno", scope: brunoScope }, openOptions)).db;
    const done = db.pdis.find((p) => p.id === first.value.pdiId)!;
    assert.ok(done.completedAt);
    assert.equal(db.checkins.filter((c) => c.pdiId === done.id).length, 2, "conclusão vira registro, nada some");
    const reopen = updatePdiStatus(db, { pdiId: done.id, status: "IN_PROGRESS", note: "Reabrir.", actorUserId: "u-bruno", scope: brunoScope }, openOptions);
    assert.equal(reopen.ok === false && reopen.code, "PDI_CLOSED");
  });

  it("encerramento trata devolutiva pendente explicitamente e o histórico só mostra resultado homologado", () => {
    const flow = homologatedCycle();
    const pending = transitionCycle(flow.db, { cycleId: flow.cycleId, to: "CLOSED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions);
    assert.equal(pending.ok === false && pending.code, "PENDING_FEEDBACK");
    const closed = must(transitionCycle(flow.db, { cycleId: flow.cycleId, to: "CLOSED", actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions));
    assert.equal(closed.value.pending, 4);
    const history = employeeHistory(closed.db, "ana", brunoScope, false);
    assert.ok(history.ok);
    if (history.ok) {
      assert.equal(history.cycles.length, 1);
      assert.equal(history.cycles[0]!.quadrant, "Desempenho médio · Potencial alto");
      assert.equal(history.cycles[0]!.comparableWithPrevious, null);
    }
    assert.equal(employeeHistory(closed.db, "ana", marcosScope, false).ok, false);
  });

  it("emite documento com código único e versão, respeitando o escopo", () => {
    const flow = homologatedCycle();
    const anaId = participantOf(flow.db, "ana").id;
    const first = must(issueReport(flow.db, { cycleId: flow.cycleId, kind: "individual", participantId: anaId, actorUserId: "rh", actorName: "Rita RH", scope: hrScope, randomSuffix: "a1b2c3" }, openOptions));
    assert.match(first.value.code, /^DCP-20261016-A1B2C3$/);
    const second = must(issueReport(first.db, { cycleId: flow.cycleId, kind: "individual", participantId: anaId, actorUserId: "rh", actorName: "Rita RH", scope: hrScope, randomSuffix: "d4e5f6" }, openOptions));
    assert.equal(second.value.version, 2);
    const collision = issueReport(second.db, { cycleId: flow.cycleId, kind: "individual", participantId: anaId, actorUserId: "rh", actorName: "Rita RH", scope: hrScope, randomSuffix: "a1b2c3" }, openOptions);
    assert.equal(collision.ok === false && collision.code, "CODE_COLLISION");
    const otavio = participantOf(flow.db, "otavio").id;
    const outOfScope = issueReport(flow.db, { cycleId: flow.cycleId, kind: "individual", participantId: otavio, actorUserId: "u-bruno", actorName: "Bruno", scope: brunoScope, randomSuffix: "000001" }, openOptions);
    assert.equal(outOfScope.ok === false && outOfScope.code, "FORBIDDEN");
    const consolidated = issueReport(flow.db, { cycleId: flow.cycleId, kind: "consolidado", participantId: null, actorUserId: "u-bruno", actorName: "Bruno", scope: brunoScope, randomSuffix: "000002" }, openOptions);
    assert.equal(consolidated.ok === false && consolidated.code, "FORBIDDEN");
  });

  it("painel concilia contagens com numerador e denominador e lembrete não sai do sistema", () => {
    const open = openCycle();
    const db = submitSelf(open.db, "ana", 3);
    const counts = dashboardCounts(db, open.cycleId, hrScope, undefined, NOW);
    assert.equal(counts.eligible, 4);
    assert.equal(counts.notEligible, 2);
    assert.equal(counts.insufficient, 1);
    assert.equal(counts.selfSubmitted, 1);
    assert.deepEqual(counts.rates.selfSubmitted, { numerator: 1, denominator: 4, ratio: 0.25 });
    assert.equal(counts.rates.leaderSubmitted.denominator, 3, "quem não tem líder não entra no denominador do líder");
    const filtered = dashboardCounts(db, open.cycleId, hrScope, { department: "Manutenção" }, NOW);
    assert.equal(filtered.eligible, 1);
    const team = dashboardCounts(db, open.cycleId, brunoScope, undefined, NOW);
    assert.equal(team.eligible, 2, "escopo do líder");
    const workspace = describeCycle(db, open.cycleId, brunoScope, NOW)!;
    assert.equal(workspace.people.some((p) => p.participant.employeeName === "Otávio Manutenção"), false);
    const planned = must(planReminders(db, { cycleId: open.cycleId, actorUserId: "rh" }, openOptions));
    assert.ok(planned.value.drafted > 0);
    assert.equal(dispatchReminders(openOptions).ok, false);
  });
});

describe("escopo de RH", () => {
  it("líder não executa ação de RH mesmo chamando o caso de uso direto", () => {
    const open = openCycle();
    const leader = buildPerformanceScope({ accessScope: "DESCENDANTS", actorEmployeeId: "bruno", teamIds: ["ana"] });
    const anaId = participantOf(open.db, "ana").id;
    const cases = [
      transitionCycle(open.db, { cycleId: open.cycleId, to: "CONSOLIDATION", actorUserId: "u", reversalReason: null, acceptPending: true, scope: leader }, openOptions),
      removeParticipant(open.db, { participantId: anaId, reason: "Tentativa indevida do líder.", actorUserId: "u", scope: leader }, openOptions),
      reassignLeader(open.db, { participantId: anaId, managerId: "bruno", managerName: "Bruno", reason: "Tentativa indevida do líder.", actorUserId: "u", scope: leader }, openOptions),
      validateTechnical(open.db, { participantId: anaId, decision: "VALIDATED", note: "Tentativa indevida do líder.", actorUserId: "u", scope: leader }, openOptions),
      openAssisted(open.db, { assignmentId: assignmentOf(open.db, "ana", "SELF").id, assistantUserId: "u", actorEmployeeId: "bruno", reason: "Tentativa indevida do líder.", scope: leader }, openOptions),
    ];
    for (const result of cases) assert.equal(result.ok === false && result.code, "FORBIDDEN");
  });

  it("estado sem alteração não gera escrita", () => {
    const published = must(createDraftModel(emptyPerformanceDatabase(), { name: "Modelo", actorUserId: "rh", scope: hrScope }, openOptions));
    const once = must(publishModel(published.db, { modelId: published.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions));
    const again = must(publishModel(once.db, { modelId: published.value.modelId, actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(again.db, once.db);
    assert.ok(PROPOSED_BASE_QUESTIONS.every((q) => q.selfText.startsWith("Eu ")), "segunda pessoa para quem responde");
  });
});

export type { PerformanceDatabase };

describe("comportamento observável e exemplos por cargo (RFC-008/024)", () => {
  it("o líder vê só o exemplo do cargo da pessoa; exemplos inválidos são recusados; a cópia preserva", () => {
    let db = must(createDraftModel(emptyPerformanceDatabase(), { name: "Modelo", actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const modelId = db.models[0]!.id;
    const cu01 = db.questions.find((q) => q.code === "CU-01")!;
    assert.ok(cu01.description && cu01.positiveExample && cu01.negativeExample, "valores nascem com descrição e exemplos propostos");
    const base = { modelId, code: "DT-03", selfText: cu01.selfText.replace("respeito", "respeito sempre"), leaderText: "Sabe usar as máquinas da função.", hint: null, actorUserId: "rh", scope: hrScope };
    const dt03 = db.questions.find((q) => q.code === "DT-03")!;
    const bad = updateDraftQuestion(db, { ...base, selfText: dt03.selfText, roleExamples: [{ roleName: "Operador de produção", text: "" }] }, openOptions);
    assert.equal(bad.ok === false && bad.code, "INVALID_TEXT");
    const dup = updateDraftQuestion(db, { ...base, selfText: dt03.selfText, roleExamples: [{ roleName: "Operador", text: "Regula a extrusora." }, { roleName: "operador", text: "Outro." }] }, openOptions);
    assert.equal(dup.ok === false && dup.code, "INVALID_TEXT");
    db = must(
      updateDraftQuestion(
        db,
        {
          ...base,
          selfText: dt03.selfText,
          roleExamples: [
            { roleName: "Operador de produção", text: "Regula a extrusora pela instrução de trabalho." },
            { roleName: "Técnico de manutenção", text: "Faz a preventiva no prazo do plano." },
          ],
        },
        openOptions
      )
    ).db;
    db = must(publishModel(db, { modelId, actorUserId: "rh", scope: hrScope }, openOptions)).db;
    const copy = must(duplicateModel(db, { modelId, actorUserId: "rh", scope: hrScope }, openOptions));
    assert.equal(copy.db.questions.find((q) => q.modelId === copy.value.modelId && q.code === "DT-03")!.roleExamples.length, 2);

    const cycle = must(createCycle(db, { name: "Ciclo", periodLabel: "S2", modelId, selfDueAt: "2026-11-15", leaderDueAt: "2026-11-30", actorUserId: "rh", scope: hrScope }, openOptions));
    let flow = must(applyParticipants(cycle.db, { cycleId: cycle.value.cycleId, employees: [ana], selectedIds: ["ana"], exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh", scope: hrScope }, openOptions)).db;
    flow = must(transitionCycle(flow, { cycleId: cycle.value.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    flow = must(transitionCycle(flow, { cycleId: cycle.value.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, scope: hrScope }, openOptions)).db;
    const form = readLeaderForm(flow, assignmentOf(flow, "ana", "LEADER").id, brunoScope, "bruno");
    assert.ok(form.ok);
    if (form.ok) {
      const q = form.questions.find((item) => item.code === "DT-03")!;
      assert.equal(q.roleExample, "Regula a extrusora pela instrução de trabalho.");
      assert.equal(JSON.stringify(form).includes("preventiva"), false, "exemplo de outro cargo não aparece");
    }
  });
});

describe("reabertura e exportação (RFC-028/038)", () => {
  it("reabrir homologado exige a permissão de calibração", () => {
    const open = openCycle();
    let db = submitSelf(open.db, "ana", 3);
    db = submitLeader(db, "ana", 3);
    for (const to of ["CONSOLIDATION", "CALIBRATION"] as const) {
      db = must(transitionCycle(db, { cycleId: open.cycleId, to, actorUserId: "rh", reversalReason: null, acceptPending: true, scope: hrScope }, openOptions)).db;
    }
    for (const id of ["ana", "bia", "semlider", "otavio"]) {
      const pid = participantOf(db, id).id;
      const r = db.results.find((x) => x.participantId === pid && x.active);
      if (r?.technicalValidation === "PENDING_VALIDATION") db = must(validateTechnical(db, { participantId: pid, decision: "VALIDATED", note: "Padrão da função conferido.", actorUserId: "rh", scope: hrScope }, openOptions)).db;
      db = must(calibrate(db, { participantId: pid, note: "Leitura do RH sem ajuste.", actorUserId: "rh", actorEmployeeId: null, scope: hrScope }, openOptions)).db;
    }
    db = must(transitionCycle(db, { cycleId: open.cycleId, to: "HOMOLOGATED", actorUserId: "rh", reversalReason: null, canHomologate: true, scope: hrScope }, openOptions)).db;
    const denied = transitionCycle(db, { cycleId: open.cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: "Erro apontado pelo líder.", canHomologate: false, scope: hrScope }, openOptions);
    assert.equal(denied.ok === false && denied.code, "FORBIDDEN");
    const ok = transitionCycle(db, { cycleId: open.cycleId, to: "CALIBRATION", actorUserId: "rh", reversalReason: "Erro apontado pelo líder.", canHomologate: true, scope: hrScope }, openOptions);
    assert.equal(ok.ok, true);
  });
});
