import React from "react";
import { ShieldOff } from "lucide-react";
import {
  NO_ACCESS_PAGE_DESCRIPTION,
  NO_ACCESS_PAGE_TITLE,
} from "@/src/lib/unauthorizedAccess";

/**
 * Página neutra quando não há nenhuma rota permitida.
 * Sem Navigate — evita loop de redirecionamento (PERM-39).
 */
export const NoPermissionsGranted: React.FC = () => (
  <div
    className="min-h-[50vh] flex items-center justify-center p-6"
    data-testid="no-permissions-granted"
  >
    <div className="rounded-2xl border border-border bg-muted/40 p-8 max-w-xl mx-auto text-center space-y-4">
      <div className="mx-auto h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
        <ShieldOff className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-foreground">{NO_ACCESS_PAGE_TITLE}</h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          {NO_ACCESS_PAGE_DESCRIPTION}
        </p>
      </div>
    </div>
  </div>
);
