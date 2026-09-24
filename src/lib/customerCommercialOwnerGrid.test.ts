import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  COMMERCIAL_OWNER_GRID_EMPTY_LABEL,
  commercialOwnerListDisplayName,
} from "@/src/lib/crmCustomerCommercialOwner.js";
import type { ResolvedCustomerCommercialOwner } from "@/src/lib/crmCustomerCommercialOwnerTypes.js";

function owner(partial: Partial<ResolvedCustomerCommercialOwner>): ResolvedCustomerCommercialOwner {
  return {
    source: "MANUAL",
    sellerCanonicalName: null,
    sellerResponsibleName: null,
    sellerExternalId: null,
    sellerIdentityKey: null,
    sellerAliasExternalIds: [],
    confidence: null,
    updatedAt: null,
    updatedByName: null,
    ...partial,
  };
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("responsável comercial na listagem de clientes", () => {
  it("nome de exibição oficial, sem e-mail, telefone ou id", () => {
    const label = commercialOwnerListDisplayName(
      owner({
        sellerCanonicalName: "Maria da Silva",
        sellerResponsibleName: "maria@empresa.com",
        sellerExternalId: 464,
        sellerAliasExternalIds: [464],
      })
    );
    assert.equal(label, "Maria da Silva");
    assert.doesNotMatch(label ?? "", /@|464|telefone/i);
  });

  it("cliente sem atribuição persistida não inventa nome", () => {
    assert.equal(commercialOwnerListDisplayName(null), null);
    assert.equal(commercialOwnerListDisplayName(owner({ source: "NONE" })), null);
    assert.equal(COMMERCIAL_OWNER_GRID_EMPTY_LABEL, "Sem responsável");
  });

  it("a grade usa o nome persistido e o atalho da aba existente", () => {
    const mod = read("src/components/CustomerModule.tsx");
    const table = /<table[\s\S]*?<\/table>/.exec(mod)?.[0] ?? "";
    const header = /<thead[\s\S]*?<\/thead>/.exec(table)?.[0] ?? "";
    assert.match(header, />Responsável Comercial</);
    assert.doesNotMatch(header, />Contato</);
    assert.match(table, /c\.commercialOwnerName \|\| COMMERCIAL_OWNER_EMPTY_LABEL/);
    assert.match(mod, /COMMERCIAL_OWNER_EMPTY_LABEL = "Sem responsável"/);
    assert.equal(COMMERCIAL_OWNER_GRID_EMPTY_LABEL, "Sem responsável");
    assert.doesNotMatch(table, /c\.email|c\.phone|<Mail|<Phone/);
    assert.match(mod, /type="email"/);
    assert.match(mod, /formData\.phone/);

    assert.match(table, /aria-label="Editar responsável comercial"/);
    assert.match(table, /title="Editar responsável comercial"/);
    assert.match(table, /event\.stopPropagation\(\)/);
    assert.match(table, /handleOpenModal\(c, \{ focus: "commercial-owner" \}\)/);
    assert.match(table, /\{allowAssignOwner \? \(/);
    assert.match(mod, /crm\.customers\.assign_seller/);
    assert.doesNotMatch(table, /<tr[^>]*onClick/);

    assert.match(mod, /focusSelect=\{ownerSelectFocus\}/);
    assert.match(mod, /commercialOwnerName: displayName/);
    assert.match(mod, /<CustomerCommercialOwnerTab/);
  });

  it("o select abre focado e o save reutiliza o PATCH existente", () => {
    const tab = read("src/components/customers/CustomerCommercialOwnerTab.tsx");
    assert.match(tab, /openOnMount=\{focusSelect && payload\.canEdit && !sellersLoading\}/);
    assert.match(tab, /\/api\/crm\/customers\/\$\{customerId\}\/commercial-owner/);
    assert.match(tab, /method: "PATCH"/);
    assert.match(tab, /onSaved\?\.\(ownerPayloadDisplayName\(updated\)\)/);
  });

  it("a listagem anexa o responsável em lote, sem inferir por pedido", () => {
    const service = read("src/lib/crmCustomerCommercialOwner.ts");
    const server = read("server.ts");
    const attach = /export async function attachCustomerCommercialOwnerListFields[\s\S]*?\n\}/.exec(
      service
    )?.[0];
    assert.ok(attach);
    assert.match(attach, /loadManualCommercialOwnersForCustomers/);
    assert.doesNotMatch(attach, /inferCommercialOwnerFromNomusOrders|findUnique/);
    assert.match(service, /customerId: \{ in: customerIds \}, isActive: true/);
    assert.match(server, /attachCustomerCommercialOwnerListFields\(withRisk\)/);
    assert.doesNotMatch(
      /app\.get\("\/api\/customers"[\s\S]*?app\.get\("\/api\/customers\/indicators"/.exec(server)?.[0] ??
        "",
      /inferCommercialOwnerFromNomusOrders/
    );
  });
});
