/**
 * PERM-32 — allow / 403 / SUPER_ADMIN para recursos críticos migrados a requireResource.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import { authorizeRequireResource } from "./requireResource.ts";

function auth(partial: {
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  return {
    id: "user-perm32",
    name: "PERM-32",
    email: "perm32@example.com",
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
    sessionId: "sess-perm32",
  };
}

const CASES: Array<{
  label: string;
  resourceKey: string;
  action: string;
  allowBag: string[];
}> = [
  {
    label: "dashboard view",
    resourceKey: "dashboard",
    action: "view",
    allowBag: ["dashboard.view"],
  },
  {
    label: "CRM customer 360",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.crmCustomer360,
    action: "view",
    allowBag: ["customers.view"],
  },
  {
    label: "CRM parent",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.crm,
    action: "view",
    allowBag: ["crm.view"],
  },
  {
    label: "CRM assign seller",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.crmAssignSeller,
    action: "manage",
    allowBag: ["crm.customers.assign_seller"],
  },
  {
    label: "sales orders view",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrders,
    action: "view",
    allowBag: ["sales_orders.view"],
  },
  {
    label: "sales order detail",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersDetail,
    action: "view",
    allowBag: ["sales_orders.detail.view"],
  },
  {
    label: "output documents list",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocuments,
    action: "view",
    allowBag: ["output_documents.view"],
  },
  {
    label: "output documents detail",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocumentsDetail,
    action: "view",
    allowBag: ["output_documents.detail.view"],
  },
  {
    label: "output documents financial",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocumentsFinancial,
    action: "view",
    allowBag: ["output_documents.financial.view"],
  },
  {
    label: "output documents audit",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocumentsAudit,
    action: "view",
    allowBag: ["output_documents.audit.view"],
  },
  {
    label: "output documents raw",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.outputDocumentsRaw,
    action: "view",
    allowBag: ["output_documents.raw.view"],
  },
  {
    label: "engineering BOM tab",
    resourceKey: "engineering.products.tab.bom",
    action: "view",
    allowBag: ["products.tab.bom"],
  },
  {
    label: "engineering tree tab",
    resourceKey: "engineering.products.tab.tree",
    action: "view",
    allowBag: ["products.tab.tree"],
  },
  {
    label: "supplier service termination view",
    resourceKey: FINANCE_MODULE_RESOURCE_KEYS.suppliersServiceTermination,
    action: "view",
    allowBag: ["finance.suppliers.service_termination.view"],
  },
  {
    label: "supplier service termination create",
    resourceKey: FINANCE_MODULE_RESOURCE_KEYS.suppliersServiceTermination,
    action: "create",
    allowBag: ["finance.suppliers.service_termination.create"],
  },
  {
    label: "supplier service termination finalize",
    resourceKey: FINANCE_MODULE_RESOURCE_KEYS.suppliersServiceTermination,
    action: "execute",
    allowBag: ["finance.suppliers.service_termination.finalize"],
  },
];

describe("PERM-32 requireResource APIs — allow / 403 / SUPER_ADMIN", () => {
  for (const c of CASES) {
    it(`${c.label}: bag allow + legacyCompat`, () => {
      const decision = authorizeRequireResource(
        auth({ role: "ADMIN", permissions: c.allowBag }),
        c.resourceKey,
        c.action,
        { legacyCompatMode: true }
      );
      assert.equal(decision.ok, true, `${c.label} should allow`);
    });

    it(`${c.label}: deny override → 403`, () => {
      const decision = authorizeRequireResource(
        auth({ role: "ADMIN", permissions: c.allowBag }),
        c.resourceKey,
        c.action,
        {
          legacyCompatMode: true,
          overrides: [
            {
              resourceKey: c.resourceKey,
              canView: false,
              canCreate: false,
              canUpdate: false,
              canDelete: false,
              canExport: false,
              canExecute: false,
              canManage: false,
            },
          ],
        }
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
        c.action
      );
      assert.equal(decision.ok, true);
    });
  }
});
