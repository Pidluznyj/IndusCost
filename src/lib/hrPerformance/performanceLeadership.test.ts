import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FREQUENCY_SCALE } from "./performanceDomain.js";
import {
  calibratedIndex,
  commentProblem,
  commentRequired,
  compareCompetencies,
  INSUFFICIENT_SAMPLE_MESSAGE,
  justificationReasons,
  LEADERSHIP_CODES,
  LEADERSHIP_SCALE,
  leadershipAnswerProblem,
  parseLeadershipRules,
  personalPerspective,
  PROPOSED_LEADERSHIP_QUESTIONS,
  PROPOSED_LEADERSHIP_RULES,
  questionText,
  strengthsAndPriorities,
  teamPerspective,
  type LeadershipStoredAnswer,
} from "./performanceLeadership.js";

const rules = PROPOSED_LEADERSHIP_RULES;
const all = (score: number | "NO"): LeadershipStoredAnswer[] =>
  LEADERSHIP_CODES.map((code) => (score === "NO" ? { questionCode: code, kind: "notObserved", score: null } : { questionCode: code, kind: "score", score }));

describe("questionário único de liderança", () => {
  it("oito códigos estáveis, mesma competência e comportamento nas três perspectivas", () => {
    assert.deepEqual(LEADERSHIP_CODES, ["LD-01", "LD-02", "LD-03", "LD-04", "LD-05", "LD-06", "LD-07", "LD-08"]);
    for (const q of PROPOSED_LEADERSHIP_QUESTIONS) {
      assert.ok(q.competency && q.behavior);
      const texts = (["SELF", "UPWARD", "SUPERIOR"] as const).map((p) => questionText(q, p));
      assert.equal(new Set(texts).size, 3, `${q.code}: textos adaptados ao sujeito`);
      assert.match(texts[0], /^Eu /, `${q.code}: autoavaliação em primeira pessoa`);
      assert.match(texts[1], /^Meu líder /, `${q.code}: liderado`);
      assert.match(texts[2], /^Este líder /, `${q.code}: superior`);
    }
  });

  it("LD-03 segue o exemplo aprovado nas três perspectivas", () => {
    const q = PROPOSED_LEADERSHIP_QUESTIONS.find((x) => x.code === "LD-03")!;
    assert.equal(q.selfText, "Eu comunico mudanças e informações importantes à minha equipe em tempo adequado.");
    assert.equal(q.upwardText, "Meu líder comunica mudanças e informações importantes à equipe em tempo adequado.");
    assert.equal(q.superiorText, "Este líder comunica mudanças e informações importantes à equipe em tempo adequado.");
  });

  it("mesma escala de quatro níveis do módulo", () => {
    assert.equal(LEADERSHIP_SCALE, FREQUENCY_SCALE);
    assert.deepEqual(LEADERSHIP_SCALE.map((s) => s.label), ["Nunca ou quase nunca", "Às vezes", "Na maioria das vezes", "Sempre ou quase sempre"]);
  });
});

describe("comentário obrigatório", () => {
  it("notas 1 e 4 exigem; 2, 3 e Não sei aceitam opcional", () => {
    assert.equal(commentRequired(1), true);
    assert.equal(commentRequired(4), true);
    assert.equal(commentRequired(2), false);
    assert.equal(commentRequired(3), false);
    assert.equal(leadershipAnswerProblem({ kind: "score", score: 2 }, rules), null);
    assert.equal(leadershipAnswerProblem({ kind: "notObserved" }, rules), null);
    assert.ok(leadershipAnswerProblem({ kind: "score", score: 4 }, rules));
    assert.equal(leadershipAnswerProblem({ kind: "score", score: 4, comment: "Explicou as prioridades da semana em todas as reuniões." }, rules), null);
  });

  it("recusa comentário vazio, curto, repetitivo ou artificial", () => {
    for (const bad of ["", "   ", "ok", "muito bom!!", "aaaaaaaaaaaaaaaaaaaa", "bom bom bom bom bom bom", "..............................", "ok ok ok ok ok ok ok ok", "123456789012345678"]) {
      assert.ok(commentProblem(bad, 15), `deveria recusar: "${bad}"`);
    }
    assert.equal(commentProblem("Avisou a equipe da mudança de turno com uma semana de antecedência.", 15), null);
  });
});

