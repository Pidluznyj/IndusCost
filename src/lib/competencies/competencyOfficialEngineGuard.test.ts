/**
 * Guard da engine oficial: a UI de Competências só FORMATA números vindos da API.
 * Nenhum componente importa funções de cálculo da engine (tipos são permitidos), e só
 * `competency.server.ts` e o próprio módulo de testes chamam a engine.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(process.cwd(), "src");
const COMPONENTS = join(ROOT, "components", "competencies");
const LIB = join(ROOT, "lib", "competencies");

function importsOfEngine(source: string): string[] {
  const out: string[] = [];
  const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*competencyEngine["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[1]) continue; // import type { ... }
    for (const part of m[2].split(",")) {
      const name = part.trim();
      if (name && !name.startsWith("type ")) out.push(name);
    }
  }
  return out;
}

describe("Competências — engine oficial", () => {
  it("componentes não importam funções de cálculo da engine", () => {
    for (const file of readdirSync(COMPONENTS).filter((f) => /\.tsx?$/.test(f))) {
      const values = importsOfEngine(readFileSync(join(COMPONENTS, file), "utf8"));
      assert.deepEqual(values, [], `${file} importa ${values.join(", ")} da engine`);
    }
  });

  it("no servidor, só competency.server.ts calcula com a engine", () => {
    const callers = readdirSync(LIB)
      .filter((f) => /\.ts$/.test(f) && !f.endsWith(".test.ts") && f !== "competencyEngine.ts")
      .filter((f) => importsOfEngine(readFileSync(join(LIB, f), "utf8")).length > 0);
    assert.deepEqual(callers, ["competency.server.ts"]);
  });

  it("aba Competências da ficha só lê pelo cliente do módulo (sem fonte paralela)", () => {
    const tab = readFileSync(join(ROOT, "components", "employee", "profile", "PeopleCompetenciesTab.tsx"), "utf8");
    assert.deepEqual(importsOfEngine(tab), []);
    assert.match(tab, /from "@\/src\/lib\/competencies\/competencyClient"/);
    assert.doesNotMatch(tab, /\/api\/employees\//, "não usa rotas da ficha para dados de competência");
    assert.doesNotMatch(tab, /fetch\(/, "sem fetch próprio");
    const dialog = readFileSync(join(ROOT, "components", "employee", "profile", "PeopleEmployeeProfileDialog.tsx"), "utf8");
    assert.match(dialog, /lazy\(\(\) =>\s*import\("\.\/PeopleCompetenciesTab"\)/, "carregada sob demanda");
  });

  it("rotas registradas no server.ts com o guard do editor de RH", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /registerCompetencyRoutes\(\s*app,\s*\{\s*requireAppAuth,\s*requireResource:\s*requireResourceOrHrEditor,/);
  });
});
