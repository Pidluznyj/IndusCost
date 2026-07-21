/**
 * Scanner estático da fronteira SC × motores oficiais.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  OFFICIAL_ENGINE_FORBIDDEN_MUTABLE_IMPORT_PATTERNS,
  OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHODS,
  OFFICIAL_ENGINE_PROTECTED_PRISMA_MODELS,
} from "./officialEngineBoundary.js";

export type OfficialEngineBoundaryViolation = {
  file: string;
  ruleId: string;
  detail: string;
  snippet: string;
};

/** Remove comentários e literais para reduzir falso positivo em prosa. */
export function stripCommentsAndStringLiterals(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      out += "  ";
      i += 2;
      while (i < n && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }

    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i + 1 < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i + 1 < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i += 1;
      while (i < n) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          out += " ";
          i += 1;
          break;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

function snippetAt(source: string, index: number, len = 80): string {
  const start = Math.max(0, index - 20);
  return source.slice(start, start + len).replace(/\s+/g, " ").trim();
}

export function scanSourceForProtectedModelWrites(
  file: string,
  source: string
): OfficialEngineBoundaryViolation[] {
  const code = stripCommentsAndStringLiterals(source);
  const violations: OfficialEngineBoundaryViolation[] = [];
  const methods = OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHODS.join("|");

  for (const model of OFFICIAL_ENGINE_PROTECTED_PRISMA_MODELS) {
    const re = new RegExp(
      `(?:prisma|tx|db|client)\\.${model}\\.(?:${methods})\\s*\\(`,
      "g"
    );
    for (const match of code.matchAll(re)) {
      violations.push({
        file,
        ruleId: `prisma.${model}.${match[0]?.replace(/\s*\($/, "") ?? "write"}`,
        detail: `Escrita proibida em motor oficial: ${model}`,
        snippet: snippetAt(code, match.index ?? 0),
      });
    }
  }

  // SQL bruto também pode mutar oficiais (padrão montado para não auto-flagar este arquivo)
  const executeRaw = ["$", "executeRaw"].join("");
  const rawRe = new RegExp(`${executeRaw}(?:Unsafe)?\\s*[\`(]`, "g");
  for (const match of code.matchAll(rawRe)) {
    violations.push({
      file,
      ruleId: "prisma.executeRaw",
      detail: "SQL bruto proibido no domínio SC (risco de write em oficiais)",
      snippet: snippetAt(code, match.index ?? 0),
    });
  }

  return violations;
}

export function scanSourceForForbiddenMutableImports(
  file: string,
  source: string
): OfficialEngineBoundaryViolation[] {
  const violations: OfficialEngineBoundaryViolation[] = [];
  const importRe =
    /from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(importRe)) {
    const spec = match[1] ?? "";
    // Adaptadores/contratos SC são permitidos
    if (spec.includes("supply-chain/officialEngine")) continue;

    for (const pattern of OFFICIAL_ENGINE_FORBIDDEN_MUTABLE_IMPORT_PATTERNS) {
      if (pattern.test(spec)) {
        violations.push({
          file,
          ruleId: "import.forbidden_mutable_official",
          detail: `Import de repositório/oficial mutável: ${spec}`,
          snippet: snippetAt(source, match.index ?? 0),
        });
      }
    }
  }
  return violations;
}

export function scanSourceForOfficialEngineBoundary(
  file: string,
  source: string
): OfficialEngineBoundaryViolation[] {
  return [
    ...scanSourceForProtectedModelWrites(file, source),
    ...scanSourceForForbiddenMutableImports(file, source),
  ];
}

function walkTsFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTsFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

/**
 * Resolve arquivos do domínio SC a partir da raiz do repo.
 * Inclui inventory + purchases UI + supply-chain; exclui arquivos de teste do scan
 * de produção apenas quando includeTests é false — por padrão inclui testes do domínio
 * (testes também não devem escrever em oficiais).
 */
export function listSupplyChainDomainFiles(
  repoRoot: string,
  options: { includeTests?: boolean } = {}
): string[] {
  const includeTests = options.includeTests ?? true;
  const files: string[] = [];

  walkTsFiles(join(repoRoot, "src/lib/supply-chain"), files);
  walkTsFiles(join(repoRoot, "src/lib/inventory"), files);
  walkTsFiles(join(repoRoot, "src/components/inventory"), files);

  const singles = [
    "src/lib/inventoryRoutes.ts",
    "src/lib/inventoryPermissions.ts",
    "src/lib/inventoryPermissions.test.ts",
    "src/lib/inventoryRoutes.test.ts",
    "src/lib/inventoryNavigation.test.ts",
    "src/lib/inventoryItems.test.ts",
    "src/lib/inventoryWarehouses.test.ts",
    "src/lib/inventoryMovements.test.ts",
    "src/lib/inventoryBalances.test.ts",
    "src/lib/inventoryCounts.test.ts",
    "src/lib/inventoryIntegrations.test.ts",
    "src/lib/inventoryUx.test.ts",
    "src/components/PurchaseModule.tsx",
    "src/components/contextual/PurchaseIndicatorsDashboard.tsx",
  ];
  for (const rel of singles) {
    const full = join(repoRoot, rel);
    try {
      if (statSync(full).isFile()) files.push(full);
    } catch {
      // optional
    }
  }

  const uniq = [...new Set(files)];
  if (includeTests) return uniq.sort();
  return uniq
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f) && !/\.spec\.(ts|tsx)$/.test(f))
    .sort();
}

export function scanSupplyChainDomainForOfficialEngineBoundary(
  repoRoot: string
): OfficialEngineBoundaryViolation[] {
  const violations: OfficialEngineBoundaryViolation[] = [];
  for (const file of listSupplyChainDomainFiles(repoRoot)) {
    const rel = relative(repoRoot, file).replace(/\\/g, "/");
    // O próprio scanner / testes de barreira citam padrões proibidos em strings —
    // ainda assim strip remove strings; arquivos de teste de barreira podem
    // conter exemplos em template — excluir só o arquivo de teste da barreira
    // dos checks de write (ele valida via funções, não via domínio prod).
    if (rel.endsWith("officialEngineBoundary.test.ts")) continue;

    const source = readFileSync(file, "utf8");
    for (const v of scanSourceForOfficialEngineBoundary(rel, source)) {
      violations.push(v);
    }
  }
  return violations;
}
