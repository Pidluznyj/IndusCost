/**
 * Geração pura do relatório sanitizado do auditor (DS-02.8).
 * Sem I/O de banco. Não inventa contagens de produção.
 */

import type { AuditOutputDocumentsDbResult } from "./auditOutputDocumentsDb.js";
import { maskSensitiveIdentifier } from "./auditOutputDocumentsRawJson.js";

export const AUDIT_REPORT_DEFAULT_JSON =
  "docs/output-documents/audits/output-documents-db-audit.json";
export const AUDIT_REPORT_DEFAULT_MARKDOWN =
  "docs/output-documents/audits/output-documents-db-audit.md";

export type AuditReportMetadata = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: AuditOutputDocumentsDbResult["status"];
  mode: string;
  readOnly: true;
  databaseDisplay: string | null;
  options: {
    document: number;
    order: string;
    nfe: number;
    sampleLimit: number;
    jsonOutput: string;
    markdownOutput: string;
  };
  error: string | null;
  generatedAt: string;
  sanitization: {
    applied: true;
    note: string;
  };
};

export type AuditReportDataQuality = {
  status: "ok" | "degraded" | "incomplete" | "unavailable" | "error";
  gaps: unknown[];
  risks: unknown[];
  notes: string[];
  coverage: {
    lowCoverageDocumentFields: string[];
    lowCoverageItemFields: string[];
    thresholdPercent: number;
  };
  linkHealth: {
    documentsWithoutIdNfe: number | null;
    nfeMissingLocally: number | null;
    unallocatedDocuments: number | null;
    exampleDocumentFound: boolean | null;
    exampleOrderFound: boolean | null;
    exampleNfeFound: boolean | null;
  };
};

export type AuditReportRecommendation = {
  priority: "low" | "medium" | "high";
  summary: string;
  actions: string[];
  nextAuditSteps: string[];
};

/**
 * Contrato do relatório JSON/Markdown (seções obrigatórias DS-02.8).
 * financialEvidence é mantido como apoio (DS-02.6), sem inventar dados.
 */
export type AuditReportDocument = {
  metadata: AuditReportMetadata;
  inventory: AuditOutputDocumentsDbResult["sections"]["inventory"];
  fieldCoverage: AuditOutputDocumentsDbResult["sections"]["fieldCoverage"];
  itemCoverage: AuditOutputDocumentsDbResult["sections"]["itemCoverage"];
  rawJsonKeys: AuditOutputDocumentsDbResult["sections"]["rawJsonKeys"];
  nfeLinks: AuditOutputDocumentsDbResult["sections"]["nfeLinks"];
  salesOrderLinks: AuditOutputDocumentsDbResult["sections"]["salesOrderLinks"];
  allocations: AuditOutputDocumentsDbResult["sections"]["allocations"];
  accountsReceivableLinks: AuditOutputDocumentsDbResult["sections"]["accountsReceivableLinks"];
  paymentTermsEvidence: AuditOutputDocumentsDbResult["sections"]["paymentTermsEvidence"];
  financialEvidence: AuditOutputDocumentsDbResult["sections"]["financialEvidence"];
  dataQuality: AuditReportDataQuality;
  examples: AuditOutputDocumentsDbResult["sections"]["examples"];
  recommendation: AuditReportRecommendation;
};

const LOW_COVERAGE_THRESHOLD = 80;

export function buildDataQualitySection(
  result: AuditOutputDocumentsDbResult
): AuditReportDataQuality {
  const sections = result.sections;
  const lowDoc = (sections.fieldCoverage ?? [])
    .filter(
      (row) =>
        row.presentInSchema &&
        row.coveragePercent != null &&
        row.coveragePercent < LOW_COVERAGE_THRESHOLD
    )
    .map((row) => row.field);
  const lowItem = (sections.itemCoverage ?? [])
    .filter(
      (row) =>
        row.presentInSchema &&
        row.coveragePercent != null &&
        row.coveragePercent < LOW_COVERAGE_THRESHOLD
    )
    .map((row) => row.field);

  const counts = sections.counts ?? {};
  const asNumber = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const asBool = (v: unknown): boolean | null =>
    typeof v === "boolean" ? v : null;

  let status: AuditReportDataQuality["status"] = "ok";
  if (result.status === "unavailable") status = "unavailable";
  else if (result.status === "error") status = "error";
  else if (
    !sections.inventory ||
    sections.fieldCoverage.length === 0 ||
    !sections.examples
  ) {
    status = "incomplete";
  } else if (
    lowDoc.length > 0 ||
    lowItem.length > 0 ||
    (asNumber(counts.nfeMissingLocally) ?? 0) > 0 ||
    (asNumber(counts.unallocatedDocuments) ?? 0) > 0
  ) {
    status = "degraded";
  }

  return {
    status,
    gaps: sections.gaps ?? [],
    risks: sections.risks ?? [],
    notes: [
      ...(sections.notes ?? []),
      "dataQuality é derivado do resultado do auditor — não consulta o banco novamente.",
    ],
    coverage: {
      lowCoverageDocumentFields: lowDoc,
      lowCoverageItemFields: lowItem,
      thresholdPercent: LOW_COVERAGE_THRESHOLD,
    },
    linkHealth: {
      documentsWithoutIdNfe: asNumber(counts.documentsWithoutIdNfe),
      nfeMissingLocally: asNumber(counts.nfeMissingLocally),
      unallocatedDocuments: asNumber(counts.unallocatedDocuments),
      exampleDocumentFound: asBool(counts.exampleDocumentFound),
      exampleOrderFound: asBool(counts.exampleOrderFound),
      exampleNfeFound: asBool(counts.exampleNfeFound),
    },
  };
}

