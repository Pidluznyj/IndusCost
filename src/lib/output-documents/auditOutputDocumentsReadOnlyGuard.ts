/**
 * Proteção estática read-only do auditor de Documentos de Saída (DS-02.9).
 * Escopo exclusivo dos módulos do auditor — não é framework genérico.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** Fontes exclusivas do auditor a varrer (DB + orquestração). */
export const AUDIT_OUTPUT_DOCUMENTS_READONLY_RELATIVE_PATHS = [
  "scripts/auditOutputDocumentsDb.ts",
  "src/lib/output-documents/auditOutputDocumentsDb.ts",
  "src/lib/output-documents/auditOutputDocumentsDbInventory.server.ts",
  "src/lib/output-documents/auditOutputDocumentsRawJson.server.ts",
  "src/lib/output-documents/auditOutputDocumentsLinks.server.ts",
  "src/lib/output-documents/auditOutputDocumentsFinancial.server.ts",
  "src/lib/output-documents/auditOutputDocumentsExamples.server.ts",
  "src/lib/output-documents/auditOutputDocumentsReports.io.ts",
] as const;

export type ReadOnlyViolation = {
  file: string;
  ruleId: string;
  detail: string;
  snippet: string;
};

export type ForbiddenPatternRule = {
  id: string;
  description: string;
  /** Aplicado ao código sem comentários/strings. */
  pattern: RegExp;
};

/**
 * Operações Prisma / runtime proibidas no auditor.
 * Exigem `.method(` ou `$method(` — evita falso positivo em prosa ("não executa create").
 */
