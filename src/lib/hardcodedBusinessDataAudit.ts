import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type HardcodedBusinessDataFindingKind =
  | "customer"
  | "cnpj"
  | "product"
  | "value"
  | "target"
  | "mock"
  | "fallback"
  | "other";

export type HardcodedBusinessDataFindingSeverity = "low" | "medium" | "high";

export type HardcodedBusinessDataFinding = {
  file: string;
  lineHint?: number;
  kind: HardcodedBusinessDataFindingKind;
  severity: HardcodedBusinessDataFindingSeverity;
  allowed: boolean;
  reason: string;
};

/** Arquivos de produção com CNPJs/nomes do grupo econômico documentados. */
export const HARDCODE_ALLOWLIST_FILES = [
  "src/lib/financeInternalGroupExclusions.ts",
  "src/lib/groupCompanyCustomer.ts",
  "src/lib/nomusNfeClassification.ts",
  "src/lib/printBranding.ts",
  "src/lib/salesOrderDashboardRules.ts",
] as const;

/** Nomes de clientes reais que não devem aparecer em código de produção. */
export const SUSPICIOUS_CUSTOMER_TOKENS = [
  "MEXICHEM",
  "MEXICHEN",
  "ESMALTEC",
  "BRITANIA",
  "BRITÂNIA",
  "MEXICHEM ENERGY",
] as const;

/** Valores financeiros fixos historicamente usados em fixtures de regressão. */
export const SUSPICIOUS_FIXED_AMOUNTS = ["98000", "18270", "175191"] as const;

/** CNPJ real usado em fixtures de regressão Mexichem. */
export const SUSPICIOUS_REAL_CNPJ = "33.081.704";

const CNPJ_REGEX = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g;

/** Arquivos meta do próprio scanner — não auto-auditar. */
export const HARDCODE_SCANNER_META_FILES = [
  "src/lib/hardcodedBusinessDataAudit.ts",
  "src/lib/systemDataLineageAudit.ts",
] as const;

/** Exemplos/placeholders de CNPJ aceitáveis em templates e simulações. */
const PLACEHOLDER_CNPJ_FRAGMENTS = [
  "111.111",
  "222.222",
  "12.345.678",
  "00.000.000",
  "00000000000000",
  "12345678000199",
] as const;

const MOCK_PATTERN = /\b(?:const|let|var)\s+(?:mock|fixture)[A-Za-z0-9_]*/i;

const FALLBACK_PATTERN = /\bfallback\b|\btemporary\b|\bTODO\s+hardcode\b/i;

