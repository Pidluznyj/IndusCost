/**
 * Cadastro de clientes (Comercial › Clientes): POST/PUT/DELETE /api/customers.
 *
 * Incidente de 26/10/2026: um CNPJ já cadastrado gerou P2002 em `prisma.customer.create` e a rejeição derrubou o
 * processo (502 para todos). Agora:
 *   - o documento é comparado pelos DÍGITOS (o banco tem tanto "08.535.015/0001-66" quanto "08535015000166"; o
 *     valor gravado não muda de formato — clientes existentes mantêm a identidade);
 *   - criação/alteração de documento é serializada por documento (lock consultivo de transação) e conferida antes
 *     de gravar; P2002 que ainda assim ocorra (outra origem de gravação) vira o mesmo 409;
 *   - 409 `CUSTOMER_TAX_ID_DUPLICATE` com mensagem fixa e o id do cliente existente; nada é alterado nem duplicado;
 *   - erros inesperados: 500 controlado, sem detalhes internos.
 */
import type express from "express";
import type { RequestHandler } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import { describeErrorForLog, prismaErrorCode } from "@/src/lib/http/expressAsyncSafety.server.js";
import { findCustomerIdByTaxIdDigits } from "./customerTaxIdIdentity.server.js";
import {
  CUSTOMER_TAX_ID_DUPLICATE_CODE,
  CUSTOMER_TAX_ID_DUPLICATE_UI_MESSAGE as CUSTOMER_TAX_ID_DUPLICATE_MESSAGE,
} from "./customerSaveErrors.js";

export { CUSTOMER_TAX_ID_DUPLICATE_CODE, CUSTOMER_TAX_ID_DUPLICATE_MESSAGE };

export class CustomerRecordError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly existingCustomerId?: string;

  constructor(message: string, code: string, httpStatus: number, extras?: { existingCustomerId?: string }) {
    super(message);
    this.name = "CustomerRecordError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.existingCustomerId = extras?.existingCustomerId;
  }
}

function duplicateError(existingCustomerId: string | null): CustomerRecordError {
  return new CustomerRecordError(CUSTOMER_TAX_ID_DUPLICATE_MESSAGE, CUSTOMER_TAX_ID_DUPLICATE_CODE, 409, {
    existingCustomerId: existingCustomerId ?? undefined,
  });
}

function asBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CustomerRecordError("Dados do cliente inválidos.", "INVALID_CUSTOMER_DATA", 400);
  }
  return { ...(body as Record<string, unknown>) };
}

/** Documento trimado (formato preservado) e seus dígitos; vazio → 400. */
function readTaxId(value: unknown): { taxId: string; digits: string } {
  const taxId = typeof value === "string" ? value.trim() : "";
  const digits = normalizeCnpj(taxId);
  if (!digits) throw new CustomerRecordError("Informe o CNPJ/CPF do cliente.", "TAX_ID_REQUIRED", 400);
  return { taxId, digits };
}

/** Serializa, dentro da transação, toda gravação do mesmo documento (inclusive em formatos diferentes). */
async function lockTaxId(tx: Prisma.TransactionClient, digits: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-tax-id:${digits}`}))`;
}

async function mapWriteError(db: PrismaClient, error: unknown, digits: string | null, excludeId?: string): Promise<never> {
  if (error instanceof CustomerRecordError) throw error;
  const code = prismaErrorCode(error);
  if (code === "P2002") {
    throw duplicateError(digits ? await findCustomerIdByTaxIdDigits(db, digits, excludeId).catch(() => null) : null);
  }
  if (code === "P2025") throw new CustomerRecordError("Cliente não encontrado.", "CUSTOMER_NOT_FOUND", 404);
  if (error instanceof Prisma.PrismaClientValidationError) {
    throw new CustomerRecordError("Dados do cliente inválidos ou incompletos.", "INVALID_CUSTOMER_DATA", 400);
  }
  throw error;
}

export async function createCustomerRecord(db: PrismaClient, body: unknown) {
  const data = asBody(body);
  const { taxId, digits } = readTaxId(data.taxId);
  data.taxId = taxId;
  try {
    return await db.$transaction(async (tx) => {
      await lockTaxId(tx, digits);
      const existing = await findCustomerIdByTaxIdDigits(tx, digits);
      if (existing) throw duplicateError(existing);
      return tx.customer.create({ data: data as Prisma.CustomerCreateInput });
    });
  } catch (error) {
    return mapWriteError(db, error, digits);
  }
}

