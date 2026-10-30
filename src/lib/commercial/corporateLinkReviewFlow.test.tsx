/**
 * Revisão de vínculo empresarial de ponta a ponta, sem banco real (banco simulado com transação e rollback).
 * Cenário real que motivou: VICLA × GODOI & CARDOSO com o mesmo endereço fiscal, crédito parado em
 * EM_ANALISE / RELATED_PARTY_UNVERIFIED sem que ninguém conseguisse concluir a revisão.
 * T01–T36 seguem a numeração da missão.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CorporateLinkReviewPanel } from "../../components/customers/CorporateLinkReviewPanel.js";
import { toAppAuthContext, toSafeAppUser } from "../auth/appAuth.server.js";
import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG } from "../permissionCatalog.js";
import { PERMISSION_CONTRACT_RESOURCES } from "../security/permissionContract/resources.js";
import { COMMERCIAL_CREDIT_EXCEPTION_PERMISSIONS, resolveCommercialCreditExceptionPermission } from "./commercialCreditDecision.js";
import {
  loadCustomerCommercialCreditIntelligence,
  readCommercialCreditDecision,
} from "./commercialCreditDecision.server.js";
import { corporateLinkReviewCapability, resolveCorporateLinkReviewAuthorization } from "./corporateLinkReview.js";
import { applyCorporateLinkReview, reviewCorporateLinkRequest } from "./corporateLinkReview.server.js";
import { splitCorporateFingerprints } from "./corporateRelation.js";
import { loadCustomerCorporateRadarView } from "./corporateRelation.server.js";
import { loadPortfolioCredit } from "./portfolioCredit.server.js";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-10-29T15:00:00.000Z");
const VICLA = "11111111-1111-4111-8111-111111111111";
const GODOI = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const ACTOR = "99999999-9999-4999-8999-999999999999";
const GRANT = "commercial.credit.exception.grant";
const FINANCE = { id: ACTOR, role: "ADMIN", assignedPermissions: [GRANT] };
const WHY = "Contrato social das duas empresas conferido: sócios e administradores diferentes.";

function validCnpj(base12: string): string {
  const digit = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, char, index) => total + Number(char) * weights[index]!, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const first = digit(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(base12 + String(first), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${first}${second}`;
}

const CNPJ_VICLA = validCnpj("669132530001");
const CNPJ_GODOI = validCnpj("549872420001");
const CNPJ_THIRD = validCnpj("771234560001");
const CNPJ_SAME_ROOT = validCnpj("669132530002");

const SHARED_ADDRESS = { address: "RUA DAS INDUSTRIAS 1500 GALPAO 3", city: "SAO PAULO", state: "SP", zipCode: "03100000" };

type CustomerRow = {
  id: string;
  taxId: string;
  companyName: string;
  nomusExternalPersonId: number;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
};

type LinkRow = {
  id: string;
  customerId: string;
  relatedCustomerId: string;
  status: string;
  evidenceKind: string | null;
  justification: string | null;
  actorUserId: string | null;
  evidenceFingerprint: string | null;
  closedAt: Date | null;
  updatedAt: Date;
};

function customer(id: string, taxId: string, personId: number, name: string, extra: Partial<CustomerRow> = {}): CustomerRow {
  return { id, taxId, companyName: name, nomusExternalPersonId: personId, ...extra };
}

function overdueTitle(personId: number, cnpj: string, externalId: number) {
  return {
    externalId,
    personId,
    personCnpj: cnpj,
    dueDate: new Date("2026-10-01T00:00:00.000Z"),
    settlementDate: null,
    amountReceivable: 6560,
    amountReceived: 0,
    balanceReceivable: 6560,
    syncedAt: NOW,
    personName: "Cliente",
    companyName: "Empresa",
    description: "NF",
    comments: null,
    sourceInvoiceId: 50,
    sourceInvoiceNumber: "100",
    paymentMethodName: "BOLETO",
    bankAccountName: null,
    suspendCollection: false,
    status: false,
    sourcePresenceStatus: "PRESENT",
    rawPayload: { id: externalId },
  };
}

const favorableQuod = (customerId: string, cnpj: string) => ({
  customerId,
  cnpj,
  status: "SUCCEEDED",
  confirmedRestriction: false,
  insufficient: false,
  validUntil: new Date("2026-12-01T00:00:00.000Z"),
  consultedAt: NOW,
});

const ieptb = (customerId: string, cnpj: string, protest = false) => ({
  customerId,
  cnpj,
  status: "SUCCEEDED",
  confirmedProtest: protest,
  confirmedClear: !protest,
  insufficient: false,
  validUntil: new Date("2026-12-01T00:00:00.000Z"),
  consultedAt: NOW,
});

/** Banco simulado. $transaction serializa e desfaz tudo se a função falhar (como o PostgreSQL). */
function createDb(input: {
  customers: CustomerRow[];
  titles?: ReturnType<typeof overdueTitle>[];
  links?: LinkRow[];
  memberships?: Array<Record<string, unknown>>;
  protestCustomers?: string[];
  membershipThrows?: boolean;
  failUpsertAt?: number;
}) {
  const customers = [...input.customers].sort((left, right) => left.id.localeCompare(right.id));
  const titles = input.titles ?? [];
  let links: LinkRow[] = [...(input.links ?? [])];
  let audits: Array<Record<string, unknown>> = [];
  const writes: string[] = [];
  let upserts = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const matchCustomer = (args?: { where?: Record<string, unknown>; skip?: number; take?: number }) => {
    const where = args?.where ?? {};
    let rows = customers;
    const idIn = (where.id as { in?: string[] } | undefined)?.in;
    const taxIn = (where.taxId as { in?: string[] } | undefined)?.in;
    const startsWith = (where.taxId as { startsWith?: string } | undefined)?.startsWith;
    const prefixes = ((where.OR as Array<{ taxId?: { startsWith?: string } }> | undefined) ?? [])
      .map((item) => item.taxId?.startsWith)
      .filter((value): value is string => Boolean(value));
    if (idIn) rows = rows.filter((row) => idIn.includes(row.id));
    if (taxIn) rows = rows.filter((row) => taxIn.includes(row.taxId));
    if (startsWith) rows = rows.filter((row) => row.taxId.startsWith(startsWith));
    if (prefixes.length > 0) rows = rows.filter((row) => prefixes.some((prefix) => row.taxId.startsWith(prefix)));
    const skip = args?.skip ?? 0;
    const take = args?.take ?? rows.length;
    return rows.slice(skip, skip + take);
  };
  type Clause = { customerId?: string | { in?: string[] }; relatedCustomerId?: string | { in?: string[] } };
  const matchClause = (row: LinkRow, clause: Clause) => {
    const test = (value: string, rule: Clause["customerId"]) =>
      rule == null ? true : typeof rule === "string" ? value === rule : rule.in?.includes(value) ?? false;
    return test(row.customerId, clause.customerId) && test(row.relatedCustomerId, clause.relatedCustomerId);
  };
  const db = {
    customer: {
      findUnique: async ({ where }: { where: { id: string } }) => customers.find((row) => row.id === where.id) ?? null,
      findMany: async (args?: { where?: Record<string, unknown>; skip?: number; take?: number }) => matchCustomer(args),
    },
    appUser: { findMany: async () => [{ id: ACTOR, name: "Ana Financeiro" }] },
    salesOrder: {
      findMany: async ({ where }: { where?: { customerId?: string | { in?: string[] } } }) => {
        const wanted = where?.customerId;
        return customers
          .filter((row) => !wanted || (typeof wanted === "string" ? row.id === wanted : wanted.in?.includes(row.id)))
          .map((row) => ({ customerId: row.id, externalCustomerId: row.nomusExternalPersonId }));
      },
    },
    nomusAccountsReceivable: {
      aggregate: async () => ({ _max: { syncedAt: NOW } }),
      findMany: async ({ where }: { where?: { personId?: number | { in?: number[] } } }) => {
        const personId = where?.personId;
        return titles.filter((row) =>
          personId == null ? true : typeof personId === "number" ? row.personId === personId : personId.in?.includes(row.personId)
        );
      },
    },
    nomusSourceSyncRun: { findFirst: async () => ({ status: "SUCCESS", payloadComplete: true, startedAt: NOW }) },
    customerCorporateLink: {
      findMany: async (args?: { where?: Clause & { OR?: Clause[] } }) => {
        const where = args?.where;
        if (!where) return links.map((row) => ({ ...row }));
        if (where.OR) return links.filter((row) => where.OR!.some((clause) => matchClause(row, clause))).map((row) => ({ ...row }));
        return links.filter((row) => matchClause(row, where)).map((row) => ({ ...row }));
      },
      upsert: async (args: {
        where: { customerId_relatedCustomerId: { customerId: string; relatedCustomerId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        upserts += 1;
        if (input.failUpsertAt === upserts) throw new Error("disk-full");
        writes.push("customerCorporateLink");
        const { customerId, relatedCustomerId } = args.where.customerId_relatedCustomerId;
        const current = links.find((row) => row.customerId === customerId && row.relatedCustomerId === relatedCustomerId);
        const data = (current ? args.update : args.create) as Partial<LinkRow>;
        const next: LinkRow = {
          id: current?.id ?? `link-${customerId.slice(0, 4)}-${relatedCustomerId.slice(0, 4)}`,
          customerId,
          relatedCustomerId,
          status: "CONFIRMED",
          evidenceKind: null,
          justification: null,
          actorUserId: null,
          evidenceFingerprint: null,
          closedAt: null,
          ...current,
          ...data,
          updatedAt: NOW,
        } as LinkRow;
        links = [...links.filter((row) => row !== current), next];
        return next;
      },
    },
    commercialAuditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        writes.push("commercialAuditLog");
        audits.push(args.data);
        return args.data;
      },
    },
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const run = chain.then(async () => {
        const savedLinks = links.map((row) => ({ ...row }));
        const savedAudits = [...audits];
        try {
          return await fn(db);
        } catch (error) {
          links = savedLinks;
          audits = savedAudits;
          throw error;
        }
      });
      chain = run.catch(() => undefined);
      return run;
    },
    commercialExternalProtest: { findMany: async () => [] },
    commercialCreditException: { findMany: async () => [] },
    commercialCreditOccurrence: { findMany: async () => [] },
    commercialCorporateMembership: {
      findMany: async () => {
        if (input.membershipThrows) throw new Error("qsa-down");
        return input.memberships ?? [];
      },
      findFirst: async () => null,
      create: async () => {
        throw new Error("a leitura não grava");
      },
    },
    customerCnpjLookup: { findFirst: async () => null, findMany: async () => [] },
    quodDossierConsultation: {
      findMany: async () => customers.map((row) => favorableQuod(row.id, row.taxId)),
    },
    ieptbOnlineConsultation: {
      findMany: async () => customers.map((row) => ieptb(row.id, row.taxId, input.protestCustomers?.includes(row.id))),
    },
  };
  return {
    db,
    links: () => links,
    audits: () => audits,
    writes: () => writes,
  };
}

