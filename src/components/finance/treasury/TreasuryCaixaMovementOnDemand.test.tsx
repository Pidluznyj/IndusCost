/**
 * Caixa — abrir a tela carrega SÓ os saldos (Caixa hoje); a movimentação (tudo
 * abaixo) só carrega em "Carregar movimentação" (ou Pesquisar).
 *
 * A página importa CSS e não roda por SSR no node:test: o card do botão e o
 * aviso são testados por markup; a página, por gates sobre o fonte (quem busca
 * o quê e quando).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TreasuryCaixaPendingBalance } from "@/src/lib/treasury/treasuryCaixaPendingBalances.js";
import { TreasuryCaixaMovementPlaceholder } from "./TreasuryCaixaMovementPlaceholder.js";
import { TreasuryCaixaStaleBanner } from "./TreasuryCaixaStaleBanner.js";

const here = dirname(fileURLToPath(import.meta.url));
// CRLF do checkout no Windows → LF, para os gates valerem igual em qualquer máquina.
const page = readFileSync(join(here, "TreasuryCaixaPage.tsx"), "utf8").replace(/\r\n/g, "\n");

/** Trecho do fonte de `start` até o primeiro `end` depois dele. */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `trecho não encontrado: ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `fim do trecho não encontrado: ${end}`);
  return source.slice(from, to + end.length);
}

/** Cada useEffect da página, da abertura até o array de dependências. */
function effects(source: string): string[] {
  const out: string[] = [];
  let at = source.indexOf("useEffect(() => {");
  while (at >= 0) {
    const deps = source.indexOf("}, [", at);
    out.push(source.slice(at, source.indexOf("]);", deps) + 3));
    at = source.indexOf("useEffect(() => {", deps);
  }
  return out;
}

const pending: TreasuryCaixaPendingBalance = {
  accountId: "acc-1",
  accountName: "Viacredi - Koppetel",
  civilDate: "2026-09-15",
  openingBalance: "131000.00",
  closingBalance: null,
  savedAt: "2026-09-15T13:32:00.000Z",
};

describe("Caixa — card Carregar movimentação (markup)", () => {
  it("explica o que fica para depois e oferece o botão", () => {
    const html = renderToStaticMarkup(<TreasuryCaixaMovementPlaceholder onLoad={() => {}} />);
    assert.match(html, /data-testid="caixa-movement-placeholder"/);
    assert.match(html, /Movimentação não carregada/);
    assert.match(html, /a tela carrega só os saldos\./);
    assert.match(html, /<button type="button"[^>]*data-testid="caixa-movement-load"[^>]*>.*Carregar movimentação<\/button>/);
  });
});

describe("Caixa — aviso de dados desatualizados conforme a movimentação", () => {
  it("sem movimentação carregada, fala só do Caixa hoje", () => {
    const html = renderToStaticMarkup(
      <TreasuryCaixaStaleBanner pendingBalances={[pending]} movementLoaded={false} onRefresh={() => {}} />
    );
    assert.match(
      html,
      /O saldo já está salvo\. Caixa hoje só passa a considerá-lo ao atualizar a tela ou carregar a movimentação\./
    );
    assert.doesNotMatch(html, /Movimento de hoje/);
  });

  it("com a movimentação carregada (padrão), mantém o texto completo", () => {
    const html = renderToStaticMarkup(<TreasuryCaixaStaleBanner pendingBalances={[pending]} onRefresh={() => {}} />);
    assert.match(
      html,
      /O saldo já está salvo\. Caixa hoje, Movimento de hoje, Linha do tempo e Projeção só passam a considerá-lo depois de atualizar a tela\./
    );
  });
});

describe("Caixa — abrir a tela carrega só os saldos (gates do fonte)", () => {
  it("a carga de abertura busca só as contas e o saldo mais recente de cada uma", () => {
    const loadAccounts = between(page, "const loadAccounts = useCallback(", "}, []);");
    assert.ok(loadAccounts.includes("fetchTreasuryAccounts("));
    assert.ok(loadAccounts.includes("fetchTreasuryAccountLatestBalance("));
    for (const heavy of ["fetchTreasuryTodayClosing", "fetchTreasuryCaixa", "fetchTreasuryAgenda", "loadScenarios", "search("]) {
      assert.equal(loadAccounts.includes(heavy), false, `abrir a tela não pode chamar ${heavy}`);
    }
    assert.ok(
      page.includes(
        "useEffect(() => {\n    void loadAccounts();\n    return () => accountsAbortRef.current?.abort();\n  }, [loadAccounts]);"
      ),
      "contas carregam ao abrir, sem condição"
    );
  });

  it("todo efeito que busca a movimentação espera Carregar movimentação", () => {
    const all = effects(page);
    const heavy = all.filter((body) => /loadTodayFlow\(\)|search\(\)|loadScenarios\(\)/.test(body));
    assert.equal(heavy.length, 3, "movimento de hoje, primeira busca do período e projeção");
    for (const body of heavy) {
      assert.match(body, /if \(!movementRequested[ )]/, `efeito sem esperar a movimentação:\n${body}`);
      assert.match(body, /\}, \[movementRequested, /, `efeito precisa depender de movementRequested:\n${body}`);
    }
    assert.equal(all.length, heavy.length + 1, "além deles, só o efeito das contas");
  });

  it("Pesquisar antes de carregar é o próprio Carregar movimentação; depois, só o período", () => {
    assert.ok(page.includes("onClick={() => (movementRequested ? void search() : requestMovement())}"));
  });

  it("Carregar movimentação libera a seção — e saldos lançados antes entram junto", () => {
    const request = between(page, "const requestMovement = useCallback(", "}, [");
    assert.match(request, /if \(movementRequested\) return;/);
    assert.match(request, /if \(pendingBalances\.length > 0\) \{\s*setPendingBalances\(\[\]\);\s*void loadAccounts\(\);\s*\}/);
    assert.match(request, /setMovementRequested\(true\);/);
    assert.match(request, /setLoading\(true\);/);
    // Nada pesado direto no clique: quem busca são os efeitos que esperam a movimentação.
    for (const direct of ["loadTodayFlow(", "search(", "loadScenarios("]) {
      assert.equal(request.includes(direct), false, `requestMovement não chama ${direct} direto`);
    }
  });

  it("Atualizar tela: saldos sempre; movimentação só se já estiver carregada", () => {
    const refresh = between(page, "const refreshScreen = useCallback(", "}, [");
    const guard = refresh.indexOf("if (!movementRequested) return;");
    assert.ok(guard > 0, "guarda da movimentação");
    for (const step of ["setPendingBalances([])", "loadAccounts()"]) {
      const at = refresh.indexOf(step);
      assert.ok(at >= 0 && at < guard, `${step} antes da guarda`);
    }
    for (const step of ["loadTodayFlow()", "search()", "loadScenarios()"]) {
      assert.ok(refresh.indexOf(step) > guard, `${step} só com a movimentação carregada`);
    }
  });

  it("tudo abaixo do Caixa hoje fica dentro do bloco sob demanda", () => {
    const summary = page.indexOf("<TreasuryCaixaAccountsSummary\n");
    const gate = page.indexOf("{!movementRequested ? (");
    const placeholder = page.indexOf("<TreasuryCaixaMovementPlaceholder onLoad={requestMovement} />");
    const loaded = page.indexOf(") : (\n          <>", gate);
    const end = page.indexOf("          </>\n        )}\n      </div>");
    assert.ok(summary > 0 && summary < gate, "Caixa hoje antes do bloco");
    assert.ok(gate < placeholder && placeholder < loaded && loaded < end, "card do botão no ramo não carregado");
    for (const section of [
      "<TreasuryCaixaTodayFlow\n",
      "<TreasuryCaixaOverdueStrip ",
      "<TreasuryCaixaTimeline\n",
      "<TreasuryCaixaBalanceChart\n",
      "<TreasuryCaixaScenariosChart\n",
      'label="Já Recebido"',
      'data-testid="caixa-receivables-section"',
      'data-testid="caixa-payables-section"',
      "Selecione o período e clique em Pesquisar.",
    ]) {
      const at = page.indexOf(section);
      assert.ok(at > loaded && at < end, `${section.trim()} dentro do bloco carregado`);
    }
    // Filtros e aviso seguem acima do Caixa hoje, sempre visíveis.
    assert.ok(page.indexOf('data-testid="caixa-filters"') < summary);
    assert.ok(page.indexOf("<TreasuryCaixaStaleBanner") < summary);
    assert.match(
      page,
      /<TreasuryCaixaStaleBanner\s+pendingBalances=\{pendingBalances\}\s+movementLoaded=\{movementRequested\}\s+onRefresh=\{refreshScreen\}\s*\/>/
    );
    assert.match(page, /<TreasuryCaixaTodayFlow\n[\s\S]{0,600}?loading=\{todayFlowLoading \|\| \(loading && data == null\)\}/);
  });

  it("atraso recente D+1..D+3 viaja no board já carregado — sem endpoint extra", () => {
    const search = between(page, "const search = useCallback(async () => {", "}, [year, month, day, accounts]);");
    assert.equal(
      (search.match(/fetchTreasuryCaixa\(/g) ?? []).length,
      1,
      "Pesquisar/Carregar movimentação continua com uma única chamada do board"
    );
    assert.ok(page.includes("recentOverdueReceivables={data?.recentOverdueReceivables}"));
    assert.equal(page.includes("fetchTreasuryCaixaRecentOverdue"), false);
    const request = between(page, "const requestMovement = useCallback(", "}, [");
    assert.equal(request.includes("fetchTreasuryCaixa("), false);
  });
});
