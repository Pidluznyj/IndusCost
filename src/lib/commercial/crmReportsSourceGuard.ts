/**
 * Guard estático de CRM > Relatórios.
 *
 * Varre o código (sem comentários) dos módulos novos e acusa qualquer
 * tentativa de reintroduzir regra própria — o relatório só CONSOME o canônico:
 *
 *   - status de SalesOrder decidido aqui (literal de status, `status: {…}`,
 *     `NOT IN ('CANCELLED','ERROR')`, `notIn`);
 *   - SQL cru (`$queryRaw`, `Prisma.sql`…) para escolher pedido;
 *   - Proposta, NF, comissão, `settlementDate`/`receiptDate` como compra;
 *   - vendedor Nomus / `SalesOrder.responsible` como escopo de carteira;
 *   - dias por milissegundo (ms/24h) em vez de dia de calendário;
 *   - teto de horizonte de 24 meses no histórico de recompra;
 *   - escrita/cache persistente;
 *   - Prisma/Express/React dentro do motor e do núcleo puros;
 *   - CommercialActivity dentro do cálculo (só enriquecimento);
 *   - relatório personalizado/exportação consultando pedido por conta
 *     própria em vez de consumir o pipeline das listas.
 *
 * Módulo puro: recebe o texto dos arquivos e devolve violações.
 */

export type CrmReportsGuardRole =
  | "types"
  | "engine"
  | "core"
  /** Agregação/formatação pura sobre fatos já calculados (personalizado, rótulos, CSV/XLSX). */
  | "aggregation"
  | "service"
  /** Shell que só CONSOME o pipeline das listas (personalizado, exportação). */
  | "consumer"
  | "routes"
  | "verifier"
  | "verifier-cli";

export type CrmReportsGuardFile = { path: string; role: CrmReportsGuardRole; source: string };

export type CrmReportsGuardViolation = {
  path: string;
  rule: string;
  description: string;
  line: number;
  excerpt: string;
};

type Rule = {
  id: string;
  description: string;
  pattern: RegExp;
  roles: readonly CrmReportsGuardRole[];
};

const ALL: readonly CrmReportsGuardRole[] = [
  "types",
  "engine",
  "core",
  "aggregation",
  "service",
  "consumer",
  "routes",
  "verifier",
  "verifier-cli",
];
const PURE: readonly CrmReportsGuardRole[] = ["types", "engine", "core", "aggregation"];
const REPORT_RUNTIME: readonly CrmReportsGuardRole[] = [
  "types",
  "engine",
  "core",
  "aggregation",
  "service",
  "consumer",
  "routes",
];

