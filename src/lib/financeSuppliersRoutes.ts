import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  applyFinancialSuppliersFromAccountsPayableDefault,
  assertFinanceSupplierRebuildConfirmation,
  buildFinancialSuppliersFromAccountsPayablePreviewDefault,
  FinanceSupplierRebuildError,
} from "@/src/lib/financeSupplierRebuild.js";
import {
  ensureFinancialSupplierFromApIdentityDefault,
  FinanceSupplierEngineError,
  searchOfficialFinancialSuppliersDefault,
} from "@/src/lib/financeSupplierEngine.js";
import {
  applyCompanyIntelligenceToSupplierDefault,
  assertSuperAdminCanDeleteSupplier,
  buildFinanceSupplierCompanyIntelligencePayloadDefault,
  deactivateFinancialSupplierDefault,
  FinanceSupplierProfileError,
  getFinancialSupplierProfileDefault,
  updateFinancialSupplierProfileDefault,
} from "@/src/lib/financeSupplierProfile.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export const FINANCE_SUPPLIERS_PREVIEW_PERMISSIONS = ["finance.suppliers.view", "finance.view"] as const;

export const FINANCE_SUPPLIERS_APPLY_PERMISSIONS = ["finance.suppliers.manage"] as const;

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function handleSupplierProfileError(res: express.Response, error: unknown) {
  if (error instanceof FinanceSupplierProfileError) {
    return res.status(error.httpStatus).json({ error: error.message, code: error.code });
  }
  if (error instanceof FinanceSupplierEngineError) {
    return res.status(error.httpStatus).json({ error: error.message, code: error.code });
  }
  console.error("finance supplier profile", error);
  return res.status(500).json(financeApiErrorJson("Erro ao processar cadastro de fornecedor.", error));
}

