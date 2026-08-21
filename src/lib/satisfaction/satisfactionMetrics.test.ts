/**
 * Fórmulas oficiais de Satisfação.
 *
 * O que está sob prova: a nota 1 continua 1 e a 5 continua 5; não respondido
 * nunca vira zero; DRAFT não entra na média; taxa sem denominador confiável é
 * `null`; e não existe NPS inventado a partir de uma escala 1–5.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  averageFromTotals,
  calculateAbandonmentRate,
  calculateFunnelRate,
  calculateResponseRate,
  hasCriticalAlert,
  isCriticalRating,
  isPositiveRating,
  isTopBoxRating,
  keepValidRatings,
  resolveAlertLevel,
  resolveTrend,
  summarizeCriteria,
  summarizeRatings,
} from "./satisfactionMetrics.js";

describe("classificação de notas", () => {
  it("positiva = 4 ou 5; crítica = 1 ou 2; top box = 5", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(isPositiveRating), [false, false, false, true, true]);
    assert.deepEqual([1, 2, 3, 4, 5].map(isCriticalRating), [true, true, false, false, false]);
    assert.deepEqual([1, 2, 3, 4, 5].map(isTopBoxRating), [false, false, false, false, true]);
  });

  it("3 não é positiva nem crítica — a nota neutra não é forçada para nenhum lado", () => {
    assert.equal(isPositiveRating(3), false);
    assert.equal(isCriticalRating(3), false);
  });
});

describe("keepValidRatings — entrada suja não contamina a métrica", () => {
  it("descarta null, undefined, 0, 6, decimais e strings", () => {
    const input = [1, null, 5, undefined, 0, 6, 4.5, "5", 3, NaN, true];
    assert.deepEqual(keepValidRatings(input), [1, 5, 3]);
  });

  it("ELIMINATÓRIO: não respondido (ausente/null) nunca vira zero", () => {
    const stats = summarizeRatings([null, undefined]);
    assert.equal(stats.count, 0);
    assert.equal(stats.average, null, "média de nada tem de ser null, não 0");
    assert.equal(stats.distribution[1], 0);
  });
});

describe("summarizeRatings", () => {
  it("ELIMINATÓRIO: nota 1 permanece 1 e nota 5 permanece 5 na distribuição", () => {
    const stats = summarizeRatings([1, 5]);
    assert.equal(stats.distribution[1], 1);
    assert.equal(stats.distribution[5], 1);
    assert.equal(stats.average, 3);
    assert.equal(stats.lowestRating, 1);
  });

  it("média é aritmética simples sobre notas válidas", () => {
    // (5+4+4+3+2+1)/6 = 3,1666... -> 3,17
    assert.equal(summarizeRatings([5, 4, 4, 3, 2, 1]).average, 3.17);
  });

  it("percentuais batem com as contagens", () => {
    const stats = summarizeRatings([5, 5, 4, 3, 2, 1, 1, 1]);
    assert.equal(stats.count, 8);
    assert.equal(stats.positiveCount, 3);
    assert.equal(stats.criticalCount, 4);
    assert.equal(stats.topBoxCount, 2);
    assert.equal(stats.positivePercent, 37.5);
    assert.equal(stats.criticalPercent, 50);
    assert.equal(stats.topBoxPercent, 25);
  });

  it("conjunto vazio devolve null nos percentuais, não zero", () => {
    const stats = summarizeRatings([]);
    assert.equal(stats.positivePercent, null);
    assert.equal(stats.criticalPercent, null);
    assert.equal(stats.lowestRating, null);
  });
});

describe("averageFromTotals — caminho agregado do dashboard", () => {
  it("calcula a média a partir de soma e contagem", () => {
    assert.equal(averageFromTotals(19, 5), 3.8);
  });

  it("contagem zero devolve null e nunca divide por zero", () => {
    assert.equal(averageFromTotals(0, 0), null);
    assert.equal(averageFromTotals(10, 0), null);
  });

  it("entrada não finita devolve null", () => {
    assert.equal(averageFromTotals(Number.NaN, 5), null);
    assert.equal(averageFromTotals(5, Number.POSITIVE_INFINITY), null);
  });
});

describe("taxa de resposta", () => {
  it("concluídos sobre convites ativos", () => {
    assert.equal(calculateResponseRate({ activeInvitations: 40, completedInvitations: 10 }), 25);
  });

  it("ELIMINATÓRIO: sem denominador confiável a taxa é null (import histórico)", () => {
    // O Google Forms não nos diz quantos foram convidados. Inventar o
    // denominador falsearia a série histórica.
    assert.equal(calculateResponseRate({ activeInvitations: 0, completedInvitations: 37 }), null);
  });

  it("nunca passa de 100% mesmo com dado inconsistente", () => {
    assert.equal(calculateResponseRate({ activeInvitations: 5, completedInvitations: 9 }), 100);
  });
});

describe("abandono e funil", () => {
  it("abandono = (iniciados - concluídos) / iniciados", () => {
    assert.equal(calculateAbandonmentRate({ startedCount: 10, completedCount: 4 }), 60);
  });

  it("ninguém iniciou = null", () => {
    assert.equal(calculateAbandonmentRate({ startedCount: 0, completedCount: 0 }), null);
  });

  it("concluídos acima de iniciados não gera taxa negativa", () => {
    assert.equal(calculateAbandonmentRate({ startedCount: 3, completedCount: 5 }), 0);
  });

  it("taxa de funil respeita denominador zero", () => {
    assert.equal(calculateFunnelRate(5, 0), null);
    assert.equal(calculateFunnelRate(5, 20), 25);
  });
});

describe("alerta de cliente crítico", () => {
  it("qualquer nota <= 2 dispara alerta", () => {
    assert.equal(hasCriticalAlert([5, 5, 2]), true);
    assert.equal(hasCriticalAlert([5, 4, 3]), false);
  });

  it("nível CRITICAL quando há nota 1 ou 2", () => {
    assert.equal(resolveAlertLevel([5, 5, 1]), "CRITICAL");
  });

  it("nível ATTENTION quando média baixa sem nota crítica", () => {
    // 3,3 de média, nenhuma nota <= 2
    assert.equal(resolveAlertLevel([3, 3, 4, 3, 3, 4]), "ATTENTION");
  });

  it("sem nota válida não há alerta", () => {
    assert.equal(resolveAlertLevel([null, undefined]), "NONE");
  });
});

describe("satisfação por critério", () => {
  it("ordena do pior para o melhor — o que precisa de ação vem primeiro", () => {
    const result = summarizeCriteria([
      { questionCode: "PRODUCT_QUALITY", label: "Qualidade", sortOrder: 1, ratings: [5, 5, 4] },
      { questionCode: "DELIVERY_DEADLINE", label: "Prazo", sortOrder: 2, ratings: [2, 3, 3] },
      { questionCode: "TECHNICAL_SUPPORT", label: "Suporte", sortOrder: 3, ratings: [4, 4, 4] },
    ]);
    assert.deepEqual(
      result.map((r) => r.questionCode),
      ["DELIVERY_DEADLINE", "TECHNICAL_SUPPORT", "PRODUCT_QUALITY"]
    );
    assert.equal(result[0]?.average, 2.67);
  });

  it("critério sem resposta vai para o fim, com média null", () => {
    const result = summarizeCriteria([
      { questionCode: "SEM_DADO", label: "Sem dado", sortOrder: 1, ratings: [] },
      { questionCode: "COM_DADO", label: "Com dado", sortOrder: 2, ratings: [4] },
    ]);
    assert.equal(result[0]?.questionCode, "COM_DADO");
    assert.equal(result[1]?.questionCode, "SEM_DADO");
    assert.equal(result[1]?.average, null);
  });
});

describe("tendência entre campanhas", () => {
  it("sobe, desce e estabiliza", () => {
    assert.equal(resolveTrend(4.5, 4.0).trend, "UP");
    assert.equal(resolveTrend(4.0, 4.5).trend, "DOWN");
    assert.equal(resolveTrend(4.0, 4.02).trend, "STABLE");
  });

  it("sem comparativo a tendência é UNKNOWN, não STABLE", () => {
    assert.equal(resolveTrend(4.2, null).trend, "UNKNOWN");
    assert.equal(resolveTrend(null, 4.2).delta, null);
  });
});

describe("ausência deliberada de NPS", () => {
  it("o módulo de métricas não expõe nenhuma função de NPS/CES", async () => {
    // O V1 não tem pergunta 0–10 de recomendação. Converter 1–5 em NPS seria
    // inventar metodologia e quebrar a comparabilidade com o histórico.
    const mod = await import("./satisfactionMetrics.js");
    const suspicious = Object.keys(mod).filter((key) => /nps|promoter|detractor|ces/i.test(key));
    assert.deepEqual(suspicious, []);
  });
});
