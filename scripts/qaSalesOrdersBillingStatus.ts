/**
 * QA estático — Coluna Faturamento da listagem Comercial > Pedidos de Venda.
 *
 * Uso:  npx tsx scripts/qaSalesOrdersBillingStatus.ts
 *
 * 10 asserções obrigatórias + sanity da regra pura:
 *   1. Regra pura devolve INVOICED para pedido com NF vinculada.
 *   2. Regra pura devolve NOT_INVOICED para pedido sem NF.
 *   3. Regra pura devolve PARTIALLY_INVOICED quando há cobertura parcial.
 *   4. Regra pura devolve CANCELED para status="CANCELLED".
 *   5. UI da tabela usa "Faturamento" (não "Situação") e não menciona
 *      "Enviado ao Nomus" na coluna principal.
 *   6. Filtro por Cliente continua no bloco de filtros (dados-testid preservado).
 *   7. Exportador XLSX inclui coluna "Faturamento".
 *   8. Componente PDF (Print) inclui cabeçalho "Faturamento".
 *   9. Regra oficial NÃO consulta CR/Proposta como fonte de faturamento.
 *  10. Frontend (src/components/**) NÃO importa @prisma/client.
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSalesOrderBillingStatus,
  salesOrderBillingStatusLabel,
} from "../src/lib/sales/salesOrderListBillingStatus.js";

const ROOT = process.cwd();

type Check = { id: string; ok: boolean; detail: string };
const checks: Check[] = [];

function ok(id: string, detail: string): void {
  checks.push({ id, ok: true, detail });
  // eslint-disable-next-line no-console
  console.log(`PASS  ${id} — ${detail}`);
}
function fail(id: string, detail: string): void {
  checks.push({ id, ok: false, detail });
  // eslint-disable-next-line no-console
  console.error(`FAIL  ${id} — ${detail}`);
}
function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
}
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// 1..4) Regra pura
// ---------------------------------------------------------------------------
function checkPureRule(): void {
  const invoiced = resolveSalesOrderBillingStatus({
    status: "SENT_TO_NOMUS",
    hasNfe: true,
    isFullyInvoiced: true,
    isPartiallyInvoiced: false,
  });
  if (invoiced === "INVOICED") {
    ok(
      "check-1-rule-invoiced",
      `Pedido com NF total → INVOICED (${salesOrderBillingStatusLabel(invoiced)}).`
    );
  } else {
    fail("check-1-rule-invoiced", `Esperado INVOICED, veio ${invoiced}`);
  }

  const notInvoiced = resolveSalesOrderBillingStatus({
    status: "SENT_TO_NOMUS",
    hasNfe: false,
  });
  if (notInvoiced === "NOT_INVOICED") {
    ok(
      "check-2-rule-not-invoiced",
      `Pedido sem NF → NOT_INVOICED (${salesOrderBillingStatusLabel(notInvoiced)}).`
    );
  } else {
    fail("check-2-rule-not-invoiced", `Esperado NOT_INVOICED, veio ${notInvoiced}`);
  }

  const partial = resolveSalesOrderBillingStatus({
    status: "SENT_TO_NOMUS",
    hasNfe: true,
    isFullyInvoiced: false,
    isPartiallyInvoiced: true,
  });
  if (partial === "PARTIALLY_INVOICED") {
    ok(
      "check-3-rule-partial",
      `Cobertura parcial → PARTIALLY_INVOICED (${salesOrderBillingStatusLabel(partial)}).`
    );
  } else {
    fail("check-3-rule-partial", `Esperado PARTIALLY_INVOICED, veio ${partial}`);
  }

  const canceled = resolveSalesOrderBillingStatus({
    status: "CANCELLED",
    hasNfe: false,
  });
  if (canceled === "CANCELED") {
    ok(
      "check-4-rule-canceled",
      `Status CANCELLED → CANCELED (${salesOrderBillingStatusLabel(canceled)}).`
    );
  } else {
    fail("check-4-rule-canceled", `Esperado CANCELED, veio ${canceled}`);
  }
}

// ---------------------------------------------------------------------------
// 5) UI da tabela
// ---------------------------------------------------------------------------
function checkTableColumn(): void {
  const src = read("src/components/sales/SalesOrderListTable.tsx");
  const hasFaturamentoHeader = />Faturamento</.test(src);
  const hasNfHeader = />NF</.test(src);
  const removedSituacao = !/>Situação</.test(src);
  const removedFaturadoHeader = !/>Faturado</.test(src);
  const usesResolver = /resolveSalesOrderBillingStatus/.test(src);
  const usesLabel = /salesOrderBillingStatusLabel/.test(src);
  const usesBadge = /salesOrderBillingStatusBadgeClass/.test(src);
  const noEnviadoNomusInTable = !/Enviado ao Nomus/.test(src);
  if (
    hasFaturamentoHeader &&
    hasNfHeader &&
    removedSituacao &&
    removedFaturadoHeader &&
    usesResolver &&
    usesLabel &&
    usesBadge &&
    noEnviadoNomusInTable
  ) {
    ok(
      "check-5-table-uses-faturamento",
      "SalesOrderListTable: coluna Faturamento + NF; usa resolver/label/badge; sem 'Enviado ao Nomus'."
    );
  } else {
    fail(
      "check-5-table-uses-faturamento",
      `Coluna incorreta. faturamento=${hasFaturamentoHeader} nf=${hasNfHeader} !situacao=${removedSituacao} !faturado=${removedFaturadoHeader} resolver=${usesResolver} label=${usesLabel} badge=${usesBadge} sem_enviado_nomus=${noEnviadoNomusInTable}`
    );
  }
}

// ---------------------------------------------------------------------------
// 6) Filtros — cliente/dados-testid preservados
// ---------------------------------------------------------------------------
function checkClientFilterIntact(): void {
  const src = read("src/components/SalesOrdersModule.tsx");
  const hasCustomerFilter =
    /<CustomerAutocompleteFilter[\s\S]*?label="Cliente"/.test(src);
  const hasClearBtn = /data-testid="sales-orders-clear-filters"/.test(src);
  if (hasCustomerFilter && hasClearBtn) {
    ok("check-6-client-filter-intact", "Filtro Cliente + Limpar filtros preservados.");
  } else {
    fail(
      "check-6-client-filter-intact",
      `Filtro Cliente ausente/quebrado. customer=${hasCustomerFilter} clear=${hasClearBtn}`
    );
  }
}

// ---------------------------------------------------------------------------
// 7) XLSX
// ---------------------------------------------------------------------------
function checkXlsxColumn(): void {
  const src = read("src/lib/sales/salesOrderReportExport.ts");
  const hasFaturamento = /Faturamento:\s*row\.billingStatusLabel/.test(src);
  if (hasFaturamento) {
    ok(
      "check-7-xlsx-faturamento",
      "Exportador XLSX emite coluna 'Faturamento' a partir de row.billingStatusLabel."
    );
  } else {
    fail(
      "check-7-xlsx-faturamento",
      "Exportador XLSX NÃO emite coluna 'Faturamento'."
    );
  }
}

// ---------------------------------------------------------------------------
// 8) PDF
// ---------------------------------------------------------------------------
function checkPdfColumn(): void {
  const src = read("src/components/sales/SalesOrderReportPrintDocument.tsx");
  const hasHeader = />Faturamento</.test(src);
  const usesBillingLabel = /row\.billingStatusLabel/.test(src);
  const usesTone = /billingStatusToneClass\s*\(/.test(src);
  if (hasHeader && usesBillingLabel && usesTone) {
    ok(
      "check-8-pdf-faturamento",
      "PDF branded: header 'Faturamento' + célula usa row.billingStatusLabel."
    );
  } else {
    fail(
      "check-8-pdf-faturamento",
      `PDF branded: header=${hasHeader} label=${usesBillingLabel} tone=${usesTone}`
    );
  }
}

// ---------------------------------------------------------------------------
// 9) Regra oficial não consulta CR/Proposta
// ---------------------------------------------------------------------------
function checkRuleIgnoresArAndProposal(): void {
  const src = read("src/lib/sales/salesOrderListBillingStatus.ts");
  // O módulo é frontend-safe e só usa `hasNfe`, `isFullyInvoiced`, `isPartiallyInvoiced`.
  // Não pode referenciar (fora de comentário) `Proposal`, `AccountsReceivable`,
  // `Receivable`, `contas-a-receber`, etc.
  const sourceNoComments = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const forbidden = [
    /prisma\.proposal/i,
    /prisma\.accountsReceivable/i,
    /prisma\.receivable/i,
    /\bproposal\b/i,
    /accountsReceivable/i,
  ];
  const violations = forbidden.filter((re) => re.test(sourceNoComments));
  if (violations.length === 0) {
    ok(
      "check-9-rule-ignores-ar-proposal",
      "Regra oficial não referencia Proposta nem Contas a Receber."
    );
  } else {
    fail(
      "check-9-rule-ignores-ar-proposal",
      `Regra oficial referencia fontes proibidas: ${violations.map((r) => r.source).join(", ")}`
    );
  }
}

// ---------------------------------------------------------------------------
// 10) Frontend não importa Prisma
// ---------------------------------------------------------------------------
function checkFrontendNoPrisma(): void {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const source = readFileSync(full, "utf8");
      if (/from\s+["']@prisma\/client["']/.test(source)) offenders.push(full);
    }
  };
  walk(join(ROOT, "src/components/sales"));
  walk(join(ROOT, "src/components/finance/portfolio-reconciliation"));
  const salesOrdersModule = join(ROOT, "src/components/SalesOrdersModule.tsx");
  if (existsSync(salesOrdersModule)) {
    if (/from\s+["']@prisma\/client["']/.test(readFileSync(salesOrdersModule, "utf8"))) {
      offenders.push(salesOrdersModule);
    }
  }
  if (offenders.length === 0) {
    ok(
      "check-10-frontend-no-prisma",
      "Frontend do módulo de vendas não importa @prisma/client."
    );
  } else {
    fail(
      "check-10-frontend-no-prisma",
      `Frontend importa Prisma em: ${offenders.join(", ")}`
    );
  }
}

async function main(): Promise<void> {
  section("Static — asserções sobre a regra pura + código-fonte");
  checkPureRule();
  checkTableColumn();
  checkClientFilterIntact();
  checkXlsxColumn();
  checkPdfColumn();
  checkRuleIgnoresArAndProposal();
  checkFrontendNoPrisma();

  section("Resumo");
  const total = checks.length;
  const failed = checks.filter((c) => !c.ok);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        total,
        passed: total - failed.length,
        failed: failed.length,
        failedIds: failed.map((c) => c.id),
        verdict: failed.length === 0 ? "OK" : "FALHA",
      },
      null,
      2
    )
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
