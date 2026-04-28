export function estimateTokens(text: string): number {
  // ~4 chars per token approximation
  return Math.ceil(text.length / 4);
}

export function extractTitle(text: string): string {
  // Take first sentence or first 100 chars, whichever is shorter
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim() || text;
  return firstSentence.slice(0, 100).trim();
}

export function extractText(content: string | unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: unknown) => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text')
      .map((b: unknown) => (b as Record<string, unknown>).text as string || '')
      .join(' ');
  }
  return '';
}

export function truncateToTokenBudget(text: string, budget: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= budget) return text;

  const targetChars = budget * 4;
  if (text.length <= targetChars) return text;

  const halfBudget = Math.floor(targetChars / 2);
  const start = text.slice(0, halfBudget);
  const end = text.slice(-Math.floor(halfBudget * 0.3));
  return `${start}\n\n[...truncated for token budget...]\n\n${end}`;
}

export function truncateDiff(diff: string, budget: number): string {
  const lines = diff.split('\n');
  const result: string[] = [];
  let tokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (tokens + lineTokens > budget) {
      result.push(`... (${lines.length - result.length} more lines truncated)`);
      break;
    }
    result.push(line);
    tokens += lineTokens;
  }

  return result.join('\n');
}

export function getRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
