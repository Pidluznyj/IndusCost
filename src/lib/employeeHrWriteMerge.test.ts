import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeEmployeeWriteData,
  stripProfessionalOverridesFromHrProfile,
} from "./employeeHrWriteMerge.js";

describe("employeeHrWriteMerge", () => {
  it("não deixa hrProfile apagar admissão, contrato e gestor", () => {
    const admissionDate = new Date("2024-03-15T12:00:00.000Z");
    const core = {
      name: "Ana",
      managerId: "mgr-1",
      managerName: "Carlos Gestor",
      contractType: "CLT",
      admissionDate,
      terminationDate: null as Date | null,
      cpf: null as string | null,
    };
    const hrProfile = {
      socialName: "Aninha",
      cpf: "52998224725",
      admissionDate: null,
      terminationDate: null,
      contractType: null,
      managerName: null,
      shirtSize: "M",
    };

    const merged = mergeEmployeeWriteData(core, hrProfile);

    assert.equal(merged.managerName, "Carlos Gestor");
    assert.equal(merged.contractType, "CLT");
    assert.equal(merged.admissionDate, admissionDate);
    assert.equal(merged.terminationDate, null);
    assert.equal(merged.cpf, "52998224725");
    assert.equal(merged.shirtSize, "M");
    assert.equal(merged.socialName, "Aninha");
  });

  it("strip remove apenas chaves profissionais", () => {
    const stripped = stripProfessionalOverridesFromHrProfile({
      phone: "11999999999",
      admissionDate: null,
      managerId: "x",
      epiNotes: "ok",
    });
    assert.equal(stripped.phone, "11999999999");
    assert.equal(stripped.epiNotes, "ok");
    assert.equal("admissionDate" in stripped, false);
    assert.equal("managerId" in stripped, false);
  });
});
