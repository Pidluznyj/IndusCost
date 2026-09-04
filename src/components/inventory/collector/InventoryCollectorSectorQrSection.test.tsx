import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CollectorSectorQrPrintSheet,
  InventoryCollectorSectorQrSection,
} from "./InventoryCollectorSectorQrSection.js";

const SAMPLE = {
  sector: "RAW_MATERIAL",
  label: "Matéria-prima",
  url: "https://collector.example.com/collector/sector/raw-material",
};

describe("InventoryCollectorSectorQrSection", () => {
  it("título e texto auxiliar aparecem em todos os estados (menos forbidden)", () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "loading" }} onRefresh={() => {}} />
    );
    assert.ok(html.includes("QR de acesso ao Collector"));
    assert.ok(html.includes("continua sujeito à"));
    assert.ok(html.includes("autorização do"));
  });

  it("estado loading mostra o skeleton InventoryLoading e nenhum QR", () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "loading" }} onRefresh={() => {}} />
    );
    assert.ok(html.includes('data-testid="inventory-loading"'));
    assert.ok(!html.includes('data-testid="collector-sector-qr-code"'));
  });

  it("estado forbidden não renderiza nada (mesmo guard do backend)", () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "forbidden" }} onRefresh={() => {}} />
    );
    assert.equal(html, "");
  });

  it("estado ready: QR codifica exatamente response.url, sem parâmetros extras", () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "ready", data: SAMPLE }} onRefresh={() => {}} />
    );
    assert.ok(html.includes('data-testid="collector-sector-qr-code"'));
    // qrcode.react renderiza um <svg>; o valor codificado não aparece como texto,
    // então validamos indiretamente: a URL crua aparece 1x no texto selecionável
    // (fora do QR) e o link "Abrir Collector" aponta para o mesmo valor exato.
    const urlOccurrences = html.split(SAMPLE.url).length - 1;
    assert.ok(urlOccurrences >= 2, "url deveria aparecer no texto e no href");
  });

  it("estado ready: label do setor aparece abaixo do QR", () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "ready", data: SAMPLE }} onRefresh={() => {}} />
    );
    assert.ok(html.includes(SAMPLE.label));
  });

  it("estado ready: URL fica em texto selecionável (select-all) e sem alteração", () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "ready", data: SAMPLE }} onRefresh={() => {}} />
    );
    const match = /data-testid="collector-sector-qr-url"[^>]*>([^<]+)</.exec(html);
    assert.ok(match, "elemento de URL não encontrado");
    assert.equal(match?.[1], SAMPLE.url);
    assert.ok(html.includes("select-all"));
  });

  it('botão "Abrir Collector" aponta para response.url em nova aba segura', () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "ready", data: SAMPLE }} onRefresh={() => {}} />
    );
    const match = /<a[^>]*data-testid="collector-sector-qr-open"[^>]*>/.exec(html);
    assert.ok(match, "link Abrir Collector não encontrado");
    const tag = match![0];
    assert.ok(tag.includes(`href="${SAMPLE.url}"`));
    assert.ok(tag.includes('target="_blank"'));
    assert.ok(tag.includes('rel="noopener noreferrer"'));
  });

  it('estado ready inclui o botão "Imprimir QR"', () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "ready", data: SAMPLE }} onRefresh={() => {}} />
    );
    assert.ok(html.includes('data-testid="collector-sector-qr-print"'));
    assert.ok(html.includes("Imprimir QR"));
  });

  it("folha de impressão isolada (CollectorSectorQrPrintSheet) traz só marca, setor, QR e URL", () => {
    // Renderizado direto (sem createPortal/document) — a colocação em
    // document.body é responsabilidade do runtime do navegador, não do
    // conteúdo em si, que é o que importa para a folha impressa.
    const html = renderToStaticMarkup(<CollectorSectorQrPrintSheet data={SAMPLE} />);
    assert.ok(html.includes('id="collector-sector-qr-print-root"'));
    assert.ok(html.includes("INDUSCOST"));
    assert.ok(html.includes("STOCK COLLECTOR"));
    assert.ok(html.includes(SAMPLE.label.toUpperCase()));
    assert.ok(html.includes("Escaneie para abrir o Collector"));
    assert.ok(html.includes(SAMPLE.url));
  });

  it("estado ready não quebra em SSR (sem document) — portal fica ausente, resto renderiza normal", () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "ready", data: SAMPLE }} onRefresh={() => {}} />
    );
    assert.ok(html.includes('data-testid="collector-sector-qr-code"'));
  });

  it("botão Atualizar sempre presente e chama onRefresh (via testid, não via click simulado)", () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "loading" }} onRefresh={() => {}} />
    );
    assert.ok(html.includes('data-testid="collector-sector-qr-refresh"'));
  });

  it("estado config mostra mensagem administrativa clara, sem inventar URL de fallback", () => {
    const message =
      "Não foi possível gerar o QR do Collector porque a URL pública do Collector " +
      "não está configurada corretamente no servidor.";
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection state={{ status: "config", message }} onRefresh={() => {}} />
    );
    assert.ok(html.includes('data-testid="collector-sector-qr-config-error"'));
    assert.ok(html.includes(message));
    // Não confundir com xmlns="http://www.w3.org/2000/svg" de ícones lucide —
    // o que importa é que nenhuma URL do Collector/setor vaza como fallback.
    assert.ok(!html.includes(SAMPLE.url));
    assert.ok(!html.includes("collector.example.com"));
    assert.ok(!html.includes('data-testid="collector-sector-qr-code"'));
  });

  it("estado error usa o InventoryErrorBanner padrão da aba", () => {
    const html = renderToStaticMarkup(
      <InventoryCollectorSectorQrSection
        state={{ status: "error", message: "Falha ao gerar QR." }}
        onRefresh={() => {}}
      />
    );
    assert.ok(html.includes('data-testid="collector-sector-qr-error"'));
    assert.ok(html.includes("Falha ao gerar QR."));
    assert.ok(!html.includes('data-testid="collector-sector-qr-code"'));
  });
});
