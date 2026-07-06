import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createBrowserSafeId } from "./browserSafeId.js";

const originalCrypto = globalThis.crypto;

function restoreCrypto() {
  Object.defineProperty(globalThis, "crypto", {
    value: originalCrypto,
    configurable: true,
    writable: true,
  });
}

describe("createBrowserSafeId", () => {
  afterEach(() => {
    restoreCrypto();
  });

  it("usa randomUUID quando disponível", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: {
        randomUUID: () => "11111111-2222-3333-4444-555555555555",
      },
      configurable: true,
      writable: true,
    });

    const id = createBrowserSafeId("mold-line");
    assert.equal(id, "mold-line-11111111-2222-3333-4444-555555555555");
  });

  it("gera ID com fallback quando randomUUID não existe", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: {
        getRandomValues: (arr: Uint32Array) => {
          arr[0] = 12345;
          arr[1] = 67890;
          return arr;
        },
      },
      configurable: true,
      writable: true,
    });

    const id = createBrowserSafeId("other-cost");
    assert.match(id, /^other-cost-[a-z0-9]+-9ix-1gdu$/);
  });

  it("gera ID quando crypto não existe", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const id = createBrowserSafeId("batch");
    assert.match(id, /^batch-[a-z0-9]+-[a-z0-9]+$/);
  });

  it("sempre inclui prefixo", () => {
    const id = createBrowserSafeId("proj");
    assert.ok(id.startsWith("proj-"));
  });

  it("duas chamadas geram valores diferentes", () => {
    const a = createBrowserSafeId("line");
    const b = createBrowserSafeId("line");
    assert.notEqual(a, b);
  });
});

describe("guided project flow — ids browser-safe", () => {
  it("createEmptyMoldLine não usa crypto.randomUUID diretamente", () => {
    const moldLines = readFileSync(
      join(process.cwd(), "src", "lib", "projectsMoldCostLines.ts"),
      "utf8"
    );
    assert.equal(moldLines.includes("crypto.randomUUID"), false);
    assert.match(moldLines, /createBrowserSafeId/);
  });

  it("modais e módulo de projeto não usam crypto.randomUUID diretamente", () => {
    const files = [
      "src/lib/projectsOtherCostGroups.ts",
      "src/components/ProjectsModule.tsx",
      "src/components/projects/ProjectGuidedMoldModal.tsx",
      "src/components/projects/ProjectOtherCostsModal.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      assert.equal(src.includes("crypto.randomUUID"), false, file);
    }
  });
});