function viclaScenario(extra: { godoiOverdue?: boolean; viclaOverdue?: boolean; protest?: boolean; links?: LinkRow[] } = {}) {
  return createDb({
    customers: [
      customer(VICLA, CNPJ_VICLA, 100, "VICLA LTDA (cenário)", SHARED_ADDRESS),
      customer(GODOI, CNPJ_GODOI, 200, "GODOI & CARDOSO (cenário)", SHARED_ADDRESS),
    ],
    titles: [
      ...(extra.godoiOverdue ? [overdueTitle(200, CNPJ_GODOI, 9)] : []),
      ...(extra.viclaOverdue ? [overdueTitle(100, CNPJ_VICLA, 8)] : []),
    ],
    protestCustomers: extra.protest ? [VICLA] : [],
    links: extra.links,
  });
}

async function read(db: unknown, customerId = VICLA) {
  return readCommercialCreditDecision(db as never, {
    customerId,
    enforcement: "CREDIT_GRANT",
    paymentTerms: "30",
    cadastral: { score: 100, verdict: "VENDA LIBERADA" },
    now: NOW,
    externalProtestQuery: { env: {} },
  });
}

async function portfolio(db: unknown, row: { id: string; taxId: string; personId: number }) {
  const map = await loadPortfolioCredit(db as never, [{
    id: row.id,
    taxId: row.taxId,
    nomusExternalPersonId: row.personId,
    cnpjRisk: { score: 100, verdict: "VENDA LIBERADA" },
  }], NOW);
  return map.get(row.id)!;
}