export const AUDIT_READONLY_PRISMA_WRITE_RULES: ForbiddenPatternRule[] = [
  {
    id: "prisma.create",
    description: "Prisma create",
    pattern: /\.create\s*\(/,
  },
  {
    id: "prisma.createMany",
    description: "Prisma createMany",
    pattern: /\.createMany\s*\(/,
  },
  {
    id: "prisma.update",
    description: "Prisma update",
    pattern: /\.update\s*\(/,
  },
  {
    id: "prisma.updateMany",
    description: "Prisma updateMany",
    pattern: /\.updateMany\s*\(/,
  },
  {
    id: "prisma.upsert",
    description: "Prisma upsert",
    pattern: /\.upsert\s*\(/,
  },
  {
    id: "prisma.delete",
    description: "Prisma delete",
    pattern: /\.delete\s*\(/,
  },
  {
    id: "prisma.deleteMany",
    description: "Prisma deleteMany",
    pattern: /\.deleteMany\s*\(/,
  },
  {
    id: "prisma.executeRaw",
    description: "Prisma $executeRaw",
    pattern: /\$executeRaw(?:Unsafe)?\s*[`(]/,
  },
  {
    id: "prisma.executeRawUnsafe",
    description: "Prisma $executeRawUnsafe",
    pattern: /\$executeRawUnsafe\s*\(/,
  },
  {
    id: "prisma.queryRawUnsafe",
    description: "Prisma $queryRawUnsafe",
    pattern: /\$queryRawUnsafe\s*\(/,
  },
];

/** Locks, transações e isolamento proibidos. */
export const AUDIT_READONLY_LOCK_TX_RULES: ForbiddenPatternRule[] = [
  {
    id: "prisma.transaction",
    description: "Prisma $transaction",
    pattern: /\$transaction\s*[`(]/,
  },
  {
    id: "sql.forUpdate",
    description: "SELECT FOR UPDATE",
    pattern: /\bFOR\s+UPDATE\b/i,
  },
  {
    id: "sql.begin",
    description: "BEGIN TRANSACTION",
    pattern: /\bBEGIN\s+(WORK|TRANSACTION)\b/i,
  },
  {
    id: "sql.setTransaction",
    description: "SET TRANSACTION / isolation",
    pattern: /\bSET\s+(SESSION\s+CHARACTERISTICS\s+AS\s+)?TRANSACTION\b/i,
  },
  {
    id: "sql.isolationLevel",
    description: "isolation level",
    pattern: /\bISOLATION\s+LEVEL\b/i,
  },
  {
    id: "sql.lockTable",
    description: "LOCK TABLE",
    pattern: /\bLOCK\s+TABLE\b/i,
  },
  {
    id: "sql.advisoryLock",
    description: "pg_advisory lock",
    pattern: /\bpg_advisory_(?:lock|xact_lock)\b/i,
  },
];

/** Chamadas Nomus HTTP / sync e dependência de servidor HTTP. */
export const AUDIT_READONLY_NOMUS_HTTP_RULES: ForbiddenPatternRule[] = [
  {
    id: "nomus.clientCall",
    description: "cliente/API Nomus",
    pattern:
      /\b(?:fetchNomus|nomusFetch|callNomus|syncNomus|NomusApiClient|nomusRequest)\b/,
  },
  {
    id: "nomus.httpPath",
    description: "path HTTP Nomus",
    pattern: /['"`][^'"`]*\/api\/nomus[^'"`]*['"`]/i,
  },
  {
    id: "http.createServer",
    description: "http.createServer",
    pattern: /\bcreateServer\s*\(/,
  },
  {
    id: "http.listen",
    description: "server.listen",
    pattern: /\.listen\s*\(\s*\d+/,
  },
  {
    id: "http.express",
    description: "import express/fastify",
    pattern: /from\s+["'](?:express|fastify|koa|hapi)["']/,
  },
  {
    id: "http.nodeImport",
    description: "import node:http/https para servidor",
    pattern: /from\s+["'](?:node:)?https?["']/,
  },
];

/** SQL DML/DDL proibido dentro de templates Prisma.sql / $queryRaw. */
export const AUDIT_READONLY_SQL_DML_DDL_PATTERN =
  /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i;

/**
 * Remove comentários e literais de string/template para reduzir falso positivo
 * em documentação ("não executa create") e nomes citados em prosa.
 */
export function stripCommentsAndStringLiterals(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    // line comment
    if (c === "/" && next === "/") {
      out += "  ";
      i += 2;
      while (i < n && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }

    // block comment
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }

    // single / double quoted string
    if (c === "'" || c === '"') {
      const quote = c;
      out += " ";
      i += 1;
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (ch === quote) {
          out += " ";
          i += 1;
          break;
        }
        out += ch === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }

    // template literal (keep ${...} code recursively simplified as spaces + nested scan)
    if (c === "`") {
      out += " ";
      i += 1;
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (ch === "`") {
          out += " ";
          i += 1;
          break;
        }
        if (ch === "$" && source[i + 1] === "{") {
          out += "  ";
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") depth -= 1;
            out += source[i] === "\n" ? "\n" : " ";
            i += 1;
          }
          continue;
        }
        out += ch === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/**
 * Extrai corpos de Prisma.sql`...` e $queryRaw`...` (somente o literal SQL).
 */
export function extractPrismaSqlTemplateBodies(source: string): string[] {
  const bodies: string[] = [];
  const re =
    /(?:Prisma\.sql|\$queryRaw)\s*(?:<[^>]*>)?\s*`([\s\S]*?)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) != null) {
    bodies.push(match[1] ?? "");
  }
  return bodies;
}

function snippetAround(source: string, index: number, radius = 40): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + radius);
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

export function findPatternViolations(
  file: string,
  scanned: string,
  rules: ForbiddenPatternRule[]
): ReadOnlyViolation[] {
  const violations: ReadOnlyViolation[] = [];
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(scanned);
    if (match) {
      violations.push({
        file,
        ruleId: rule.id,
        detail: rule.description,
        snippet: snippetAround(scanned, match.index),
      });
    }
  }
  return violations;
}

export function findSqlTemplateViolations(
  file: string,
  originalSource: string
): ReadOnlyViolation[] {
  const violations: ReadOnlyViolation[] = [];
  const bodies = extractPrismaSqlTemplateBodies(originalSource);
  const sqlRules: ForbiddenPatternRule[] = [
    {
      id: "sql.dml_ddl",
      description: "SQL DML/DDL proibido",
      pattern: AUDIT_READONLY_SQL_DML_DDL_PATTERN,
    },
    ...AUDIT_READONLY_LOCK_TX_RULES.filter((r) => r.id.startsWith("sql.")),
  ];

  for (const body of bodies) {
    for (const rule of sqlRules) {
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(body);
      if (match) {
        violations.push({
          file,
          ruleId: rule.id,
          detail: `${rule.description} em template Prisma`,
          snippet: snippetAround(body, match.index),
        });
      }
    }
  }
  return violations;
}

export function scanAuditorSourceForReadOnlyViolations(
  relativePath: string,
  source: string
): ReadOnlyViolation[] {
  const scanned = stripCommentsAndStringLiterals(source);
  return [
    ...findPatternViolations(
      relativePath,
      scanned,
      AUDIT_READONLY_PRISMA_WRITE_RULES
    ),
    ...findPatternViolations(
      relativePath,
      scanned,
      AUDIT_READONLY_LOCK_TX_RULES
    ),
    ...findPatternViolations(
      relativePath,
      scanned,
      AUDIT_READONLY_NOMUS_HTTP_RULES
    ),
    ...findSqlTemplateViolations(relativePath, source),
  ];
}

export function listAuditorReadOnlySourcePaths(
  repoRoot: string = REPO_ROOT
): string[] {
  return AUDIT_OUTPUT_DOCUMENTS_READONLY_RELATIVE_PATHS.map((rel) =>
    join(repoRoot, rel)
  );
}

export function scanAllAuditorReadOnlySources(
  repoRoot: string = REPO_ROOT
): ReadOnlyViolation[] {
  const violations: ReadOnlyViolation[] = [];
  for (const rel of AUDIT_OUTPUT_DOCUMENTS_READONLY_RELATIVE_PATHS) {
    const absolute = join(repoRoot, rel);
    const source = readFileSync(absolute, "utf8");
    violations.push(...scanAuditorSourceForReadOnlyViolations(rel, source));
  }
  return violations;
}

/**
 * Compatível com o contrato antigo de padrões (testes Db).
 * Preferir scanAllAuditorReadOnlySources para checagem completa.
 */
export const AUDIT_OUTPUT_DOCUMENTS_DB_FORBIDDEN_WRITE_PATTERNS =
  AUDIT_READONLY_PRISMA_WRITE_RULES.map((r) => r.pattern);

/** Exit code do processo do auditor. */
export function resolveAuditProcessExitCode(
  status: "ok" | "unavailable" | "error" | "args_invalid"
): number {
  return status === "ok" ? 0 : 1;
}

/**
 * Monta resultado de indisponibilidade sanitizado (sem senha).
 * Usado por testes e pelo runner.
 */
export function buildUnavailableAuditGuardResult(input: {
  rawDatabaseUrl: string;
  sanitize: (url: string) => { display: string } | null;
  formatMessage: (database: { display: string } | null) => string;
}): {
  status: "unavailable";
  exitCode: number;
  message: string;
  display: string | null;
} {
  const database = input.sanitize(input.rawDatabaseUrl);
  const message = input.formatMessage(database);
  return {
    status: "unavailable",
    exitCode: resolveAuditProcessExitCode("unavailable"),
    message,
    display: database?.display ?? null,
  };
}
