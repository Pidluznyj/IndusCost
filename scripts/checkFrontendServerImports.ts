/**
 * Guardrail de separação Frontend × Backend.
 *
 * Falha (exit 1) se algum arquivo do bundle React importar:
 *  - @prisma/client (mesmo type-only — Prisma nunca no browser);
 *  - src/lib/prisma (em qualquer forma de caminho);
 *  - libs server-side conhecidas que importam Prisma direta ou indiretamente,
 *    como src/lib/nomusEngineeringOperationsCockpit (sem Shared/Types).
 *
 * Não use este script para varrer scripts/ ou server.ts — esses são server-side
 * e podem importar Prisma livremente.
 *
 * Uso: npm run check:frontend-imports
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

type Violation = {
  file: string;
  line: number;
  specifier: string;
  rule: string;
};

const ROOT = process.cwd();

const SCAN_ROOTS: string[] = [
  path.join("src", "components"),
  path.join("src", "contexts"),
  path.join("src", "hooks"),
  path.join("src", "views"),
  path.join("src", "App.tsx"),
  path.join("src", "main.tsx"),
];

const FORBIDDEN_SPECIFIERS: Array<{
  test: (specifier: string) => boolean;
  rule: string;
}> = [
  {
    rule: "Prisma client não pode ir para o bundle React",
    test: (s) => s === "@prisma/client" || s.startsWith("@prisma/client/"),
  },
  {
    rule: "Instância do Prisma (src/lib/prisma) é server-side",
    test: (s) =>
      /(^|\/)prisma$/.test(s) ||
      /(^|\/)lib\/prisma$/.test(s) ||
      /(^|\/)src\/lib\/prisma$/.test(s) ||
      s === "@/src/lib/prisma" ||
      s === "@/lib/prisma",
  },
  {
    rule: "Lib server-side da Central de Atualização Nomus (usar ...CockpitShared ou ...CockpitTypes)",
    test: (s) => {
      // Aceita Shared/Types; bloqueia o arquivo principal sem sufixo.
      const base = s.replace(/\.(?:ts|tsx|js|jsx)$/, "");
      return /(^|\/)nomusEngineeringOperationsCockpit$/.test(base);
    },
  },
  {
    rule: "Lib server-side do Plano de Ação de Equalização (usar ...ActionPlanTypes, ...ActionPlanShared ou ...ActionPlanClient)",
    test: (s) => {
      const base = s.replace(/\.(?:ts|tsx|js|jsx)$/, "");
      return /(^|\/)nomusEngineeringEqualizationActionPlan$/.test(base);
    },
  },
  {
    rule: "Lib server-side da Carga Mestre Nomus (usar ...MasterDataImportTypes, ...MasterDataImportShared ou ...MasterDataImportClient)",
    test: (s) => {
      const base = s.replace(/\.(?:ts|tsx|js|jsx)$/, "");
      return /(^|\/)nomusMasterDataImport$/.test(base);
    },
  },
  {
    rule: "Lib server-side do Igualar Bases Nomus (usar ...EqualizeTypes, ...EqualizeShared ou ...EqualizeClient)",
    test: (s) => {
      const base = s.replace(/\.(?:ts|tsx|js|jsx)$/, "");
      return /(^|\/)nomusMasterDataEqualize$/.test(base);
    },
  },
  {
    rule: "Lib server-side do histórico de alterações (usar ...HistoryTypes ou ...HistoryClient)",
    test: (s) => {
      const base = s.replace(/\.(?:ts|tsx|js|jsx)$/, "");
      return /(^|\/)productChangeHistory$/.test(base);
    },
  },
];

/**
 * Lista adicional de libs server-side conhecidas que importam Prisma.
 * Centralize aqui novos arquivos que aparecerem como problema no futuro.
 */
const KNOWN_SERVER_LIBS = new Set<string>([
  "nomusEngineeringOperationsCockpit",
  "nomusEngineeringEqualizationActionPlan",
  "nomusMasterDataImport",
  "nomusMasterDataEqualize",
  "productChangeHistory",
  // Sinta-se livre para acrescentar outras libs server-side aqui.
]);

