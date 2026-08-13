import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/src/contexts/AuthContext.js";
import { GoalsCockpitPage } from "./GoalsCockpitPage.js";

/** SSR estático não executa effects — AuthProvider/Router são seguros aqui. */
function renderPage(): string {
  return renderToStaticMarkup(
    <AuthProvider>
      <MemoryRouter>
        <GoalsCockpitPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("GoalsCockpitPage — render inicial (SSR, sem effects)", () => {
  it("renderiza cockpit com título, novo objetivo e filtros rápidos (Tela 1)", () => {
    const html = renderPage();
    assert.ok(html.includes('data-testid="goals-cockpit"'));
    assert.ok(html.includes("Metas (OKR)"));
    assert.ok(html.includes('data-testid="goals-new-goal"'));
    assert.ok(html.includes('data-testid="goals-only-mine"'), "botão Minhas Metas");
    assert.ok(html.includes('data-testid="goals-view-team"'), "botão Minha Equipe");
    assert.ok(html.includes('data-testid="goals-view-all"'), "botão Empresa");
    assert.ok(html.includes('data-testid="goals-year"'), "seletor de ano");
    assert.ok(html.includes("Carregando metas…"), "estado inicial é loading");
  });

  it("progresso é apresentado como somente leitura (derivado)", () => {
    const html = renderPage();
    assert.ok(html.includes("somente leitura"));
  });

  it("linguagem leiga: nenhum termo técnico proibido pela spec aparece na tela", () => {
    const html = renderPage().toLowerCase();
    // "Esconder a Complexidade": o usuário nunca lê Banco de Dados,
    // Agregação, Join ou Operador Lógico (termos exatos da especificação).
    for (const forbidden of [
      "banco de dados",
      "agregação",
      "operador lógico",
      " sql",
      "tabela do banco",
    ]) {
      assert.ok(!html.includes(forbidden), `termo técnico vazou na UI: ${forbidden}`);
    }
  });

  it("trava de regressão: sem jargão 'KR'/'Key Result' nos textos visíveis; drill-down e '+ Indicador' presentes", () => {
    // Botões que só aparecem DENTRO de um card de Objetivo (após o load
    // assíncrono) não renderizam em SSR estático sem dados — por isso a
    // prova aqui é no CÓDIGO-FONTE: garante que os rótulos certos existem e
    // que o jargão de backlog ("KR", "Key Result") nunca volta a aparecer
    // em texto visível ao usuário (comentários e nomes internos tudo bem).
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "GoalsCockpitPage.tsx"), "utf8");

    assert.ok(source.includes('"+ Indicador"') || source.includes(">+ Indicador<") || source.includes("+ Indicador"), "botão de adicionar indicador");
    assert.ok(source.includes("Abrir meta"), "CTA primário de drill-down");
    assert.ok(source.includes("GoalKeyResultWizardDialog"), "criação de indicador usa o assistente conversacional");

    // Strings de JSX visíveis que continham o jargão no defeito original —
    // nenhuma pode voltar a existir.
    for (const forbidden of [
      "+ KR",
      "Editar KR",
      "Novo Key Result",
      "Editar Key Result",
      "Criar KR",
      "Excluir/arquivar KR",
      "Responsável (Owner)",
    ]) {
      assert.ok(!source.includes(forbidden), `jargão "KR"/"Owner" voltou ao código-fonte: ${forbidden}`);
    }
  });
});
