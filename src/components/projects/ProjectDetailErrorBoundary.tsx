import React from "react";
import { AlertTriangle } from "lucide-react";

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export class ProjectDetailErrorBoundary extends React.Component<Props, State> {
  declare props: Props;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <h4 className="font-semibold text-destructive">Erro ao exibir o projeto</h4>
              <p className="mt-2 text-sm text-muted-foreground">
                Ocorreu um erro inesperado nesta tela. Os dados do cadastro mestre não foram
                alterados. Recarregue a página ou volte para a lista de projetos.
              </p>
              <p className="mt-2 font-mono text-xs text-destructive/80">{this.state.error.message}</p>
              <button
                type="button"
                className="mt-4 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
                onClick={() => window.location.reload()}
              >
                Recarregar página
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
