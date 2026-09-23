/**
 * Cadastro operacional (Configurações → Estrutura Operacional) — exclusão de cargo.
 *
 * Cargo é obrigatório no colaborador (Employee.roleId) e no roteiro de produção
 * (ProductRouting.roleId), sem cascata: só sai cargo sem uso. O histórico da ficha guarda
 * o nome do cargo em texto (previousRoleName / newRoleName), então segue legível.
 * A regra de quem pode excluir (só SUPER_ADMIN) fica na rota.
 */

import type { PrismaClient } from "@prisma/client";
import { isEmployeeUuid } from "./employeeRegistration.js";
import { isRoleInUse, roleDeleteBlockedMessage, type RoleUsage } from "./settingsOperationalCatalog.js";

export class OperationalCatalogError extends Error {
  code: string;
  status: number;
  usage?: RoleUsage;
  constructor(code: string, message: string, status: number, usage?: RoleUsage) {
    super(message);
    this.name = "OperationalCatalogError";
    this.code = code;
    this.status = status;
    this.usage = usage;
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2003"
  );
}

export async function deleteRoleIfUnused(
  prisma: PrismaClient,
  input: { roleId: string }
): Promise<{ name: string }> {
  if (!isEmployeeUuid(input.roleId)) {
    throw new OperationalCatalogError("INVALID_ID", "Cargo inválido.", 400);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({
        where: { id: input.roleId },
        select: { id: true, name: true },
      });
      if (!role) {
        throw new OperationalCatalogError(
          "NOT_FOUND",
          "Cargo não encontrado (pode já ter sido excluído).",
          404
        );
      }
      const [employees, routings] = await Promise.all([
        tx.employee.count({ where: { roleId: role.id } }),
        tx.productRouting.count({ where: { roleId: role.id } }),
      ]);
      const usage: RoleUsage = { employees, routings };
      if (isRoleInUse(usage)) {
        throw new OperationalCatalogError(
          "ROLE_IN_USE",
          roleDeleteBlockedMessage(role.name, usage),
          409,
          usage
        );
      }
      await tx.role.delete({ where: { id: role.id } });
      return { name: role.name };
    });
  } catch (error) {
    // Corrida: alguém vinculou o cargo entre a contagem e a exclusão — o banco recusa.
    if (isForeignKeyViolation(error)) {
      throw new OperationalCatalogError(
        "ROLE_IN_USE",
        "Não é possível excluir o cargo: ele passou a ser usado por um colaborador ou roteiro. Recarregue a tela e confira.",
        409
      );
    }
    throw error;
  }
}
