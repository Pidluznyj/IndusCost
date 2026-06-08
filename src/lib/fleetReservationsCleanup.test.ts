import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertFleetReservationsCleanupConfirmation,
  assertFleetReservationsCleanupSuperAdmin,
} from "./fleetReservationsCleanup.js";
import {
  FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE,
  FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE,
} from "./fleetReservationsCleanupShared.js";
import { FleetValidationError } from "./fleetValidation.js";
import type { AppAuthContext } from "./appAuth.js";

function mockUser(role: AppAuthContext["role"]): AppAuthContext {
  return {
    id: "user-1",
    name: "Test",
    email: "test@example.com",
    role,
    permissions: [],
    effectivePermissions: [],
    isActive: true,
    externalSellerId: null,
    sellerResponsibleName: null,
    accessProfileId: null,
    accessProfileName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-1",
  };
}

describe("fleetReservationsCleanup", () => {
  it("requires exact confirmation phrase", () => {
    assert.throws(
      () => assertFleetReservationsCleanupConfirmation("apagar"),
      FleetValidationError
    );
    assert.throws(
      () => assertFleetReservationsCleanupConfirmation(""),
      FleetValidationError
    );
    assert.doesNotThrow(() =>
      assertFleetReservationsCleanupConfirmation(FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE)
    );
  });

  it("allows only SUPER_ADMIN", () => {
    assert.throws(
      () => assertFleetReservationsCleanupSuperAdmin(mockUser("ADMIN")),
      (e: unknown) =>
        e instanceof FleetValidationError &&
        e.message.includes("SUPER_ADMIN")
    );
    assert.throws(() => assertFleetReservationsCleanupSuperAdmin(null), FleetValidationError);
    assert.doesNotThrow(() => assertFleetReservationsCleanupSuperAdmin(mockUser("SUPER_ADMIN")));
  });

  it("registers preview and cleanup admin routes", () => {
    const routesPath = join(process.cwd(), "src", "lib", "fleetReservationsCleanupRoutes.ts");
    const fleetRoutesPath = join(process.cwd(), "src", "lib", "fleetRoutes.ts");
    const routesSrc = readFileSync(routesPath, "utf8");
    const fleetRoutesSrc = readFileSync(fleetRoutesPath, "utf8");
    assert.ok(routesSrc.includes("/api/fleet/admin/reservations-cleanup-preview"));
    assert.ok(routesSrc.includes("/api/fleet/admin/reservations-cleanup"));
    assert.ok(routesSrc.includes("assertFleetReservationsCleanupSuperAdmin"));
    assert.ok(fleetRoutesSrc.includes("registerFleetReservationsCleanupRoutes"));
  });

  it("cleanup service deletes reservation domain in safe order", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetReservationsCleanup.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes("fleetPublicReservationApprovalHistory.deleteMany"));
    assert.ok(src.includes("fleetPublicReservationRequest.deleteMany"));
    assert.ok(src.includes("fleetReservation.deleteMany"));
    assert.ok(src.includes("prisma.$transaction"));
    assert.ok(src.includes("recalculateVehicleOperationalStatus"));
    assert.ok(!src.includes("fleetVehicle.deleteMany"));
    assert.ok(!src.includes("fleetDriver.deleteMany"));
    assert.ok(!src.includes("fleetMaintenance.deleteMany"));
  });

  it("UI panel is super-admin only and uses shared confirm phrase", () => {
    const uiPath = join(
      process.cwd(),
      "src",
      "components",
      "fleet",
      "FleetReservationsCleanupPanel.tsx"
    );
    const src = readFileSync(uiPath, "utf8");
    assert.ok(src.includes("isSuperAdmin"));
    assert.ok(src.includes("fleetReservationsCleanupShared"));
    assert.ok(src.includes(FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE));
    assert.ok(src.includes("reservations-cleanup-preview"));
  });

  it("uses dedicated audit entity type for cleanup runs", () => {
    assert.equal(FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE, "FleetReservationsCleanup");
  });
});
