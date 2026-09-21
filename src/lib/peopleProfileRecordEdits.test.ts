import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PeopleProfileAccessError } from "./peopleProfileErrors.ts";
import {
  assertAdjustmentPercentageInRange,
  assertCareerEventEditable,
  buildEmployeePhotoUrl,
  isCareerEventEditable,
  normalizeOptionalAmount,
  normalizeUserCompensationType,
  parseCareerEventPatch,
  parseCompensationAdjustmentPatch,
  parseEmergencyContactPatch,
  parseEmployeeAbsencePatch,
  parseEmployeeBenefitPatch,
  parseEmployeeDocumentPatch,
  parseEmployeeNotePatch,
  parseEpiDeliveryPatch,
  PEOPLE_RECORD_MAX_AMOUNT,
  PEOPLE_RECORD_TEXT_LIMITS,
  resolveCareerEventTypeChange,
  sniffImageContentType,
} from "./peopleProfileRecordEdits.ts";

function expect400(code: string) {
  return (err: unknown) => {
    assert.ok(err instanceof PeopleProfileAccessError);
    assert.equal(err.status, 400);
    assert.equal(err.code, code);
    return true;
  };
}

describe("peopleProfileRecordEdits — patches parciais", () => {
  it("só as chaves presentes entram no patch; null/\"\" limpam coluna anulável", () => {
    assert.deepEqual(parseCompensationAdjustmentPatch({}), {});
    const patch = parseCompensationAdjustmentPatch({
      previousAmount: null,
      newAmount: "2300.50",
      reason: "   ",
      ignorada: "x",
    });
    assert.deepEqual(patch, { previousAmount: null, newAmount: 2300.5, reason: null });
    assert.deepEqual(parseEmployeeAbsencePatch({ endDate: "", notes: undefined }), { endDate: null });
  });

  it("datas aceitam YYYY-MM-DD e ISO; inválida → 400 INVALID_DATE", () => {
    const patch = parseCareerEventPatch({ effectiveDate: "2024-05-01" });
    assert.equal(patch.effectiveDate?.toISOString(), "2024-05-01T00:00:00.000Z");
    const iso = parseEpiDeliveryPatch({ deliveredAt: "2024-05-01T13:30:00.000Z" });
    assert.equal(iso.deliveredAt?.toISOString(), "2024-05-01T13:30:00.000Z");
    assert.throws(() => parseCareerEventPatch({ effectiveDate: "ontem" }), expect400("INVALID_DATE"));
    // Data obrigatória não pode ser limpa.
    assert.throws(() => parseCareerEventPatch({ effectiveDate: null }), expect400("INVALID_DATE"));
  });

  it("valores: finitos e >= 0, sem ecoar o número na mensagem", () => {
    for (const bad of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, "abc", {}, true]) {
      assert.throws(
        () => parseCompensationAdjustmentPatch({ newAmount: bad }),
        (err: unknown) => {
          assert.ok(err instanceof PeopleProfileAccessError);
          assert.equal(err.code, "INVALID_AMOUNT");
          assert.equal(err.message, "Novo valor: valor inválido.");
          return true;
        }
      );
    }
    assert.throws(() => parseCompensationAdjustmentPatch({ newAmount: null }), expect400("INVALID_AMOUNT"));
    assert.deepEqual(parseCompensationAdjustmentPatch({ previousAmount: 0 }), { previousAmount: 0 });
  });

  it("enums, quantidade e prioridade", () => {
    assert.throws(() => parseCompensationAdjustmentPatch({ type: "BONUS" }), expect400("INVALID_TYPE"));
    assert.equal(parseCompensationAdjustmentPatch({ type: "MANUAL_EDIT" }).type, "MANUAL_EDIT");
    assert.throws(() => normalizeUserCompensationType("MANUAL_EDIT"), expect400("INVALID_TYPE"));
    assert.equal(normalizeUserCompensationType(undefined), "OTHER");
    assert.throws(() => parseEmployeeAbsencePatch({ status: "DONE" }), expect400("INVALID_STATUS"));
    assert.throws(() => parseEmployeeAbsencePatch({ type: "X" }), expect400("INVALID_TYPE"));
    assert.throws(
      () => parseEmployeeBenefitPatch({ status: "PAUSED" }, { allowAmount: true }),
      expect400("INVALID_STATUS")
    );
    assert.throws(() => parseEpiDeliveryPatch({ quantity: 0 }), expect400("INVALID_QUANTITY"));
    assert.throws(() => parseEpiDeliveryPatch({ quantity: "1.5" }), expect400("INVALID_QUANTITY"));
    assert.equal(parseEpiDeliveryPatch({ quantity: "4" }).quantity, 4);
    assert.throws(() => parseEmergencyContactPatch({ priority: 0 }), expect400("INVALID_PRIORITY"));
    assert.throws(() => parseEmergencyContactPatch({ priority: 10 }), expect400("INVALID_PRIORITY"));
    assert.equal(parseEmergencyContactPatch({ priority: 9 }).priority, 9);
    assert.throws(() => parseEmployeeNotePatch({ category: "SECRETA" }), expect400("INVALID_CATEGORY"));
  });

  it("textos obrigatórios não vazios e limites de tamanho", () => {
    assert.throws(() => parseEmployeeDocumentPatch({ displayName: "  " }), expect400("REQUIRED_FIELD"));
    assert.throws(() => parseEmployeeDocumentPatch({ documentType: null }), expect400("REQUIRED_FIELD"));
    assert.throws(() => parseEmergencyContactPatch({ phone: 4199990000 }), expect400("INVALID_FIELD"));
    assert.throws(
      () => parseEmployeeNotePatch({ body: "x".repeat(PEOPLE_RECORD_TEXT_LIMITS.noteBody + 1) }),
      expect400("FIELD_TOO_LONG")
    );
    assert.deepEqual(parseEmployeeDocumentPatch({ displayName: "  ASO  ", notes: null }), {
      displayName: "ASO",
      notes: null,
    });
  });

  it("benefício: amount só entra com allowAmount", () => {
    assert.deepEqual(parseEmployeeBenefitPatch({ amount: 100 }, { allowAmount: false }), {});
    // Sem permissão o valor nem é validado (não vira oráculo).
    assert.deepEqual(parseEmployeeBenefitPatch({ amount: -5 }, { allowAmount: false }), {});
    assert.deepEqual(parseEmployeeBenefitPatch({ amount: null }, { allowAmount: true }), { amount: null });
  });

  it("corpo que não é objeto → 400 INVALID_BODY", () => {
    assert.throws(() => parseEmployeeNotePatch(null), expect400("INVALID_BODY"));
    assert.throws(() => parseEmployeeNotePatch([]), expect400("INVALID_BODY"));
    assert.throws(() => parseEmployeeNotePatch("texto"), expect400("INVALID_BODY"));
  });
});

