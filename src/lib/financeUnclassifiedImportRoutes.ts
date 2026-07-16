import type express from "express";
import type { RequestHandler } from "express";
import multer from "multer";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  applyUnclassifiedImportDefault,
  buildUnclassifiedExportGroupsDefault,
  buildUnclassifiedExportRows,
  buildUnclassifiedExportWorkbook,
  buildUnclassifiedImportPreviewDefault,
  FINANCE_UNCLASSIFIED_EXPORT_FILENAME,
  FinanceUnclassifiedImportError,
  parseUnclassifiedImportWorkbook,
  unclassifiedExportWorkbookToBytes,
} from "@/src/lib/financeUnclassifiedImport.js";
import {
  FINANCE_AP_ACTIONS,
  FINANCE_AP_RESOURCE_KEY,
} from "@/src/lib/financeAccountsPayableAccess.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

const upload = multer({ storage: multer.memoryStorage() });

function handleImportError(res: express.Response, error: FinanceUnclassifiedImportError) {
  const status = error.code === "INVALID_CONFIRMATION" ? 400 : 422;
  return res.status(status).json({ error: error.message, code: error.code });
}

export function registerFinanceUnclassifiedImportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireResource(FINANCE_AP_RESOURCE_KEY, FINANCE_AP_ACTIONS.view),
  ] as const;
  const manageGuard = [
    requireAppAuth,
    requireResource(FINANCE_AP_RESOURCE_KEY, FINANCE_AP_ACTIONS.manage),
  ] as const;
  const applyGuard = [
    requireAppAuth,
    requireResource(FINANCE_AP_RESOURCE_KEY, FINANCE_AP_ACTIONS.manage),
  ] as const;

  app.get("/api/finance/cost-centers/unclassified/export", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const groups = await buildUnclassifiedExportGroupsDefault();
      const rows = buildUnclassifiedExportRows(groups);
      const workbook = buildUnclassifiedExportWorkbook(rows);
      const bytes = unclassifiedExportWorkbookToBytes(workbook);

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${FINANCE_UNCLASSIFIED_EXPORT_FILENAME}"`
      );
      return res.send(Buffer.from(bytes));
    } catch (error) {
      console.error("GET /api/finance/cost-centers/unclassified/export", error);
      return res.status(500).json(
        financeApiErrorJson("Erro ao exportar títulos sem classificação.", error)
      );
    }
  });

  app.post(
    "/api/finance/cost-centers/unclassified/import/preview",
    ...manageGuard,
    upload.single("file"),
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });
        if (!req.file) return res.status(400).json({ error: "Arquivo não enviado." });

        const { rows } = parseUnclassifiedImportWorkbook(req.file.buffer);
        const preview = await buildUnclassifiedImportPreviewDefault(rows);
        return res.json(preview);
      } catch (error) {
        if (error instanceof FinanceUnclassifiedImportError) {
          return handleImportError(res, error);
        }
        console.error("POST /api/finance/cost-centers/unclassified/import/preview", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao gerar preview da importação.", error)
        );
      }
    }
  );

  app.post(
    "/api/finance/cost-centers/unclassified/import/apply",
    ...applyGuard,
    upload.single("file"),
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });
        if (!req.file) return res.status(400).json({ error: "Arquivo não enviado." });

        const confirmationText =
          typeof req.body?.confirmationText === "string" ? req.body.confirmationText : "";
        const confirmSensitive =
          req.body?.confirmSensitive === "true" || req.body?.confirmSensitive === true;

        const { rows } = parseUnclassifiedImportWorkbook(req.file.buffer);
        const result = await applyUnclassifiedImportDefault(
          rows,
          { confirmationText, confirmSensitive },
          { userId: user.id, userName: user.name ?? user.email ?? null }
        );
        return res.json(result);
      } catch (error) {
        if (error instanceof FinanceUnclassifiedImportError) {
          return handleImportError(res, error);
        }
        console.error("POST /api/finance/cost-centers/unclassified/import/apply", error);
        return res.status(500).json(
          financeApiErrorJson("Erro ao aplicar a importação.", error)
        );
      }
    }
  );
}
