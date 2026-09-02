/**
 * Testes do fluxo autônomo por setor do Stock Collector.
 * Estruturais + unitários sem DB (contrato, blind DTO, population math helpers).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  COLLECTOR_INVALID_SECTOR,
  COLLECTOR_SECTORS,
  buildSectorCollectorAbsoluteUrl,
  buildSectorCollectorPath,
  collectorSectorSlug,
  getCollectorPublicBaseUrl,
  parseCollectorSector,
} from "./collectorSectorContract.js";
import { InventoryValidationError } from "./../inventoryTypes.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("collectorSectorContract", () => {
  it("RAW_MATERIAL slug/label/path", () => {
    assert.equal(COLLECTOR_SECTORS.RAW_MATERIAL.slug, "raw-material");
    assert.equal(COLLECTOR_SECTORS.RAW_MATERIAL.label, "Matéria-prima");
    assert.equal(collectorSectorSlug("RAW_MATERIAL"), "raw-material");
    assert.equal(buildSectorCollectorPath("RAW_MATERIAL"), "/collector/sector/raw-material");
  });

  it("parse sector from code, slug and rejects invalid", () => {
    assert.equal(parseCollectorSector("RAW_MATERIAL"), "RAW_MATERIAL");
    assert.equal(parseCollectorSector("raw-material"), "RAW_MATERIAL");
    assert.equal(parseCollectorSector("raw_material"), "RAW_MATERIAL");
    assert.throws(
      () => parseCollectorSector("finished-product"),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === COLLECTOR_INVALID_SECTOR
    );
  });

  it("public base URL helper + absolute URL", () => {
    assert.equal(getCollectorPublicBaseUrl({}), null);
    assert.equal(
      getCollectorPublicBaseUrl({ INVENTORY_COLLECTOR_PUBLIC_BASE_URL: "https://ts.example/" }),
      "https://ts.example"
    );
    assert.equal(
      getCollectorPublicBaseUrl({ APP_URL: "https://app.example" }),
      "https://app.example"
    );
    assert.equal(
      buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", {
        INVENTORY_COLLECTOR_PUBLIC_BASE_URL: "https://ts.example",
      }),
      "https://ts.example/collector/sector/raw-material"
    );
  });
});

describe("collector autonomous security / wiring", () => {
  it("rotas DEVICE usam deviceAuth; sem requireAppAuth no namespace collector", () => {
    const src = codeOnly(read("src/lib/inventory/collector/collectorRoutes.server.ts"));
    assert.match(src, /requireInventoryCollectorDevice/);
    assert.doesNotMatch(src, /requireAppAuth/);
    assert.doesNotMatch(src, /requireResource/);
    assert.doesNotMatch(src, /getCurrentAppUser/);

    const registrations = src.match(/app\.(get|post|patch)\(/g) ?? [];
    assert.ok(registrations.length >= 9, `esperado ≥9 rotas, veio ${registrations.length}`);

    for (const path of [
      '"/api/inventory/collector/context"',
      '"/api/inventory/collector/count-sessions"',
      '"/api/inventory/collector/count-sessions/active"',
      '"/api/inventory/collector/count"',
      '"/api/inventory/collector/resolve-qr"',
    ]) {
      assert.ok(src.includes(path), `rota ausente: ${path}`);
    }
    assert.match(src, /count-sessions\/:id\/finalize/);
    assert.match(src, /count-sessions\/:id\/apply-adjustments/);
    assert.match(src, /count-sessions\/:id\/items/);

    // Toda rota registrada passa por deviceAuth — exceto o enrollment, que
    // existe justamente para o aparelho AINDA NAO autorizado: exigir
    // deviceAuth ali seria um beco sem saida (so entraria quem nao precisa
    // pedir). Em troca, ele carrega a propria checagem fail-closed.
    const ENROLLMENT = "/api/inventory/collector/enrollment";
    const starts: number[] = [];
    for (const m of src.matchAll(/app\.(get|post|patch)\(/g)) {
      starts.push(m.index ?? 0);
    }
    assert.ok(starts.length >= 9, `esperado >=9 rotas, veio ${starts.length}`);

    let enrollmentRoutes = 0;
    starts.forEach((from, i) => {
      const block = src.slice(from, starts[i + 1] ?? src.length);
      // Cabecalho = do registro ate o handler: e onde vive a cadeia de guards.
      const handlerAt = block.indexOf("async (");
      const header = block.slice(0, handlerAt > 0 ? handlerAt : block.length);

      if (block.includes(ENROLLMENT)) {
        enrollmentRoutes += 1;
        assert.doesNotMatch(
          header,
          /deviceAuth/,
          "enrollment nao pode exigir dispositivo ja autorizado"
        );
        assert.match(
          block,
          /resolveInventoryCollectorPeerIdentity/,
          "enrollment precisa resolver identidade Tailscale"
        );
        assert.match(
          block,
          /if \(!identity\) return denyEnrollment\(res\)/,
          "enrollment precisa negar quando nao ha identidade"
        );
        return;
      }
      assert.match(header, /deviceAuth/, `rota sem deviceAuth: ${header.slice(0, 80)}`);
    });
    assert.equal(enrollmentRoutes, 2, "enrollment expoe exatamente POST e GET");
  });

  it("sector-qr humano fica em inventoryRoutes com countManage", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /\/api\/inventory\/collector\/sector-qr/);
    assert.match(routes, /countManage/);
    assert.match(routes, /buildSectorCollectorAbsoluteUrl/);
  });

  it("App registra /collector/sector/:sectorSlug e preserva /collector", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="\/collector"/);
    assert.match(app, /path="\/collector\/sector\/:sectorSlug"/);
    assert.match(app, /CollectorSectorPage/);
  });

  it("actor DEVICE: CountSessionContext e movement context opcionais", () => {
    const countSvc = read("src/lib/inventory/inventoryCountService.server.ts");
    assert.match(countSvc, /deviceId\?:/);
    assert.match(countSvc, /actorType\?: "USER" \| "DEVICE"/);
    assert.match(countSvc, /context\.actorType !== "DEVICE"/);

    const mov = read("src/lib/inventory/inventoryService.server.ts");
    assert.match(mov, /userId\?: string \| null/);
    assert.match(mov, /deviceId\?: string \| null/);
    assert.match(mov, /if \(context\.deviceId\) return/);
  });

  it("migration aditiva de capacidades do device", () => {
    const sql = read(
      "prisma/migrations/20260821140000_inventory_collector_device_autonomous_caps/migration.sql"
    );
    assert.match(sql, /canManageCountSessions/);
    assert.match(sql, /canApplyCountAdjustments/);
    assert.match(sql, /DEFAULT true/);
    assert.doesNotMatch(sql, /DROP /i);
  });

  it("QR item permanece legado; setor em collectorSectorContract", () => {
    const qr = read("src/lib/inventory/collector/collectorQrContract.ts");
    assert.match(qr, /LEGADO|legado/);
    assert.match(qr, /COLLECTOR_QR_TYPE/);
    const sector = read("src/lib/inventory/collector/collectorSectorContract.ts");
    assert.match(sector, /raw-material/);
  });
});

describe("blind DTO / population / finalize semantics (structural)", () => {
  it("lista cega não serializa systemQuantity/expectedQuantity/adjustmentDelta", () => {
    const auto = read("src/lib/inventory/collector/collectorAutonomousSession.server.ts");
    const listFn = auto.slice(
      auto.indexOf("listCollectorSessionItemsBlind"),
      auto.indexOf("getCollectorSessionSummary")
    );
    assert.doesNotMatch(listFn, /systemQuantity:/);
    assert.doesNotMatch(listFn, /expectedQuantity:/);
    assert.doesNotMatch(listFn, /adjustmentDelta:/);
    assert.match(listFn, /status: counted \? "counted" : "pending"/);
  });

  it("create sessão chama prepare + responsibleUserId null + DEVICE audit", () => {
    const auto = read("src/lib/inventory/collector/collectorAutonomousSession.server.ts");
    assert.match(auto, /status: "COUNTING"/);
    assert.match(auto, /responsibleUserId: null/);
    assert.match(auto, /COLLECTOR_COUNT_SESSION_CREATED/);
    assert.match(auto, /COLLECTOR_COUNT_SESSION_STARTED/);
    assert.match(auto, /deviceId: input\.deviceId/);
    assert.match(auto, /reused: true/);
    assert.match(auto, /prepareRawMaterialSectorForCounting/);
  });

  it("population diagnostics fields e createMany batch", () => {
    const pop = read("src/lib/inventory/collector/collectorSectorPopulation.server.ts");
    assert.match(pop, /materialsTotal/);
    assert.match(pop, /materialsLinked/);
    assert.match(pop, /materialsMissingInventoryItem/);
    assert.match(pop, /inventoryItemsWithoutBalance/);
    assert.match(pop, /linesCreated/);
    assert.match(pop, /createMany/);
    assert.match(pop, /skippedExistingLines/);
  });

  it("finalize: PENDING_ITEMS, allowUncounted não zera, justificativa DEVICE", () => {
    const auto = read("src/lib/inventory/collector/collectorAutonomousSession.server.ts");
    assert.match(auto, /PENDING_ITEMS|COLLECTOR_PENDING_ITEMS/);
    assert.match(auto, /COLLECTOR_DEVICE_JUSTIFICATION/);
    assert.match(auto, /allowUncounted/);
    assert.doesNotMatch(auto, /countedQuantity:\s*0/);
    const helper = read("src/lib/inventory/inventoryCountDeviceJustification.ts");
    assert.match(helper, /Contagem física Collector/);
  });

  it("count zero é válido no contrato DEVICE", () => {
    const contract = read("src/lib/inventory/collector/collectorCountContract.ts");
    assert.match(contract, /counted < 0/);
    assert.doesNotMatch(contract, /counted <= 0/);
    assert.doesNotMatch(contract, /counted === 0/);
  });

  it("recordInventoryCount injeta justificativa DEVICE no motor, não no frontend", () => {
    const app = read("src/lib/inventory/inventoryCountApplicationService.server.ts");
    assert.match(app, /resolveRecordedCountJustification/);
    const helper = read("src/lib/inventory/inventoryCountDeviceJustification.ts");
    assert.match(helper, /Contagem física Collector/);
    assert.match(helper, /actorType === "DEVICE"/);
    const page = read("src/components/inventory/collector/CollectorSectorPage.tsx");
    assert.doesNotMatch(page, /textarea/i);
    assert.match(page, /JUSTIFICATION_REQUIRED/);
    assert.doesNotMatch(page, /Informe a justificativa/);
  });

  it("suprimentos usa InventoryBalance como SoT sem write Material.quantity", () => {
    const tablet = read("src/lib/materialStockTablet.server.ts");
    assert.match(tablet, /InventoryBalance/);
    assert.match(tablet, /applyLinkedInventoryBalanceQuantities/);
    assert.doesNotMatch(tablet, /material\.update/);
    assert.doesNotMatch(tablet, /inventoryBalance\.update/);
  });
});
