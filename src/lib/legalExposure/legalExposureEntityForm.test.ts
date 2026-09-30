import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import {
  buildCreateEntityBody,
  buildUpdateEntityBody,
  canSelectGroupCompany,
  EMPTY_COMPANIES_COPY,
  entityEditFormFrom,
  exposureEntityActions,
  exposureEntityErrorText,
  exposureEntityRequest,
  groupCompanyStatusLabel,
  matchExposureGroupCompanies,
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

  it("criação envia CNPJ e razão social da empresa selecionada", () => {
    const [official] = matchExposureGroupCompanies(FINANCE_INTERNAL_GROUP_COMPANIES, []);
    assert.ok(official);
    assert.equal(canSelectGroupCompany(official), true);
    const built = buildCreateEntityBody(official, {
      tradeName: " Exemplo ",
      state: "pr",
      city: " Curitiba ",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.body.cnpj, official.cnpj);
    assert.equal(built.body.legalName, official.legalName);
    assert.equal(built.body.tradeName, "Exemplo");
    assert.equal(built.body.state, "PR");
    assert.equal(built.body.city, "Curitiba");
    assert.equal("monitorDomicilio" in built.body, false);
  });

  it("empresa já cadastrada, inclusive inativa, não pode ser selecionada de novo", () => {
    const listed = matchExposureGroupCompanies(FINANCE_INTERNAL_GROUP_COMPANIES, [
      { id: "ent-inativa", cnpj: FINANCE_INTERNAL_GROUP_COMPANIES[0].cnpj, active: false },
    ]);
    assert.equal(listed.length, FINANCE_INTERNAL_GROUP_COMPANIES.length);
    assert.deepEqual(
      listed.map((row) => row.cnpj),
      FINANCE_INTERNAL_GROUP_COMPANIES.map((row) => row.cnpj)
    );
    assert.equal(listed[0]?.registered, true);
    assert.equal(listed[0]?.entityId, "ent-inativa");
    assert.equal(listed[0]?.active, false);
    assert.equal(canSelectGroupCompany(listed[0]!), false);
    assert.equal(groupCompanyStatusLabel(listed[0]!), "Já cadastrada · inativa");
    assert.equal(listed[1]?.registered, false);
    assert.equal(groupCompanyStatusLabel(listed[1]!), "Disponível");
    assert.equal(buildCreateEntityBody(listed[0]!, { tradeName: "", state: "", city: "" }).ok, false);
  });

  it("o Exposure não copia os CNPJs do grupo", () => {
    const roots = [
      join(process.cwd(), "src/lib/legalExposure"),
      join(process.cwd(), "src/components/legalExposure"),
    ];
    const files: string[] = [];
    for (const root of roots) {
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (name.endsWith(".ts") || name.endsWith(".tsx")) files.push(path);
        }
      };
      walk(root);
    }
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const company of FINANCE_INTERNAL_GROUP_COMPANIES) {
        assert.equal(text.includes(company.cnpj), false, file);
      }
    }
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
