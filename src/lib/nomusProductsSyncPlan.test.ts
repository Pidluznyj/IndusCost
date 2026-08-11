import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProductMatchIndex,
  extractInactiveLifecycleRows,
  hashNomusProductPayload,
  planProductSyncMutation,
  type ExistingProductSnapshot,
  type ProductLifecycleRow,
} from "./nomusProductsSyncPlan";

function snapshot(overrides: Partial<ExistingProductSnapshot> = {}): ExistingProductSnapshot {
  return {
    id: "prod-1",
    sku: "520.22--",
    name: "Fita SF 48mm",
    description: "Fita SF 48mm",
    type: "COMPONENT",
    status: "ACTIVE",
    ncm: null,
    sourceSystem: null,
    sourceExternalId: null,
    isNomusControlled: false,
    ...overrides,
  };
}

function row(overrides: Partial<ProductLifecycleRow> = {}): ProductLifecycleRow {
  return {
    externalId: 52022001,
    sku: "520.22--",
    chosenName: "Fita SF 48mm",
    nameLooksLikeSku: false,
    description: "Fita SF 48mm",
    ncm: null,
    type: "COMPONENT",
    typeInferenceConfidence: "HIGH",
    ativo: true,
    raw: { id: 52022001, codigo: "520.22--", ativo: true },
    ...overrides,
  };
}

