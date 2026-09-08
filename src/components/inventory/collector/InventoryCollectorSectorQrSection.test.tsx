/**
 * "QR de acesso ao Collector" — botão + modal, QR fixo por setor.
 * Render estático (sem browser): a seção não mostra QR inline, só o seletor de
 * setor e o botão "Emitir QR do setor"; o modal traz a folha canônica em
 * pré-visualização, o aviso de QR fixo e as ações; nunca há "regenerar".
 *
 * A seção importa CSS (folha + impressão). O runner canônico `tsx --test` não
 * carrega CSS (ERR_UNKNOWN_FILE_EXTENSION), então registramos um hook que
 * devolve módulo vazio para `.css` e carregamos o componente dinamicamente em
 * `before()` — mesmo padrão de src/lib/customerIntelligencePage.test.tsx.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSectorCollectorAbsoluteUrl } from "@/src/lib/inventory/collector/collectorSectorContract";
import {
  COLLECTOR_SECTOR_QR_DEFAULT_SECTOR,
  COLLECTOR_SECTOR_QR_FIXED_NOTICE,
  COLLECTOR_SECTOR_QR_OPTIONS,
} from "@/src/lib/inventory/collector/collectorSectorQrUi";

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

type SectionModule = typeof import("./InventoryCollectorSectorQrSection.js");
type SectionState = import("./InventoryCollectorSectorQrSection.js").InventoryCollectorSectorQrState;

let InventoryCollectorSectorQrSection: SectionModule["InventoryCollectorSectorQrSection"];
let InventoryCollectorSectorQrModalBody: SectionModule["InventoryCollectorSectorQrModalBody"];

before(async () => {
  const mod = await import("./InventoryCollectorSectorQrSection.js");
  InventoryCollectorSectorQrSection = mod.InventoryCollectorSectorQrSection;
  InventoryCollectorSectorQrModalBody = mod.InventoryCollectorSectorQrModalBody;
});

const URL = "https://induscost.example.com/collector/sector/raw-material";
const READY: SectionState = {
  status: "ready",
  data: { sector: "RAW_MATERIAL", label: "Matéria-prima", url: URL },
};
const noop = () => undefined;
const escapeRe = (value: string) => value.replace(/[/.]/g, "\\$&");

function renderSection(state: SectionState, modalOpen = false) {
  return renderToStaticMarkup(
    <InventoryCollectorSectorQrSection
      sectors={COLLECTOR_SECTOR_QR_OPTIONS}
      selectedSector={COLLECTOR_SECTOR_QR_DEFAULT_SECTOR}
      onSelectSector={noop}
      onEmit={noop}
      state={state}
      modalOpen={modalOpen}
      onCloseModal={noop}
      onRetry={noop}
    />
  );
}

function renderBody(state: SectionState, printing = false) {
  return renderToStaticMarkup(
    <InventoryCollectorSectorQrModalBody state={state} printing={printing} onPrint={noop} onRetry={noop} />
  );
}

describe("InventoryCollectorSectorQrSection — botão que abre o modal", () => {
  it("sem emissão: seletor de setor + botão 'Emitir QR do setor'; nenhum QR inline, nenhum 'Atualizar'", () => {
    const html = renderSection({ status: "idle" });
    assert.match(html, /data-testid="collector-sector-qr-section"/);
    assert.match(html, /data-testid="collector-sector-qr-sector"/);
    assert.match(html, /<option value="RAW_MATERIAL"[^>]*>Matéria-prima<\/option>/);
    assert.match(html, /data-testid="collector-sector-qr-emit"[^>]*>[\s\S]*?Emitir QR do setor/);
    // Ícones lucide também são <svg>; o QR da folha é o único com role="img".
    assert.doesNotMatch(html, /role="img"|collector-sector-qr-sheet/, "o QR não aparece inline na aba");
    assert.doesNotMatch(html, /collector-sector-qr-preview|collector-sector-qr-ready/);
    assert.doesNotMatch(html, /collector-sector-qr-refresh|Atualizar|Regenerar|regenerar/);
    assert.match(html, /O QR de cada setor é fixo/);
  });

  it("emitindo: botão desabilitado e rotulado; QR pronto continua sem inline na aba (só no modal)", () => {
    const loading = renderSection({ status: "loading" });
    assert.match(loading, /<button type="button" disabled=""[^>]*data-testid="collector-sector-qr-emit"/);
    assert.match(loading, /Emitindo…/);
    const ready = renderSection(READY);
    assert.doesNotMatch(ready, /collector-sector-qr-preview/);
    assert.doesNotMatch(ready, /role="img"|collector-sector-qr-sheet/);
  });

  it("403 na emissão: a seção some inteira (mesmo guard do backend)", () => {
    assert.equal(renderSection({ status: "forbidden" }), "");
  });

  it("as opções de setor vêm do contrato canônico", () => {
    assert.ok(COLLECTOR_SECTOR_QR_OPTIONS.length >= 1);
    assert.deepEqual(COLLECTOR_SECTOR_QR_OPTIONS[0], { code: "RAW_MATERIAL", label: "Matéria-prima" });
    assert.ok(COLLECTOR_SECTOR_QR_OPTIONS.some((row) => row.code === COLLECTOR_SECTOR_QR_DEFAULT_SECTOR));
  });
});

describe("InventoryCollectorSectorQrModalBody — conteúdo do modal", () => {
  it("pronto: folha canônica em pré-visualização, aviso de QR fixo, URL, Abrir e Imprimir; sem regenerar", () => {
    const html = renderBody(READY);
    assert.match(html, /data-testid="collector-sector-qr-ready"/);
    assert.match(html, /data-testid="collector-sector-qr-preview"[^>]*data-mode="preview"/);
    assert.match(html, /<h1>Matéria-prima<\/h1>/);
    assert.match(html, /<svg[^>]*viewBox=/);
    assert.match(html, /data-testid="collector-sector-qr-fixed-notice"/);
    assert.ok(html.includes(COLLECTOR_SECTOR_QR_FIXED_NOTICE));
    assert.match(html, new RegExp(`data-testid="collector-sector-qr-url"[^>]*>${escapeRe(URL)}<`));
    assert.match(html, new RegExp(`<a href="${escapeRe(URL)}"[^>]*data-testid="collector-sector-qr-open"`));
    assert.match(html, /data-testid="collector-sector-qr-print"[^>]*>[\s\S]*?Imprimir QR/);
    assert.doesNotMatch(html, /Regenerar|regenerar|Atualizar|collector-sector-qr-refresh/);
  });

  it("imprimindo: botão Imprimir desabilitado", () => {
    assert.match(renderBody(READY, true), /<button type="button" disabled=""[^>]*data-testid="collector-sector-qr-print"/);
  });

  it("emitindo: carregando; configuração ausente: aviso explícito; erro: banner + 'Tentar novamente' (não é regenerar)", () => {
    assert.match(renderBody({ status: "loading" }), /Emitindo QR do setor…/);
    const config = renderBody({ status: "config", message: "INVENTORY_COLLECTOR_PUBLIC_BASE_URL ausente." });
    assert.match(config, /data-testid="collector-sector-qr-config-error"/);
    assert.match(config, /INVENTORY_COLLECTOR_PUBLIC_BASE_URL ausente\./);
    assert.doesNotMatch(config, /collector-sector-qr-retry/);
    const error = renderBody({ status: "error", message: "Falha de rede." });
    assert.match(error, /data-testid="collector-sector-qr-error"/);
    assert.match(error, /Falha de rede\./);
    assert.match(error, /data-testid="collector-sector-qr-retry"[^>]*>[\s\S]*?Tentar novamente/);
    assert.equal(renderBody({ status: "forbidden" }), "");
  });
});

describe("QR fixo por setor — determinismo do conteúdo", () => {
  it("o mesmo setor sobre a mesma base pública produz sempre a mesma URL (sem token, data ou aleatoriedade)", () => {
    const env = { INVENTORY_COLLECTOR_PUBLIC_BASE_URL: "https://induscost.example.com" };
    const first = buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", env);
    const again = Array.from({ length: 5 }, () => buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", env));
    for (const url of again) assert.equal(url, first);
    assert.equal(first, URL);
    assert.doesNotMatch(first, /[?#]/, "sem querystring, token ou fragmento — nada que mude entre emissões");
  });
});
