import { createHash } from "node:crypto";
import {
  planProjectCustomerReconciliation,
  reconciliationTokenSource,
  type ReconciliationEntry,
} from "@/src/lib/projectsCustomerLink.js";

/**
 * Conciliação Projeto → Cliente por CNPJ/CPF (dry-run + aplicação confirmada).
 * Grava só customerId/customerLinkSource/customerLinkedAt; o snapshot textual do projeto
 * (customerName/customerDocument usados nas emissões anteriores) NÃO é alterado.
 */

type ReconciliationDb = {
  project: {
    findMany(args: {
      select: { id: true; code: true; customerName: true; customerDocument: true; customerId: true };
    }): Promise<{ id: string; code: string; customerName: string; customerDocument: string | null; customerId: string | null }[]>;
    updateMany(args: {
      where: { id: string; customerId: null };
      data: { customerId: string; customerLinkSource: string; customerLinkedAt: Date };
    }): Promise<{ count: number }>;
  };
  customer: {
    findMany(args: {
      select: { id: true; companyName: true; tradeName: true; taxId: true; status: true };
    }): Promise<{ id: string; companyName: string; tradeName: string | null; taxId: string; status: string }[]>;
  };
};

export function reconciliationConfirmToken(entries: readonly ReconciliationEntry[]): string {
  return createHash("sha256").update(reconciliationTokenSource(entries)).digest("hex").slice(0, 12);
}

export async function buildProjectCustomerReconciliationPlan(db: ReconciliationDb): Promise<ReconciliationEntry[]> {
  const projects = await db.project.findMany({
    select: { id: true, code: true, customerName: true, customerDocument: true, customerId: true },
  });
  // taxId é texto livre (Nomus: só dígitos; manual: formatado), então a comparação por dígitos
  // é feita em memória sobre todo o cadastro — execução pontual, sem filtro por nome.
  const customers = await db.customer.findMany({
    select: { id: true, companyName: true, tradeName: true, taxId: true, status: true },
  });
  return planProjectCustomerReconciliation(projects, customers);
}

export async function applyProjectCustomerReconciliation(
  db: ReconciliationDb,
  entries: readonly ReconciliationEntry[],
  now: Date = new Date(),
): Promise<{ linked: number; skippedChanged: string[] }> {
  let linked = 0;
  const skippedChanged: string[] = [];
  for (const e of entries) {
    if (e.status !== "LINK" || !e.customerId) continue;
    // Condicional: só grava se o projeto continua sem vínculo (não sobrescreve escolha manual).
    const r = await db.project.updateMany({
      where: { id: e.projectId, customerId: null },
      data: { customerId: e.customerId, customerLinkSource: "CNPJ_RECONCILIATION", customerLinkedAt: now },
    });
    if (r.count === 1) linked += 1;
    else skippedChanged.push(e.projectCode);
  }
  return { linked, skippedChanged };
}