describe("peopleProfileRecordEdits — trava de carreira", () => {
  it("editáveis x travados", () => {
    for (const type of ["PROMOTION", "ROLE_CHANGE", "MANAGER_CHANGE", "ADMISSION", "TERMINATION", "REHIRE"]) {
      assert.equal(isCareerEventEditable(type), true, type);
      assert.doesNotThrow(() => assertCareerEventEditable(type));
    }
    for (const type of ["INITIAL_STATE", "COMPENSATION_ADJUSTMENT", "BENEFIT_CHANGE", "NOTE_ADDED"]) {
      assert.equal(isCareerEventEditable(type), false, type);
      assert.throws(
        () => assertCareerEventEditable(type),
        (err: unknown) => {
          assert.ok(err instanceof PeopleProfileAccessError);
          assert.equal(err.status, 409);
          assert.equal(err.code, "HISTORY_EVENT_LOCKED");
          return true;
        }
      );
    }
  });

  it("reclassificação só PROMOTION <-> ROLE_CHANGE", () => {
    assert.equal(resolveCareerEventTypeChange("PROMOTION", "ROLE_CHANGE"), "ROLE_CHANGE");
    assert.equal(resolveCareerEventTypeChange("ROLE_CHANGE", "PROMOTION"), "PROMOTION");
    assert.equal(resolveCareerEventTypeChange("TERMINATION", "TERMINATION"), "TERMINATION");
    assert.throws(
      () => resolveCareerEventTypeChange("PROMOTION", "TERMINATION"),
      expect400("INVALID_EVENT_TYPE")
    );
    assert.throws(
      () => resolveCareerEventTypeChange("CONTRACT_CHANGE", "ROLE_CHANGE"),
      expect400("INVALID_EVENT_TYPE")
    );
  });
});

describe("peopleProfileRecordEdits — foto", () => {
  it("reconhece JPEG/PNG/WebP pelos magic bytes e recusa o resto", () => {
    assert.equal(sniffImageContentType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
    assert.equal(
      sniffImageContentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
      "image/png"
    );
    const webp = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
    assert.equal(sniffImageContentType(webp), "image/webp");
    assert.equal(sniffImageContentType(new TextEncoder().encode("RIFF....WAVE")), null);
    assert.equal(sniffImageContentType(new TextEncoder().encode("GIF89a")), null);
    assert.equal(sniffImageContentType(new TextEncoder().encode("<svg></svg>")), null);
    assert.equal(sniffImageContentType(new Uint8Array(0)), null);
  });

  it("URL da foto muda quando a chave de armazenamento muda", () => {
    const a = buildEmployeePhotoUrl("emp-1", "hremployeephotos/emp-1/0a1b2c3d-foto.jpg");
    const b = buildEmployeePhotoUrl("emp-1", "hremployeephotos/emp-1/ffff0000-foto.png");
    assert.equal(a, "/api/employees/emp-1/photo?v=0a1b2c3d");
    assert.notEqual(a, b);
    assert.equal(buildEmployeePhotoUrl("emp-1", "legado/foto.jpg"), "/api/employees/emp-1/photo");
  });
});

describe("valores — teto e percentual fora da coluna", () => {
  it("valor acima do teto → 400 INVALID_AMOUNT", () => {
    assert.throws(
      () => normalizeOptionalAmount(PEOPLE_RECORD_MAX_AMOUNT + 1, "Novo salário"),
      (err: unknown) => err instanceof PeopleProfileAccessError && err.code === "INVALID_AMOUNT" && err.status === 400
    );
    assert.equal(normalizeOptionalAmount(PEOPLE_RECORD_MAX_AMOUNT, "Novo salário"), PEOPLE_RECORD_MAX_AMOUNT);
  });

  it("percentual que não cabe em Decimal(10,6) vira 400 com dica, não 500 do banco", () => {
    assert.equal(assertAdjustmentPercentageInRange(null), null);
    assert.equal(assertAdjustmentPercentageInRange(7.14), 7.14);
    assert.equal(assertAdjustmentPercentageInRange(-100), -100);
    assert.throws(
      () => assertAdjustmentPercentageInRange(10900),
      (err: unknown) =>
        err instanceof PeopleProfileAccessError &&
        err.code === "INVALID_AMOUNT" &&
        /percentual fora do limite/i.test(err.message)
    );
  });
});
