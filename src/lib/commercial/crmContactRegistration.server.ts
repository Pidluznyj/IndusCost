/**
 * Registro de contato do CRM Comercial (`CommercialActivity`) — regra canônica.
 *
 * - Responsável comercial: calculado aqui a partir do cliente
 *   (`CrmCustomerCommercialOwner` via `resolveCommercialResponsibleForCustomer`),
 *   nunca vindo do payload. Snapshot do momento do contato: nome em
 *   `assignedTo`, identidade em `commercialOwnerIdentityKey` /
 *   `commercialOwnerExternalSellerId`. Não é vendedor do pedido nem de comissão.
 * - Registrado por: usuário autenticado (id + nome); payload ignorado.
 * - Telefone/e-mail utilizados ficam só no contato; o cadastro do cliente não é
 *   lido para escrita nem alterado.
 * - Validação: `validateCrmContactInput` (crmContactCatalog.ts), a mesma da tela.
 * - Uma única escrita — a próxima ação vive na mesma linha do contato. Validação,
 *   vínculos e responsável são resolvidos antes; qualquer erro não grava nada.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  applyCommercialActivityProposalToCreate,
  applyCommercialActivitySalesOrderToCreate,
  COMMERCIAL_ACTIVITY_API_INCLUDE,
  mapCommercialActivityForApi,
  parseOptionalUuidField,
  resolveCommercialActivityProposalLink,
  resolveCommercialActivitySalesOrderLink,
} from "@/src/lib/commercialActivityApi.js";
import {
  resolveCommercialResponsibleForCustomer,
  type CommercialResponsibleInjection,
} from "./crmCommercialResponsibleResolver.js";
import {
  deriveCrmContactStatus,
  firstCrmContactError,
  validateCrmContactInput,
  type CrmContactFieldErrors,
} from "./crmContactCatalog.js";

export type CrmContactActor = { id: string; name: string };

export type CrmContactRegistrationDb = Pick<
  PrismaClient,
  "customer" | "commercialActivity" | "salesOrder" | "proposal"
>;

export type CrmContactRegistrationDeps = {
  /** Injeção para teste; padrão = resolvedor oficial (dono manual ativo). */
  resolveCommercialOwner?: (customerId: string) => Promise<CommercialResponsibleInjection>;
};

export type CrmContactCommercialOwner = {
  name: string;
  identityKey: string | null;
  externalSellerId: number | null;
};

export type CrmContactContext = {
  customer: {
    id: string;
    displayName: string;
    taxId: string;
    phone: string | null;
    email: string | null;
  };
  /** null = "Cliente sem responsável comercial". */
  commercialOwner: CrmContactCommercialOwner | null;
  registeredBy: CrmContactActor;
};

export type CrmContactRegistrationResult =
  | { ok: true; activity: ReturnType<typeof mapCommercialActivityForApi> }
  | { ok: false; status: 400 | 404; error: string; fieldErrors?: CrmContactFieldErrors };

function toOwnerSnapshot(owner: CommercialResponsibleInjection): CrmContactCommercialOwner | null {
  const name = owner?.sellerCanonicalName?.trim();
  if (!owner || !name) return null;
  return {
    name,
    identityKey: owner.sellerIdentityKey ?? null,
    externalSellerId: owner.sellerExternalId ?? null,
  };
}

async function resolveOwner(
  customerId: string,
  deps: CrmContactRegistrationDeps
): Promise<CrmContactCommercialOwner | null> {
  const resolve = deps.resolveCommercialOwner ?? resolveCommercialResponsibleForCustomer;
  return toOwnerSnapshot(await resolve(customerId));
}

/**
 * Dados que o modal mostra antes de salvar — calculados com a MESMA regra da
 * gravação (responsável e usuário não vêm da tela).
 */
