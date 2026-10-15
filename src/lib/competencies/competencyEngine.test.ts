import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMonthsIso,
  assessmentAverage,
  assessmentScope,
  buildCompetencyMatrix,
  buildCompetencyOverview,
  computeCoverage,
  computePositionReadiness,
  countOpenTrainings,
  countPendingAssessments,
  employeesBelowMinimum,
  evaluateRequirements,
  formatAssessmentAverage,
  isEmployeeReady,
  isRequirementMet,
  listGaps,
  readinessTone,
  requirementGap,
  resolveEffectiveLevel,
  type CompetencyEngineInput,
} from "./competencyEngine";
import { competencyLevelLabel, formatIsoDateBr } from "./competencyDomain";

/** Cenário do protótipo (8 colaboradores, 7 competências, 4 postos). */
function prototypeInput(overrides: Partial<CompetencyEngineInput> = {}): CompetencyEngineInput {
  const comp = (id: string, name: string, category: string, requiresRecycling = false) => ({
    id,
    name,
    category,
    requiresRecycling,
  });
  const lv: Record<string, Record<string, number>> = {
    "1": { c1: 3, c2: 3, c4: 2, c5: 3, c6: 2 },
    "2": { c1: 2, c3: 4, c5: 2, c6: 1 },
    "3": { c1: 2, c5: 3, c6: 3, c4: 1 },
    "4": { c1: 4, c4: 3, c6: 3, c5: 2 },
    "5": { c1: 2, c2: 2, c4: 2, c5: 3 },
    "6": { c1: 3, c3: 3, c5: 3 },
    "7": { c1: 1, c5: 2, c6: 2 },
    "8": { c1: 3, c5: 3, c6: 4, c7: 4, c4: 2 },
  };
  const req = (r: Record<string, number>) => Object.entries(r).map(([competencyId, minLevel]) => ({ competencyId, minLevel }));
  return {
    competencies: [
      comp("c1", "Leitura de desenho técnico", "TECHNICAL"),
      comp("c2", "Programação CNC", "TECHNICAL"),
      comp("c3", "Soldagem MIG/MAG", "TECHNICAL"),
      comp("c4", "Metrologia", "QUALITY"),
      comp("c5", "NR-12 Segurança em máquinas", "SAFETY"),
      comp("c6", "5S e organização", "QUALITY"),
      comp("c7", "Liderança de equipe", "BEHAVIORAL"),
    ],
    positions: [
      { id: "p1", name: "Torno CNC 01", departmentName: "Usinagem", shiftPattern: "TWO_SHIFTS", requirements: req({ c1: 3, c2: 3, c4: 2, c5: 3 }) },
      { id: "p2", name: "Célula de Solda", departmentName: "Caldeiraria", shiftPattern: "TWO_SHIFTS", requirements: req({ c1: 2, c3: 3, c5: 3 }) },
      { id: "p3", name: "Linha de Montagem", departmentName: "Montagem", shiftPattern: "ONE_SHIFT", requirements: req({ c1: 2, c5: 2, c6: 3 }) },
      { id: "p4", name: "Inspeção Final", departmentName: "Qualidade", shiftPattern: "ONE_SHIFT", requirements: req({ c1: 3, c4: 4, c6: 2 }) },
    ],
    employees: [
      { id: "1", name: "Ana Ribeiro", positionId: "p1" },
      { id: "2", name: "Bruno Souza", positionId: "p2" },
      { id: "3", name: "Carla Mendes", positionId: "p3" },
      { id: "4", name: "Diego Alves", positionId: "p4" },
      { id: "5", name: "Eduardo Lima", positionId: "p1" },
      { id: "6", name: "Fernanda Costa", positionId: "p2" },
      { id: "7", name: "Gustavo Pires", positionId: "p3" },
      { id: "8", name: "Helena Rocha", positionId: "p3" },
    ],
    levels: Object.entries(lv).flatMap(([employeeId, m]) =>
      Object.entries(m).map(([competencyId, level]) => ({ employeeId, competencyId, level })),
    ),
    trainingCompletions: [],
    asOf: "2026-10-15",
    ...overrides,
  };
}

