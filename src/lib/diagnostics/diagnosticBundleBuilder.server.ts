/**
 * Montagem read-only do ChatGPT Analyzable Diagnostic Bundle (ZIP).
 * Artefatos gravados em tmp/diagnostic-bundles/ — gitignored.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHATGPT_DIAGNOSTIC_BUNDLE_VERSION,
  DEFAULT_EVIDENCE_PATHS,
  DEFAULT_EXPORT_PATHS,
  REQUIRED_BUNDLE_DIRECTORIES,
  REQUIRED_BUNDLE_ROOT_FILES,
  type DiagnosticBundle,
  type DiagnosticCodeReference,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticManifest,
  type DiagnosticManifestFile,
  type DiagnosticReproductionCommand,
  type DiagnosticScope,
  type DiagnosticScopeContext,
  assertValidFinding,
} from "./chatgptDiagnosticTypes.js";
import {
  DEFAULT_CODE_REFERENCES,
  createDiagnosticSourceRef,
} from "./diagnosticSourceRefs.server.js";
import {
  assertBundleContainsNoForbiddenSecrets,
  buildSafeEnvironmentFlags,
  contextToRedactionReport,
  createSanitizationContext,
  sanitizeDiagnosticLogLines,
  sanitizeDiagnosticPayload,
  sanitizeDiagnosticText,
} from "./sanitizeDiagnosticPayload.server.js";

export type BuildDiagnosticBundleInput = {
  scope: DiagnosticScope;
  context?: DiagnosticScopeContext;
  findings?: DiagnosticFinding[];
  evidence?: DiagnosticEvidence[];
  reproductionCommands?: DiagnosticReproductionCommand[];
  codeReferences?: DiagnosticCodeReference[];
  logs?: string[];
  businessRulesMarkdown?: string;
  executiveSummaryMarkdown?: string;
  problemContextMarkdown?: string;
  databaseEvidence?: Record<string, unknown>;
  calculationTrace?: Record<string, unknown>;
  systemSnapshot?: Record<string, unknown>;
  rawLimitedEvidence?: Record<string, unknown>;
};

export type BuildDiagnosticBundleResult = {
  bundle: DiagnosticBundle;
  outputDir: string;
  zipPath: string;
};

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function mediaType(path: string): string {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".jsonl")) return "application/x-ndjson";
  if (path.endsWith(".csv")) return "text/csv";
  if (path.endsWith(".log")) return "text/plain";
  if (path.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

function buildReadmeForChatGpt(): string {
  return `# README for ChatGPT — IndusCost Diagnostic Bundle

Você está recebendo um pacote diagnóstico do sistema **IndusCost / My Industry**.

## Ordem de leitura

1. \`01_EXECUTIVE_SUMMARY.md\`
2. \`03_DIAGNOSTIC_INDEX.json\`
3. \`04_DIAGNOSTICS.json\`
4. \`05_REPRODUCTION_STEPS.md\`
5. Arquivos de evidência em \`evidence/\` conforme \`sourceRefs\` de cada finding

## Regras

- **Não assuma dados fora deste pacote.**
- Aponte incertezas explicitamente.
- Diferencie:
  - erro de **cálculo**
  - erro de **dados**
  - erro **visual**
  - erro de **configuração**
  - erro de **regra de negócio**
- Todo número relevante deve ter \`sourceRefs\` ou \`source\` em \`09_DATABASE_EVIDENCE.json\`.
- O pacote é **read-only** — não altera custo, preço, comissão nem fechamento.

## Pergunta sugerida ao analista

> Analise este relatório e diga a causa provável do erro, citando arquivos e evidências do pacote.
`;
}

function buildExecutiveSummary(scope: DiagnosticScope, context: DiagnosticScopeContext): string {
  return `# Executive Summary

- **Pacote:** Gerar Relatório Analisável (ChatGPT Analyzable Diagnostic Bundle)
- **Versão:** ${CHATGPT_DIAGNOSTIC_BUNDLE_VERSION}
- **Escopo:** ${scope}
- **Tela:** ${context.screenTitle ?? "—"} (\`${context.screenRoute ?? "—"}\`)
- **Usuário:** ${context.userEmail ?? context.userId ?? "—"}
- **Erro reportado:** ${context.errorMessage ?? "Nenhum erro explícito no contexto."}

## Regra-mãe do domínio

Custo nasce na engenharia → preço do custo publicado → venda Nomus → comissão da venda → pagamento no recebimento → fechamento congela.
`;
}

function buildProblemContext(context: DiagnosticScopeContext): string {
  return `# Problem Context

## Filtros aplicados

\`\`\`json
${JSON.stringify(context.filters ?? {}, null, 2)}
\`\`\`

## Permissões envolvidas

${(context.permissions ?? []).map((p) => `- ${p}`).join("\n") || "- (não informado)"}

## Notas

${context.notes ?? "—"}
`;
}

function defaultSystemFinding(): DiagnosticFinding {
  return {
    id: "finding_001",
    severity: "info",
    code: "BUNDLE_GENERATED",
    title: "Pacote diagnóstico gerado com sucesso",
    message: "Bundle SYSTEM mínimo criado para validação do formato analisável.",
    businessImpact: "Nenhum — pacote de smoke test.",
    technicalImpact: "Confirma estrutura ZIP, manifest e arquivos obrigatórios.",
    evidenceRefs: ["evidence.system.bundleMeta"],
    sourceRefs: [
      createDiagnosticSourceRef({
        type: "service",
        name: "buildChatGptDiagnosticBundle",
        path: "06_SYSTEM_SNAPSHOT.json#/bundle",
      }),
    ],
    suggestedNextSteps: [
      "Anexar ZIP ao ChatGPT e pedir análise da causa provável",
      "Regenerar com escopo COST_TO_CASH quando houver erro em tela específica",
    ],
  };
}

function buildDiagnosticsJsonl(findings: DiagnosticFinding[]): string {
  return findings.map((f) => JSON.stringify(f)).join("\n") + (findings.length ? "\n" : "");
}

function buildSummaryCsv(findings: DiagnosticFinding[]): string {
  const lines = ["id,severity,code,title,message"];
  for (const f of findings) {
    lines.push(
      [f.id, f.severity, f.code, csvEscape(f.title), csvEscape(f.message)].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function emptyEvidencePlaceholder(scope: DiagnosticScope, label: string): unknown {
  return {
    status: "NOT_INCLUDED",
    scope,
    label,
    message: "Evidência não coletada neste bundle — escopo ou contexto insuficiente.",
    hint: "Regenerar com filtros (SKU, pedido, seller, tableCode) para preencher via services audit/trace.",
  };
}

export function buildChatGptDiagnosticBundle(
  input: BuildDiagnosticBundleInput
): DiagnosticBundle {
  const context: DiagnosticScopeContext = {
    scope: input.scope,
    screenRoute: input.context?.screenRoute ?? null,
    screenTitle: input.context?.screenTitle ?? null,
    filters: input.context?.filters ?? null,
    userId: input.context?.userId ?? null,
    userEmail: input.context?.userEmail ?? null,
    permissions: input.context?.permissions ?? null,
    apiCalls: input.context?.apiCalls ?? null,
    errorMessage: input.context?.errorMessage ?? null,
    notes: input.context?.notes ?? null,
  };

  const findings = input.findings?.length
    ? input.findings
    : input.scope === "SYSTEM"
      ? [defaultSystemFinding()]
      : [];

  for (const finding of findings) {
    assertValidFinding(finding);
  }

  const bundleId = randomUUID();
  const generatedAt = new Date().toISOString();
  const sanitizeCtx = createSanitizationContext();

  const systemSnapshot = sanitizeDiagnosticPayload(
    input.systemSnapshot ?? {
      bundle: {
        bundleId,
        generatedAt,
        scope: input.scope,
        version: CHATGPT_DIAGNOSTIC_BUNDLE_VERSION,
      },
      environment: {
        nodeEnv: process.env.NODE_ENV ?? "development",
        ...buildSafeEnvironmentFlags(),
      },
      auditServicesAvailable: [
        "buildProductCostTrace",
        "buildPublishedPriceTrace",
        "buildSalesOrderTrace",
        "buildCommissionTrace",
        "buildCostToCashTrace",
      ],
    },
    sanitizeCtx
  );

  const databaseEvidence = sanitizeDiagnosticPayload(
    input.databaseEvidence ?? {
      note: "Evidências limitadas — somente registros referenciados por sourceRefs.",
      productionCost: { currentOfficialCost: null },
      publishedPrice: null,
      salesOrder: null,
      commission: null,
    },
    sanitizeCtx
  );

  const calculationTrace = sanitizeDiagnosticPayload(
    input.calculationTrace ?? {
      mode: "read-only",
      recalculatedInFrontend: false,
      publishedPriceRecalculated: false,
      traces: [],
    },
    sanitizeCtx
  );

  const apiTrace = sanitizeDiagnosticPayload(
    {
      calls: context.apiCalls ?? [],
      note: "Chamadas capturadas no contexto da tela ou script gerador.",
    },
    sanitizeCtx
  );

  const screenContext = sanitizeDiagnosticPayload(context, sanitizeCtx);

  const warningsAndErrors = sanitizeDiagnosticPayload(
    {
      findings: findings.filter(
        (f) =>
          f.severity === "warning" ||
          f.severity === "error" ||
          f.severity === "critical"
      ),
      contextError: context.errorMessage ?? null,
    },
    sanitizeCtx
  );

  const diagnosticIndex = {
    bundleId,
    generatedAt,
    scope: input.scope,
    findingCount: findings.length,
    findingIds: findings.map((f) => f.id),
    evidenceFiles: DEFAULT_EVIDENCE_PATHS,
    exportFiles: DEFAULT_EXPORT_PATHS,
  };

  const reproduction: DiagnosticReproductionCommand[] =
    input.reproductionCommands ??
    [
      {
        label: "Validar bundle SYSTEM",
        command: "npx tsx scripts/generate-diagnostic-bundle.ts --scope=SYSTEM",
        note: "Read-only; grava em tmp/diagnostic-bundles/",
      },
      {
        label: "Rastreabilidade custo (exemplo)",
        command: "npx tsx scripts/audit-product-cost-trace.ts --sku=618.08AA --json",
      },
    ];

  const codeRefs = input.codeReferences ?? [...DEFAULT_CODE_REFERENCES];

  const evidenceMap = new Map<string, unknown>();
  for (const path of DEFAULT_EVIDENCE_PATHS) {
    evidenceMap.set(path, emptyEvidencePlaceholder(input.scope, path));
  }
  for (const ev of input.evidence ?? []) {
    evidenceMap.set(
      ev.bundlePath,
      sanitizeDiagnosticPayload(ev.payload, sanitizeCtx)
    );
  }
  evidenceMap.set(
    "evidence/system/bundle-meta.json",
    sanitizeDiagnosticPayload({ bundleId, generatedAt, scope: input.scope }, sanitizeCtx)
  );

  const sanitizedLogs = sanitizeDiagnosticLogLines(input.logs ?? [], sanitizeCtx);
  sanitizeCtx.filesSanitized.add("12_LOGS_SANITIZED.log");

  const jsonEntryPaths = [
    "03_DIAGNOSTIC_INDEX.json",
    "04_DIAGNOSTICS.json",
    "06_SYSTEM_SNAPSHOT.json",
    "07_SCREEN_CONTEXT.json",
    "08_API_TRACE.json",
    "09_DATABASE_EVIDENCE.json",
    "10_CALCULATION_TRACE.json",
    "13_CODE_REFERENCES.json",
    "14_WARNINGS_AND_ERRORS.json",
  ] as const;
  for (const path of jsonEntryPaths) {
    sanitizeCtx.filesSanitized.add(path);
  }

  const redactionReport = contextToRedactionReport(sanitizeCtx);

  const entries: Record<string, string> = {
    "00_README_FOR_CHATGPT.md": buildReadmeForChatGpt(),
    "01_EXECUTIVE_SUMMARY.md": sanitizeDiagnosticText(
      input.executiveSummaryMarkdown ?? buildExecutiveSummary(input.scope, context),
      sanitizeCtx
    ),
    "02_PROBLEM_CONTEXT.md": sanitizeDiagnosticText(
      input.problemContextMarkdown ?? buildProblemContext(context),
      sanitizeCtx
    ),
    "03_DIAGNOSTIC_INDEX.json": JSON.stringify(diagnosticIndex, null, 2),
    "04_DIAGNOSTICS.json": JSON.stringify({ findings }, null, 2),
    "04_DIAGNOSTICS.jsonl": sanitizeDiagnosticText(
      buildDiagnosticsJsonl(findings),
      sanitizeCtx
    ),
    "05_REPRODUCTION_STEPS.md": buildReproductionMarkdown(reproduction),
    "06_SYSTEM_SNAPSHOT.json": JSON.stringify(systemSnapshot, null, 2),
    "07_SCREEN_CONTEXT.json": JSON.stringify(screenContext, null, 2),
    "08_API_TRACE.json": JSON.stringify(apiTrace, null, 2),
    "09_DATABASE_EVIDENCE.json": JSON.stringify(databaseEvidence, null, 2),
    "10_CALCULATION_TRACE.json": JSON.stringify(calculationTrace, null, 2),
    "11_BUSINESS_RULES_APPLIED.md": sanitizeDiagnosticText(
      input.businessRulesMarkdown ?? buildDefaultBusinessRulesMarkdown(input.scope),
      sanitizeCtx
    ),
    "12_LOGS_SANITIZED.log": sanitizedLogs,
    "13_CODE_REFERENCES.json": JSON.stringify({ references: codeRefs }, null, 2),
    "14_WARNINGS_AND_ERRORS.json": JSON.stringify(warningsAndErrors, null, 2),
    "15_REDACTION_REPORT.json": JSON.stringify(
      contextToRedactionReport(sanitizeCtx),
      null,
      2
    ),
    "exports/summary.csv": buildSummaryCsv(findings),
    "exports/diagnostics.csv": buildSummaryCsv(findings),
    "evidence/raw-limited/.gitkeep": "",
  };

  for (const [path, payload] of evidenceMap.entries()) {
    sanitizeCtx.filesSanitized.add(path);
    entries[path] = JSON.stringify(payload, null, 2);
  }

  if (input.rawLimitedEvidence) {
    const rawPath =
      input.scope === "SYSTEM"
        ? "evidence/raw-limited/system-summary.json"
        : input.scope === "COMMISSION_RECEIPT_CLOSING"
        ? "evidence/raw-limited/commission-receipt-closing-summary.json"
        : input.scope === "PUBLISHED_PRICE"
          ? "evidence/raw-limited/published-price-summary.json"
          : input.scope === "PRODUCT_ENGINEERING"
            ? "evidence/raw-limited/product-engineering-summary.json"
            : "evidence/raw-limited/summary.json";
    sanitizeCtx.filesSanitized.add(rawPath);
    entries[rawPath] = JSON.stringify(input.rawLimitedEvidence, null, 2);
  }

  // Atualiza report final com todos os arquivos sanitizados
  entries["15_REDACTION_REPORT.json"] = JSON.stringify(
    {
      ...redactionReport,
      filesSanitized: [...sanitizeCtx.filesSanitized].sort(),
    },
    null,
    2
  );

  const manifest: DiagnosticManifest = {
    bundleVersion: CHATGPT_DIAGNOSTIC_BUNDLE_VERSION,
    bundleId,
    generatedAt,
    scope: input.scope,
    functionalName: "Gerar Relatório Analisável",
    technicalName: "ChatGPT Analyzable Diagnostic Bundle",
    readOnly: true,
    files: [],
  };

  entries["manifest.json"] = JSON.stringify(manifest, null, 2);

  const allFiles: DiagnosticManifestFile[] = Object.entries(entries).map(
    ([path, content]) => ({
      path,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      mediaType: mediaType(path),
      sha256: sha256(content),
    })
  );

  manifest.files = allFiles;
  entries["manifest.json"] = JSON.stringify(manifest, null, 2);
  manifest.files = allFiles.map((f) =>
    f.path === "manifest.json"
      ? {
          ...f,
          sizeBytes: Buffer.byteLength(entries["manifest.json"], "utf8"),
          sha256: sha256(entries["manifest.json"]),
        }
      : f
  );
  entries["manifest.json"] = JSON.stringify(manifest, null, 2);

  for (const [path, content] of Object.entries(entries)) {
    if (path.endsWith(".gitkeep")) continue;
    try {
      assertBundleContainsNoForbiddenSecrets(content);
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)} (arquivo: ${path})`
      );
    }
  }

  return { manifest, entries };
}

function buildReproductionMarkdown(commands: DiagnosticReproductionCommand[]): string {
  const lines = ["# Reproduction Steps", ""];
  for (const cmd of commands) {
    lines.push(`## ${cmd.label}`);
    lines.push("");
    lines.push("```bash");
    lines.push(cmd.command);
    lines.push("```");
    if (cmd.note) lines.push("", cmd.note);
    lines.push("");
  }
  return lines.join("\n");
}

function buildDefaultBusinessRulesMarkdown(scope: DiagnosticScope): string {
  return `# Business Rules Applied

- Escopo do pacote: **${scope}**
- Custo oficial prevalece sobre recálculo ao vivo (modo DIAGNOSTIC apenas como alerta).
- Preço publicado usa snapshots congelados — sem recálculo silencioso.
- \`SalesOrderItem.unitCost\` Nomus **não** é custo industrial.
- Comissão materializada: snapshot → schedule → recebimento → fechamento ledger.
- Cliente excluído: \`CUSTOMER_EXCLUDED\` (comissão final zero, base preservada).
- Sem schedule: \`NO_SCHEDULE\` (status auditável, não erro 500).
`;
}

export function assertRequiredBundleStructure(bundle: DiagnosticBundle): void {
  for (const path of REQUIRED_BUNDLE_ROOT_FILES) {
    if (!bundle.entries[path]) {
      throw new Error(`Arquivo obrigatório ausente no bundle: ${path}`);
    }
  }
  if (!bundle.entries["00_README_FOR_CHATGPT.md"]?.includes("ChatGPT")) {
    throw new Error("00_README_FOR_CHATGPT.md inválido.");
  }
  for (const dir of REQUIRED_BUNDLE_DIRECTORIES) {
    const hasFile = Object.keys(bundle.entries).some(
      (p) => p === dir || p.startsWith(`${dir}/`)
    );
    if (!hasFile) throw new Error(`Diretório obrigatório ausente: ${dir}/`);
  }
  const manifestPaths = new Set(bundle.manifest.files.map((f) => f.path));
  for (const path of Object.keys(bundle.entries)) {
    if (!manifestPaths.has(path)) {
      throw new Error(`manifest.json não lista arquivo: ${path}`);
    }
  }
}

export function writeDiagnosticBundleToDirectory(
  bundle: DiagnosticBundle,
  outputDir: string
): void {
  if (!outputDir.replace(/\\/g, "/").startsWith("tmp/")) {
    throw new Error("Bundles devem ser gravados apenas em tmp/diagnostic-bundles/ (gitignored).");
  }
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  for (const [relPath, content] of Object.entries(bundle.entries)) {
    const fullPath = join(outputDir, relPath);
    const parent = join(fullPath, "..");
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }
}

export async function writeDiagnosticBundleZip(
  bundle: DiagnosticBundle,
  zipPath: string
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const [relPath, content] of Object.entries(bundle.entries)) {
    zip.file(relPath, content);
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(zipPath, buffer);
}

export async function buildAndWriteDiagnosticBundle(
  input: BuildDiagnosticBundleInput
): Promise<BuildDiagnosticBundleResult> {
  const bundle = buildChatGptDiagnosticBundle(input);
  assertRequiredBundleStructure(bundle);

  const stamp = bundle.manifest.generatedAt.replace(/[:.]/g, "-");
  const outputDir = join(
    "tmp",
    "diagnostic-bundles",
    `${input.scope.toLowerCase()}-${stamp}`
  );
  const zipPath = `${outputDir}.zip`;

  if (!existsSync(join("tmp", "diagnostic-bundles"))) {
    mkdirSync(join("tmp", "diagnostic-bundles"), { recursive: true });
  }

  writeDiagnosticBundleToDirectory(bundle, outputDir);
  await writeDiagnosticBundleZip(bundle, zipPath);

  return { bundle, outputDir, zipPath };
}

/** Bundle SYSTEM completo para smoke test do formato. */
export async function buildMinimalSystemDiagnosticBundle(): Promise<BuildDiagnosticBundleResult> {
  const { buildAndWriteSystemDiagnosticBundle } = await import("./systemDiagnostic.server.js");
  return buildAndWriteSystemDiagnosticBundle(null, {
    screenTitle: "Validação do formato",
    screenRoute: "/internal/diagnostic-bundle",
    notes: "Bundle gerado automaticamente — read-only.",
  });
}