async function review(db: unknown, action: string, extra: Partial<{ actor: typeof FINANCE; subject: string; related: string; justification: string }> = {}) {
  return reviewCorporateLinkRequest(db as never, {
    actor: extra.actor ?? FINANCE,
    subjectCustomerId: extra.subject ?? VICLA,
    relatedCustomerId: extra.related ?? GODOI,
    action,
    justification: extra.justification ?? WHY,
    now: NOW,
  });
}

function pairStates(links: LinkRow[], left = VICLA, right = GODOI) {
  const forward = links.find((row) => row.customerId === left && row.relatedCustomerId === right);
  const backward = links.find((row) => row.customerId === right && row.relatedCustomerId === left);
  return [forward?.status ?? null, backward?.status ?? null];
}

async function viewFor(db: unknown, canReview: boolean) {
  const view = await loadCustomerCommercialCreditIntelligence(db as never, VICLA, { revealFinancial: false, now: NOW });
  return { ...view, canReviewCorporateLinks: canReview, corporateLinkReviewBlockedReason: canReview ? null : corporateLinkReviewCapability({ role: "SALES", assignedPermissions: [] }).reason };
}

function panel(view: Awaited<ReturnType<typeof viewFor>>) {
  return renderToStaticMarkup(
    <CorporateLinkReviewPanel credit={view} customerId={VICLA} canReview={view.canReviewCorporateLinks} onSubmit={async () => undefined} />
  );
}

