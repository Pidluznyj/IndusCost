#!/usr/bin/env npx tsx
/**
 * Valida um ZIP Gerar Relatório Analisável (estrutura, JSON, findings, sanitização).
 * Uso: npx tsx scripts/validate-chatgpt-diagnostic-zip.ts tmp/diagnostic-bundles/system-....zip
 */
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import {
  REQUIRED_BUNDLE_ROOT_FILES,
  type DiagnosticFinding,
} from "../src/lib/diagnostics/chatgptDiagnosticTypes.ts";

const CHECKLIST_ROOT = [
  "00_README_FOR_CHATGPT.md",
  "CHATGPT_ANALYSIS_PROMPT.md",
  "01_EXECUTIVE_SUMMARY.md",
  "03_DIAGNOSTIC_INDEX.json",
  "04_DIAGNOSTICS.json",
  "manifest.json",
  "15_REDACTION_REPORT.json",
];

const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "PostgreSQL connection string", pattern: /postgresql:\/\/[^\s"[\]]+@/i },
  { label: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/i },
  { label: "JWT", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { label: "cookie header value", pattern: /Cookie:\s*[A-Za-z0-9%._=-]{20,}/i },
  {
    label: "password assignment literal",
    pattern: /password\s*[:=]\s*["']?[A-Za-z0-9!@#$%^&*._-]{12,}/i,
  },
  { label: ".env.local path", pattern: /\.env\.local\b/ },
];

function contentHasForbiddenSecret(content: string): Array<{ label: string }> {
  const hits: Array<{ label: string }> = [];
  for (const { label, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      hits.push({ label });
    }
  }
  return hits;
}

const MAX_ZIP_BYTES = 25 * 1024 * 1024;

export type ZipValidationResult = {
  zipPath: string;
  ok: boolean;
  sizeBytes: number;
  fileCount: number;
  missingRequired: string[];
  parseErrors: string[];
  forbiddenHits: Array<{ file: string; label: string }>;
  findingCount: number;
  findingsValid: boolean;
  redactionReportPresent: boolean;
  executiveSummarySections: string[];
  errors: string[];
  warnings: string[];
};

function detectExecutiveSummarySections(md: string): string[] {
  const sections: string[] = [];
  if (/analisa|analisado|SKU|Escopo|Pacote|Ambiente|SYSTEM|Commit/i.test(md))
    sections.push("what_analyzed");
  if (/Status|PASS|WARNING|ERROR|coerente|Trace|Diagnósticos automáticos|Migrations/i.test(md))
    sections.push("general_status");
  if (/achado|alerta|diagnóstico|finding|Diagnósticos|MIGRATION|problema/i.test(md))
    sections.push("main_findings");
  if (/evidência|evidence|sourceRef|09_DATABASE|trace\.json|12_LOGS|14_WARNINGS/i.test(md))
    sections.push("evidence");
  if (/próximo|recomend|suggested|Reproduction|reexecutar|fazer primeiro/i.test(md))
    sections.push("next_steps");
  return sections;
}

export async function validateChatGptDiagnosticZip(
  zipPath: string
): Promise<ZipValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const buf = readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buf);
  const fileNames = Object.keys(zip.files).filter((n) => !n.endsWith("/"));

  const missingRequired = CHECKLIST_ROOT.filter((f) => !fileNames.includes(f));
  if (missingRequired.length) {
    errors.push(`Arquivos obrigatórios ausentes: ${missingRequired.join(", ")}`);
  }

  for (const path of REQUIRED_BUNDLE_ROOT_FILES) {
    if (!fileNames.includes(path)) {
      warnings.push(`Root file ausente (formato completo): ${path}`);
    }
  }

  if (buf.length > MAX_ZIP_BYTES) {
    warnings.push(`ZIP grande: ${buf.length} bytes (limite soft ${MAX_ZIP_BYTES})`);
  }

  const parseErrors: string[] = [];
  const forbiddenHits: Array<{ file: string; label: string }> = [];

  for (const name of fileNames) {
    const file = zip.file(name);
    if (!file) continue;
    const content = await file.async("string");

    if (name.endsWith(".json")) {
      try {
        JSON.parse(content);
      } catch {
        parseErrors.push(name);
      }
    }

    for (const hit of contentHasForbiddenSecret(content)) {
      forbiddenHits.push({ file: name, label: hit.label });
    }
  }

  if (parseErrors.length) {
    errors.push(`JSON inválido: ${parseErrors.join(", ")}`);
  }
  if (forbiddenHits.length) {
    errors.push(
      `Possível segredo: ${forbiddenHits.map((h) => `${h.file} (${h.label})`).join("; ")}`
    );
  }

  let findingCount = 0;
  let findingsValid = true;
  const diagRaw = await zip.file("04_DIAGNOSTICS.json")?.async("string");
  if (diagRaw) {
    const parsed = JSON.parse(diagRaw) as { findings: DiagnosticFinding[] };
    findingCount = parsed.findings?.length ?? 0;
    for (const f of parsed.findings ?? []) {
      if (!f.severity || !f.code || !f.message || !Array.isArray(f.sourceRefs)) {
        findingsValid = false;
      }
      if (f.sourceRefs.length === 0) {
        warnings.push(`Finding ${f.id ?? f.code} sem sourceRefs`);
      }
    }
  }

  if (!findingsValid) {
    errors.push("Findings incompletos (severity/code/message/sourceRefs)");
  }

  const execMd = (await zip.file("01_EXECUTIVE_SUMMARY.md")?.async("string")) ?? "";
  const executiveSummarySections = detectExecutiveSummarySections(execMd);
  if (executiveSummarySections.length < 3) {
    warnings.push(
      `Executive summary pode estar incompleto para ChatGPT (seções: ${executiveSummarySections.join(", ")})`
    );
  }

  const redactionReportPresent = fileNames.includes("15_REDACTION_REPORT.json");

  return {
    zipPath,
    ok: errors.length === 0,
    sizeBytes: buf.length,
    fileCount: fileNames.length,
    missingRequired,
    parseErrors,
    forbiddenHits,
    findingCount,
    findingsValid,
    redactionReportPresent,
    executiveSummarySections,
    errors,
    warnings,
  };
}

async function main(): Promise<void> {
  const zipPath = process.argv[2];
  if (!zipPath?.trim()) {
    console.error("Uso: npx tsx scripts/validate-chatgpt-diagnostic-zip.ts <caminho.zip>");
    process.exit(1);
  }
  const result = await validateChatGptDiagnosticZip(zipPath);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

function isValidateZipCliEntry(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return entry.endsWith("/validate-chatgpt-diagnostic-zip.ts") ||
    entry.endsWith("\\validate-chatgpt-diagnostic-zip.ts");
}

if (isValidateZipCliEntry()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
