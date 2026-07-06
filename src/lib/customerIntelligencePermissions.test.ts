import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CUSTOMER_INTELLIGENCE_CRM_ACTIVITY_CREATE_PERMISSION,
  CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS,
} from "./customerIntelligencePermissions.js";

describe("customerIntelligencePermissions", () => {
  const routesSrc = readFileSync(
    join(process.cwd(), "src/lib/customerIntelligenceRoutes.ts"),
    "utf8"
  );
  const serverSrc = readFileSync(join(process.cwd(), "server.ts"), "utf8");
  const pageSrc = readFileSync(
    join(process.cwd(), "src/components/crm/CustomerIntelligencePage.tsx"),
    "utf8"
  );
  const modalSrc = readFileSync(
    join(process.cwd(), "src/components/customers/CustomerCommercial360.tsx"),
    "utf8"
  );

  it("endpoint intelligence exige autenticação e permissões de visualização", () => {
    assert.ok(routesSrc.includes("requireAppAuth"));
    assert.ok(routesSrc.includes("requireAnyPermission"));
    assert.ok(routesSrc.includes("CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS"));
    const permissionsSrc = readFileSync(
      join(process.cwd(), "src/lib/customerIntelligencePermissions.ts"),
      "utf8"
    );
    for (const perm of CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS) {
      assert.ok(permissionsSrc.includes(perm), `missing permission ${perm} in permissions module`);
    }
  });

  it("permissoes exportadas alinham com customerIntelligenceRoutes", () => {
    assert.ok(routesSrc.includes("customerIntelligencePermissions"));
    assert.ok(routesSrc.includes("export { CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS }"));
  });

  it("endpoint registrado no server com guard de rotas", () => {
    assert.ok(serverSrc.includes("registerCustomerIntelligenceRoutes"));
    assert.ok(routesSrc.includes("/api/crm/customers/:customerId/intelligence"));
  });

  it("escrita CRM não exposta na tela completa — ações desabilitadas no assembler CRM", () => {
    const crmSrc = readFileSync(join(process.cwd(), "src/lib/customerIntelligenceCrm.ts"), "utf8");
    const permissionsSrc = readFileSync(
      join(process.cwd(), "src/lib/customerIntelligencePermissions.ts"),
      "utf8"
    );
    assert.ok(crmSrc.includes('kind: "disabled"'));
    assert.ok(permissionsSrc.includes(CUSTOMER_INTELLIGENCE_CRM_ACTIVITY_CREATE_PERMISSION));
  });

  it("popup 360 usa endpoint próprio — tela completa usa API consolidada", () => {
    assert.ok(modalSrc.includes("/api/customers/"));
    assert.ok(modalSrc.includes("commercial-360"));
    assert.ok(pageSrc.includes("buildCustomerIntelligenceApiPath"));
    assert.ok(!pageSrc.includes("commercial-360"));
  });

  it("frontend intelligence page usa RequireAuth via App — enforcement principal na API", () => {
    const appSrc = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    assert.ok(appSrc.includes("CustomerIntelligencePage"));
    assert.ok(appSrc.includes("RequireAuth"));
  });
});
