import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canExportCustomerListReport } from "./customerListReportExportAccess.js";

describe("canExportCustomerListReport", () => {
  it("libera Super Admin e Supervisor comercial", () => {
    assert.equal(canExportCustomerListReport({ role: "SUPER_ADMIN", accessProfileName: null }), true);
    assert.equal(
      canExportCustomerListReport({ role: "SELLER", accessProfileName: "Supervisor comercial" }),
      true
    );
    assert.equal(
      canExportCustomerListReport({ role: "VIEWER", accessProfileName: "  SUPERVISOR COMERCIAL " }),
      true
    );
  });

  it("nega gestor, vendedor, admin e visualizador sem o perfil", () => {
    assert.equal(
      canExportCustomerListReport({ role: "COMMERCIAL_MANAGER", accessProfileName: "Gestor comercial" }),
      false
    );
    assert.equal(canExportCustomerListReport({ role: "ADMIN", accessProfileName: "Administrador" }), false);
    assert.equal(canExportCustomerListReport({ role: "SELLER", accessProfileName: "Vendedor" }), false);
    assert.equal(canExportCustomerListReport({ role: "VIEWER", accessProfileName: null }), false);
    assert.equal(canExportCustomerListReport(null), false);
  });
});
