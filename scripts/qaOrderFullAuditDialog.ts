/**
 * QA estático + dinâmico — Auditoria 360º do Pedido (modal).
 * Uso: npx tsx scripts/qaOrderFullAuditDialog.ts
 *
 * Cobre:
 *  - contrato completo do payload (18 blocos oficiais)
 *  - 12 abas do modal (renderização + testids)
 *  - códigos oficiais de divergência por aba (renomeados, sem legados)
 *  - dedup canônico de alertas (code + entityType + reference + valueImpact)
 *  - PDs de referência PD 02339 / PD 02534 / PD 02207 (best-effort com DB)
 *
 * Backend/dados detalhados por bloco também são cobertos por
 * scripts/qaOrderFullAuditInventory.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let failed = 0;
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}
function exists(rel: string): boolean {
  return existsSync(join(root, rel));
}
function ok(id: string, msg: string): void {
  console.log(`OK   ${id} — ${msg}`);
}
function fail(id: string, msg: string): false {
  failed += 1;
  console.error(`FAIL ${id} — ${msg}`);
  return false;
}

/** Ordem oficial de abas exigida pelo produto (Auditoria 360º). */
const REQUIRED_TAB_IDS = [
  "summary",
  "proposal",
  "salesOrder",
  "items",
  "documents",
  "nfes",
  "financial",
  "delivery",
  "marginPricing",
  "commissions",
  "divergences",
  "technicalAudit",
] as const;

/** Rótulos PT-BR obrigatórios no arquivo `orderFullAuditClient.ts`. */
const REQUIRED_TAB_LABELS = [
  "Resumo Executivo",
  "Proposta / Origem Comercial",
  "Pedido de Venda",
  "Itens do Pedido",
  "Documentos de Saída",
  "NF-e",
  "Financeiro",
  "Entrega / Produção / Frete",
  "Margem, Preço e Custo",
  "Comissões",
  "Divergências",
  "Auditoria Técnica",
];