export async function updateCustomerRecord(db: PrismaClient, id: string, body: unknown) {
  const data = asBody(body);
  // Vínculos Person só via endpoints dedicados (people-links), nunca pelo PUT bruto.
  delete data.personId;
  delete data.contactPersonId;
  delete data.person;
  delete data.contactPerson;
  const changesTaxId = Object.prototype.hasOwnProperty.call(data, "taxId");
  const digits = changesTaxId ? readTaxId(data.taxId).digits : null;
  if (changesTaxId) data.taxId = readTaxId(data.taxId).taxId;
  try {
    const customer = await db.$transaction(async (tx) => {
      if (digits) {
        await lockTaxId(tx, digits);
        const existing = await findCustomerIdByTaxIdDigits(tx, digits, id);
        if (existing) throw duplicateError(existing);
      }
      return tx.customer.update({ where: { id }, data: data as Prisma.CustomerUpdateInput });
    });
    return { customer, changedFields: Object.keys(data) };
  } catch (error) {
    return mapWriteError(db, error, digits, id);
  }
}

export async function deleteCustomerRecord(db: PrismaClient, id: string): Promise<void> {
  try {
    await db.customer.delete({ where: { id } });
  } catch (error) {
    if (prismaErrorCode(error) === "P2003") {
      throw new CustomerRecordError(
        "Este cliente tem registros vinculados e não pode ser excluído.",
        "CUSTOMER_HAS_LINKED_RECORDS",
        409
      );
    }
    await mapWriteError(db, error, null);
  }
}

function sendCustomerError(res: express.Response, label: string, error: unknown): void {
  if (error instanceof CustomerRecordError) {
    res.status(error.httpStatus).json({
      error: error.code,
      code: error.code,
      message: error.message,
      ...(error.existingCustomerId
        ? { existingCustomerId: error.existingCustomerId, details: { existingCustomerId: error.existingCustomerId } }
        : {}),
    });
    return;
  }
  console.error(label, describeErrorForLog(error));
  res.status(500).json({
    error: "CUSTOMER_SAVE_FAILED",
    code: "CUSTOMER_SAVE_FAILED",
    message: "Não foi possível salvar o cliente. Tente novamente; se persistir, avise o suporte.",
  });
}

export type CustomerRecordRouteDeps = {
  prisma: PrismaClient;
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  /** Radar Corporativo após alteração de dados de contato/documento (fora da resposta; falha só é registrada). */
  onCustomerContactChanged?: (customerId: string) => Promise<void> | void;
};

const RADAR_WATCHED_FIELDS = ["phone", "email", "address", "city", "state", "zipCode", "taxId"];

export function registerCustomerRecordRoutes(app: express.Express, deps: CustomerRecordRouteDeps): void {
  const { prisma } = deps;

  app.post("/api/customers", deps.requireAppAuth, deps.requireResource("commercial.customers", "create"), async (req, res) => {
    try {
      res.json(await createCustomerRecord(prisma, req.body));
    } catch (error) {
      sendCustomerError(res, "POST /api/customers", error);
    }
  });

  app.put("/api/customers/:id", deps.requireAppAuth, deps.requireResource("commercial.customers", "update"), async (req, res) => {
    try {
      const { customer, changedFields } = await updateCustomerRecord(prisma, req.params.id, req.body);
      if (deps.onCustomerContactChanged && changedFields.some((f) => RADAR_WATCHED_FIELDS.includes(f))) {
        try {
          await deps.onCustomerContactChanged(customer.id);
        } catch (error) {
          console.error("corporate-radar", describeErrorForLog(error));
        }
      }
      res.json(customer);
    } catch (error) {
      sendCustomerError(res, "PUT /api/customers/:id", error);
    }
  });

  app.delete("/api/customers/:id", deps.requireAppAuth, deps.requireResource("commercial.customers", "update"), async (req, res) => {
    try {
      await deleteCustomerRecord(prisma, req.params.id);
      res.json({ success: true });
    } catch (error) {
      sendCustomerError(res, "DELETE /api/customers/:id", error);
    }
  });
}
