import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPerformanceScope } from "./performanceAccess.js";
import { PROPOSED_BASE_QUESTIONS } from "./performanceDomain.js";
import { buildPlainPdf } from "./performancePdf.js";
import { emptyPerformanceDatabase, type PerformanceDatabase } from "./performanceState.js";
import {
  acknowledgeFeedback,
  applyParticipants,
  calibrate,
  createCycle,
  createDraftModel,
  createFeedback,
  createPdi,
  dispatchReminders,
  duplicateModel,
  employeeHistory,
  exchangeLink,
  issueInvite,
  leaderQueue,
  planReminders,
  publicForm,
  publicSave,
  publicSubmit,
  publishModel,
  readLeaderForm,
  recordConduct,
  returnForRevision,
  saveAnswers,
  submitAssignment,
  transitionCycle,
  updateDraftQuestion,
  validateTechnical,
  verifyOtp,
  type ServiceOptions,
} from "./performanceService.js";
import type { EmployeeSnapshotSource } from "./performanceDomain.js";

const now = new Date("2026-10-16T15:00:00.000Z");
const blocked: ServiceOptions = {
  now: () => now,
  officialPublication: false,
  identityOtpEnabled: true,
  remindersEnabled: false,
  publicOrigin: "https://induscost.local",
};
const openable: ServiceOptions = { ...blocked, officialPublication: true };

function must<T>(result: { ok: true; db: PerformanceDatabase; value: T } | { ok: false; message: string }): { db: PerformanceDatabase; value: T } {
  if (result.ok === false) throw new Error(result.message);
  return result;
}

const ana: EmployeeSnapshotSource = {
  id: "ana",
  name: "Ana",
  status: "ACTIVE",
  roleId: "op",
  roleName: "Operadora",
  departmentId: "prod",
  departmentName: "Produção",
  managerId: "bruno",
  managerName: "Bruno",
  admissionDate: new Date("2024-01-10T12:00:00.000Z"),
  terminationDate: null,
  registration: null,
};
const bruno: EmployeeSnapshotSource = { ...ana, id: "bruno", name: "Bruno", managerId: "carla", managerName: "Carla", roleName: "Líder" };
const recem: EmployeeSnapshotSource = { ...ana, id: "recem", name: "Caio", admissionDate: new Date("2026-09-01T12:00:00.000Z") };
const inativo: EmployeeSnapshotSource = { ...ana, id: "inativo", name: "Dora", status: "INACTIVE" };
const afastado: EmployeeSnapshotSource = { ...ana, id: "afastado", name: "Eva" };

const hrScope = buildPerformanceScope({ accessScope: "ALL", actorEmployeeId: null });
const leaderScope = buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: "bruno", teamIds: ["ana"] });

function readyCycle() {
  let db = emptyPerformanceDatabase();
  const model = must(createDraftModel(db, { name: "Ciclo proposto", actorUserId: "rh" }, openable));
  db = model.db;
  const published = must(publishModel(db, { modelId: model.value.modelId, actorUserId: "rh" }, openable));
  db = published.db;
  const cycle = must(
    createCycle(
      db,
      {
        name: "2026-S2",
        periodLabel: "2º semestre de 2026",
        modelId: published.value.modelId,
        selfDueAt: "2026-11-15",
        leaderDueAt: "2026-11-30",
        actorUserId: "rh",
      },
      openable
    )
  );
  db = cycle.db;
  const people = must(
    applyParticipants(
      db,
      {
        cycleId: cycle.value.cycleId,
        employees: [ana, bruno, recem, inativo, afastado],
        selectedIds: ["ana", "recem", "inativo", "afastado"],
        exceptions: {},
        absenceIds: ["afastado"],
        roleChangeIds: [],
        actorUserId: "rh",
      },
      openable
    )
  );
  return { db: people.db, cycleId: cycle.value.cycleId, modelId: published.value.modelId, counts: people.value };
}

