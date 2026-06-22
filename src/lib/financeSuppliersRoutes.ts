import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  applyFinancialSuppliersFromAccountsPayableDefault,
  assertFinanceSupplierRebuildConfirmation,
  buildFinancialSuppliersFromAccountsPayablePreviewDefault,
  FinanceSupplierRebuildError,
} from "@/src/lib/financeSupplierRebuild.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export const FINANCE_SUPPLIERS_PREVIEW_PERMISSIONS = ["finance.suppliers.view", "finance.view"] as const;

export const FINANCE_SUPPLIERS_APPLY_PERMISSIONS = ["finance.suppliers.manage"] as const;

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
}
