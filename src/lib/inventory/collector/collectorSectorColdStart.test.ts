/**
 * Cold-start + UX boot error mapping tests (sem DB).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  mapCollectorBootError,
  mapOperationalStateToBootHint,
} from "@/src/components/inventory/collector/collectorBootError.js";
import { isOfficialMaterialEligibleForStockLink } from "./collectorSectorEligibility.js";
import { InventoryValidationError } from "./../inventoryTypes.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("collectorBootError mapping", () => {
  it("403 → unauthorized", () => {
    const r = mapCollectorBootError({
      status: 403,
      code: null,
      message: "Forbidden",
    });
    assert.equal(r.phase, "unauthorized");
  });

  it("COLLECTOR_DEVICE_UNAUTHORIZED → unauthorized", () => {
    const r = mapCollectorBootError({
      status: 403,
      code: "COLLECTOR_DEVICE_UNAUTHORIZED",
      message: "Dispositivo não autorizado.",
    });
    assert.equal(r.phase, "unauthorized");
  });

  it("COLLECTOR_NO_WAREHOUSE_FOR_SECTOR → NÃO unauthorized", () => {
    const r = mapCollectorBootError({
      status: 400,
      code: "COLLECTOR_NO_WAREHOUSE_FOR_SECTOR",
      message: "Nenhum almoxarifado",
    });
    assert.equal(r.phase, "configuration_error");
    assert.notEqual(r.phase, "unauthorized");
  });

  it("CONFIGURATION_REQUIRED → NÃO unauthorized", () => {
    const r = mapCollectorBootError({
      status: 400,
      code: "CONFIGURATION_REQUIRED",
      message: "Config",
    });
    assert.equal(r.phase, "configuration_error");
  });

  it("500 → error", () => {
    const r = mapCollectorBootError({
      status: 500,
      code: null,
      message: "boom",
    });
    assert.equal(r.phase, "error");
  });

  it("network error → error", () => {
    const r = mapCollectorBootError({
      status: null,
      code: null,
      message: "Failed to fetch",
      networkFailure: true,
    });
    assert.equal(r.phase, "error");
  });

  it("operationalState hints", () => {
    assert.equal(mapOperationalStateToBootHint("READY"), null);
    assert.equal(mapOperationalStateToBootHint("NEEDS_WAREHOUSE_SELECTION"), null);
    assert.equal(mapOperationalStateToBootHint("CONFIGURATION_REQUIRED"), "configuration_error");
    assert.equal(mapOperationalStateToBootHint("NO_ELIGIBLE_ITEMS"), "configuration_error");
  });
});

describe("material eligibility", () => {
  it("ACTIVE complete material is eligible", () => {
    assert.equal(
      isOfficialMaterialEligibleForStockLink({
        status: "ACTIVE",
        code: "MP-1",
        description: "Aço",
        unit: "KG",
      }),
      true
    );
  });

  it("INACTIVE or incomplete is not eligible", () => {
    assert.equal(
      isOfficialMaterialEligibleForStockLink({
        status: "INACTIVE",
        code: "MP-1",
        description: "Aço",
        unit: "KG",
      }),
      false
    );
    assert.equal(
      isOfficialMaterialEligibleForStockLink({
        status: "ACTIVE",
        code: "",
        description: "Aço",
        unit: "KG",
      }),
      false
    );
  });
});

describe("cold-start structural wiring", () => {
  it("context soft: operationalState + diagnostics; prepare wired", () => {
    const routes = read("src/lib/inventory/collector/collectorRoutes.server.ts");
    assert.match(routes, /operationalState/);
    assert.match(routes, /resolveCollectorSectorContextPayload/);
    assert.match(routes, /prepareRawMaterialSectorForCounting|deviceName/);
    assert.match(routes, /createAndStartCollectorSectorSession/);

    const auto = read("src/lib/inventory/collector/collectorAutonomousSession.server.ts");
    assert.match(auto, /prepareRawMaterialSectorForCounting/);
    assert.match(auto, /COLLECTOR_SECTOR_PREPARED|prepare/);
    assert.match(auto, /resolveCollectorSectorOperationalContext/);

    const prep = read("src/lib/inventory/collector/collectorSectorPrepare.server.ts");
    assert.match(prep, /COLLECTOR_SECTOR_PREPARED/);
    assert.match(prep, /userId: null/);
    assert.match(prep, /deviceId: input\.deviceId/);
    assert.doesNotMatch(prep, /inventoryBalance\.create/);
    assert.doesNotMatch(prep, /material\.update/);
    assert.doesNotMatch(prep, /material\.create/);
    assert.match(prep, /Não escreve Material\.quantity/);
    assert.doesNotMatch(prep, /code:\s*["']MP["']/);

    const pop = read("src/lib/inventory/collector/collectorSectorPopulation.server.ts");
    assert.match(pop, /controlsStock/);
    assert.match(pop, /physicalQuantity/);
    assert.doesNotMatch(pop, /balance\.quantity|InventoryBalance\.quantity/);

    const page = read("src/components/inventory/collector/CollectorSectorPage.tsx");
    assert.match(page, /configuration_error/);
    assert.match(page, /mapCollectorBootError/);
    assert.doesNotMatch(
      page.replace(/mapCollectorBootError[\s\S]*?\}\);/, ""),
      /catch\s*\{\s*if\s*\(!cancelled\)\s*setBoot\(\{\s*phase:\s*"unauthorized"/
    );
  });

  it("opening balance semantics documented as motor-aligned zero", () => {
    const pop = read("src/lib/inventory/collector/collectorSectorPopulation.server.ts");
    assert.match(pop, /getOrCreateInventoryBalanceForUpdate|physicalQuantity 0/);
    const repo = read("src/lib/inventory/inventoryRepository.server.ts");
    assert.match(repo, /emptyInventoryBalance|getOrCreateInventoryBalanceForUpdate/);
  });

  it("InventoryValidationError export still usable", () => {
    const e = new InventoryValidationError("x", "COLLECTOR_NO_WAREHOUSE_FOR_SECTOR");
    assert.equal(e.code, "COLLECTOR_NO_WAREHOUSE_FOR_SECTOR");
  });
});
