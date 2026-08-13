import assert from "node:assert/strict";
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
});
