import type { Prisma } from "@prisma/client";
import { buildLinkedCustomerSnapshot } from "@/src/lib/projectsCustomerLink.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProjectCustomerLinkData = {
  customerId: string;
  customerName: string;
  customerDocument: string | null;
  customerLinkSource: "LOOKUP" | "CNPJ_RECONCILIATION";
  customerLinkedAt: Date;
};

export type ProjectCustomerLinkResolution =
  | { ok: true; data: ProjectCustomerLinkData }
  | { ok: false; status: number; code: string; error: string };

type CustomerReader = { customer: Pick<Prisma.TransactionClient["customer"], "findUnique"> };

/**
 * Valida o cliente escolhido na busca e devolve o vínculo + snapshot vindo do CADASTRO
 * (o texto enviado pelo navegador é ignorado). Só clientes ativos podem ser vinculados.
 */
export async function resolveProjectCustomerLink(
  db: CustomerReader,
  customerId: unknown,
  now: Date = new Date(),
): Promise<ProjectCustomerLinkResolution> {
  if (typeof customerId !== "string" || !UUID_RE.test(customerId)) {
    return { ok: false, status: 400, code: "INVALID_CUSTOMER_ID", error: "Cliente inválido." };
  }
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, companyName: true, tradeName: true, taxId: true, status: true },
  });
  if (!customer) {
    return { ok: false, status: 400, code: "CUSTOMER_NOT_FOUND", error: "Cliente não encontrado no cadastro." };
  }
  if (customer.status !== "ACTIVE") {
    return { ok: false, status: 400, code: "CUSTOMER_INACTIVE", error: "Cliente inativo no cadastro; não pode ser vinculado." };
  }
  return {
    ok: true,
    data: {
      customerId: customer.id,
      ...buildLinkedCustomerSnapshot(customer),
      customerLinkSource: "LOOKUP",
      customerLinkedAt: now,
    },
  };
}
