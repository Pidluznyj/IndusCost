import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMISSION_GROUP_COMPANY_EXCLUSION_REASON,
  isCommissionInternalGroupCustomer,
} from "./commissionInternalGroupExclusion.js";

describe("commissionInternalGroupExclusion", () => {
  it("reconhece CNPJs das três empresas do grupo", () => {
    assert.equal(
      isCommissionInternalGroupCustomer({
        customerCnpj: "72.569.510/0001-95",
        customerName: "Outro nome",
      }),
      true
    );
    assert.equal(
      isCommissionInternalGroupCustomer({
        customerCnpj: "14.055.501/0001-80",
        customerName: "X",
      }),
      true
    );
    assert.equal(
      isCommissionInternalGroupCustomer({
        customerCnpj: "55.717.719/0001-30",
        customerName: "X",
      }),
      true
    );
  });

  it("reconhece razão social do grupo sem CNPJ", () => {
    assert.equal(
      isCommissionInternalGroupCustomer({
        customerName: "Koppetel Comercio de Plasticos LTDA",
      }),
      true
    );
    assert.equal(
      isCommissionInternalGroupCustomer({
        customerName: "Sm Comercio de Plasticos LTDA - SM",
      }),
      true
    );
  });

  it("cliente de mercado não é excluído", () => {
    assert.equal(
      isCommissionInternalGroupCustomer({
        customerName: "Cliente Mercado Ltda",
        customerCnpj: "12.345.678/0001-90",
      }),
      false
    );
  });

  it("expõe motivo padronizado", () => {
    assert.equal(COMMISSION_GROUP_COMPANY_EXCLUSION_REASON, "EMPRESA_GRUPO_EXCLUIDA");
  });
});
