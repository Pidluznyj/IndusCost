/**
 * Auditoria em lote (read-only) — vínculos PV→OP→DS→NF vs snapshot do Kanban.
 * Classifica cada pedido sem gravar e sem Nomus HTTP.
 */

import type { SalesOrderFlowStage } from "./salesOrderFlowCatalog.js";

export const SALES_ORDER_FLOW_INTEGRITY_AUDIT_LOG_PREFIX =
  "[audit:sales-order:flow:integrity]";

export type SalesOrderFlowIntegrityKind =
  | "OK"
  | "STALE_SNAPSHOT"
  | "FALSE_WAITING_OP"
  | "MISSING_FISCAL_LINKS"
  | "LEGITIMATE_WAITING_OP";

export type SalesOrderFlowIntegrityCliArgs = {
  fromDate: Date | null;
  toDate: Date | null;
  batchSize: number;
  includeCompleted: boolean;
  maxOrders: number | null;
  jsonOutput: string | null;
  markdownOutput: string | null;
};

export type SalesOrderFlowIntegrityOrderFinding = {
  salesOrderId: string;
  orderCode: string;
  kind: SalesOrderFlowIntegrityKind;
  calculatedStage: SalesOrderFlowStage | string;
  persistedStage: string | null;
  hasValidNfe: boolean;
  hasStockDocumentWithNfe: boolean;
  hasO2cAllocation: boolean;
  commerciallyClosedItemCount: number;
  itemsWithNfeCoverage: number;
  itemsWithDocumentCoverage: number;
  remainingFulfillmentTotal: string;
  detail: string;
};

export type SalesOrderFlowIntegrityReport = {
  ok: true;
  mode: "READ_ONLY";
  generatedAt: string;
  guarantees: {
    databaseWrites: false;
    nomusCalls: false;
    passwordExposed: false;
  };
  filters: {
    fromDate: string | null;
    toDate: string | null;
    batchSize: number;
    includeCompleted: boolean;
    maxOrders: number | null;
  };
  counts: Record<SalesOrderFlowIntegrityKind, number> & {
    ordersScanned: number;
    actionable: number;
  };
  findings: SalesOrderFlowIntegrityOrderFinding[];
  summary: string;
};

