/**
 * Fixtures de teste de CRM > Relatórios (camada de serviço): carteira, clientes,
 * pedidos, responsáveis e atividades fixos + um CrmReportsDataSource falso que
 * executa em memória o where CANÔNICO real (via crmReportsPrisma.fixtures).
 *
 * Compartilhado pelos testes das listas, do relatório personalizado e da
 * exportação — a mesma base prova que tudo sai do mesmo pipeline.
 *
 * Uso exclusivo de testes.
 */

import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { resolveCrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import { fetchCrmManualOwnerCustomerIds } from "@/src/lib/crmCustomersList.js";
import type { CommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.js";
import { parseCrmReportsOperationalRequest } from "./crmReportsOperationalCore.js";
import type { CrmReportsDataSource, CrmReportsRun } from "./crmReportsOperationalService.server.js";
import type { CrmReportsNormalizedRequest } from "./crmReportsTypes.js";
import { matchesPrismaWhere, type FixtureRow } from "./crmReportsPrisma.fixtures.js";

export const matchesWhere = matchesPrismaWhere;
export type Row = FixtureRow;

// ---------------------------------------------------------------------------
// Fixtures (hoje = 11/09/2026)
// ---------------------------------------------------------------------------

export const NOW = new Date(2026, 8, 11, 10, 0, 0);
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export type FakeCustomer = {
  id: string;
  companyName: string;
  tradeName: string | null;
  taxId: string;
  city: string | null;
  state: string | null;
  status: string;
};

export type FakeOrder = {
  id: string;
  customerId: string;
  orderCode: string;
  issueDate: Date;
  totalNetValue: number;
  externalSellerId: number | null;
  nomusSellerName: string | null;
  status: string;
  sourcePresenceStatus: string;
  createdAt: Date;
};

export type FakeOwner = {
  customerId: string;
  isActive: boolean;
  sellerIdentityKey: string;
  sellerExternalId: number | null;
  sellerAliasExternalIds: number[];
  sellerCanonicalName: string;
};

export const customer = (n: number, companyName: string, extra: Partial<FakeCustomer> = {}): FakeCustomer => ({
  id: uuid(n),
  companyName,
  tradeName: null,
  taxId: `11.111.111/0001-${String(n).padStart(2, "0")}`,
  city: "Curitiba",
  state: "PR",
  status: "ACTIVE",
  ...extra,
});

let seq = 0;
export function order(
  customerId: string,
  ymd: string,
  value: number,
  extra: Partial<FakeOrder> = {}
): FakeOrder {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  seq += 1;
  return {
    id: `order-${String(seq).padStart(5, "0")}`,
    customerId,
    orderCode: `PD ${String(seq).padStart(5, "0")}`,
    issueDate: new Date(y, m - 1, d, 10, 0, 0),
    totalNetValue: value,
    externalSellerId: null,
    nomusSellerName: null,
    status: "SENT_TO_NOMUS",
    sourcePresenceStatus: "PRESENT",
    // createdAt recente de propósito: o eixo é issueDate, nunca criação.
    createdAt: new Date(2026, 8, 10, 9, 0, 0),
    ...extra,
  };
}

export const owner = (customerId: string, key: string, sellerId: number, isActive = true): FakeOwner => ({
  customerId,
  isActive,
  sellerIdentityKey: key,
  sellerExternalId: sellerId,
  sellerAliasExternalIds: [sellerId],
  sellerCanonicalName: key.replace(/\b\w/g, (c) => c.toUpperCase()),
});

// Carteira: Gislene (Nomus 464) e Joseane (Nomus 501).
export const A = customer(1, "Alfa Ltda");
export const B = customer(2, "Beta SA");
export const C = customer(3, "Gama Comércio");
export const D = customer(4, "Delta Indústria");
export const K = customer(5, "Koppetel Indústria", { taxId: "72.569.510/0001-95" }); // grupo econômico
export const X = customer(6, "Xis Inativo", { status: "INACTIVE" });
export const M = customer(7, "Mu Presença");

export function baseDb() {
  return {
    customers: [A, B, C, D, K, X, M],
    orders: [
      order(A.id, "2026-06-01", 1000, { externalSellerId: 501 }),
      order(A.id, "2026-07-01", 1500, { externalSellerId: 501 }),
      // ERROR entra: a população oficial só tira CANCELLED.
      order(A.id, "2026-07-31", 500.1, { externalSellerId: 501, status: "ERROR" }),
      // CANCELLED nunca é compra.
      order(A.id, "2026-09-10", 99999, { externalSellerId: 501, status: "CANCELLED" }),
      // Vendedor Nomus dos pedidos de B é a Gislene — isso NÃO põe B na carteira dela.
      order(B.id, "2026-08-15", 800, { externalSellerId: 464 }),
      order(B.id, "2026-09-05", 800, { externalSellerId: 464 }),
      order(C.id, "2026-09-01", 750, { externalSellerId: 464 }),
      order(K.id, "2026-09-02", 5000, { externalSellerId: 464 }),
      order(X.id, "2026-09-03", 5000, { externalSellerId: 464 }),
      order(M.id, "2026-06-20", 100, { externalSellerId: 464 }),
      order(M.id, "2026-08-20", 100, { externalSellerId: 464, sourcePresenceStatus: "MISSING_CONFIRMED" }),
    ],
    owners: [
      owner(A.id, "gislene lima", 464),
      owner(B.id, "joseane souza", 501),
      owner(C.id, "gislene lima", 464, false), // responsável INATIVO
      owner(K.id, "gislene lima", 464),
      owner(X.id, "gislene lima", 464),
      owner(M.id, "gislene lima", 464),
    ],
    activities: [
      { customerId: A.id, contactDate: new Date(2026, 8, 1, 9), createdAt: new Date(2026, 8, 1, 9), nextActionAt: new Date(2026, 8, 5, 9), status: "OPEN" },
      { customerId: A.id, contactDate: null, createdAt: new Date(2026, 8, 8, 9), nextActionAt: new Date(2026, 8, 20, 9), status: "OPEN" },
      // Atividade NÃO cria compra: D continua sem histórico.
      { customerId: D.id, contactDate: new Date(2026, 8, 9, 9), createdAt: new Date(2026, 8, 9, 9), nextActionAt: null, status: "DONE" },
    ],
    // NF e proposta existem no mundo, mas o relatório não tem acesso a elas.
    invoicesWithoutOrder: [{ customerId: D.id, nfeNumber: "12345", dataProcessamento: new Date(2026, 8, 1) }],
    proposals: [{ customerId: D.id, status: "WON", createdAt: new Date(2026, 8, 2) }],
    sellerCtx: {
      persons: [
        { id: "p-464", nomusPersonId: 464, name: "GISLENE LIMA", type: "SELLER", source: "NOMUS", active: true },
        { id: "p-501", nomusPersonId: 501, name: "JOSEANE SOUZA", type: "SELLER", source: "NOMUS", active: true },
      ],
      aliases: [],
    } satisfies CommissionSellerIdentityContext,
  };
}

export type FakeDb = ReturnType<typeof baseDb>;

export function createFakeDataSource(db: FakeDb) {
  const calls = {
    findCustomers: [] as unknown[],
    findManualOwnerCustomerIds: 0,
    findSalesOrders: [] as unknown[],
    resolveCommercialOwners: [] as string[][],
    findActivities: [] as string[][],
    loadSellerIdentityContext: 0,
    searchCustomers: [] as Array<{ where: unknown; take: number }>,
    findActiveCommercialOwners: 0,
    groupOrderSellers: [] as unknown[],
  };
  const customerById = new Map(db.customers.map((c) => [c.id, c]));
  const ownerPrisma = {
    crmCustomerCommercialOwner: {
      findMany: async (args: { where: unknown }) =>
        db.owners.filter((o) => matchesWhere(o as unknown as Row, args.where)).map((o) => ({ customerId: o.customerId })),
    },
  };
  const ds: CrmReportsDataSource = {
    async findCustomers(where) {
      calls.findCustomers.push(where);
      return db.customers
        .filter((c) => matchesWhere(c as unknown as Row, where))
        .map(({ id, companyName, tradeName, taxId, city, state }) => ({ id, companyName, tradeName, taxId, city, state }));
    },
    async findManualOwnerCustomerIds(filter) {
      calls.findManualOwnerCustomerIds += 1;
      return fetchCrmManualOwnerCustomerIds(ownerPrisma as never, filter);
    },
    async findSalesOrders(where) {
      calls.findSalesOrders.push(where);
      return db.orders
        .filter((o) => matchesWhere({ ...o, Customer: customerById.get(o.customerId) } as Row, where))
        .map(({ id, customerId, orderCode, issueDate, totalNetValue, externalSellerId, nomusSellerName }) => ({
          id,
          customerId,
          orderCode,
          issueDate,
          totalNetValue,
          externalSellerId,
          nomusSellerName,
        }));
    },
    async resolveCommercialOwners(customerIds) {
      calls.resolveCommercialOwners.push([...customerIds]);
      const map = new Map();
      for (const id of customerIds) {
        const row = db.owners.find((o) => o.customerId === id && o.isActive);
        map.set(
          id,
          row
            ? {
                sellerCanonicalName: row.sellerCanonicalName,
                sellerResponsibleName: null,
                sellerIdentityKey: row.sellerIdentityKey,
                sellerExternalId: row.sellerExternalId,
                isActive: true,
              }
            : null
        );
      }
      return map;
    },
    async findActivities(customerIds) {
      calls.findActivities.push([...customerIds]);
      return db.activities.filter((a) => customerIds.includes(a.customerId));
    },
    async loadSellerIdentityContext() {
      calls.loadSellerIdentityContext += 1;
      return db.sellerCtx;
    },
    async searchCustomers(where, take) {
      calls.searchCustomers.push({ where, take });
      return db.customers
        .filter((c) => matchesWhere(c as unknown as Row, where))
        .sort((a, b) => a.companyName.localeCompare(b.companyName, "pt-BR"))
        .slice(0, take)
        .map(({ id, companyName, tradeName, taxId, city, state }) => ({ id, companyName, tradeName, taxId, city, state }));
    },
    async findActiveCommercialOwners() {
      calls.findActiveCommercialOwners += 1;
      return db.owners
        .filter((o) => o.isActive)
        .map((o) => ({
          customerId: o.customerId,
          sellerIdentityKey: o.sellerIdentityKey,
          sellerCanonicalName: o.sellerCanonicalName,
          sellerResponsibleName: null,
          sellerExternalId: o.sellerExternalId,
        }));
    },
    async groupOrderSellers(where) {
      calls.groupOrderSellers.push(where);
      const counts = new Map<number | null, number>();
      for (const o of db.orders) {
        if (!matchesWhere({ ...o, Customer: customerById.get(o.customerId) } as Row, where)) continue;
        counts.set(o.externalSellerId, (counts.get(o.externalSellerId) ?? 0) + 1);
      }
      return [...counts.entries()].map(([externalSellerId, orderCount]) => ({ externalSellerId, orderCount }));
    },
  };
  return { ds, calls };
}

export function mockAuth(overrides: {
  role?: AppAuthContext["role"];
  permissions?: string[];
  externalSellerId?: number | null;
  sellerResponsibleName?: string | null;
}): AppAuthContext {
  const permissions = overrides.permissions ?? [];
  const role = overrides.role ?? "VIEWER";
  return {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: overrides.externalSellerId ?? null,
    externalSellerIds: overrides.externalSellerId != null ? [overrides.externalSellerId] : [],
    sellerResponsibleName: overrides.sellerResponsibleName ?? null,
    sellerIdentityKey: null,
    permissionsVersion: 1,
    mustChangePassword: false,
    passwordChangedAt: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-1",
    sessionPermissionsVersionAtIssue: 1,
  };
}

export const OWN_PERMISSIONS = ["crm.view", "crm.customer_cockpit.view", "crm.seller.own"];
export const GLOBAL_SCOPE = resolveCrmCommercialAccessScope(mockAuth({ role: "COMMERCIAL_MANAGER" }));
export const OWN_GISLENE_SCOPE = resolveCrmCommercialAccessScope(
  mockAuth({ permissions: OWN_PERMISSIONS, externalSellerId: 464, sellerResponsibleName: "GISLENE LIMA" })
);
export const OWN_UNLINKED_SCOPE = resolveCrmCommercialAccessScope(mockAuth({ permissions: OWN_PERMISSIONS }));
export const NONE_SCOPE = resolveCrmCommercialAccessScope(mockAuth({ permissions: ["crm.view"] }));

export function request(body: unknown = {}): CrmReportsNormalizedRequest {
  const parsed = parseCrmReportsOperationalRequest(body);
  if (parsed.ok !== true) throw new Error(`request inválido no teste: ${JSON.stringify(parsed)}`);
  return parsed.request;
}

export const idsOf = (rows: { customerId: string }[]) => rows.map((r) => r.customerId);
export const analyzedIds = (run: CrmReportsRun) =>
  run.analysis.analyzed.map((f) => f.customer.id).sort();
