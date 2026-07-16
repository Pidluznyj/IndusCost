/**
 * Lógica pura do auditor read-only de Documentos de Saída.
 * Sem I/O de banco — loaders ficam em auditOutputDocumentsDbInventory.server.ts;
 * o script scripts/auditOutputDocumentsDb.ts orquestra Prisma.
 */

export const AUDIT_OUTPUT_DOCUMENTS_DB_LOG_PREFIX = "[audit-output-documents-db]";

export const AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS = {
  document: 8451,
  order: "PD02590",
  nfe: 7208,
  sampleLimit: 20,
  jsonOutput: "docs/output-documents/audit-output-documents-db.json",
  markdownOutput: "docs/output-documents/audit-output-documents-db.md",
} as const;

/** Tipo Nomus usado pelo sync oficial de Documentos de Saída. */
export const NOMUS_STOCK_DOCUMENT_TIPO_SAIDA = "DocumentoSaida";

export type AuditOutputDocumentsDbCliOptions = {
  document: number;
  order: string;
  nfe: number;
  sampleLimit: number;
  jsonOutput: string;
  markdownOutput: string;
};

export type SanitizedDatabaseTarget = {
  scheme: string | null;
  host: string;
  port: string | null;
  database: string;
  /** Representação segura para logs — nunca inclui usuário/senha. */
  display: string;
};

export type AuditOutputDocumentsDbStatus = "ok" | "unavailable" | "error";

export type AuditOutputDocumentsDbMode =
  | "scaffold"
  | "stage-inventory"
  | "rawjson-sample"
  | "link-audit";

export type FieldCoverageStat = {
  field: string;
  model: "NomusStockDocument" | "NomusStockDocumentItem";
  presentInSchema: boolean;
  total: number;
  filled: number;
  nullCount: number;
  /** 0–100 com 2 casas; null quando o campo não existe no schema. */
  coveragePercent: number | null;
  notes: string | null;
};

export type StageInventoryTypeCount = {
  tipoDocumentoEstoque: string | null;
  count: number;
};

export type StageInventoryMonthCount = {
  year: number;
  month: number;
  count: number;
};

export type StageInventoryYearCount = {
  year: number;
  count: number;
};

export type StageInventory = {
  documents: {
    total: number;
    documentoSaida: number;
    otherTypes: number;
    byType: StageInventoryTypeCount[];
    byYear: StageInventoryYearCount[];
    byMonth: StageInventoryMonthCount[];
    nullDataDocumento: number;
    minDataDocumento: string | null;
    maxDataDocumento: string | null;
    minExternalId: number | null;
    maxExternalId: number | null;
    withoutItems: number;
  };
  items: {
    total: number;
    orphanCount: number;
    avgItemsPerDocument: number | null;
    maxItemsPerDocument: number | null;
    withoutProduct: number;
    /** null = coluna inexistente no schema atual. */
    withoutCode: number | null;
    withoutDescription: number | null;
    withoutQuantity: number;
    withoutValue: number;
  };
  samples: {
    documentsWithoutItemsExternalIds: number[];
    orphanItemIds: string[];
  };
};

export type AuditOutputDocumentsDbSections = {
  inventory: StageInventory | null;
  fieldCoverage: FieldCoverageStat[];
  itemCoverage: FieldCoverageStat[];
  rawJsonKeys: import("./auditOutputDocumentsRawJson.js").RawJsonKeysSection | null;
  paymentTermsEvidence: import("./auditOutputDocumentsRawJson.js").PaymentTermsEvidence | null;
  nfeLinks: import("./auditOutputDocumentsLinks.js").NfeLinksSection | null;
  salesOrderLinks: import("./auditOutputDocumentsLinks.js").SalesOrderLinksSection | null;
  counts: Record<string, unknown>;
  documentFocus: unknown;
  orderFocus: unknown;
  nfeFocus: unknown;
  samples: Record<string, unknown>;
  gaps: unknown[];
  risks: unknown[];
  notes: string[];
};