describe("modelo e governança", () => {
  it("publica snapshot imutável e bloqueia a abertura sem homologação", () => {
    const ready = readyCycle();
    assert.equal(ready.counts.eligible, 1);
    assert.equal(ready.counts.notEligible, 2);
    assert.equal(ready.counts.insufficient, 1);
    const prepared = must(transitionCycle(ready.db, { cycleId: ready.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null }, blocked));
    const opened = transitionCycle(prepared.db, { cycleId: ready.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null }, blocked);
    assert.equal(opened.ok, false);
    if (!opened.ok) assert.equal(opened.code, "GOVERNANCE_BLOCKED");
    const live = must(transitionCycle(prepared.db, { cycleId: ready.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null }, openable));
    assert.equal(live.db.assignments.filter((a) => a.active).length, 2);
    const again = applyParticipants(live.db, { cycleId: ready.cycleId, employees: [ana], selectedIds: ["ana"], exceptions: {}, absenceIds: [], roleChangeIds: [], actorUserId: "rh" }, openable);
    assert.equal(again.ok, false);
    const edited = updateDraftQuestion(live.db, { modelId: ready.modelId, code: "DT-01", selfText: "Texto novo suficiente", leaderText: "Texto do líder suficiente", hint: null, actorUserId: "rh" }, openable);
    assert.equal(edited.ok, false);
    const copy = must(duplicateModel(live.db, { modelId: ready.modelId, actorUserId: "rh" }, openable));
    assert.equal(copy.db.models.find((m) => m.id === copy.value.modelId)?.status, "DRAFT");
    assert.equal(copy.db.questions.filter((q) => q.modelId === ready.modelId).length, 12);
  });

  it("abre em piloto quando o RH confirma que a regra ainda é proposta", () => {
    const ready = readyCycle();
    const prepared = must(transitionCycle(ready.db, { cycleId: ready.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null }, blocked));
    const opened = must(transitionCycle(prepared.db, { cycleId: ready.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null, pilotAck: true }, { ...blocked, identityOtpEnabled: false }));
    assert.equal(opened.value.status, "OPEN");
    const self = opened.db.assignments.find((a) => a.kind === "SELF" && a.active)!;
    const issued = must(issueInvite(opened.db, { assignmentId: self.id, actorUserId: "rh" }, blocked));
    const token = decodeURIComponent(new URL(issued.value.url).hash.slice(3));
    const exchanged = must(exchangeLink(issued.db, { token }, blocked));
    const verified = verifyOtp(exchanged.db, { sessionToken: exchanged.value.sessionToken, otp: issued.value.otp }, { ...blocked, identityOtpEnabled: false });
    assert.equal(verified.ok, true);
    const pdf = buildPlainPdf("Ciclo piloto", [ready.db.participants[0]?.employeeName ?? "Ana"]);
    assert.match(pdf.toString("latin1"), /%PDF-1\.4/);
  });
});

describe("convite e portal", () => {
  it("o QR sozinho não libera respostas e o envio é único", () => {
    const ready = readyCycle();
    const prepared = must(transitionCycle(ready.db, { cycleId: ready.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null }, openable));
    const live = must(transitionCycle(prepared.db, { cycleId: ready.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null }, openable));
    const self = live.db.assignments.find((a) => a.kind === "SELF" && a.active)!;
    const issued = must(issueInvite(live.db, { assignmentId: self.id, actorUserId: "rh" }, openable));
    assert.equal(issued.db.invites.some((i) => i.linkDigest === issued.value.url), false);
    const token = new URL(issued.value.url).hash.slice(3);
    const decoded = decodeURIComponent(token);
    const exchanged = must(exchangeLink(issued.db, { token: decoded }, openable));
    const blockedForm = publicForm(exchanged.db, { sessionToken: exchanged.value.sessionToken }, openable);
    assert.equal(blockedForm.ok, false);
    let db = exchanged.db;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = verifyStep(db, exchanged.value.sessionToken, "000000");
      assert.equal(failed.ok, false);
      db = failed.db ?? db;
    }
    assert.equal(db.invites.find((i) => i.id === issued.value.inviteId)?.locked, true);
    const reissued = must(issueInvite(db, { assignmentId: self.id, actorUserId: "rh" }, openable));
    const old = exchangeLink(reissued.db, { token: decoded }, openable);
    assert.equal(old.ok, false);
    const nextToken = decodeURIComponent(new URL(reissued.value.url).hash.slice(3));
    const next = must(exchangeLink(reissued.db, { token: nextToken }, openable));
    const verified = verifyStep(next.db, next.value.sessionToken, reissued.value.otp);
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    const form = must(publicForm(verified.db, { sessionToken: verified.value.sessionToken }, openable));
    assert.equal(form.value.employeeName, "Ana");
    assert.equal(form.value.questions.length, 12);
    const answers = PROPOSED_BASE_QUESTIONS.map((q, index) => ({
      code: q.code,
      answer: index === 0 ? ({ kind: "notObserved" as const }) : ({ kind: "score" as const, score: 3 as const }),
    }));
    const saved = must(publicSave(verified.db, { sessionToken: verified.value.sessionToken, expectedVersion: form.value.version, answers }, openable));
    const resumed = must(publicForm(saved.db, { sessionToken: verified.value.sessionToken }, openable));
    assert.equal(resumed.value.answers.filter((a) => a.kind === "notObserved").length, 1);
    const done = must(publicSubmit(saved.db, { sessionToken: verified.value.sessionToken, expectedVersion: resumed.value.version, confirm: true }, openable));
    const twice = publicSubmit(done.db, { sessionToken: verified.value.sessionToken, expectedVersion: 1, confirm: true }, openable);
    assert.equal(twice.ok, false);
    const idempotent = submitAssignment(
      done.db,
      {
        assignmentId: self.id,
        expectedVersion: 1,
        actorUserId: null,
        scope: buildPerformanceScope({ accessScope: "SELF", actorEmployeeId: "ana" }),
        assistedConfirmation: true,
      },
      openable
    );
    assert.equal(idempotent.ok, true);
    assert.equal(done.db.answers.filter((a) => a.assignmentId === self.id && a.kind === "score").reduce((s, a) => s + (a.score ?? 0), 0) > 0, true);
    assert.equal(done.db.results.find((r) => r.active)?.technicalValidation, "INSUFFICIENT");
    const closed = publicForm(done.db, { sessionToken: verified.value.sessionToken }, openable);
    assert.equal(closed.ok, false);
    assert.equal(done.db.results.find((r) => r.active)?.quadrant, "SEM_CLASSIFICACAO");
  });
});

