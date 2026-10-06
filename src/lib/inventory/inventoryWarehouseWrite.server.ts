/**
 * Criação canônica de InventoryWarehouse — reutilizável por rotas e futuros formulários
 * (ex.: setor com "criar almoxarifado novo"). Sem regras de setor aqui.
 */
import type { InventoryWarehouse } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { writeInventoryAuditLogInTx } from "./inventoryAudit.server.js";
import { serializeInventoryWarehouse } from "./inventorySerialization.server.js";
import type { CreateInventoryWarehouseInput } from "./inventoryValidation.js";
import { InventoryValidationError } from "./inventoryTypes.js";

export const INVENTORY_WAREHOUSE_CODE_DUPLICATE = "INVENTORY_WAREHOUSE_CODE_DUPLICATE";

export type InventoryWarehouseWriteContext = {
  userId: string;
  userName?: string | null;
};

/** PrismaClient ou transação já aberta (setor + almoxarifado na mesma transação). */
export type InventoryWarehouseWriteDb = Pick<
  Prisma.TransactionClient,
  "inventoryWarehouse" | "inventoryAuditLog"
>;

export async function createInventoryWarehouseRecord(
  prisma: InventoryWarehouseWriteDb,
  input: CreateInventoryWarehouseInput,
  context: InventoryWarehouseWriteContext
): Promise<InventoryWarehouse> {
  try {
    const created = await prisma.inventoryWarehouse.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        status: input.status,
        allowsMovements: input.allowsMovements,
        createdByUserId: context.userId,
        updatedByUserId: context.userId,
      },
    });

    await writeInventoryAuditLogInTx(prisma, {
      entityType: "InventoryWarehouse",
      entityId: created.id,
      action: "CREATE",
      afterJson: serializeInventoryWarehouse(created),
      userId: context.userId,
      userName: context.userName ?? null,
    });

    return created;
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new InventoryValidationError(
        "Código de almoxarifado já cadastrado.",
        INVENTORY_WAREHOUSE_CODE_DUPLICATE
      );
    }
    throw e;
  }
}