function appUser(role: string, permissions: string[]) {
  return {
    id: ACTOR,
    name: "Ana",
    email: "ana@example.test",
    passwordHash: "x",
    role,
    permissions,
    permissionsVersion: 1,
    accessProfileId: null,
    employeeId: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as never;
}

describe("vínculo empresarial › autorização", () => {
  it("T01 sem permissão não vê botões e lê a mensagem de autorização", async () => {
    const { db } = viclaScenario();
    const html = panel(await viewFor(db, false));
    assert.doesNotMatch(html, /data-testid="corporate-link-confirm"/);
    assert.doesNotMatch(html, /data-testid="corporate-link-reject"/);
    assert.match(html, /Esta validação requer autorização de Financeiro ou Diretoria\./);
  });

  it("T02 sem permissão recebe 403 ao chamar a ação direto e nada é gravado", async () => {
    const scenario = viclaScenario();
    const denied = await review(scenario.db, "confirm", { actor: { id: ACTOR, role: "SALES", assignedPermissions: ["customers.view"] } });
    assert.equal(denied.httpStatus, 403);
    assert.equal(denied.body.error, "Esta validação requer autorização de Financeiro ou Diretoria.");
    assert.deepEqual(scenario.writes(), []);
  });

  it("T03 autorizado vê Confirmar e Rejeitar, sem a mensagem de bloqueio", async () => {
    const { db } = viclaScenario();
    const html = panel(await viewFor(db, true));
    assert.match(html, /data-testid="corporate-link-confirm"/);
    assert.match(html, /data-testid="corporate-link-reject"/);
    assert.doesNotMatch(html, /corporate-link-no-permission/);
  });

  it("T04 SUPER_ADMIN com a chave explícita revisa mesmo com a sessão compacta vazia", async () => {
    const user = appUser("SUPER_ADMIN", [GRANT]);
    const compact = toSafeAppUser(user, { sessionCompact: true });
    assert.deepEqual(compact.permissions, [], "a sessão compacta não serve de fonte (causa raiz D)");
    const auth = toAppAuthContext(user, { id: "s1" });
    assert.equal(corporateLinkReviewCapability({ role: auth.role, assignedPermissions: auth.permissions }).canReview, true);
    const scenario = viclaScenario();
    const done = await review(scenario.db, "reject", { actor: { id: auth.id, role: auth.role, assignedPermissions: auth.permissions } });
    assert.equal(done.httpStatus, 200);
  });

  it("T05 SUPER_ADMIN sem chave revisa pelo papel; a exceção financeira segue exigindo a chave", async () => {
    const auth = toAppAuthContext(appUser("SUPER_ADMIN", []), { id: "s1" });
    assert.deepEqual(resolveCorporateLinkReviewAuthorization({ role: auth.role, assignedPermissions: auth.permissions, isActive: auth.isActive }), {
      ok: true,
      basis: "ROLE_SUPER_ADMIN",
      permission: null,
    });
    assert.deepEqual(corporateLinkReviewCapability({ role: "SUPER_ADMIN", assignedPermissions: [] }), {
      canReview: true,
      permission: null,
      reason: null,
    });
    assert.deepEqual(resolveCommercialCreditExceptionPermission({ role: "SUPER_ADMIN", assignedPermissions: [] }), {
      ok: false,
      code: "EXCEPTION_IMPLICIT_SUPER_ADMIN",
    });
  });

  it("T05b SUPER_ADMIN inativo não revisa", async () => {
    const inactive = { id: ACTOR, role: "SUPER_ADMIN", assignedPermissions: [] as string[], isActive: false };
    assert.equal(corporateLinkReviewCapability(inactive).canReview, false);
    const scenario = viclaScenario();
    const denied = await review(scenario.db, "confirm", { actor: inactive });
    assert.equal(denied.httpStatus, 403);
    assert.deepEqual(scenario.writes(), []);
  });

  it("T05c Financeiro e Diretoria autorizados registram a própria chave; papel comum sem chave recebe 403", async () => {
    for (const permission of COMMERCIAL_CREDIT_EXCEPTION_PERMISSIONS) {
      const actor = { id: ACTOR, role: "ADMIN", assignedPermissions: [permission] };
      assert.equal(corporateLinkReviewCapability(actor).canReview, true);
      const scenario = viclaScenario();
      assert.equal((await review(scenario.db, "confirm", { actor })).httpStatus, 200);
      for (const audit of scenario.audits()) {
        const entry = JSON.parse(String(audit.newValue));
        assert.equal(entry.authorizationBasis, "ASSIGNED_PERMISSION");
        assert.equal(entry.permission, permission);
      }
    }
    const denied = { id: ACTOR, role: "ADMIN", assignedPermissions: [] as string[] };
    assert.equal(corporateLinkReviewCapability(denied).canReview, false);
    const scenario = viclaScenario();
    assert.equal((await review(scenario.db, "confirm", { actor: denied })).httpStatus, 403);
    assert.deepEqual(scenario.writes(), []);
  });

  it("T05d VICLA × GODOI pelo SUPER_ADMIN: vê os botões, decide, audita pelo papel e atualiza o consolidado", async () => {
    const actor = { id: ACTOR, role: "SUPER_ADMIN", assignedPermissions: [] as string[], isActive: true };
    const capability = corporateLinkReviewCapability(actor);
    for (const action of ["confirm", "reject"]) {
      const scenario = viclaScenario();
      const html = panel(await viewFor(scenario.db, capability.canReview));
      assert.match(html, /data-testid="corporate-link-confirm"/);
      assert.match(html, /data-testid="corporate-link-reject"/);
      assert.equal((await read(scenario.db)).decision.customerStatus, "EM_ANALISE");
      assert.equal((await review(scenario.db, action, { actor })).httpStatus, 200);
      assert.deepEqual(new Set(scenario.writes()), new Set(["customerCorporateLink", "commercialAuditLog"]), "só vínculo e auditoria");
      assert.equal(scenario.audits().length, 2);
      for (const audit of scenario.audits()) {
        const entry = JSON.parse(String(audit.newValue));
        assert.equal(entry.actorRole, "SUPER_ADMIN");
        assert.equal(entry.authorizationBasis, "ROLE_SUPER_ADMIN");
        assert.equal(entry.permission, null, "nenhuma chave individual simulada");
      }
      assert.notEqual((await read(scenario.db)).decision.reason, "RELATED_PARTY_UNVERIFIED");
      assert.notEqual((await read(scenario.db)).decision.customerStatus, "EM_ANALISE");
    }
  });

  it("T05e SUPER_ADMIN não libera restrição financeira real ao decidir o vínculo", async () => {
    const actor = { id: ACTOR, role: "SUPER_ADMIN", assignedPermissions: [] as string[] };
    const debt = viclaScenario({ godoiOverdue: true });
    assert.equal((await review(debt.db, "confirm", { actor })).httpStatus, 200);
    assert.equal((await read(debt.db)).decision.customerStatus, "BLOQUEADO");
    const protest = viclaScenario({ protest: true });
    assert.equal((await review(protest.db, "reject", { actor })).httpStatus, 200);
    assert.equal((await read(protest.db)).decision.customerStatus, "BLOQUEADO");
  });

  it("T05f justificativa curta, sem indício e repetição seguem valendo para o SUPER_ADMIN", async () => {
    const actor = { id: ACTOR, role: "SUPER_ADMIN", assignedPermissions: [] as string[] };
    const scenario = viclaScenario();
    const short = await review(scenario.db, "confirm", { actor, justification: "curta demais" });
    assert.equal(short.httpStatus, 400);
    assert.deepEqual(scenario.writes(), []);
    const closeWithoutLink = await review(scenario.db, "close", { actor });
    assert.equal(closeWithoutLink.httpStatus, 409);
    assert.deepEqual(scenario.writes(), []);
    assert.equal((await review(scenario.db, "confirm", { actor })).body.changed, true);
    const audits = scenario.audits().length;
    assert.equal((await review(scenario.db, "confirm", { actor })).body.changed, false);
    assert.equal(scenario.audits().length, audits);
  });

  it("T06 a revogação impede novas decisões", async () => {
    const scenario = viclaScenario();
    assert.equal((await review(scenario.db, "confirm")).httpStatus, 200);
    const revoked = { id: ACTOR, role: "ADMIN", assignedPermissions: [] as string[] };
    const denied = await review(scenario.db, "close", { actor: revoked, justification: "Tentativa depois da revogação da chave." });
    assert.equal(denied.httpStatus, 403);
    assert.deepEqual(pairStates(scenario.links()), ["CONFIRMED", "CONFIRMED"]);
  });

  it("T07 catálogo legado e contrato canônico usam as mesmas chaves, críticas, e a rota usa permissões atribuídas", () => {
    for (const key of COMMERCIAL_CREDIT_EXCEPTION_PERMISSIONS) {
      assert.ok(ALL_PERMISSION_KEYS.includes(key));
      const entry = PERMISSION_CATALOG.find((row) => row.key === key)!;
      assert.equal(entry.risk, "critical");
      assert.match(entry.description ?? "", /revisar vínculo empresarial/);
      assert.match(entry.description ?? "", /A exceção não é concedida pelo papel SUPER_ADMIN/);
    }
    const resource = PERMISSION_CONTRACT_RESOURCES.find((row) => row.resourceKey === "finance.commercial_credit_exception")!;
    assert.deepEqual([...resource.actions[0]!.legacyPermissionKeys].sort(), [...COMMERCIAL_CREDIT_EXCEPTION_PERMISSIONS].sort());
    assert.ok(resource.relatedEndpoints.includes("/api/customers/:id/corporate-links"));
    const routes = readFileSync(join(here, "../companyIntelligenceRoutes.ts"), "utf8");
    const post = /"\/api\/customers\/:id\/corporate-links"[\s\S]*?\n  \);/.exec(routes)?.[0] ?? "";
    assert.match(post, /assignedPermissions: user\.permissions/);
    assert.doesNotMatch(post, /effectivePermissions/);
    assert.match(post, /isActive: user\.isActive/);
    assert.match(routes, /corporateLinkReviewCapability\(\{/);
    const scan = /"\/api\/commercial\/corporate-radar\/scan"[\s\S]*?resolveCorporateLinkReviewAuthorization\([\s\S]*?\}\);/.exec(routes)?.[0] ?? "";
    assert.ok(scan, "a varredura usa a regra central");
    assert.doesNotMatch(scan, /effectivePermissions/);
    const panelSource = readFileSync(join(here, "../../components/customers/CustomerCnpjIntelligencePanel.tsx"), "utf8");
    assert.match(panelSource, /credit\?\.canReviewCorporateLinks === true/);
    assert.doesNotMatch(panelSource, /effectivePermissions \?\? \[\]\)\.some/);
  });
});

