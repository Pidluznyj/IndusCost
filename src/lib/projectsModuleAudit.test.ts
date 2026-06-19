import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROJECTS_MODULE_FEATURE_AUDIT,
  type ProjectsModuleFeatureAudit,
  type ProjectsModuleFeatureCategory,
  type ProjectsModuleFeatureStatus,
} from "./projectsModuleAudit.js";

const VALID_CATEGORIES = new Set<ProjectsModuleFeatureCategory>([
  "project_crud",
  "simulated_product",
  "bom",
  "labor",
  "cost",
  "mold",
  "official_snapshot",
  "permissions",
  "reporting",
]);

const VALID_STATUSES = new Set<ProjectsModuleFeatureStatus>([
  "implemented",
  "partial",
  "missing",
  "unknown",
]);

function assertFeatureShape(feature: ProjectsModuleFeatureAudit) {
  assert.ok(feature.id.trim().length > 0, "id obrigatório");
  assert.ok(feature.name.trim().length > 0, "name obrigatório");
  assert.ok(VALID_CATEGORIES.has(feature.category), `categoria inválida: ${feature.category}`);
  assert.ok(VALID_STATUSES.has(feature.status), `status inválido: ${feature.status}`);
  assert.ok(Array.isArray(feature.files), "files deve ser array");
  assert.ok(Array.isArray(feature.endpoints), "endpoints deve ser array");
  assert.ok(Array.isArray(feature.models), "models deve ser array");
  assert.ok(feature.description.trim().length > 0, "description obrigatória");
  assert.ok(Array.isArray(feature.limitations), "limitations deve ser array");
  assert.ok(feature.recommendedNextStep.trim().length > 0, "recommendedNextStep obrigatório");
}

describe("projectsModuleAudit", () => {
  it("exporta matriz de funcionalidades não vazia", () => {
    assert.ok(PROJECTS_MODULE_FEATURE_AUDIT.length >= 10);
  });

  it("ids são únicos", () => {
    const ids = PROJECTS_MODULE_FEATURE_AUDIT.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("cada feature tem estrutura válida", () => {
    for (const feature of PROJECTS_MODULE_FEATURE_AUDIT) {
      assertFeatureShape(feature);
    }
  });

  it("cobre categorias principais do módulo", () => {
    const categories = new Set(PROJECTS_MODULE_FEATURE_AUDIT.map((f) => f.category));
    for (const required of [
      "project_crud",
      "simulated_product",
      "bom",
      "cost",
      "official_snapshot",
      "permissions",
    ] as const) {
      assert.ok(categories.has(required), `falta categoria ${required}`);
    }
  });

  it("isolamento oficial está documentado como implementado", () => {
    const isolation = PROJECTS_MODULE_FEATURE_AUDIT.find((f) => f.id === "official-isolation");
    assert.ok(isolation);
    assert.equal(isolation!.status, "implemented");
    assert.ok(isolation!.files.includes("src/lib/projectSimulationMode.ts"));
  });

  it("CRUD de projetos referencia rotas principais", () => {
    const crud = PROJECTS_MODULE_FEATURE_AUDIT.find((f) => f.id === "project-crud");
    assert.ok(crud);
    assert.ok(crud!.endpoints.some((e) => e.includes("GET /api/projects")));
    assert.ok(crud!.endpoints.some((e) => e.includes("POST /api/projects")));
  });
});
