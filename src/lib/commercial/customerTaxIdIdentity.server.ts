/**
 * Identidade do cliente pelo documento (CNPJ/CPF). `Customer.taxId` é único como TEXTO, mas o banco guarda dois
 * formatos (o Nomus e a Inteligência de CNPJ gravam só dígitos; o cadastro manual grava como digitado, ex.:
 * "08.535.015/0001-66"). A duplicidade, portanto, é decidida pelos DÍGITOS — sem reformatar registros existentes.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

type CustomerDb = Pick<PrismaClient, "$queryRaw">;

/** Cliente com o mesmo documento (só dígitos), qualquer que seja o formato gravado. O mais antigo primeiro. */
export async function findCustomerIdByTaxIdDigits(db: CustomerDb, digits: string, excludeId?: string): Promise<string | null> {
  if (!digits) return null;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM "Customer"
    WHERE regexp_replace("taxId", '[^0-9]', '', 'g') = ${digits}
    ${excludeId ? Prisma.sql`AND id <> ${excludeId}::uuid` : Prisma.empty}
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  return rows[0]?.id ?? null;
}