describe("vínculo empresarial › persistência", () => {
  it("T08 confirmar grava as duas direções como confirmação manual com ator e justificativa", async () => {
    const scenario = viclaScenario();
    const done = await review(scenario.db, "confirm");
    assert.deepEqual(done, { httpStatus: 200, body: { status: "CONFIRMED", changed: true } });
    for (const row of scenario.links()) {
      assert.equal(row.status, "CONFIRMED");
      assert.equal(row.evidenceKind, "MANUAL");
      assert.equal(row.actorUserId, ACTOR);
      assert.equal(row.justification, WHY);
      assert.equal(row.closedAt, null);
    }
    assert.equal(scenario.links().length, 2);
  });

  it("T09 rejeitar grava a impressão de todas as evidências atuais do par", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "reject");
    const [forward] = scenario.links().filter((row) => row.customerId === VICLA);
    assert.equal(forward!.status, "REJECTED");
    assert.equal(forward!.evidenceKind, "REJECTED_CANDIDATE");
    assert.equal(splitCorporateFingerprints(forward!.evidenceFingerprint).length, 1);
    assert.match(forward!.evidenceFingerprint!, /^[0-9a-f]{64}$/);
  });

  it("T10 encerrar só vale para vínculo manual confirmado e registra a data", async () => {
    const scenario = viclaScenario();
    const early = await review(scenario.db, "close");
    assert.equal(early.httpStatus, 409);
    assert.equal(early.body.code, "CORPORATE_LINK_NOT_CONFIRMED");
    await review(scenario.db, "confirm");
    const closed = await review(scenario.db, "close", { justification: "Sócio em comum saiu da sociedade em 09/2026." });
    assert.equal(closed.httpStatus, 200);
    assert.deepEqual(pairStates(scenario.links()), ["CLOSED", "CLOSED"]);
    assert.ok(scenario.links().every((row) => row.closedAt instanceof Date));
  });

  it("T11 as duas direções ficam iguais depois de cada ação, revisando de qualquer ficha", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "confirm");
    assert.deepEqual(pairStates(scenario.links()), ["CONFIRMED", "CONFIRMED"]);
    await review(scenario.db, "close", { subject: GODOI, related: VICLA });
    assert.deepEqual(pairStates(scenario.links()), ["CLOSED", "CLOSED"]);
  });

  it("T12 falha na segunda gravação desfaz a primeira (sem confirmação pela metade)", async () => {
    const scenario = createDb({
      customers: [
        customer(VICLA, CNPJ_VICLA, 100, "VICLA", SHARED_ADDRESS),
        customer(GODOI, CNPJ_GODOI, 200, "GODOI", SHARED_ADDRESS),
      ],
      failUpsertAt: 2,
    });
    await assert.rejects(() => review(scenario.db, "confirm"), /disk-full/);
    assert.deepEqual(scenario.links(), []);
    assert.deepEqual(scenario.audits(), []);
  });

  it("T13 repetir a mesma decisão não grava de novo", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "reject");
    const before = scenario.audits().length;
    const again = await review(scenario.db, "reject");
    assert.deepEqual(again.body, { status: "REJECTED", changed: false });
    assert.equal(scenario.audits().length, before);
    await review(scenario.db, "confirm");
    const confirmAgain = await review(scenario.db, "confirm");
    assert.equal(confirmAgain.body.changed, false);
  });

  it("T14 auditoria por direção: ator, papel, permissão, justificativa, empresas, antes e depois", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "confirm");
    await review(scenario.db, "close", { justification: "Encerrado após alteração contratual conferida." });
    const audits = scenario.audits();
    assert.equal(audits.length, 4);
    const close = audits.filter((row) => row.action === "CORPORATE_LINK_CLOSE");
    assert.equal(close.length, 2);
    for (const row of close) {
      assert.equal(row.performedBy, ACTOR);
      assert.equal(row.entityType, "CustomerCorporateLink");
      const before = JSON.parse(String(row.oldValue));
      const after = JSON.parse(String(row.newValue));
      assert.equal(before.status, "CONFIRMED");
      assert.equal(after.status, "CLOSED");
      assert.equal(after.actorUserId, ACTOR);
      assert.equal(after.actorRole, "ADMIN");
      assert.equal(after.permission, GRANT);
      assert.equal(after.justification, "Encerrado após alteração contratual conferida.");
      assert.equal(after.reviewedFromCustomerId, VICLA);
      assert.ok([VICLA, GODOI].includes(after.customerId) && [VICLA, GODOI].includes(after.relatedCustomerId));
      assert.equal(after.at, NOW.toISOString());
    }
    assert.equal(JSON.parse(String(audits[0]!.oldValue)), null, "primeira decisão: antes não existia linha");
  });
});

