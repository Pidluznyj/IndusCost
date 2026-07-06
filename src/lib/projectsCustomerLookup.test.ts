import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildExistingCustomerPayload,
  buildSimulationCustomerPayload,
  formatCustomerDisplayName,
  PROJECTS_CUSTOMER_LOOKUP_LIMIT,
  serializeCustomerLookupItem,
} from "./projectsCustomerLookup.js";
import { projectCustomerSelectionToPayload } from "@/src/components/projects/ProjectCustomerLookupField";

describe("projectsCustomerLookup", () => {
  it("serializa cliente da tabela Customer (fonte oficial)", () => {
    const row = serializeCustomerLookupItem({
      id: "c1",
      companyName: "Esmaltec",
      tradeName: "Esmaltec SA",
      taxId: "12345678000199",
    });
    assert.equal(row.id, "c1");
    assert.equal(row.name, "Esmaltec (Esmaltec SA)");
    assert.equal(row.document, "12345678000199");
    assert.equal(row.source, "customer");
  });

  it("cliente novo digitado salva apenas customerName sem documento", () => {
    const payload = buildSimulationCustomerPayload("  Cliente Simulado  ");
    assert.equal(payload.customerName, "Cliente Simulado");
    assert.equal(payload.customerDocument, null);
  });

  it("cliente existente preenche customerName e customerDocument", () => {
    const payload = buildExistingCustomerPayload({
      id: "c2",
      name: "ACME Ltda",
      document: "99887766000155",
      source: "customer",
    });
    assert.equal(payload.customerName, "ACME Ltda");
    assert.equal(payload.customerDocument, "99887766000155");
  });

  it("lookup limita resultados a 20", () => {
    assert.equal(PROJECTS_CUSTOMER_LOOKUP_LIMIT, 20);
  });

  it("endpoint de lookup é read-only no routes", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    assert.match(routes, /\/api\/projects\/lookup\/customers/);
    assert.match(routes, /prisma\.customer\.findMany/);
    assert.equal(routes.includes("prisma.customer.create"), false);
    assert.equal(routes.includes("prisma.customer.update"), false);
  });

  it("lookup respeita permissões projects.view e projects.manage", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    const perms = readFileSync(join(process.cwd(), "src", "lib", "projectsPermissions.ts"), "utf8");
    assert.match(routes, /PROJECTS_LOOKUP_PERMISSIONS/);
    assert.match(routes, /lookup\/customers.*\.\.\.lookup/s);
    assert.match(perms, /projects\.view/);
    assert.match(perms, /projects\.manage/);
  });

  it("UI do modal permite cliente manual e existente", () => {
    const mod = readFileSync(
      join(process.cwd(), "src", "components", "ProjectsModule.tsx"),
      "utf8"
    );
    const field = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectCustomerLookupField.tsx"),
      "utf8"
    );
    assert.match(mod, /ProjectCustomerLookupField/);
    assert.match(mod, /customerDocument/);
    assert.match(field, /cliente novo para simulação/i);
    assert.match(field, /Cliente existente/);
    assert.match(field, /lookup\/customers/);
  });

  it("projectCustomerSelectionToPayload aceita manual e existente", () => {
    assert.deepEqual(
      projectCustomerSelectionToPayload({ mode: "simulation", name: "Novo Cliente" }),
      { customerName: "Novo Cliente", customerDocument: null }
    );
    assert.deepEqual(
      projectCustomerSelectionToPayload({
        mode: "existing",
        item: { id: "1", name: "ACME", document: "111", source: "customer" },
      }),
      { customerName: "ACME", customerDocument: "111" }
    );
  });

  it("formatCustomerDisplayName usa razão social", () => {
    assert.equal(
      formatCustomerDisplayName({ companyName: "Indústria X", tradeName: null }),
      "Indústria X"
    );
  });
});
