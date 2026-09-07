/**
 * QR GERAL DE SETOR — contrato do deep-link físico.
 *
 * O QR impresso é lido pela câmera NATIVA do iPad: só serve se contiver uma URL
 * ABSOLUTA. Estes testes travam o comportamento fail-closed da resolução da base
 * pública e a separação em relação ao QR legado `inv-loc`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  COLLECTOR_PUBLIC_BASE_URL_ENV,
  COLLECTOR_PUBLIC_BASE_URL_INVALID,
  COLLECTOR_PUBLIC_BASE_URL_REQUIRED,
  isCollectorPublicBaseUrlErrorCode,
  joinCollectorPublicUrl,
  resolveCollectorPublicBaseUrl,
} from "./collectorPublicBaseUrl.js";
import {
  COLLECTOR_SECTORS,
  buildSectorCollectorAbsoluteUrl,
  buildSectorCollectorPath,
  collectorSectorSlug,
  getCollectorPublicBaseUrl,
} from "./collectorSectorContract.js";
import {
  COLLECTOR_QR_TYPE,
  buildCollectorQrText,
  parseCollectorQrText,
} from "./collectorQrContract.js";
import { InventoryValidationError } from "./../inventoryTypes.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function absoluteUrlError(env: NodeJS.ProcessEnv): InventoryValidationError {
  try {
    const url = buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", env);
    assert.fail(`esperado erro de configuração, veio URL: ${url}`);
  } catch (e: unknown) {
    assert.ok(e instanceof InventoryValidationError, `erro inesperado: ${String(e)}`);
    return e;
  }
}

describe("QR de setor — slug e path (TESTE 1, 2)", () => {
  it("RAW_MATERIAL gera slug raw-material", () => {
    assert.equal(COLLECTOR_SECTORS.RAW_MATERIAL.slug, "raw-material");
    assert.equal(collectorSectorSlug("RAW_MATERIAL"), "raw-material");
  });

  it("path do deep-link é /collector/sector/raw-material", () => {
    assert.equal(buildSectorCollectorPath("RAW_MATERIAL"), "/collector/sector/raw-material");
  });
});

describe("QR de setor — composição da URL absoluta (TESTE 3, 4, 5, 6)", () => {
  it("base https://example.test produz a URL final esperada", () => {
    assert.equal(
      buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", {
        [COLLECTOR_PUBLIC_BASE_URL_ENV]: "https://example.test",
      }),
      "https://example.test/collector/sector/raw-material"
    );
  });

  it("barra final na base não duplica //", () => {
    for (const base of ["https://example.test/", "https://example.test///"]) {
      const url = buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", {
        [COLLECTOR_PUBLIC_BASE_URL_ENV]: base,
      });
      assert.equal(url, "https://example.test/collector/sector/raw-material");
      assert.equal(url.slice("https://".length).includes("//"), false, `URL com //: ${url}`);
    }
  });

  it("INVENTORY_COLLECTOR_PUBLIC_BASE_URL tem precedência sobre APP_URL", () => {
    const env = {
      [COLLECTOR_PUBLIC_BASE_URL_ENV]: "https://collector.example",
      APP_URL: "https://app.example",
    };
    assert.equal(
      buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", env),
      "https://collector.example/collector/sector/raw-material"
    );
    const resolution = resolveCollectorPublicBaseUrl(env);
    assert.equal(resolution.ok && resolution.source, COLLECTOR_PUBLIC_BASE_URL_ENV);
  });

  it("APP_URL é usada quando a variável principal está ausente ou vazia", () => {
    for (const env of [
      { APP_URL: "https://app.example" },
      { [COLLECTOR_PUBLIC_BASE_URL_ENV]: "   ", APP_URL: "https://app.example" },
    ]) {
      assert.equal(
        buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", env),
        "https://app.example/collector/sector/raw-material"
      );
    }
    const resolution = resolveCollectorPublicBaseUrl({ APP_URL: "https://app.example" });
    assert.equal(resolution.ok && resolution.source, "APP_URL");
  });

  it("subpath de reverse proxy é preservado", () => {
    assert.equal(
      buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", {
        [COLLECTOR_PUBLIC_BASE_URL_ENV]: "https://example.test/induscost/",
      }),
      "https://example.test/induscost/collector/sector/raw-material"
    );
    assert.equal(joinCollectorPublicUrl("https://h/app", "/x"), "https://h/app/x");
    assert.equal(joinCollectorPublicUrl("https://h/app/", "x"), "https://h/app/x");
  });
});

describe("QR de setor — fail-closed de configuração (TESTE 7, 8, 9, 10)", () => {
  it("sem base válida NÃO produz path relativo: falha explícita", () => {
    const error = absoluteUrlError({});
    assert.equal(error.code, COLLECTOR_PUBLIC_BASE_URL_REQUIRED);
    assert.doesNotMatch(error.message, /^\/collector\/sector\//);
    assert.match(error.message, new RegExp(COLLECTOR_PUBLIC_BASE_URL_ENV));
    assert.equal(getCollectorPublicBaseUrl({}), null);
  });

  it("base inválida falha de maneira controlada (sem string de QR corrompida)", () => {
    // "MY_APP_URL" é o placeholder do .env.example — jamais pode virar QR.
    for (const raw of ["MY_APP_URL", "não-é-url", "://x", "ftp://example.test", "/só/path"]) {
      const error = absoluteUrlError({ [COLLECTOR_PUBLIC_BASE_URL_ENV]: raw });
      assert.equal(error.code, COLLECTOR_PUBLIC_BASE_URL_INVALID, `aceitou base: ${raw}`);
      assert.equal(getCollectorPublicBaseUrl({ [COLLECTOR_PUBLIC_BASE_URL_ENV]: raw }), null);
    }
  });

  it("credencial ou query/fragmento na base são recusados", () => {
    for (const raw of [
      "https://user:pass@example.test",
      "https://example.test?token=abc",
      "https://example.test#frag",
    ]) {
      assert.equal(
        absoluteUrlError({ [COLLECTOR_PUBLIC_BASE_URL_ENV]: raw }).code,
        COLLECTOR_PUBLIC_BASE_URL_INVALID,
        `aceitou base: ${raw}`
      );
    }
  });

  it("HTTP remoto não é aceito silenciosamente", () => {
    for (const raw of ["http://example.test", "http://10.0.0.5:3000", "http://tablet.local"]) {
      const error = absoluteUrlError({ [COLLECTOR_PUBLIC_BASE_URL_ENV]: raw });
      assert.equal(error.code, COLLECTOR_PUBLIC_BASE_URL_INVALID, `aceitou HTTP remoto: ${raw}`);
      assert.match(error.message, /https/i);
    }
  });

  it("localhost/loopback tem regra explícita e continua suportado em dev", () => {
    for (const [raw, expected] of [
      ["http://localhost:5173", "http://localhost:5173/collector/sector/raw-material"],
      ["http://127.0.0.1:3000", "http://127.0.0.1:3000/collector/sector/raw-material"],
      ["http://[::1]:3000", "http://[::1]:3000/collector/sector/raw-material"],
    ] as const) {
      assert.equal(
        buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", {
          [COLLECTOR_PUBLIC_BASE_URL_ENV]: raw,
        }),
        expected
      );
    }
  });

  it("toda URL emitida é absoluta e parseável", () => {
    for (const base of ["https://example.test", "https://example.test/sub", "http://localhost:1"]) {
      const url = buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", {
        [COLLECTOR_PUBLIC_BASE_URL_ENV]: base,
      });
      assert.doesNotThrow(() => new URL(url));
      assert.match(url, /^https?:\/\//);
      assert.ok(url.endsWith("/collector/sector/raw-material"), url);
    }
  });
});

describe("QR de setor — endpoint humano e ausência de identidade (TESTE 11, 12, 19)", () => {
  it("sector-qr permanece endpoint HUMANO sob countManage", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    const marker = '"/api/inventory/collector/sector-qr"';
    const at = routes.indexOf(marker);
    assert.ok(at > 0, "rota sector-qr ausente");
    const block = routes.slice(at, at + 900);
    assert.match(block, /\.\.\.countManage/);
    assert.match(block, /getCurrentAppUser/);
    assert.match(block, /buildSectorCollectorAbsoluteUrl/);
    // Nunca vira endpoint DEVICE.
    assert.doesNotMatch(block, /deviceAuth|requireInventoryCollectorDevice/);

    const collectorRoutes = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    assert.doesNotMatch(collectorRoutes, /sector-qr/);
  });

  it("QR não carrega identidade, credencial nem IDs internos", () => {
    const url = buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", {
      [COLLECTOR_PUBLIC_BASE_URL_ENV]: "https://example.test",
    });
    for (const forbidden of [
      "deviceId",
      "stableNodeId",
      "tailscaleStableNodeId",
      "userId",
      "actorType",
      "token",
      "sessionId",
      "itemId",
      "warehouseId",
      "locationId",
    ]) {
      assert.equal(url.includes(forbidden), false, `QR expôs ${forbidden}: ${url}`);
    }
    assert.equal(url.includes("?"), false, "QR de setor não deve ter querystring");
    assert.equal(url.includes("#"), false, "QR de setor não deve ter fragmento");
    assert.equal(url, "https://example.test/collector/sector/raw-material");
  });

  it("erro de configuração é distinguível de device não autorizado", () => {
    assert.ok(isCollectorPublicBaseUrlErrorCode(COLLECTOR_PUBLIC_BASE_URL_REQUIRED));
    assert.ok(isCollectorPublicBaseUrlErrorCode(COLLECTOR_PUBLIC_BASE_URL_INVALID));
    for (const code of [
      "COLLECTOR_DEVICE_UNAUTHORIZED",
      "NOT_AUTHORIZED",
      "COLLECTOR_CAPABILITY_DENIED",
      null,
      undefined,
    ]) {
      assert.equal(isCollectorPublicBaseUrlErrorCode(code), false, `code confundido: ${code}`);
    }

    // Servidor: 503 (configuração), nunca 401/403 de autorização.
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /COLLECTOR_PUBLIC_BASE_URL_REQUIRED/);
    assert.match(routes, /COLLECTOR_PUBLIC_BASE_URL_INVALID/);
    assert.match(routes, /\?\s*503/);
  });
});

describe("QR de setor — UI humana não oculta erro de configuração (TESTE 20)", () => {
  const page = read("src/components/inventory/collector/InventoryCountLabelsPage.tsx");

  it("catch tipado: sem catch vazio engolindo erros", () => {
    assert.doesNotMatch(page, /catch\s*\{\s*(\/\/[^\n]*\n\s*)*\}/);
    assert.match(page, /isCollectorPublicBaseUrlErrorCode/);
    assert.match(page, /HttpError/);
  });

  it("estados distintos: forbidden, config, error, ready", () => {
    for (const state of ['"forbidden"', '"config"', '"error"', '"ready"']) {
      assert.ok(page.includes(state), `estado ausente: ${state}`);
    }
    assert.match(page, /sector-qr-config-error/);
    assert.match(page, /e\.status === 401 \|\| e\.status === 403/);
  });
});

describe("compatibilidade do fluxo legado (TESTE 13, 14, 15, 16, 17)", () => {
  it("rotas React /collector e /collector/sector/:sectorSlug seguem registradas", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="\/collector"/);
    assert.match(app, /path="\/collector\/sector\/:sectorSlug"/);
    assert.match(app, /CollectorPage/);
    assert.match(app, /CollectorSectorPage/);
  });

  it("resolve-qr legado continua existindo e o QR de setor não passa por ele", () => {
    const collectorRoutes = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    assert.match(collectorRoutes, /"\/api\/inventory\/collector\/resolve-qr"/);

    const contract = read("src/lib/inventory/collector/collectorSectorContract.ts");
    assert.doesNotMatch(contract, /resolve-qr/);
    const baseUrl = read("src/lib/inventory/collector/collectorPublicBaseUrl.ts");
    assert.doesNotMatch(baseUrl, /resolve-qr/);
  });

  it("QR legado inv-loc continua válido e independente do deep-link", () => {
    const payload = {
      itemId: "11111111-1111-4111-8111-111111111111",
      warehouseId: "22222222-2222-4222-8222-222222222222",
      locationId: "33333333-3333-4333-8333-333333333333",
    };
    const text = buildCollectorQrText(payload);
    const parsed = parseCollectorQrText(text);
    assert.equal(parsed.t, COLLECTOR_QR_TYPE);
    assert.equal(parsed.itemId, payload.itemId);
    assert.equal(parsed.warehouseId, payload.warehouseId);
    assert.equal(parsed.locationId, payload.locationId);

    // Contratos não intercambiáveis: o deep-link não é JSON inv-loc.
    const deepLink = buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", {
      [COLLECTOR_PUBLIC_BASE_URL_ENV]: "https://example.test",
    });
    assert.throws(() => parseCollectorQrText(deepLink));
    assert.equal(text.startsWith("http"), false);
  });

  it("CollectorSectorPage não depende de CollectorQrScanner", () => {
    const page = read("src/components/inventory/collector/CollectorSectorPage.tsx");
    assert.doesNotMatch(page, /CollectorQrScanner/);
    assert.doesNotMatch(page, /BarcodeDetector/);
    // O scanner permanece exclusivo do fluxo legado.
    const legacy = read("src/components/inventory/collector/CollectorPage.tsx");
    assert.match(legacy, /CollectorQrScanner/);
  });
});

describe("contagem cega preservada no fluxo autônomo (TESTE 18)", () => {
  it("DTO da lista de itens não expõe saldo do sistema", () => {
    const auto = read("src/lib/inventory/collector/collectorAutonomousSession.server.ts");
    const listFn = auto.slice(
      auto.indexOf("listCollectorSessionItemsBlind"),
      auto.indexOf("getCollectorSessionSummary")
    );
    assert.ok(listFn.length > 0, "função de listagem cega não encontrada");
    assert.doesNotMatch(listFn, /systemQuantity:/);
    assert.doesNotMatch(listFn, /expectedQuantity:/);
    assert.doesNotMatch(listFn, /adjustmentDelta:/);

    const page = read("src/components/inventory/collector/CollectorSectorPage.tsx");
    assert.doesNotMatch(page, /item\.systemQuantity/);
    assert.doesNotMatch(page, /item\.expectedQuantity/);
  });
});

/**
 * Impressão da folha do QR de setor.
 *
 * A folha é um componente canônico (`CollectorSectorQrPrintSheet`) compartilhado
 * por /inventory-labels e por Estoque → Dispositivos do Coletor, para que as
 * duas telas nunca voltem a imprimir folhas diferentes. `reports-print.css`
 * aplica `body * { visibility: hidden }` no @media print e só devolve
 * visibilidade a uma allow-list de print-roots — sem override próprio a rota
 * /inventory-labels imprimia EM BRANCO.
 */