export function buildRecommendationSection(
  dataQuality: AuditReportDataQuality
): AuditReportRecommendation {
  const actions: string[] = [];
  const nextAuditSteps: string[] = [
    "Executar o auditor no servidor com DATABASE_URL de leitura.",
    "Revisar examples.outputDocument / salesOrder / nfe (found=true|false).",
    "Confrontar allocations e accountsReceivableLinks sem alterar vínculos.",
  ];

  if (dataQuality.status === "unavailable" || dataQuality.status === "error") {
    return {
      priority: "high",
      summary:
        "Auditoria indisponível ou com erro técnico — corrigir conectividade/I/O antes de interpretar métricas.",
      actions: [
        "Validar DATABASE_URL e rede até o PostgreSQL.",
        "Reexecutar npm run audit:output-documents:db no servidor.",
      ],
      nextAuditSteps,
    };
  }

  if (dataQuality.coverage.lowCoverageDocumentFields.length > 0) {
    actions.push(
      `Revisar preenchimento de campos do documento com cobertura < ${dataQuality.coverage.thresholdPercent}%: ${dataQuality.coverage.lowCoverageDocumentFields.join(", ")}.`
    );
  }
  if (dataQuality.coverage.lowCoverageItemFields.length > 0) {
    actions.push(
      `Revisar preenchimento de campos de item com cobertura baixa: ${dataQuality.coverage.lowCoverageItemFields.join(", ")}.`
    );
  }
  if ((dataQuality.linkHealth.nfeMissingLocally ?? 0) > 0) {
    actions.push(
      "Investigar Documentos com idNfe sem NomusNfe local correspondente."
    );
  }
  if ((dataQuality.linkHealth.unallocatedDocuments ?? 0) > 0) {
    actions.push(
      "Auditar documentos sem alocação a pedidos (sem criar vínculos)."
    );
  }
  if (dataQuality.linkHealth.exampleDocumentFound === false) {
    actions.push(
      "Exemplo de Documento parametrizado não encontrado — confirmar externalId no stage."
    );
  }
  if (dataQuality.linkHealth.exampleOrderFound === false) {
    actions.push(
      "Exemplo de Pedido parametrizado não encontrado — confirmar orderCode/código externo."
    );
  }
  if (dataQuality.linkHealth.exampleNfeFound === false) {
    actions.push(
      "Exemplo de NF-e parametrizado não encontrado — confirmar externalId/número."
    );
  }

  if (actions.length === 0) {
    actions.push(
      "Manter execução periódica do auditor read-only e versionar apenas exemplos sanitizados."
    );
  }

  const priority: AuditReportRecommendation["priority"] =
    dataQuality.status === "degraded" || dataQuality.status === "incomplete"
      ? "medium"
      : "low";

  return {
    priority,
    summary:
      priority === "medium"
        ? "Há lacunas de cobertura ou vínculos a investigar; o auditor não deve alterar dados."
        : "Resultado estruturalmente completo para revisão; próximos passos são operacionais no servidor.",
    actions,
    nextAuditSteps,
  };
}

/** Sanitiza recursivamente strings sensíveis no relatório. */
export function sanitizeAuditReportValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return maskSensitiveIdentifier(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditReportValue(item));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeAuditReportValue(v);
    }
    return out;
  }
  return String(value);
}