describe("consolidação da equipe", () => {
  it("Não sei fica fora da média e não vira zero", () => {
    const team = teamPerspective([all(4), all(4), all(2), all(2), all(3), all("NO")], rules);
    assert.equal(team.respondents, 6);
    const c = team.competencies[0];
    assert.equal(c.validCount, 5);
    assert.equal(c.mean, 3);
    assert.ok(c.dispersion! > 0);
  });

  it("menos de 5 respondentes: nada divulgado, só a contagem", () => {
    const team = teamPerspective([all(4), all(1), all(3), all(2)], rules);
    assert.equal(team.disclosed, false);
    assert.equal(team.message, INSUFFICIENT_SAMPLE_MESSAGE);
    assert.ok(team.competencies.every((c) => c.mean === null && c.dispersion === null && !c.disclosed));
    assert.equal(team.index, null);
  });

  it("competência com menos de 5 válidas é suprimida mesmo com equipe suficiente; índice usa só as divulgadas", () => {
    const answers = [all(4), all(4), all(4), all(2), all(2)].map((list, i) => (i === 0 ? list.map((a) => (a.questionCode === "LD-08" ? { ...a, kind: "notObserved" as const, score: null } : a)) : list));
    const team = teamPerspective(answers, rules);
    assert.equal(team.disclosed, true);
    const ld8 = team.competencies.find((c) => c.code === "LD-08")!;
    assert.equal(ld8.disclosed, false);
    assert.equal(ld8.mean, null);
    assert.equal(team.coverage, 7);
    assert.ok(Math.abs(team.index! - 3.2) < 1e-9, "média simples das 7 competências divulgadas");
    assert.match(team.message!, /1 competência/);
  });

  it("índice pessoal: média das competências respondidas, com cobertura", () => {
    const answers = all(3).map((a, i) => (i < 2 ? { ...a, kind: "notObserved" as const, score: null } : i === 2 ? { ...a, score: 1 } : a));
    const p = personalPerspective(answers);
    assert.equal(p.coverage, 6);
    assert.ok(Math.abs(p.index! - (1 + 3 * 5) / 6) < 1e-9);
    assert.equal(personalPerspective(null).submitted, false);
  });

  it("índice calibrado exige as 8 notas inteiras", () => {
    const full = Object.fromEntries(LEADERSHIP_CODES.map((c) => [c, 3]));
    assert.equal(calibratedIndex(full), 3);
    assert.equal(calibratedIndex({ ...full, "LD-01": 2.5 }), null);
  });

  it("regras: amostra mínima nunca abaixo de 3", () => {
    assert.equal(parseLeadershipRules({ minRespondents: 1 }).minRespondents, 3);
    assert.deepEqual(parseLeadershipRules(null), PROPOSED_LEADERSHIP_RULES);
  });
});

describe("comparação e justificativa", () => {
  const questions = PROPOSED_LEADERSHIP_QUESTIONS;
  const self = personalPerspective(all(4));
  const superior = personalPerspective(all(3));

  it("três perspectivas: divergência só com diferença relevante", () => {
    const team = teamPerspective([all(2), all(2), all(2), all(2), all(2)], rules);
    const rows = compareCompetencies({ questions, self, superior, team, rules });
    assert.equal(rows[0].team, 2);
    assert.deepEqual(rows[0].divergences, ["Equipe × autoavaliação"]);
  });

  it("duas perspectivas (equipe suprimida): sem média e com evidência limitada", () => {
    const team = teamPerspective([all(1), all(1)], rules);
    const rows = compareCompetencies({ questions, self, superior, team, rules });
    assert.equal(rows[0].team, null);
    assert.equal(rows[0].teamDisclosed, false);
    assert.ok(justificationReasons(rows[0], 3).includes("Evidência limitada"));
    assert.ok(!justificationReasons(rows[0], 3).includes("Diferente da média da equipe"), "média suprimida não entra em regra");
  });

  it("nota extrema e ajuste em relação ao superior pedem justificativa", () => {
    const team = teamPerspective([all(3), all(3), all(3), all(3), all(3)], rules);
    const row = compareCompetencies({ questions, self: personalPerspective(all(3)), superior, team, rules })[0];
    assert.deepEqual(justificationReasons(row, 3), []);
    assert.deepEqual(justificationReasons(row, 4), ["Nota extrema", "Diferente da avaliação do superior", "Diferente da média da equipe"]);
  });

  it("pontos fortes e prioridades pela nota calibrada", () => {
    const scores = Object.fromEntries(LEADERSHIP_CODES.map((c, i) => [c, i < 2 ? 4 : i < 6 ? 3 : 2]));
    const out = strengthsAndPriorities(scores, questions);
    assert.deepEqual(out.strengths.map((s) => s.code), ["LD-01", "LD-02", "LD-03"]);
    assert.deepEqual(out.priorities.map((s) => s.code), ["LD-08", "LD-07"]);
  });
});
