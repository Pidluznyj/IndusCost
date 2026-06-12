import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const NATIVE_PATTERN = /\b(window\.)?(prompt|alert|confirm)\s*\(/;

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectFiles(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\.(tsx?|jsx?)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("projectsNativeDialogs", () => {
  it("módulo Projetos não usa prompt, alert ou confirm nativos", () => {
    const roots = [
      join(process.cwd(), "src", "components", "ProjectsModule.tsx"),
      join(process.cwd(), "src", "components", "projects"),
    ];
    const files: string[] = [];
    for (const root of roots) {
      try {
        const st = statSync(root);
        if (st.isDirectory()) collectFiles(root, files);
        else files.push(root);
      } catch {
        // ignore
      }
    }
    const libFiles = collectFiles(join(process.cwd(), "src", "lib"), []).filter(
      (f) => /projects/i.test(f) && !/\.test\.(tsx?|jsx?)$/.test(f)
    );
    for (const file of [...files, ...libFiles]) {
      const content = readFileSync(file, "utf8");
      assert.equal(
        NATIVE_PATTERN.test(content),
        false,
        `${file} contém diálogo nativo do navegador`
      );
    }
  });

  it("fluxo guiado abre ProjectGuidedMoldModal para moldes", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    assert.match(mod, /ProjectGuidedMoldModal/);
    assert.match(mod, /setGuidedMoldModalOpen\(true\)/);
    assert.equal(mod.includes("window.prompt"), false);
    assert.equal(mod.includes("ProjectMoldFormModal"), false);
  });

  it("exclusão não usa confirm nativo", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    assert.match(mod, /ProjectDeleteConfirmModal/);
    assert.equal(mod.includes("window.confirm"), false);
    assert.equal(/\bconfirm\s*\(/.test(mod), false);
  });
});
