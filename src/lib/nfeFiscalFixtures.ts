/**
 * Fixture técnica PD 02457 — composição dos R$ 129,19 como IPI no XML.
 * XML real pode ser reprocessado no servidor via backfill; este fixture é representativo.
 */

/** Produtos líquidos 3975; IPI 129.19; vNF 4104.19. */
export const PD_02457_FISCAL = {
  productsNet: 3975.0,
  ipi: 129.19,
  vNF: 4104.19,
  orderLabel: "PD 02457",
} as const;

export const PD_02457_NFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe35250100000000000000550010000024571000000000" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <natOp>VENDA</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>2457</nNF>
        <dhEmi>2025-03-10T14:00:00-03:00</dhEmi>
        <tpNF>1</tpNF>
        <idDest>1</idDest>
        <finNFe>1</finNFe>
      </ide>
      <emit>
        <CNPJ>00000000000191</CNPJ>
        <xNome>EMITENTE FIXTURE</xNome>
      </emit>
      <dest>
        <CNPJ>60878889000128</CNPJ>
        <xNome>ESMALTEC S/A</xNome>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>SKU-PD02457</cProd>
          <xProd>COMPONENTE FIXTURE PD02457</xProd>
          <NCM>39269090</NCM>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>1.0000</qCom>
          <vUnCom>3975.00</vUnCom>
          <vProd>3975.00</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <orig>0</orig>
              <CST>00</CST>
              <modBC>3</modBC>
              <vBC>0.00</vBC>
              <pICMS>0.00</pICMS>
              <vICMS>0.00</vICMS>
            </ICMS00>
          </ICMS>
          <IPI>
            <cEnq>999</cEnq>
            <IPITrib>
              <CST>50</CST>
              <vBC>3975.00</vBC>
              <pIPI>3.2500</pIPI>
              <vIPI>129.19</vIPI>
            </IPITrib>
          </IPI>
          <PIS>
            <PISAliq>
              <CST>01</CST>
              <vBC>0.00</vBC>
              <pPIS>0.00</pPIS>
              <vPIS>0.00</vPIS>
            </PISAliq>
          </PIS>
          <COFINS>
            <COFINSAliq>
              <CST>01</CST>
              <vBC>0.00</vBC>
              <pCOFINS>0.00</pCOFINS>
              <vCOFINS>0.00</vCOFINS>
            </COFINSAliq>
          </COFINS>
        </imposto>
      </det>
      <total>
        <ICMSTot>
          <vBC>0.00</vBC>
          <vICMS>0.00</vICMS>
          <vICMSDeson>0.00</vICMSDeson>
          <vFCP>0.00</vFCP>
          <vBCST>0.00</vBCST>
          <vST>0.00</vST>
          <vFCPST>0.00</vFCPST>
          <vFCPSTRet>0.00</vFCPSTRet>
          <vProd>3975.00</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>0.00</vDesc>
          <vII>0.00</vII>
          <vIPI>129.19</vIPI>
          <vIPIDevol>0.00</vIPIDevol>
          <vPIS>0.00</vPIS>
          <vCOFINS>0.00</vCOFINS>
          <vOutro>0.00</vOutro>
          <vNF>4104.19</vNF>
          <vTotTrib>129.19</vTotTrib>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>`;
