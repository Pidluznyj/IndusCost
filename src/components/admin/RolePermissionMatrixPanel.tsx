import React from "react";
import { Check, Minus, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { formatRoleLabel, type AppUserRole } from "@/src/lib/appAuthClient";
import type { RoleMatrixRowDto } from "@/src/lib/userPermissionsAdminClient";
import { matrixStatusLabel } from "@/src/lib/userPermissionsAdminUi";

const ROLE_COLS: AppUserRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "COMMERCIAL_MANAGER",
  "SELLER",
  "VIEWER",
];

function StatusIcon({ status }: { status: "allowed" | "blocked" | "partial" }) {
  if (status === "allowed") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
        title={matrixStatusLabel(status)}
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500"
        title={matrixStatusLabel(status)}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 text-amber-700"
      title={matrixStatusLabel(status)}
    >
      <Minus className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}

export function RolePermissionMatrixPanel({
  matrix,
  loading,
}: {
  matrix: RoleMatrixRowDto[];
  loading?: boolean;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground py-8">Carregando matriz de perfis…</p>;
  }

  return (
    <div className="space-y-4" data-testid="role-permission-matrix">
      <div className="rounded-xl border border-border bg-card p-4">
        <h4 className="text-sm font-semibold text-foreground">Resumo por perfil</h4>
        <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
          Comparação dos presets oficiais. Ícones: permitido, parcial ou bloqueado. Permissionamento
          de tela não substitui filtro de dados por vendedor.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <StatusIcon status="allowed" /> Permitido
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusIcon status="partial" /> Parcial
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusIcon status="blocked" /> Bloqueado
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Menu / submenu / aba
              </th>
              {ROLE_COLS.map((role) => (
                <th
                  key={role}
                  className="px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {formatRoleLabel(role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.resourceKey} className="border-b border-border/50 hover:bg-accent/20">
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "block text-xs font-medium text-foreground",
                      row.type === "MENU" && "font-semibold"
                    )}
                    style={{ paddingLeft: row.depth * 14 }}
                  >
                    {row.label}
                    <span className="ml-1.5 text-[9px] font-normal text-muted-foreground">
                      {row.type === "MENU"
                        ? "Menu"
                        : row.type === "SUBMENU"
                          ? "Submenu"
                          : row.type === "TAB"
                            ? "Aba"
                            : row.type === "ACTION"
                              ? "Ação"
                              : row.type}
                    </span>
                  </span>
                </td>
                {ROLE_COLS.map((role) => {
                  const cell = row.cells.find((c) => c.role === role);
                  return (
                    <td key={role} className="px-2 py-2 text-center">
                      {cell ? <StatusIcon status={cell.status} /> : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
