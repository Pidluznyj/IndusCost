import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCreateEntityBody,
  buildUpdateEntityBody,
  EMPTY_COMPANIES_COPY,
  entityEditFormFrom,
  exposureEntityActions,
  exposureEntityErrorText,
  exposureEntityRequest,
  type MonitoredEntity,
} from "./legalExposureEntityForm.js";

const entity: MonitoredEntity = {
  id: "ent-1",
  cnpj: "11222333000181",
  legalName: "Industria Exemplo LTDA",
  tradeName: "Exemplo",
  active: true,
  state: "PR",
  city: "Curitiba",
  monitorDomicilio: true,
  monitorDatajud: false,
  monitorDjen: true,
  monitorCertificates: true,
  domicilioTenantId: null,
  lastSuccessfulSyncAt: null,
};

describe("exposure entity form", () => {
  it("view sem manage não mostra adicionar nem editar", () => {
    const actions = exposureEntityActions(false);
    assert.equal(actions.showAdd, false);
    assert.equal(actions.showEdit, false);
    assert.match(EMPTY_COMPANIES_COPY, /Nenhuma empresa cadastrada/);
  });

  it("manage abre o cadastro", () => {
    const actions = exposureEntityActions(true);
    assert.equal(actions.showAdd, true);
    const request = exposureEntityRequest("create");
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/api/legal-exposure/entities");
  });

  it("criação envia o contrato do POST", () => {
    const built = buildCreateEntityBody({
      cnpj: "11.222.333/0001-81",
      legalName: " Industria Exemplo LTDA ",
      tradeName: " Exemplo ",
      state: "pr",
      city: " Curitiba ",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.deepEqual(built.body, {
      cnpj: "11.222.333/0001-81",
      legalName: "Industria Exemplo LTDA",
      tradeName: "Exemplo",
      state: "PR",
      city: "Curitiba",
    });
    assert.equal("monitorDomicilio" in built.body, false);
  });

  it("edição faz PATCH no id e não envia CNPJ", () => {
    const request = exposureEntityRequest("edit", entity.id);
    assert.equal(request.method, "PATCH");
    assert.equal(request.path, "/api/legal-exposure/entities/ent-1");
    const body = buildUpdateEntityBody({
      ...entityEditFormFrom(entity),
      legalName: "Industria Exemplo Atualizada",
      active: false,
      monitorDatajud: true,
    });
    assert.equal(body.legalName, "Industria Exemplo Atualizada");
    assert.equal(body.active, false);
    assert.equal(body.monitorDatajud, true);
    assert.equal("cnpj" in body, false);
    assert.equal("domicilioTenantId" in body, false);
  });

  it("exibe conflito e validação do backend", () => {
    assert.equal(exposureEntityErrorText(new Error("CNPJ já monitorado.")), "CNPJ já monitorado.");
    assert.equal(exposureEntityErrorText(new Error("CNPJ inválido.")), "CNPJ inválido.");
  });

  it("o fluxo de empresa não aponta para sync nem teste de fonte", () => {
    for (const mode of ["create", "edit"] as const) {
      const request = exposureEntityRequest(mode, "ent-1");
      assert.equal(request.path.includes("/sync"), false);
      assert.equal(request.path.includes("/sources/test"), false);
    }
  });
});
