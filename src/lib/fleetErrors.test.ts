import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetValidationError } from "./fleetValidation.js";
import { formatFleetApiError } from "./fleetApiError.js";
import {
  FleetBusinessError,
  FLEET_SAFE_INTERNAL_MESSAGE,
  mapFleetErrorToHttp,
  fleetValidationHttpStatus,
  inferFleetErrorFromMessage,
} from "./fleetErrors.js";

describe("fleetErrors", () => {
  it("reservation conflict maps to 409", () => {
    const mapped = mapFleetErrorToHttp(
      new FleetValidationError("Conflito de reserva: veículo já reservado neste período.")
    );
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, "FLEET_CONFLICT");
    assert.equal(mapped.isBusiness, true);
    assert.equal(fleetValidationHttpStatus("Conflito de reserva: x"), 409);
  });

  it("expired CNH maps to 422", () => {
    const mapped = mapFleetErrorToHttp(
      new FleetValidationError("CNH vencida: motorista não pode ser vinculado à reserva/retirada.")
    );
    assert.equal(mapped.status, 422);
    assert.equal(mapped.code, "FLEET_CNH_EXPIRED");
  });

  it("FleetBusinessError forbidden maps to 403", () => {
    const mapped = mapFleetErrorToHttp(
      new FleetBusinessError("Sem permissão para esta ação.", {
        code: "FLEET_FORBIDDEN",
        httpStatus: 403,
      })
    );
    assert.equal(mapped.status, 403);
    assert.equal(mapped.message, "Sem permissão para esta ação.");
  });

  it("unexpected technical error maps to 500 safe message", () => {
    const mapped = mapFleetErrorToHttp(new Error("column \"x\" does not exist"));
    assert.equal(mapped.status, 500);
    assert.equal(mapped.message, FLEET_SAFE_INTERNAL_MESSAGE);
    assert.equal(mapped.retryable, true);
    assert.equal(mapped.isBusiness, false);
  });

  it("inferFleetErrorFromMessage covers document and km", () => {
    assert.equal(inferFleetErrorFromMessage("Documento vencido impede reserva").status, 422);
    assert.equal(inferFleetErrorFromMessage("Km final não pode ser menor").status, 400);
    assert.equal(inferFleetErrorFromMessage("Motivo é obrigatório").status, 400);
  });

  it("formatFleetApiError hides undefined and suggests retry on 5xx", () => {
    assert.equal(formatFleetApiError(new Error("undefined"), "Fallback"), "Fallback");
    assert.match(formatFleetApiError(new Error("Erro HTTP 500")), /tente novamente/i);
  });
});
