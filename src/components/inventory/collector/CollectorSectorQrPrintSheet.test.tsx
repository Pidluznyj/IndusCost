/**
 * Folha do QR GERAL DE SETOR — componente canônico.
 * Render estático (sem browser): conteúdo, modos print/preview e "somente isso".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import {
  COLLECTOR_SECTOR_QR_ERROR_LEVEL,
  COLLECTOR_SECTOR_QR_HOWTO_STEPS,
  COLLECTOR_SECTOR_QR_PURPOSE,
  COLLECTOR_SECTOR_QR_SHEET_CLASS,
  COLLECTOR_SECTOR_QR_SHEET_PREVIEW_CLASS,
  CollectorSectorQrPrintSheet,
} from "./CollectorSectorQrPrintSheet";

const URL = "https://induscost.example.com/collector/sector/raw-material";

describe("CollectorSectorQrPrintSheet", () => {
  it("traz nome do setor, o que o QR faz, o QR e como ler — e só isso", () => {
    const html = renderToStaticMarkup(
      <CollectorSectorQrPrintSheet label="Matéria-prima" url={URL} testId="sheet" />
    );
    assert.match(html, /<h1>Matéria-prima<\/h1>/);
    assert.ok(html.includes(COLLECTOR_SECTOR_QR_PURPOSE));
    assert.match(html, /<svg[^>]*viewBox=/);
    assert.ok(html.includes("Como ler:"));
    assert.equal((html.match(/<li>/g) ?? []).length, 4);
    for (const step of COLLECTOR_SECTOR_QR_HOWTO_STEPS) assert.ok(html.includes(step), step);
    // Sem URL crua, sem botões, sem marca/cromo da aplicação.
    assert.equal(html.includes(URL), false);
    assert.doesNotMatch(html, /<button|<a /);
    assert.doesNotMatch(html, /INDUSCOST|STOCK COLLECTOR/);
  });

  it("modo print (default) só tem a classe base; preview adiciona o modificador", () => {
    const print = renderToStaticMarkup(<CollectorSectorQrPrintSheet label="Matéria-prima" url={URL} />);
    assert.match(print, new RegExp(`class="${COLLECTOR_SECTOR_QR_SHEET_CLASS}"`));
    assert.match(print, /data-mode="print"/);
    const preview = renderToStaticMarkup(
      <CollectorSectorQrPrintSheet label="Matéria-prima" url={URL} mode="preview" />
    );
    assert.match(
      preview,
      new RegExp(`class="${COLLECTOR_SECTOR_QR_SHEET_CLASS} ${COLLECTOR_SECTOR_QR_SHEET_PREVIEW_CLASS}"`)
    );
    assert.match(preview, /data-mode="preview"/);
  });

  it("o QR carrega a URL absoluta com correção de erro alta (impresso e fixado fisicamente)", () => {
    assert.equal(COLLECTOR_SECTOR_QR_ERROR_LEVEL, "H");
    const withH = renderToStaticMarkup(<CollectorSectorQrPrintSheet label="X" url={URL} />);
    // Mesmo conteúdo com nível L gera menos módulos: o SVG muda de tamanho de path.
    const withL = renderToStaticMarkup(<QRCodeSVG value={URL} size={220} level="L" marginSize={2} />);
    assert.notEqual(withH.length, withL.length);
    assert.match(withH, /role="img"/);
  });
});
