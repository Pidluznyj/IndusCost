/**
 * Metas (OKR) — travas de semântica e integridade (P0-A).
 *
 * Este arquivo prova, por unidade pura e por guard de código-fonte, que:
 *  1. o calendário civil de negócio do módulo é America/Sao_Paulo (nunca UTC);
 *  2. falha da primeira medição nunca vira "zero confirmado" silencioso;
 *  3. o cockpit não oferece "Lançar valor" para indicador automático;
 *  4. o wizard padrão não constrói regra com OR (composição só com AND) e a
 *     regra legada com OR é preservada/sinalizada, nunca regravada mudada.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  currentGoalCivilMonthInSaoPaulo,
  todayGoalCivilDateInSaoPaulo,
} from "./goalService.server.js";
import { buildRuleFromWizardState } from "../../components/goals/goalWizardShared.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(join(HERE, "goalService.server.ts"), "utf8");
const cockpitSource = readFileSync(
  join(HERE, "../../components/goals/GoalsCockpitPage.tsx"),
  "utf8"
);
const wizardSharedSource = readFileSync(
  join(HERE, "../../components/goals/goalWizardShared.tsx"),
  "utf8"
);

describe("calendário civil do módulo — America/Sao_Paulo, nunca UTC", () => {
  it("perto da virada UTC o dia/mês de negócio ainda é o anterior em São Paulo", () => {
    // 01/09 01:30 UTC = 31/08 22:30 em São Paulo (UTC-3).
    const nearMidnight = new Date("2026-09-01T01:30:00.000Z");
    assert.equal(todayGoalCivilDateInSaoPaulo(nearMidnight), "2026-08-31");
    assert.equal(currentGoalCivilMonthInSaoPaulo(nearMidnight), "2026-08");
    // De dia, os dois calendários coincidem.
    assert.equal(currentGoalCivilMonthInSaoPaulo(new Date("2026-09-15T12:00:00.000Z")), "2026-09");
  });

  it("nenhuma decisão de mês corrente no service usa o mês UTC", () => {
    assert.ok(
      !serviceSource.includes("new Date().toISOString().slice(0, 7)"),
      "mês corrente derivado de toISOString (UTC) voltou ao service"
    );
    assert.ok(
      serviceSource.includes("currentGoalCivilMonthInSaoPaulo()"),
      "a série do indicador deve cortar o mês corrente pelo calendário de São Paulo"
    );
  });
});

describe("primeira medição falha ≠ zero confirmado", () => {
  it("os dois caminhos de criação capturam a falha e devolvem firstMeasurementFailed", () => {
    // A falha continua não desfazendo a criação (recuperação posterior é
    // deliberada), mas precisa ser DISTINGUÍVEL na resposta — nunca engolida.
    const occurrences = serviceSource.match(/firstMeasurementFailed = true/g) ?? [];
    assert.equal(
      occurrences.length,
      2,
      "createKeyResult e createFromWizard devem marcar a falha da primeira leitura"
    );
    assert.ok(
      !/} catch \{\s*\/\/ Falha da primeira leitura/.test(serviceSource),
      "catch silencioso da primeira leitura voltou ao service"
    );
  });

  it("o cockpit comunica a medição pendente ao usuário (aviso visível)", () => {
    assert.ok(cockpitSource.includes("firstMeasurementFailed"));
    assert.ok(cockpitSource.includes("primeira medição automática falhou"));
    assert.ok(cockpitSource.includes('data-testid="goals-notice"'));
  });
});

describe("cockpit — Lançar valor só para indicador manual", () => {
  it("o botão é condicionado a kr.manualTracking; automático mostra estado 'Automático'", () => {
    const gate = cockpitSource.indexOf("{kr.manualTracking ? (");
    const button = cockpitSource.indexOf("kr-set-value-");
    assert.ok(gate > 0, "gate por manualTracking ausente");
    assert.ok(button > gate, "o botão de lançar valor precisa estar DENTRO do gate manualTracking");
    assert.ok(cockpitSource.includes("Automático"), "estado 'Automático' ausente");
    assert.ok(cockpitSource.includes("kr-automatic-"));
  });

  it("KR com direção incompatível aparece sinalizado no cockpit", () => {
    assert.ok(cockpitSource.includes('kr.configurationIssue === "DIRECTION_MISMATCH"'));
    assert.ok(cockpitSource.includes("direção incompatível"));
  });
});

describe("wizard — novas regras compõem filtros apenas com AND", () => {
  it("a UI não oferece OR como opção de conector", () => {
    assert.ok(
      !wizardSharedSource.includes('{ value: "OR"'),
      "opção OR selecionável voltou ao builder de filtros"
    );
    // Novo filtro nasce AND.
    assert.ok(wizardSharedSource.includes('connector: "AND",'));
  });

  it("regra legada com OR é sinalizada como configuração legada e preservada", () => {
    assert.ok(wizardSharedSource.includes('filter.connector === "OR"'));
    assert.ok(wizardSharedSource.includes("configuração legada"));
  });

  it("buildRuleFromWizardState preserva o conector como está (legado OR incluído) — sem regravação silenciosa", () => {
    const legacy = buildRuleFromWizardState("SALES_ORDERS", "SALES_NET_TOTAL", [
      { id: "a", fieldKey: "SALES_COMPANY", operator: "CONTAINS", value: "Lazarios", connector: "AND" },
      { id: "b", fieldKey: "SALES_COMPANY", operator: "CONTAINS", value: "Koppetel", connector: "OR" },
    ]);
    assert.deepEqual(
      (legacy?.filters as Array<{ connector: string }>).map((f) => f.connector),
      ["AND", "OR"]
    );
  });
});