describe("vínculo empresarial › Radar e evidências", () => {
  it("T15 endereço igual sozinho é indício: pendente, baixa confiabilidade, fora do grupo e sem transferir dívida", async () => {
    const { db } = viclaScenario({ godoiOverdue: true });
    const result = await read(db);
    assert.equal(result.decision.customerStatus, "EM_ANALISE");
    assert.equal(result.decision.reason, "RELATED_PARTY_UNVERIFIED");
    assert.equal(result.corporateRelations.length, 0);
    assert.equal(result.pendingCorporateRelations.length, 1);
    assert.equal(result.pendingCorporateRelations[0]!.evidenceTypeLabel, "Mesmo endereço fiscal");
    assert.equal(result.pendingCorporateRelations[0]!.reliabilityLabel, "Baixa · indício, não prova");
    assert.equal(result.relatedRestrictionFacts.length, 0, "a dívida da GODOI não vira dívida da VICLA");
  });

  it("T16 evidência forte (mesma raiz de CNPJ) continua comprovada, não se encerra e não se rejeita como indício", async () => {
    const scenario = createDb({
      customers: [
        customer(VICLA, CNPJ_VICLA, 100, "VICLA MATRIZ"),
        customer(GODOI, CNPJ_SAME_ROOT, 200, "VICLA FILIAL"),
      ],
    });
    const result = await read(scenario.db);
    const formal = result.corporateRelations.find((row) => row.relatedCustomerId === GODOI)!;
    assert.equal(formal.origin, "FORMAL");
    assert.equal(formal.closable, false);
    assert.equal(formal.reliabilityLabel, "Comprovado por documento");
    const rejected = await review(scenario.db, "reject");
    assert.equal(rejected.httpStatus, 409);
    assert.equal(rejected.body.code, "CORPORATE_LINK_NO_EVIDENCE");
  });

  it("T17 confirmado não aparece também como pendente", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "confirm");
    const result = await read(scenario.db);
    assert.equal(result.pendingCorporateRelations.length, 0);
    const manual = result.corporateRelations.filter((row) => row.relatedCustomerId === GODOI);
    assert.equal(manual.length, 1);
    assert.equal(manual[0]!.origin, "MANUAL");
    assert.equal(manual[0]!.closable, true);
    assert.match(manual[0]!.reviewNote ?? "", /Confirmado por Ana Financeiro/);
    assert.notEqual(result.decision.reason, "RELATED_PARTY_UNVERIFIED");
  });

  it("T18 evidência rejeitada não volta sem mudança relevante; encerrada também não", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "reject");
    assert.equal((await read(scenario.db)).pendingCorporateRelations.length, 0);
    assert.equal((await read(scenario.db)).pendingCorporateRelations.length, 0, "leitura repetida é estável");
    const closed = viclaScenario();
    await review(closed.db, "confirm");
    await review(closed.db, "close", { justification: "Vínculo terminou: sociedade desfeita em 2025." });
    const afterClose = await read(closed.db);
    assert.equal(afterClose.pendingCorporateRelations.length, 0);
    assert.equal(afterClose.corporateRelations.length, 0);
    assert.equal(afterClose.corporateLinkHistory[0]!.statusLabel, "Encerrado");
  });

  it("T19 evidência nova depois da rejeição reabre a revisão", async () => {
    const first = viclaScenario();
    await review(first.db, "reject");
    const moved = { ...SHARED_ADDRESS, address: "AVENIDA NOVA DO COMERCIO 77 BLOCO B" };
    const reopened = createDb({
      customers: [
        customer(VICLA, CNPJ_VICLA, 100, "VICLA", moved),
        customer(GODOI, CNPJ_GODOI, 200, "GODOI", moved),
      ],
      links: first.links(),
    });
    const result = await read(reopened.db);
    assert.equal(result.pendingCorporateRelations.length, 1, "endereço em comum diferente do rejeitado");
    assert.equal(result.decision.reason, "RELATED_PARTY_UNVERIFIED");
    const phone = createDb({
      customers: [
        customer(VICLA, CNPJ_VICLA, 100, "VICLA", { ...SHARED_ADDRESS, phone: "11987654321" }),
        customer(GODOI, CNPJ_GODOI, 200, "GODOI", { ...SHARED_ADDRESS, phone: "11987654321" }),
      ],
      links: first.links(),
    });
    assert.equal((await read(phone.db)).pendingCorporateRelations.length, 1, "telefone em comum é evidência nova");
  });

  it("T20 a mesma empresa vinda do QSA e do Radar vira um item só, e uma rejeição cobre as duas evidências", async () => {
    const member = (subjectCnpj: string, subjectCustomerId: string) => ({
      subjectCnpj,
      subjectCustomerId,
      source: "brasilapi",
      consultedAt: new Date("2026-10-20T10:00:00.000Z"),
      memberKind: "ADMINISTRATOR",
      roleText: "Administrador",
      personKind: "PF",
      documentKind: "MASKED",
      memberCnpj: null,
      reliability: "INSUFFICIENT",
      evidenceRef: `${subjectCnpj}:MARIA`,
      identityKey: null,
      nameKey: "MARIA MARGARETE DOS SANTOS PEREIRA",
      memberNameKey: "MARIA MARGARETE DOS SANTOS PEREIRA",
      displayName: "Maria Margarete dos Santos Pereira",
      memberName: "Maria Margarete dos Santos Pereira",
    });
    const scenario = createDb({
      customers: [
        customer(VICLA, CNPJ_VICLA, 100, "VICLA", SHARED_ADDRESS),
        customer(GODOI, CNPJ_GODOI, 200, "GODOI", SHARED_ADDRESS),
      ],
      memberships: [member(CNPJ_VICLA, VICLA), member(CNPJ_GODOI, GODOI)],
    });
    const before = await read(scenario.db);
    assert.equal(before.pendingCorporateRelations.length, 1);
    assert.match(before.pendingCorporateRelations[0]!.evidenceTypeLabel ?? "", /Nome de sócio coincidente/);
    assert.match(before.pendingCorporateRelations[0]!.evidenceTypeLabel ?? "", /Mesmo endereço fiscal/);
    await review(scenario.db, "reject");
    const forward = scenario.links().find((row) => row.customerId === VICLA)!;
    assert.equal(splitCorporateFingerprints(forward.evidenceFingerprint).length, 2);
    const after = await read(scenario.db);
    assert.equal(after.pendingCorporateRelations.length, 0);
    assert.notEqual(after.decision.reason, "RELATED_PARTY_UNVERIFIED");
  });

  it("T21 vínculo confirmado A–B não arrasta o indício B–C nem a dívida de C para A", async () => {
    const phone = "11912345678";
    const scenario = createDb({
      customers: [
        customer(VICLA, CNPJ_VICLA, 100, "VICLA"),
        customer(GODOI, CNPJ_GODOI, 200, "GODOI", { phone }),
        customer(THIRD, CNPJ_THIRD, 300, "TERCEIRA", { phone }),
      ],
      titles: [overdueTitle(300, CNPJ_THIRD, 7)],
      links: [
        { id: "l1", customerId: VICLA, relatedCustomerId: GODOI, status: "CONFIRMED", evidenceKind: "MANUAL", justification: WHY, actorUserId: ACTOR, evidenceFingerprint: null, closedAt: null, updatedAt: NOW },
        { id: "l2", customerId: GODOI, relatedCustomerId: VICLA, status: "CONFIRMED", evidenceKind: "MANUAL", justification: WHY, actorUserId: ACTOR, evidenceFingerprint: null, closedAt: null, updatedAt: NOW },
      ],
    });
    const result = await read(scenario.db);
    assert.equal(result.decision.customerStatus, "LIBERADO");
    assert.equal(result.relatedRestrictionFacts.length, 0);
    assert.ok(!result.corporateRelations.some((row) => row.relatedCustomerId === THIRD));
  });
});

