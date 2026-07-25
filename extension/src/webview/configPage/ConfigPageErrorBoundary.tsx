import * as React from 'react';

interface ConfigPageErrorBoundaryProps {
  children: React.ReactNode;
}

interface ConfigPageErrorBoundaryState {
  error: Error | null;
}

function resolveUiLanguage(): 'zh-CN' | 'en-US' {
  const injected = typeof window !== 'undefined' ? window.__AS_LANG__ : undefined;
  if (injected === 'en-US' || injected === 'en') {
    return 'en-US';
  }
  return 'zh-CN';
}

const COPY = {
  'zh-CN': {
    title: '配置页加载失败',
    hint: '请打开开发者工具（帮助 → 切换开发人员工具）查看详细报错，或重新加载窗口后重试。',
  },
  'en-US': {
    title: 'Config page failed to load',
    hint: 'Open Developer Tools (Help → Toggle Developer Tools) for details, or reload the window and retry.',
  },
} as const;

export class ConfigPageErrorBoundary extends React.Component<
  ConfigPageErrorBoundaryProps,
  ConfigPageErrorBoundaryState
> {
  state: ConfigPageErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ConfigPageErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ConfigPage render error:', error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const copy = COPY[resolveUiLanguage()];

    return (
      <div
        style={{
          minHeight: '100vh',
          padding: 24,
          fontFamily: 'var(--vscode-font-family, sans-serif)',
          background: 'var(--vscode-editor-background)',
          color: 'var(--vscode-editor-foreground, #ccc)',
        }}
      >
        <h2 style={{ marginBottom: 12, fontSize: 18 }}>{copy.title}</h2>
        <p style={{ marginBottom: 12, opacity: 0.85 }}>{copy.hint}</p>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            padding: 12,
            borderRadius: 8,
            background: 'var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.15))',
            fontSize: 12,
          }}
        >
          {error.message}
          {'\n\n'}
          {error.stack}
        </pre>
      </div>
    );
  }
}
