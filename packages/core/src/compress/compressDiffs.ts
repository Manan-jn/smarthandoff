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

  const cutPoint = Math.floor(targetChars * 0.85);
  const slice = text.slice(0, cutPoint);

  // Prefer cutting at a sentence boundary
  const sentenceEnd = slice.search(/[.!?][^.!?]*$/);
  if (sentenceEnd > cutPoint * 0.5) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }

  // Fall back to last word boundary
  const wordEnd = slice.lastIndexOf(' ');
  if (wordEnd > cutPoint * 0.5) {
    return slice.slice(0, wordEnd).trim() + '…';
  }

  return slice.trim() + '…';
}
