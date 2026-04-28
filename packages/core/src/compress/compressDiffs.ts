import { estimateTokens, truncateDiff } from '../utils.js';

export function compressDiff(diff: string, budget: number): string {
  if (!diff) return '';
  if (estimateTokens(diff) <= budget) return diff;
  return truncateDiff(diff, budget);
}

export function compressText(text: string, budget: number): string {
  if (!text) return '';
  const estimated = estimateTokens(text);
  if (estimated <= budget) return text;

  const targetChars = budget * 4;
  if (text.length <= targetChars) return text;

  const halfBudget = Math.floor(targetChars * 0.7);
  const endBudget = Math.floor(targetChars * 0.3);
  const start = text.slice(0, halfBudget);
  const end = text.slice(-endBudget);
  return `${start}\n\n[...truncated...]\n\n${end}`;
}
