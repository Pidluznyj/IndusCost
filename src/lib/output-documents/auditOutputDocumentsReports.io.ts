/**
 * I/O do relatório do auditor (DS-02.8).
 * Escrita atômica em disco. Não altera o banco.
 */
import {
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuditOutputDocumentsDbResult } from "./auditOutputDocumentsDb.js";
import {
  buildAuditReportDocument,
  formatAuditReportCompactSummary,
  formatAuditReportJson,
  formatAuditReportMarkdown,
  type AuditReportDocument,
} from "./auditOutputDocumentsReports.js";

export type WriteAuditReportsInput = {
  result: AuditOutputDocumentsDbResult;
  jsonOutput: string;
  markdownOutput: string;
  /** Override do instante de geração (testes). */
  generatedAt?: Date;
};

export type WriteAuditReportsOutput = {
  report: AuditReportDocument;
  jsonPath: string;
  markdownPath: string;
  compactSummary: string;
};

/**
 * Grava arquivo de forma atômica: tmp → rename.
 * Cria diretórios pais se inexistentes.
 * Em falha, lança Error com mensagem clara (caminho incluso).
 */
export function writeFileAtomicSync(
  filePath: string,
  contents: string,
  encoding: BufferEncoding = "utf8"
): void {
  const absolute = resolve(filePath);
  const dir = dirname(absolute);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Falha ao criar diretório do relatório (${dir}): ${formatIoError(error)}`
    );
  }

  const tmpPath = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, contents, encoding);
    try {
      renameSync(tmpPath, absolute);
    } catch {
      // Windows: rename sobre arquivo existente pode falhar.
      if (existsSync(absolute)) {
        unlinkSync(absolute);
      }
      renameSync(tmpPath, absolute);
    }
  } catch (error) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore cleanup
    }
    throw new Error(
      `Falha ao gravar relatório em ${absolute}: ${formatIoError(error)}`
    );
  }
}

function formatIoError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "erro desconhecido");
}

/** Monta o relatório sanitizado e grava JSON + Markdown atomicamente. */
export function writeAuditReports(
  input: WriteAuditReportsInput
): WriteAuditReportsOutput {
  const jsonPath = resolve(input.jsonOutput);
  const markdownPath = resolve(input.markdownOutput);
  const report = buildAuditReportDocument(
    input.result,
    input.generatedAt ?? new Date()
  );

  try {
    writeFileAtomicSync(jsonPath, formatAuditReportJson(report));
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : `Falha ao gravar JSON do relatório em ${jsonPath}`
    );
  }

  try {
    writeFileAtomicSync(markdownPath, formatAuditReportMarkdown(report));
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : `Falha ao gravar Markdown do relatório em ${markdownPath}`
    );
  }

  const compactSummary = formatAuditReportCompactSummary({
    report,
    jsonPath,
    markdownPath,
  });

  return { report, jsonPath, markdownPath, compactSummary };
}