function verifyStep(db: PerformanceDatabase, sessionToken: string, otp: string) {
  return verifyOtp(db, { sessionToken, otp }, openable);
}

describe("líder, cálculo e devolutiva", () => {
  it("não lê a autoavaliação antes, exige exemplo e não pune por ocorrência", () => {
    const flow = answeredLeader();
    const hidden = readLeaderForm(flow.db, flow.leaderId, leaderScope, "bruno");
    assert.equal(hidden.ok, true);
    if (hidden.ok) assert.equal(hidden.selfAnswers.length, 0);
    const outsider = readLeaderForm(flow.db, flow.leaderId, buildPerformanceScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: "outro", teamIds: ["z"] }), "outro");
    assert.equal(outsider.ok, false);
    const noEvidence = saveAnswers(
      flow.db,
      {
        assignmentId: flow.leaderId,
        expectedVersion: flow.version,
        answers: [{ code: "DT-01", answer: { kind: "score", score: 1, evidence: "curto" } }],
        actorUserId: "u-bruno",
        scope: leaderScope,
      },
      openable
    );
    assert.equal(noEvidence.ok, false);
    const withEvidence = must(
      saveAnswers(
        flow.db,
        {
          assignmentId: flow.leaderId,
          expectedVersion: flow.version,
          answers: PROPOSED_BASE_QUESTIONS.map((q) => ({
            code: q.code,
            answer: q.code === "DT-01"
              ? { kind: "score" as const, score: 1 as const, evidence: "A peça saiu sem o furo na sexta." }
              : { kind: "score" as const, score: 4 as const, evidence: "Entregou o lote inteiro no padrão." },
          })),
          actorUserId: "u-bruno",
          scope: leaderScope,
        },
        openable
      )
    );
    const submitted = must(
      submitAssignment(
        withEvidence.db,
        { assignmentId: flow.leaderId, expectedVersion: withEvidence.value.version, actorUserId: "u-bruno", scope: leaderScope, assistedConfirmation: true },
        openable
      )
    );
    const visible = readLeaderForm(submitted.db, flow.leaderId, leaderScope, "bruno");
    assert.equal(visible.ok, true);
    if (visible.ok) assert.ok(visible.divergences.length >= 1);
    const resultBefore = submitted.db.results.filter((r) => r.active).map((r) => r.quadrant);
    const conduct = must(recordConduct(submitted.db, { employeeId: "ana", summary: "Relato ainda não apurado.", actorUserId: "rh" }, openable));
    assert.deepEqual(conduct.db.results.filter((r) => r.active).map((r) => r.quadrant), resultBefore);
    assert.equal(conduct.db.results.find((r) => r.active)?.official, false);
    const validated = must(
      validateTechnical(conduct.db, { participantId: flow.participantId, decision: "VALIDATED", note: "Função de operação conferida no posto.", actorUserId: "rh" }, openable)
    );
    assert.notEqual(validated.value.quadrant, "SEM_CLASSIFICACAO");
    const selfCal = calibrate(validated.db, { participantId: flow.participantId, note: "Quero aprovar a mim mesmo agora.", actorUserId: "ana-user", actorEmployeeId: "ana" }, openable);
    assert.equal(selfCal.ok, false);
    const cal = must(calibrate(validated.db, { participantId: flow.participantId, note: "Leitura do RH sem mudança de nota.", actorUserId: "rh", actorEmployeeId: null }, openable));
    const cycle = cal.db.cycles[0]!;
    let db = cal.db;
    for (const to of ["CONSOLIDATION", "CALIBRATION", "HOMOLOGATED"] as const) {
      db = must(transitionCycle(db, { cycleId: cycle.id, to, actorUserId: "rh", reversalReason: null }, openable)).db;
    }
    assert.equal(db.results.find((r) => r.active)?.official, true);
    const feedback = must(
      createFeedback(
        db,
        {
          participantId: flow.participantId,
          strength: "Qualidade estável",
          improvement: "Avisar desvio mais cedo",
          action: "Treinar o checklist da máquina",
          ownerName: "Bruno",
          dueAt: "2027-01-15",
          conversationAt: "2026-12-02",
          leaderEmployeeId: "bruno",
          actorUserId: "rh",
        },
        openable
      )
    );
    const ack = must(acknowledgeFeedback(feedback.db, { feedbackId: feedback.value.feedbackId, action: "ACKNOWLEDGED", note: null, actorEmployeeId: "ana" }, openable));
    const row = ack.db.feedbacks[0]!;
    assert.ok(row.acknowledgedAt);
    assert.equal(row.agreedAt, null);
    const pdi = must(createPdi(ack.db, { feedbackId: row.id, title: "Treinar o checklist", priority: true, justification: null, ownerName: "Bruno", dueAt: "2027-01-15", actorUserId: "rh" }, openable));
    assert.equal(pdi.db.pdis.length, 1);
    const history = employeeHistory(pdi.db, "ana", leaderScope, false);
    assert.equal(history.ok, true);
    const queue = leaderQueue(submitted.db, leaderScope, "bruno");
    assert.equal(queue.length, 1);
    assert.equal(queue.some((item) => item.employeeName === "Bruno"), false);
    const reminders = must(planReminders(pdi.db, { cycleId: cycle.id, actorUserId: "rh" }, openable));
    const sent = dispatchReminders(openable);
    assert.equal(sent.ok, false);
    assert.equal(reminders.value.drafted >= 0, true);
    const revision = must(returnForRevision(submitted.db, { assignmentId: flow.leaderId, reason: "Detalhar o exemplo da nota 1.", actorUserId: "rh" }, openable));
    assert.equal(revision.db.assignments.filter((a) => a.kind === "LEADER").length, 2);
  });
});


