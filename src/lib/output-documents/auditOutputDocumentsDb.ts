/**
 * Lógica pura do auditor read-only de Documentos de Saída (DS-02.2 scaffold).
 * Sem I/O de banco — o script scripts/auditOutputDocumentsDb.ts orquestra Prisma.
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

export type AuditOutputDocumentsDbSections = {
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
    mode: "scaffold";
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
    // Fallback sem URL parser (ex.: formatos não padrão).
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

export function buildEmptyAuditSections(): AuditOutputDocumentsDbSections {
  return {
    counts: {},
    documentFocus: null,
    orderFocus: null,
    nfeFocus: null,
    samples: {},
    gaps: [],
    risks: [],
    notes: [
      "Scaffold DS-02.2: seções estruturadas vazias. Consultas detalhadas serão implementadas em etapas posteriores.",
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
      mode: "scaffold",
      readOnly: true,
    },
    status: input.status,
    error: input.error ?? null,
    sections: input.sections ?? buildEmptyAuditSections(),
  };
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

  lines.push(
    "## Seções",
    "",
    "- `counts`: estrutura reservada (vazia neste scaffold)",
    "- `documentFocus`: estrutura reservada (vazia neste scaffold)",
    "- `orderFocus`: estrutura reservada (vazia neste scaffold)",
    "- `nfeFocus`: estrutura reservada (vazia neste scaffold)",
    "- `samples`: estrutura reservada (vazia neste scaffold)",
    "- `gaps`: estrutura reservada (vazia neste scaffold)",
    "- `risks`: estrutura reservada (vazia neste scaffold)",
    ""
  );

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
 * Consultas de domínio permanecem para etapas posteriores.
 */
export async function probeDatabaseConnectivity(
  prisma: { $queryRaw: (...args: unknown[]) => Promise<unknown> }
): Promise<void> {
  await prisma.$queryRaw`SELECT 1 AS ok`;
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
