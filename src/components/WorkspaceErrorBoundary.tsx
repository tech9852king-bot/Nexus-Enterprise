import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface WorkspaceErrorBoundaryProps {
  workspaceName: string;
  onResetWorkspace?: () => void;
  children: React.ReactNode;
}

interface WorkspaceErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class WorkspaceErrorBoundary extends React.Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: null,
    };
  }

  static getDerivedStateFromError(error: unknown): WorkspaceErrorBoundaryState {
    const message =
      error instanceof Error
        ? error.message
        : 'Unexpected runtime rendering error in workspace.';
    return {
      hasError: true,
      errorMessage: message,
    };
  }

  componentDidUpdate(prevProps: WorkspaceErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      prevProps.workspaceName !== this.props.workspaceName
    ) {
      this.setState({ hasError: false, errorMessage: null });
    }
  }

  handleRecover = (): void => {
    this.setState({ hasError: false, errorMessage: null });
    this.props.onResetWorkspace?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid="workspace-error-boundary"
          className="border border-rose-500/40 rounded-xl bg-white dark:bg-slate-900 p-6 space-y-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-mono text-rose-600 dark:text-rose-400 font-semibold">
                WORKSPACE FAULT ISOLATION BOUNDARY · {this.props.workspaceName}
              </div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Sub-workspace encountered a recoverable runtime error
              </h3>
              <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                Diagnostic: {this.state.errorMessage || 'Unknown error'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={this.handleRecover}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
              Reset & Recover Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
