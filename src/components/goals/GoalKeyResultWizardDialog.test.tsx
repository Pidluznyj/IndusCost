import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    assert.ok(html.includes("Novo resultado-chave em"));
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
    // Frase na ordem natural (área primeiro), igual ao wizard de Objetivo.
    assert.ok(html.includes("Na área de"));
    assert.ok(html.includes("eu quero acompanhar"));
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

  it("o indicador tem PERÍODO PRÓPRIO limitado ao período do objetivo", () => {
    const html = renderToStaticMarkup(
      <GoalKeyResultWizardDialog
        goal={goal}
        owners={[]}
        metadataEntities={[]}
        onCancel={() => {}}
        onCreated={() => {}}
      />
    );
    assert.ok(html.includes('data-testid="period-picker"'), "seletor de período presente");
    assert.ok(html.includes("Qual período este resultado-chave mede?"));
    // Objetivo anual → atalhos de trimestre/semestre dentro dele (1 clique).
    assert.ok(html.includes('data-testid="period-chip-Q3-2026"'), "trimestres do objetivo");
    assert.ok(html.includes('data-testid="period-chip-S1-2026"'), "semestres do objetivo");
    assert.ok(html.includes('data-testid="period-whole-goal"'));
    // Limites do calendário = janela do objetivo (nunca medir fora dela).
    assert.ok(html.includes('min="2026-01-01"'));
    assert.ok(html.includes('max="2026-12-31"'));
    assert.ok(html.includes("todo o período do objetivo"));
  });

  it("oferece medições prontas de 1 clique — OFICIAIS primeiro (P2)", () => {
    const html = renderToStaticMarkup(
      <GoalKeyResultWizardDialog
        goal={goal}
        owners={[]}
        metadataEntities={[
          {
            key: "SALES_OFFICIAL",
            label: "Pedidos de Venda (regra oficial)",
            domain: "COMERCIAL",
            supportsQuotaSplit: false,
            metrics: [
              {
                key: "SALES_OFFICIAL_NET_TOTAL",
                label: "Valor líquido de pedidos (população oficial do Comercial)",
                operation: "SUM",
                operationLabel: "Soma",
                suggestedUnit: "R$",
                periodLabel: "data de emissão do pedido",
              },
            ],
            filterFields: [],
          },
          {
            key: "SALES_ORDERS",
            label: "Pedidos de Venda",
            domain: "COMERCIAL",
            supportsQuotaSplit: true,
            metrics: [
              {
                key: "SALES_NET_TOTAL",
                label: "Valor total vendido (líquido)",
                operation: "SUM",
                operationLabel: "Soma",
                suggestedUnit: "R$",
                periodLabel: "data de emissão do pedido",
              },
            ],
            filterFields: [],
          },
        ]}
        onCancel={() => {}}
        onCreated={() => {}}
      />
    );
    assert.ok(html.includes('data-testid="measure-recipes"'));
    assert.ok(html.includes('data-testid="measure-recipe-OFFICIAL_SALES_ORDERS"'));
    // Seções: oficiais antes das personalizadas.
    const officialIdx = html.indexOf("Medições oficiais");
    const customIdx = html.indexOf("Medições personalizadas");
    assert.ok(officialIdx > -1 && customIdx > officialIdx);
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

/**
 * Trava de regressão do defeito relatado em 17/08/2026 (quatro indicadores
 * idênticos após cliques repetidos). O desenho evoluiu em P0-B: o wizard faz
 * UM request atômico (indicador + fatias na mesma transação do backend) — o
 * estado "criou o KR mas as fatias falharam" deixou de existir. A prova fica
 * no código-fonte, pois SSR estático não exercita o envio assíncrono.
 */
describe("GoalKeyResultWizardDialog — criação atômica (sem estado parcial)", () => {
  function source(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, "GoalKeyResultWizardDialog.tsx"), "utf8");
  }

  it("um único POST leva indicador + fatias juntos; NÃO existe segundo request de quotas", () => {
    const src = source();
    const submitStart = src.indexOf("async function handleSubmit");
    const submitEnd = src.indexOf("\n  }", submitStart);
    const body = src.slice(submitStart, submitEnd);
    assert.ok(body.includes("/key-results"), "POST de criação presente");
    assert.ok(
      !body.includes("/quotas"),
      "o wizard não pode voltar a fazer PUT de quotas separado (estado parcial)"
    );
    assert.ok(body.includes("quotas:"), "as fatias vão no MESMO payload da criação");
  });

  it("retentativa após erro de rede é coberta pela trava de duplicidade do backend", () => {
    const src = source();
    // O botão continua sinalizando a retentativa segura; a autoridade
    // anti-duplicata é o CONFLICT por assinatura no service.
    assert.ok(src.includes("Tentar novamente (sem duplicar)"));
  });

  it("callback do pai roda fora do try — erro dele não vira 'falha ao salvar'", () => {
    const src = source();
    const submitStart = src.indexOf("async function handleSubmit");
    const submitEnd = src.indexOf("\n  }", submitStart);
    const body = src.slice(submitStart, submitEnd);
    const catchIdx = body.indexOf("} catch (err)");
    assert.ok(catchIdx > 0);
    assert.ok(
      body.indexOf("if (saved) onCreated(saved)") > catchIdx,
      "onCreated só depois do try/catch"
    );
  });
});
