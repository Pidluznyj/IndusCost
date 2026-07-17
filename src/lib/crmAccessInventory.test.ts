import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCrmAccessInventoryRow,
  type CrmAccessInventoryUser,
} from "./crmAccessInventory.ts";

function fixture(
  patch: Partial<CrmAccessInventoryUser> = {}
): CrmAccessInventoryUser {
  const profilePermissions = [
    "crm.view",
    "crm.seller.view",
    "crm.seller.own",
    "crm.customer_cockpit.view",
    "customers.commercial360.view",
  ];
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Vendedor",
    email: "vendedor@example.com",
    role: "VIEWER",
    isActive: true,
    permissionsVersion: 1,
    permissions: profilePermissions,
    accessProfile: {
      id: "00000000-0000-0000-0000-000000000010",
      name: "Vendedor",
      permissions: profilePermissions,
    },
    permissionOverrides: [],
    externalSellerId: 10,
    externalSellerIds: [10],
    sellerResponsibleName: "VENDEDOR",
    ...patch,
  };
}

test("inventário resolve perfil vendedor VIEWER como own", () => {
  const row = buildCrmAccessInventoryRow(fixture());
  assert.equal(row.dataScope, "own");
  assert.equal(row.sellerLinked, true);
  assert.deepEqual(row.issues, []);
  assert.ok(row.effectiveCrmResources.includes("commercial.crm.scope.own"));
});

test("inventário sinaliza shell sem escopo utilizável", () => {
  const permissions = ["crm.view"];
  const row = buildCrmAccessInventoryRow(
    fixture({
      permissions,
      accessProfile: {
        id: "00000000-0000-0000-0000-000000000010",
        name: "Incompleto",
        permissions,
      },
    })
  );
  assert.equal(row.dataScope, "none");
  assert.ok(row.issues.includes("CRM_SHELL_WITHOUT_USABLE_SCOPE"));
});

test("inventário sinaliza own sem vínculo e drift do snapshot", () => {
  const row = buildCrmAccessInventoryRow(
    fixture({
      permissions: ["crm.view"],
      externalSellerId: null,
      externalSellerIds: [],
      sellerResponsibleName: null,
    })
  );
  assert.ok(row.issues.includes("OWN_SCOPE_WITHOUT_COMMERCIAL_LINK"));
  assert.ok(row.issues.includes("PROFILE_SNAPSHOT_DRIFT"));
});

test("auditor de CRM é estritamente read-only", () => {
  const source = readFileSync(
    new URL("../../scripts/auditCrmAccess.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    source,
    /prisma\.[A-Za-z0-9_]+\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/
  );
  assert.match(source, /readOnly:\s*true/);
});
