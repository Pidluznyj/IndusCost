/**
 * Regras puras da justificativa DEVICE vs HUMAN.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEVICE_COUNT_JUSTIFICATION,
  resolveRecordedCountJustification,
} from "./inventoryCountDeviceJustification.js";

describe("resolveRecordedCountJustification", () => {
  it("DEVICE com delta efetivo injeta constante e ignora client", () => {
    assert.equal(
      resolveRecordedCountJustification({
        actorType: "DEVICE",
        effectiveDelta: -10,
        clientJustification: null,
      }),
      DEVICE_COUNT_JUSTIFICATION
    );
    assert.equal(
      resolveRecordedCountJustification({
        actorType: "DEVICE",
        effectiveDelta: 5,
        clientJustification: "forjado",
      }),
      DEVICE_COUNT_JUSTIFICATION
    );
  });

  it("DEVICE sem divergência efetiva não inventa justification", () => {
    assert.equal(
      resolveRecordedCountJustification({
        actorType: "DEVICE",
        effectiveDelta: 0,
        clientJustification: "não usar",
      }),
      null
    );
  });

  it("USER exige texto do operador — sem injeção", () => {
    assert.equal(
      resolveRecordedCountJustification({
        actorType: "USER",
        effectiveDelta: -10,
        clientJustification: null,
      }),
      null
    );
    assert.equal(
      resolveRecordedCountJustification({
        actorType: "USER",
        effectiveDelta: -10,
        clientJustification: "Falta física confirmada",
      }),
      "Falta física confirmada"
    );
  });
});
