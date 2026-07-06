import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  previewProjectStructureLineTotal,
  ProjectStructureLineValidationError,
  resolveMaterialDefaultLossPercent,
  resolveProjectStructureLineCostSource,
  validateProjectStructureLineCreate,
} from "./projectsStructureLineBuilderShared.js";

const FORBIDDEN_COMPONENT_IMPORT_PATTERNS = [
  "@prisma/client",
  "src/lib/prisma",
  "@/src/lib/prisma",
  "projectsService",
  "projectsRoutes",
];

const FORBIDDEN_SHARED_IMPORT_PATTERNS = [
  "@prisma/client",
  "src/lib/prisma",
  "@/src/lib/prisma",
  "projectsService",
  "projectsRoutes",
  "projectsStructureLineBuilder.ts",
  "projectsStructureLineBuilder.js",
];

function collectComponentTsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectComponentTsxFiles(full, acc);
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) acc.push(full);
  }
  return acc;
}

describe("projectsStructureLineBuilderShared", () => {
  it("calcula total com perda", () => {
    assert.equal(previewProjectStructureLineTotal(0.04, 12.5, 5), 0.525);
    assert.equal(previewProjectStructureLineTotal(1, 10, 0), 10);
    assert.equal(previewProjectStructureLineTotal(1, 10, 10), 11);
  });

  it("valida quantidade > 0", () => {
    assert.throws(
      () =>
        validateProjectStructureLineCreate({
          sourceType: "EXISTING_MATERIAL",
          quantity: 0,
          existingMaterial: {
            id: "m",
            code: "C",
            description: "D",
            unit: "KG",
            currentCost: 1,
          },
        }),
      ProjectStructureLineValidationError
    );
  });

  it("resolve perda padrão do material", () => {
    assert.equal(resolveMaterialDefaultLossPercent({ standardLoss: 4 }), 4);
    assert.equal(resolveMaterialDefaultLossPercent({ standardLoss: null }), 0);
  });

  it("resolve costSource por origem", () => {
    assert.equal(resolveProjectStructureLineCostSource("EXISTING_MATERIAL"), "MATERIAL_CURRENT_COST");
    assert.equal(resolveProjectStructureLineCostSource("SIMULATED_ITEM"), "PROJECT_SIMULATED_ITEM");
  });

  it("shared não importa dependências server-only", () => {
    const shared = readFileSync(
      join(process.cwd(), "src", "lib", "projectsStructureLineBuilderShared.ts"),
      "utf8"
    );
    for (const pattern of FORBIDDEN_SHARED_IMPORT_PATTERNS) {
      assert.equal(
        shared.includes(pattern),
        false,
        `projectsStructureLineBuilderShared.ts contém import proibido: ${pattern}`
      );
    }
  });

  it("componentes React não importam Prisma, service ou routes", () => {
    const componentsRoot = join(process.cwd(), "src", "components");
    const files = collectComponentTsxFiles(componentsRoot);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_COMPONENT_IMPORT_PATTERNS) {
        assert.equal(
          content.includes(pattern),
          false,
          `${file} contém padrão proibido: ${pattern}`
        );
      }
    }
  });

  it("ProjectStructureLineModal importa apenas helper shared", () => {
    const modal = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectStructureLineModal.tsx"),
      "utf8"
    );
    assert.match(modal, /from ["']@\/src\/lib\/projectsStructureLineBuilderShared["']/);
    assert.doesNotMatch(modal, /from ["']@\/src\/lib\/projectsStructureLineBuilder["']/);
  });
});
