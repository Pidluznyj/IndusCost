/**
 * QA — Encerramento de Prestação de Serviço (cálculo gerencial/contratual).
 *
 * Uso:
 *   npx tsx scripts/qaSupplierServiceTermination.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateServiceTermination,
  countWorkedMonthsBetween,
  formatProportionalRestDaysLabel,
} from "../src/lib/suppliers/supplierServiceTerminationCalc.ts";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function ok(label: string) {
  console.log(`OK  ${label}`);
}

section("1. Cálculo 4 meses → 6,67 dias");
{
  const r = calculateServiceTermination({
    monthlyServiceAmount: 6000,
    monthlyHours: 160,
    restDaysPerYear: 20,
    calculationMode: "WORKED_MONTHS",
    workedMonths: 4,
  });
  assert.equal(r.proportionalRestDays, 6.6667);
  assert.equal(formatProportionalRestDaysLabel(r.proportionalRestDays), "6,67");
  ok(`dias proporcionais ${r.proportionalRestDays} (label ${formatProportionalRestDaysLabel(r.proportionalRestDays)})`);
}

section("2. Valor mensal R$ 6.000 → dia R$ 200 e descanso R$ 1.333,33");
{
  const r = calculateServiceTermination({
    monthlyServiceAmount: 6000,
    monthlyHours: 160,
    calculationMode: "WORKED_MONTHS",
    workedMonths: 4,
  });
  assert.equal(r.dailyServiceAmount, 200);
  assert.equal(r.proportionalRestAmount, 1333.33);
  ok(`dia ${r.dailyServiceAmount}, descanso ${r.proportionalRestAmount}`);
}

section("3. Valor hora = mensal / horas");
{
  const r = calculateServiceTermination({
    monthlyServiceAmount: 6000,
    monthlyHours: 160,
    calculationMode: "WORKED_MONTHS",
    workedMonths: 4,
  });
  assert.equal(r.hourlyServiceAmount, 37.5);
  ok(`hora ${r.hourlyServiceAmount}`);
}

section("4. Comissão soma no total sem recalcular");
{
  const r = calculateServiceTermination({
    monthlyServiceAmount: 6000,
    monthlyHours: 160,
    calculationMode: "WORKED_MONTHS",
    workedMonths: 4,
    commissionReportTotal: 500,
  });
  assert.equal(r.proportionalRestAmount, 1333.33);
  assert.equal(r.commissionReportTotal, 500);
  assert.equal(r.totalTerminationAmount, 1833.33);
  const serverSrc = read("src/lib/suppliers/supplierServiceTermination.server.ts");
  assert.match(serverSrc, /searchCommissionReportsForSupplierTermination/);
  assert.match(serverSrc, /Não recalcula|não recalcula|read-only/i);
  assert.doesNotMatch(serverSrc, /recalculateCommission|recalcCommission/);
  ok("comissão vinculada entra como total informado; sem recalc no service");
}

section("5. Finalização trava (código)");
{
  const serverSrc = read("src/lib/suppliers/supplierServiceTermination.server.ts");
  assert.match(serverSrc, /FINALIZED_LOCKED/);
  assert.match(serverSrc, /status === "FINALIZED"/);
  ok("encerramento FINALIZED bloqueia update/cancel automático");
}

section("6. Permissões nas rotas (403 sem permissão)");
{
  const routes = read("src/lib/suppliers/supplierServiceTerminationRoutes.ts");
  assert.match(routes, /suppliers\.serviceTermination\.view/);
  assert.match(routes, /suppliers\.serviceTermination\.create/);
  assert.match(routes, /suppliers\.serviceTermination\.cancel/);
  assert.match(routes, /requireAnyPermission/);
  assert.match(routes, /\/service-terminations/);
  ok("guards requireAnyPermission nos endpoints");
}

section("7. PDF/XLSX com identificação, cálculo, comissão e total");
{
  const serverSrc = read("src/lib/suppliers/supplierServiceTermination.server.ts");
  assert.match(serverSrc, /buildServiceTerminationPdfLines/);
  assert.match(serverSrc, /Encerramento de Prestação de Serviço/);
  assert.match(serverSrc, /Descanso remunerado proporcional/);
  assert.match(serverSrc, /Comissões vinculadas/);
  assert.match(serverSrc, /TOTAL FINAL A PAGAR/);
  assert.match(serverSrc, /gerencial\/contratual/);
  assert.match(serverSrc, /exportSupplierServiceTerminationXlsx/);
  assert.match(serverSrc, /buildMinimalPdfDocument/);
  ok("PDF e XLSX preparados no service");
}

section("8. Frontend não importa Prisma");
{
  const ui = read("src/components/finance/cost-centers/SupplierServiceTerminationDialog.tsx");
  assert.doesNotMatch(ui, /@prisma\/client|from ["'].*prisma/);
  const management = read("src/components/finance/cost-centers/SuppliersManagementView.tsx");
  assert.doesNotMatch(management, /@prisma\/client/);
  const calc = read("src/lib/suppliers/supplierServiceTerminationCalc.ts");
  assert.doesNotMatch(calc, /@prisma\/client|from ["'].*prisma/);
  ok("UI e calc sem Prisma");
}

section("9. Período Mar–Jun 2026 = 4 meses");
{
  assert.equal(countWorkedMonthsBetween("2026-03-01", "2026-06-30"), 4);
  ok("countWorkedMonthsBetween");
}

console.log("\nQA supplier service termination: OK\n");