describe("competencyEngine — requisito e lacuna", () => {
  it("requisito atendido quando nível ≥ mínimo", () => {
    assert.equal(isRequirementMet(3, 3), true);
    assert.equal(isRequirementMet(4, 3), true);
    assert.equal(isRequirementMet(2, 3), false);
    assert.equal(isRequirementMet(0, 1), false);
  });

  it("diferença da lacuna = mínimo − atual; 0 quando atendido", () => {
    assert.equal(requirementGap(1, 4), 3);
    assert.equal(requirementGap(3, 3), 0);
    assert.equal(requirementGap(4, 2), 0);
  });

  it("competência ausente do catálogo não conta como requisito", () => {
    const input = prototypeInput();
    input.competencies = input.competencies.filter((c) => c.id !== "c4");
    const evals = evaluateRequirements(input);
    assert.equal(evals.some((e) => e.competencyId === "c4"), false);
  });

  it("colaborador sem posto não gera requisitos", () => {
    const input = prototypeInput({ employees: [{ id: "x", name: "Sem Posto", positionId: null }] });
    assert.deepEqual(evaluateRequirements(input), []);
  });
});

describe("competencyEngine — cobertura", () => {
  it("cenário do protótipo: 20 de 26 requisitos atendidos (77%)", () => {
    const cov = computeCoverage(evaluateRequirements(prototypeInput()));
    assert.equal(cov.total, 26);
    assert.equal(cov.met, 20);
    assert.equal(cov.percentLabel, "77%");
  });

  it("sem requisitos → razão nula e rótulo —", () => {
    const cov = computeCoverage([]);
    assert.equal(cov.ratio, null);
    assert.equal(cov.percentLabel, "—");
  });
});

describe("competencyEngine — lacunas e ordenação", () => {
  it("ordena pela maior diferença; empate por nome do colaborador", () => {
    const gaps = listGaps(evaluateRequirements(prototypeInput()));
    assert.deepEqual(
      gaps.map((g) => `${g.employeeName}|${g.competencyId}|${g.currentLevel}→${g.requiredLevel}`),
      [
        "Bruno Souza|c5|2→3",
        "Diego Alves|c4|3→4",
        "Eduardo Lima|c1|2→3",
        "Eduardo Lima|c2|2→3",
        "Gustavo Pires|c1|1→2",
        "Gustavo Pires|c6|2→3",
      ],
    );
    assert.equal(gaps.every((g) => !g.met && g.gap === 1), true);
  });

  it("diferenças maiores vêm primeiro", () => {
    const input = prototypeInput();
    input.levels = input.levels.filter((l) => !(l.employeeId === "4" && l.competencyId === "c4"));
    const gaps = listGaps(evaluateRequirements(input));
    assert.equal(gaps[0].employeeName, "Diego Alves");
    assert.equal(gaps[0].competencyName, "Metrologia");
    assert.equal(gaps[0].currentLevel, 0);
    assert.equal(gaps[0].requiredLevel, 4);
    assert.equal(gaps[0].gap, 4);
  });

  it("Visão geral mostra só as 6 primeiras lacunas", () => {
    const ov = buildCompetencyOverview(prototypeInput({ levels: [] }), { assessmentStatuses: [], trainingStatuses: [] });
    assert.equal(ov.openGaps, 26);
    assert.equal(ov.topGaps.length, 6);
    assert.equal(ov.topGaps[0].gap, 4);
    assert.equal(buildCompetencyOverview(prototypeInput(), { assessmentStatuses: [], trainingStatuses: [] }).openGaps, 6);
  });
});

describe("competencyEngine — aptidão", () => {
  it("apto = atende 100% dos requisitos do posto", () => {
    const evals = evaluateRequirements(prototypeInput());
    assert.equal(isEmployeeReady(evals, "1"), true); // Ana
    assert.equal(isEmployeeReady(evals, "5"), false); // Eduardo
    assert.equal(isEmployeeReady(evals, "8"), true); // Helena
  });

  it("aptidão por posto e faixa de cor", () => {
    const byId = Object.fromEntries(computePositionReadiness(prototypeInput()).map((p) => [p.positionId, p]));
    assert.deepEqual([byId.p1.ready, byId.p1.total, byId.p1.tone], [1, 2, "warning"]);
    assert.deepEqual([byId.p2.ready, byId.p2.total, byId.p2.tone], [1, 2, "warning"]);
    assert.deepEqual([byId.p3.ready, byId.p3.total, byId.p3.percentLabel], [2, 3, "67%"]);
    assert.deepEqual([byId.p4.ready, byId.p4.total, byId.p4.tone], [0, 1, "danger"]);
  });

  it("faixas: ≥ 75% verde, ≥ 50% âmbar, abaixo vermelho, sem equipe neutro", () => {
    assert.equal(readinessTone(0.75), "success");
    assert.equal(readinessTone(0.74), "warning");
    assert.equal(readinessTone(0.5), "warning");
    assert.equal(readinessTone(0.49), "danger");
    assert.equal(readinessTone(null), "neutral");
  });

  it("KPIs agregados", () => {
    const ov = buildCompetencyOverview(prototypeInput(), {
      assessmentStatuses: ["COMPLETED", "COMPLETED", "IN_PROGRESS", "PENDING", "PENDING", "PENDING"],
      trainingStatuses: ["SCHEDULED", "IN_PROGRESS", "SCHEDULED", "COMPLETED"],
    });
    assert.equal(ov.readyEmployees, 4);
    assert.equal(ov.allocatedEmployees, 8);
    assert.equal(ov.pendingAssessments, 4);
    assert.equal(ov.openTrainings, 3);
  });
});

