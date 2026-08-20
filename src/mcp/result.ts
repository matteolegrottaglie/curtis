// ============================================================
//  Helper per costruire i risultati dei tool MCP.
//  `content` è quello che legge il modello, `structuredContent`
//  quello che i client tipizzano contro l'outputSchema.
// ============================================================
export const textBlock = (text: string) => ({ type: 'text' as const, text });

/** Errore "atteso" (input sbagliato, precondizione mancante): non è un crash. */
export function errorResult(message: string) {
  return { isError: true as const, content: [textBlock(message)] };
}

/** Trasforma un'eccezione in un risultato di errore leggibile. */
export function fromException(err: unknown, prefix: string) {
  const msg = err instanceof Error ? err.message : String(err);
  return errorResult(`${prefix}: ${msg}`);
}