export function registerFinanceSuppliersRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const previewGuard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_SUPPLIERS_PREVIEW_PERMISSIONS]),
  ] as const;
  const applyGuard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_SUPPLIERS_APPLY_PERMISSIONS]),
  ] as const;

  app.get("/api/finance/suppliers/search", ...previewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const search = typeof req.query.search === "string" ? req.query.search : "";
      const limitRaw =
        typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
      const payload = await searchOfficialFinancialSuppliersDefault({ search, limit: limitRaw });
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/suppliers/search", error);
      return res.status(500).json(financeApiErrorJson("Erro ao buscar fornecedores.", error));
    }
  });

  app.post("/api/finance/suppliers/ensure-from-ap-identity", ...applyGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const body = req.body ?? {};
      const identityKey =
        typeof body.identityKey === "string" ? body.identityKey.trim() : undefined;
      const personName =
        typeof body.personName === "string" ? body.personName.trim() : undefined;
      const personDocument =
        body.personDocument === null || typeof body.personDocument === "string"
          ? body.personDocument
          : undefined;
      const accountsPayableId =
        typeof body.accountsPayableId === "number"
          ? body.accountsPayableId
          : typeof body.accountsPayableId === "string"
            ? Number.parseInt(body.accountsPayableId, 10)
            : undefined;

      if (!identityKey && !personName && accountsPayableId == null) {
        return res.status(400).json({
          error: "Informe identityKey, personName ou accountsPayableId.",
          code: "MISSING_IDENTITY",
        });
      }

      const result = await ensureFinancialSupplierFromApIdentityDefault(
        {
          identityKey,
          personName,
          personDocument,
          accountsPayableId: Number.isFinite(accountsPayableId)
            ? accountsPayableId
            : undefined,
        },
        {
          userId: user.id ?? user.email ?? null,
          userName: user.name ?? user.email ?? null,
        }
      );
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return handleSupplierProfileError(res, error);
    }
  });

  app.get("/api/finance/suppliers/rebuild-from-ap-preview", ...previewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const preview = await buildFinancialSuppliersFromAccountsPayablePreviewDefault();
      return res.json(preview);
    } catch (error) {
      console.error("GET /api/finance/suppliers/rebuild-from-ap-preview", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao gerar preview de fornecedores a partir de AP.", error)
      );
    }
  });

  app.post("/api/finance/suppliers/rebuild-from-ap-apply", ...applyGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const confirmationText =
        typeof req.body?.confirmationText === "string"
          ? req.body.confirmationText
          : typeof req.body?.confirmation === "string"
            ? req.body.confirmation
            : "";

      const result = await applyFinancialSuppliersFromAccountsPayableDefault({
        confirmationText,
        userId: user.id,
        userName: user.name ?? user.email ?? null,
      });

      return res.json(result);
    } catch (error) {
      if (error instanceof FinanceSupplierRebuildError && error.code === "INVALID_CONFIRMATION") {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      console.error("POST /api/finance/suppliers/rebuild-from-ap-apply", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao aplicar rebuild de fornecedores a partir de AP.", error)
      );
    }
  });

  app.get("/api/finance/suppliers/:id", ...previewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });

      const profile = await getFinancialSupplierProfileDefault(id);
      return res.json(profile);
    } catch (error) {
      return handleSupplierProfileError(res, error);
    }
  });

  app.patch("/api/finance/suppliers/:id", ...applyGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });

      const body = req.body ?? {};
      const profile = await updateFinancialSupplierProfileDefault(
        id,
        {
          displayName: typeof body.displayName === "string" ? body.displayName : undefined,
          legalName: body.legalName === null || typeof body.legalName === "string" ? body.legalName : undefined,
          tradeName: body.tradeName === null || typeof body.tradeName === "string" ? body.tradeName : undefined,
          document: body.document === null || typeof body.document === "string" ? body.document : undefined,
        },
        user
      );
      return res.json(profile);
    } catch (error) {
      return handleSupplierProfileError(res, error);
    }
  });

  app.get("/api/finance/suppliers/:id/company-intelligence", ...previewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });

      const cnpjOverride =
        typeof req.query.cnpj === "string" ? req.query.cnpj : undefined;
      const forceRefresh = req.query.refresh === "true";

      const payload = await buildFinanceSupplierCompanyIntelligencePayloadDefault({
        supplierId: id,
        cnpjOverride,
        forceRefresh,
        userId: user.id ?? user.email ?? null,
      });
      return res.json(payload);
    } catch (error) {
      return handleSupplierProfileError(res, error);
    }
  });

  app.post("/api/finance/suppliers/:id/company-intelligence/refresh", ...applyGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });

      const cnpjOverride =
        typeof req.body?.cnpj === "string" ? req.body.cnpj : undefined;

      const payload = await buildFinanceSupplierCompanyIntelligencePayloadDefault({
        supplierId: id,
        cnpjOverride,
        forceRefresh: true,
        userId: user.id ?? user.email ?? null,
      });
      return res.json(payload);
    } catch (error) {
      return handleSupplierProfileError(res, error);
    }
  });

  app.post("/api/finance/suppliers/:id/apply-company-intelligence", ...applyGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });

      const lookupId = req.body?.lookupId;
      const selectedFields = Array.isArray(req.body?.selectedFields)
        ? req.body.selectedFields.map(String)
        : [];
      if (!isUuid(lookupId)) {
        return res.status(400).json({ error: "lookupId inválido." });
      }

      const result = await applyCompanyIntelligenceToSupplierDefault({
        supplierId: id,
        lookupId,
        selectedFields,
        userId: user.id ?? user.email ?? null,
        userName: user.name ?? user.email ?? null,
      });
      return res.json(result);
    } catch (error) {
      return handleSupplierProfileError(res, error);
    }
  });

  app.delete("/api/finance/suppliers/:id", requireAppAuth, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      assertSuperAdminCanDeleteSupplier(user.role);

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });

      const result = await deactivateFinancialSupplierDefault({
        supplierId: id,
        userId: user.id ?? user.email ?? null,
        userName: user.name ?? user.email ?? null,
      });
      return res.json(result);
    } catch (error) {
      return handleSupplierProfileError(res, error);
    }
  });
}
