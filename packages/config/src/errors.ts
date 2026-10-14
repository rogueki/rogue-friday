export interface ConfigProblem {
  /** Source file or `env`. */
  source: string;
  /** Dotted path inside the document (empty for file-level problems). */
  path: string;
  message: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: readonly ConfigProblem[]) {
    super(formatProblems(problems));
    this.name = 'ConfigError';
  }
}

export function formatProblems(problems: readonly ConfigProblem[]): string {
  const lines = problems.map((p, i) => `  ${i + 1}. [${p.source}] ${p.path ? `${p.path}: ` : ''}${p.message}`);
  return `Invalid configuration (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;
}
