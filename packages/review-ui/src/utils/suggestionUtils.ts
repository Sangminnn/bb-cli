// Suggestion block parsed from comment body
// - GitHub-style ```suggestion blocks render as apply/reject suggestions
// - Plain ``` (or ```lang) blocks render as read-only code previews
interface SuggestionBlock {
  suggestedCode: string; // The suggested replacement code
  startIndex: number; // Start position in the comment body
  endIndex: number; // End position in the comment body
  isSuggestion: boolean; // true if ```suggestion fence, false for plain code fence
}

const SUGGESTION_REGEX = /```suggestion\n([\s\S]*?)```/g;
const CODE_FENCE_REGEX = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;

/**
 * Check if a comment body contains a GitHub-style ```suggestion fence (apply/reject).
 * Used by server orchestrator and commit/apply flows.
 */
export function hasSuggestionBlock(body: string): boolean {
  return /```suggestion\n([\s\S]*?)```/.test(body);
}

/**
 * Check if a comment body contains any fenced block — closed or still-typing.
 * Triggers the Edit/Preview switcher as soon as the user opens a ``` fence,
 * so they get immediate feedback while typing code.
 */
export function hasFencedCodeBlock(body: string): boolean {
  return /```/.test(body);
}

/**
 * Parse all fenced blocks from a comment body — both ```suggestion and plain ``` code fences.
 * Pure parser: only extracts blocks and their positions from the body text.
 */
export function parseSuggestionBlocks(body: string): SuggestionBlock[] {
  const blocks: SuggestionBlock[] = [];

  SUGGESTION_REGEX.lastIndex = 0;
  CODE_FENCE_REGEX.lastIndex = 0;

  const consumed = new Set<number>();
  let suggestionMatch: RegExpExecArray | null;

  while ((suggestionMatch = SUGGESTION_REGEX.exec(body)) !== null) {
    const startIndex = suggestionMatch.index;
    blocks.push({
      suggestedCode: suggestionMatch[1].replace(/\n$/, ''),
      startIndex,
      endIndex: startIndex + suggestionMatch[0].length,
      isSuggestion: true,
    });
    consumed.add(startIndex);
  }

  let codeMatch: RegExpExecArray | null;
  while ((codeMatch = CODE_FENCE_REGEX.exec(body)) !== null) {
    const startIndex = codeMatch.index;
    if (consumed.has(startIndex)) continue;
    const lang = codeMatch[1];
    if (lang === 'suggestion') continue; // already captured by suggestion pass
    blocks.push({
      suggestedCode: (codeMatch[2] ?? '').replace(/\n$/, ''),
      startIndex,
      endIndex: startIndex + codeMatch[0].length,
      isSuggestion: false,
    });
  }

  blocks.sort((a, b) => a.startIndex - b.startIndex);
  return blocks;
}