export const CRM_REPORTS_GUARD_RULES: readonly Rule[] = [
  {
    id: "OWN_SALES_ORDER_STATUS_RULE",
    description: "Status de SalesOrder é decidido pelo canônico (buildSalesOrderListWhere), nunca aqui.",
    pattern:
      /["'`](?:CANCELLED|ERROR|DRAFT|READY_TO_SEND|SENT_TO_NOMUS)["'`]|\bisCancelledSalesOrderStatus\b|\bSALES_ORDER_CANCELLED_STATUS\b|\bSalesOrderStatus\b|\bstatus\s*:\s*\{|status::text/,
    roles: ALL,
  },
  {
    id: "NOT_IN_CANCELLED_ERROR",
    description: "Proibido NOT IN ('CANCELLED','ERROR') / notIn — regra legada divergente do oficial.",
    pattern: /NOT\s+IN\s*\(|\bnotIn\s*:/i,
    roles: ALL,
  },
  {
    id: "RAW_SQL",
    description: "Sem SQL próprio para decidir pedido válido.",
    pattern: /\$queryRaw|\$executeRaw|Prisma\.sql|Prisma\.raw|FROM\s+"SalesOrder"/,
    roles: ALL,
  },
  {
    id: "PROPOSAL_AS_PURCHASE",
    description: "Proposta não é compra.",
    pattern: /\.proposal\b|\bProposal\b|\bproposalId\b|\bProposalItem\b/,
    roles: ALL,
  },
  {
    id: "SETTLEMENT_OR_RECEIPT_DATE",
    description: "Data de compra é SalesOrder.issueDate — nunca liquidação/recebimento/vencimento.",
    pattern: /settlementDate|receiptDate|paymentDate|\bdueDate\b/,
    roles: ALL,
  },
  {
    id: "INVOICE_AS_PURCHASE",
    description: "NF não cria compra.",
    pattern: /nfeLinks|NomusNfe|nomusNfe|SalesOrderNfeLink|dataProcessamento|hasInvoice|nfeStatus/,
    roles: ALL,
  },
  {
    id: "COMMISSION_AS_PURCHASE",
    description: "Comissão não é compra.",
    pattern:
      /commissionRecord|CommissionRecord|commissionReceipt|CommissionReceipt|commissionOrderSnapshot|CommissionOrderSnapshot|commissionPaymentSchedule/,
    roles: ALL,
  },
  {
    id: "NOMUS_SELLER_AS_PORTFOLIO_SCOPE",
    description:
      "Carteira = CrmCustomerCommercialOwner. Vendedor Nomus / SalesOrder.responsible não definem escopo.",
    pattern:
      /buildCrmSellerFilterSql|buildCrmSalesOrderSellerMatchSql|buildCrmSellerCustomerExistsSql|fetchCrmSellerScopeCustomerIds|buildSellerFilterSqlForOrders|salesOrderMatchesCrmSellerScope|crmCustomerSellerScope|\bresponsible\s*:\s*true|\.responsible\b/,
    roles: REPORT_RUNTIME,
  },
  {
    id: "MS_PER_DAY",
    description: "Dias de recompra são de calendário local — nada de ms/24h.",
    pattern: /86_?400_?000|1000\s*\*\s*60\s*\*\s*60\s*\*\s*24|24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|\/\s*MS_PER_DAY/,
    roles: ALL,
  },
  {
    id: "HISTORY_HORIZON_CAP",
    description: "Recompra busca histórico inteiro — sem o horizonte de 24 meses do cockpit.",
    pattern: /CRM_RELATIONSHIP_HORIZON_MONTHS|crmRelationshipHorizonStart|\bissuedFrom\b/,
    roles: REPORT_RUNTIME,
  },
  {
    id: "WRITE_OR_PERSISTENT_CACHE",
    description: "Relatório é somente leitura — sem escrita, transação ou cache persistente.",
    pattern:
      /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$transaction|writeFile|appendFile|INSERT\s+INTO|UPDATE\s+"|TRUNCATE/,
    roles: ALL,
  },
  {
    id: "PURE_MODULE_IMPORT",
    description: "Motor, núcleo e tipos são puros: sem Prisma, Express ou React.",
    pattern: /from\s+["'](?:@prisma\/client|express|react)["']|@\/src\/lib\/prisma(?:\.js)?["']|\.server(?:\.js)?["']/,
    roles: PURE,
  },
  {
    id: "ACTIVITY_IN_CALCULATION",
    description: "CommercialActivity é só enriquecimento — não entra no motor nem no núcleo.",
    pattern: /commercialActivity|CommercialActivity|nextActionAt|contactDate/,
    roles: ["engine", "core", "aggregation"],
  },
  {
    id: "PARALLEL_ORDER_QUERY",
    description:
      "Personalizado/exportação não consultam pedido por conta própria: consomem runCrmReportsAnalysis (mesmo escopo, filtros e população canônica).",
    pattern:
      /\.findSalesOrders\s*\(|crmCanonicalSalesOrderWhere\s*\(|buildSalesOrderListWhere\s*\(|\.salesOrder\.(?:findMany|findFirst|groupBy|aggregate|count)\b|\.groupOrderSellers\s*\(/,
    roles: ["consumer"],
  },
];

/** Presenças obrigatórias: o serviço PRECISA consumir os canônicos. */
export const CRM_REPORTS_GUARD_REQUIRED: ReadonlyArray<{
  id: string;
  role: CrmReportsGuardRole;
  pattern: RegExp;
  description: string;
}> = [
  {
    id: "USES_CANONICAL_SALES_ORDER_WHERE",
    role: "service",
    pattern: /crmCanonicalSalesOrderWhere\(/,
    description: "Universo de pedido vem de crmCanonicalSalesOrderWhere().",
  },
  {
    id: "USES_PORTFOLIO_OWNER_SCOPE",
    role: "service",
    pattern: /resolveCrmCustomerListSellerScopeFilter\(/,
    description: "Carteira resolvida pelo escopo de Responsável Comercial.",
  },
  {
    id: "USES_MANUAL_OWNER_IDS",
    role: "service",
    pattern: /fetchCrmManualOwnerCustomerIds\(/,
    description: "IDs da carteira vêm de CrmCustomerCommercialOwner.",
  },
  {
    id: "USES_REPURCHASE_ENGINE",
    role: "core",
    pattern: /computeRepurchaseCadence\(/,
    description: "Cadência sai do motor canônico.",
  },
  {
    id: "CONSUMER_USES_REPORT_PIPELINE",
    role: "consumer",
    pattern: /runCrmReportsAnalysis\(|runCrmCustomReport\(/,
    description: "Personalizado/exportação saem do MESMO pipeline das listas (runCrmReportsAnalysis).",
  },
  {
    id: "ROUTE_USES_CRM_SCOPE",
    role: "routes",
    pattern: /requireCrmCommercialDataScope\(/,
    description: "Rota aplica o escopo comercial do CRM.",
  },
  {
    id: "VERIFIER_USES_OFFICIAL_BUILDER",
    role: "verifier",
    pattern: /buildSalesOrderListWhere\(/,
    description: "Verificador lê o lado oficial pelo construtor de Pedidos de Venda.",
  },
  {
    id: "VERIFIER_USES_REPORT_PIPELINE",
    role: "verifier",
    pattern: /runCrmReportsAnalysis\(/,
    description: "Verificador lê o lado relatório pelo pipeline do endpoint.",
  },
  {
    id: "VERIFIER_CLI_DELEGATES",
    role: "verifier-cli",
    pattern: /verifyCrmReportsAgainstSalesOrders\(/,
    description: "CLI do verificador delega à conferência testada.",
  },
];

/**
 * Remove comentários preservando strings (o que está entre aspas continua
 * sendo varrido — um literal 'CANCELLED' é exatamente o que o guard procura).
 * Mantém as quebras de linha para reportar a linha certa.
 */
export function stripCrmReportsComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < source.length) {
        out += source[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function scanCrmReportsSources(files: readonly CrmReportsGuardFile[]): CrmReportsGuardViolation[] {
  const violations: CrmReportsGuardViolation[] = [];
  for (const file of files) {
    const lines = stripCrmReportsComments(file.source).split("\n");
    for (const rule of CRM_REPORTS_GUARD_RULES) {
      if (!rule.roles.includes(file.role)) continue;
      lines.forEach((text, index) => {
        if (rule.pattern.test(text)) {
          violations.push({
            path: file.path,
            rule: rule.id,
            description: rule.description,
            line: index + 1,
            excerpt: text.trim().slice(0, 160),
          });
        }
      });
    }
  }
  for (const required of CRM_REPORTS_GUARD_REQUIRED) {
    const owners = files.filter((file) => file.role === required.role);
    for (const file of owners) {
      if (!required.pattern.test(stripCrmReportsComments(file.source))) {
        violations.push({
          path: file.path,
          rule: required.id,
          description: `Obrigatório: ${required.description}`,
          line: 0,
          excerpt: "",
        });
      }
    }
  }
  return violations;
}

/** Arquivos protegidos (caminhos relativos à raiz do repositório). */
export const CRM_REPORTS_GUARDED_FILES: ReadonlyArray<{ path: string; role: CrmReportsGuardRole }> = [
  { path: "src/lib/commercial/crmReportsTypes.ts", role: "types" },
  { path: "src/lib/commercial/crmRepurchaseEngine.ts", role: "engine" },
  { path: "src/lib/commercial/crmReportsOperationalCore.ts", role: "core" },
  { path: "src/lib/commercial/crmCustomReportCore.ts", role: "aggregation" },
  { path: "src/lib/commercial/crmReportsOperationalService.server.ts", role: "service" },
  { path: "src/lib/commercial/crmCustomReportService.server.ts", role: "consumer" },
  { path: "src/lib/commercial/crmReportsRoutes.ts", role: "routes" },
  { path: "src/lib/commercial/crmReportsVerification.server.ts", role: "verifier" },
  { path: "scripts/verify-crm-reports-vs-sales-orders.ts", role: "verifier-cli" },
];