describe("competencyEngine — média da avaliação", () => {
  it("1 casa decimal com vírgula", () => {
    assert.equal(formatAssessmentAverage(assessmentAverage([3, 3, 2, 3])), "2,8");
    assert.equal(formatAssessmentAverage(assessmentAverage([4, 3, 3])), "3,3");
    assert.equal(formatAssessmentAverage(assessmentAverage([2, 3])), "2,5");
    assert.equal(formatAssessmentAverage(assessmentAverage([4])), "4,0");
  });

  it("sem níveis → —", () => {
    assert.equal(assessmentAverage([]), null);
    assert.equal(formatAssessmentAverage(null), "—");
  });

  it("contadores de pendências", () => {
    assert.equal(countPendingAssessments(["COMPLETED", "PENDING", "IN_PROGRESS"]), 2);
    assert.equal(countOpenTrainings(["COMPLETED", "SCHEDULED"]), 1);
  });
});

describe("competencyEngine — reciclagem", () => {
  const nr12 = { id: "c5", requiresRecycling: true };

  it("vencida → nível efetivo 1 (Em formação)", () => {
    const eff = resolveEffectiveLevel({
      storedLevel: 3,
      competency: nr12,
      employeeId: "1",
      completions: [{ employeeId: "1", competencyId: "c5", completedOn: "2024-09-01", validityMonths: 24 }],
      asOf: "2026-10-15",
    });
    assert.equal(eff.recycling, "EXPIRED");
    assert.equal(eff.recyclingExpiresOn, "2026-09-01");
    assert.equal(eff.level, 1);
    assert.equal(eff.storedLevel, 3);
    assert.equal(competencyLevelLabel(eff.level), "Em formação");
  });

  it("vale até o dia do vencimento, vence no dia seguinte", () => {
    const base = {
      storedLevel: 3,
      competency: nr12,
      employeeId: "1",
      completions: [{ employeeId: "1", competencyId: "c5", completedOn: "2025-10-15", validityMonths: 12 }],
    };
    assert.equal(resolveEffectiveLevel({ ...base, asOf: "2026-10-15" }).level, 3);
    assert.equal(resolveEffectiveLevel({ ...base, asOf: "2026-10-16" }).level, 1);
  });

  it("usa o ÚLTIMO treinamento concluído", () => {
    const eff = resolveEffectiveLevel({
      storedLevel: 4,
      competency: nr12,
      employeeId: "1",
      completions: [
        { employeeId: "1", competencyId: "c5", completedOn: "2023-01-10", validityMonths: 24 },
        { employeeId: "1", competencyId: "c5", completedOn: "2026-02-10", validityMonths: 24 },
        { employeeId: "2", competencyId: "c5", completedOn: "2026-05-10", validityMonths: 24 },
      ],
      asOf: "2026-10-15",
    });
    assert.equal(eff.recycling, "VALID");
    assert.equal(eff.level, 4);
    assert.equal(eff.recyclingExpiresOn, "2028-02-10");
  });

  it("sem exigência, sem treinamento ou validade 0 → mantém o nível", () => {
    const completions = [{ employeeId: "1", competencyId: "c5", completedOn: "2020-01-01", validityMonths: 0 }];
    assert.equal(resolveEffectiveLevel({ storedLevel: 3, competency: { id: "c5", requiresRecycling: false }, employeeId: "1", completions, asOf: "2026-10-15" }).level, 3);
    assert.equal(resolveEffectiveLevel({ storedLevel: 3, competency: nr12, employeeId: "9", completions, asOf: "2026-10-15" }).recycling, "NO_TRAINING");
    const noExpiry = resolveEffectiveLevel({ storedLevel: 3, competency: nr12, employeeId: "1", completions, asOf: "2026-10-15" });
    assert.equal(noExpiry.recycling, "NO_EXPIRY");
    assert.equal(noExpiry.level, 3);
  });

  it("nível 0 continua 0 mesmo vencido", () => {
    const eff = resolveEffectiveLevel({
      storedLevel: 0,
      competency: nr12,
      employeeId: "1",
      completions: [{ employeeId: "1", competencyId: "c5", completedOn: "2020-01-01", validityMonths: 12 }],
      asOf: "2026-10-15",
    });
    assert.equal(eff.level, 0);
  });

  it("expiração gera lacuna, derruba aptidão e marca a célula da matriz", () => {
    const input = prototypeInput({
      trainingCompletions: [{ employeeId: "1", competencyId: "c5", completedOn: "2024-01-01", validityMonths: 24 }],
    });
    input.competencies = input.competencies.map((c) => (c.id === "c5" ? { ...c, requiresRecycling: true } : c));
    const evals = evaluateRequirements(input);
    assert.equal(isEmployeeReady(evals, "1"), false);
    const gap = listGaps(evals).find((g) => g.employeeId === "1" && g.competencyId === "c5");
    assert.equal(gap?.currentLevel, 1);
    assert.equal(gap?.gap, 2);
    const cell = buildCompetencyMatrix(input).rows.find((r) => r.employeeId === "1")!.cells.find((c) => c.competencyId === "c5")!;
    assert.deepEqual([cell.level, cell.storedLevel, cell.belowMinimum, cell.recycling], [1, 3, true, "EXPIRED"]);
  });

  it("soma de meses ajusta fim de mês", () => {
    assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonthsIso("2024-01-31", 1), "2024-02-29");
    assert.equal(addMonthsIso("2026-11-15", 3), "2027-02-15");
    assert.equal(addMonthsIso("inválida", 3), null);
  });
});

