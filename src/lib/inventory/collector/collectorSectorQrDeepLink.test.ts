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
 * `reports-print.css` aplica `body * { visibility: hidden }` no @media print e
 * só devolve visibilidade a uma allow-list de print-roots. Sem override próprio
 * a rota /inventory-labels imprimia EM BRANCO.
 */
describe("QR de setor — folha de impressão", () => {
  const PAGE = "src/components/inventory/collector/InventoryCountLabelsPage.tsx";
  const CSS = "src/components/inventory/collector/inventory-labels-print.css";

  it("a rota marca o body e carrega o CSS de impressão próprio", () => {
    const page = read(PAGE);
    assert.match(page, /usePrintRouteBodyClass/);
    assert.match(page, /inventory-labels-print-route/);
    assert.match(page, /import "\.\/inventory-labels-print\.css"/);
  });

  it("o CSS anula o visibility:hidden global (senão imprime em branco)", () => {
    const css = read(CSS);
    assert.match(css, /@media print/);
    assert.match(
      css,
      /body\.inventory-labels-print-route,\s*\n\s*body\.inventory-labels-print-route \*\s*\{\s*\n\s*visibility: visible !important;/
    );
  });

  it("a folha traz nome do setor, o que o QR faz, o QR e como ler", () => {
    const page = read(PAGE);
    const sheet = /<section\s+className="inventory-labels-sector-print"[\s\S]*?<\/section>/.exec(
      page
    );
    assert.ok(sheet, "folha de impressão do QR de setor não encontrada");
    const html = sheet[0];
    // 1) nome do setor
    assert.match(html, /<h1>\{sectorQr\.label\}<\/h1>/);
    // 2) o que o QR faz
    assert.match(html, /Este QR abre a contagem de estoque deste setor no tablet\./);
    // 3) o QR em si
    assert.match(html, /<QRCodeSVG value=\{sectorQr\.url\}/);
    // 4) instrução de leitura
    assert.match(html, /Como ler:/);
    assert.equal((html.match(/<li>/g) ?? []).length, 4);
    // "somente isso": sem URL crua nem botões dentro da folha impressa.
    assert.doesNotMatch(html, /\{sectorQr\.url\}<\/p>/);
    assert.doesNotMatch(html, /<button/);
    assert.doesNotMatch(html, /Copiar link|Abrir link/);
  });

  it("o bloco de tela do QR não é impresso (não duplica a folha)", () => {
    const page = read(PAGE);
    assert.match(page, /className="inventory-labels-no-print mb-8 rounded-xl border-2 border-emerald-600/);
    const css = read(CSS);
    assert.match(css, /\.inventory-labels-no-print\s*\{\s*\n\s*display: none !important;/);
  });

  it("etiquetas por item continuam imprimíveis, em página própria", () => {
    const page = read(PAGE);
    assert.match(page, /className="inventory-labels-grid grid/);
    const css = read(CSS);
    assert.match(css, /\.inventory-labels-grid\s*\{[\s\S]*?page-break-before: always;/);
  });
});