function parseDateArg(raw: string, flag: string): Date {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`${flag} deve ser YYYY-MM-DD.`);
  }
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} inválido: ${trimmed}`);
  }
  return date;
}

export function parseSalesOrderFlowIntegrityAuditArgs(
  argv: string[]
): SalesOrderFlowIntegrityCliArgs {
  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  let batchSize = 50;
  let includeCompleted = true;
  let maxOrders: number | null = null;
  let jsonOutput: string | null = null;
  let markdownOutput: string | null = null;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      throw new Error("HELP");
    }
    if (arg.startsWith("--from=")) {
      fromDate = parseDateArg(arg.slice("--from=".length), "--from");
      continue;
    }
    if (arg.startsWith("--to=")) {
      toDate = parseDateArg(arg.slice("--to=".length), "--to");
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      const n = Number(arg.slice("--batch-size=".length));
      if (!Number.isFinite(n) || n < 1 || n > 500) {
        throw new Error("--batch-size deve ser 1..500.");
      }
      batchSize = Math.floor(n);
      continue;
    }
    if (arg === "--include-completed") {
      includeCompleted = true;
      continue;
    }
    if (arg === "--exclude-completed") {
      includeCompleted = false;
      continue;
    }
    if (arg.startsWith("--max-orders=")) {
      const n = Number(arg.slice("--max-orders=".length));
      if (!Number.isFinite(n) || n < 1) {
        throw new Error("--max-orders deve ser >= 1.");
      }
      maxOrders = Math.floor(n);
      continue;
    }
    if (arg.startsWith("--json-output=")) {
      jsonOutput = arg.slice("--json-output=".length).trim() || null;
      continue;
    }
    if (arg.startsWith("--markdown-output=")) {
      markdownOutput = arg.slice("--markdown-output=".length).trim() || null;
      continue;
    }
    throw new Error(`argumento desconhecido: ${arg}`);
  }

  return {
    fromDate,
    toDate,
    batchSize,
    includeCompleted,
    maxOrders,
    jsonOutput,
    markdownOutput,
  };
}

export function printSalesOrderFlowIntegrityAuditHelp(): string {
  return [
    "Uso: npm run audit:sales-order:flow:integrity -- [opções]",
    "",
    "  --from=YYYY-MM-DD          Filtra emissão >=",
    "  --to=YYYY-MM-DD            Filtra emissão <=",
    "  --batch-size=N             Lote (default 50, max 500)",
    "  --include-completed        Inclui SHIPPED_COMPLETED (default)",
    "  --exclude-completed        Só colunas operacionais do Kanban",
    "  --max-orders=N             Limite defensivo",
    "  --json-output=path         JSON de saída",
    "  --markdown-output=path     Markdown de saída",
    "",
    "Somente leitura. Não chama Nomus. Não grava snapshots.",
  ].join("\n");
}

export type ClassifySalesOrderFlowIntegrityInput = {
  calculatedStage: string;
  persistedStage: string | null;
  hasValidNfe: boolean;
  hasStockDocumentWithNfe: boolean;
  hasO2cAllocation: boolean;
  commerciallyClosedItemCount: number;
  itemsWithNfeCoverage: number;
  itemsWithDocumentCoverage: number;
  remainingFulfillmentTotal: number;
};

/**
 * Classificação genérica (sem orderCode / cliente).
 *
 * - MISSING_FISCAL_LINKS: encerrado no Nomus sem NF/DS/O2C visíveis ao motor
 * - FALSE_WAITING_OP: snapshot em Aguardando OP, cálculo já concluído
 * - STALE_SNAPSHOT: outros descompassos cálculo × snapshot
 * - LEGITIMATE_WAITING_OP: cálculo exige OP (saldo > 0)
 * - OK: alinhado
 */
export function classifySalesOrderFlowIntegrity(
  input: ClassifySalesOrderFlowIntegrityInput
): { kind: SalesOrderFlowIntegrityKind; detail: string } {
  const fiscalVisible =
    input.hasValidNfe ||
    input.hasStockDocumentWithNfe ||
    input.hasO2cAllocation ||
    input.itemsWithNfeCoverage > 0 ||
    input.itemsWithDocumentCoverage > 0;

  if (input.commerciallyClosedItemCount > 0 && !fiscalVisible) {
    return {
      kind: "MISSING_FISCAL_LINKS",
      detail:
        "Itens comercialmente encerrados sem NF/DS/O2C visíveis ao motor — vínculo fiscal ausente ou não sincronizado.",
    };
  }

  const persisted = input.persistedStage;
  const calculated = input.calculatedStage;
  if (persisted != null && persisted !== calculated) {
    if (
      persisted === "WAITING_PRODUCTION_ORDER" &&
      calculated !== "WAITING_PRODUCTION_ORDER"
    ) {
      return {
        kind: "FALSE_WAITING_OP",
        detail: `Snapshot em WAITING_PRODUCTION_ORDER; cálculo ${calculated}. Vínculos/cálculo ok — precisa rebuild do snapshot.`,
      };
    }
    return {
      kind: "STALE_SNAPSHOT",
      detail: `Snapshot ${persisted} ≠ cálculo ${calculated}. Rebuild alinha o Kanban.`,
    };
  }

  if (
    calculated === "WAITING_PRODUCTION_ORDER" &&
    input.remainingFulfillmentTotal > 0.000_001
  ) {
    return {
      kind: "LEGITIMATE_WAITING_OP",
      detail:
        "Residual de atendimento > 0 com produção necessária — Aguardando OP é correto.",
    };
  }

  return {
    kind: "OK",
    detail: "Cálculo e snapshot alinhados; evidência fiscal/documental coerente.",
  };
}

export function emptyIntegrityCounts(): Record<
  SalesOrderFlowIntegrityKind,
  number
> {
  return {
    OK: 0,
    STALE_SNAPSHOT: 0,
    FALSE_WAITING_OP: 0,
    MISSING_FISCAL_LINKS: 0,
    LEGITIMATE_WAITING_OP: 0,
  };
}

export function isActionableIntegrityKind(
  kind: SalesOrderFlowIntegrityKind
): boolean {
  return (
    kind === "STALE_SNAPSHOT" ||
    kind === "FALSE_WAITING_OP" ||
    kind === "MISSING_FISCAL_LINKS"
  );
}

export function buildSalesOrderFlowIntegritySummary(
  counts: Record<SalesOrderFlowIntegrityKind, number> & {
    ordersScanned: number;
    actionable: number;
  }
): string {
  if (counts.ordersScanned === 0) {
    return "Nenhum pedido no filtro.";
  }
  if (counts.actionable === 0) {
    return `OK: ${counts.ordersScanned} pedido(s) sem divergência acionável (${counts.LEGITIMATE_WAITING_OP} legitimamente em Aguardando OP).`;
  }
  return [
    `Acionáveis: ${counts.actionable}/${counts.ordersScanned}`,
    `FALSE_WAITING_OP=${counts.FALSE_WAITING_OP}`,
    `STALE_SNAPSHOT=${counts.STALE_SNAPSHOT}`,
    `MISSING_FISCAL_LINKS=${counts.MISSING_FISCAL_LINKS}`,
    `(LEGITIMATE_WAITING_OP=${counts.LEGITIMATE_WAITING_OP}, OK=${counts.OK})`,
  ].join(" · ");
}

export function formatSalesOrderFlowIntegrityMarkdown(
  report: SalesOrderFlowIntegrityReport
): string {
  const lines: string[] = [];
  lines.push("# Auditoria de integridade — Fluxo de Pedidos");
  lines.push("");
  lines.push(`- Gerado em: ${report.generatedAt}`);
  lines.push(`- Modo: \`${report.mode}\``);
  lines.push(`- Pedidos analisados: ${report.counts.ordersScanned}`);
  lines.push(`- Acionáveis: **${report.counts.actionable}**`);
  lines.push(`- Resumo: ${report.summary}`);
  lines.push("");
  lines.push("## Contagens");
  lines.push("");
  for (const kind of [
    "FALSE_WAITING_OP",
    "STALE_SNAPSHOT",
    "MISSING_FISCAL_LINKS",
    "LEGITIMATE_WAITING_OP",
    "OK",
  ] as const) {
    lines.push(`- \`${kind}\`: ${report.counts[kind]}`);
  }
  lines.push("");
  lines.push("## Achados acionáveis");
  lines.push("");
  const actionable = report.findings.filter((f) =>
    isActionableIntegrityKind(f.kind)
  );
  if (actionable.length === 0) {
    lines.push("_Nenhum._");
  } else {
    for (const f of actionable) {
      lines.push(
        `- **${f.orderCode}** (\`${f.kind}\`): calc \`${f.calculatedStage}\` × snap \`${f.persistedStage ?? "—"}\` — ${f.detail}`
      );
      lines.push(
        `  - NF válida: ${f.hasValidNfe ? "sim" : "não"} · DS+idNfe: ${f.hasStockDocumentWithNfe ? "sim" : "não"} · O2C: ${f.hasO2cAllocation ? "sim" : "não"} · itens NF/Doc: ${f.itemsWithNfeCoverage}/${f.itemsWithDocumentCoverage}`
      );
    }
  }
  lines.push("");
  lines.push("## Próximos passos");
  lines.push("");
  if (report.counts.FALSE_WAITING_OP + report.counts.STALE_SNAPSHOT > 0) {
    lines.push(
      "1. Snapshots velhos → `npm run rebuild:sales-order-flow -- --apply` (mesma regra genérica)."
    );
  }
  if (report.counts.MISSING_FISCAL_LINKS > 0) {
    lines.push(
      "2. Sem vínculo fiscal → sync Nomus de NF/DS/`SalesOrderNfeLink` (rebuild sozinho não cria vínculo)."
    );
  }
  if (report.counts.actionable === 0) {
    lines.push("Nenhuma ação necessária além do sync automático pós-Nomus.");
  }
  lines.push("");
  return lines.join("\n");
}

export function resolveSalesOrderFlowIntegrityExitCode(input: {
  technicalError?: boolean;
  actionable: number;
}): number {
  if (input.technicalError) return 1;
  return input.actionable > 0 ? 1 : 0;
}
