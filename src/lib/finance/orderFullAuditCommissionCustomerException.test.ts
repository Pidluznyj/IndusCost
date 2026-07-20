import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveCommissionSellerDisplay } from "@/src/lib/commissions/commissionSellerDisplay.js";
import {
  ORDER_FULL_AUDIT_COMMISSION_PERSON_SELECT,
  mapOrderFullAuditCommissionCustomerException,
} from "./orderFullAuditService.js";

const SERVICE_SRC = readFileSync(
  join(process.cwd(), "src/lib/finance/orderFullAuditService.ts"),
  "utf8"
);

describe("orderFullAudit — CommissionCustomerException / CommissionPerson", () => {
  it("select Prisma não referencia campo inexistente canonicalName", () => {
    assert.deepEqual(ORDER_FULL_AUDIT_COMMISSION_PERSON_SELECT, {
      id: true,
      name: true,
    });
    assert.equal(
      "canonicalName" in ORDER_FULL_AUDIT_COMMISSION_PERSON_SELECT,
      false
    );
    assert.doesNotMatch(
      SERVICE_SRC,
      /commissionPerson:\s*\{[^}]*canonicalName\s*:\s*true/s
    );
    assert.doesNotMatch(
      SERVICE_SRC,
      /commissionPerson\?\.canonicalName/
    );
    assert.match(
      SERVICE_SRC,
      /ORDER_FULL_AUDIT_COMMISSION_PERSON_SELECT/
    );
  });

  it("exceção com pessoa vinculada e nome oficial", () => {
    const dto = mapOrderFullAuditCommissionCustomerException({
      id: "exc-1",
      reason: "Cliente especial",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: null,
      active: true,
      productCode: null,
      commissionPerson: { id: "person-1", name: "GISLENE LIMA" },
    });
    assert.equal(dto.commissionPersonName, "GISLENE LIMA");
    assert.equal(dto.reason, "Cliente especial");
    assert.equal(dto.active, true);
    assert.equal(
      resolveCommissionSellerDisplay({
        commissionPerson: { id: "person-1", name: "GISLENE LIMA" },
      }).name,
      "GISLENE LIMA"
    );
  });

  it("exceção sem pessoa vinculada", () => {
    const dto = mapOrderFullAuditCommissionCustomerException({
      id: "exc-2",
      reason: "Sem beneficiário",
      startDate: new Date("2026-02-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      active: false,
      productCode: "SKU-1",
      commissionPerson: null,
    });
    assert.equal(dto.commissionPersonName, null);
    assert.equal(dto.productCode, "SKU-1");
    assert.equal(dto.active, false);
  });

  it("pessoa com nome oficial (mesmo com alias lógico no cadastro)", () => {
    // Alias resolve identidade em outros fluxos; aqui o vínculo já aponta ao
    // CommissionPerson canônico — display = name oficial armazenado.
    const dto = mapOrderFullAuditCommissionCustomerException({
      id: "exc-3",
      reason: "Alias → canônico",
      startDate: new Date("2026-03-01T00:00:00.000Z"),
      endDate: null,
      active: true,
      productCode: null,
      commissionPerson: {
        id: "person-gislene",
        name: "GISLENE LIMA",
      },
    });
    assert.equal(dto.commissionPersonName, "GISLENE LIMA");
  });

  it("fallback quando nome está ausente/vazio", () => {
    const dto = mapOrderFullAuditCommissionCustomerException({
      id: "exc-4",
      reason: "Pessoa quebrada",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: null,
      active: true,
      productCode: null,
      commissionPerson: { id: "person-broken", name: "   " },
    });
    assert.equal(dto.commissionPersonName, null);
    assert.equal(
      resolveCommissionSellerDisplay({
        commissionPerson: { id: "person-broken", name: "   " },
      }).resolutionStatus,
      "BROKEN_COMMISSION_PERSON_REFERENCE"
    );
  });

  it("DTO entrega commissionPersonName esperado (contrato estável)", () => {
    const dto = mapOrderFullAuditCommissionCustomerException({
      id: "exc-5",
      reason: null,
      startDate: new Date("2026-05-01T12:00:00.000Z"),
      endDate: null,
      active: true,
      productCode: null,
      commissionPerson: { id: "p", name: "Rodrigo Da Silva Ramos" },
    });
    assert.deepEqual(
      {
        id: dto.id,
        reason: dto.reason,
        commissionPersonName: dto.commissionPersonName,
        active: dto.active,
      },
      {
        id: "exc-5",
        reason: "",
        commissionPersonName: "Rodrigo Da Silva Ramos",
        active: true,
      }
    );
  });
});
