import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSimulationCommercialOwnerPayload,
  serializeCommercialOwnerLookupItem,
} from "./projectsCommercialOwnerLookup.js";
import { projectCommercialOwnerSelectionToPayload } from "@/src/components/projects/ProjectCommercialOwnerLookupField";

describe("projectsCommercialOwnerLookup", () => {
  it("serializa AppUser sem passwordHash", () => {
    const row = serializeCommercialOwnerLookupItem({
      id: "u1",
      name: "João Silva",
      email: "joao@empresa.com",
      role: "SELLER",
      sellerResponsibleName: "João Vendas",
    });
    assert.equal(row.name, "João Vendas");
    assert.equal(row.email, "joao@empresa.com");
    assert.equal(row.source, "user");
  });

  it("responsável manual salva apenas texto", () => {
    assert.equal(buildSimulationCommercialOwnerPayload("  Maria  "), "Maria");
    assert.deepEqual(
      projectCommercialOwnerSelectionToPayload({ mode: "manual", name: "Carlos" }),
      { commercialOwner: "Carlos" }
    );
  });

  it("lookup comercial é read-only e usa AppUser", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    assert.match(routes, /lookup\/commercial-owners/);
    assert.match(routes, /prisma\.appUser\.findMany/);
    assert.equal(routes.includes("prisma.appUser.create"), false);
    assert.equal(routes.includes("passwordHash"), false);
  });

  it("UI modal novo projeto usa lookup comercial", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    const field = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectCommercialOwnerLookupField.tsx"),
      "utf8"
    );
    assert.match(mod, /ProjectCommercialOwnerLookupField/);
    assert.match(field, /lookup\/commercial-owners/);
    assert.match(field, /Nome manual para simulação/i);
    assert.match(field, /Comercial existente/);
  });

  it("lookup comercial respeita permissões projects.view e projects.manage", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    assert.match(routes, /lookup\/commercial-owners.*\.\.\.lookup/s);
    assert.match(routes, /PROJECTS_LOOKUP_PERMISSIONS/);
  });
});
