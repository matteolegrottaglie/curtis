// ============================================================
//  Helpers for building MCP tool results.
//  `content` is what the model reads, `structuredContent`
//  what clients type-check against the outputSchema.
// ============================================================
export const textBlock = (text: string) => ({ type: 'text' as const, text });

/** An "expected" error (bad input, missing precondition): not a crash. */
export function errorResult(message: string) {
  return { isError: true as const, content: [textBlock(message)] };
}

/** Turns an exception into a readable error result. */
export function fromException(err: unknown, prefix: string) {
  const msg = err instanceof Error ? err.message : String(err);
  return errorResult(`${prefix}: ${msg}`);
}
