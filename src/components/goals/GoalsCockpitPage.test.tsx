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
    assert.ok(html.includes("Objetivos e Metas"));
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

    assert.ok(source.includes("+ Resultado-chave"), "botão de adicionar resultado-chave");
    assert.ok(source.includes("Abrir objetivo"), "CTA primário de drill-down");
    assert.ok(source.includes("GoalKeyResultWizardDialog"), "criação de resultado-chave usa o assistente conversacional");

    // Strings de JSX visíveis que continham o jargão no defeito original —
    // nenhuma pode voltar a existir.
    for (const forbidden of [
      "+ KR",
      "+ Indicador",
      "Editar KR",
      "Novo Key Result",
      "Editar Key Result",
      "Criar KR",
      "Excluir/arquivar KR",
      "Responsável (Owner)",
      "Linha de base",
    ]) {
      assert.ok(!source.includes(forbidden), `jargão voltou ao código-fonte: ${forbidden}`);
    }
  });
});

describe("GoalsCockpitPage — P1: fluxo simples e hierarquia clara (fonte)", () => {
  function source(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, "GoalsCockpitPage.tsx"), "utf8");
  }

  it("Novo Objetivo cria SOMENTE o Objetivo (POST /api/goals) e convida ao primeiro resultado-chave", () => {
    const src = source();
    // O botão principal abre o formulário simples de Objetivo, não o wizard
    // completo Objetivo+KR.
    assert.ok(!src.includes("GoalWizardDialog"), "fluxo principal não depende do wizard Objetivo+KR");
    assert.ok(src.includes('fetchJsonOk<{ goal: GoalDto }>("/api/goals"'), "usa o POST canônico de Goal");
    assert.ok(src.includes("goal-created-confirmation"), "confirmação pós-criação");
    assert.ok(src.includes("+ Adicionar primeiro resultado-chave"));
    assert.ok(src.includes("Fazer isso depois"));
  });

  it("objetivo sem resultados-chave não aparenta 0% medido", () => {
    const src = source();
    assert.ok(src.includes("goal.activeKeyResults === 0"));
    assert.ok(src.includes("Este objetivo ainda não possui resultados-chave."));
  });

  it("filtros de visão dizem exatamente o que a lógica faz", () => {
    const src = source();
    assert.ok(src.includes("Minhas responsabilidades"));
    assert.ok(src.includes("Objetivos que lidero"));
    assert.ok(src.includes("Todos os objetivos"));
    for (const stale of ["Minhas Metas", "Metas da Minha Equipe", "Metas da Empresa"]) {
      assert.ok(!src.includes(`"${stale}"`), `rótulo antigo enganoso voltou: ${stale}`);
    }
  });

  it("KRs inválidos aparecem como 'configuração precisa de atenção' (nunca % falso)", () => {
    assert.ok(source().includes("configuração precisa de atenção"));
  });
});
