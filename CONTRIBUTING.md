# Contributing

Thanks for looking. This project has one dominant maintenance need and a few hard rules; both are
below.

## The most useful contribution: selector fixes

LinkedIn changes its DOM regularly and [`src/linkedin/selectors.ts`](src/linkedin/selectors.ts)
stops matching. Fixing that is worth more than any feature.

The repair loop:

```bash
# 1. see how the page looks now, on real profiles
npx tsx scripts/probe-targets.ts targets.json

# 2. fix src/linkedin/selectors.ts

# 3. verify the logic against a synthetic DOM (no network, no account)
npm run test:selectors

# 4. try one real send in isolation, outside the engine
npx tsx scripts/connect-no-note.ts targets.json 0
```

`targets.json` is yours, local, and **git-ignored** — it holds real people's profile URLs. Never
commit it, never paste its contents into an issue or a PR.

When you fix a selector, **add a fixture** to `scripts/selectors-fixture-test.ts` reproducing the
DOM that broke it. That file already locks in the sidebar-Connect regression, the sticky Premium
banner, and the hidden "Send" that stole the match. Every fix should leave a fixture behind.

### Selector invariants — do not break these

- **Never select by role for top-card controls.** They are not `<button>`s: "Connect" is an `<a>`
  with `aria-label="Invite <Name> to connect"` and no `role="button"`.
- **Anchor every selector to the person's name tokens.** The "More profiles for you" sidebar has
  its own Connect buttons. Without anchoring you invite the wrong person. If the name cannot be
  derived, click nothing and report the failure.
- **Never `click({ force: true })`.** It clicks by coordinates and, with the sticky top-nav
  overlapping, hits the "Claim Premium Page" banner and lands in Premium checkout. This has
  actually happened.
- **Verify the page after every click.** If you end up on a Premium/checkout page, stop.

## Setup

```bash
git clone https://github.com/matteolegrottaglie/Linkedin-Sequencer-MCP.git
cd Linkedin-Sequencer-MCP
npm install
npm run typecheck
npm test
```

Node ≥ 22.22.2 is required (`mcp-use` v2). Work against a throwaway data directory so you never
touch your real database or session:

```bash
LKSQ_DATA_DIR=/tmp/lksq-dev LKSQ_PORT=4399 npm run dev
```

## Before opening a PR

```bash
npm run typecheck      # must pass
npm test               # pure logic: templates, CSV, safety controller
npm run test:selectors # if you touched anything under src/linkedin/
npm run build
```

Tests live in `test/` and use `node:test`. They deliberately cover **pure logic only** — no
browser, no network, no account. Keep it that way: anything needing a real LinkedIn session
belongs in `scripts/`, run by hand.

## Rules that are not negotiable

- **Never raise the default limits.** The ramp, caps, delays and weekly ceiling in
  `DEFAULT_SAFETY_CONFIG` are deliberately conservative. A PR that makes the tool faster or
  louder out of the box will be declined. Users can raise their own limits from chat, informed,
  on their own account.
- **Never weaken a safety stop.** HALT surviving restarts, the acceptance-rate brake, the working
  window, and the checkout-page guard exist because of real incidents.
- **No personal data in the repo.** No real profile URLs, names, companies, CSV rows, message
  text, screenshots, or absolute paths from your machine. Examples use invented people.
- **No secrets, ever.** Tokens, session cookies and the browser profile stay out of git. Check
  `git diff --staged` before committing.
- **No telemetry, no phone-home.** The tool talks to LinkedIn and to nothing else. Keep it that
  way.
- **Don't claim safety you can't prove.** Documentation about ban risk cites primary LinkedIn
  sources or says plainly that a number is a guess. Vendor-blog figures do not go in this repo.

## Style

- TypeScript, ESM, strict mode. No new runtime dependency without a good reason.
- Comments explain **why**, not what — the existing code is written that way, match it.
- Commit messages describe the change in terms of behaviour, in the imperative.

## Reporting bugs

Use the issue templates. For a failing action, include the output of `get_recent_actions` — it
carries the `aria-label`s the tool actually saw — with any real names redacted.

Security issues do **not** go in public issues: see [SECURITY.md](SECURITY.md).
