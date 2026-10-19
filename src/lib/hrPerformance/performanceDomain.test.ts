import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALGORITHM_ID,
  BASE_QUESTION_COUNT,
  PROPOSED_BASE_QUESTIONS,
  PROPOSED_MIN_OBSERVATION_DAYS,
  aggregatePillar,
  classifyEligibility,
  cultureBand,
  evidenceSatisfied,
  findDivergences,
  formatPillarMean,
  meanAtLeast,
  meanBelow,
  neutralizeSpreadsheetCell,
  nextCycleStatus,
  nineBoxBand,
  placeNineBox,
  type EmployeeSnapshotSource,
  type StoredAnswer,
} from "./performanceDomain.js";

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

function person(partial: Partial<EmployeeSnapshotSource> = {}): EmployeeSnapshotSource {
  return {
    id: "emp-1",
    name: "Ana",
    status: "ACTIVE",
    roleId: "role-1",
    roleName: "Operador",
    departmentId: "dep-1",
    departmentName: "Produção",
    managerId: "mgr-1",
    managerName: "Bruno",
    admissionDate: day("2024-01-01"),
    terminationDate: null,
    registration: null,
    ...partial,
  };
}

function score(code: string, pillar: StoredAnswer["pillar"], value: 1 | 2 | 3 | 4 | "NA"): StoredAnswer {
  if (value === "NA") {
    return { questionCode: code, pillar, kind: "notObserved", score: null, evidence: null };
  }
  return { questionCode: code, pillar, kind: "score", score: value, evidence: null };
}

describe("questionário proposto", () => {
  it("tem 12 perguntas, 4 por pilar, sem declarar homologação", () => {
    assert.equal(PROPOSED_BASE_QUESTIONS.length, BASE_QUESTION_COUNT);
    for (const pillar of ["TECHNICAL", "CULTURE", "POTENTIAL"] as const) {
      assert.equal(PROPOSED_BASE_QUESTIONS.filter((q) => q.pillar === pillar).length, 4);
    }
    assert.ok(PROPOSED_BASE_QUESTIONS.every((q) => q.proposal === true && q.selfText !== q.leaderText));
    assert.equal(new Set(PROPOSED_BASE_QUESTIONS.map((q) => q.code)).size, 12);
  });
});

describe("elegibilidade", () => {
  const asOf = day("2026-10-16");

  it("separa não elegível de evidência insuficiente", () => {
    const recent = classifyEligibility({
      employee: person({ admissionDate: day("2026-09-01") }),
      asOf,
      minObservationDays: PROPOSED_MIN_OBSERVATION_DAYS,
      absenceOverlapsReference: false,
      roleChangedInsideWindow: false,
      exceptionReason: null,
    });
    assert.equal(recent.state, "NOT_ELIGIBLE");

    const away = classifyEligibility({
      employee: person(),
      asOf,
      minObservationDays: 90,
      absenceOverlapsReference: true,
      roleChangedInsideWindow: false,
      exceptionReason: null,
    });
    assert.equal(away.state, "INSUFFICIENT_EVIDENCE");

    const inactive = classifyEligibility({
      employee: person({ status: "INACTIVE" }),
      asOf,
      minObservationDays: 90,
      absenceOverlapsReference: false,
      roleChangedInsideWindow: false,
      exceptionReason: "pedido do gestor",
    });
    assert.equal(inactive.state, "NOT_ELIGIBLE");
  });

  it("exceção justificada torna elegível quem foi admitido há pouco", () => {
    const decision = classifyEligibility({
      employee: person({ admissionDate: day("2026-10-01") }),
      asOf,
      minObservationDays: 90,
      absenceOverlapsReference: false,
      roleChangedInsideWindow: false,
      exceptionReason: "piloto combinado com o RH",
    });
    assert.equal(decision.state, "ELIGIBLE");
    assert.match(decision.reason, /piloto/);
  });
});

