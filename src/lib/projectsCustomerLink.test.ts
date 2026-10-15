import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildLinkedCustomerSnapshot,
  formatTaxId,
  planProjectCustomerReconciliation,
  reconciliationTokenSource,
  summarizeReconciliation,
  type ReconciliationCustomer,
  type ReconciliationProject,
} from "./projectsCustomerLink.js";
import { resolveProjectCustomerLink } from "./projectsCustomerLinkService.js";
import {
  applyProjectCustomerReconciliation,
  buildProjectCustomerReconciliationPlan,
  reconciliationConfirmToken,
} from "./projectsCustomerReconciliation.server.js";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const C3 = "33333333-3333-4333-8333-333333333333";

const customers: ReconciliationCustomer[] = [
  { id: C1, companyName: "Metalúrgica Alfa Ltda", tradeName: "Alfa", taxId: "12345678000190", status: "ACTIVE" },
  // Mesmo CNPJ cadastrado duas vezes em formatos diferentes (taxId é texto livre).
  { id: C2, companyName: "Beta SA", tradeName: null, taxId: "98.765.432/0001-10", status: "ACTIVE" },
  { id: C3, companyName: "Beta Indústria SA", tradeName: null, taxId: "98765432000110", status: "ACTIVE" },
  { id: "c-inativo", companyName: "Gama Ltda", tradeName: null, taxId: "11.222.333/0001-81", status: "INACTIVE" },
];

const project = (over: Partial<ReconciliationProject>): ReconciliationProject => ({
  id: over.code ?? "p",
  code: "PRJ-0000",
  customerName: "Cliente",
  customerDocument: null,
  customerId: null,
  ...over,
});

describe("projectsCustomerLink — conciliação por CNPJ", () => {
  const plan = planProjectCustomerReconciliation(
    [
      project({ code: "PRJ-0001", customerName: "Alfa", customerDocument: "12.345.678/0001-90" }),
      project({ code: "PRJ-0002", customerName: "Beta", customerDocument: "98765432000110" }),
      project({ code: "PRJ-0003", customerName: "Metalúrgica Alfa Ltda", customerDocument: null }),
      project({ code: "PRJ-0004", customerName: "Delta", customerDocument: "55.555.555/0001-55" }),
      project({ code: "PRJ-0005", customerName: "Gama", customerDocument: "11222333000181" }),
      project({ code: "PRJ-0006", customerName: "X", customerDocument: "123" }),
      project({ code: "PRJ-0007", customerName: "Alfa", customerDocument: "12345678000190", customerId: C1 }),
      project({ code: "PRJ-0008", customerName: "Outro Nome", customerDocument: "12345678000190" }),
    ],
    customers,
  );
  const by = (code: string) => plan.find((e) => e.projectCode === code)!;

  it("vincula por dígitos idênticos, independente da formatação", () => {
    assert.equal(by("PRJ-0001").status, "LINK");
    assert.equal(by("PRJ-0001").customerId, C1);
    assert.equal(by("PRJ-0001").nameDiffers, false, "nome fantasia confere");
  });

  it("nunca vincula por nome: projeto sem documento fica de fora mesmo com nome idêntico", () => {
    assert.equal(by("PRJ-0003").status, "NO_DOCUMENT");
    assert.equal(by("PRJ-0003").customerId, null);
  });

  it("dois cadastros com o mesmo CNPJ → AMBIGUOUS, sem vínculo", () => {
    assert.equal(by("PRJ-0002").status, "AMBIGUOUS");
    assert.equal(by("PRJ-0002").customerId, null);
    assert.deepEqual(by("PRJ-0002").candidates.map((c) => c.id).sort(), [C2, C3].sort());
  });

  it("conflitos: não encontrado, inativo, documento inválido, já vinculado", () => {
    assert.equal(by("PRJ-0004").status, "NOT_FOUND");
    assert.equal(by("PRJ-0005").status, "INACTIVE_CUSTOMER");
    assert.equal(by("PRJ-0005").customerId, null);
    assert.equal(by("PRJ-0006").status, "INVALID_DOCUMENT");
    assert.equal(by("PRJ-0007").status, "ALREADY_LINKED");
  });

  it("nome divergente é sinalizado para revisão, mas o CNPJ decide", () => {
    assert.equal(by("PRJ-0008").status, "LINK");
    assert.equal(by("PRJ-0008").nameDiffers, true);
  });

  it("comparação informativa de nome ignora acentos e caixa", () => {
    const [e] = planProjectCustomerReconciliation(
      [project({ code: "PRJ-0009", customerName: "METALURGICA ALFA LTDA", customerDocument: "12345678000190" })],
      customers,
    );
    assert.equal(e.status, "LINK");
    assert.equal(e.nameDiffers, false);
  });

  it("resumo e token cobrem só os vínculos a gravar", () => {
    const s = summarizeReconciliation(plan);
    assert.equal(s.LINK, 2);
    assert.equal(s.AMBIGUOUS, 1);
    assert.equal(reconciliationTokenSource(plan).split("\n").length, 2);
    const token = reconciliationConfirmToken(plan);
    assert.match(token, /^[0-9a-f]{12}$/);
    const changed = plan.map((e) => (e.projectCode === "PRJ-0008" ? { ...e, status: "NOT_FOUND" as const } : e));
    assert.notEqual(reconciliationConfirmToken(changed), token, "plano diferente → token diferente");
  });
});