describe("vínculo empresarial › crédito", () => {
  it("T22 antes da validação o cenário VICLA fica EM_ANALISE por vínculo não verificado", async () => {
    const { db } = viclaScenario();
    const result = await read(db);
    assert.equal(result.decision.customerStatus, "EM_ANALISE");
    assert.equal(result.decision.reason, "RELATED_PARTY_UNVERIFIED");
    assert.equal(result.ownCustomerStatus, "LIBERADO", "o CNPJ sozinho está regular");
    assert.equal(result.decision.allowed, false);
  });

  it("T23 rejeitar com justificativa o único indício, sem outras restrições, tira a pendência", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "reject");
    const result = await read(scenario.db);
    assert.equal(result.decision.customerStatus, "LIBERADO");
    assert.equal(result.corporateLinkHistory[0]!.statusLabel, "Rejeitado");
    assert.match(result.corporateLinkHistory[0]!.reviewNote, /Rejeitado por Ana Financeiro/);
  });

  it("T24 depois de confirmar, a empresa passa para o grupo confirmado", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "confirm");
    const result = await read(scenario.db);
    assert.ok(result.corporateRelations.some((row) => row.relatedCustomerId === GODOI && row.origin === "MANUAL"));
  });

  it("T25 relacionada inadimplente confirmada bloqueia, sem copiar a dívida", async () => {
    const scenario = viclaScenario({ godoiOverdue: true });
    await review(scenario.db, "confirm");
    const result = await read(scenario.db);
    assert.equal(result.decision.customerStatus, "BLOQUEADO");
    assert.equal(result.decision.reason, "RELATED_PARTY_DELINQUENT");
    assert.equal(result.ownCustomerStatus, "LIBERADO");
    assert.equal(result.delinquency.overdueAmount, 0, "o saldo da VICLA continua o dela");
  });

  it("T26 crédito próprio regular com a relacionada confirmada regular fica liberado", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "confirm");
    const result = await read(scenario.db);
    assert.equal(result.decision.customerStatus, "LIBERADO");
    assert.equal(result.decision.allowed, true);
  });

  it("T27 QUOD favorável e score cadastral alto não liberam quem deve", async () => {
    const scenario = viclaScenario({ viclaOverdue: true });
    await review(scenario.db, "reject");
    const result = await read(scenario.db);
    assert.equal(result.decision.customerStatus, "BLOQUEADO");
    assert.equal(result.decision.allowed, false);
  });

  it("T28 Boa Vista não entra no motor de decisão: score alto não libera crédito bloqueado", async () => {
    for (const file of ["commercialCreditDecision.ts", "commercialCreditDecision.server.ts", "portfolioCredit.server.ts", "creditRelationFacts.server.ts"]) {
      assert.doesNotMatch(readFileSync(join(here, file), "utf8"), /boaVista|BoaVista/, file);
    }
    const scenario = viclaScenario({ viclaOverdue: true });
    await review(scenario.db, "confirm");
    assert.equal((await read(scenario.db)).decision.customerStatus, "BLOQUEADO");
  });

  it("T29 protesto confirmado mantém o bloqueio mesmo depois de rejeitar o vínculo", async () => {
    const scenario = viclaScenario({ protest: true });
    await review(scenario.db, "reject");
    const result = await read(scenario.db);
    assert.equal(result.decision.customerStatus, "BLOQUEADO");
    assert.equal(result.decision.allowed, false);
  });

  it("T30 falha de leitura do quadro societário não vira situação regular", async () => {
    const scenario = createDb({
      customers: [
        customer(VICLA, CNPJ_VICLA, 100, "VICLA", SHARED_ADDRESS),
        customer(GODOI, CNPJ_GODOI, 200, "GODOI", SHARED_ADDRESS),
      ],
      memberships: [{ subjectCnpj: CNPJ_VICLA, subjectCustomerId: VICLA }],
      membershipThrows: true,
    });
    await review(scenario.db, "reject").catch(() => undefined);
    const result = await read(scenario.db);
    assert.notEqual(result.decision.customerStatus, "LIBERADO");
    assert.equal(result.decision.allowed, false);
  });
});

