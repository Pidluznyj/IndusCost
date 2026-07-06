import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getAdvancedFleetTabs,
  getVisibleFleetTabs,
  normalizeFleetTabId,
} from "@/src/components/fleet/fleetNavigation";

describe("fleetNavigation", () => {
  it("normalizes legacy dashboard tab id", () => {
    assert.equal(normalizeFleetTabId("dashboard"), "overview");
    assert.equal(normalizeFleetTabId("vehicles"), "vehicles");
    assert.equal(normalizeFleetTabId(undefined), "overview");
  });

  it("shows core tabs for common viewer", () => {
    const tabs = getVisibleFleetTabs({ canView: true, canFinancial: false });
    const ids = tabs.map((t) => t.id);
    assert.ok(ids.includes("overview"));
    assert.ok(ids.includes("vehicles"));
    assert.ok(ids.includes("reservations"));
    assert.ok(ids.includes("checklists"));
    assert.ok(!ids.includes("reports"));
    assert.ok(!ids.includes("mobile"));
    assert.ok(!ids.includes("contracts"));
    assert.ok(!ids.includes("documents"));
  });

  it("exposes financial tabs only for canFinancial", () => {
    const adv = getAdvancedFleetTabs({ canView: true, canFinancial: true });
    const ids = adv.map((t) => t.id);
    assert.deepEqual(ids.sort(), ["costs", "incidents", "reports"].sort());
    assert.equal(getAdvancedFleetTabs({ canView: true, canFinancial: false }).length, 0);
  });

  it("FleetModule wires simplified navigation and checklists tab", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "FleetModule.tsx"), "utf8");
    const nav = readFileSync(
      join(process.cwd(), "src", "components", "fleet", "fleetNavigation.ts"),
      "utf8"
    );
    assert.ok(mod.includes("getVisibleFleetTabs"));
    assert.ok(mod.includes("FleetChecklistsTab"));
    assert.ok(nav.includes("Visão Geral"));
    assert.match(nav, /id: "mobile"[\s\S]{0,120}showInNav: false/);
  });

  it("registers checklist list endpoints", () => {
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "fleetVehicleChecklistInternalRoutes.ts"),
      "utf8"
    );
    assert.ok(routes.includes('"/api/fleet/reservation-checklists"'));
    assert.ok(routes.includes('"/api/fleet/checklist-pending-reservations"'));
  });
});