describe("projectsCustomerLink — snapshot e formatação", () => {
  it("formata CNPJ e CPF; outros tamanhos ficam como dígitos", () => {
    assert.equal(formatTaxId("12345678000190"), "12.345.678/0001-90");
    assert.equal(formatTaxId("123.456.789-09"), "123.456.789-09");
    assert.equal(formatTaxId("12345"), "12345");
    assert.equal(formatTaxId(null), null);
  });

  it("snapshot usa o cadastro (razão + fantasia, documento formatado)", () => {
    assert.deepEqual(
      buildLinkedCustomerSnapshot({ companyName: "Metalúrgica Alfa Ltda", tradeName: "Alfa", taxId: "12345678000190" }),
      { customerName: "Metalúrgica Alfa Ltda (Alfa)", customerDocument: "12.345.678/0001-90" },
    );
  });
});

describe("resolveProjectCustomerLink", () => {
  const db = {
    customer: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        customers.find((c) => c.id === where.id) ?? null,
    },
  } as never;

  it("valida o id e devolve o snapshot do cadastro (ignora o texto do navegador)", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const r = await resolveProjectCustomerLink(db, C1, now);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.customerId, C1);
    assert.equal(r.data.customerName, "Metalúrgica Alfa Ltda (Alfa)");
    assert.equal(r.data.customerDocument, "12.345.678/0001-90");
    assert.equal(r.data.customerLinkSource, "LOOKUP");
    assert.equal(r.data.customerLinkedAt, now);
  });

  it("recusa id inválido, inexistente e cliente inativo", async () => {
    const bad = await resolveProjectCustomerLink(db, "x");
    assert.equal(bad.ok === false && bad.code, "INVALID_CUSTOMER_ID");
    const missing = await resolveProjectCustomerLink(db, "44444444-4444-4444-8444-444444444444");
    assert.equal(missing.ok === false && missing.code, "CUSTOMER_NOT_FOUND");
    const inactiveDb = {
      customer: { findUnique: async () => ({ ...customers[0], status: "INACTIVE" }) },
    } as never;
    const inactive = await resolveProjectCustomerLink(inactiveDb, C1);
    assert.equal(inactive.ok === false && inactive.code, "CUSTOMER_INACTIVE");
  });
});

describe("conciliação — aplicação", () => {
  function fakeDb() {
    const rows = [
      { id: "p1", code: "PRJ-0001", customerName: "Alfa (nome da época)", customerDocument: "12.345.678/0001-90", customerId: null as string | null, customerLinkSource: null as string | null, customerLinkedAt: null as Date | null },
      { id: "p2", code: "PRJ-0002", customerName: "Sem doc", customerDocument: null, customerId: null, customerLinkSource: null, customerLinkedAt: null },
    ];
    return {
      rows,
      project: {
        findMany: async () => rows.map(({ id, code, customerName, customerDocument, customerId }) => ({ id, code, customerName, customerDocument, customerId })),
        updateMany: async ({ where, data }: { where: { id: string; customerId: null }; data: Record<string, unknown> }) => {
          const r = rows.find((x) => x.id === where.id && x.customerId === null);
          if (!r) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        },
      },
      customer: { findMany: async () => customers },
    };
  }

  it("dry-run não grava; aplicação grava só o vínculo e preserva o snapshot histórico", async () => {
    const db = fakeDb();
    const plan = await buildProjectCustomerReconciliationPlan(db as never);
    assert.equal(db.rows[0].customerId, null, "plano não grava");
    const now = new Date("2026-10-15T10:00:00Z");
    const res = await applyProjectCustomerReconciliation(db as never, plan, now);
    assert.equal(res.linked, 1);
    assert.equal(db.rows[0].customerId, C1);
    assert.equal(db.rows[0].customerLinkSource, "CNPJ_RECONCILIATION");
    assert.equal(db.rows[0].customerLinkedAt, now);
    assert.equal(db.rows[0].customerName, "Alfa (nome da época)", "nome usado em emissões anteriores preservado");
    assert.equal(db.rows[0].customerDocument, "12.345.678/0001-90");
    assert.equal(db.rows[1].customerId, null);
  });

  it("não sobrescreve projeto que ganhou vínculo entre o dry-run e a aplicação", async () => {
    const db = fakeDb();
    const plan = await buildProjectCustomerReconciliationPlan(db as never);
    db.rows[0].customerId = C2;
    const res = await applyProjectCustomerReconciliation(db as never, plan);
    assert.equal(res.linked, 0);
    assert.deepEqual(res.skippedChanged, ["PRJ-0001"]);
    assert.equal(db.rows[0].customerId, C2);
  });
});

describe("rotas de projeto — contrato do vínculo", () => {
  const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");

  it("POST e PATCH validam customerId no servidor", () => {
    assert.equal(routes.match(/resolveProjectCustomerLink\(prisma, body\.customerId\)/g)?.length, 2);
  });

  it("PATCH recusa editar nome/documento de projeto vinculado sem desvincular", () => {
    assert.match(routes, /code: "CUSTOMER_LINKED"/);
  });

  it("script de conciliação é dry-run por padrão e exige token", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "projectCustomerLinkReconcile.ts"), "utf8");
    assert.match(script, /if \(!process\.argv\.includes\("--apply"\)\)/);
    assert.match(script, /arg\("confirm"\) !== token/);
    assert.doesNotMatch(script, /companyName:\s*\{\s*contains/, "sem busca por nome");
  });
});
