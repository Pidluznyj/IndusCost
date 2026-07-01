#!/usr/bin/env npx tsx
/**
 * Auditoria da precificação comercial do projeto — preços com e sem amortização.
 *
 * Uso:
 *   npx tsx scripts/audit-project-commercial-pricing-amortization.ts
 *   npx tsx scripts/audit-project-commercial-pricing-amortization.ts --projectId=<uuid>
 */
import { prisma } from "../src/lib/prisma.js";
import { calculateSalePriceFromCost } from "../src/lib/pricingCalculations.js";
import {
  serializeTaxRulesForProjectPricing,
} from "../src/lib/projectsPricing.js";
import { loadProjectCostAmortizations } from "../src/lib/projectsCostAmortizationService.js";
import { loadProjectDetail } from "../src/lib/projectsService.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function nearlyEqual(a: number | null, b: number | null, epsilon = 0.000001): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) <= epsilon;
}

type AuditStatus = "OK" | "ALERTA" | "BLOQUEANTE";

async function auditProject(projectId: string): Promise<{ status: AuditStatus; notes: string[] }> {
  const notes: string[] = [];
  const statuses: AuditStatus[] = [];

  const detail = await loadProjectDetail(projectId);
  if (!detail) {
    return { status: "BLOQUEANTE", notes: [`Projeto ${projectId} não encontrado.`] };
  }

  const [taxRulesRaw, amortizations, configRow] = await Promise.all([
    prisma.taxRule.findMany({
      where: { status: "ACTIVE" },
      include: { TaxComponent: true },
      orderBy: { name: "asc" },
    }),
    loadProjectCostAmortizations(projectId),
    prisma.projectPricingConfig.findUnique({
      where: { projectId },
      include: { items: true },
    }),
  ]);

  const taxRules = serializeTaxRulesForProjectPricing(taxRulesRaw);
  const defaultFiscalRuleId = configRow?.fiscalRuleId ?? null;
  const defaultTaxRule = taxRules.find((rule) => rule.id === defaultFiscalRuleId);
  const defaultMargin =
    configRow?.defaultMarginPercent != null
      ? Number(configRow.defaultMarginPercent)
      : detail.targetMarginPercent;

  const { buildProjectPricingView } = await import("../src/lib/projectsPricing.js");
  const view = buildProjectPricingView({
    detail,
    taxRules,
    config: {
      fiscalRuleId: defaultFiscalRuleId,
      defaultMarginPercent: defaultMargin,
    },
    savedItems: [],
    savedAmortizations: amortizations,
  });

  if (view.items.length === 0) {
    notes.push("Nenhum item elegível para precificação.");
    return { status: "ALERTA", notes };
  }

  for (const item of view.items) {
    if (item.finalUnitCost <= 0) continue;
    if (item.costBaseUnit == null || !Number.isFinite(item.costBaseUnit)) {
      statuses.push("BLOQUEANTE");
      notes.push(`${item.displayName}: custo base ausente.`);
    }
    if (!Number.isFinite(item.amortizationUnitCost)) {
      statuses.push("BLOQUEANTE");
      notes.push(`${item.displayName}: amortização unitária inválida.`);
    }
    if (!Number.isFinite(item.finalUnitCost)) {
      statuses.push("BLOQUEANTE");
      notes.push(`${item.displayName}: custo final inválido.`);
    }

    const expectedWithout = calculateSalePriceFromCost({
      cost: item.costBaseUnit,
      taxPercent: item.taxPercent,
      targetMarginPercent: item.targetMarginPercent,
    });
    const expectedWith = calculateSalePriceFromCost({
      cost: item.finalUnitCost,
      taxPercent: item.taxPercent,
      targetMarginPercent: item.targetMarginPercent,
    });

    if (item.status === "CALCULATED") {
      if (!expectedWithout.ok || !expectedWith.ok) {
        statuses.push("BLOQUEANTE");
        notes.push(`${item.displayName}: motor oficial retornou erro inesperado.`);
        continue;
      }
      if (!nearlyEqual(item.suggestedPriceWithoutAmortization, expectedWithout.suggestedPrice)) {
        statuses.push("BLOQUEANTE");
        notes.push(`${item.displayName}: preço s/ amortização não usa custo base.`);
      }
      if (!nearlyEqual(item.suggestedPriceWithAmortization, expectedWith.suggestedPrice)) {
        statuses.push("BLOQUEANTE");
        notes.push(`${item.displayName}: preço c/ amortização não usa custo final.`);
      }
      if (!nearlyEqual(item.suggestedPrice, item.suggestedPriceWithAmortization)) {
        statuses.push("BLOQUEANTE");
        notes.push(`${item.displayName}: suggestedPrice diverge do preço c/ amortização.`);
      }
      if (item.amortizationUnitCost > 0) {
        if (
          item.suggestedPriceWithoutAmortization != null &&
          item.suggestedPriceWithAmortization != null &&
          item.suggestedPriceWithAmortization <= item.suggestedPriceWithoutAmortization
        ) {
          statuses.push("ALERTA");
          notes.push(`${item.displayName}: preço c/ amortização deveria ser maior que s/ amortização.`);
        }
      } else if (
        !nearlyEqual(item.suggestedPriceWithoutAmortization, item.suggestedPriceWithAmortization)
      ) {
        statuses.push("ALERTA");
        notes.push(`${item.displayName}: amortização zero mas preços divergem.`);
      }
    }

    const saved = configRow?.items.find((row) => row.targetItemId === item.targetItemId);
    if (saved?.suggestedPriceWithoutAmortization != null && item.status === "CALCULATED") {
      const savedWithout = Number(saved.suggestedPriceWithoutAmortization);
      if (!nearlyEqual(savedWithout, item.suggestedPriceWithoutAmortization)) {
        statuses.push("ALERTA");
        notes.push(`${item.displayName}: snapshot salvo s/ amortização diverge do motor.`);
      }
    }
  }

  if (statuses.includes("BLOQUEANTE")) return { status: "BLOQUEANTE", notes };
  if (statuses.includes("ALERTA")) return { status: "ALERTA", notes };
  return { status: "OK", notes: notes.length ? notes : ["Todos os itens validados."] };
}

async function main() {
  const projectId = parseArg("projectId");
  console.log("Auditoria precificação comercial — preços com/sem amortização\n");

  if (projectId) {
    const result = await auditProject(projectId);
    console.log(`Projeto: ${projectId}`);
    for (const note of result.notes) console.log(`- ${note}`);
    console.log(`\nResultado: ${result.status}`);
    if (result.status === "BLOQUEANTE") process.exitCode = 1;
    return;
  }

  const projects = await prisma.project.findMany({
    select: { id: true, code: true, title: true },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });

  if (projects.length === 0) {
    console.log("Nenhum projeto encontrado.");
    return;
  }

  let worst: AuditStatus = "OK";
  for (const project of projects) {
    const result = await auditProject(project.id);
    console.log(`${project.code} — ${project.title}: ${result.status}`);
    for (const note of result.notes.slice(0, 3)) console.log(`  - ${note}`);
    if (result.status === "BLOQUEANTE") worst = "BLOQUEANTE";
    else if (result.status === "ALERTA" && worst === "OK") worst = "ALERTA";
  }
  console.log(`\nResultado geral: ${worst}`);
  if (worst === "BLOQUEANTE") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