const IMPORT_REGEX =
  /^\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|export\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"])/;
const REQUIRE_REGEX = /require\(\s*['"]([^'"]+)['"]\s*\)/;

function listFilesRecursive(absPath: string): string[] {
  if (!existsSync(absPath)) return [];
  const stats = statSync(absPath);
  if (stats.isFile()) return [absPath];
  const out: string[] = [];
  for (const entry of readdirSync(absPath)) {
    const full = path.join(absPath, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (/\.(ts|tsx|js|jsx)$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function checkSpecifier(spec: string): { rule: string } | null {
  for (const f of FORBIDDEN_SPECIFIERS) {
    if (f.test(spec)) return { rule: f.rule };
  }
  const base = spec.replace(/\.(?:ts|tsx|js|jsx)$/, "");
  const last = base.split("/").pop() ?? "";
  if (KNOWN_SERVER_LIBS.has(last)) {
    return { rule: `Lib server-side conhecida não pode ser importada do frontend: ${last}` };
  }
  return null;
}

function scanFile(filePath: string): Violation[] {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];

  // Multi-line imports são raros mas possíveis. Fazemos uma análise simples linha a linha
  // e também uma varredura global para capturar imports quebrados em várias linhas.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let specs: string[] = [];

    const m = IMPORT_REGEX.exec(line);
    if (m) {
      const captured = m[1] ?? m[2] ?? m[3];
      if (captured) specs.push(captured);
    }
    const r = REQUIRE_REGEX.exec(line);
    if (r) specs.push(r[1]);

    for (const spec of specs) {
      const hit = checkSpecifier(spec);
      if (hit) {
        violations.push({
          file: path.relative(ROOT, filePath).replace(/\\/g, "/"),
          line: i + 1,
          specifier: spec,
          rule: hit.rule,
        });
      }
    }
  }

  // Captura imports multi-linha do tipo:
  //   import {
  //     A,
  //     B,
  //   } from "...";
  // analisando o texto inteiro como uma única string.
  const multiLineRegex =
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]+?)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = multiLineRegex.exec(text)) != null) {
    const spec = match[1];
    const hit = checkSpecifier(spec);
    if (hit) {
      // descobre a linha aproximada
      const upto = text.slice(0, match.index);
      const lineNumber = upto.split(/\r?\n/).length;
      const exists = violations.some(
        (v) =>
          v.file.endsWith(path.relative(ROOT, filePath).replace(/\\/g, "/")) &&
          v.specifier === spec &&
          v.line === lineNumber
      );
      if (!exists) {
        violations.push({
          file: path.relative(ROOT, filePath).replace(/\\/g, "/"),
          line: lineNumber,
          specifier: spec,
          rule: hit.rule,
        });
      }
    }
  }

  return violations;
}

function main(): void {
  const files: string[] = [];
  for (const rel of SCAN_ROOTS) {
    files.push(...listFilesRecursive(path.join(ROOT, rel)));
  }

  if (files.length === 0) {
    console.warn("[check:frontend-imports] nada para escanear.");
    process.exit(0);
  }

  const violations: Violation[] = [];
  for (const file of files) {
    violations.push(...scanFile(file));
  }

  if (violations.length === 0) {
    console.warn(`[check:frontend-imports] OK — ${files.length} arquivo(s) frontend escaneado(s).`);
    process.exit(0);
  }

  console.error(
    `[check:frontend-imports] FALHA — ${violations.length} violação(ões) detectada(s):`
  );
  for (const v of violations) {
    console.error(
      `  • Import server-side proibido no frontend: ${v.file}:${v.line} importou "${v.specifier}" (${v.rule})`
    );
  }
  console.error(
    "\nCorreção: mover a função compartilhada para um arquivo puro (Shared/Types), sem Prisma."
  );
  process.exit(1);
}

main();
