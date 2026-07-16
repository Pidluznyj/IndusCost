/**
 * Exemplos / harness visual da PermissionsTree (PERM-33).
 * Não montado nas telas finais — referência para integração futura.
 */

import React, { useMemo, useState } from "react";
import {
  PermissionsTree,
  type PermissionsTreeViewport,
} from "@/src/components/admin/PermissionsTree";
import {
  buildPermissionsTreeFixture,
  buildPermissionsTreeFixtureDecisions,
  type PermissionTreeDecisions,
} from "@/src/lib/security/permissionsTreeUi/index.ts";

/** Demo controlada com fixture local (story-like). */
export function PermissionsTreeFixtureExample({
  viewportPreset = "fluid",
  readOnly,
}: {
  viewportPreset?: PermissionsTreeViewport;
  readOnly?: boolean;
}) {
  const nodes = useMemo(() => buildPermissionsTreeFixture(), []);
  const [decisions, setDecisions] = useState<PermissionTreeDecisions>(() =>
    buildPermissionsTreeFixtureDecisions()
  );

  return (
    <PermissionsTree
      nodes={nodes}
      decisions={decisions}
      onDecisionsChange={setDecisions}
      readOnly={readOnly}
      viewportPreset={viewportPreset}
    />
  );
}

/** Estados loading / erro / vazio. */
export function PermissionsTreeStatesExample({
  mode,
}: {
  mode: "loading" | "error" | "empty";
}) {
  if (mode === "loading") {
    return (
      <PermissionsTree
        nodes={[]}
        decisions={{}}
        onDecisionsChange={() => undefined}
        loading
      />
    );
  }
  if (mode === "error") {
    return (
      <PermissionsTree
        nodes={[]}
        decisions={{}}
        onDecisionsChange={() => undefined}
        error="Falha ao carregar árvore de permissões (ex.: 500)."
      />
    );
  }
  return (
    <PermissionsTree
      nodes={[]}
      decisions={{}}
      onDecisionsChange={() => undefined}
      emptyMessage="Perfil sem recursos mapeados."
    />
  );
}

/**
 * Painel de validação visual 1366×768 e 1920×1080.
 * Uso local: montar em harness de preview (não liga App de produção).
 */
export function PermissionsTreeViewportGallery() {
  return (
    <div
      data-testid="permissions-tree-viewport-gallery"
      className="space-y-8 bg-[#eef2f7] p-4"
    >
      <section data-testid="permissions-tree-viewport-1366">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Viewport 1366×768
        </h2>
        <div className="h-[768px] overflow-auto rounded-lg border border-slate-300 bg-white p-3">
          <PermissionsTreeFixtureExample viewportPreset="1366" />
        </div>
      </section>
      <section data-testid="permissions-tree-viewport-1920">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Viewport 1920×1080
        </h2>
        <div className="h-[1080px] overflow-auto rounded-lg border border-slate-300 bg-white p-3">
          <PermissionsTreeFixtureExample viewportPreset="1920" />
        </div>
      </section>
    </div>
  );
}
