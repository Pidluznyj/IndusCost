/**
 * Visão geral da Central de Tesouraria — sem regras financeiras.
 */

import { Link } from "react-router-dom";
import { TREASURY_UI_LABEL, TREASURY_UI_SECTIONS } from "./treasuryFeatureUi.js";

export function TreasuryScaffoldPage() {
  const accounts = TREASURY_UI_SECTIONS.find((s) => s.id === "accounts");

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="treasury-scaffold-page">
      <p className="text-sm leading-6 text-muted-foreground">
        {TREASURY_UI_LABEL} concentra contas financeiras locais, saldos manuais,
        OFX e conciliação bancária — sem duplicar o financeiro oficial (Fluxo de
        Caixa, CR/CP Nomus ou Conciliação de Carteira).
      </p>
      {accounts ? (
        <Link
          to={accounts.path}
          className="inline-flex rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
          data-testid="treasury-scaffold-open-accounts"
        >
          Abrir {accounts.label}
        </Link>
      ) : null}
    </div>
  );
}