describe("vínculo empresarial › interface e paridade", () => {
  it("T31 a Ficha CNPJ mostra o motivo, o indício com tipo, data, fonte e confiabilidade", async () => {
    const { db } = viclaScenario();
    const view = await viewFor(db, true);
    assert.equal(view.customerStatus, "EM_ANALISE");
    assert.ok(view.decisionReasons.length > 0);
    const html = panel(view);
    for (const text of ["Vínculos pendentes de validação (1)", "GODOI &amp; CARDOSO (cenário)", "Mesmo endereço fiscal", "Baixa · indício, não prova", "Radar · cadastro dos clientes", "Empresas relacionadas confirmadas (0)"]) {
      assert.ok(html.includes(text), text);
    }
  });

  it("T32 a carteira acompanha a decisão do detalhe antes e depois de cada revisão", async () => {
    const scenario = viclaScenario();
    const row = { id: VICLA, taxId: CNPJ_VICLA, personId: 100 };
    assert.equal((await portfolio(scenario.db, row)).decision.customerStatus, (await read(scenario.db)).decision.customerStatus);
    assert.equal((await portfolio(scenario.db, row)).decision.reasonGroup, "avaliacao_pendente");
    await review(scenario.db, "confirm");
    const snap = await portfolio(scenario.db, row);
    const detail = await read(scenario.db);
    assert.equal(snap.decision.customerStatus, detail.decision.customerStatus);
    assert.equal(snap.decision.reason, detail.decision.reason);
    assert.equal(snap.decision.customerStatus, "LIBERADO");
  });

  it("T33 o Radar do cliente mostra o mesmo estado: pendente antes, fora da revisão depois", async () => {
    const scenario = viclaScenario();
    const before = await loadCustomerCorporateRadarView(scenario.db as never, { id: VICLA, taxId: CNPJ_VICLA }, NOW);
    assert.equal(before.review.length, 1);
    await review(scenario.db, "confirm");
    const after = await loadCustomerCorporateRadarView(scenario.db as never, { id: VICLA, taxId: CNPJ_VICLA }, NOW);
    assert.equal(after.review.length, 0);
    assert.ok(after.manual.includes(GODOI));
    assert.equal(after.writes, "NONE");
  });

  it("T34 depois da decisão a tela recarrega só o crédito, sem recarregar a página", () => {
    const sections = readFileSync(join(here, "../../components/customers/CustomerCnpjCreditSections.tsx"), "utf8");
    const handler = /const reviewLink[\s\S]*?\n  \};/.exec(sections)?.[0] ?? "";
    assert.match(handler, /fetchJsonOk\(`\/api\/customers\/\$\{customerId\}\/corporate-links`/);
    assert.match(handler, /onRefresh\?\.\(\)/);
    assert.doesNotMatch(sections, /location\.reload/);
    const panelSource = readFileSync(join(here, "../../components/customers/CorporateLinkReviewPanel.tsx"), "utf8");
    assert.doesNotMatch(panelSource, /location\.reload/);
    assert.match(panelSource, /minLength|CORPORATE_LINK_MIN_JUSTIFICATION/);
  });

  it("T35 decisões simultâneas pelas duas fichas terminam com as duas direções iguais", async () => {
    const scenario = viclaScenario();
    const results = await Promise.all([
      review(scenario.db, "confirm"),
      review(scenario.db, "reject", { subject: GODOI, related: VICLA }),
    ]);
    assert.ok(results.every((row) => row.httpStatus === 200 || row.httpStatus === 409));
    const [forward, backward] = pairStates(scenario.links());
    assert.equal(forward, backward);
    assert.equal(scenario.links().length, 2);
    assert.equal(scenario.audits().length % 2, 0, "auditoria sempre aos pares");
  });

  it("T36 confirmar vínculo só grava vínculo e auditoria; nenhum indicador financeiro muda", async () => {
    const scenario = viclaScenario({ godoiOverdue: true });
    const before = await read(scenario.db);
    await review(scenario.db, "confirm");
    const after = await read(scenario.db);
    assert.deepEqual([...new Set(scenario.writes())].sort(), ["commercialAuditLog", "customerCorporateLink"]);
    assert.equal(after.delinquency.overdueAmount, before.delinquency.overdueAmount);
    assert.equal(after.delinquency.overdueTitleCount, before.delinquency.overdueTitleCount);
    assert.equal(after.delinquency.status, before.delinquency.status);
    assert.equal(after.activeExceptions.length, before.activeExceptions.length);
  });
});

describe("vínculo empresarial › extras", () => {
  it("justificativa curta é recusada antes de qualquer leitura", async () => {
    const scenario = viclaScenario();
    const short = await review(scenario.db, "confirm", { justification: "ok" });
    assert.equal(short.httpStatus, 400);
    assert.equal(short.body.code, "CORPORATE_LINK_JUSTIFICATION");
    assert.deepEqual(scenario.writes(), []);
  });

  it("confirmar sem indício atual do par é recusado (não cria vínculo arbitrário)", async () => {
    const scenario = createDb({
      customers: [customer(VICLA, CNPJ_VICLA, 100, "VICLA"), customer(THIRD, CNPJ_THIRD, 300, "TERCEIRA")],
    });
    const response = await review(scenario.db, "confirm", { related: THIRD });
    assert.equal(response.httpStatus, 409);
    assert.equal(response.body.code, "CORPORATE_LINK_NO_EVIDENCE");
    assert.deepEqual(scenario.links(), []);
  });

  it("aplicar sem $transaction (loja simples) continua funcionando", async () => {
    const scenario = viclaScenario();
    const { $transaction: _ignored, ...plain } = scenario.db;
    void _ignored;
    const result = await applyCorporateLinkReview(plain as never, {
      actor: FINANCE,
      subjectCustomerId: VICLA,
      relatedCustomerId: GODOI,
      action: "confirm",
      justification: WHY,
      evidence: [{ relatedCustomerId: GODOI, basis: "SHARED_ADDRESS", evidenceLabel: "Endereço fiscal completo coincidente." }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(pairStates(scenario.links()), ["CONFIRMED", "CONFIRMED"]);
  });

  it("o histórico aparece na tela e o vínculo manual oferece Encerrar", async () => {
    const scenario = viclaScenario();
    await review(scenario.db, "confirm");
    const html = panel(await viewFor(scenario.db, true));
    assert.match(html, /data-testid="corporate-link-close"/);
    assert.match(html, /Confirmado manualmente/);
    const rejected = viclaScenario();
    await review(rejected.db, "reject");
    const history = panel(await viewFor(rejected.db, false));
    assert.match(history, /Histórico de vínculos rejeitados e encerrados \(1\)/);
    assert.match(history, /Rejeitado por Ana Financeiro/);
  });
});
