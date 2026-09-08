/**
 * Landing pública (rota "/") — render estático. Os componentes importam CSS, então
 * registramos o loader vazio para `.css` e carregamos a página dinamicamente.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

type LandingModule = typeof import("../components/LandingPage.js");
let LandingPage: LandingModule["LandingPage"];

before(async () => {
  LandingPage = (await import("../components/LandingPage.js")).LandingPage;
});

describe("LandingPage (rota /)", () => {
  it("renderiza as seções do cockpit com CTAs nas rotas internas do app", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );
    assert.match(html, /data-testid="public-landing"/);
    assert.match(html, /class="ic-landing"/);
    for (const text of [
      "O custo cirúrgico.",
      "Cockpit // proposta #0417",
      "Três movimentos. Uma única verdade numérica.",
      "Quanto a sua fábrica está deixando na mesa todo mês?",
      "Por que o IndusCost redefine a sua operação",
      "Continuar na planilha é o caminho mais caro",
      "As perguntas que a diretoria faz",
      "Projetado para a rotina de quem decide na fábrica",
    ]) {
      assert.ok(html.includes(text), `faltou: ${text}`);
    }
    assert.match(html, /href="\/login"/);
    assert.match(html, /href="\/guide"/);
    assert.doesNotMatch(html, /app\.grupolazarios\.com\.br/);
    assert.match(html, /id="fatRange"/);
    assert.match(html, /id="recuperadoValor"/);
  });

  it("CSS é escopado em .ic-landing e a landing estática mantém as URLs absolutas", () => {
    const css = readFileSync("src/components/landing/landing-page.css", "utf8");
    const selectors = css.match(/^[.#a-z:*][^{@\n]*\{/gm) ?? [];
    const unscoped = selectors.filter((s) => !/^\.ic-landing\b/.test(s) && !/^(from|to|\d+%)/.test(s));
    assert.deepEqual(unscoped, []);
    assert.doesNotMatch(css, /^\s*(html|body)\s*\{/m);
    const dist = readFileSync("landing-dist/index.html", "utf8");
    assert.match(dist, /href="https:\/\/app\.grupolazarios\.com\.br"/);
    assert.match(dist, /Cockpit \/\/ proposta #0417/);
  });
});