describe("ciclo", () => {
  it("só avança na ordem e só volta com autorização", () => {
    assert.equal(nextCycleStatus("DRAFT", "OPEN", true).ok, false);
    assert.equal(nextCycleStatus("PREPARED", "OPEN", false).ok, true);
    assert.equal(nextCycleStatus("PREPARED", "DRAFT", false).ok, false);
    assert.deepEqual(nextCycleStatus("PREPARED", "DRAFT", true), { ok: true });
    assert.equal(nextCycleStatus("CLOSED", "CALIBRATION", true).ok, false);
  });
});

describe("média e cultura", () => {
  it("não transforma não observável em zero e não arredonda o corte", () => {
    const answers = [
      score("CU-01", "CULTURE", 4),
      score("CU-02", "CULTURE", 4),
      score("CU-03", "CULTURE", "NA"),
      score("CU-04", "CULTURE", 1),
    ];
    const math = aggregatePillar(answers, "CULTURE", 3);
    assert.equal(math.sum, 9);
    assert.equal(math.count, 3);
    assert.equal(math.insufficient, false);
    assert.equal(math.display, "3,00");
    assert.equal(cultureBand(answers, 3).band, "NEEDS_REVIEW");

    const short = [score("CU-01", "CULTURE", 4), score("CU-02", "CULTURE", 4), score("CU-03", "CULTURE", "NA")];
    assert.equal(aggregatePillar(short, "CULTURE", 3).insufficient, true);
    assert.equal(cultureBand(short, 3).band, "INSUFFICIENT");
    assert.equal(cultureBand(short, 3).homologated, false);
  });

  it("exibição em duas casas não muda a faixa", () => {
    assert.equal(formatPillarMean(2495, 1000), "2,50");
    assert.equal(meanBelow(2495, 1000, 5, 2), true);
    assert.equal(nineBoxBand(2495, 1000), "LOW");
    assert.equal(nineBoxBand(5, 2), "MID");
    assert.equal(nineBoxBand(3499, 1000), "MID");
    assert.equal(nineBoxBand(7, 2), "HIGH");
    assert.equal(meanAtLeast(7, 2, 7, 2), true);
    assert.equal(ALGORITHM_ID.length > 0, true);
  });
});

describe("nine-box", () => {
  const technical = { sum: 14, count: 4, notObserved: 0, insufficient: false, display: "3,50" };
  const potential = { sum: 8, count: 4, notObserved: 0, insufficient: false, display: "2,00" };

  it("não classifica sem validação técnica nem com pilar insuficiente", () => {
    const pending = placeNineBox({ technical, potential, technicalValidation: "PENDING_VALIDATION" });
    assert.equal(pending.quadrant, "SEM_CLASSIFICACAO");
    assert.equal(pending.official, false);
    const placed = placeNineBox({ technical, potential, technicalValidation: "VALIDATED" });
    assert.equal(placed.x, "HIGH");
    assert.equal(placed.y, "LOW");
    assert.match(placed.quadrant, /alto/);
    assert.equal(placed.official, false);
  });
});

describe("divergência e evidência", () => {
  it("só aponta diferença numérica igual ou acima do limiar proposto", () => {
    const gaps = findDivergences(
      [score("DT-01", "TECHNICAL", 4), score("DT-02", "TECHNICAL", "NA")],
      [score("DT-01", "TECHNICAL", 2), score("DT-02", "TECHNICAL", 1)],
      2
    );
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]?.questionCode, "DT-01");
  });

  it("líder precisa de exemplo nas notas 1 e 4", () => {
    assert.equal(evidenceSatisfied("LEADER", { kind: "score", score: 1, evidence: "curto" }), false);
    assert.equal(evidenceSatisfied("LEADER", { kind: "score", score: 1, evidence: "Peça saiu sem rebarba na sexta." }), true);
    assert.equal(evidenceSatisfied("SELF", { kind: "score", score: 1, evidence: "" }), true);
    assert.equal(evidenceSatisfied("LEADER", { kind: "notObserved" }), true);
  });
});

describe("planilha", () => {
  it("neutraliza célula que a planilha executaria", () => {
    assert.equal(neutralizeSpreadsheetCell("=CMD()"), "'=CMD()");
    assert.equal(neutralizeSpreadsheetCell("texto"), "texto");
  });
});