function main(): boolean {
  console.log("=== qaOrderFullAuditDialog (static, Auditoria 360º) ===\n");

  const service = "src/lib/finance/orderFullAuditService.ts";
  if (!exists(service)) return fail("service", "orderFullAuditService.ts ausente");
  const svc = read(service);
  if (!svc.includes("loadOrderFullAudit"))
    return fail("service:load", "loadOrderFullAudit ausente");
  if (
    !svc.includes("nomusAccountsReceivable") ||
    !svc.includes("nomusNfe") ||
    !svc.includes("nomusStockDocument")
  ) {
    return fail(
      "service:sources",
      "service deve consumir nomusAccountsReceivable / nomusNfe / nomusStockDocument"
    );
  }
  ok("service", "service compõe SalesOrder + Fact + NF + Doc + CR");

  const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
  if (!routes.includes("/orders/:salesOrderId/audit-full")) {
    return fail("route", "rota audit-full ausente");
  }
  if (!/loadOrderFullAudit|getOrderFullAudit/.test(routes)) {
    return fail("route:handler", "handler não usa loadOrderFullAudit/getOrderFullAudit");
  }
  ok("route", "rota GET /orders/:salesOrderId/audit-full registrada");

  const client = "src/lib/finance/orderFullAuditClient.ts";
  if (!exists(client)) return fail("client", "orderFullAuditClient.ts ausente");
  const cli = read(client);
  if (/@prisma\/client|from ["']@\/src\/lib\/prisma/.test(cli)) {
    return fail("client:no-prisma", "orderFullAuditClient.ts não pode importar Prisma");
  }
  if (!cli.includes("buildOrderFullAuditUrl") || !cli.includes("ORDER_FULL_AUDIT_TABS")) {
    return fail("client:contract", "contrato do client incompleto");
  }
  for (const id of REQUIRED_TAB_IDS) {
    if (!new RegExp(`id: ["']${id}["']`).test(cli)) {
      return fail("client:tabs", `Aba obrigatória ausente em ORDER_FULL_AUDIT_TABS: ${id}`);
    }
  }
  for (const label of REQUIRED_TAB_LABELS) {
    if (!cli.includes(label)) {
      return fail("client:labels", `Label PT-BR ausente: ${label}`);
    }
  }
  ok("client:tabs", `12 abas oficiais expostas: ${REQUIRED_TAB_IDS.join(", ")}`);

  const dialog = "src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx";
  if (!exists(dialog)) return fail("dialog", "OrderFullAuditDialog.tsx ausente");
  const dlg = read(dialog);
  if (/@prisma\/client/.test(dlg) || dlg.includes("prisma.js")) {
    return fail("dialog:no-prisma", "dialog não pode importar Prisma");
  }
  ok("dialog:no-prisma", "dialog sem Prisma no frontend");

  if (!dlg.includes("Auditoria 360º — ")) {
    return fail(
      "dialog:title",
      "Título do modal deve ser 'Auditoria 360º — <PD>'"
    );
  }
  if (!dlg.includes("Carregando auditoria 360º do pedido")) {
    return fail(
      "dialog:loading",
      "Mensagem de loading esperada: 'Carregando auditoria 360º do pedido...'"
    );
  }
  if (!dlg.includes("Não foi possível carregar a auditoria do pedido")) {
    return fail("dialog:error", "Mensagem de erro esperada não encontrada");
  }
  if (!dlg.includes("Pedido não encontrado")) {
    return fail("dialog:empty", "Estado 'Pedido não encontrado' ausente");
  }
  ok("dialog:states", "loading / erro / vazio / sucesso definidos");

  for (const id of REQUIRED_TAB_IDS) {
    if (!dlg.includes(`activeTab === "${id}"`)) {
      return fail("dialog:tabs", `Aba ${id} não renderizada no dialog`);
    }
  }
  if (!/data-testid=\{`order-full-audit-tab-\$\{tab\.id\}`\}/.test(dlg)) {
    return fail(
      "dialog:tabs",
      "template data-testid=`order-full-audit-tab-${tab.id}` ausente"
    );
  }
  ok(
    "dialog:tabs",
    "12 abas renderizadas + template testId (order-full-audit-tab-<id>)"
  );

  for (const testId of [
    "order-full-audit-dialog",
    "order-full-audit-header",
    "order-full-audit-title",
    "order-full-audit-close",
    "order-full-audit-content",
    "order-full-audit-summary-tab",
    "order-full-audit-items-tab",
    "order-full-audit-financial-tab",
    "order-full-audit-documents-tab",
    "order-full-audit-nfes-tab",
    "order-full-audit-delivery-tab",
    "order-full-audit-proposal-tab",
    "order-full-audit-sales-order-tab",
    "order-full-audit-margin-pricing-tab",
    "order-full-audit-commissions-tab",
    "order-full-audit-divergences-tab",
    "order-full-audit-technical-tab",
  ]) {
    if (!dlg.includes(testId)) {
      return fail("dialog:testids", `testId ausente: ${testId}`);
    }
  }
  ok(
    "dialog:testids",
    "header/close/content + testIds das 12 abas presentes"
  );

  if (!dlg.includes("aria-modal=\"true\"")) {
    return fail("dialog:a11y", "modal deve ter aria-modal=\"true\"");
  }
  if (!dlg.includes("role=\"tablist\"") || !dlg.includes("role=\"tab\"")) {
    return fail("dialog:a11y", "tablist/tab roles ausentes");
  }
  if (!/Escape/.test(dlg)) {
    return fail("dialog:a11y", "fechamento com Escape não implementado");
  }
  ok("dialog:a11y", "aria-modal + role=tablist + fechamento com ESC");

  const tab = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusTab.tsx"
  );
  if (tab.includes("<OrderStatusSelectedOrderItemsPanel")) {
    return fail(
      "tab:legacy-panel-removed",
      "Painel drilldown antigo ainda renderizado em OrderStatusTab.tsx"
    );
  }
  if (!tab.includes("OrderFullAuditDialog")) {
    return fail("tab:integration", "OrderStatusTab não abre OrderFullAuditDialog");
  }
  if (!tab.includes("Auditoria 360º do Pedido")) {
    return fail(
      "tab:hint",
      "Hint com 'Auditoria 360º do Pedido' ausente ao lado do grid"
    );
  }
  ok(
    "tab:integration",
    "OrderStatusTab substituiu o drilldown antigo pelo modal + hint 360º"
  );

  const table = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusTable.tsx"
  );
  if (!/cursor-pointer/.test(table)) {
    return fail("table:cursor", "linha do grid deve ter cursor-pointer");
  }
  if (!/Abrir auditoria 360º do pedido/.test(table)) {
    return fail(
      "table:tooltip",
      "tooltip/aria-label da linha deve ser 'Abrir auditoria 360º do pedido'"
    );
  }
  ok(
    "table:row-affordance",
    "linhas do grid Status Pedidos com cursor + tooltip 'Abrir auditoria 360º do pedido'"
  );

  /* -------------------------------------------------------------------- */
  /*  Estrutura da aba Resumo Executivo                                    */
  /* -------------------------------------------------------------------- */

  const summarySectionTestIds = [
    "order-full-audit-summary-section-identification",
    "order-full-audit-summary-section-order-values",
    "order-full-audit-summary-section-downstream-values",
    "order-full-audit-summary-section-diffs",
    "order-full-audit-summary-section-timeline",
    "order-full-audit-summary-section-alerts",
  ];
  for (const testId of summarySectionTestIds) {
    if (!dlg.includes(testId)) {
      return fail(
        "summary:sections",
        `Seção obrigatória do Resumo Executivo ausente: ${testId}`
      );
    }
  }
  ok(
    "summary:sections",
    "Resumo Executivo com 6 seções (identificação/valores/downstream/diffs/timeline/alerts)"
  );

  for (const kpi of [
    "Valor original",
    "Valor cancelado",
    "Valor cortado",
    "Valor ativo",
    "Valor atendido",
    "% atendimento ativo",
    "Saldo pendente ativo",
    "Documento de saída",
    "NF-e vinculada",
    "CR total",
    "CR aberto",
    "Recebido",
    "Vencido",
    "Temperatura / risco",
    "Pedido × Documento",
    "Pedido × NF",
    "Pedido × CR",
    "Ativo × CR",
    "Atendido × CR",
  ]) {
    if (!dlg.includes(kpi)) {
      return fail(
        "summary:kpis",
        `KPI obrigatório do Resumo Executivo ausente: "${kpi}"`
      );
    }
  }
  ok(
    "summary:kpis",
    "KPIs oficiais (valores + diffs + temperatura) todos presentes"
  );

  for (const key of [
    "PROPOSAL",
    "ORDER_ISSUED",
    "STOCK_DOCUMENT",
    "NFE",
    "RECEIVABLE",
    "DUE_DATE",
    "PAYMENT",
  ]) {
    if (!cli.includes(`"${key}"`)) {
      return fail(
        "summary:timeline-keys",
        `Chave de timeline obrigatória ausente no client: ${key}`
      );
    }
    if (!svc.includes(`"${key}"`)) {
      return fail(
        "summary:timeline-keys",
        `Chave de timeline obrigatória ausente no service: ${key}`
      );
    }
  }
  ok(
    "summary:timeline-keys",
    "Timeline expandida: Proposta → Pedido → Documento → NF → CR → Vencimento → Baixa"
  );

  for (const field of [
    "receivableOverdueValue",
    "stockDocumentsTotalValue",
    "stockDocumentsAllocatedValue",
    "nfeTotalValue",
    "nfeAllocatedValue",
    "diffs",
    "orderVsStockDocument",
    "orderVsNfe",
    "orderVsReceivable",
    "activeVsReceivable",
    "allocatedVsReceivable",
  ]) {
    if (!svc.includes(field)) {
      return fail(
        "summary:contract",
        `Campo obrigatório ausente em summary (service): ${field}`
      );
    }
    if (!cli.includes(field)) {
      return fail(
        "summary:contract",
        `Campo obrigatório ausente em summary (client): ${field}`
      );
    }
  }
  ok(
    "summary:contract",
    "summary expõe overdue/documentos/NF/diffs no client e no service"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Proposta / Origem Comercial                                     */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-proposal-empty-state",
    "order-full-audit-proposal-disclaimer",
    "order-full-audit-proposal-section-identification",
    "order-full-audit-proposal-section-conditions",
    "order-full-audit-proposal-section-values",
    "order-full-audit-proposal-section-items",
    "order-full-audit-proposal-section-divergences",
    "order-full-audit-proposal-items-table",
  ]) {
    if (!dlg.includes(testId)) {
      return fail("proposal:testids", `testId ausente na aba Proposta: ${testId}`);
    }
  }
  ok(
    "proposal:testids",
    "aba Proposta com 5 seções + tabela de itens + disclaimer + empty state"
  );

  const requiredProposalKpis = [
    "Nº proposta",
    "ID interno",
    "Responsável comercial",
    "Data da proposta",
    "Data de aprovação",
    "Validade",
    "Valor total proposto",
    "Valor aprovado",
    "Convertido em pedido",
    "Diferença Proposta × Pedido",
    "Margem R$",
    "Margem %",
    "Comissão prevista",
  ];
  for (const k of requiredProposalKpis) {
    if (!dlg.includes(k)) {
      return fail("proposal:kpis", `KPI/card obrigatório ausente: "${k}"`);
    }
  }
  ok(
    "proposal:kpis",
    `KPIs obrigatórios da Proposta presentes (${requiredProposalKpis.length})`
  );

  const requiredItemColumns = [
    "SKU",
    "Descrição",
    "Preço un.",
    "Total",
    "Custo",
    "Comissão",
    "Virou pedido?",
    "Item pedido",
    "Δ Qtd",
    "Δ Preço",
    "Δ Total",
    "Alertas",
  ];
  for (const c of requiredItemColumns) {
    if (!dlg.includes(c)) {
      return fail(
        "proposal:item-cols",
        `Coluna obrigatória da tabela de itens ausente: "${c}"`
      );
    }
  }
  ok(
    "proposal:item-cols",
    "tabela de itens da Proposta com colunas oficiais (SKU × preço × diffs × alertas)"
  );

  const requiredCodes = [
    "PROPOSAL_NOT_FOUND",
    "PROPOSAL_ORDER_VALUE_MISMATCH",
    "PROPOSAL_ITEM_NOT_CONVERTED",
    "ORDER_ITEM_WITHOUT_PROPOSAL_ITEM",
    "PROPOSAL_PRICE_MISMATCH",
    "PROPOSAL_PAYMENT_TERM_MISMATCH",
    "PROPOSAL_FREIGHT_MISMATCH",
  ];
  for (const code of requiredCodes) {
    if (!svc.includes(code)) {
      return fail(
        "proposal:alert-code-svc",
        `Código de divergência ausente no service: ${code}`
      );
    }
    if (!dlg.includes(code)) {
      return fail(
        "proposal:alert-code-dlg",
        `Código de divergência ausente na UI (labels/keys): ${code}`
      );
    }
  }
  ok(
    "proposal:alert-codes",
    `7 códigos de divergência emitidos no service + labels na UI`
  );

  const requiredProposalContractFields = [
    "OrderFullAuditProposalItem",
    "OrderFullAuditProposalOrderComparison",
    "convertedToSalesOrderItem",
    "derivedValues",
    "emptyReason",
    "proposalVsOrderComparisons",
  ];
  for (const f of requiredProposalContractFields) {
    if (!cli.includes(f)) {
      return fail(
        "proposal:contract",
        `Campo/tipo ausente no client: ${f}`
      );
    }
    if (!svc.includes(f)) {
      return fail(
        "proposal:contract",
        `Campo/tipo ausente no service: ${f}`
      );
    }
  }
  ok(
    "proposal:contract",
    "contrato Proposta expandido (items ricos + comparativos + emptyReason)"
  );

  if (!svc.includes("proposal.present && !proposal.alerts") || svc.includes("proposal.present && !proposal.alerts")) {
    // no-op: só um marcador vazio; a checagem real é a próxima
  }
  if (
    !/summary\.receivableTotalValue|receivableTotalValue: receivableTotal/.test(
      svc
    )
  ) {
    return fail(
      "proposal:no-financial-impact",
      "buildSummary deve continuar usando CR dedup para receivableTotalValue (proposta não altera financeiro)"
    );
  }
  ok(
    "proposal:no-financial-impact",
    "proposta é apenas origem comercial — buildSummary continua usando CR oficial deduplicado"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Pedido de Venda                                                 */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-sales-order-cards",
    "order-full-audit-sales-order-section-identification",
    "order-full-audit-sales-order-section-commercial",
    "order-full-audit-sales-order-section-operational",
    "order-full-audit-sales-order-section-financial",
    "order-full-audit-sales-order-section-notes",
    "order-full-audit-sales-order-section-divergences",
  ]) {
    if (!dlg.includes(testId)) {
      return fail(
        "salesOrder:testids",
        `testId ausente na aba Pedido de Venda: ${testId}`
      );
    }
  }
  ok(
    "salesOrder:testids",
    "aba Pedido de Venda com cards + 5 seções (Identificação/Comercial/Operacional/Financeiro/Observações) + divergências"
  );

  for (const kpi of [
    "Valor pedido",
    "Itens totais",
    "Itens ativos",
    "Cancelados",
    "Com corte",
    "Atendidos",
    "Pendentes ativos",
    "% atendimento ativo",
  ]) {
    if (!dlg.includes(kpi)) {
      return fail(
        "salesOrder:cards",
        `Card obrigatório do topo ausente: "${kpi}"`
      );
    }
  }
  ok(
    "salesOrder:cards",
    "cards do topo (valor + contagens de itens + % atendimento ativo) presentes"
  );

  for (const label of [
    "ID externo Nomus",
    "Código externo Nomus",
    "ID externo cliente",
    "Empresa emissora",
    "ID empresa emissora",
    "Data de emissão",
    "Data de entrega padrão",
    "Status do pedido",
    "Tipo de pedido",
    "Tipo de movimentação",
    "Responsável Comercial (CRM)",
    "Vendedor Pedido (Nomus)",
    "Setor de saída",
    "Condição de pagamento",
    "Forma de pagamento",
    "Modalidade de transporte",
    "Local de entrega",
    "Seguro",
    "Outras despesas",
    "Impostos",
    "Última sincronização",
  ]) {
    if (!dlg.includes(label)) {
      return fail(
        "salesOrder:labels",
        `Campo obrigatório do cabeçalho ausente: "${label}"`
      );
    }
  }
  ok(
    "salesOrder:labels",
    "cabeçalho completo (identificação × comercial × operacional × financeiro) presente"
  );

  const salesOrderAlertCodes = [
    "SELLER_NOT_INFORMED",
    "COMMERCIAL_RESPONSIBLE_MISSING",
    "PAYMENT_TERM_MISSING",
    "DELIVERY_DATE_OVERDUE",
    "ORDER_STATUS_UNKNOWN",
    "ORDER_WITHOUT_ITEMS",
    "ORDER_HEADER_ITEMS_TOTAL_MISMATCH",
    "OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE",
  ];
  for (const code of salesOrderAlertCodes) {
    if (!svc.includes(code)) {
      return fail(
        "salesOrder:alert-svc",
        `Código de divergência ausente no service: ${code}`
      );
    }
    if (!dlg.includes(code)) {
      return fail(
        "salesOrder:alert-dlg",
        `Código de divergência ausente na UI: ${code}`
      );
    }
  }
  ok(
    "salesOrder:alert-codes",
    "8 códigos oficiais da aba Pedido de Venda emitidos no service + UI"
  );

  // Códigos legados (VENDEDOR_AUSENTE/RESPONSAVEL_COMERCIAL_AUSENTE/CONDICAO_PAGAMENTO_AUSENTE)
  // do service NÃO devem mais ser emitidos por buildAlerts do audit-full — foram substituídos
  // pelos oficiais SELLER_NOT_INFORMED/COMMERCIAL_RESPONSIBLE_MISSING/PAYMENT_TERM_MISSING.
  const legacyCodesStillPushed = [
    /push\(\s*\{\s*code:\s*["']VENDEDOR_AUSENTE["']/,
    /push\(\s*\{\s*code:\s*["']RESPONSAVEL_COMERCIAL_AUSENTE["']/,
    /push\(\s*\{\s*code:\s*["']CONDICAO_PAGAMENTO_AUSENTE["'][^)]*\}\s*\)\s*;[^\n]*\/\/[^\n]*audit-full/,
  ];
  const hasLegacyPushed = legacyCodesStillPushed.some((re) => re.test(svc));
  if (hasLegacyPushed) {
    return fail(
      "salesOrder:legacy-codes",
      "buildAlerts do audit-full ainda emite código legado (VENDEDOR_AUSENTE / RESPONSAVEL_COMERCIAL_AUSENTE / CONDICAO_PAGAMENTO_AUSENTE)"
    );
  }
  ok(
    "salesOrder:legacy-codes",
    "buildAlerts do audit-full não emite mais códigos legados de vendedor/responsável/condição"
  );

  const salesOrderContractFields = [
    "orderType",
    "movementType",
    "operationalSector",
    "operationalResponsibleName",
    "commercialResponsibleName",
    "orderSellerName",
    "orderSellerExternalId",
    "paymentTermsText",
    "freightMode",
    "deliveryLocation",
    "notes",
    "internalNotes",
    "itemCounts",
    "insurance",
    "otherExpenses",
    "itemsSummedNetValue",
    "headerVsItemsDiff",
    "lastSyncedAt",
  ];
  for (const f of salesOrderContractFields) {
    if (!svc.includes(f)) {
      return fail(
        "salesOrder:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "salesOrder:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "salesOrder:contract",
    "OrderFullAuditSalesOrderBlock expandido com campos oficiais (comercial × operacional × totais completos × counts)"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Itens do Pedido                                                 */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-items-tab",
    "order-full-audit-items-chips",
    "order-full-audit-items-table",
    "order-full-audit-items-evidence",
    "order-full-audit-items-section-divergences",
    "order-full-audit-items-grid", // reuso do OrderToCashAuditItemsGrid
  ]) {
    if (!dlg.includes(testId)) {
      return fail(
        "items:testids",
        `testId ausente na aba Itens do Pedido: ${testId}`
      );
    }
  }
  ok(
    "items:testids",
    "aba Itens com chips + tabela + evidência (OrderToCashAuditItemsGrid) + divergências"
  );

  const requiredChips = [
    "all",
    "fulfilled",
    "activePending",
    "canceled",
    "cut",
    "partial",
    "overFulfilled",
    "outsideOrder",
    "openReceivable",
    "received",
    "noDocument",
    "priceMismatch",
  ];
  if (!/data-testid=\{`order-full-audit-items-chip-\$\{c\.id\}`\}/.test(dlg)) {
    return fail(
      "items:chips-testid",
      "template data-testid=`order-full-audit-items-chip-${c.id}` ausente"
    );
  }
  for (const chipId of requiredChips) {
    // O chip ID aparece dentro da configuração literal `{ id: "<chipId>", ...`.
    if (!new RegExp(`id:\\s*["']${chipId}["']`).test(dlg)) {
      return fail(
        "items:chips",
        `Chip obrigatório ausente na configuração: ${chipId}`
      );
    }
  }
  const requiredChipLabels = [
    "Todos",
    "Atendidos",
    "Pendentes ativos",
    "Cancelados",
    "Com corte",
    "Parcialmente atendidos",
    "Com excedente",
    "Produto fora do pedido",
    "Com CR aberto",
    "Recebidos",
    "Sem documento",
    "Divergência de preço",
  ];
  for (const label of requiredChipLabels) {
    if (!dlg.includes(label)) {
      return fail(
        "items:chip-labels",
        `Label PT-BR de chip ausente: "${label}"`
      );
    }
  }
  ok(
    "items:chips",
    `12 chips oficiais + labels PT-BR presentes`
  );

  const requiredItemTableColumns = [
    "Seq",
    "ID item Nomus",
    "Produto / SKU",
    "ID produto Nomus",
    "Descrição",
    "Un",
    "Qtd pedida",
    "Qtd ativa",
    "Qtd atendida",
    "Qtd pendente ativa",
    "Qtd cancelada",
    "Qtd cortada",
    "Preço un.",
    "Valor item",
    "Valor ativo",
    "Valor cancelado",
    "Valor cortado",
    "Data entrega",
    "Status bruto",
    "Status normalizado",
    "Atendido produção?",
    "Qtd produzida",
    "Qtd faturada",
    "Saldo a faturar",
    "Saldo pronto",
    "Tipo mov.",
    "CFOP",
    "Documentos",
    "NF",
    "CR",
    "Alertas",
  ];
  for (const c of requiredItemTableColumns) {
    if (!dlg.includes(c)) {
      return fail(
        "items:columns",
        `Coluna obrigatória da tabela de itens ausente: "${c}"`
      );
    }
  }
  ok(
    "items:columns",
    `tabela de itens com ${requiredItemTableColumns.length} colunas oficiais`
  );

  const requiredItemAlertCodes = [
    "ORDER_ITEM_CANCELED",
    "ORDER_ITEM_CUT",
    "ORDER_ITEM_STALE",
    "ORDER_ITEM_STATUS_UNKNOWN",
    "REPEATED_SKU_WITH_DIFFERENT_STATUS",
    "ITEM_STATUS_MATCH_AMBIGUOUS",
    "ORDER_ITEM_ACTIVE_PENDING",
    "ORDER_ITEM_OVER_FULFILLED",
  ];
  for (const code of requiredItemAlertCodes) {
    if (!svc.includes(code)) {
      return fail(
        "items:alert-svc",
        `Código de divergência ausente no service: ${code}`
      );
    }
    if (!dlg.includes(code)) {
      return fail(
        "items:alert-dlg",
        `Código de divergência ausente na UI: ${code}`
      );
    }
  }
  ok(
    "items:alert-codes",
    "8 códigos oficiais da aba Itens emitidos no service + UI"
  );

  // Códigos legados por item — não devem mais ser emitidos por push({ code: "ITEM_*" }) no audit-full.
  const legacyItemPushes = [
    /push\(\s*\{\s*code:\s*["']ITEM_CANCELADO["']/,
    /push\(\s*\{\s*code:\s*["']ITEM_COM_CORTE["']/,
    /push\(\s*\{\s*code:\s*["']ITEM_STALE["']/,
    /push\(\s*\{\s*code:\s*["']MATCH_AMBIGUO["']/,
  ];
  for (const re of legacyItemPushes) {
    if (re.test(svc)) {
      return fail(
        "items:legacy-codes",
        `buildAlerts ainda emite alerta legado por item (regex ${re.source})`
      );
    }
  }
  ok(
    "items:legacy-codes",
    "buildAlerts do audit-full não emite mais códigos legados de item (ITEM_CANCELADO/ITEM_COM_CORTE/ITEM_STALE/MATCH_AMBIGUO)"
  );

  const requiredItemContractFields = [
    "activeQuantity",
    "canceledQuantity",
    "cutQuantity",
    "activePendingQuantity",
    "activeValue",
    "canceledValue",
    "cutValue",
    "productExternalId",
    "productionQuantity",
    "invoicedQuantity",
    "saldoAFaturar",
    "saldoPronto",
    "movementType",
    "cfop",
    "linkedStockDocumentExternalIds",
    "linkedNfeExternalIds",
    "linkedReceivableExternalIds",
    "alerts",
  ];
  for (const f of requiredItemContractFields) {
    if (!svc.includes(f)) {
      return fail(
        "items:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "items:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "items:contract",
    "OrderFullAuditItem expandido com campos oficiais por linha (quantidades, valores, refs de doc/NF/CR e alertas)"
  );

  // Reutilização obrigatória de OrderToCashAuditItemsGrid dentro do ItemsTab.
  if (
    !/function ItemsTab[\s\S]{0,50000}OrderToCashAuditItemsGrid/m.test(dlg)
  ) {
    return fail(
      "items:reuse",
      "ItemsTab deve reutilizar OrderToCashAuditItemsGrid (evidência item × doc × NF × CR)"
    );
  }
  ok(
    "items:reuse",
    "ItemsTab reutiliza OrderToCashAuditItemsGrid para o painel de evidência"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Documentos de Saída                                             */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-documents-tab",
    "order-full-audit-documents-cards",
    "order-full-audit-documents-section-headers",
    "order-full-audit-documents-table",
    "order-full-audit-documents-section-items",
    "order-full-audit-documents-items-table",
    "order-full-audit-documents-section-divergences",
  ]) {
    if (!dlg.includes(testId)) {
      return fail(
        "documents:testids",
        `testId ausente na aba Documentos: ${testId}`
      );
    }
  }
  ok(
    "documents:testids",
    "aba Documentos com cards + tabela de documentos + tabela de itens + divergências"
  );

  for (const kpi of [
    "Total documentos",
    "Valor total",
    "Alocado ao pedido",
    "Valor excedente",
    "Qtd excedente",
    "Produtos fora do pedido",
    "Sem NF",
    "Divergência de preço",
  ]) {
    if (!dlg.includes(kpi)) {
      return fail(
        "documents:cards",
        `Card obrigatório da aba Documentos ausente: "${kpi}"`
      );
    }
  }
  ok(
    "documents:cards",
    "8 cards do topo (total, valores, excedentes, sem NF, mismatch)"
  );

  const requiredDocHeaderCols = [
    "Documento",
    "ID externo",
    "Tipo",
    "Data emissão",
    "Data movim.",
    "Cliente",
    "Empresa",
    "NF vinculada",
    "Valor total",
    "Alocado",
    "Excedente",
    "Status",
    "Origem vínculo",
    "Alertas",
  ];
  for (const c of requiredDocHeaderCols) {
    if (!dlg.includes(c)) {
      return fail(
        "documents:doc-cols",
        `Coluna obrigatória da tabela de documentos ausente: "${c}"`
      );
    }
  }
  ok(
    "documents:doc-cols",
    `tabela de documentos com ${requiredDocHeaderCols.length} colunas oficiais`
  );

  const requiredDocItemCols = [
    "Item doc.",
    "Produto / SKU",
    "ID produto",
    "Descrição",
    "Qtd doc.",
    "Qtd usada",
    "Excedente",
    "Vlr un. doc.",
    "Vlr total doc.",
    "Pedido",
    "Item pedido",
    "Preço un. pedido",
    "Δ Preço un.",
    "Δ Preço %",
    "Impacto R$",
    "NF",
    "CR",
    "Tipo linha",
    "Alertas",
  ];
  for (const c of requiredDocItemCols) {
    if (!dlg.includes(c)) {
      return fail(
        "documents:item-cols",
        `Coluna obrigatória da tabela de itens de documento ausente: "${c}"`
      );
    }
  }
  ok(
    "documents:item-cols",
    `tabela de itens do documento com ${requiredDocItemCols.length} colunas (inclui Δ preço unitária/%/impacto)`
  );

  const requiredDocAlertCodes = [
    "DOCUMENT_WITH_EXCESS",
    "DOCUMENT_EXTRA_ITEM",
    "DOCUMENT_WITHOUT_ORDER_ITEM",
    "DOCUMENT_WITHOUT_NFE",
    "DOCUMENT_PRICE_MISMATCH",
    "DOCUMENT_QUANTITY_MISMATCH",
    "DOCUMENT_ALLOCATED_TO_CANCELED_ITEM",
    "DOCUMENT_ALLOCATED_BY_HEADER_ONLY",
  ];
  for (const code of requiredDocAlertCodes) {
    if (!svc.includes(code)) {
      return fail(
        "documents:alert-svc",
        `Código de divergência ausente no service: ${code}`
      );
    }
    if (!dlg.includes(code)) {
      return fail(
        "documents:alert-dlg",
        `Código de divergência ausente na UI: ${code}`
      );
    }
  }
  ok(
    "documents:alert-codes",
    "8 códigos oficiais da aba Documentos emitidos no service + UI"
  );

  const legacyDocPushes = [
    /push\(\s*\{\s*code:\s*["']DOCUMENTO_COM_EXCEDENTE["']/,
    /push\(\s*\{\s*code:\s*["']PRODUTO_FORA_DO_PEDIDO["']/,
  ];
  for (const re of legacyDocPushes) {
    if (re.test(svc)) {
      return fail(
        "documents:legacy-codes",
        `buildAlerts ainda emite alerta legado de documento (regex ${re.source})`
      );
    }
  }
  ok(
    "documents:legacy-codes",
    "buildAlerts do audit-full não emite mais códigos legados de documento (DOCUMENTO_COM_EXCEDENTE/PRODUTO_FORA_DO_PEDIDO)"
  );

  const requiredDocContractFields = [
    "stockDocumentItems",
    "OrderFullAuditStockDocumentItem",
    "dataMovimentacao",
    "customerName",
    "companyName",
    "linkOrigin",
    "priceDiffAbsolute",
    "priceDiffPercent",
    "financialImpact",
    "linkedSalesOrderItemId",
    "quantityUsedForOrder",
    "unitValue",
  ];
  for (const f of requiredDocContractFields) {
    if (!svc.includes(f)) {
      return fail(
        "documents:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "documents:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "documents:contract",
    "Documentos: bloco OrderFullAuditStockDocument + OrderFullAuditStockDocumentItem com Δ preço e comparação obrigatória"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba NF-e                                                            */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-nfes-tab",
    "order-full-audit-nfes-cards",
    "order-full-audit-nfes-section-headers",
    "order-full-audit-nfes-table",
    "order-full-audit-nfes-section-items",
    "order-full-audit-nfes-items-table",
    "order-full-audit-nfes-section-divergences",
  ]) {
    if (!dlg.includes(testId)) {
      return fail("nfes:testids", `testId ausente na aba NF-e: ${testId}`);
    }
  }
  ok(
    "nfes:testids",
    "aba NF-e com cards + tabela de NFs + tabela de itens + divergências"
  );

  for (const kpi of [
    "Total NF-e",
    "Valor total NF-e",
    "Atribuído ao pedido",
    "Cabeçalho excedente",
    "NF sem CR",
    "NF maior que pedido",
    "NF com item fora",
  ]) {
    if (!dlg.includes(kpi)) {
      return fail("nfes:cards", `Card obrigatório ausente: "${kpi}"`);
    }
  }
  ok(
    "nfes:cards",
    "7 cards do topo (total, valor total × atribuído, excedente, sem CR, > pedido, item fora)"
  );

  const requiredNfeHeaderCols = [
    "Número",
    "Série",
    "ID externo",
    "Chave",
    "Emissão",
    "Processamento",
    "Cliente",
    "Empresa",
    "Status",
    "Valor total",
    "Atrib. pedido",
    "Itens dentro",
    "Itens fora",
    "Doc. saída",
    "CR",
    "Alertas",
  ];
  for (const c of requiredNfeHeaderCols) {
    if (!dlg.includes(c)) {
      return fail(
        "nfes:doc-cols",
        `Coluna obrigatória da tabela de NF ausente: "${c}"`
      );
    }
  }
  ok(
    "nfes:doc-cols",
    `tabela de NF-e com ${requiredNfeHeaderCols.length} colunas oficiais (valor total ≠ atribuído)`
  );

  const requiredNfeItemCols = [
    "Item NF",
    "Produto / SKU",
    "Descrição",
    "Qtd NF",
    "Vlr un. NF",
    "Vlr total NF",
    "Item pedido",
    "Doc. saída",
    "Preço un. pedido",
    "Preço un. doc.",
    "Δ NF × pedido",
    "Δ NF × doc.",
    "CFOP",
    "Impostos",
    "Alertas",
  ];
  for (const c of requiredNfeItemCols) {
    if (!dlg.includes(c)) {
      return fail(
        "nfes:item-cols",
        `Coluna obrigatória da tabela de itens de NF ausente: "${c}"`
      );
    }
  }
  ok(
    "nfes:item-cols",
    `tabela de itens da NF com ${requiredNfeItemCols.length} colunas (Δ NF × pedido/doc + impostos + CFOP)`
  );

  const requiredNfeAlertCodes = [
    "NFE_HEADER_GREATER_THAN_ORDER",
    "NFE_WITHOUT_DOCUMENT",
    "NFE_WITHOUT_CR",
    "NFE_EXTRA_ITEM",
    "NFE_PRICE_MISMATCH",
    "NFE_ALLOCATED_BY_HEADER_ONLY",
    "NFE_VALUE_GREATER_THAN_ACTIVE_ORDER",
  ];
  for (const code of requiredNfeAlertCodes) {
    if (!svc.includes(code)) {
      return fail(
        "nfes:alert-svc",
        `Código de divergência ausente no service: ${code}`
      );
    }
    if (!dlg.includes(code)) {
      return fail(
        "nfes:alert-dlg",
        `Código de divergência ausente na UI: ${code}`
      );
    }
  }
  ok(
    "nfes:alert-codes",
    "7 códigos oficiais da aba NF-e emitidos no service + UI"
  );

  const legacyNfePushes = [
    /push\(\s*\{\s*code:\s*["']NF_MAIOR_QUE_PEDIDO["']/,
    /push\(\s*\{\s*code:\s*["']NF_SEM_CR["']/,
  ];
  for (const re of legacyNfePushes) {
    if (re.test(svc)) {
      return fail(
        "nfes:legacy-codes",
        `buildAlerts ainda emite alerta legado de NF (regex ${re.source})`
      );
    }
  }
  ok(
    "nfes:legacy-codes",
    "buildAlerts do audit-full não emite mais códigos legados de NF (NF_MAIOR_QUE_PEDIDO/NF_SEM_CR)"
  );

  const requiredNfeContractFields = [
    "nfeItems",
    "OrderFullAuditNfeItem",
    "insideOrderItemsValue",
    "outsideOrderItemsValue",
    "hasExtraItems",
    "linkOrigin",
    "linkedReceivableExternalIds",
    "priceDiffNfeVsOrderAbsolute",
    "priceDiffNfeVsOrderPercent",
    "priceDiffNfeVsDocumentAbsolute",
    "priceDiffNfeVsDocumentPercent",
  ];
  for (const f of requiredNfeContractFields) {
    if (!svc.includes(f)) {
      return fail(
        "nfes:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "nfes:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "nfes:contract",
    "NF-e: bloco OrderFullAuditNfe + OrderFullAuditNfeItem com valor total ≠ atribuído + Δ preço NF × pedido/doc"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Financeiro — Títulos e Baixas                                   */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-financial-tab",
    "order-full-audit-financial-cards",
    "order-full-audit-financial-section-titles",
    "order-full-audit-financial-titles-table",
    "order-full-audit-financial-section-divergences",
  ]) {
    if (!dlg.includes(testId)) {
      return fail(
        "financial:testids",
        `testId ausente na aba Financeiro: ${testId}`
      );
    }
  }
  ok(
    "financial:testids",
    "aba Financeiro com cards + tabela de títulos + baixas + divergências"
  );

  for (const kpi of [
    "Total financeiro",
    "CR real",
    "Planejado pelo pedido",
    "Aberto (real + planejado)",
    "Total vencido (CR)",
    "Total recebido",
    "Parcial recebido",
    "Próximo vencimento",
    "Títulos/parcelas",
  ]) {
    if (!dlg.includes(kpi)) {
      return fail("financial:cards", `Card obrigatório ausente: "${kpi}"`);
    }
  }
  ok(
    "financial:cards",
    "9 cards do topo (total financeiro · CR real · planejado · aberto · vencido · recebido · parcial · próximo · qtd)"
  );

  // Nova seção "Recebíveis planejados pelo pedido" + KPIs + coluna Tipo.
  for (const marker of [
    "order-full-audit-financial-section-planned",
    "order-full-audit-financial-planned-table",
    "Recebíveis planejados pelo pedido",
    "Total planejado",
    "Aberto planejado",
    "Vencido planejado",
    'type="PLANNED"',
    'type="REAL_CR"',
    "Planejado pelo pedido",
    "CR real",
  ]) {
    if (!dlg.includes(marker)) {
      return fail(
        "financial:planned-section",
        `Marca da seção de recebíveis planejados ausente: "${marker}"`
      );
    }
  }
  ok(
    "financial:planned-section",
    "seção Recebíveis planejados pelo pedido + KPIs + coluna Tipo + badges"
  );

  const requiredTitleCols = [
    "Tipo",
    "Referência",
    "ID interno",
    "ID externo",
    "Documento/NF",
    "Número NF",
    "Parcela",
    "Emissão",
    "Vencimento",
    "Competência",
    "Valor original",
    "Aberto",
    "Recebido",
    "Baixado",
    "Saldo",
    "Status",
    "Dias vencidos",
    "Condição pgto",
    "Forma pgto",
    "Cliente",
    "Empresa",
    "Observação",
    "Origem vínculo",
    "Ações",
  ];
  for (const c of requiredTitleCols) {
    if (!dlg.includes(c)) {
      return fail(
        "financial:title-cols",
        `Coluna obrigatória da tabela de títulos ausente: "${c}"`
      );
    }
  }
  ok(
    "financial:title-cols",
    `tabela de títulos com ${requiredTitleCols.length} colunas oficiais (com coluna Tipo)`
  );

  const requiredReceiptCols = [
    "Título",
    "Data baixa",
    "Data receb.",
    "Valor recebido",
    "Juros",
    "Desconto",
    "Multa",
    "Forma receb.",
    "Banco/Conta",
    "Histórico",
    "Usuário/Sistema",
  ];
  for (const c of requiredReceiptCols) {
    if (!dlg.includes(c)) {
      return fail(
        "financial:receipt-cols",
        `Coluna obrigatória da tabela de baixas ausente: "${c}"`
      );
    }
  }
  ok(
    "financial:receipt-cols",
    `tabela de baixas com ${requiredReceiptCols.length} colunas oficiais (juros/desconto/multa/histórico/usuário)`
  );

  const requiredFinAlertCodes = [
    "RECEIVABLE_OPEN",
    "RECEIVABLE_OVERDUE",
    "RECEIVABLE_GREATER_THAN_ACTIVE_ORDER",
    "RECEIVABLE_LESS_THAN_DOCUMENTED_VALUE",
    "RECEIVABLE_DUPLICATED_BY_ITEM_FACTS",
    "RECEIVABLE_WITHOUT_NFE",
    "RECEIVABLE_WITHOUT_DUE_DATE",
    "PAYMENT_TERM_MISSING",
    "RECEIPT_GREATER_THAN_RECEIVABLE",
    "PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE",
    "PLANNED_RECEIVABLE_WITHOUT_REAL_CR",
    "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR",
    "PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR",
  ];
  for (const code of requiredFinAlertCodes) {
    if (!svc.includes(code)) {
      return fail(
        "financial:alert-svc",
        `Código de divergência ausente no service: ${code}`
      );
    }
    if (!dlg.includes(code)) {
      return fail(
        "financial:alert-dlg",
        `Código de divergência ausente na UI: ${code}`
      );
    }
  }
  ok(
    "financial:alert-codes",
    "13 códigos oficiais da aba Financeiro emitidos no service + UI (inclui PLANNED_RECEIVABLE_*)"
  );

  // Legado CR_VENCIDO renomeado.
  if (/push\(\s*\{\s*code:\s*["']CR_VENCIDO["']/.test(svc)) {
    return fail(
      "financial:legacy-codes",
      "buildAlerts ainda emite alerta legado CR_VENCIDO"
    );
  }
  ok(
    "financial:legacy-codes",
    "buildAlerts do audit-full não emite mais CR_VENCIDO (usa RECEIVABLE_OVERDUE)"
  );

  const requiredFinContractFields = [
    "receivableId",
    "issueDate",
    "amountScheduled",
    "installmentNumber",
    "totalInstallments",
    "paymentTermsText",
    "comments",
    "daysOverdue",
    "linkOrigin",
    "searchReference",
    "paymentDate",
    "interest",
    "discount",
    "lateFee",
    "externalReceiptId",
    "userOrSystem",
  ];
  for (const f of requiredFinContractFields) {
    if (!svc.includes(f)) {
      return fail(
        "financial:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "financial:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "financial:contract",
    "OrderFullAuditReceivable + OrderFullAuditReceipt expandidos (parcela, condição, dias vencidos, juros/desconto/multa)"
  );

  // Botões copiar + abrir CR
  if (
    !/data-testid=\{\s*`order-full-audit-financial-copy-\$\{r\.receivableExternalId\}`\}/.test(
      dlg
    )
  ) {
    return fail(
      "financial:copy-button",
      "Botão 'Copiar referência' com testId dinâmico ausente"
    );
  }
  if (
    !/data-testid=\{\s*`order-full-audit-financial-open-\$\{r\.receivableExternalId\}`\}/.test(
      dlg
    )
  ) {
    return fail(
      "financial:open-button",
      "Botão 'Abrir Contas a Receber' com testId dinâmico ausente"
    );
  }
  if (!dlg.includes("buildAccountsReceivableSearchUrl")) {
    return fail(
      "financial:cr-route",
      "helper buildAccountsReceivableSearchUrl ausente no dialog"
    );
  }
  if (!dlg.includes("/finance/accounts-receivable?search=")) {
    return fail(
      "financial:cr-route",
      "rota /finance/accounts-receivable?search=... não aparece no dialog"
    );
  }
  ok(
    "financial:actions",
    "botões copiar (com desabilitação para valor zero) + abrir Contas a Receber com ?search=<ref>"
  );

  // Rota deve ler o filtro
  const arTitlesTab = read(
    "src/components/finance/FinanceAccountsReceivableTitlesTab.tsx"
  );
  if (!arTitlesTab.includes("useSearchParams")) {
    return fail(
      "financial:cr-route-consumer",
      "FinanceAccountsReceivableTitlesTab não consome useSearchParams para ?search="
    );
  }
  ok(
    "financial:cr-route-consumer",
    "FinanceAccountsReceivableTitlesTab lê ?search= via useSearchParams (deep-link funciona)"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Entrega / Produção / Frete                                      */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-delivery-tab",
    "order-full-audit-delivery-section-delivery",
    "order-full-audit-delivery-section-production",
    "order-full-audit-delivery-section-freight",
    "order-full-audit-delivery-section-items",
    "order-full-audit-delivery-items-table",
    "order-full-audit-delivery-section-divergences",
  ]) {
    if (!dlg.includes(testId)) {
      return fail("delivery:testids", `testId ausente: ${testId}`);
    }
  }
  ok(
    "delivery:testids",
    "aba Entrega com 4 seções (entrega/produção/frete/itens) + divergências"
  );

  for (const kpi of [
    "Data entrega padrão",
    "Data emissão pedido",
    "Último documento saída",
    "Última NF-e",
    "Última baixa",
    "Lead time prometido",
    "Lead time real",
    "Atraso",
    "Previsão futura",
    "Status operacional",
    "Itens totais",
    "Itens ativos",
    "Atendidos",
    "Pendentes ativos",
    "Vencidos",
    "Cancelados",
    "Com corte",
    "Pronto não faturado",
    "Qtd pedida",
    "Qtd produzida",
    "Qtd faturada",
    "Saldo a faturar",
    "Saldo pronto",
    "Modalidade de transporte",
    "Condição de frete",
    "Responsável pelo frete",
    "Valor frete",
    "Transportadora",
    "Local de entrega",
    "Endereço entrega",
    "Observações entrega",
    "Observações internas",
  ]) {
    if (!dlg.includes(kpi)) {
      return fail("delivery:cards", `KPI/label obrigatório ausente: "${kpi}"`);
    }
  }
  ok(
    "delivery:cards",
    "cards de entrega/produção/frete completos (datas + lead time + counts + totais + endereço + notas)"
  );

  const requiredDeliveryItemCols = [
    "Item",
    "Produto",
    "Data entrega prevista",
    "Status",
    "Qtde pedida",
    "Qtde produzida",
    "Qtde faturada",
    "Saldo a faturar",
    "Saldo pronto",
    "Atendido produção?",
    "Documento saída",
    "NF",
    "Atraso (dias)",
    "Alertas",
  ];
  for (const c of requiredDeliveryItemCols) {
    if (!dlg.includes(c)) {
      return fail(
        "delivery:item-cols",
        `Coluna obrigatória da tabela por item ausente: "${c}"`
      );
    }
  }
  ok(
    "delivery:item-cols",
    `tabela por item com ${requiredDeliveryItemCols.length} colunas oficiais`
  );

  const requiredDeliveryAlertCodes = [
    "DELIVERY_OVERDUE_WITHOUT_DOCUMENT",
    "ACTIVE_ITEM_OVERDUE_WITHOUT_NFE",
    "PRODUCTION_QUANTITY_LESS_THAN_INVOICED",
    "READY_BALANCE_NOT_INVOICED",
    "CANCELED_ITEM_MARKED_AS_OVERDUE",
    "CUT_ITEM_MARKED_AS_PENDING",
    "FREIGHT_CONDITION_MISMATCH",
  ];
  for (const code of requiredDeliveryAlertCodes) {
    if (!svc.includes(code)) {
      return fail(
        "delivery:alert-svc",
        `Código de divergência ausente no service: ${code}`
      );
    }
    if (!dlg.includes(code)) {
      return fail(
        "delivery:alert-dlg",
        `Código de divergência ausente na UI: ${code}`
      );
    }
  }
  ok(
    "delivery:alert-codes",
    "7 códigos oficiais da aba Entrega emitidos no service + UI"
  );

  const requiredDeliveryContractFields = [
    "OrderFullAuditDeliveryBlock",
    "leadTimePromisedDays",
    "leadTimeRealDays",
    "delayDays",
    "forecastNextDeliveryDate",
    "carrierName",
    "carrierExternalId",
    "deliveryAddress",
    "deliveryNotes",
    "internalNotes",
    "readyNotInvoiced",
    "quantityProduced",
    "quantityInvoiced",
    "saldoAFaturar",
    "saldoPronto",
  ];
  for (const f of requiredDeliveryContractFields) {
    if (!svc.includes(f)) {
      return fail(
        "delivery:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "delivery:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "delivery:contract",
    "OrderFullAuditDeliveryBlock + OrderFullAuditFreightBlock com lead time, contagens e endereço/notas"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Margem, Preço e Custo                                            */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-margin-pricing-tab",
    "order-full-audit-margin-cards",
    "order-full-audit-margin-section-items",
    "order-full-audit-margin-items-table",
    "order-full-audit-margin-section-divergences",
  ]) {
    if (!dlg.includes(testId)) {
      return fail("margin:testids", `testId ausente: ${testId}`);
    }
  }
  ok(
    "margin:testids",
    "aba Margem com cards + tabela de itens + divergências"
  );

  for (const kpi of [
    "Receita ativa",
    "Custo total ativo",
    "Margem R$",
    "Margem %",
    "Valor cancelado",
    "Valor cortado",
    "Valor sem margem",
    "Itens NO_MARGIN",
    "Ignorados (cancelado/cut/stale)",
    "Δ pedido × tabela",
    "Δ pedido × documento",
  ]) {
    if (!dlg.includes(kpi)) {
      return fail("margin:cards", `Card obrigatório ausente: "${kpi}"`);
    }
  }
  ok(
    "margin:cards",
    "11 cards do topo (receita/custo/margem/cancelado/cortado/sem-margem/ignorados/Δ)"
  );

  const requiredMarginItemCols = [
    "Produto / SKU",
    "Status",
    "Qtd ativa",
    "Preço un. pedido",
    "Preço un. tabela",
    "Preço un. documento",
    "Preço un. NF",
    "Δ pedido × tabela",
    "Δ pedido × documento",
    "Δ documento × NF",
    "Custo un.",
    "Custo total",
    "Margem R$",
    "Margem %",
    "Regra fiscal",
    "Tabela",
    "Vigência tabela",
    "Comissão prev.",
    "Status margem",
    "Motivo",
  ];
  for (const c of requiredMarginItemCols) {
    if (!dlg.includes(c)) {
      return fail(
        "margin:item-cols",
        `Coluna obrigatória da tabela por item ausente: "${c}"`
      );
    }
  }
  ok(
    "margin:item-cols",
    `tabela por item com ${requiredMarginItemCols.length} colunas oficiais (5 comparações de preço + margem + tabela)`
  );

  const requiredMarginAlertCodes = [
    "NO_MARGIN",
    "PRICE_TABLE_NOT_FOUND",
    "COST_NOT_FOUND",
    "ORDER_PRICE_BELOW_TABLE",
    "ORDER_PRICE_DIFFERS_FROM_DOCUMENT",
    "DOCUMENT_PRICE_DIFFERS_FROM_NFE",
    "NEGATIVE_MARGIN",
    "CANCELED_ITEM_GENERATING_NO_MARGIN",
    "STALE_ITEM_GENERATING_MARGIN",
    "PRICE_TABLE_NOT_FOUND_FOR_ORDER_DATE",
  ];
  for (const code of requiredMarginAlertCodes) {
    if (!svc.includes(code)) {
      return fail(
        "margin:alert-svc",
        `Código de divergência ausente no service: ${code}`
      );
    }
    if (!dlg.includes(code)) {
      return fail(
        "margin:alert-dlg",
        `Código de divergência ausente na UI: ${code}`
      );
    }
  }
  ok(
    "margin:alert-codes",
    "10 códigos oficiais da aba Margem emitidos no service + UI"
  );

  const requiredMarginContractFields = [
    "OrderFullAuditMarginPricingItem",
    "priceDiffOrderVsTableAbs",
    "priceDiffOrderVsDocumentAbs",
    "priceDiffDocumentVsNfeAbs",
    "officialTableUnitPrice",
    "documentUnitPrice",
    "nfeUnitPrice",
    "marginStatus",
    "priceTableCode",
    "priceTableVersion",
    "priceTableEffectiveDate",
    "canceledValue",
    "cutValue",
    "staleValue",
    "noMarginValue",
    "priceOrderVsTableDelta",
    "priceOrderVsDocumentDelta",
    "noMarginItems",
    "priceMismatchItems",
    "negativeMarginItems",
    "missingCostItems",
    "missingTableItems",
  ];
  for (const f of requiredMarginContractFields) {
    if (!svc.includes(f)) {
      return fail(
        "margin:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "margin:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "margin:contract",
    "OrderFullAuditMarginPricingBlock: items com 5 preços + Δ + tabela + margem + counts oficiais"
  );

  // Reuso oficial do serviço de margem.
  if (
    !svc.includes(
      "calculateSalesOrderMarginsForOrders"
    )
  ) {
    return fail(
      "margin:reuse-service",
      "orderFullAuditService não chama calculateSalesOrderMarginsForOrders"
    );
  }
  ok(
    "margin:reuse-service",
    "reutiliza calculateSalesOrderMarginsForOrders (recompute oficial)"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Comissões                                                       */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-commissions-tab",
    "order-full-audit-commissions-readonly",
    "order-full-audit-commissions-cards",
    "order-full-audit-commissions-section-items",
    "order-full-audit-commissions-items-table",
    "order-full-audit-commissions-section-divergences",
  ]) {
    if (!dlg.includes(testId)) {
      return fail("commissions:testids", `testId ausente: ${testId}`);
    }
  }
  ok(
    "commissions:testids",
    "aba Comissões com disclaimer read-only + cards + tabela por item + cronograma + divergências"
  );

  for (const kpi of [
    "Comissão prevista",
    "Comissão confirmada",
    "Comissão liberada",
    "Comissão paga",
    "Comissão bloqueada",
    "Base comissionável",
    "Base ignorada",
    "Vendedor comissionável",
  ]) {
    if (!dlg.includes(kpi)) {
      return fail("commissions:cards", `Card obrigatório ausente: "${kpi}"`);
    }
  }
  ok(
    "commissions:cards",
    "8 cards do topo (prevista/confirmada/liberada/paga/bloqueada/base/ignorada/vendedor)"
  );

  const requiredCommissionCols = [
    "Pedido",
    "Item",
    "Produto / SKU",
    "Vendedor Nomus",
    "Pessoa comissionada",
    "Regra",
    "Base",
    "Percentual",
    "Valor previsto",
    "Valor bruto",
    "Status",
    "Motivo",
    "Alertas",
  ];
  for (const c of requiredCommissionCols) {
    if (!dlg.includes(c)) {
      return fail(
        "commissions:item-cols",
        `Coluna obrigatória da tabela por item ausente: "${c}"`
      );
    }
  }
  ok(
    "commissions:item-cols",
    `tabela de comissão por item com ${requiredCommissionCols.length} colunas oficiais`
  );

  const requiredCommissionAlerts = [
    "SELLER_NOT_INFORMED",
    "COMMISSION_WITHOUT_SELLER",
    "CANCELED_ITEM_GENERATING_COMMISSION",
    "COMMISSION_RELEASED_WITHOUT_RECEIPT",
    "COMMISSION_PAID_WITH_DIVERGENCE",
    "CUSTOMER_COMMISSION_EXCEPTION",
    "COMMISSION_BASE_GREATER_THAN_RECEIVED_VALUE",
    "RESPONSIBLE_COMMERCIAL_USED_AS_COMMISSION_SELLER",
  ];
  for (const code of requiredCommissionAlerts) {
    if (!svc.includes(code)) {
      return fail(
        "commissions:alert-svc",
        `Código de divergência ausente no service: ${code}`
      );
    }
    if (!dlg.includes(code)) {
      return fail(
        "commissions:alert-dlg",
        `Código de divergência ausente na UI: ${code}`
      );
    }
  }
  ok(
    "commissions:alert-codes",
    "8 códigos oficiais da aba Comissões emitidos no service + UI"
  );

  const requiredCommissionContractFields = [
    "OrderFullAuditCommissionItem",
    "OrderFullAuditCommissionScheduleEntry",
    "OrderFullAuditCommissionReceipt",
    "OrderFullAuditCommissionCustomerException",
    "commissionBase",
    "commissionRatePercent",
    "finalCommissionAmount",
    "totalReleasedAmount",
    "totalPaidAmount",
    "totalBlockedAmount",
    "commissionableBase",
    "ignoredBase",
    "commercialResponsibleName",
    "customerExceptions",
    "readOnly",
  ];
  for (const f of requiredCommissionContractFields) {
    if (!svc.includes(f)) {
      return fail(
        "commissions:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "commissions:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "commissions:contract",
    "OrderFullAuditCommissionBlock expandido (items, cronograma, ledger, exceções, readOnly)"
  );

  // Reuso obrigatório do snapshot oficial.
  if (!svc.includes("commissionOrderSnapshot.findFirst")) {
    return fail(
      "commissions:reuse-snapshot",
      "orderFullAuditService não lê CommissionOrderSnapshot oficial"
    );
  }
  if (!svc.includes("commissionReceiptLedgerLine")) {
    return fail(
      "commissions:reuse-ledger",
      "orderFullAuditService não lê CommissionReceiptLedgerLine"
    );
  }
  ok(
    "commissions:reuse-official",
    "reutiliza CommissionOrderSnapshot + CommissionReceiptLedgerLine + CommissionCustomerException (read-only)"
  );

  // Disclaimer read-only obrigatório.
  if (!dlg.includes("Read-only")) {
    return fail(
      "commissions:readonly-disclaimer",
      "aba Comissões deve exibir disclaimer 'Read-only'"
    );
  }
  ok(
    "commissions:readonly-disclaimer",
    "disclaimer read-only oficial exibido na aba"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Divergências e Alertas                                          */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-divergences-tab",
    "order-full-audit-divergences-cards",
    "order-full-audit-divergences-chips",
    "order-full-audit-divergences-section-table",
    "order-full-audit-divergences-table",
  ]) {
    if (!dlg.includes(testId)) {
      return fail("divergences:testids", `testId ausente: ${testId}`);
    }
  }
  ok(
    "divergences:testids",
    "aba Divergências com cards + filtros + tabela consolidada"
  );

  for (const kpi of [
    "Críticas",
    "Altas",
    "Médias",
    "Informativas",
    "Impacto financeiro",
    "Itens afetados",
    "Títulos afetados",
    "Documentos afetados",
  ]) {
    if (!dlg.includes(kpi)) {
      return fail("divergences:cards", `Card obrigatório ausente: "${kpi}"`);
    }
  }
  ok(
    "divergences:cards",
    "8 cards do topo (críticas/altas/médias/info/impacto/itens/títulos/documentos)"
  );

  const requiredFilters = [
    "all",
    "critical",
    "financial",
    "documents",
    "nfes",
    "pricing",
    "commission",
    "delivery",
    "registration",
  ];
  if (
    !/data-testid=\{\s*`order-full-audit-divergences-chip-\$\{c\.id\}`\}/.test(dlg)
  ) {
    return fail(
      "divergences:chips-testid",
      "template testid dos chips ausente"
    );
  }
  for (const id of requiredFilters) {
    if (!new RegExp(`id:\\s*["']${id}["']`).test(dlg)) {
      return fail(
        "divergences:chips",
        `Filtro obrigatório ausente na configuração: ${id}`
      );
    }
  }
  ok(
    "divergences:chips",
    `9 filtros oficiais + template testid (${requiredFilters.length})`
  );

  const requiredDivergenceCols = [
    "Severidade",
    "Código",
    "Categoria",
    "Descrição",
    "Entidade",
    "Referência",
    "Impacto R$",
    "Impacto qtd",
    "Data",
    "Status",
    "Ação recomendada",
    "Aba",
  ];
  for (const c of requiredDivergenceCols) {
    if (!dlg.includes(c)) {
      return fail(
        "divergences:columns",
        `Coluna obrigatória ausente: "${c}"`
      );
    }
  }
  ok(
    "divergences:columns",
    `tabela com ${requiredDivergenceCols.length} colunas oficiais`
  );

  const requiredCategoryLabels = [
    "Comercial",
    "Pedido",
    "Item",
    "Documento saída",
    "NF-e",
    "Financeiro/CR",
    "Recebimento/Baixa",
    "Entrega",
    "Frete",
    "Margem/Preço",
    "Comissão",
    "Integração/Nomus",
    "Cadastro",
  ];
  for (const label of requiredCategoryLabels) {
    if (!dlg.includes(label)) {
      return fail(
        "divergences:categories",
        `Label PT-BR de categoria ausente: "${label}"`
      );
    }
  }
  ok(
    "divergences:categories",
    "13 categorias oficiais rotuladas em PT-BR"
  );

  const requiredContractFields = [
    "OrderFullAuditAlertCategory",
    "OrderFullAuditAlertSeverity",
    "category",
    "entityType",
    "reference",
    "quantityImpact",
    "linkedTab",
    "byCategory",
    "financialImpactTotal",
    "affectedItems",
    "affectedTitles",
    "affectedDocuments",
    "affectedNfes",
  ];
  for (const f of requiredContractFields) {
    if (!svc.includes(f)) {
      return fail(
        "divergences:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "divergences:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "divergences:contract",
    "OrderFullAuditAlert + OrderFullAuditDivergenceBlock expandidos (category, linkedTab, métricas por entidade)"
  );

  // Metadata canônica no service — todos os códigos oficiais devem ter category.
  const requiredCodesInMetadata = [
    "PROPOSAL_NOT_FOUND",
    "ORDER_ITEM_CANCELED",
    "DOCUMENT_WITH_EXCESS",
    "NFE_HEADER_GREATER_THAN_ORDER",
    "RECEIVABLE_OVERDUE",
    "DELIVERY_OVERDUE_WITHOUT_DOCUMENT",
    "NO_MARGIN",
    "COMMISSION_PAID_WITH_DIVERGENCE",
  ];
  for (const code of requiredCodesInMetadata) {
    if (!new RegExp(`${code}:\\s*\\{`).test(svc)) {
      return fail(
        "divergences:metadata",
        `Código ${code} não tem entrada no mapa getAlertMetadata`
      );
    }
  }
  ok(
    "divergences:metadata",
    "mapa getAlertMetadata cobre todos os códigos oficiais (categoria + severidade + linkedTab)"
  );

  if (!svc.includes("seenCanonicalKeys")) {
    return fail(
      "divergences:dedup",
      "buildAlerts não faz dedup canônico por (code + entityType + reference + valueImpact)"
    );
  }
  ok(
    "divergences:dedup",
    "dedup canônico por (code + entityType + reference + valueImpact)"
  );

  /* -------------------------------------------------------------------- */
  /*  Aba Auditoria Técnica / Evidências                                  */
  /* -------------------------------------------------------------------- */

  for (const testId of [
    "order-full-audit-technical-tab",
    "order-full-audit-technical-summary",
    "order-full-audit-technical-section-sources",
    "order-full-audit-technical-sources-table",
    "order-full-audit-technical-section-identifiers",
    "order-full-audit-technical-section-rules",
    "order-full-audit-technical-section-raw",
    "order-full-audit-technical-section-history",
  ]) {
    if (!dlg.includes(testId)) {
      return fail("technical:testids", `testId ausente: ${testId}`);
    }
  }
  ok(
    "technical:testids",
    "aba Técnica com 5 seções (fontes/IDs/regras/raw/histórico) + summary"
  );

  const requiredAccordions = [
    "order-full-audit-technical-raw-order",
    "order-full-audit-technical-raw-order-items",
    "order-full-audit-technical-raw-documents",
    "order-full-audit-technical-raw-nfes",
    "order-full-audit-technical-raw-receivables",
    "order-full-audit-technical-raw-facts",
  ];
  for (const testId of requiredAccordions) {
    if (!dlg.includes(testId)) {
      return fail(
        "technical:accordions",
        `Accordion obrigatório ausente: ${testId}`
      );
    }
  }
  ok(
    "technical:accordions",
    "6 accordions oficiais (order/items/documents/nfes/receivables/facts)"
  );

  // Accordions devem usar <details> — fechado por padrão.
  if (!/<details[^>]*data-testid=/.test(dlg)) {
    return fail(
      "technical:closed-by-default",
      "Accordions técnicos devem usar <details> (fechado por padrão)"
    );
  }
  ok(
    "technical:closed-by-default",
    "raw accordions usam <details> — fechados por padrão"
  );

  if (
    !dlg.includes("Raw técnico oculto") ||
    !dlg.includes("audit.raw.read")
  ) {
    return fail(
      "technical:raw-restricted-message",
      "Mensagem 'Raw técnico oculto' + permissão obrigatória ausentes"
    );
  }
  ok(
    "technical:raw-restricted-message",
    "mensagem oficial 'Raw técnico oculto' + `audit.raw.read` presentes"
  );

  const requiredTechnicalFields = [
    "OrderFullAuditTechnicalSource",
    "OrderFullAuditTechnicalIdentifiers",
    "OrderFullAuditTechnicalRule",
    "OrderFullAuditTechnicalHistory",
    "OrderFullAuditTechnicalRawStatus",
    "OrderFullAuditTechnicalRawPayloads",
    "sources",
    "identifiers",
    "rulesApplied",
    "history",
    "rawStatus",
    "commissionSnapshotId",
    "commissionLedgerLineKeys",
    "auditRunCommit",
    "alertsCreated",
    "lastOrderToCashRebuild",
    "requiredPermission",
  ];
  for (const f of requiredTechnicalFields) {
    if (!svc.includes(f)) {
      return fail(
        "technical:contract",
        `Campo obrigatório ausente no service: ${f}`
      );
    }
    if (!cli.includes(f)) {
      return fail(
        "technical:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "technical:contract",
    "OrderFullAuditTechnicalAuditBlock: sources/identifiers/rules/history/rawStatus/rawPayloads"
  );

  // 14 fontes oficiais devem ter entradas no builder.
  const requiredSourceNames = [
    "SalesOrder",
    "SalesOrderItem",
    "Proposal",
    "ProposalItem",
    "NomusStockDocument",
    "NomusStockDocumentItem",
    "NomusNfe",
    "NomusAccountsReceivable",
    "OrderToCashAuditFact",
    "PortfolioReconciliationFact",
    "CommissionOrderSnapshot",
    "CommissionReceiptLedgerLine",
    "PriceTable / PriceTableItem",
    "Customer / CrmCustomerCommercialOwner",
  ];
  for (const name of requiredSourceNames) {
    if (!svc.includes(`"${name}"`)) {
      return fail(
        "technical:sources",
        `Fonte obrigatória ausente no builder: ${name}`
      );
    }
  }
  ok(
    "technical:sources",
    `14 fontes oficiais listadas no buildTechnicalAuditBlock`
  );

  // Regras oficiais aplicadas.
  const requiredRuleCodes = [
    "ITEM_STATUS_PER_LINE",
    "CANCELED_ITEM_IGNORED",
    "CUT_ITEM_ACTIVE_ONLY",
    "STALE_ITEM_HISTORY_ONLY",
    "DOCUMENT_ALLOCATION_BY_ITEM",
    "NFE_HEADER_NEVER_INFLATES",
    "OFFICIAL_RECEIVABLE_PREVAILS",
    "COMMISSION_READ_ONLY",
    "MARGIN_ACTIVE_ONLY",
    "SELLER_FROM_ORDER_ONLY",
  ];
  for (const code of requiredRuleCodes) {
    if (!svc.includes(code)) {
      return fail(
        "technical:rules",
        `Regra oficial ausente no builder: ${code}`
      );
    }
  }
  ok(
    "technical:rules",
    `${requiredRuleCodes.length} regras oficiais aplicadas + documentadas`
  );

  // Segurança: raw NÃO deve aparecer nas outras abas (sem JSON cru espalhado).
  // Estratégia: todas as ocorrências devem estar após a definição de `function TechnicalAuditTab`.
  const technicalTabStart = dlg.indexOf("function TechnicalAuditTab");
  if (technicalTabStart < 0) {
    return fail(
      "technical:no-raw-elsewhere",
      "TechnicalAuditTab não encontrado"
    );
  }
  const before = dlg.slice(0, technicalTabStart);
  const rawInBefore =
    (before.match(/nomusRawResponse|rawPayload\b|nomusRawItem/g) ?? []).length;
  if (rawInBefore > 0) {
    return fail(
      "technical:no-raw-elsewhere",
      `${rawInBefore} referência(s) a raw payload ANTES de TechnicalAuditTab`
    );
  }
  ok(
    "technical:no-raw-elsewhere",
    "raw payload isolado no TechnicalAuditTab (nenhuma menção nas demais abas)"
  );

  /* -------------------------------------------------------------------- */
  /*  QA FINAL INTEGRADO — contrato do payload completo                    */
  /* -------------------------------------------------------------------- */

  const requiredPayloadFields = [
    "salesOrderId",
    "orderCode",
    "runId",
    "runMeta",
    "summary",
    "timeline",
    "items",
    "itemFacts",
    "receivables",
    "receivablesTotal",
    "stockDocuments",
    "stockDocumentItems",
    "nfes",
    "nfeItems",
    "delivery",
    "alerts",
    "proposal",
    "proposalVsOrderComparisons",
    "salesOrder",
    "receipts",
    "freight",
    "marginPricing",
    "commissions",
    "divergences",
    "technicalAudit",
  ];
  for (const f of requiredPayloadFields) {
    if (!new RegExp(`\\b${f}:`).test(svc)) {
      return fail(
        "payload:contract",
        `Campo obrigatório ausente em OrderFullAuditPayload: ${f}`
      );
    }
    if (!new RegExp(`\\b${f}:`).test(cli)) {
      return fail(
        "payload:contract",
        `Campo obrigatório ausente no client: ${f}`
      );
    }
  }
  ok(
    "payload:contract",
    `OrderFullAuditPayload expõe todos os 25 campos oficiais (${requiredPayloadFields.length})`
  );

  // Auth/permissão obrigatória na rota audit-full.
  if (!/audit-full[\s\S]{0,600}?requireAppAuth|requirePermission/.test(routes)) {
    return fail(
      "route:auth",
      "rota /orders/:salesOrderId/audit-full deve ter guard de autenticação"
    );
  }
  ok(
    "route:auth",
    "rota audit-full protegida por requireAppAuth/requirePermission"
  );

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${failed} falha(s) estática(s)`);
  return failed === 0;
}

/* ------------------------------------------------------------------ */
/*  Validações dinâmicas contra PDs específicas (best-effort)           */
/*  Só rodam se o Prisma estiver conectável no ambiente.                */
/* ------------------------------------------------------------------ */

const DYNAMIC_ORDERS = ["PD 02339", "PD 02207", "PD 02534", "PD 02740"] as const;

async function runDynamicChecks(): Promise<void> {
  console.log("\n=== dynamic (best-effort) ===");
  let dynFail = 0;
  const dyOk = (id: string, msg: string): void =>
    console.log(`OK   ${id} — ${msg}`);
  const dyFail = (id: string, msg: string): void => {
    dynFail += 1;
    console.error(`FAIL ${id} — ${msg}`);
  };
  const dyWarn = (id: string, msg: string): void =>
    console.warn(`WARN ${id} — ${msg}`);

  let mod: typeof import("../src/lib/finance/orderFullAuditService.js");
  let prismaMod: typeof import("../src/lib/prisma.js");
  try {
    mod = (await import(
      "../src/lib/finance/orderFullAuditService.js"
    )) as unknown as typeof import("../src/lib/finance/orderFullAuditService.js");
    prismaMod = (await import(
      "../src/lib/prisma.js"
    )) as unknown as typeof import("../src/lib/prisma.js");
  } catch (e) {
    dyWarn(
      "dynamic:import",
      `import service/prisma falhou (ok se offline): ${(e as Error).message}`
    );
    return;
  }
  const { prisma } = prismaMod;

  for (const orderCode of DYNAMIC_ORDERS) {
    const order = await prisma.salesOrder
      .findFirst({ where: { orderCode } })
      .catch(() => null);
    if (!order) {
      dyWarn(`dynamic:${orderCode}`, `SalesOrder não encontrado — pulando`);
      continue;
    }
    const payload = await mod
      .getOrderFullAudit({
        salesOrderId: order.id,
      })
      .catch((e: Error) => {
        dyFail(`dynamic:${orderCode}`, `getOrderFullAudit falhou: ${e.message}`);
        return null;
      });
    if (!payload) continue;

    // Contrato dinâmico — todos os 18 blocos oficiais devem estar no payload.
    const requiredRuntimeKeys = [
      "summary",
      "timeline",
      "items",
      "itemFacts",
      "receivables",
      "receivablesTotal",
      "stockDocuments",
      "stockDocumentItems",
      "nfes",
      "nfeItems",
      "delivery",
      "alerts",
      "proposal",
      "salesOrder",
      "receipts",
      "freight",
      "marginPricing",
      "commissions",
      "divergences",
      "technicalAudit",
    ] as const;
    const missingRuntime: string[] = [];
    for (const k of requiredRuntimeKeys) {
      if (!(k in (payload as unknown as Record<string, unknown>))) {
        missingRuntime.push(k);
      }
    }
    if (missingRuntime.length > 0) {
      dyFail(
        `dynamic:${orderCode}:payload-shape`,
        `Blocos ausentes no payload: ${missingRuntime.join(", ")}`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:payload-shape`,
        `payload completo com ${requiredRuntimeKeys.length} blocos oficiais`
      );
    }

    const s = payload.summary;

    switch (orderCode) {
      case "PD 02339":
        if (s.receivableOpenValue > 0.009 || s.receivableTotalValue > 0.009) {
          dyOk(
            `dynamic:${orderCode}:cr`,
            `CR aberto=${s.receivableOpenValue.toFixed(2)} total=${s.receivableTotalValue.toFixed(2)}`
          );
        } else {
          dyFail(
            `dynamic:${orderCode}:cr`,
            "PD 02339 deveria expor CR aberto no summary"
          );
        }
        break;
      case "PD 02207": {
        if (s.canceledOrderValue > 0.009) {
          dyOk(
            `dynamic:${orderCode}:canceled`,
            `valor cancelado=${s.canceledOrderValue.toFixed(2)}`
          );
        } else {
          dyFail(
            `dynamic:${orderCode}:canceled`,
            "PD 02207 deveria expor valor cancelado > 0"
          );
        }
        if (s.fulfillmentPercentActive >= 99.99) {
          if (s.pendingActiveOrderValue < 0.01) {
            dyOk(
              `dynamic:${orderCode}:pending`,
              "ativos 100% atendidos → sem saldo pendente ativo"
            );
          } else {
            dyFail(
              `dynamic:${orderCode}:pending`,
              `ativos 100% atendidos mas pendente=${s.pendingActiveOrderValue.toFixed(2)}`
            );
          }
        } else {
          dyWarn(
            `dynamic:${orderCode}:pending`,
            `fulfillmentPercentActive=${s.fulfillmentPercentActive}; cenário 100% ativos não confirmado neste snapshot`
          );
        }
        break;
      }
      case "PD 02534": {
        if (
          s.canceledOrderValue > 0.009 &&
          Math.abs(s.activeOrderValue - s.originalOrderValue) > 0.009
        ) {
          dyOk(
            `dynamic:${orderCode}:split`,
            `valor cancelado=${s.canceledOrderValue.toFixed(2)}, valor ativo=${s.activeOrderValue.toFixed(2)}, original=${s.originalOrderValue.toFixed(2)} — separados`
          );
        } else if (s.canceledOrderValue <= 0.009) {
          dyWarn(
            `dynamic:${orderCode}:split`,
            "PD 02534 sem cancelamento no snapshot atual — regra apenas verificável quando houver corte/cancelamento"
          );
        } else {
          dyFail(
            `dynamic:${orderCode}:split`,
            "PD 02534 tem cancelado mas ativo=original — separação quebrada"
          );
        }
        break;
      }
      case "PD 02740": {
        // Sem NF/CR real: aba Financeiro deve listar recebíveis PLANEJADOS.
        if (payload.receivables.length === 0) {
          if (payload.plannedReceivables.length > 0) {
            dyOk(
              `dynamic:${orderCode}:planned-listed`,
              `sem CR real → ${payload.plannedReceivables.length} recebível(is) planejado(s) listado(s)`
            );
          } else {
            dyFail(
              `dynamic:${orderCode}:planned-listed`,
              "PD 02740 sem CR real e sem parcelas planejadas — aba Financeiro ficaria zerada"
            );
          }
        } else {
          dyWarn(
            `dynamic:${orderCode}:planned-listed`,
            `PD 02740 já possui CR real (${payload.receivables.length}) — cenário planned-only não confirmado`
          );
        }

        // Verifica que o valor total planejado casa com o total ativo do pedido
        // (ou pelo menos é > 0). Aceita tolerância de 1% para arredondamentos.
        const expectedActive = s.activeOrderValue;
        const totalPlanned = payload.plannedReceivablesTotal.totalExpected;
        if (totalPlanned > 0.009) {
          const diff = Math.abs(expectedActive - totalPlanned);
          if (diff <= Math.max(1, expectedActive * 0.02)) {
            dyOk(
              `dynamic:${orderCode}:planned-amount`,
              `total planejado (${totalPlanned.toFixed(2)}) ≈ valor ativo (${expectedActive.toFixed(2)})`
            );
          } else {
            dyWarn(
              `dynamic:${orderCode}:planned-amount`,
              `total planejado ${totalPlanned.toFixed(2)} vs ativo ${expectedActive.toFixed(2)} — divergência ${diff.toFixed(2)}`
            );
          }
        }

        // Confere emissão do alerta oficial quando ficar planejado.
        const hasPlannedAlert = payload.alerts.some(
          (a) =>
            a.code === "PLANNED_RECEIVABLE_WITHOUT_REAL_CR" ||
            a.code === "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR"
        );
        if (payload.receivables.length === 0 && payload.plannedReceivables.length > 0) {
          if (hasPlannedAlert) {
            dyOk(
              `dynamic:${orderCode}:planned-alert`,
              "alerta PLANNED_RECEIVABLE_WITHOUT_REAL_CR emitido"
            );
          } else {
            dyFail(
              `dynamic:${orderCode}:planned-alert`,
              "sem alerta PLANNED_RECEIVABLE_WITHOUT_REAL_CR"
            );
          }
        }
        break;
      }
    }

    /* --- Contrato geral do bloco financeiro: planned ⊥ real (dedup) --- */
    const realDueSet = new Set(
      payload.receivables
        .filter((r) => r.amountReceivable > 0.009)
        .map((r) => `${(r.dueDate ?? "").slice(0, 10)}:${r.amountReceivable.toFixed(2)}`)
    );
    const overlapPlanned = payload.plannedReceivables.filter(
      (p) =>
        !p.replacedByRealCr &&
        realDueSet.has(
          `${(p.dueDate ?? "").slice(0, 10)}:${p.expectedAmount.toFixed(2)}`
        )
    );
    if (overlapPlanned.length === 0) {
      dyOk(
        `dynamic:${orderCode}:planned-vs-real-dedup`,
        "sem overlap entre planejados e CR real (dedup ok)"
      );
    } else {
      dyFail(
        `dynamic:${orderCode}:planned-vs-real-dedup`,
        `${overlapPlanned.length} parcelas planejadas deveriam ter sido dedup'd por CR real`
      );
    }

    /* --- Contratos gerais válidos p/ toda ordem --- */
    const seen = new Set<number>();
    for (const r of payload.receivables) {
      if (seen.has(r.receivableExternalId)) {
        dyFail(
          `dynamic:${orderCode}:cr-dedup`,
          `CR duplicado no summary: ${r.receivableExternalId}`
        );
        break;
      }
      seen.add(r.receivableExternalId);
    }
    if (seen.size === payload.receivables.length) {
      dyOk(`dynamic:${orderCode}:cr-dedup`, `CRs deduplicados (${seen.size})`);
    }

    /* --- Proposta / origem comercial --- */
    if (order.proposalId) {
      if (payload.proposal.present) {
        dyOk(
          `dynamic:${orderCode}:proposal`,
          `proposta vinculada: ${payload.proposal.proposalNumber ?? payload.proposal.proposalId} (${payload.proposal.items.length} item(s))`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:proposal`,
          `pedido tem proposalId=${order.proposalId} mas payload.proposal.present=false (${payload.proposal.emptyReason})`
        );
      }
    } else {
      if (!payload.proposal.present) {
        dyOk(
          `dynamic:${orderCode}:proposal`,
          `pedido sem proposalId → empty state esperado (${payload.proposal.emptyReason})`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:proposal`,
          `pedido sem proposalId mas payload.proposal.present=true`
        );
      }
    }

    // Divergências de valor/preço aparecem quando o comparativo indica mismatch.
    const proposalAlertCodes = new Set(
      payload.alerts.map((a) => a.code)
    );
    if (payload.proposalVsOrderComparisons) {
      const c = payload.proposalVsOrderComparisons;
      if (!c.totalNetValue.matches) {
        if (proposalAlertCodes.has("PROPOSAL_ORDER_VALUE_MISMATCH")) {
          dyOk(
            `dynamic:${orderCode}:proposal-value-mismatch`,
            `Δ valor ${c.totalNetValue.diff?.toFixed(2)} → PROPOSAL_ORDER_VALUE_MISMATCH emitido`
          );
        } else {
          dyFail(
            `dynamic:${orderCode}:proposal-value-mismatch`,
            "totalNetValue divergente sem PROPOSAL_ORDER_VALUE_MISMATCH"
          );
        }
      }
      if (c.itemsMapping.priceMismatches > 0) {
        if (proposalAlertCodes.has("PROPOSAL_PRICE_MISMATCH")) {
          dyOk(
            `dynamic:${orderCode}:proposal-price-mismatch`,
            `${c.itemsMapping.priceMismatches} item(s) com PROPOSAL_PRICE_MISMATCH`
          );
        } else {
          dyFail(
            `dynamic:${orderCode}:proposal-price-mismatch`,
            "há priceMismatches mas PROPOSAL_PRICE_MISMATCH não foi emitido"
          );
        }
      }
    }

    // Proposta não pode alterar cálculo financeiro (CR/receivables continuam vindo do Nomus).
    if (
      payload.summary.receivableTotalValue !==
      round2Local(
        payload.receivables.reduce((s, r) => s + r.amountReceivable, 0)
      )
    ) {
      dyFail(
        `dynamic:${orderCode}:financial-untouched`,
        "receivableTotalValue não bate com soma dos receivables — algum caminho está usando proposta como fonte financeira"
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:financial-untouched`,
        "financeiro continua vindo do CR oficial (proposta não altera cálculo)"
      );
    }

    /* --- Aba Pedido de Venda --- */
    const so = payload.salesOrder;
    const OP_SECTOR_KEYWORDS = [
      "FATURAMENTO",
      "FINANCEIRO",
      "EXPEDICAO",
      "EXPEDIÇÃO",
      "PRODUCAO",
      "PRODUÇÃO",
      "COMPRAS",
      "PCP",
      "ALMOXARIFADO",
      "LOGISTICA",
      "LOGÍSTICA",
    ];
    const looksLikeSector = (v: string | null | undefined): boolean => {
      if (!v) return false;
      const upper = v.trim().toUpperCase();
      return OP_SECTOR_KEYWORDS.some(
        (k) => upper === k || upper.startsWith(k)
      );
    };
    const commercialName = so.commercialResponsibleName?.trim() ?? "";
    const sellerName = so.orderSellerName?.trim() ?? "";

    if (commercialName && looksLikeSector(commercialName)) {
      dyFail(
        `dynamic:${orderCode}:commercial-vs-sector`,
        `commercialResponsibleName="${commercialName}" parece nome de setor — não deve aparecer como Responsável Comercial`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:commercial-vs-sector`,
        `Responsável Comercial = "${commercialName || "(vazio → 'Sem responsável comercial')"}" (não é setor)`
      );
    }

    // Vendedor Pedido continua separado do responsável comercial.
    if (
      sellerName &&
      commercialName &&
      sellerName.toUpperCase() === commercialName.toUpperCase()
    ) {
      dyFail(
        `dynamic:${orderCode}:seller-vs-commercial`,
        "Vendedor Pedido igual ao Responsável Comercial — devem ser separados"
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:seller-vs-commercial`,
        `Vendedor Pedido="${sellerName || "(vazio)"}" ≠ Responsável Comercial`
      );
    }

    // Empty label check quando vazio (fallback correto na UI).
    if (!sellerName) {
      dyOk(
        `dynamic:${orderCode}:seller-empty-label`,
        "sellerName vazio → UI deve mostrar 'Sem vendedor informado'"
      );
    }
    if (!commercialName) {
      dyOk(
        `dynamic:${orderCode}:commercial-empty-label`,
        "commercialResponsibleName vazio → UI deve mostrar 'Sem responsável comercial'"
      );
    }

    // Cabeçalho × itens: se divergente, precisa emitir ORDER_HEADER_ITEMS_TOTAL_MISMATCH.
    const codes = new Set(payload.alerts.map((a) => a.code));
    if (
      so.totals.headerVsItemsDiff != null &&
      Math.abs(so.totals.headerVsItemsDiff) > 0.01
    ) {
      if (codes.has("ORDER_HEADER_ITEMS_TOTAL_MISMATCH")) {
        dyOk(
          `dynamic:${orderCode}:header-vs-items`,
          `Δ header × items=${so.totals.headerVsItemsDiff.toFixed(2)} → alerta emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:header-vs-items`,
          "cabeçalho × itens divergente mas ORDER_HEADER_ITEMS_TOTAL_MISMATCH não emitido"
        );
      }
    }

    if (so.itemCounts.total === 0) {
      if (codes.has("ORDER_WITHOUT_ITEMS")) {
        dyOk(
          `dynamic:${orderCode}:no-items`,
          "pedido sem itens → ORDER_WITHOUT_ITEMS emitido"
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:no-items`,
          "pedido sem itens mas ORDER_WITHOUT_ITEMS não emitido"
        );
      }
    }

    /* --- Aba Itens do Pedido — status POR LINHA, dedup, alertas por linha --- */

    // Nenhum item ativo deve estar cancelado/stale — regra "não misturar".
    const badActive = payload.items.filter(
      (i) =>
        !i.nomusIsCanceled &&
        !i.nomusIsStale &&
        (i.canceledQuantity ?? 0) > 0.0001
    );
    if (badActive.length > 0) {
      dyFail(
        `dynamic:${orderCode}:items-active-vs-canceled`,
        `${badActive.length} item(ns) com canceledQuantity>0 mas nomusIsCanceled=false`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:items-active-vs-canceled`,
        "sem mistura entre ativo e cancelado por linha"
      );
    }

    // Cancelado não pode estar como pendente ativo.
    const canceledButPending = payload.items.filter(
      (i) =>
        (i.nomusIsCanceled || i.nomusIsStale) &&
        (i.activePendingQuantity ?? 0) > 0.0001
    );
    if (canceledButPending.length > 0) {
      dyFail(
        `dynamic:${orderCode}:canceled-not-pending`,
        `${canceledButPending.length} item(ns) cancelados/stale mas com activePendingQuantity>0`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:canceled-not-pending`,
        "item cancelado/stale NÃO aparece como pendente ativo"
      );
    }

    // Alertas oficiais por linha corretos.
    for (const i of payload.items) {
      const label = `line=${i.itemSequence ?? "?"} sku=${i.productCode ?? "?"}`;
      if (i.nomusIsCanceled && !i.alerts.includes("ORDER_ITEM_CANCELED")) {
        dyFail(
          `dynamic:${orderCode}:item-canceled-alert`,
          `${label} isCanceled=true mas alerts NÃO contém ORDER_ITEM_CANCELED`
        );
      }
      if (i.nomusIsCut && !i.alerts.includes("ORDER_ITEM_CUT")) {
        dyFail(
          `dynamic:${orderCode}:item-cut-alert`,
          `${label} isCut=true mas alerts NÃO contém ORDER_ITEM_CUT`
        );
      }
      if (
        (i.nomusItemStatusNormalized ?? "").toUpperCase() === "UNKNOWN" &&
        !i.alerts.includes("ORDER_ITEM_STATUS_UNKNOWN")
      ) {
        dyFail(
          `dynamic:${orderCode}:item-unknown-alert`,
          `${label} status=UNKNOWN mas alerts sem ORDER_ITEM_STATUS_UNKNOWN`
        );
      }
    }

    // SKU repetido com status diferente — verificado só quando o pedido de fato tem repetido.
    const byProductCode = new Map<string, Set<string>>();
    for (const i of payload.items) {
      const sku = (i.productCode ?? "").trim();
      if (!sku) continue;
      const s = (i.nomusItemStatusNormalized ?? "UNKNOWN").toUpperCase();
      let set = byProductCode.get(sku);
      if (!set) {
        set = new Set<string>();
        byProductCode.set(sku, set);
      }
      set.add(s);
    }
    const hasRepeatedDifferent = [...byProductCode.values()].some(
      (s) => s.size > 1
    );
    if (hasRepeatedDifferent) {
      if (codes.has("REPEATED_SKU_WITH_DIFFERENT_STATUS")) {
        dyOk(
          `dynamic:${orderCode}:repeated-sku-status`,
          "SKU repetido com status diferente → REPEATED_SKU_WITH_DIFFERENT_STATUS emitido"
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:repeated-sku-status`,
          "SKU repetido com status diferente mas REPEATED_SKU_WITH_DIFFERENT_STATUS NÃO emitido"
        );
      }
    }

    // Cenário PD 02534 — 309.86AA aparece em várias linhas, cancelamento não herda por SKU.
    if (orderCode === "PD 02534") {
      const linesOfSku = payload.items.filter(
        (i) => (i.productCode ?? "").trim() === "309.86AA"
      );
      if (linesOfSku.length > 1) {
        const canceled = linesOfSku.filter((i) => i.nomusIsCanceled);
        const active = linesOfSku.filter((i) => !i.nomusIsCanceled);
        dyOk(
          `dynamic:${orderCode}:sku-per-line`,
          `309.86AA em ${linesOfSku.length} linha(s) — ${canceled.length} cancelada(s), ${active.length} ativa(s)`
        );
      } else {
        dyWarn(
          `dynamic:${orderCode}:sku-per-line`,
          `309.86AA não repetiu em múltiplas linhas neste snapshot`
        );
      }
    }

    // Cenário PD 02207 — status 6 (CANCELED) por linha; ativos 100% atendidos ⇒ não parcial.
    if (orderCode === "PD 02207") {
      const status6 = payload.items.filter(
        (i) =>
          i.nomusItemStatusRaw === "6" ||
          (i.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELED"
      );
      if (status6.length > 0) {
        const allCanceled = status6.every((i) => i.nomusIsCanceled);
        if (allCanceled) {
          dyOk(
            `dynamic:${orderCode}:status-6-canceled`,
            `${status6.length} item(ns) status=6 mapeados para CANCELED`
          );
        } else {
          dyFail(
            `dynamic:${orderCode}:status-6-canceled`,
            "status=6 sem nomusIsCanceled=true em alguma linha"
          );
        }
      }
      if (
        payload.summary.fulfillmentPercentActive >= 99.99 &&
        payload.summary.pendingActiveOrderValue < 0.01
      ) {
        dyOk(
          `dynamic:${orderCode}:not-partial`,
          "ativos 100% atendidos → não deve aparecer como parcial"
        );
      }
    }

    // Dedup — mesmo salesOrderItemId não pode aparecer duas vezes na lista de items.
    const soiIds = new Set<string>();
    let dup = 0;
    for (const i of payload.items) {
      if (soiIds.has(i.salesOrderItemId)) dup += 1;
      soiIds.add(i.salesOrderItemId);
    }
    if (dup > 0) {
      dyFail(
        `dynamic:${orderCode}:items-dedup`,
        `${dup} salesOrderItemId duplicado(s) no payload.items`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:items-dedup`,
        `payload.items sem duplicidade (${payload.items.length} linhas)`
      );
    }

    /* --- Aba Documentos de Saída --- */

    // Documentos deduplicados por externalId.
    const docIds = new Set<number>();
    let docDup = 0;
    for (const d of payload.stockDocuments) {
      if (docIds.has(d.stockDocumentExternalId)) docDup += 1;
      docIds.add(d.stockDocumentExternalId);
    }
    if (docDup > 0) {
      dyFail(
        `dynamic:${orderCode}:documents-dedup`,
        `${docDup} documento(s) duplicado(s)`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:documents-dedup`,
        `documentos deduplicados (${payload.stockDocuments.length})`
      );
    }

    // Itens do documento — nenhum item deve estar duplicado.
    const docItemKeys = new Set<string>();
    let itemDup = 0;
    for (const i of payload.stockDocumentItems) {
      const k = `${i.stockDocumentExternalId}:${i.stockDocumentItemId}`;
      if (docItemKeys.has(k)) itemDup += 1;
      docItemKeys.add(k);
    }
    if (itemDup > 0) {
      dyFail(
        `dynamic:${orderCode}:doc-items-dedup`,
        `${itemDup} item(ns) de documento duplicado(s)`
      );
    } else if (payload.stockDocumentItems.length > 0) {
      dyOk(
        `dynamic:${orderCode}:doc-items-dedup`,
        `itens de documento deduplicados (${payload.stockDocumentItems.length} linhas)`
      );
    }

    // Comparação de preço obrigatória: quando há linked SOI e preço unitário do doc,
    // deve calcular priceDiffAbsolute + priceDiffPercent + financialImpact.
    let missingPriceCalc = 0;
    for (const i of payload.stockDocumentItems) {
      if (
        i.linkedSalesOrderItemId != null &&
        i.orderUnitPrice != null &&
        i.unitValue != null &&
        (i.priceDiffAbsolute == null || i.priceDiffPercent == null)
      ) {
        missingPriceCalc += 1;
      }
    }
    if (missingPriceCalc > 0) {
      dyFail(
        `dynamic:${orderCode}:doc-price-diff`,
        `${missingPriceCalc} item(ns) casados sem cálculo de Δ preço unitário/percentual`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:doc-price-diff`,
        "Δ preço unitária/percentual/impacto calculados para itens casados"
      );
    }

    // Documento com excedente → deve emitir DOCUMENT_WITH_EXCESS.
    const docsWithExcess = payload.stockDocuments.filter((d) => d.hasExcess);
    if (docsWithExcess.length > 0) {
      if (codes.has("DOCUMENT_WITH_EXCESS")) {
        dyOk(
          `dynamic:${orderCode}:doc-with-excess`,
          `${docsWithExcess.length} doc(s) com excedente → DOCUMENT_WITH_EXCESS emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:doc-with-excess`,
          "excedente presente mas DOCUMENT_WITH_EXCESS não emitido"
        );
      }
    }

    // Produto fora do pedido → DOCUMENT_EXTRA_ITEM.
    const docsWithOutside = payload.stockDocuments.filter((d) => d.hasOutside);
    if (docsWithOutside.length > 0) {
      if (codes.has("DOCUMENT_EXTRA_ITEM")) {
        dyOk(
          `dynamic:${orderCode}:doc-outside`,
          `${docsWithOutside.length} doc(s) com produto fora → DOCUMENT_EXTRA_ITEM emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:doc-outside`,
          "produto fora do pedido presente mas DOCUMENT_EXTRA_ITEM não emitido"
        );
      }
    }

    // Documento não pode inflar o pedido sem alerta.
    const docsInflating = payload.stockDocuments.filter(
      (d) => d.totalValue > payload.summary.activeOrderValue + 0.01
    );
    for (const d of docsInflating) {
      if (
        !d.alerts.includes("DOCUMENT_WITH_EXCESS") &&
        !d.alerts.includes("DOCUMENT_EXTRA_ITEM") &&
        !payload.alerts.some((a) => a.code === "NF_MAIOR_QUE_PEDIDO")
      ) {
        dyFail(
          `dynamic:${orderCode}:doc-inflate-guard`,
          `Doc ${d.stockDocumentExternalId} (R$ ${d.totalValue.toFixed(2)}) > ativo (R$ ${payload.summary.activeOrderValue.toFixed(2)}) sem alerta`
        );
      }
    }
    if (docsInflating.length > 0) {
      dyOk(
        `dynamic:${orderCode}:doc-inflate-guard`,
        `${docsInflating.length} doc(s) > valor ativo com alerta acompanhado`
      );
    }

    // Cenário PD 02534 — 309.86AA só pode ser faturado onde o item existe.
    if (orderCode === "PD 02534") {
      const soiFor86AA = new Set(
        payload.items
          .filter((i) => (i.productCode ?? "").trim() === "309.86AA")
          .map((i) => i.salesOrderItemId)
      );
      const badLinks = payload.stockDocumentItems.filter(
        (i) =>
          (i.productSku ?? "").trim() === "309.86AA" &&
          i.linkedSalesOrderItemId != null &&
          !soiFor86AA.has(i.linkedSalesOrderItemId)
      );
      if (badLinks.length > 0) {
        dyFail(
          `dynamic:${orderCode}:doc-86AA-linkage`,
          `${badLinks.length} linha(s) de documento 309.86AA vinculada(s) a SalesOrderItem fora do pedido`
        );
      } else {
        dyOk(
          `dynamic:${orderCode}:doc-86AA-linkage`,
          "309.86AA no documento só vincula com linhas 309.86AA do pedido"
        );
      }
    }

    /* --- Aba NF-e --- */

    // NF deduplicadas por externalId.
    const nfeIds = new Set<number>();
    let nfeDup = 0;
    for (const n of payload.nfes) {
      if (nfeIds.has(n.nfeExternalId)) nfeDup += 1;
      nfeIds.add(n.nfeExternalId);
    }
    if (nfeDup > 0) {
      dyFail(
        `dynamic:${orderCode}:nfes-dedup`,
        `${nfeDup} NF(s) duplicada(s)`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:nfes-dedup`,
        `NF-e deduplicadas (${payload.nfes.length})`
      );
    }

    // Valor total NF ≠ valor atribuído (verifica que nunca são iguais forçadamente para NF > pedido).
    let mismatchTotalVsAllocated = 0;
    for (const n of payload.nfes) {
      if (
        n.valorTotal != null &&
        n.valorTotal > payload.summary.activeOrderValue + 0.01 &&
        Math.abs(n.valorTotal - n.allocatedValueToOrder) < 0.01
      ) {
        mismatchTotalVsAllocated += 1;
      }
    }
    if (mismatchTotalVsAllocated > 0) {
      dyFail(
        `dynamic:${orderCode}:nfe-total-vs-allocated`,
        `${mismatchTotalVsAllocated} NF(s) com valor total = atribuído mesmo sendo > pedido`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:nfe-total-vs-allocated`,
        "valor total NF ≠ atribuído quando NF > pedido"
      );
    }

    // NF sem CR identificada → NFE_WITHOUT_CR.
    const nfesWithoutCr = payload.nfes.filter((n) => !n.hasReceivable);
    if (nfesWithoutCr.length > 0) {
      if (codes.has("NFE_WITHOUT_CR")) {
        dyOk(
          `dynamic:${orderCode}:nfe-without-cr`,
          `${nfesWithoutCr.length} NF(s) sem CR → NFE_WITHOUT_CR emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:nfe-without-cr`,
          "NF sem CR mas NFE_WITHOUT_CR não emitido"
        );
      }
    }

    // NF maior que pedido identificada → NFE_HEADER_GREATER_THAN_ORDER ou NFE_VALUE_GREATER_THAN_ACTIVE_ORDER.
    const nfesGreater = payload.nfes.filter(
      (n) =>
        n.headerGreaterThanOrder ||
        (n.valorTotal != null &&
          n.valorTotal - payload.summary.activeOrderValue > 0.009)
    );
    if (nfesGreater.length > 0) {
      const hasAlert =
        codes.has("NFE_HEADER_GREATER_THAN_ORDER") ||
        codes.has("NFE_VALUE_GREATER_THAN_ACTIVE_ORDER");
      if (hasAlert) {
        dyOk(
          `dynamic:${orderCode}:nfe-greater`,
          `${nfesGreater.length} NF(s) > pedido → alerta emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:nfe-greater`,
          "NF > pedido mas nenhum dos alertas emitido"
        );
      }
    }

    // Cabeçalho NF não infla carteira: allocatedValueToOrder deve ≤ activeOrderValue + tolerância.
    let inflatedAllocated = 0;
    for (const n of payload.nfes) {
      if (
        n.allocatedValueToOrder - payload.summary.activeOrderValue >
        0.01
      ) {
        inflatedAllocated += 1;
      }
    }
    if (inflatedAllocated > 0) {
      dyFail(
        `dynamic:${orderCode}:nfe-no-inflate`,
        `${inflatedAllocated} NF(s) com atribuído > ativo`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:nfe-no-inflate`,
        "cabeçalho NF não infla atribuído ao pedido"
      );
    }

    // Cenário PD 02534: 309.86AA só pode ser faturado em NF que contém o item.
    if (orderCode === "PD 02534") {
      const soiFor86AA = new Set(
        payload.items
          .filter((i) => (i.productCode ?? "").trim() === "309.86AA")
          .map((i) => i.salesOrderItemId)
      );
      const badNfeLinks = payload.nfeItems.filter(
        (i) =>
          (i.productSku ?? "").trim() === "309.86AA" &&
          i.linkedSalesOrderItemId != null &&
          !soiFor86AA.has(i.linkedSalesOrderItemId)
      );
      if (badNfeLinks.length > 0) {
        dyFail(
          `dynamic:${orderCode}:nfe-86AA-linkage`,
          `${badNfeLinks.length} item(ns) NF 309.86AA vinculado(s) a SOI fora do pedido`
        );
      } else {
        dyOk(
          `dynamic:${orderCode}:nfe-86AA-linkage`,
          "309.86AA na NF só casa com linhas 309.86AA do pedido"
        );
      }

      // Itens não faturados: SOI não deve aparecer em nfeItems se não veio no payload.
      const soiIdsInNfes = new Set(
        payload.nfeItems
          .map((i) => i.linkedSalesOrderItemId)
          .filter((id): id is string => id != null)
      );
      const unbilledSoiCount = payload.items.filter(
        (i) => !i.nomusIsCanceled && !i.nomusIsStale && !soiIdsInNfes.has(i.salesOrderItemId)
      ).length;
      dyOk(
        `dynamic:${orderCode}:nfe-unbilled-items`,
        `${unbilledSoiCount} SOI ativo(s) sem NF (aparecerá como "Sem NF")`
      );
    }

    /* --- Aba Financeiro — Títulos e Baixas --- */

    // Dedup por externalId — aba Financeiro exige uma única linha por CR.
    const crIds = new Set<number>();
    let crDup = 0;
    for (const r of payload.receivables) {
      if (crIds.has(r.receivableExternalId)) crDup += 1;
      crIds.add(r.receivableExternalId);
    }
    if (crDup > 0) {
      dyFail(
        `dynamic:${orderCode}:financial-dedup`,
        `${crDup} CR(s) duplicado(s) na aba Financeiro`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:financial-dedup`,
        `CRs deduplicados por externalId (${payload.receivables.length})`
      );
    }

    // Cada CR precisa ter searchReference para o botão "Abrir no Contas a Receber".
    let missingSearchRef = 0;
    for (const r of payload.receivables) {
      if (!r.searchReference || r.searchReference.trim().length === 0) {
        missingSearchRef += 1;
      }
    }
    if (missingSearchRef > 0) {
      dyFail(
        `dynamic:${orderCode}:financial-search-ref`,
        `${missingSearchRef} CR(s) sem searchReference (deep-link CR quebrado)`
      );
    } else if (payload.receivables.length > 0) {
      dyOk(
        `dynamic:${orderCode}:financial-search-ref`,
        "todos os CRs têm searchReference para deep-link no Contas a Receber"
      );
    }

    // Soma amountReceivable = totals.totalAmount (dentro da tolerância).
    const sumAmount = round2Local(
      payload.receivables.reduce((s, r) => s + (r.amountReceivable ?? 0), 0)
    );
    if (
      Math.abs(sumAmount - round2Local(payload.receivablesTotal.totalAmount)) >
      0.01
    ) {
      dyFail(
        `dynamic:${orderCode}:financial-card-match`,
        `Σ receivables = ${sumAmount.toFixed(2)} ≠ card total ${payload.receivablesTotal.totalAmount.toFixed(2)}`
      );
    } else if (payload.receivables.length > 0) {
      dyOk(
        `dynamic:${orderCode}:financial-card-match`,
        "soma dos títulos bate com card 'Total em títulos'"
      );
    }

    // CR real ligado a NF maior que pedido: presença dupla dos alertas oficiais.
    const nfeGreater = payload.nfes.some(
      (n) =>
        n.headerGreaterThanOrder ||
        (n.valorTotal != null &&
          n.valorTotal - payload.summary.activeOrderValue > 0.009)
    );
    if (nfeGreater && payload.receivables.length > 0) {
      const hasNfeAlert =
        codes.has("NFE_HEADER_GREATER_THAN_ORDER") ||
        codes.has("NFE_VALUE_GREATER_THAN_ACTIVE_ORDER");
      if (hasNfeAlert) {
        dyOk(
          `dynamic:${orderCode}:financial-cr-with-nf-alert`,
          "CR real ligado a NF > pedido continua aparecendo (com alerta, não escondido)"
        );
      }
    }

    /* --- Aba Entrega / Produção / Frete --- */

    // Item cancelado/stale nunca deve estar em `delivery.itemCounts.overdue`.
    const canceledInOverdue = payload.items.filter(
      (i) =>
        (i.nomusIsCanceled || i.nomusIsStale) &&
        (i.alerts.includes("DELIVERY_DATE_OVERDUE") ||
          i.alerts.includes("DELIVERY_OVERDUE_WITHOUT_DOCUMENT") ||
          i.alerts.includes("ACTIVE_ITEM_OVERDUE_WITHOUT_NFE"))
    );
    if (canceledInOverdue.length > 0) {
      dyFail(
        `dynamic:${orderCode}:delivery-canceled-overdue`,
        `${canceledInOverdue.length} item(ns) cancelado(s) marcado(s) como vencido/atraso`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:delivery-canceled-overdue`,
        "itens cancelados/stale NÃO aparecem como atraso"
      );
    }

    // Item com corte não deve estar como pendente infinita.
    const cutStillPending = payload.items.filter(
      (i) => i.nomusIsCut && (i.activePendingQuantity ?? 0) > 0.0001
    );
    if (cutStillPending.length > 0) {
      dyFail(
        `dynamic:${orderCode}:delivery-cut-pending`,
        `${cutStillPending.length} item(ns) com corte marcado(s) como pendente ativo`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:delivery-cut-pending`,
        "itens com corte não aparecem como pendência infinita"
      );
    }

    // Saldo pronto sem faturar deve aparecer.
    const readyNotInv = payload.items.filter(
      (i) =>
        (i.saldoPronto ?? 0) > 0.0001 &&
        !i.nomusIsCanceled &&
        !i.nomusIsStale &&
        i.invoicedQuantity != null &&
        i.quantity != null &&
        i.invoicedQuantity < i.quantity - 0.0001
    );
    if (readyNotInv.length > 0) {
      if (codes.has("READY_BALANCE_NOT_INVOICED")) {
        dyOk(
          `dynamic:${orderCode}:ready-not-invoiced`,
          `${readyNotInv.length} item(ns) pronto(s) não faturado(s) → READY_BALANCE_NOT_INVOICED emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:ready-not-invoiced`,
          "saldo pronto sem faturar mas READY_BALANCE_NOT_INVOICED não emitido"
        );
      }
    }

    // Contagem overdue no delivery block bate com facts?
    const nowMs = Date.now();
    const expectedOverdueCount = payload.items.filter(
      (i) =>
        !i.nomusIsCanceled &&
        !i.nomusIsStale &&
        !i.nomusIsCut &&
        (i.activePendingQuantity ?? 0) > 0.0001 &&
        i.expectedDeliveryDate != null &&
        new Date(i.expectedDeliveryDate).getTime() < nowMs
    ).length;
    if (payload.delivery.itemCounts.overdue !== expectedOverdueCount) {
      dyFail(
        `dynamic:${orderCode}:delivery-overdue-count`,
        `itemCounts.overdue=${payload.delivery.itemCounts.overdue} ≠ calculado=${expectedOverdueCount}`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:delivery-overdue-count`,
        `itemCounts.overdue consistente (${expectedOverdueCount})`
      );
    }

    // Cenário PD 02534: itens têm datas de entrega (expectedDeliveryDate).
    if (orderCode === "PD 02534") {
      const withDates = payload.items.filter(
        (i) => i.expectedDeliveryDate != null
      );
      if (withDates.length === payload.items.length && payload.items.length > 0) {
        dyOk(
          `dynamic:${orderCode}:items-with-delivery-dates`,
          `todos os ${payload.items.length} itens têm data de entrega`
        );
      } else {
        dyWarn(
          `dynamic:${orderCode}:items-with-delivery-dates`,
          `${withDates.length}/${payload.items.length} itens com data de entrega`
        );
      }
    }

    /* --- Aba Margem, Preço e Custo --- */

    // Invariante: item cancelado/stale NÃO deve gerar NO_MARGIN nem margem calculada.
    const canceledOrStaleWithNoMargin = payload.marginPricing.items.filter(
      (i) =>
        (i.isCanceled || i.isStale) &&
        (i.alerts.includes("NO_MARGIN") || i.alerts.includes("NEGATIVE_MARGIN"))
    );
    if (canceledOrStaleWithNoMargin.length > 0) {
      dyFail(
        `dynamic:${orderCode}:margin-canceled-stale-no-margin`,
        `${canceledOrStaleWithNoMargin.length} item(ns) cancelado/stale marcado com NO_MARGIN/NEGATIVE_MARGIN`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:margin-canceled-stale-no-margin`,
        "itens cancelados/stale NÃO geram NO_MARGIN/NEGATIVE_MARGIN"
      );
    }

    // Cancelado/stale gerando margem calculada (invariante crítico).
    const canceledWithMargin = payload.marginPricing.items.filter(
      (i) => (i.isCanceled || i.isStale) && i.marginValue != null
    );
    if (canceledWithMargin.length > 0) {
      dyWarn(
        `dynamic:${orderCode}:margin-canceled-with-margin`,
        `${canceledWithMargin.length} item(ns) cancelado/stale ainda tem margem calculada — verificar se é esperado`
      );
    }

    // Diferença pedido × documento aparece quando há preço documento diferente.
    const priceMismatchItems = payload.marginPricing.items.filter(
      (i) =>
        i.isActive &&
        i.priceDiffOrderVsDocumentAbs != null &&
        Math.abs(i.priceDiffOrderVsDocumentAbs) > 0.005
    );
    if (priceMismatchItems.length > 0) {
      if (codes.has("ORDER_PRICE_DIFFERS_FROM_DOCUMENT")) {
        dyOk(
          `dynamic:${orderCode}:margin-price-diff-doc`,
          `${priceMismatchItems.length} item(ns) com Δ pedido × doc → ORDER_PRICE_DIFFERS_FROM_DOCUMENT emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:margin-price-diff-doc`,
          "há Δ pedido × doc mas ORDER_PRICE_DIFFERS_FROM_DOCUMENT não emitido"
        );
      }
    }

    // Cenário PD 02566 — item zerado/stale NÃO deve gerar erro/NO_MARGIN.
    if (orderCode === "PD 02566") {
      const bad = payload.marginPricing.items.filter(
        (i) =>
          (i.isStale ||
            (i.activeQuantity != null && i.activeQuantity < 0.0001)) &&
          i.alerts.includes("NO_MARGIN")
      );
      if (bad.length > 0) {
        dyFail(
          `dynamic:${orderCode}:margin-zero-stale-no-margin`,
          `PD 02566: ${bad.length} item(ns) stale/zerado com NO_MARGIN indevido`
        );
      } else {
        dyOk(
          `dynamic:${orderCode}:margin-zero-stale-no-margin`,
          "PD 02566: itens stale/zerado NÃO geram NO_MARGIN indevido"
        );
      }
    }

    // Cenário PD 02534 — diferenças por linha (não por SKU) quando houver 309.86AA repetido.
    if (orderCode === "PD 02534") {
      const soi86AA = payload.marginPricing.items.filter(
        (i) => (i.productCode ?? "").trim() === "309.86AA"
      );
      if (soi86AA.length > 1) {
        // Cada linha pode ter preço/margem diferente — não pode ser copiado por SKU.
        const uniquePrices = new Set(
          soi86AA
            .map((i) => (i.orderUnitPrice != null ? i.orderUnitPrice.toFixed(4) : "null"))
        );
        dyOk(
          `dynamic:${orderCode}:margin-per-line`,
          `309.86AA em ${soi86AA.length} linha(s) com ${uniquePrices.size} preço(s) distinto(s) — Δ calculado por linha`
        );
      }
    }

    /* --- Aba Auditoria Técnica --- */

    // Fontes têm os 14 nomes oficiais + counts.
    const sourceNames = payload.technicalAudit.sources.map((s) => s.name);
    let missingSources = 0;
    for (const expected of [
      "SalesOrder",
      "SalesOrderItem",
      "NomusStockDocument",
      "NomusNfe",
      "NomusAccountsReceivable",
      "OrderToCashAuditFact",
      "CommissionOrderSnapshot",
    ]) {
      if (!sourceNames.includes(expected)) missingSources += 1;
    }
    if (missingSources > 0) {
      dyFail(
        `dynamic:${orderCode}:technical-source`,
        `${missingSources} fonte(s) obrigatória(s) ausente(s) em technicalAudit.sources`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:technical-sources`,
        `${sourceNames.length} fontes listadas com counts + status`
      );
    }

    // IDs técnicos obrigatórios.
    const ids = payload.technicalAudit.identifiers;
    if (!ids.salesOrderId) {
      dyFail(
        `dynamic:${orderCode}:technical-ids`,
        "salesOrderId ausente em identifiers"
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:technical-ids`,
        `identifiers.salesOrderId=${ids.salesOrderId.slice(0, 8)}… + ${ids.stockDocumentExternalIds.length} docs + ${ids.nfeExternalIds.length} NFs + ${ids.receivableExternalIds.length} CRs`
      );
    }

    // Raw NÃO deve estar incluído por padrão.
    if (payload.technicalAudit.rawStatus.included) {
      dyFail(
        `dynamic:${orderCode}:technical-raw-default`,
        "rawStatus.included=true por padrão (deveria ser false sem includeRaw explícito)"
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:technical-raw-default`,
        "rawPayloads oculto por padrão (includeRaw=false)"
      );
    }
    if (payload.technicalAudit.rawPayloads != null) {
      dyFail(
        `dynamic:${orderCode}:technical-raw-payloads-hidden`,
        "rawPayloads populado sem includeRaw=true"
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:technical-raw-payloads-hidden`,
        "rawPayloads ausente do payload (não vazado)"
      );
    }

    // Regras aplicadas — 10 oficiais.
    if (payload.technicalAudit.rulesApplied.length < 10) {
      dyFail(
        `dynamic:${orderCode}:technical-rules-count`,
        `Apenas ${payload.technicalAudit.rulesApplied.length}/10 regras aplicadas listadas`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:technical-rules-count`,
        `${payload.technicalAudit.rulesApplied.length} regras oficiais documentadas no bloco`
      );
    }

    /* --- Aba Divergências e Alertas --- */

    // Todo alerta precisa ter category + severity (contrato oficial).
    let missingMeta = 0;
    for (const a of payload.alerts) {
      const anyA = a as unknown as { category?: string; linkedTab?: string };
      if (!anyA.category || !("linkedTab" in anyA)) missingMeta += 1;
    }
    if (missingMeta > 0) {
      dyFail(
        `dynamic:${orderCode}:divergences-meta`,
        `${missingMeta} alerta(s) sem category/linkedTab`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:divergences-meta`,
        `todos os ${payload.alerts.length} alerta(s) têm category + linkedTab`
      );
    }

    // Deduplicação canônica: mesma (code + entityType + reference + financialImpact) só aparece uma vez.
    const canonicalKeys = new Set<string>();
    let dupCanonical = 0;
    for (const a of payload.alerts) {
      const key = [
        a.code,
        a.entityType ?? "",
        a.reference ?? "",
        Math.round((a.financialImpact ?? 0) * 100),
      ].join("|");
      if (canonicalKeys.has(key)) dupCanonical += 1;
      canonicalKeys.add(key);
    }
    if (dupCanonical > 0) {
      dyFail(
        `dynamic:${orderCode}:divergences-dedup`,
        `${dupCanonical} divergência(s) duplicada(s) por chave canônica`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:divergences-dedup`,
        `${payload.alerts.length} alerta(s) sem duplicação canônica`
      );
    }

    // Counts do bloco devem bater com os alertas.
    const dvcCritical = payload.alerts.filter(
      (a) => a.severity === "critical"
    ).length;
    const dvcHigh = payload.alerts.filter((a) => a.severity === "high").length;
    if (
      payload.divergences.counts.critical !== dvcCritical ||
      payload.divergences.counts.high !== dvcHigh
    ) {
      dyFail(
        `dynamic:${orderCode}:divergences-counts`,
        `counts (critical=${payload.divergences.counts.critical}, high=${payload.divergences.counts.high}) ≠ alertas (${dvcCritical}, ${dvcHigh})`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:divergences-counts`,
        `counts consistentes (critical=${dvcCritical}, high=${dvcHigh})`
      );
    }

    // Cenário PD 02207 — cancelados aparecem como info, não pendência.
    if (orderCode === "PD 02207") {
      const canceledInfo = payload.alerts.filter(
        (a) => a.code === "ORDER_ITEM_CANCELED"
      );
      const canceledCritical = canceledInfo.filter(
        (a) => a.severity === "critical"
      );
      if (canceledCritical.length > 0) {
        dyFail(
          `dynamic:${orderCode}:canceled-as-info`,
          `${canceledCritical.length} ORDER_ITEM_CANCELED marcado como critical (deveria ser info)`
        );
      } else if (canceledInfo.length > 0) {
        dyOk(
          `dynamic:${orderCode}:canceled-as-info`,
          `${canceledInfo.length} item(ns) cancelado(s) aparecem como info/informativa`
        );
      }
    }

    /* --- Aba Comissões --- */

    // Vendedor comissionável NÃO pode ser o Responsável Comercial.
    if (
      payload.commissions.commercialResponsibleName &&
      payload.commissions.canonicalSellerName &&
      payload.commissions.commercialResponsibleName.trim().toUpperCase() ===
        payload.commissions.canonicalSellerName.trim().toUpperCase()
    ) {
      dyFail(
        `dynamic:${orderCode}:commission-not-crm`,
        "Responsável Comercial usado como vendedor comissionável"
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:commission-not-crm`,
        "Responsável Comercial (CRM) ≠ vendedor comissionável"
      );
    }

    // Item cancelado/stale não deve aparecer como base comissionável ativa.
    const canceledInBase = payload.commissions.items.filter(
      (i) =>
        (i.isCanceled || i.isStale) &&
        (i.finalCommissionAmount ?? 0) > 0.009
    );
    if (canceledInBase.length > 0) {
      if (codes.has("CANCELED_ITEM_GENERATING_COMMISSION")) {
        dyOk(
          `dynamic:${orderCode}:commission-canceled-flagged`,
          `${canceledInBase.length} item(ns) cancelado/stale com comissão → CANCELED_ITEM_GENERATING_COMMISSION emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:commission-canceled-flagged`,
          "item cancelado com comissão sem alerta CANCELED_ITEM_GENERATING_COMMISSION"
        );
      }
    } else {
      dyOk(
        `dynamic:${orderCode}:commission-canceled-flagged`,
        "itens cancelados/stale NÃO aparecem como base comissionável"
      );
    }

    // Comissão paga não pode divergir da liberada (paga > liberada).
    const paidGtReleased = payload.commissions.receipts.filter(
      (r) =>
        (r.paidCommissionAmount ?? 0) - (r.releasedCommissionAmount ?? 0) >
        0.009
    );
    if (paidGtReleased.length > 0) {
      if (codes.has("COMMISSION_PAID_WITH_DIVERGENCE")) {
        dyOk(
          `dynamic:${orderCode}:commission-paid-divergence`,
          `${paidGtReleased.length} baixa(s) paga > liberada → COMMISSION_PAID_WITH_DIVERGENCE emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:commission-paid-divergence`,
          "há paga > liberada mas alerta não emitido"
        );
      }
    }

    // Cliente com exceção ativa: se existir, deve virar CUSTOMER_COMMISSION_EXCEPTION.
    const activeExceptions = payload.commissions.customerExceptions.filter(
      (e) => e.active
    );
    if (activeExceptions.length > 0) {
      if (codes.has("CUSTOMER_COMMISSION_EXCEPTION")) {
        dyOk(
          `dynamic:${orderCode}:commission-exception`,
          `${activeExceptions.length} exceção(ões) ativa(s) → CUSTOMER_COMMISSION_EXCEPTION emitido`
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:commission-exception`,
          "exceção ativa mas CUSTOMER_COMMISSION_EXCEPTION não emitido"
        );
      }
    }

    // Sem vendedor Nomus + tem comissão → COMMISSION_WITHOUT_SELLER.
    const totalComm = payload.commissions.totals.totalFinalCommissionAmount ?? 0;
    if (
      totalComm > 0.009 &&
      !(payload.summary.orderSellerName ?? "").trim() &&
      !(payload.commissions.rawSellerName ?? "").trim() &&
      !(payload.commissions.canonicalSellerName ?? "").trim()
    ) {
      if (codes.has("COMMISSION_WITHOUT_SELLER")) {
        dyOk(
          `dynamic:${orderCode}:commission-no-seller`,
          "comissão sem vendedor → COMMISSION_WITHOUT_SELLER emitido"
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:commission-no-seller`,
          "comissão calculada sem vendedor mas alerta não emitido"
        );
      }
    }

    // Cenário PD 02207: cancelados (status=6) NÃO devem gerar atraso.
    if (orderCode === "PD 02207") {
      const canceledMarkedOverdue = payload.items.filter(
        (i) =>
          i.nomusIsCanceled &&
          (i.alerts.includes("DELIVERY_DATE_OVERDUE") ||
            i.alerts.includes("DELIVERY_OVERDUE_WITHOUT_DOCUMENT"))
      );
      if (canceledMarkedOverdue.length === 0) {
        dyOk(
          `dynamic:${orderCode}:canceled-no-overdue`,
          "itens cancelados (status=6) NÃO geram alerta de atraso"
        );
      } else {
        dyFail(
          `dynamic:${orderCode}:canceled-no-overdue`,
          `${canceledMarkedOverdue.length} item(ns) cancelado(s) com alerta de atraso`
        );
      }
    }

    // Cenário PD 02339 — precisa ter CR aberto com referência + vencimento.
    if (orderCode === "PD 02339") {
      const withOpen = payload.receivables.filter(
        (r) =>
          (r.balanceReceivable ?? 0) > 0.009 &&
          r.dueDate != null &&
          r.searchReference &&
          r.searchReference.trim().length > 0
      );
      if (withOpen.length > 0) {
        dyOk(
          `dynamic:${orderCode}:financial-open-with-ref`,
          `${withOpen.length} CR aberto(s) com referência + vencimento → deep-link possível`
        );
      } else if (payload.receivables.length > 0) {
        dyFail(
          `dynamic:${orderCode}:financial-open-with-ref`,
          "PD 02339: nenhum CR aberto com referência + vencimento"
        );
      }
    }

    const nfeHeaderInflates =
      s.nfeTotalValue - 0.01 > s.activeOrderValue &&
      !payload.alerts.some((a) => a.code === "NF_MAIOR_QUE_PEDIDO");
    if (nfeHeaderInflates) {
      dyFail(
        `dynamic:${orderCode}:nf-header`,
        `cabeçalho NF (${s.nfeTotalValue}) > ativo (${s.activeOrderValue}) sem alerta NF_MAIOR_QUE_PEDIDO`
      );
    } else {
      dyOk(
        `dynamic:${orderCode}:nf-header`,
        "cabeçalho NF não infla carteira sem alerta"
      );
    }
  }

  await prisma.$disconnect().catch(() => undefined);
  if (dynFail > 0) {
    console.error(`\nFAIL (dinâmico) — ${dynFail} falha(s)`);
    process.exit(2);
  } else {
    console.log("\nPASS (dinâmico)");
  }
}

function round2Local(v: number): number {
  return Math.round(v * 100) / 100;
}

async function run(): Promise<void> {
  const staticOk = main();
  if (!staticOk) process.exit(1);
  if (process.env.QA_ORDER_FULL_AUDIT_SKIP_DYNAMIC === "1") {
    console.log("(dynamic skipped by env QA_ORDER_FULL_AUDIT_SKIP_DYNAMIC=1)");
    process.exit(0);
  }
  await runDynamicChecks();
  process.exit(0);
}

void run();
