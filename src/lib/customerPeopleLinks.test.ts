import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CanonicalPersonError, classifyCustomerDocument } from "./canonicalPerson.ts";
import {
  linkCustomerIdentityPerson,
  unlinkCustomerIdentityPerson,
  linkCustomerContactPerson,
} from "./canonicalPersonService.server.ts";

const PF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PJ_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSON_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("customer people links — regras PF/PJ", () => {
  it("classifica CPF/CNPJ", () => {
    assert.equal(classifyCustomerDocument("52998224725"), "PF");
    assert.equal(classifyCustomerDocument("11222333000181"), "PJ");
  });

  it("bloqueia identidade Person em cliente PJ", async () => {
    const prisma = {
      customer: {
        findUnique: async () => ({
          id: PJ_ID,
          taxId: "11222333000181",
          companyName: "Empresa Ltda",
          contactName: "João",
          email: "a@b.co",
          phone: "11999999999",
          personId: null,
        }),
      },
    } as never;

    await assert.rejects(
      () =>
        linkCustomerIdentityPerson(prisma, PJ_ID, {
          personId: PERSON_ID,
        }),
      (e: unknown) => e instanceof CanonicalPersonError && e.code === "CUSTOMER_NOT_PF"
    );
  });

  it("vincula identidade em PF", async () => {
    let updated: Record<string, unknown> | null = null;
    const prisma = {
      customer: {
        findUnique: async () => ({
          id: PF_ID,
          taxId: "52998224725",
          companyName: "Maria Silva",
          contactName: "Maria Silva",
          email: "maria@x.com",
          phone: "11988887777",
          personId: null,
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updated = data;
          return { id: PF_ID, personId: data.personId };
        },
      },
      person: {
        findUnique: async () => ({
          id: PERSON_ID,
          displayName: "Maria Silva",
          socialName: null,
          corporateEmail: null,
          personalEmail: "maria@x.com",
          cpfNormalized: "52998224725",
          phoneNormalized: "11988887777",
          status: "ACTIVE",
        }),
        findUniqueOrThrow: async () => ({
          id: PERSON_ID,
          displayName: "Maria Silva",
          socialName: null,
          corporateEmail: null,
          personalEmail: "maria@x.com",
          cpfNormalized: "52998224725",
          phoneNormalized: "11988887777",
          status: "ACTIVE",
        }),
      },
    } as never;

    const r = await linkCustomerIdentityPerson(prisma, PF_ID, { personId: PERSON_ID });
    assert.equal(r.personId, PERSON_ID);
    assert.equal(updated?.personId, PERSON_ID);
  });

  it("desvincula identidade preservando personId anterior no audit path", async () => {
    const prisma = {
      customer: {
        findUnique: async () => ({ id: PF_ID, personId: PERSON_ID }),
        update: async () => ({ id: PF_ID, personId: null }),
      },
    } as never;
    const r = await unlinkCustomerIdentityPerson(prisma, PF_ID);
    assert.equal(r.personId, null);
  });

  it("vincula contato em PJ (não identidade)", async () => {
    let updated: Record<string, unknown> | null = null;
    const prisma = {
      customer: {
        findUnique: async () => ({
          id: PJ_ID,
          taxId: "11222333000181",
          companyName: "Empresa Ltda",
          contactName: "Comprador",
          email: "c@e.com",
          phone: null,
          personId: null,
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updated = data;
          return { id: PJ_ID, contactPersonId: data.contactPersonId };
        },
      },
      person: {
        findUnique: async () => ({
          id: PERSON_ID,
          displayName: "Comprador",
          status: "ACTIVE",
        }),
        findUniqueOrThrow: async () => ({
          id: PERSON_ID,
          displayName: "Comprador",
          status: "ACTIVE",
        }),
      },
    } as never;

    const r = await linkCustomerContactPerson(prisma, PJ_ID, { personId: PERSON_ID });
    assert.equal(r.contactPersonId, PERSON_ID);
    assert.equal(updated?.contactPersonId, PERSON_ID);
    assert.equal(updated?.personId, undefined);
  });
});
