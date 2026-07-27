/**
 * Placeholder FE da Central de Tesouraria — sem regras financeiras e sem wiring de rota ainda.
 * Nav/ACL entram em prompts seguintes.
 */

import { TREASURY_UI_LABEL } from "./treasuryFeatureUi.js";

export function TreasuryScaffoldPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {TREASURY_UI_LABEL}
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Módulo em scaffold. Contas, saldos, OFX e conciliação bancária serão
        adicionados em entregas seguintes — sem duplicar o financeiro oficial
        (Fluxo de Caixa, CR/CP Nomus ou Conciliação de Carteira).
      </p>
    </div>
  );
}