export type AuditOutputDocumentsDbResult = {
  meta: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    database: SanitizedDatabaseTarget | null;
    options: AuditOutputDocumentsDbCliOptions;
    mode: AuditOutputDocumentsDbMode;
    readOnly: true;
  };
  status: AuditOutputDocumentsDbStatus;
  error: string | null;
  sections: AuditOutputDocumentsDbSections;
};

export type PrismaDisconnectable = {
  $disconnect: () => Promise<void>;
};

function parsePositiveIntArg(raw: string, label: string): number {
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} inválido: "${raw}". Informe um inteiro positivo.`);
  }
  return value;
}

function parseNamedArg(argv: string[], key: string): string | undefined {
  const prefix = `--${key}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length).trim();
      return value || undefined;
    }
  }
  return undefined;
}

/**
 * Parser de argumentos CLI do auditor.
 * Aceita `--document=`, `--order=`, `--nfe=`, `--sample-limit=`,
 * `--json-output=` e `--markdown-output=`.
 */
export function parseAuditOutputDocumentsDbArgs(
  argv: string[]
): AuditOutputDocumentsDbCliOptions {
  const documentRaw = parseNamedArg(argv, "document");
  const orderRaw = parseNamedArg(argv, "order");
  const nfeRaw = parseNamedArg(argv, "nfe");
  const sampleLimitRaw = parseNamedArg(argv, "sample-limit");
  const jsonOutputRaw = parseNamedArg(argv, "json-output");
  const markdownOutputRaw = parseNamedArg(argv, "markdown-output");

  return {
    document: documentRaw
      ? parsePositiveIntArg(documentRaw, "--document")
      : AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.document,
    order: orderRaw?.trim() || AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.order,
    nfe: nfeRaw
      ? parsePositiveIntArg(nfeRaw, "--nfe")
      : AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.nfe,
    sampleLimit: sampleLimitRaw
      ? parsePositiveIntArg(sampleLimitRaw, "--sample-limit")
      : AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.sampleLimit,
    jsonOutput:
      jsonOutputRaw?.trim() || AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.jsonOutput,
    markdownOutput:
      markdownOutputRaw?.trim() ||
      AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.markdownOutput,
  };
}

export function resolveDefaultOutputPaths(): {
  jsonOutput: string;
  markdownOutput: string;
} {
  return {
    jsonOutput: AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.jsonOutput,
    markdownOutput: AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.markdownOutput,
  };
}

/**
 * Lê DATABASE_URL sem logar credenciais.
 * Retorna erro estruturado quando ausente/vazia.
 */
export function readDatabaseUrlSafe(
  env: NodeJS.ProcessEnv = process.env
): { ok: true; url: string } | { ok: false; error: string } {
  const url = (env.DATABASE_URL ?? "").trim();
  if (!url) {
    return {
      ok: false,
      error:
        "DATABASE_URL ausente ou vazia. Configure a variável de ambiente no servidor antes de executar o auditor.",
    };
  }
  return { ok: true, url };
}

/**
 * Extrai host, porta e database de uma URL PostgreSQL/Prisma.
 * Nunca retorna usuário ou senha.
 */
