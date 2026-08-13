/**
 * Wizard de criação de Objetivo — render SSR do Passo 1 (Direção).
 *
 * Trava o que o usuário reclamou de não achar: prazo em 1 clique (períodos
 * rápidos) e linguagem 100% leiga em toda a tela.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalWizardDialog } from "./GoalWizardDialog.js";

function render() {
  return renderToStaticMarkup(
    <GoalWizardDialog
      owners={[{ id: "owner-1", name: "Paulo Pidluznyj" }]}
      metadataEntities={[]}
      onCancel={() => {}}
      onCreated={() => {}}
    />
  );
}

describe("GoalWizardDialog — Passo 1 (Direção)", () => {
  it("abre no passo 1 de 4 com nome, prazo e dono", () => {
    const html = render();
    assert.ok(html.includes('data-testid="goal-wizard"'));
    assert.ok(html.includes("Passo 1 de 4"));
    assert.ok(html.includes("Onde queremos chegar?"));
    assert.ok(html.includes('data-testid="wizard-title"'));
    assert.ok(html.includes("Quem é o dono desse objetivo?"));
  });

  it("prazo em 1 clique: períodos rápidos (ano/semestre/trimestre)", () => {
    const html = render();
    assert.ok(html.includes('data-testid="wizard-quick-periods"'));
    assert.ok(html.includes('data-testid="wizard-period-YEAR"'));
    assert.ok(html.includes('data-testid="wizard-period-SEMESTER"'));
    assert.ok(html.includes('data-testid="wizard-period-QUARTER"'));
    assert.ok(html.includes("Este ano"));
    assert.ok(html.includes("ou escolha datas específicas"));
  });

  it("linguagem leiga: nenhum termo técnico da spec aparece", () => {
    const html = render().toLowerCase();
    for (const forbidden of [
      "banco de dados",
      "agregação",
      "operador lógico",
      " sql",
      "key result",
    ]) {
      assert.ok(!html.includes(forbidden), `termo técnico vazou: ${forbidden}`);
    }
  });
});
