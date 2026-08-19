import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExecutiveReportImagesZipFilename,
  executiveReportPageLabel,
  extractMediaPrintBlocks,
} from "./financeExecutiveReportImageExport.js";

describe("extractMediaPrintBlocks", () => {
  it("extrai o conteúdo de um único bloco @media print, sem o wrapper", () => {
    const css = `
      @page { size: A4 landscape; margin: 6mm; }
      @media print {
        .foo { color: red; }
      }
    `;
    const out = extractMediaPrintBlocks(css);
    assert.match(out, /\.foo \{ color: red; \}/);
    assert.doesNotMatch(out, /@media print/);
    assert.doesNotMatch(out, /@page/);
  });

  it("concatena múltiplos blocos @media print em ordem", () => {
    const css = `
      @media print { .a { color: red; } }
      @media screen { .b { display: none; } }
      @media print { .c { color: blue; } }
    `;
    const out = extractMediaPrintBlocks(css);
    assert.match(out, /\.a \{ color: red; \}/);
    assert.match(out, /\.c \{ color: blue; \}/);
    assert.doesNotMatch(out, /\.b \{ display: none; \}/);
    // ordem preservada
    assert.ok(out.indexOf(".a") < out.indexOf(".c"));
  });

  it("respeita aninhamento de chaves — não para na primeira '}' interna", () => {
    const css = `
      @media print {
        .parent {
          background: linear-gradient(135deg, #000 0%, #fff 100%);
        }
        .child { padding: 1mm; }
      }
      .outside { color: green; }
    `;
    const out = extractMediaPrintBlocks(css);
    assert.match(out, /\.parent \{/);
    assert.match(out, /\.child \{ padding: 1mm; \}/);
    assert.doesNotMatch(out, /\.outside/);
  });

  it("retorna string vazia quando não há @media print", () => {
    const css = `@page { size: A4; } @media screen { .a { color: red; } }`;
    assert.equal(extractMediaPrintBlocks(css), "");
  });

  it("não injeta CSS quebrado quando as chaves estão desbalanceadas", () => {
    const css = `@media print { .a { color: red; `; // sem fechamento
    const out = extractMediaPrintBlocks(css);
    assert.equal(out, "");
  });
});

describe("executiveReportPageLabel", () => {
  it("mapeia ids conhecidos para rótulos em pt-BR", () => {
    assert.equal(executiveReportPageLabel("cover"), "capa");
    assert.equal(executiveReportPageLabel("cash-radar"), "radar-diario-caixa");
  });

  it("cai no próprio id quando desconhecido (nunca quebra a exportação)", () => {
    assert.equal(executiveReportPageLabel("nova-pagina-futura"), "nova-pagina-futura");
  });
});

describe("buildExecutiveReportImagesZipFilename", () => {
  it("formata como relatorio-presidencial-imagens-AAAA-MM-DD.zip", () => {
    const name = buildExecutiveReportImagesZipFilename(new Date(2026, 7, 19)); // 19/08/2026
    assert.equal(name, "relatorio-presidencial-imagens-2026-08-19.zip");
  });
});
