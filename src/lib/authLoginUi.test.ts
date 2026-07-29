import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAuthConnectivityErrorMessage,
  isAuthSessionExpiredMessage,
} from "./authLoginUi.js";

describe("authLoginUi", () => {
  it("reconhece sessão expirada / unauthorized", () => {
    assert.equal(
      isAuthSessionExpiredMessage("Sessão expirada. Faça login novamente."),
      true
    );
    assert.equal(isAuthSessionExpiredMessage("UNAUTHORIZED"), true);
    assert.equal(
      isAuthSessionExpiredMessage("Autenticação necessária."),
      true
    );
  });

  it("reconhece falha de conectividade", () => {
    assert.equal(
      isAuthConnectivityErrorMessage(
        "Não foi possível verificar sua sessão. Verifique a conexão e tente novamente."
      ),
      true
    );
    assert.equal(isAuthConnectivityErrorMessage("Failed to fetch"), true);
  });

  it("não trata sessão expirada como conectividade", () => {
    assert.equal(
      isAuthConnectivityErrorMessage("Sessão expirada. Faça login novamente."),
      false
    );
  });
});