export async function loadCrmContactContext(
  db: Pick<PrismaClient, "customer">,
  input: { customerId: string; actor: CrmContactActor },
  deps: CrmContactRegistrationDeps = {}
): Promise<CrmContactContext | null> {
  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, companyName: true, taxId: true, phone: true, email: true },
  });
  if (!customer) return null;
  return {
    customer: {
      id: customer.id,
      displayName: customer.companyName,
      taxId: customer.taxId,
      phone: customer.phone?.trim() || null,
      email: customer.email?.trim() || null,
    },
    commercialOwner: await resolveOwner(customer.id, deps),
    registeredBy: { id: input.actor.id, name: input.actor.name },
  };
}

/**
 * Registra o contato. `body` é o payload da tela; dele só saem os campos do
 * contato — responsável, usuário e status são sempre calculados aqui.
 */
export async function registerCrmContact(
  db: CrmContactRegistrationDb,
  input: { customerId: string; body: Record<string, unknown>; actor: CrmContactActor },
  deps: CrmContactRegistrationDeps = {}
): Promise<CrmContactRegistrationResult> {
  const { customerId, body, actor } = input;
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) return { ok: false, status: 404, error: "Cliente não encontrado." };

  const validation = validateCrmContactInput({
    contactDate: body.contactDate,
    channel: body.channel,
    reason: body.reason,
    result: body.result,
    summary: body.summary,
    nextActionType: body.nextActionType,
    nextActionAt: body.nextActionAt,
    nextActionDescription: body.nextActionDescription,
    phoneUsed: body.phoneUsed,
    emailUsed: body.emailUsed,
  });
  if (validation.ok === false) {
    return {
      ok: false,
      status: 400,
      error: firstCrmContactError(validation.errors) ?? "Dados do contato inválidos.",
      fieldErrors: validation.errors,
    };
  }
  const contact = validation.value;

  const salesOrderId = parseOptionalUuidField(body.salesOrderId);
  if (salesOrderId === "INVALID") {
    return { ok: false, status: 400, error: "salesOrderId inválido." };
  }
  const proposalId = parseOptionalUuidField(body.proposalId);
  if (proposalId === "INVALID") {
    return { ok: false, status: 400, error: "proposalId inválido." };
  }
  const salesOrderLink = await resolveCommercialActivitySalesOrderLink(
    customerId,
    salesOrderId ?? undefined,
    db
  );
  if (salesOrderLink.ok === false) return { ok: false, status: 400, error: salesOrderLink.error };
  const proposalLink = await resolveCommercialActivityProposalLink(
    customerId,
    proposalId ?? undefined,
    db
  );
  if (proposalLink.ok === false) return { ok: false, status: 400, error: proposalLink.error };

  // Falha ao ler o responsável sobe como erro: nada é gravado.
  const owner = await resolveOwner(customerId, deps);

  const data: Prisma.CommercialActivityCreateInput = {
    Customer: { connect: { id: customerId } },
    activityType: contact.reason,
    status: deriveCrmContactStatus(contact.nextActionType),
    contactDate: contact.contactDate,
    channel: contact.channel,
    reason: contact.reason,
    outcome: contact.result,
    description: contact.summary,
    nextActionType: contact.nextActionType,
    nextActionAt: contact.nextActionAt,
    nextActionDescription: contact.nextActionDescription,
    assignedTo: owner?.name ?? null,
    commercialOwnerIdentityKey: owner?.identityKey ?? null,
    commercialOwnerExternalSellerId: owner?.externalSellerId ?? null,
    createdByUserId: actor.id,
    createdByName: actor.name,
    createdByPhone: contact.phoneUsed,
    createdByEmail: contact.emailUsed,
  };
  applyCommercialActivitySalesOrderToCreate(data, salesOrderId ?? undefined);
  applyCommercialActivityProposalToCreate(data, proposalId ?? undefined);

  const created = await db.commercialActivity.create({
    data,
    include: COMMERCIAL_ACTIVITY_API_INCLUDE,
  });
  return { ok: true, activity: mapCommercialActivityForApi(created) };
}