export function sanitizeDatabaseUrl(rawUrl: string): SanitizedDatabaseTarget | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname || null;
    if (!host) return null;

    const port = parsed.port || null;
    const database = decodeURIComponent(
      (parsed.pathname || "").replace(/^\//, "").split("/")[0] ?? ""
    );
    if (!database) return null;

    const scheme = parsed.protocol ? parsed.protocol.replace(/:$/, "") : null;
    const display = port
      ? `${scheme ?? "postgresql"}://${host}:${port}/${database}`
      : `${scheme ?? "postgresql"}://${host}/${database}`;

    return { scheme, host, port, database, display };
  } catch {
    const match = trimmed.match(
      /^(?<scheme>[a-z0-9+.-]+):\/\/(?:[^/@]+@)?(?<host>[^/:]+)(?::(?<port>\d+))?\/(?<database>[^/?#]+)/i
    );
    if (!match?.groups?.host || !match.groups.database) return null;
    const scheme = match.groups.scheme ?? null;
    const host = match.groups.host;
    const port = match.groups.port ?? null;
    const database = decodeURIComponent(match.groups.database);
    const display = port
      ? `${scheme ?? "postgresql"}://${host}:${port}/${database}`
      : `${scheme ?? "postgresql"}://${host}/${database}`;
    return { scheme, host, port, database, display };
  }
}

/** Percentual 0–100 com 2 casas; 0 quando total=0. */
export function computeCoveragePercent(filled: number, total: number): number {
  if (!Number.isFinite(filled) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  const safeFilled = Math.max(0, Math.min(filled, total));
  return Math.round((safeFilled / total) * 10000) / 100;
}

export function formatCoveragePercent(percent: number | null): string {
  if (percent == null || !Number.isFinite(percent)) return "n/a";
  return `${percent.toFixed(2)}%`;
}

export function buildFieldCoverageStat(input: {
  field: string;
  model: FieldCoverageStat["model"];
  presentInSchema: boolean;
  total: number;
  filled: number;
  notes?: string | null;
}): FieldCoverageStat {
  if (!input.presentInSchema) {
    return {
      field: input.field,
      model: input.model,
      presentInSchema: false,
      total: 0,
      filled: 0,
      nullCount: 0,
      coveragePercent: null,
      notes:
        input.notes ??
        "Campo não existe como coluna normalizada no schema Prisma atual.",
    };
  }

  const total = Math.max(0, Math.trunc(input.total));
  const filled = Math.max(0, Math.min(Math.trunc(input.filled), total));
  const nullCount = Math.max(0, total - filled);
  return {
    field: input.field,
    model: input.model,
    presentInSchema: true,
    total,
    filled,
    nullCount,
    coveragePercent: computeCoveragePercent(filled, total),
    notes: input.notes ?? null,
  };
}

/**
 * Campos normalizados de NomusStockDocument conforme schema atual.
 * Não inventa colunas ausentes (cliente/empresa/status/total etc.).
 */
export const NOMUS_STOCK_DOCUMENT_COVERAGE_FIELDS = [
  "externalId",
  "idNfe",
  "tipoDocumentoEstoque",
  "dataDocumento",
  "rawJson",
  "syncedAt",
  "createdAt",
  "updatedAt",
] as const;

/**
 * Campos normalizados de NomusStockDocumentItem conforme schema atual.
 * código/descrição não existem como colunas — reportados via presentInSchema=false.
 */
export const NOMUS_STOCK_DOCUMENT_ITEM_COVERAGE_FIELDS = [
  "stockDocumentId",
  "externalItemId",
  "externalProductId",
  "quantity",
  "unitValue",
  "estimatedTotalValue",
  "rawJson",
  "createdAt",
  "updatedAt",
] as const;

export const NOMUS_STOCK_DOCUMENT_ITEM_ABSENT_SCHEMA_FIELDS = [
  "productCode",
  "productDescription",
] as const;

export function buildEmptyStageInventory(): StageInventory {
  return {
    documents: {
      total: 0,
      documentoSaida: 0,
      otherTypes: 0,
      byType: [],
      byYear: [],
      byMonth: [],
      nullDataDocumento: 0,
      minDataDocumento: null,
      maxDataDocumento: null,
      minExternalId: null,
      maxExternalId: null,
      withoutItems: 0,
    },
    items: {
      total: 0,
      orphanCount: 0,
      avgItemsPerDocument: null,
      maxItemsPerDocument: null,
      withoutProduct: 0,
      withoutCode: null,
      withoutDescription: null,
      withoutQuantity: 0,
      withoutValue: 0,
    },
    samples: {
      documentsWithoutItemsExternalIds: [],
      orphanItemIds: [],
    },
  };
}

export function buildEmptyAuditSections(): AuditOutputDocumentsDbSections {
  return {
    inventory: null,
    fieldCoverage: [],
    itemCoverage: [],
    rawJsonKeys: null,
    paymentTermsEvidence: null,
    nfeLinks: null,
    salesOrderLinks: null,
    counts: {},
    documentFocus: null,
    orderFocus: null,
    nfeFocus: null,
    samples: {},
    gaps: [],
    risks: [],
    notes: [
      "Auditor read-only de Documentos de Saída.",
      "Este auditor é estritamente read-only — não executa create, update, upsert ou delete.",
    ],
  };
}

export function buildAuditResult(input: {
  startedAt: Date;
  finishedAt: Date;
  options: AuditOutputDocumentsDbCliOptions;
  database: SanitizedDatabaseTarget | null;
  status: AuditOutputDocumentsDbStatus;
  error?: string | null;
  sections?: AuditOutputDocumentsDbSections;
  mode?: AuditOutputDocumentsDbMode;
}): AuditOutputDocumentsDbResult {
  const durationMs = Math.max(
    0,
    input.finishedAt.getTime() - input.startedAt.getTime()
  );
  return {
    meta: {
      startedAt: input.startedAt.toISOString(),
      finishedAt: input.finishedAt.toISOString(),
      durationMs,
      database: input.database,
      options: input.options,
      mode: input.mode ?? "scaffold",
      readOnly: true,
    },
    status: input.status,
    error: input.error ?? null,
    sections: input.sections ?? buildEmptyAuditSections(),
  };
}

function formatCoverageTableMarkdown(
  title: string,
  rows: FieldCoverageStat[]
): string[] {
  const lines = [
    `## ${title}`,
    "",
  ];
  if (rows.length === 0) {
    lines.push("_Sem dados de cobertura._", "");
    return lines;
  }
  lines.push(
    "| Campo | Model | No schema | Total | Preenchidos | Nulos | Cobertura | Notas |",
    "|---|---|---|---:|---:|---:|---:|---|"
  );
  for (const row of rows) {
    const notes = (row.notes ?? "—").replace(/\|/g, "/");
    lines.push(
      `| ${row.field} | ${row.model} | ${row.presentInSchema ? "sim" : "não"} | ${row.total} | ${row.filled} | ${row.nullCount} | ${formatCoveragePercent(row.coveragePercent)} | ${notes} |`
    );
  }
  lines.push("");
  return lines;
}

function formatInventoryMarkdown(inventory: StageInventory): string[] {
  const d = inventory.documents;
  const i = inventory.items;
  const lines: string[] = [
    "## Inventory",
    "",
    "### Documentos (`NomusStockDocument`)",
    "",
    "| Métrica | Valor |",
    "|---|---:|",
    `| Total | ${d.total} |`,
    `| DocumentoSaida | ${d.documentoSaida} |`,
    `| Outros tipos | ${d.otherTypes} |`,
    `| Sem itens | ${d.withoutItems} |`,
    `| dataDocumento nula | ${d.nullDataDocumento} |`,
    `| min dataDocumento | ${d.minDataDocumento ?? "—"} |`,
    `| max dataDocumento | ${d.maxDataDocumento ?? "—"} |`,
    `| min externalId | ${d.minExternalId ?? "—"} |`,
    `| max externalId | ${d.maxExternalId ?? "—"} |`,
    "",
  ];

  if (d.byType.length > 0) {
    lines.push("#### Quantidade por tipo", "");
    lines.push("| tipoDocumentoEstoque | count |", "|---|---:|");
    for (const row of d.byType) {
      lines.push(`| ${row.tipoDocumentoEstoque ?? "(null)"} | ${row.count} |`);
    }
    lines.push("");
  }

  if (d.byYear.length > 0) {
    lines.push("#### Quantidade por ano (`dataDocumento`)", "");
    lines.push("| year | count |", "|---:|---:|");
    for (const row of d.byYear) {
      lines.push(`| ${row.year} | ${row.count} |`);
    }
    lines.push("");
  }

  if (d.byMonth.length > 0) {
    lines.push("#### Quantidade por mês (`dataDocumento`)", "");
    lines.push("| year | month | count |", "|---:|---:|---:|");
    for (const row of d.byMonth) {
      lines.push(`| ${row.year} | ${row.month} | ${row.count} |`);
    }
    lines.push("");
  }

  lines.push(
    "### Itens (`NomusStockDocumentItem`)",
    "",
    "| Métrica | Valor |",
    "|---|---:|",
    `| Total | ${i.total} |`,
    `| Órfãos | ${i.orphanCount} |`,
    `| Média de itens/documento | ${i.avgItemsPerDocument ?? "—"} |`,
    `| Máximo de itens/documento | ${i.maxItemsPerDocument ?? "—"} |`,
    `| Sem produto (\`externalProductId\`) | ${i.withoutProduct} |`,
    `| Sem código | ${i.withoutCode == null ? "n/a (ausente no schema)" : i.withoutCode} |`,
    `| Sem descrição | ${i.withoutDescription == null ? "n/a (ausente no schema)" : i.withoutDescription} |`,
    `| Sem quantidade (null) | ${i.withoutQuantity} |`,
    `| Sem valor unitário (null) | ${i.withoutValue} |`,
    ""
  );

  return lines;
}

function formatRawJsonKeysMarkdown(
  section: import("./auditOutputDocumentsRawJson.js").RawJsonKeysSection | null
): string[] {
  const lines: string[] = ["## rawJsonKeys", ""];
  if (!section) {
    lines.push("_Não disponível nesta execução._", "");
    return lines;
  }

  lines.push(
    "| Métrica | Valor |",
    "|---|---:|",
    `| sampleSize | ${section.sampleSize} |`,
    `| documentsScanned | ${section.documentsScanned} |`,
    `| itemsScanned | ${section.itemsScanned} |`,
    `| maxDepth | ${section.maxDepth} |`,
    `| keys | ${section.keys.length} |`,
    ""
  );

  const topKeys = section.keys.slice(0, 40);
  if (topKeys.length === 0) {
    lines.push("_Nenhuma chave encontrada na amostra._", "");
  } else {
    lines.push(
      "### Matriz de chaves (amostra; top 40)",
      "",
      "| Chave | Aparições | % amostra | Tipos | Exemplos sanitizados | Hipóteses |",
      "|---|---:|---:|---|---|---|"
    );
    for (const row of topKeys) {
      const examples = row.sanitizedExamples.join("; ").replace(/\|/g, "/") || "—";
      const types = row.observedTypes.join(",") || "—";
      const tags = row.hypothesisTags.join(",") || "—";
      lines.push(
        `| ${row.key.replace(/\|/g, "/")} | ${row.appearances} | ${row.samplePercent.toFixed(2)} | ${types} | ${examples} | ${tags} |`
      );
    }
    lines.push("");
  }

  const focused = section.focusHypotheses.filter((f) => f.matchingKeyCount > 0);
  if (focused.length > 0) {
    lines.push("### Focos (hipótese por nome)", "");
    for (const focus of focused) {
      lines.push(
        `- **${focus.focus}**: ${focus.matchingKeyCount} chave(s) — ${focus.matchingKeys.slice(0, 8).join(", ")}${focus.matchingKeys.length > 8 ? ", …" : ""}`
      );
    }
    lines.push("");
  }

  for (const note of section.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  return lines;
}

function formatPaymentTermsEvidenceMarkdown(
  evidence: import("./auditOutputDocumentsRawJson.js").PaymentTermsEvidence | null
): string[] {
  const lines: string[] = ["## paymentTermsEvidence", ""];
  if (!evidence) {
    lines.push("_Não disponível nesta execução._", "");
    return lines;
  }

  lines.push(
    `| hypothesisOnly | ${evidence.hypothesisOnly ? "sim" : "não"} |`,
    `| sampleSize | ${evidence.sampleSize} |`,
    `| candidateKeys | ${evidence.candidateKeys.length} |`,
    ""
  );

  if (evidence.candidateKeys.length === 0) {
    lines.push(
      "_Nenhuma chave candidata de pagamento/parcelas na amostra (hipótese)._",
      ""
    );
  } else {
    lines.push(
      "| Chave | Aparições | % | Tipos | Exemplos | Tags |",
      "|---|---:|---:|---|---|---|"
    );
    for (const row of evidence.candidateKeys.slice(0, 30)) {
      lines.push(
        `| ${row.key.replace(/\|/g, "/")} | ${row.appearances} | ${row.samplePercent.toFixed(2)} | ${row.observedTypes.join(",") || "—"} | ${row.sanitizedExamples.join("; ").replace(/\|/g, "/") || "—"} | ${row.hypothesisTags.join(",") || "—"} |`
      );
    }
    lines.push("");
  }

  for (const note of evidence.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  return lines;
}

function formatClassificationCountsMarkdown(
  counts: Record<string, number>
): string {
  return Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

function formatNfeLinksMarkdown(
  section: import("./auditOutputDocumentsLinks.js").NfeLinksSection | null
): string[] {
  const lines: string[] = ["## nfeLinks", ""];
  if (!section) {
    lines.push("_Não disponível nesta execução._", "");
    return lines;
  }
  const m = section.metrics;
  lines.push(
    "| Métrica | Valor |",
    "|---|---:|",
    `| documentsTotal | ${m.documentsTotal} |`,
    `| documentsWithIdNfe | ${m.documentsWithIdNfe} |`,
    `| documentsWithoutIdNfe | ${m.documentsWithoutIdNfe} |`,
    `| nfeFoundLocally | ${m.nfeFoundLocally} |`,
    `| nfeMissingLocally | ${m.nfeMissingLocally} |`,
    `| nfeValid | ${m.nfeValid} |`,
    `| nfeCancelled | ${m.nfeCancelled} |`,
    `| nfeWithMultipleDocuments | ${m.nfeWithMultipleDocuments} |`,
    "",
    `Classificações (amostra): ${formatClassificationCountsMarkdown(m.classificationCounts)}`,
    ""
  );
  for (const note of section.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines;
}

function formatSalesOrderLinksMarkdown(
  section: import("./auditOutputDocumentsLinks.js").SalesOrderLinksSection | null
): string[] {
  const lines: string[] = ["## salesOrderLinks", ""];
  if (!section) {
    lines.push("_Não disponível nesta execução._", "");
    return lines;
  }
  const m = section.metrics;
  lines.push(
    "| Métrica | Valor |",
    "|---|---:|",
    `| documentsTotal | ${m.documentsTotal} |`,
    `| documentsWithZeroOrders | ${m.documentsWithZeroOrders} |`,
    `| documentsWithOneOrder | ${m.documentsWithOneOrder} |`,
    `| documentsWithMultipleOrders | ${m.documentsWithMultipleOrders} |`,
    `| ordersWithMultipleDocuments | ${m.ordersWithMultipleDocuments} |`,
    `| resolvedByItem | ${m.resolvedByItem} |`,
    `| resolvedByNfeOnly | ${m.resolvedByNfeOnly} |`,
    `| dependentOnO2c | ${m.dependentOnO2c} |`,
    `| conflictsBetweenSources | ${m.conflictsBetweenSources} |`,
    "",
    `Classificações (amostra): ${formatClassificationCountsMarkdown(m.classificationCounts)}`,
    ""
  );
  for (const note of section.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines;
}

export function formatAuditOutputDocumentsDbMarkdown(
  result: AuditOutputDocumentsDbResult
): string {
  const lines: string[] = [
    "# Auditoria read-only — Documentos de Saída",
    "",
    "| | |",
    "|---|---|",
    `| **Status** | ${result.status} |`,
    `| **Modo** | ${result.meta.mode} |`,
    `| **Read-only** | ${result.meta.readOnly ? "sim" : "não"} |`,
    `| **Started** | ${result.meta.startedAt} |`,
    `| **Finished** | ${result.meta.finishedAt} |`,
    `| **Duration (ms)** | ${result.meta.durationMs} |`,
    `| **Database** | ${result.meta.database?.display ?? "—"} |`,
    `| **Documento** | ${result.meta.options.document} |`,
    `| **Pedido** | ${result.meta.options.order} |`,
    `| **NF-e** | ${result.meta.options.nfe} |`,
    `| **Sample limit** | ${result.meta.options.sampleLimit} |`,
    "",
  ];

  if (result.error) {
    lines.push("## Erro", "", result.error, "");
  }

  if (result.sections.inventory) {
    lines.push(...formatInventoryMarkdown(result.sections.inventory));
  } else {
    lines.push("## Inventory", "", "_Não disponível nesta execução._", "");
  }

  lines.push(
    ...formatCoverageTableMarkdown(
      "Field coverage (`NomusStockDocument`)",
      result.sections.fieldCoverage
    )
  );
  lines.push(
    ...formatCoverageTableMarkdown(
      "Item coverage (`NomusStockDocumentItem`)",
      result.sections.itemCoverage
    )
  );

  lines.push(...formatRawJsonKeysMarkdown(result.sections.rawJsonKeys));
  lines.push(
    ...formatPaymentTermsEvidenceMarkdown(result.sections.paymentTermsEvidence)
  );
  lines.push(...formatNfeLinksMarkdown(result.sections.nfeLinks));
  lines.push(...formatSalesOrderLinksMarkdown(result.sections.salesOrderLinks));

  if (result.sections.notes.length > 0) {
    lines.push("## Notas", "");
    for (const note of result.sections.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!error) return false;
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);

  if (name === "PrismaClientInitializationError") return true;
  if (/Can't reach database server/i.test(message)) return true;
  if (/P1001|P1000|P1017/i.test(message)) return true;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) return true;
  if (/database.*(unavailable|indisponível|unreachable)/i.test(message)) {
    return true;
  }
  return false;
}

export function formatDatabaseUnavailableMessage(
  database: SanitizedDatabaseTarget | null
): string {
  const target = database?.display ?? "(alvo não sanitizável)";
  return (
    `Banco de dados indisponível para o alvo sanitizado ${target}. ` +
    "Verifique DATABASE_URL (sem expor senha), rede/VPN e se o PostgreSQL está ativo. " +
    "Nenhuma consulta de domínio foi executada."
  );
}

/**
 * Garante desconexão do Prisma mesmo quando a auditoria falha.
 * Erros de disconnect não mascaram o erro original.
 */
export async function disconnectPrismaSafe(
  prisma: PrismaDisconnectable | null | undefined
): Promise<void> {
  if (!prisma) return;
  try {
    await prisma.$disconnect();
  } catch {
    // Ignora falha de disconnect para não ocultar o erro principal.
  }
}

/**
 * Probe mínimo read-only: confirma conectividade sem mutar dados.
 */
export async function probeDatabaseConnectivity(
  prisma: { $queryRaw: (...args: unknown[]) => Promise<unknown> }
): Promise<void> {
  await prisma.$queryRaw`SELECT 1 AS ok`;
}

/** Converte BigInt/Decimal/string numérica de agregações SQL para number. */
export function toAuditNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

export function toAuditNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = toAuditNumber(value);
  return Number.isFinite(n) ? n : null;
}

export function toAuditIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/** Marcadores de escrita proibidos no runner (checagem estática em testes). */
export const AUDIT_OUTPUT_DOCUMENTS_DB_FORBIDDEN_WRITE_PATTERNS = [
  /\.create\s*\(/,
  /\.createMany\s*\(/,
  /\.update\s*\(/,
  /\.updateMany\s*\(/,
  /\.upsert\s*\(/,
  /\.delete\s*\(/,
  /\.deleteMany\s*\(/,
  /\$executeRaw(?:Unsafe)?\s*[`(]/,
  /\$executeRawUnsafe\s*\(/,
] as const;
