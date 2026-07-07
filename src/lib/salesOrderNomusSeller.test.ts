import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMISSION_NOMUS_SELLER_NOT_INFORMED_REASON,
  extractNomusSellerFromPedido,
  formatSalesOrderNomusSellerStatusLabel,
  isNomusSellerInformed,
  resolveCrmCommercialResponsibleName,
  resolveSalesOrderNomusSellerStatus,
} from "./salesOrderNomusSeller.shared.js";

describe("salesOrderNomusSeller", () => {
  it("extrai vendedor apenas do payload Nomus", () => {
    const extracted = extractNomusSellerFromPedido({
      idPessoaVendedor: 464,
      nomeVendedor: "GISLENE LIMA",
    });
    assert.equal(extracted.externalSellerId, 464);
    assert.equal(extracted.nomusSellerName, "GISLENE LIMA");
  });

  it("pedido sem vendedor Nomus fica vazio", () => {
    const extracted = extractNomusSellerFromPedido({
      idPessoaVendedor: null,
      nomeVendedor: "",
    });
    assert.equal(extracted.externalSellerId, null);
    assert.equal(extracted.nomusSellerName, null);
    assert.equal(isNomusSellerInformed(extracted), false);
    assert.equal(resolveSalesOrderNomusSellerStatus(extracted), "NOT_INFORMED");
    assert.equal(
      formatSalesOrderNomusSellerStatusLabel("NOT_INFORMED"),
      "Vendedor não informado no Nomus"
    );
  });

  it("responsável CRM vem do owner ativo", () => {
    assert.equal(
      resolveCrmCommercialResponsibleName({
        isActive: true,
        sellerCanonicalName: "JOSE EDUARDO CARDOSO DOS SANTOS",
      }),
      "JOSE EDUARDO CARDOSO DOS SANTOS"
    );
    assert.equal(
      resolveCrmCommercialResponsibleName({
        isActive: false,
        sellerCanonicalName: "INATIVO",
      }),
      null
    );
  });

  it("expõe motivo padrão de comissão sem vendedor Nomus", () => {
    assert.equal(COMMISSION_NOMUS_SELLER_NOT_INFORMED_REASON, "VENDEDOR_NOMUS_NAO_INFORMADO");
  });
});
