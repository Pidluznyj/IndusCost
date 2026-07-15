/**
 * Exemplos de uso da PermissionMatrix (Prompt 08).
 * Não montado nas telas finais — referência para integração futura.
 *
 * Dados: GET /api/admin/users/:id/permissions (structured admin API)
 * Save futuro: PUT /api/admin/users/:id/permission-overrides
 */

import React, { useMemo, useState } from "react";
import { PermissionMatrix } from "@/src/components/admin/PermissionMatrix";
import {
  buildPermissionMatrixRowsFromAdminTree,
  draftFromAdminTree,
  legacyFlagsFromMatrixDraftValues,
  type PermissionMatrixDraft,
} from "@/src/lib/security/permissionMatrixUi/index.ts";
import type { EditableTreeNodeDto } from "@/src/lib/userPermissionsAdminClient";
import { overridesPayloadFromDraft } from "@/src/lib/userPermissionsAdminUi";

/** Exemplo controlado com árvore já carregada da API admin. */
export function PermissionMatrixUserExample({
  tree,
  readOnly,
}: {
  tree: EditableTreeNodeDto[];
  readOnly?: boolean;
}) {
  const rows = useMemo(
    () => buildPermissionMatrixRowsFromAdminTree(tree),
    [tree]
  );
  const baseline = useMemo(() => draftFromAdminTree(tree), [tree]);
  const [draft, setDraft] = useState<PermissionMatrixDraft>(baseline);

  return (
    <PermissionMatrix
      rows={rows}
      draft={draft}
      baseline={baseline}
      onDraftChange={setDraft}
      readOnly={readOnly}
    />
  );
}

/**
 * Como converter draft da matriz → payload de overrides (quando a tela final integrar).
 * Não chama API aqui.
 */
export function buildOverridesFromMatrixDraftExample(
  draft: PermissionMatrixDraft,
  roleDefaults: Array<{
    resourceKey: string;
    flags: { canView: boolean; canExecute: boolean; canManage: boolean };
  }>
) {
  const flagDraft: Record<
    string,
    { canView: boolean; canExecute: boolean; canManage: boolean }
  > = {};
  for (const [key, values] of Object.entries(draft)) {
    flagDraft[key] = legacyFlagsFromMatrixDraftValues(values);
  }
  return overridesPayloadFromDraft(flagDraft, roleDefaults);
}

/** Exemplo de estados loading / erro (story-like). */
export function PermissionMatrixStatesExample({
  mode,
}: {
  mode: "loading" | "error" | "empty";
}) {
  if (mode === "loading") {
    return (
      <PermissionMatrix
        rows={[]}
        draft={{}}
        baseline={{}}
        onDraftChange={() => undefined}
        loading
      />
    );
  }
  if (mode === "error") {
    return (
      <PermissionMatrix
        rows={[]}
        draft={{}}
        baseline={{}}
        onDraftChange={() => undefined}
        error="API admin de permissões indisponível (ex.: 500)."
      />
    );
  }
  return (
    <PermissionMatrix
      rows={[]}
      draft={{}}
      baseline={{}}
      onDraftChange={() => undefined}
      emptyMessage="Perfil sem recursos mapeados."
    />
  );
}
