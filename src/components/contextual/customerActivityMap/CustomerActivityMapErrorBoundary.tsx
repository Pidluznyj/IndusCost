/**
 * O mapa é um bloco a mais em Clientes › Indicadores: se ele falhar, o resto
 * da tela (cards, gráfico por UF, segmentos) tem de continuar funcionando.
 */

import React from "react";

type Props = { children: React.ReactNode };
type State = { failed: boolean };

export class CustomerActivityMapErrorBoundary extends React.Component<Props, State> {
  declare props: Props;
  declare setState: (state: State) => void;
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("[customer-activity-map] falha ao renderizar o mapa", error);
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        className="flex h-[clamp(380px,62vh,640px)] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-6 text-center"
        role="alert"
      >
        <p className="text-sm font-medium text-destructive">
          Não foi possível carregar o Mapa de Atuação.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
        >
          Tentar novamente
        </button>
      </div>
    );
  }
}