const CUSTOMER_IF_PATTERN =
  /if\s*\(\s*(?:customer(?:Name|Id)?|personName|cnpj|personCnpj)\s*(?:===|\.includes|\.startsWith)/i;

const SCAN_DIRS = ["src/lib", "src/components"] as const;

export function normalizeAuditPath(filePath: string): string {
  return filePath.split(sep).join("/");
}

export function isTestSourceFile(filePath: string): boolean {
  const norm = normalizeAuditPath(filePath);
  return norm.endsWith(".test.ts") || norm.endsWith(".test.tsx");
}

export function isAllowlistedProductionFile(filePath: string): boolean {
  const norm = normalizeAuditPath(filePath);
  return (HARDCODE_ALLOWLIST_FILES as readonly string[]).includes(norm);
}

export function isScannerMetaFile(filePath: string): boolean {
  const norm = normalizeAuditPath(filePath);
  return (HARDCODE_SCANNER_META_FILES as readonly string[]).includes(norm);
}

function isPlaceholderCnpj(cnpj: string): boolean {
  return PLACEHOLDER_CNPJ_FRAGMENTS.some((frag) => cnpj.includes(frag));
}

function lineHasCustomerToken(line: string, token: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
  const upperLine = line.toUpperCase();
  const upperToken = token.toUpperCase();
  if (!upperLine.includes(upperToken)) return false;
  if (upperLine.includes("ENERGY_COST") || upperLine.includes("ENERGY COST")) return false;
  const escaped = upperToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped.replace(/\s+/g, "\\s+")}\\b`);
  return re.test(upperLine);
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function pushFinding(
  findings: HardcodedBusinessDataFinding[],
  file: string,
  kind: HardcodedBusinessDataFindingKind,
  severity: HardcodedBusinessDataFindingSeverity,
  allowed: boolean,
  reason: string,
  lineHint?: number
): void {
  findings.push({ file, lineHint, kind, severity, allowed, reason });
}

export function scanFileContentForHardcodedBusinessData(
  relativeFile: string,
  content: string
): HardcodedBusinessDataFinding[] {
  const file = normalizeAuditPath(relativeFile);
  const findings: HardcodedBusinessDataFinding[] = [];

  if (isTestSourceFile(file) || isScannerMetaFile(file)) {
    return findings;
  }

  const allowlisted = isAllowlistedProductionFile(file);
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const token of SUSPICIOUS_CUSTOMER_TOKENS) {
      if (lineHasCustomerToken(line, token)) {
        pushFinding(
          findings,
          file,
          "customer",
          "high",
          allowlisted,
          `Nome de cliente suspeito "${token}"`,
          i + 1
        );
      }
    }
  }

  for (const amount of SUSPICIOUS_FIXED_AMOUNTS) {
    const re = new RegExp(`\\b${amount}\\b`);
    const match = re.exec(content);
    if (match) {
      pushFinding(
        findings,
        file,
        "value",
        "high",
        allowlisted,
        `Valor financeiro fixo suspeito ${amount}`,
        lineNumberAt(content, match.index)
      );
    }
  }

  if (content.includes(SUSPICIOUS_REAL_CNPJ)) {
    pushFinding(
      findings,
      file,
      "cnpj",
      "high",
      allowlisted,
      `CNPJ real de fixture (${SUSPICIOUS_REAL_CNPJ})`,
      lineNumberAt(content, content.indexOf(SUSPICIOUS_REAL_CNPJ))
    );
  }

  let cnpjMatch: RegExpExecArray | null;
  const cnpjRe = new RegExp(CNPJ_REGEX.source, "g");
  while ((cnpjMatch = cnpjRe.exec(content)) !== null) {
    const cnpj = cnpjMatch[0];
    if (isPlaceholderCnpj(cnpj)) {
      continue;
    }
    pushFinding(
      findings,
      file,
      "cnpj",
      allowlisted ? "low" : "medium",
      allowlisted,
      `CNPJ formatado em produção: ${cnpj}`,
      lineNumberAt(content, cnpjMatch.index)
    );
  }

  if (MOCK_PATTERN.test(content)) {
    pushFinding(
      findings,
      file,
      "mock",
      "medium",
      false,
      "Padrão mock/sample/fixture em arquivo de produção"
    );
  }

  if (FALLBACK_PATTERN.test(content)) {
    pushFinding(
      findings,
      file,
      "fallback",
      "low",
      false,
      "Comentário ou variável fallback/temporary/TODO hardcode"
    );
  }

  if (CUSTOMER_IF_PATTERN.test(content) && !allowlisted) {
    pushFinding(
      findings,
      file,
      "customer",
      "medium",
      false,
      "Regra condicional por nome/CNPJ de cliente"
    );
  }

  return findings;
}

function walkSourceFiles(dir: string, root: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, root, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(relative(root, full));
    }
  }
}

export function scanProductionSources(rootDir: string = process.cwd()): HardcodedBusinessDataFinding[] {
  const findings: HardcodedBusinessDataFinding[] = [];
  for (const scanDir of SCAN_DIRS) {
    const abs = join(rootDir, scanDir);
    const files: string[] = [];
    walkSourceFiles(abs, rootDir, files);
    for (const rel of files) {
      const content = readFileSync(join(rootDir, rel), "utf8");
      findings.push(...scanFileContentForHardcodedBusinessData(rel, content));
    }
  }
  return findings;
}

export function getProductionRiskFindings(
  findings: HardcodedBusinessDataFinding[] = scanProductionSources()
): HardcodedBusinessDataFinding[] {
  return findings.filter((f) => !f.allowed && (f.severity === "high" || f.severity === "medium"));
}

export function summarizeHardcodedFindings(findings: HardcodedBusinessDataFinding[]): {
  total: number;
  allowed: number;
  risks: number;
  byKind: Record<HardcodedBusinessDataFindingKind, number>;
  bySeverity: Record<HardcodedBusinessDataFindingSeverity, number>;
  riskFiles: string[];
} {
  const byKind: Record<HardcodedBusinessDataFindingKind, number> = {
    customer: 0,
    cnpj: 0,
    product: 0,
    value: 0,
    target: 0,
    mock: 0,
    fallback: 0,
    other: 0,
  };
  const bySeverity: Record<HardcodedBusinessDataFindingSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
  };
  let allowed = 0;
  let risks = 0;
  const riskFileSet = new Set<string>();

  for (const f of findings) {
    byKind[f.kind] += 1;
    bySeverity[f.severity] += 1;
    if (f.allowed) allowed += 1;
    else if (f.severity === "high" || f.severity === "medium") {
      risks += 1;
      riskFileSet.add(f.file);
    }
  }

  return {
    total: findings.length,
    allowed,
    risks,
    byKind,
    bySeverity,
    riskFiles: [...riskFileSet].sort(),
  };
}

/** Verifica se bundle React importa Prisma (read-only, sem DB). */
export function findFrontendPrismaImports(rootDir: string = process.cwd()): string[] {
  const violations: string[] = [];
  const componentsDir = join(rootDir, "src", "components");
  if (!existsSync(componentsDir)) return violations;

  const files: string[] = [];
  walkSourceFiles(componentsDir, rootDir, files);

  const importRe = /from\s+["']([^"']+)["']/g;
  for (const rel of files) {
    const content = readFileSync(join(rootDir, rel), "utf8");
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content)) !== null) {
      const spec = m[1]!;
      if (
        spec === "@prisma/client" ||
        spec.startsWith("@prisma/client/") ||
        /(^|\/)prisma$/.test(spec) ||
        /(^|\/)lib\/prisma$/.test(spec)
      ) {
        violations.push(normalizeAuditPath(rel));
      }
    }
  }
  return [...new Set(violations)];
}

export function assertNoNaNInSummary(values: number[]): boolean {
  return values.every((v) => Number.isFinite(v) && !Number.isNaN(v));
}
