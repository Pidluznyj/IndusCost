import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalKeyResultWizardDialog } from "./GoalKeyResultWizardDialog.js";
import type { GoalDto } from "@/src/lib/goals/goalContracts.js";

const goal: GoalDto = {
  id: "goal-1",
  title: "Dominar a Tração Comercial",
  description: null,
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  status: "ACTIVE",
  ownerAppUserId: "owner-1",
  ownerName: "Paulo",
  progressPercent: 40,
  activeKeyResults: 1,
  invalidKeyResults: 0,
  keyResults: [],
  initiatives: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("GoalKeyResultWizardDialog — adicionar indicador a Objetivo existente", () => {
  it("deixa claro que o indicador entra DENTRO do objetivo já escolhido (nunca cria outro)", () => {
    const html = renderToStaticMarkup(
      <GoalKeyResultWizardDialog
        goal={goal}
        owners={[{ id: "owner-1", name: "Paulo" }]}
        metadataEntities={[]}
        onCancel={() => {}}
        onCreated={() => {}}
      />
    );
    assert.ok(html.includes('data-testid="kr-wizard"'));
    assert.ok(
      html.includes(goal.title),
      "o nome do objetivo aparece no cabeçalho — sem ambiguidade de onde o indicador vai parar"
    );
    assert.ok(html.includes("Novo indicador em"));
    // 3 passos (sem o passo de Direção, que já existe no objetivo escolhido).
    assert.ok(html.includes("passo 1 de 3") || html.includes("passo 1 de 3".toLowerCase()));
  });

  it("mesma frase conversacional do wizard de Objetivo — sem termos técnicos", () => {
    const html = renderToStaticMarkup(
      <GoalKeyResultWizardDialog
        goal={goal}
        owners={[]}
        metadataEntities={[
          {
            key: "SALES_ORDERS",
            label: "Pedidos de Venda",
            domain: "COMERCIAL",
            supportsQuotaSplit: true,
            metrics: [],
            filterFields: [],
          },
        ]}
        onCancel={() => {}}
        onCreated={() => {}}
      />
    );
    assert.ok(html.includes("Eu quero acompanhar"));
    assert.ok(html.includes("Pedidos de Venda"));
    // "join" bare demais: SVG dos ícones (lucide) usa stroke-linejoin como
    // atributo — falso positivo. Mesmo vocabulário proibido do cockpit.
    for (const forbidden of ["banco de dados", "agregação", "operador lógico", " sql"]) {
      assert.ok(
        !html.toLowerCase().includes(forbidden),
        `termo técnico vazou: ${forbidden}`
      );
    }
  });

  it("botão final chama a ação de adicionar (não de criar objetivo)", () => {
    const html = renderToStaticMarkup(
      <GoalKeyResultWizardDialog
        goal={goal}
        owners={[]}
        metadataEntities={[]}
        onCancel={() => {}}
        onCreated={() => {}}
      />
    );
    assert.ok(!html.includes("Ligar os Motores"), "não deve reusar o texto do wizard de Objetivo");
  });
});