export function buildAuditReportDocument(
  result: AuditOutputDocumentsDbResult,
  generatedAt: Date = new Date()
): AuditReportDocument {
  const dataQuality = buildDataQualitySection(result);
  const recommendation = buildRecommendationSection(dataQuality);
  const sections = result.sections;

  const report: AuditReportDocument = {
    metadata: {
      startedAt: result.meta.startedAt,
      finishedAt: result.meta.finishedAt,
      durationMs: result.meta.durationMs,
      status: result.status,
      mode: result.meta.mode,
      readOnly: true,
      databaseDisplay: result.meta.database?.display ?? null,
      options: { ...result.meta.options },
      error: result.error,
      generatedAt: generatedAt.toISOString(),
      sanitization: {
        applied: true,
        note: "Identificadores sensíveis (CPF/CNPJ/e-mail/tokens) mascarados no relatório.",
      },
    },
    inventory: sections.inventory,
    fieldCoverage: sections.fieldCoverage,
    itemCoverage: sections.itemCoverage,
    rawJsonKeys: sections.rawJsonKeys,
    nfeLinks: sections.nfeLinks,
    salesOrderLinks: sections.salesOrderLinks,
    allocations: sections.allocations,
    accountsReceivableLinks: sections.accountsReceivableLinks,
    paymentTermsEvidence: sections.paymentTermsEvidence,
    financialEvidence: sections.financialEvidence,
    dataQuality,
    examples: sections.examples,
    recommendation,
  };

  return sanitizeAuditReportValue(report) as AuditReportDocument;
}

export function formatAuditReportJson(report: AuditReportDocument): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function mdTable(rows: Array<[string, string]>): string[] {
  const lines = ["| | |", "|---|---|"];
  for (const [k, v] of rows) {
    lines.push(`| **${k}** | ${v.replace(/\|/g, "/")} |`);
  }
  return lines;
}

export function formatAuditReportMarkdown(report: AuditReportDocument): string {
  const m = report.metadata;
  const lines: string[] = [
    "# Relatório sanitizado — Auditoria Documentos de Saída",
    "",
    "## metadata",
    "",
    ...mdTable([
      ["Status", m.status],
      ["Mode", m.mode],
      ["Read-only", "sim"],
      ["Started", m.startedAt],
      ["Finished", m.finishedAt],
      ["Duration (ms)", String(m.durationMs)],
      ["Database", m.databaseDisplay ?? "—"],
      ["Documento", String(m.options.document)],
      ["Pedido", m.options.order],
      ["NF-e", String(m.options.nfe)],
      ["Sample limit", String(m.options.sampleLimit)],
      ["Generated at", m.generatedAt],
      ["Sanitization", m.sanitization.note],
    ]),
    "",
  ];

  if (m.error) {
    lines.push("## error", "", m.error, "");
  }

  const pushSection = (title: string, body: unknown) => {
    lines.push(`## ${title}`, "");
    if (body == null) {
      lines.push("_Não disponível nesta execução._", "");
      return;
    }
    lines.push("```json", JSON.stringify(body, null, 2), "```", "");
  };

  pushSection("inventory", report.inventory);
  pushSection("fieldCoverage", report.fieldCoverage);
  pushSection("itemCoverage", report.itemCoverage);
  pushSection("rawJsonKeys", report.rawJsonKeys);
  pushSection("nfeLinks", report.nfeLinks);
  pushSection("salesOrderLinks", report.salesOrderLinks);
  pushSection("allocations", report.allocations);
  pushSection("accountsReceivableLinks", report.accountsReceivableLinks);
  pushSection("paymentTermsEvidence", report.paymentTermsEvidence);
  pushSection("dataQuality", report.dataQuality);
  pushSection("examples", report.examples);
  pushSection("recommendation", report.recommendation);

  return `${lines.join("\n").trimEnd()}\n`;
}

export function formatAuditReportCompactSummary(input: {
  report: AuditReportDocument;
  jsonPath: string;
  markdownPath: string;
}): string {
  const { report, jsonPath, markdownPath } = input;
  const m = report.metadata;
  const dq = report.dataQuality;
  const inv = report.inventory;
  const docs = inv?.documents.total ?? "—";
  const ex = report.examples;
  return [
    `status=${m.status} mode=${m.mode} dataQuality=${dq.status} priority=${report.recommendation.priority}`,
    `docs=${docs} exampleDoc=${ex?.outputDocument.found ?? "—"} exampleOrder=${ex?.salesOrder.found ?? "—"} exampleNfe=${ex?.nfe.found ?? "—"} durationMs=${m.durationMs}`,
    `json=${jsonPath}`,
    `markdown=${markdownPath}`,
  ].join("\n");
}

/** Garante que o Markdown contém as seções obrigatórias. */
export function assertAuditReportMarkdownSections(markdown: string): string[] {
  const required = [
    "## metadata",
    "## inventory",
    "## fieldCoverage",
    "## itemCoverage",
    "## rawJsonKeys",
    "## nfeLinks",
    "## salesOrderLinks",
    "## allocations",
    "## accountsReceivableLinks",
    "## paymentTermsEvidence",
    "## dataQuality",
    "## examples",
    "## recommendation",
  ];
  return required.filter((h) => !markdown.includes(h));
}
