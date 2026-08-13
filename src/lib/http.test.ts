/**
 * Testes do wrapper central de HTTP (auth definitiva).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchJsonOk,
  fetchOk,
  AuthRequiredError,
  HttpError,
  APP_AUTH_REQUIRED_EVENT,
} from "./http.js";
import { BOOTSTRAP_ADMIN_REQUIRED_CODE } from "./auth/adminElevation.shared.js";

type FetchImpl = (input: unknown, init: RequestInit | undefined) => Promise<Response>;

let lastInput: unknown;
let lastInit: RequestInit | undefined;
let fetchImpl: FetchImpl;
let dispatched: string[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  lastInput = undefined;
  lastInit = undefined;
  dispatched = [];
  (globalThis as unknown as { fetch: FetchImpl }).fetch = (input, init) => {
    lastInput = input;
    lastInit = init;
    return fetchImpl(input, init);
  };
  (globalThis as unknown as { window: unknown }).window = {
    dispatchEvent: (e: { type: string }) => {
      dispatched.push(e.type);
      return true;
    },
  };
  if (typeof (globalThis as { CustomEvent?: unknown }).CustomEvent === "undefined") {
    (globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    };
  }
});

test("fetchJsonOk usa credentials:include por padrão", async () => {
  fetchImpl = async () => jsonResponse({ ok: true });
  await fetchJsonOk("/api/x");
  assert.equal(lastInit?.credentials, "include");
});

test("fetchJsonOk respeita credentials explícito", async () => {
  fetchImpl = async () => jsonResponse({ ok: true });
  await fetchJsonOk("/api/x", { credentials: "same-origin" });
  assert.equal(lastInit?.credentials, "same-origin");
});

test("fetchJsonOk preserva AbortSignal", async () => {
  fetchImpl = async () => jsonResponse({ ok: true });
  const ctrl = new AbortController();
  await fetchJsonOk("/api/x", { signal: ctrl.signal });
  assert.equal(lastInit?.signal, ctrl.signal);
});

test("fetchJsonOk não injeta Content-Type (FormData seguro)", async () => {
  fetchImpl = async () => jsonResponse({ ok: true });
  const fd = new FormData();
  fd.append("file", new Blob(["x"]), "f.txt");
  await fetchJsonOk("/api/upload", { method: "POST", body: fd });
  // wrapper não adiciona headers: deixa o browser definir o boundary do FormData.
  assert.equal(lastInit?.headers, undefined);
  assert.equal((lastInit?.body as unknown) === fd, true);
});

test("fetchJsonOk lança AuthRequiredError e dispara evento global em 401", async () => {
  fetchImpl = async () =>
    jsonResponse({ error: "UNAUTHORIZED", message: "Autenticação necessária." }, 401);
  await assert.rejects(
    fetchJsonOk("/api/protegida"),
    (e: unknown) => e instanceof AuthRequiredError && (e as AuthRequiredError).status === 401
  );
  assert.ok(dispatched.includes(APP_AUTH_REQUIRED_EVENT));
});

test("fetchJsonOk com suppressAuthEvent não dispara evento global em 401", async () => {
  fetchImpl = async () =>
    jsonResponse({ error: "UNAUTHORIZED", message: "Autenticação necessária." }, 401);
  await assert.rejects(
    fetchJsonOk("/api/auth/login", { suppressAuthEvent: true }),
    AuthRequiredError
  );
  assert.equal(dispatched.length, 0);
});

test("401 INVALID_CREDENTIALS não dispara logout da sessão principal", async () => {
  fetchImpl = async () =>
    jsonResponse({ error: "INVALID_CREDENTIALS", message: "Credenciais administrativas inválidas." }, 401);
  await assert.rejects(
    fetchJsonOk("/api/bootstrap-admin/login"),
    (e: unknown) =>
      e instanceof HttpError &&
      !(e instanceof AuthRequiredError) &&
      e.status === 401 &&
      e.code === "INVALID_CREDENTIALS"
  );
  assert.equal(dispatched.length, 0);
});

test("401 BOOTSTRAP_ADMIN_REQUIRED não dispara logout da sessão principal", async () => {
  fetchImpl = async () =>
    jsonResponse(
      { error: BOOTSTRAP_ADMIN_REQUIRED_CODE, message: "Acesso administrativo temporário necessário." },
      401
    );
  await assert.rejects(
    fetchJsonOk("/api/admin/users/bootstrap-super-admin"),
    (e: unknown) =>
      e instanceof HttpError &&
      !(e instanceof AuthRequiredError) &&
      e.status === 401 &&
      e.code === BOOTSTRAP_ADMIN_REQUIRED_CODE
  );
  assert.equal(dispatched.length, 0);
});

test("fetchJsonOk lança HttpError com status em erro não-401", async () => {
  fetchImpl = async () => jsonResponse({ error: "BOOM", message: "Falhou" }, 500);
  await assert.rejects(
    fetchJsonOk("/api/x"),
    (e: unknown) => e instanceof HttpError && (e as HttpError).status === 500
  );
});

test("fetchOk usa credentials:include e trata 401", async () => {
  fetchImpl = async () => jsonResponse({ error: "UNAUTHORIZED" }, 401);
  await assert.rejects(fetchOk("/api/x", { method: "DELETE" }), AuthRequiredError);
  assert.equal(lastInit?.credentials, "include");
  assert.ok(dispatched.includes(APP_AUTH_REQUIRED_EVENT));
});