describe("competencyEngine — competência crítica", () => {
  it("lacunas críticas contadas à parte e marcadas", () => {
    const input = prototypeInput();
    input.competencies = input.competencies.map((c) => (c.id === "c5" ? { ...c, critical: true } : c));
    const ov = buildCompetencyOverview(input, { assessmentStatuses: [], trainingStatuses: [] });
    assert.equal(ov.openGaps, 6);
    assert.equal(ov.criticalGaps, 1, "só a NR-12 do Bruno");
    assert.equal(ov.topGaps.find((g) => g.employeeName === "Bruno Souza")?.critical, true);
    assert.equal(buildCompetencyOverview(prototypeInput(), { assessmentStatuses: [], trainingStatuses: [] }).criticalGaps, 0);
  });
});

describe("competencyEngine — matriz e modais", () => {
  it("matriz: linhas = colaboradores, colunas = competências, mínimo e contorno", () => {
    const m = buildCompetencyMatrix(prototypeInput());
    assert.equal(m.rows.length, 8);
    assert.equal(m.rows[0].cells.length, 7);
    const eduardo = m.rows.find((r) => r.employeeName === "Eduardo Lima")!;
    const cnc = eduardo.cells.find((c) => c.competencyId === "c2")!;
    assert.deepEqual([cnc.level, cnc.requiredLevel, cnc.belowMinimum], [2, 3, true]);
    const lideranca = eduardo.cells.find((c) => c.competencyId === "c7")!;
    assert.deepEqual([lideranca.level, lideranca.requiredLevel, lideranca.belowMinimum], [0, null, false]);
  });

  it("escopo da avaliação = competências exigidas pelo posto com mínimo e nível atual", () => {
    const scope = assessmentScope(prototypeInput(), "5");
    assert.deepEqual(
      scope.map((s) => [s.competencyId, s.requiredLevel, s.currentLevel]),
      [["c1", 3, 2], ["c2", 3, 2], ["c4", 2, 2], ["c5", 3, 3]],
    );
  });

  it("chips do treinamento: quem está abaixo do mínimo na competência", () => {
    assert.deepEqual([...employeesBelowMinimum(prototypeInput(), "c1")].sort(), ["5", "7"]);
    assert.deepEqual([...employeesBelowMinimum(prototypeInput(), "c7")], []);
  });

  it("datas em pt-BR", () => {
    assert.equal(formatIsoDateBr("2026-10-21"), "21/10/2026");
    assert.equal(formatIsoDateBr(null), "—");
  });
});