describe("planProductSyncMutation — ciclo de vida e identidade", () => {
  it("P01: produto novo ACTIVE → CREATE com identidade Nomus persistida", () => {
    const index = buildProductMatchIndex([]);
    const m = planProductSyncMutation(row(), index);
    assert.equal(m.kind, "CREATE");
    if (m.kind !== "CREATE") return;
    assert.equal(m.sku, "520.22--");
    assert.equal(m.sourceExternalId, "52022001");
    assert.equal(m.nomusPayloadHash, hashNomusProductPayload(row().raw));
  });

  it("P02: nome alterado no Nomus → UPDATE com name", () => {
    const index = buildProductMatchIndex([snapshot({ name: "Nome antigo" })]);
    const m = planProductSyncMutation(row(), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.equal(m.data.name, "Fita SF 48mm");
    assert.ok(m.changedFields.includes("name"));
  });

  it("P02b: nome Nomus SKU-like → preserva nome existente", () => {
    const index = buildProductMatchIndex([snapshot({ name: "Nome descritivo local" })]);
    const m = planProductSyncMutation(
      row({ chosenName: "520.22--", nameLooksLikeSku: true }),
      index
    );
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.equal(m.data.name, undefined);
  });

  it("P03: descrição alterada → UPDATE com description e campo listado", () => {
    const index = buildProductMatchIndex([snapshot({ description: "Descrição velha" })]);
    const m = planProductSyncMutation(row({ description: "Descrição nova" }), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.equal(m.data.description, "Descrição nova");
    assert.ok(m.changedFields.includes("description"));
  });

  it("P03b: NCM do payload → CREATE persiste ncm como texto", () => {
    const index = buildProductMatchIndex([]);
    const m = planProductSyncMutation(row({ ncm: "39269090" }), index);
    assert.equal(m.kind, "CREATE");
    if (m.kind !== "CREATE") return;
    assert.equal(m.ncm, "39269090");
  });

  it("P03c: zero à esquerda preservado — NCM nunca vira número", () => {
    const index = buildProductMatchIndex([snapshot()]);
    const m = planProductSyncMutation(row({ ncm: "01234567" }), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.strictEqual(m.data.ncm, "01234567");
    assert.ok(m.changedFields.includes("ncm"));
  });

  it("P03d: SOMENTE o NCM mudou (resto idêntico) → UPDATE lista 'ncm' — nunca tratado como unchanged", () => {
    // Sync 1 gravou 39269090; sync 2 traz o mesmo produto com 39269099.
    const index = buildProductMatchIndex([
      snapshot({ ncm: "39269090", sourceExternalId: "52022001" }),
    ]);
    const m = planProductSyncMutation(row({ ncm: "39269099" }), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.equal(m.data.ncm, "39269099");
    assert.deepEqual(m.changedFields, ["ncm"]);
  });

  it("P03e: payload sem NCM → null sobrescreve (política igual à do description; Nomus é a fonte)", () => {
    const index = buildProductMatchIndex([snapshot({ ncm: "39269090" })]);
    const m = planProductSyncMutation(row({ ncm: null }), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.strictEqual(m.data.ncm, null);
    assert.ok(m.changedFields.includes("ncm"));
  });

  it("P03f: NCM igual nos dois lados → não entra em changedFields", () => {
    const index = buildProductMatchIndex([snapshot({ ncm: "39269090" })]);
    const m = planProductSyncMutation(row({ ncm: "39269090" }), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.ok(!m.changedFields.includes("ncm"));
  });

  it("P04: type divergente com confiança HIGH → reportado, NÃO aplicado (reclassificação é workflow próprio)", () => {
    const index = buildProductMatchIndex([snapshot({ type: "PRODUCT" })]);
    const m = planProductSyncMutation(row({ type: "COMPONENT" }), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.deepEqual(m.typeMismatch, { current: "PRODUCT", inferred: "COMPONENT" });
    assert.ok(!("type" in m.data));
  });

  it("P04b: type divergente com confiança LOW → nem reporta mismatch", () => {
    const index = buildProductMatchIndex([snapshot({ type: "PRODUCT" })]);
    const m = planProductSyncMutation(
      row({ type: "COMPONENT", typeInferenceConfidence: "LOW" }),
      index
    );
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.equal(m.typeMismatch, null);
  });

  it("P05: ACTIVE → INACTIVE quando payload traz ativo=false explícito", () => {
    const index = buildProductMatchIndex([
      snapshot({ sourceExternalId: "52022001", status: "ACTIVE" }),
    ]);
    const m = planProductSyncMutation(row({ ativo: false }), index);
    assert.equal(m.kind, "DEACTIVATE");
    if (m.kind !== "DEACTIVATE") return;
    assert.equal(m.data.status, "INACTIVE");
    assert.equal(m.data.sourceExternalId, "52022001");
  });

  it("P05b: inativação também funciona no fallback legado por SKU (sem vínculo prévio)", () => {
    const index = buildProductMatchIndex([snapshot({ sourceExternalId: null })]);
    const m = planProductSyncMutation(row({ ativo: false }), index);
    assert.equal(m.kind, "DEACTIVATE");
  });

  it("P05c: já INACTIVE → idempotente, sem nova mutação", () => {
    const index = buildProductMatchIndex([snapshot({ status: "INACTIVE" })]);
    const m = planProductSyncMutation(row({ ativo: false }), index);
    assert.equal(m.kind, "SKIP_ALREADY_INACTIVE");
  });

  it("P06: INACTIVE → ACTIVE quando produto volta a ficar ativo no Nomus", () => {
    const index = buildProductMatchIndex([
      snapshot({ status: "INACTIVE", sourceExternalId: "52022001" }),
    ]);
    const m = planProductSyncMutation(row({ ativo: true }), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.equal(m.data.status, "ACTIVE");
    assert.ok(m.changedFields.includes("status"));
  });

  it("P07: SKU mudou no Nomus mantendo o mesmo id → atualiza SKU do mesmo Product, não duplica", () => {
    const index = buildProductMatchIndex([
      snapshot({ sku: "ABC-1", sourceExternalId: "52022001" }),
    ]);
    const m = planProductSyncMutation(row({ sku: "XYZ-9" }), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.equal(m.data.sku, "XYZ-9");
    assert.ok(m.changedFields.includes("sku"));
  });

  it("P07b: novo SKU Nomus já pertence a OUTRO Product → ambiguidade, zero escrita", () => {
    const index = buildProductMatchIndex([
      snapshot({ id: "prod-1", sku: "ABC-1", sourceExternalId: "52022001" }),
      snapshot({ id: "prod-2", sku: "XYZ-9", sourceExternalId: null }),
    ]);
    const m = planProductSyncMutation(row({ sku: "XYZ-9" }), index);
    assert.equal(m.kind, "SKIP_AMBIGUOUS_IDENTITY");
    if (m.kind !== "SKIP_AMBIGUOUS_IDENTITY") return;
    assert.equal(m.conflictProductId, "prod-2");
  });

  it("P08: SKU coincide mas produto já vinculado a OUTRO id Nomus → ambiguidade, zero escrita", () => {
    const index = buildProductMatchIndex([snapshot({ sourceExternalId: "999999" })]);
    const m = planProductSyncMutation(row(), index);
    assert.equal(m.kind, "SKIP_AMBIGUOUS_IDENTITY");
  });

  it("P09: match legado por SKU persiste sourceExternalId no update", () => {
    const index = buildProductMatchIndex([snapshot({ sourceExternalId: null })]);
    const m = planProductSyncMutation(row(), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.equal(m.data.sourceExternalId, "52022001");
    assert.ok(m.changedFields.includes("sourceExternalId"));
  });

  it("P10/P11: identidade preferida é sourceExternalId mesmo com SKU divergente", () => {
    const index = buildProductMatchIndex([
      snapshot({ id: "linked", sku: "OLD-SKU", sourceExternalId: "52022001" }),
      snapshot({ id: "other", sku: "520.22--", sourceExternalId: "111" }),
    ]);
    // O id oficial aponta para "linked"; o SKU da linha apontaria para "other".
    const m = planProductSyncMutation(row(), index);
    assert.equal(m.kind, "SKIP_AMBIGUOUS_IDENTITY");
    // Novo SKU já pertence a outro produto ("other") → bloqueia em vez de remapear.
  });

  it("P13: segundo sync sem mudanças → UPDATE com changedFields vazio (estado final idêntico)", () => {
    const index = buildProductMatchIndex([
      snapshot({ sourceExternalId: "52022001", status: "ACTIVE" }),
    ]);
    const m = planProductSyncMutation(row(), index);
    assert.equal(m.kind, "UPDATE");
    if (m.kind !== "UPDATE") return;
    assert.deepEqual(m.changedFields, []);
  });

  it("P14/P15: produto ausente da resposta Nomus não gera mutação nenhuma (ausência ≠ inativo)", () => {
    // O planejador só é chamado para linhas PRESENTES; este teste documenta que
    // linha inativa sem produto correspondente também não cria nada.
    const index = buildProductMatchIndex([]);
    const m = planProductSyncMutation(row({ ativo: false }), index);
    assert.equal(m.kind, "SKIP_NOT_FOUND_INACTIVE");
  });
});

describe("extractInactiveLifecycleRows — só inativação explícita", () => {
  it("extrai apenas bloqueios com ativo=false + INACTIVE_PRODUCT_NOMUS", () => {
    const rawMap = new Map<string, Record<string, unknown>>([
      ["520.22--", { id: 52022001, codigo: "520.22--", ativo: false }],
    ]);
    const rows = extractInactiveLifecycleRows(
      [
        { externalId: 52022001, sku: "520.22--", reasons: ["INACTIVE_PRODUCT_NOMUS"], ativo: false },
        { externalId: 2, sku: "SERV-1", reasons: ["SERVICE_ITEM"], ativo: true },
        { externalId: null, sku: "SEM-ID", reasons: ["INACTIVE_PRODUCT_NOMUS"], ativo: false },
        { externalId: 3, sku: null, reasons: ["INACTIVE_PRODUCT_NOMUS"], ativo: false },
      ],
      rawMap
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sku, "520.22--");
    assert.equal(rows[0].ativo, false);
  });

  it("bloqueio inativo com motivos adicionais (ex.: SERVICE_ITEM) ainda inativa", () => {
    const rows = extractInactiveLifecycleRows(
      [
        {
          externalId: 9,
          sku: "SRV-INAT",
          reasons: ["SERVICE_ITEM", "INACTIVE_PRODUCT_NOMUS"],
          ativo: false,
        },
      ],
      new Map()
    );
    assert.equal(rows.length, 1);
  });
});
