/**
 * QA — Vencimento CR no Cronograma × baixas (Auditoria 360º > Comissões).
 *
 * Uso: npx tsx scripts/qaOrderFullAuditCommissionScheduleDueDate.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
type Check = { id: string; ok: boolean; detail: string };
const checks: Check[] = [];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function ok(id: string, detail: string): void {
  checks.push({ id, ok: true, detail });
  console.log(`OK   ${id} — ${detail}`);
}

function fail(id: string, detail: string): void {
  checks.push({ id, ok: false, detail });
  console.log(`FAIL ${id} — ${detail}`);
}

function section(t: string): void {
  console.log(`\n=== ${t} ===`);
}

function main(): void {
  console.log("=== qaOrderFullAuditCommissionScheduleDueDate ===");

  section("1 DTO + service");
  const service = read("src/lib/finance/orderFullAuditService.ts");
  const client = read("src/lib/finance/orderFullAuditClient.ts");

  if (
    service.includes("receivableDueDate") &&
    service.includes("receivableDueDateFormatted") &&
    client.includes("receivableDueDate") &&
    client.includes("receivableDueDateFormatted")
  ) {
    ok("1-dto", "DTO service+client com receivableDueDate(+Formatted)");
  } else {
    fail("1-dto", "campos receivableDueDate ausentes no DTO");
  }

  if (
    service.includes("NomusAccountsReceivable") ||
    (service.includes("nomusAccountsReceivable") &&
      service.includes("dueDate") &&
      service.includes("dueByReceivableExternalId"))
  ) {
    ok(
      "1-source",
      "vencimento resolvido via CR oficial (mapa dueDate / fallback Nomus)"
    );
  } else {
    fail("1-source", "service não resolve dueDate do CR oficial");
  }

  if (
    service.includes('replace(/-/g, "/")') ||
    service.includes("formatReceivableDueDateSlash")
  ) {
    ok("1-format", "formatter YYYY/MM/DD presente no service");
  } else {
    fail("1-format", "formatter YYYY/MM/DD ausente");
  }

  if (
    service.includes("readOnly: true") &&
    !/scheduledCommissionAmount\s*=/.test(service) &&
    service.includes("CommissionOrderSnapshot")
  ) {
    ok(
      "1-readonly-calc",
      "bloco comissão continua read-only / snapshot (sem recalcular)"
    );
  } else {
    fail("1-readonly-calc", "indício de alteração de cálculo de comissão");
  }

  section("2 UI Cronograma × baixas");
  const dialog = read(
    "src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx"
  );

  if (dialog.includes("Vencimento CR")) {
    ok("2-column", 'coluna "Vencimento CR" na tabela do cronograma');
  } else {
    fail("2-column", 'coluna "Vencimento CR" ausente');
  }

  if (dialog.includes("receivableDueDateFormatted")) {
    ok("2-bind", "UI lê receivableDueDateFormatted");
  } else {
    fail("2-bind", "UI não usa receivableDueDateFormatted");
  }

  if (
    /Pagamento comissão|Pgto\.\s*comissão|commissionPaymentPeriod|paymentCommissionPeriod/.test(
      dialog
    ) &&
    dialog.includes("Cronograma (CommissionReceivableSchedule)")
  ) {
    // Só falha se estiver no bloco do cronograma — buscamos trecho próximo.
    const schedIdx = dialog.indexOf("Cronograma (CommissionReceivableSchedule)");
    const baixasIdx = dialog.indexOf("Baixas (CommissionReceiptLedgerLine)");
    const schedChunk =
      schedIdx >= 0 && baixasIdx > schedIdx
        ? dialog.slice(schedIdx, baixasIdx)
        : "";
    if (
      /Pagamento comissão|Pgto\.\s*comissão|commissionPaymentPeriod|paymentCommissionPeriod/.test(
        schedChunk
      )
    ) {
      fail(
        "2-no-payment-col",
        'coluna indevida "Pagamento comissão" no cronograma'
      );
    } else {
      ok(
        "2-no-payment-col",
        'sem coluna "Pagamento comissão" no Cronograma × baixas'
      );
    }
  } else {
    ok(
      "2-no-payment-col",
      'sem coluna "Pagamento comissão" no Cronograma × baixas'
    );
  }

  if (
    dialog.includes("Data baixa") &&
    dialog.includes("Baixas (CommissionReceiptLedgerLine)")
  ) {
    ok("2-baixas-date", "tabela de baixas mantém Data baixa");
  } else {
    fail("2-baixas-date", "Data baixa ausente nas baixas");
  }

  if (
    dialog.includes("commissions.receivableSchedule") &&
    dialog.includes('?? "—"')
  ) {
    ok("2-dash", 'linha sem vencimento pode exibir "—"');
  } else {
    fail("2-dash", 'fallback "—" não encontrado');
  }

  if (dialog.includes("readOnly") || dialog.includes("Read-only")) {
    ok("2-readonly-ui", "UI de comissões permanece read-only");
  } else {
    fail("2-readonly-ui", "disclaimer/read-only ausente na UI");
  }

  section("3 Frontend sem Prisma");
  if (!/@prisma\/client|from ["']@\/src\/lib\/prisma/.test(dialog)) {
    ok("3-no-prisma-dialog", "OrderFullAuditDialog sem Prisma");
  } else {
    fail("3-no-prisma-dialog", "Dialog importa Prisma");
  }
  if (!/@prisma\/client|from ["']@\/src\/lib\/prisma/.test(client)) {
    ok("3-no-prisma-client", "orderFullAuditClient sem Prisma");
  } else {
    fail("3-no-prisma-client", "client importa Prisma");
  }

  section("4 Documentação");
  const docs = read("docs/finance/order-full-audit-dialog.md");
  if (
    docs.includes("Cronograma × baixas") &&
    docs.includes("Vencimento CR") &&
    docs.includes("YYYY/MM/DD") &&
    docs.includes("NomusAccountsReceivable.dueDate")
  ) {
    ok("4-docs", "docs documentam Vencimento CR + fonte + formato");
  } else {
    fail("4-docs", "documentação incompleta");
  }

  section("5 Formato YYYY/MM/DD (unitário local)");
  const sampleIso = "2026-06-18T00:00:00.000Z";
  const key = /^(\d{4})-(\d{2})-(\d{2})/.exec(sampleIso);
  const formatted = key ? `${key[1]}/${key[2]}/${key[3]}` : null;
  if (formatted === "2026/06/18") {
    ok("5-format-example", `exemplo ${formatted}`);
  } else {
    fail("5-format-example", `formato inesperado: ${formatted}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(
    `\n${failed.length === 0 ? "✔" : "✖"} ${checks.length - failed.length}/${checks.length} checks OK`
  );
  if (failed.length > 0) process.exit(1);
}

main();