function answeredLeader() {
  const ready = readyCycle();
  const prepared = must(transitionCycle(ready.db, { cycleId: ready.cycleId, to: "PREPARED", actorUserId: "rh", reversalReason: null }, openable));
  const live = must(transitionCycle(prepared.db, { cycleId: ready.cycleId, to: "OPEN", actorUserId: "rh", reversalReason: null }, openable));
  const self = live.db.assignments.find((a) => a.kind === "SELF" && a.active)!;
  const leader = live.db.assignments.find((a) => a.kind === "LEADER" && a.active)!;
  const saved = must(
    saveAnswers(
      live.db,
      {
        assignmentId: self.id,
        expectedVersion: 1,
        answers: PROPOSED_BASE_QUESTIONS.map((q) => ({ code: q.code, answer: { kind: "score" as const, score: 4 as const } })),
        actorUserId: null,
        scope: buildPerformanceScope({ accessScope: "SELF", actorEmployeeId: "ana" }),
      },
      openable
    )
  );
  const submitted = must(
    submitAssignment(
      saved.db,
      { assignmentId: self.id, expectedVersion: saved.value.version, actorUserId: null, scope: buildPerformanceScope({ accessScope: "SELF", actorEmployeeId: "ana" }), assistedConfirmation: true },
      openable
    )
  );
  return { db: submitted.db, leaderId: leader.id, version: leader.version, participantId: leader.participantId };
}

