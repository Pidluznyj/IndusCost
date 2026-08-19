/**
 * Compras — resolução das seleções OFICIAIS do cabeçalho/linhas.
 *
 * O formulário deixou de aceitar texto livre para solicitante, departamento,
 * categoria e centro de custo: o cliente envia IDs de cadastros oficiais e o
 * SERVIDOR deriva os snapshots de texto. O texto digitado pelo usuário nunca é
 * autoridade — "Faricação" no lugar de "Fabricação" é exatamente o dado que
 * esta camada elimina.
 *
 * Compatibilidade: o payload legado (texto puro, sem IDs) continua aceito e
 * intocado — fluxos como o shadow purchase planning seguem funcionando. Os IDs
 * têm precedência quando presentes.
 *
 * Centro de custo: o cadastro OFICIAL é o financeiro (FinancialCostCenter).
 * Como o domínio de compras (cotações/POs/movimentos) referencia o cadastro
 * operacional (CostCenter), o financeiro é ESPELHADO por `code` (upsert) e o
 * espelho preenche as FKs legadas. Uma fonte de verdade, um cache derivado.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export class PurchaseSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseSelectionError";
  }
}

export type OfficialHeaderSelectionInput = {
  requesterEmployeeId?: string | null;
  requestCategoryId?: string | null;
  defaultFinancialCostCenterId?: string | null;
};

export type OfficialHeaderSelectionResult = {
  /** Snapshot derivado — nome do funcionário. Nulo quando payload legado. */
  requester: string | null;
  /** Snapshot derivado — setor do funcionário. */
  department: string | null;
  /** Snapshot derivado — nome da categoria. */
  requestCategory: string | null;
  requesterEmployeeId: string | null;
  requestCategoryId: string | null;
  defaultFinancialCostCenterId: string | null;
  /** CostCenter operacional espelhado do financeiro (compat downstream). */
  mirroredCostCenterId: string | null;
};

/**
 * Espelha um FinancialCostCenter ATIVO no cadastro operacional por `code`.
 * Devolve o id operacional. Nome é atualizado a cada espelhamento — o
 * financeiro manda.
 */
export async function mirrorFinancialCostCenter(
  tx: Tx,
  financialCostCenterId: string
): Promise<{ operationalId: string; financialId: string }> {
  const fcc = await tx.financialCostCenter.findUnique({
    where: { id: financialCostCenterId },
    select: { id: true, code: true, name: true, status: true },
  });
  if (!fcc) {
    throw new PurchaseSelectionError("Centro de custo não encontrado.");
  }
  if (fcc.status !== "ACTIVE") {
    throw new PurchaseSelectionError(
      `Centro de custo ${fcc.code} está inativo.`
    );
  }
  const mirrored = await tx.costCenter.upsert({
    where: { code: fcc.code },
    create: { code: fcc.code, name: fcc.name, isActive: true },
    update: { name: fcc.name, isActive: true },
    select: { id: true },
  });
  return { operationalId: mirrored.id, financialId: fcc.id };
}

/** Resolve as seleções oficiais do cabeçalho; IDs ausentes ficam nulos. */
export async function resolveOfficialHeaderSelections(
  tx: Tx,
  input: OfficialHeaderSelectionInput
): Promise<OfficialHeaderSelectionResult> {
  const result: OfficialHeaderSelectionResult = {
    requester: null,
    department: null,
    requestCategory: null,
    requesterEmployeeId: null,
    requestCategoryId: null,
    defaultFinancialCostCenterId: null,
    mirroredCostCenterId: null,
  };

  if (input.requesterEmployeeId) {
    const employee = await tx.employee.findUnique({
      where: { id: input.requesterEmployeeId },
      select: { id: true, name: true, department: true, status: true },
    });
    if (!employee) {
      throw new PurchaseSelectionError("Solicitante não encontrado.");
    }
    if ((employee.status ?? "ACTIVE") !== "ACTIVE") {
      throw new PurchaseSelectionError(
        `Funcionário ${employee.name} está inativo.`
      );
    }
    const department = employee.department?.trim();
    if (!department) {
      throw new PurchaseSelectionError(
        `Funcionário ${employee.name} está sem setor no cadastro — corrija em Funcionários antes de solicitar.`
      );
    }
    result.requesterEmployeeId = employee.id;
    result.requester = employee.name.trim();
    result.department = department;
  }

  if (input.requestCategoryId) {
    const category = await tx.purchaseRequestCategory.findUnique({
      where: { id: input.requestCategoryId },
      select: { id: true, name: true, isActive: true },
    });
    if (!category) {
      throw new PurchaseSelectionError("Categoria não encontrada.");
    }
    if (!category.isActive) {
      throw new PurchaseSelectionError(
        `Categoria ${category.name} está inativa.`
      );
    }
    result.requestCategoryId = category.id;
    result.requestCategory = category.name;
  }

  if (input.defaultFinancialCostCenterId) {
    const mirror = await mirrorFinancialCostCenter(
      tx,
      input.defaultFinancialCostCenterId
    );
    result.defaultFinancialCostCenterId = mirror.financialId;
    result.mirroredCostCenterId = mirror.operationalId;
  }

  return result;
}