describe("QR de setor — folha de impressão", () => {
  const SHEET = "src/components/inventory/collector/CollectorSectorQrPrintSheet.tsx";
  const SHEET_CSS = "src/components/inventory/collector/collector-sector-qr-sheet.css";
  const PAGE = "src/components/inventory/collector/InventoryCountLabelsPage.tsx";
  const SECTION = "src/components/inventory/collector/InventoryCollectorSectorQrSection.tsx";
  const SECTION_CSS = "src/components/inventory/collector/inventory-collector-sector-qr-print.css";
  const CSS = "src/components/inventory/collector/inventory-labels-print.css";

  it("a rota marca o body e carrega os CSS de impressão (rota + folha)", () => {
    const page = read(PAGE);
    assert.match(page, /usePrintRouteBodyClass/);
    assert.match(page, /inventory-labels-print-route/);
    assert.match(page, /import "\.\/inventory-labels-print\.css"/);
    assert.match(page, /import "\.\/collector-sector-qr-sheet\.css"/);
  });

  it("o CSS anula o visibility:hidden global (senão imprime em branco)", () => {
    const css = read(CSS);
    assert.match(css, /@media print/);
    assert.match(
      css,
      /body\.inventory-labels-print-route,\s*\n\s*body\.inventory-labels-print-route \*\s*\{\s*\n\s*visibility: visible !important;/
    );
  });

  it("a folha traz nome do setor, o que o QR faz, o QR e como ler — e só isso", () => {
    const sheet = read(SHEET);
    // 1) nome do setor
    assert.match(sheet, /<h1>\{label\}<\/h1>/);
    // 2) o que o QR faz
    assert.match(sheet, /Este QR abre a contagem de estoque deste setor no tablet\./);
    // 3) o QR em si, com correção de erro alta (vai ser fixado fisicamente)
    assert.match(sheet, /<QRCodeSVG\s*\n?\s*value=\{url\}/);
    assert.match(sheet, /COLLECTOR_SECTOR_QR_ERROR_LEVEL = "H"/);
    // 4) instrução de leitura em quatro passos
    assert.match(sheet, /Como ler:/);
    const steps = /COLLECTOR_SECTOR_QR_HOWTO_STEPS: readonly string\[\] = \[([\s\S]*?)\];/.exec(sheet);
    assert.ok(steps, "lista de passos não encontrada");
    assert.equal((steps[1].match(/^\s*"/gm) ?? []).length, 4);
    assert.match(steps[1], /Abra a câmera do tablet\./);
    assert.match(steps[1], /Conte os itens do setor pelo próprio tablet\./);
    // "somente isso": sem URL crua, botões, links ou marca dentro da folha.
    assert.doesNotMatch(sheet, /\{url\}<\/p>/);
    assert.doesNotMatch(sheet, /<button|<a /);
    assert.doesNotMatch(sheet, /INDUSCOST|STOCK COLLECTOR/);
    // Sem CSS importado no componente: testável sem loader.
    assert.doesNotMatch(sheet, /import "\.\/.*\.css"/);
  });

  it("as duas telas imprimem a MESMA folha e pré-visualizam com o mesmo componente", () => {
    const page = read(PAGE);
    assert.match(page, /<CollectorSectorQrPrintSheet[\s\S]*?mode="print"[\s\S]*?testId="sector-qr-print-sheet"/);
    assert.match(page, /<CollectorSectorQrPrintSheet[\s\S]*?mode="preview"/);
    assert.doesNotMatch(page, /inventory-labels-sector-print/);

    const section = read(SECTION);
    const printRoot = /<div id="collector-sector-qr-print-root">[\s\S]*?<\/div>,/.exec(section);
    assert.ok(printRoot, "print-root da aba Dispositivos não encontrado");
    assert.match(printRoot[0], /<CollectorSectorQrPrintSheet[\s\S]*?mode="print"/);
    // Nada além da folha no papel: sem URL crua nem marca própria.
    assert.doesNotMatch(printRoot[0], /\{state\.data\.url\}<\/p>|STOCK COLLECTOR|INDUSCOST/);
    assert.match(section, /<CollectorSectorQrPrintSheet[\s\S]*?mode="preview"/);
    assert.match(section, /import "\.\/collector-sector-qr-sheet\.css"/);
    assert.match(section, /import "\.\/inventory-collector-sector-qr-print\.css"/);
  });

  it("a pré-visualização em tela nunca vai para o papel (não duplica a folha)", () => {
    const page = read(PAGE);
    assert.match(page, /className="inventory-labels-no-print mb-8 rounded-xl border-2 border-emerald-600/);
    const css = read(CSS);
    assert.match(css, /\.inventory-labels-no-print\s*\{\s*\n\s*display: none !important;/);
    const sheetCss = read(SHEET_CSS);
    assert.match(
      sheetCss,
      /@media print \{[\s\S]*?\.collector-sector-qr-sheet\.collector-sector-qr-sheet--preview \{\s*\n\s*display: none !important;/
    );
    // Fora do papel, o modo print fica oculto e só o preview aparece.
    assert.match(sheetCss, /^\.collector-sector-qr-sheet \{\s*\n\s*display: none;/m);
  });

  it("na aba Dispositivos, o print-root só é revelado durante o clique em Imprimir", () => {
    const section = read(SECTION);
    assert.match(section, /document\.body\.classList\.add\(PRINT_BODY_CLASS\)/);
    assert.match(section, /document\.body\.classList\.remove\(PRINT_BODY_CLASS\)/);
    const css = read(SECTION_CSS);
    assert.match(css, /^#collector-sector-qr-print-root \{\s*\n\s*display: none;/m);
    assert.match(css, /body\.collector-sector-qr-print-route #root \{\s*\n\s*visibility: hidden !important;/);
    assert.match(css, /body\.collector-sector-qr-print-route #collector-sector-qr-print-root \* \{\s*\n\s*visibility: visible !important;/);
  });

  it("etiquetas por item continuam imprimíveis, em página própria", () => {
    const page = read(PAGE);
    assert.match(page, /className="inventory-labels-grid grid/);
    const css = read(CSS);
    assert.match(css, /\.inventory-labels-grid\s*\{[\s\S]*?page-break-before: always;/);
  });
});

/**
 * A4 retrato. Vários CSS globais declaram `@page { size: A4 landscape }` e
 * `@page` não obedece especificidade — vence o último em ordem de documento.
 * Duas camadas (CSS + <style> em runtime), como já feito em commission-closing
 * e service-termination — agora nas DUAS telas que imprimem a folha.
 */
describe("QR de setor — A4 retrato", () => {
  const PAGE = "src/components/inventory/collector/InventoryCountLabelsPage.tsx";
  const SECTION = "src/components/inventory/collector/InventoryCollectorSectorQrSection.tsx";
  const CSS_FILES = [
    "src/components/inventory/collector/inventory-labels-print.css",
    "src/components/inventory/collector/collector-sector-qr-sheet.css",
    "src/components/inventory/collector/inventory-collector-sector-qr-print.css",
  ];

  it("cada CSS declara retrato no topo E dentro do @media print", () => {
    for (const file of CSS_FILES) {
      const css = read(file);
      const topLevel = /^@page \{\s*\n\s*size: A4 portrait;/m.exec(css);
      assert.ok(topLevel, `${file}: falta @page A4 portrait em nível de topo`);
      assert.match(css, /@media print \{\s*\n\s*@page \{\s*\n\s*size: A4 portrait;/, file);
      assert.equal((css.match(/size: A4 portrait/g) ?? []).length, 2, file);
      // Só o CSS executável: "landscape" aparece no comentário que explica o porquê.
      const executable = css.replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(executable, /landscape/, file);
    }
  });

  it("a página de etiquetas reforça o retrato injetando @page no head em runtime", () => {
    const page = read(PAGE);
    assert.match(page, /data-inventory-labels-print-page/);
    assert.match(page, /@page \{ size: A4 portrait; margin: 12mm; \}/);
    assert.match(page, /document\.head\.appendChild\(style\)/);
    // Removido no unmount: não vaza retrato para outras rotas.
    assert.match(page, /return \(\) => \{\s*\n\s*style\.remove\(\);/);
  });

  it("a aba Dispositivos reforça o retrato só durante a impressão e limpa depois", () => {
    const section = read(SECTION);
    assert.match(section, /data-collector-sector-qr-print-page/);
    assert.match(section, /@page \{ size: A4 portrait; margin: 12mm; \}/);
    assert.match(section, /document\.head\.appendChild\(pageStyle\)/);
    assert.match(section, /const cleanup = \(\) => \{[\s\S]*?pageStyle\.remove\(\);/);
  });
});

/**
 * Layout da folha. Dois resets do preflight do Tailwind quebravam a folha:
 * `svg { display: block }` (text-align do pai não centraliza) e
 * `ol { list-style: none }` (a numeração do "Como ler" sumia).
 */
describe("QR de setor — layout da folha impressa", () => {
  const CSS = "src/components/inventory/collector/collector-sector-qr-sheet.css";
  const PRINT_SHEET = ".collector-sector-qr-sheet:not(.collector-sector-qr-sheet--preview)";
  const escape = (s: string) => s.replace(/[.()]/g, "\\$&");

  it("o QR é grande e centralizado por margem automática", () => {
    const css = read(CSS);
    const rule = new RegExp(`${escape(PRINT_SHEET)} > svg \\{([\\s\\S]*?)\\}`).exec(css);
    assert.ok(rule, "falta regra dedicada para o SVG do QR impresso");
    // `text-align: center` do pai não centraliza um svg display:block.
    assert.match(rule[1], /margin: 0 auto;/);
    assert.match(rule[1], /width: 100mm;/);
    assert.match(rule[1], /height: 100mm;/);
  });

  it("a numeração do 'Como ler' é restaurada sobre o preflight (tela e papel)", () => {
    const css = read(CSS);
    assert.match(css, /\.collector-sector-qr-sheet \.sector-howto ol \{[\s\S]*?list-style: decimal outside;/);
    assert.match(css, /\.sector-howto ol \{\s*\n\s*list-style: decimal outside;\s*\n\s*margin: 0;\s*\n\s*padding-left: 7mm;/);
  });

  it("o conteúdo cabe na área útil do A4 retrato (sem 2ª página)", () => {
    const css = read(CSS);
    const pad = new RegExp(`${escape(PRINT_SHEET)} \\{[\\s\\S]*?padding-top: (\\d+)mm;`).exec(css);
    assert.ok(pad, "falta padding-top na folha impressa");
    const qr = /> svg \{[\s\S]*?height: (\d+)mm;/.exec(css);
    assert.ok(qr);
    // 273mm úteis = A4 retrato (297) menos 2 × 12mm de margem do @page.
    const usados = Number(pad[1]) + Number(qr[1]) + 91; // título+texto+caixa ≈ 91mm
    assert.ok(usados < 273, `folha estouraria a página: ~${usados}mm de 273mm`);
  });
});
