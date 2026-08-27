/**
 * One Page — download do relatório em JPEG (A4 retrato).
 *
 * Trava:
 *  1. a captura usa o utilitário oficial de JPEG (html-to-image SOB DEMANDA
 *     — nunca html2canvas, que quebra com as cores oklch do tema);
 *  2. a folha de impressão tem largura A4 retrato (794 px lógicos → ~2480 px
 *     a 300 DPI) e fica FORA da tela sem display:none (display:none zeraria
 *     o ResponsiveContainer e os gráficos sairiam vazios);
 *  3. no modo impressão os gráficos ficam SEM animação — capturar no meio da
 *     animação cortaria as linhas;
 *  4. o corpo do relatório é o MESMO componente da tela (nada de segunda
 *     fonte de verdade de KPI) e o grid vira 3 colunas no retrato.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

describe("Finance One Page — download JPEG", () => {
  const page = readFileSync(
    join(ROOT, "src/components/finance/FinanceOnePage.tsx"),
    "utf8"
  );

  it("botão Baixar JPEG presente e desabilitado sem dados ou durante a geração", () => {
    assert.match(page, /data-testid="finance-one-page-download-jpeg"/);
    assert.match(page, /disabled=\{!data \|\| loading \|\| printing\}/);
  });

  it("captura usa o utilitário oficial (html-to-image sob demanda)", () => {
    assert.match(page, /exportTreasuryElementToJpeg/);
    assert.match(
      page,
      /buildTreasuryJpegFileName\("one-page-financeiro"\)/,
      "nome de arquivo determinístico com data local"
    );
    // ELIMINATÓRIO: nenhuma lib de captura importada direto no componente.
    assert.doesNotMatch(page, /^import[^\n]*html-to-image/m);
    assert.doesNotMatch(page, /html2canvas/);
  });

  it("folha de impressão: largura A4 retrato, off-screen SEM display:none", () => {
    assert.match(page, /ONE_PAGE_PRINT_WIDTH_PX = 794/);
    assert.match(page, /data-testid="finance-one-page-print-surface"/);
    assert.match(page, /position: "fixed"/);
    assert.match(page, /left: -10000/);
    // Uso REAL em style ({ display: "none" } / className hidden na folha);
    // comentários explicativos não contam.
    assert.doesNotMatch(
      page,
      /display:\s*["']none["']/,
      "display none zera o ResponsiveContainer — gráficos sairiam vazios"
    );
    const surfaceIdx = page.indexOf("finance-one-page-print-surface");
    const surfaceBlock = page.slice(surfaceIdx, surfaceIdx + 600);
    assert.doesNotMatch(surfaceBlock, /\bhidden\b/);
    // ELIMINATÓRIO (provado em captura real): o clone preserva o computed
    // style do nó raiz — se o ref apontar para o elemento com position:fixed
    // e left:-10000, o conteúdo clonado sai do quadro e o JPEG vem em BRANCO.
    // O ref precisa estar num filho ESTÁTICO dentro do wrapper posicionado.
    const refIdx = page.indexOf("ref={printRef}");
    const refBlock = page.slice(refIdx, refIdx + 400);
    assert.ok(refIdx > 0, "printRef presente");
    assert.doesNotMatch(
      refBlock,
      /position:\s*["']fixed["']/,
      "o nó capturado não pode ser o wrapper fixed/off-screen"
    );
    assert.match(
      refBlock,
      /width:\s*ONE_PAGE_PRINT_WIDTH_PX/,
      "a largura A4 fica no nó capturado"
    );
  });

  it("modo impressão desliga a animação das 4 linhas dos gráficos", () => {
    const occurrences = page.match(/isAnimationActive=\{!print\}/g) ?? [];
    assert.equal(
      occurrences.length,
      4,
      "as 4 séries (ano anterior, ano atual, meta, projeção) sem animação no print"
    );
  });

  it("corpo único: tela e impressão renderizam o MESMO OnePageReportBody", () => {
    const bodies = page.match(/<OnePageReportBody/g) ?? [];
    assert.equal(bodies.length, 2, "uma instância na tela, uma na folha");
    assert.match(page, /print=\{false\}/);
    // Grid do retrato: 3 colunas fixas (as media queries do Tailwind olham a
    // JANELA, não o contêiner de 794px — 6 colunas sairiam ilegíveis).
    assert.match(page, /grid grid-cols-3 gap-3/);
  });

  it("cabeçalho da folha identifica período, ano, atualização e geração", () => {
    assert.match(page, /One Page — Financeiro/);
    assert.match(page, /Gerado em/);
    assert.match(page, /Dados atualizados até \{data\.updatedAt/);
  });
});
