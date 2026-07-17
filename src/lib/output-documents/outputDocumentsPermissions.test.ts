/**
 * DS-04.4 — authorizeRequireResource + raw gate + escopo portfolio.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";
import { decideOutputDocumentRawAccess } from "@/src/lib/output-documents/outputDocumentsRawAccess.js";
import { portfolioKeysToDocumentWhere } from "@/src/lib/output-documents/outputDocumentsAccessScope.js";

function auth(partial: {
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  return {
    id: "user-od-perms",
    name: "Output Docs",
    email: "od@example.com",
    role: partial.role,
    permissions: partial.permissions ?? [],
    effectivePermissions: partial.permissions ?? [],
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-od",
  };
}

const RESOURCE_CASES = [
  {
    label: "list",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocuments,
    allowBag: ["output_documents.view"],
  },
  {
    label: "detail",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocumentsDetail,
    allowBag: ["output_documents.detail.view"],
  },
  {
    label: "financial",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocumentsFinancial,
    allowBag: ["output_documents.financial.view"],
  },
  {
    label: "audit",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocumentsAudit,
    allowBag: ["output_documents.audit.view"],
  },
  {
    label: "raw",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocumentsRaw,
    allowBag: ["output_documents.raw.view"],
  },
] as const;

describe("outputDocumentsPermissions — authorizeRequireResource", () => {
  for (const c of RESOURCE_CASES) {
    it(`${c.label}: bag allow (legacyCompat)`, () => {
      const decision = authorizeRequireResource(
        auth({ role: "ADMIN", permissions: [...c.allowBag] }),
        c.resourceKey,
        "view",
        { legacyCompatMode: true }
      );
      assert.equal(decision.ok, true);
    });

    it(`${c.label}: deny without permission`, () => {
      const decision = authorizeRequireResource(
        auth({ role: "USER", permissions: ["dashboard.view"] }),
        c.resourceKey,
        "view",
        { legacyCompatMode: true }
      );
      assert.equal(decision.ok, false);
      if (!decision.ok) {
        assert.equal(decision.status, 403);
        assert.equal(decision.body.error, "FORBIDDEN");
      }
    });

    it(`${c.label}: SUPER_ADMIN bypass`, () => {
      const decision = authorizeRequireResource(
        auth({ role: "SUPER_ADMIN", permissions: [] }),
        c.resourceKey,
        "view"
      );
      assert.equal(decision.ok, true);
    });
  }

  it("fake resource key → UNKNOWN_RESOURCE", () => {
    const decision = authorizeRequireResource(
      auth({ role: "ADMIN", permissions: ["output_documents.view"] }),
      "commercial.output_documents.fake",
      "view"
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 403);
      assert.equal(decision.body.code, "UNKNOWN_RESOURCE");
    }
  });
});

describe("decideOutputDocumentRawAccess", () => {
  const user = auth({ role: "ADMIN", permissions: ["output_documents.raw.view"] });

  it("includeRaw false → not requested", () => {
    const decision = decideOutputDocumentRawAccess({ user, includeRaw: false });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.body.code, "OUTPUT_DOCUMENTS_RAW_NOT_REQUESTED");
    }
  });

  it("includeRaw true sem permissão → forbidden", () => {
    const denied = decideOutputDocumentRawAccess({
      user: auth({ role: "ADMIN", permissions: [] }),
      includeRaw: true,
    });
    assert.equal(denied.allowed, false);
    if (!denied.allowed) {
      assert.equal(denied.body.code, "OUTPUT_DOCUMENTS_RAW_FORBIDDEN");
    }
  });

  it("includeRaw true com permissão → allowed", () => {
    const ok = decideOutputDocumentRawAccess({ user, includeRaw: true });
    assert.equal(ok.allowed, true);
  });

  it("audit.raw.read também autoriza raw", () => {
    const ok = decideOutputDocumentRawAccess({
      user: auth({ role: "ADMIN", permissions: ["audit.raw.read"] }),
      includeRaw: true,
    });
    assert.equal(ok.allowed, true);
  });
});

describe("portfolioKeysToDocumentWhere", () => {
  it("sem ids → id in []", () => {
    assert.deepEqual(portfolioKeysToDocumentWhere({ nfeIds: [], externalIds: [] }), {
      id: { in: [] },
    });
  });

  it("com ids monta OR de externalId e idNfe", () => {
    const where = portfolioKeysToDocumentWhere({
      nfeIds: [7208],
      externalIds: [8451, 8452],
    });
    assert.ok(Array.isArray(where.OR));
    assert.equal(where.OR!.length, 2);
    assert.deepEqual(where.OR![0], { externalId: { in: [8451, 8452] } });
    assert.deepEqual(where.OR![1], { idNfe: { in: [7208] } });
  });
});
