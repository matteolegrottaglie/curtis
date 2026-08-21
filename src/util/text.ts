// ============================================================
//  Sanitising text that arrived from somewhere untrusted.
//
//  Two sources qualify, and for a long time only one of them was
//  treated that way. What is scraped off a LinkedIn page was always
//  cleaned before it could reach a model's context. What arrives in
//  an imported CSV was not — and importing a list somebody else
//  built is the whole point of the tool, so that was the wrong half
//  to trust.
//
//  Both end up interpolated into strings a model reads as the tool's
//  own output, so both have to lose the characters that let them
//  pretend to be it:
//
//  - C0/C1 control characters. A newline inside a contact's name
//    forges an entire extra line in `get_recent_actions`, which
//    renders one action per line — an invented action, indented and
//    punctuated exactly like the real ones.
//  - Unicode format characters (\p{Cf}): bidi overrides, zero-width
//    joiners. Invisible on screen, load-bearing inside a prompt.
//
//  Whitespace is then collapsed, so a run of spaces cannot be used to
//  push text off the end of a line either.
// ============================================================

/**
 * Strips control and format characters, collapses whitespace, trims.
 *
 * With `max` the result is truncated — for display, where a long value is
 * noise. Without it nothing is cut, which is what storing a value wants: a
 * headline can legitimately run past any limit worth picking here.
 */
export function sanitizeUntrusted(value: string | undefined | null, max?: number): string {
  if (!value) return '';
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f]|\p{Cf}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return max === undefined ? clean : clean.slice(0, max);
}
