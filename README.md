# LinkedIn Sequencer MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.22.2-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/protocol-MCP-8A2BE2.svg)](https://modelcontextprotocol.io)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey.svg)](#requirements)

An **MCP server** that runs LinkedIn outreach **from your own machine**, driven entirely from
chat in Claude Code, Codex, or any MCP client.

You log into LinkedIn once, hand it a list of contacts, and it sends connection requests —
slowly, inside working hours, behind a warm-up ramp and a closed-loop controller that slows
itself down when LinkedIn shows signs of irritation.

No LinkedIn API, no OAuth token, no password handling: it drives a **real Chrome window** with
Playwright, using your own session and your own IP.

```
you:     "import ~/contacts.csv and start sending connection requests"
Claude:  → import_contacts → create_campaign → enroll_contacts → engine_control start
         "Campaign created: 180 contacts. Up to 12 invites/day, Mon–Fri 9–18."
```

---

## ⚠️ Read this first

This section is not boilerplate. Read it before you install anything.

- **Automating LinkedIn violates its User Agreement** (§8.2 forbids "bots or other automated
  methods to access the Services, add or download contacts, send or redirect messages").
  Penalties range from a temporary restriction to a **permanent ban**.
- **Nobody can guarantee you won't get banned** — not even the paid tools. This project
  *reduces* the risk through low volume and human pacing. It does not eliminate it.
- **Be sceptical of the numbers you find online.** "100–200 invites/week", "75/day",
  "recovery under 15%" are figures from automation-vendor blogs with no primary source.
  **LinkedIn publishes no numeric invite limit**, weekly or total-pending, and states that it
  cannot show you how much headroom you have left. Do not build your safety margin on them.

### What LinkedIn actually says (primary sources)

- Three stated triggers for an invite restriction: too many invites in a short period; a high
  share of invites ignored or marked as spam; and **"using automation tools to send
  invitations"** ([Help a551012](https://www.linkedin.com/help/linkedin/answer/a551012)).
- A restriction **typically lasts a week**, LinkedIn **cannot shorten it**, and Support will not
  tell you the reason. It scales up to **a month** for too many pending invites.
- **Withdrawing pending invites does not lift a restriction**, and after withdrawing you cannot
  re-invite the same person for **~3 weeks**
  ([Help a550555](https://www.linkedin.com/help/linkedin/answer/a550555)).
- **Free accounts** can attach a personalised note to only **5 invites per month** (unlimited on
  Premium). That cap is **monthly**, not weekly.
- The network limit remains **30,000 first-degree connections**.

The ceilings this tool ships with (`weeklyInviteCeiling`, `caps`, the ramp) are **deliberate
caution**, not known LinkedIn thresholds. The signal worth watching is your **acceptance rate**,
not a number from a blog post.

Use it responsibly, on **your own** account, at your own risk. See [DISCLAIMER](#disclaimer).

---

## Requirements

| | |
|---|---|
| **Node.js** | ≥ 22.22.2 (required by `mcp-use` v2) |
| **Browser** | Google Chrome (recommended) or Playwright's bundled Chromium |
| **OS** | macOS or Linux. On Windows everything works except service installation |

## Install

```bash
npm install -g "git+https://github.com/matteolegrottaglie/Linkedin-Sequencer-MCP.git"
```

Then run the initial setup:

```bash
lksq setup
```

This creates `~/.linkedin-sequencer-mcp/`, generates the access token, verifies your browser and
prints the next steps. If you don't have Chrome installed:

```bash
npx playwright install chromium
```

## Connect your MCP client

Start the daemon and ask for the configuration line:

```bash
lksq daemon start && lksq mcp-config
```

**Claude Code**

```bash
claude mcp add --transport http linkedin-sequencer http://127.0.0.1:4311/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

**Codex** — in `~/.codex/config.toml`:

```toml
[mcp_servers.linkedin_sequencer]
url = "http://127.0.0.1:4311/mcp"
bearer_token_env_var = "LKSQ_TOKEN"
```

`lksq mcp-config` prints both lines already filled in with your token.

> The token lives in `~/.linkedin-sequencer-mcp/token` with mode `0600`. Do not share it:
> whoever holds it can send invites and messages as you.

## Usage, from chat

**1. Log into LinkedIn** (once)

> "log into LinkedIn"

A Chrome window opens on the login page. Sign in normally — Google SSO and 2FA both work. This is
the only moment you see the browser: once you're in, the window closes and from then on the tool
works in the background. It never sees or stores your password — only the browser session, kept
locally. On later runs you are already signed in.

**2. Import your list and go**

> "import ~/Desktop/contacts.csv and start sending connection requests;
> once they accept, write: 'Hi {firstName}, thanks for connecting!'"

**3. Check on it**

> "where are we?" · "how many invites went out this week?" · "what's the acceptance rate?"

**4. Slow down or stop**

> "drop to 8 invites a day" · "pause" · "stop everything"

---

## How it works

### Slow on purpose

One action at a time, 40 s – 3 min of pause between actions, long breaks every 6–12 actions, and
only inside the configured window (default Mon–Fri, 9–18). **The slowness is the protection**:
bursts and overnight activity are the easiest bot signals to detect. A 200-contact list takes
weeks, not hours.

### You don't see the browser

The tool works in the background: no window popping up or moving while you're doing something
else. The one time you see Chrome is the login, because you type the credentials yourself.

This is not the old, easily-detected headless mode — and the difference is worth explaining,
because the whole design rests on it:

- it drives **system Chrome**, not an automation Chromium, so the reported WebGL renderer is your
  actual GPU;
- the **User-Agent is stripped** of the `Headless` marker, HTTP headers and client hints included;
- **real display values** (colour depth) are observed during login and replayed in the background.

Measured across the signals an anti-bot checks first — `navigator.webdriver`, plugins, languages,
User-Agent, client hints, WebGL renderer, colour depth, window dimensions — the background
fingerprint after first login is **identical** to the windowed one.

If you want to watch anyway, `HEADFUL=true` brings the window back. That's mostly useful when a
selector stops matching and you need to look at the page yourself.

### Keeping campaigns moving with the client closed

Sequences run for days (waiting for acceptance, warm-up ramp). So they keep advancing after you
close Claude Code, install the daemon as a user service:

```bash
lksq service install
```

On macOS this creates a LaunchAgent, on Linux a systemd user unit. The service also starts the
engine at login, so campaigns proceed on their own — always inside the time window, ramp and
ceilings. `--no-autostart` keeps only the MCP server running.

```bash
lksq service uninstall   # to undo
```

---

## CSV format

You need at least the profile URL column. Headers are recognised in English and Italian,
case-insensitively.

```csv
profile_url,first_name,last_name,company,headline,industry
https://www.linkedin.com/in/jane-doe/,Jane,Doe,Acme,CEO @ Acme,Manufacturing
linkedin.com/in/john-smith,John,Smith,Beta Ltd,CTO,Software
```

| Field | Accepted headers |
|---|---|
| Profile URL *(required)* | `profile_url`, `url`, `linkedin`, `linkedin url`, `profile`, `profilo`, `link` |
| First name | `first_name`, `firstname`, `nome` |
| Last name | `last_name`, `lastname`, `cognome` |
| Full name | `full_name`, `name`, `nominativo` |
| Company | `company`, `azienda`, `organizzazione` |
| Headline | `headline`, `title`, `role`, `titolo`, `qualifica`, `ruolo` |
| Location | `location`, `city`, `località`, `città` |
| Email | `email`, `e-mail`, `mail` |

Any other column becomes `{custom.COLUMN_NAME}`, usable in templates.

> If a row contains only a *slug* (`jane-doe`) instead of a URL, it is reconstructed into a
> profile URL but flagged in the import result. Check those: a typo in that column would
> otherwise pass silently as a valid profile.

### Message templates

- Placeholders: `{firstName}` `{lastName}` `{fullName}` `{company}` `{headline}` `{location}`
  `{custom.NAME}`
- **Spintax** (anti-pattern variation): `{Hi|Hello|Hey} {firstName}!`

Identical messages sent in bulk are one of the strongest bot signals. Use spintax.

---

## The recommended sequence (and why)

```
visit profile → wait 1 day → connect WITHOUT a note → wait for acceptance (14d) → first message
```

The personalised note does **not** go in the invite: free accounts only get 5 per month.
Personalisation belongs in the **first message after acceptance**, where it costs nothing.

This is the sequence `create_campaign` and `start_connection_campaign` use by default.

## The safety controller

The closed-loop controller in [`src/safety/controller.ts`](src/safety/controller.ts) is the
anti-ban core. It is not a static schedule:

| Mechanism | Default behaviour |
|---|---|
| **Warm-up ramp** | Invites/day by week: 12 → 16 → 18 → 20 → 22 → 25 |
| **Weekly ceiling** | Hard limit, never exceeded (100) |
| **Acceptance rate** | Below the threshold (40%) the controller *reduces* invite volume |
| **Backoff** | On a "weekly limit" or warning signal, invites pause and the ceiling drops |
| **HALT** | On captcha or restriction it stops entirely. Survives restarts by design: you must clear the flag on LinkedIn first, then reset it |
| **Recovery** | After N clean days (3) the limits climb back gradually |
| **Auto-withdraw** | Pending invites older than 21 days are withdrawn to keep the backlog healthy |
| **Daily caps** | Absolute per-action ceilings: 30 invites, 40 messages, 60 visits, 25 follows, 30 likes, 20 withdrawals |

All of it readable and adjustable from chat with `get_safety_settings` /
`update_safety_settings`.

---

## MCP tools

| Group | Tools |
|---|---|
| Authentication | `linkedin_auth_status` · `linkedin_login` · `linkedin_logout` |
| Contacts | `import_contacts` · `list_contacts` · `delete_contacts` |
| Campaigns | `create_campaign` · `list_campaigns` · `get_campaign` · `update_campaign` · `set_campaign_status` · `delete_campaign` · `enroll_contacts` |
| Engine | `engine_status` · `engine_control` |
| Safety | `get_safety_settings` · `update_safety_settings` |
| Metrics | `get_metrics` · `get_recent_actions` · `get_signals` |
| Fast path | `start_connection_campaign` |

The server ships its own operating manual to the model through the MCP `instructions` field
([`src/mcp/instructions.ts`](src/mcp/instructions.ts)): operation order, real limits, how to
handle a HALT. The [`skills/linkedin-outreach`](skills/linkedin-outreach/SKILL.md) playbook adds
what the instructions can't cover — how to build a list that converts and how to read the
numbers.

## `lksq` CLI

```bash
lksq setup                       # initial configuration
lksq daemon start|stop|status    # background daemon
lksq start                       # daemon in the foreground
lksq logs -f                     # follow the log
lksq login                       # terminal login (with the daemon stopped)
lksq mcp-config                  # config lines for Claude Code and Codex
lksq service install|uninstall   # unattended operation
lksq doctor                      # diagnose the installation
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `LKSQ_DATA_DIR` | `~/.linkedin-sequencer-mcp` | Where database, browser profile, token and logs live |
| `LKSQ_PORT` | `4311` | Daemon port. The host is always `127.0.0.1`, not configurable |
| `TIMEZONE` | `Europe/Rome` | IANA zone for the working-hours window |
| `LOG_LEVEL` | `info` | `trace` · `debug` · `info` · `warn` · `error` · `silent` |
| `BROWSER_CHANNEL` | auto | `chrome` for system Chrome, `chromium` to force Playwright's |
| `HEADFUL` | `false` | `true` keeps the browser window visible |
| `AUTO_CONNECT` | `true` | Reopen the saved LinkedIn session on daemon start |
| `AUTOSTART_ENGINE` | `false` | Start the engine with the daemon (what the service sets) |

Optional values can also go in `<LKSQ_DATA_DIR>/.env` — see [`.env.example`](.env.example).
Environment variables always win over the file.

## Where your data lives

Everything under `~/.linkedin-sequencer-mcp/` (or `LKSQ_DATA_DIR`):

```
sequencer.db       contacts, campaigns, actions, signals, settings
browser-profile/   your LinkedIn session (this is your login: treat it like a password)
token              bearer token for the MCP endpoint (0600)
screenshots/       captured when an action fails
daemon.log
```

None of these files ever leaves your computer. There is no telemetry, no analytics, and no
network call to anything but LinkedIn itself.

---

## Architecture

```
lksq start
  └─ daemon (one process)
       ├─ SQLite            contacts, campaigns, actions, settings
       ├─ Engine            worker loop: one action at a time, human delays
       ├─ Playwright        real Chrome, persistent profile
       └─ MCPServer         http://127.0.0.1:4311/mcp   (mcp-use v2, Streamable HTTP)
```

A **daemon** rather than an ephemeral MCP server because campaigns run for days and Playwright
locks the browser profile to a single process: login, engine and tools have to live together.
`mcp-use` v2 offers no stdio transport, but both Claude Code and Codex speak Streamable HTTP.

```
src/
  cli.ts               the `lksq` command
  daemon.ts            daemon process
  config.ts            paths, port, token, safety defaults
  mcp/                 MCP server: instructions, zod schemas, tools
  service/             application logic shared by the tools
  safety/controller.ts adaptive controller (anti-ban core)
  sequencer/engine.ts  worker loop
  browser/             persistent session, stealth, human behaviour
  linkedin/            selectors (FRAGILE), guards, Playwright actions
  db/  importer/  util/  platform/
scripts/               selector maintenance tooling (see below)
skills/                playbook installable as a Claude Code skill
test/                  node:test, pure logic, no browser
```

## When it breaks: selectors

This is **the** recurring maintenance task. LinkedIn changes the DOM and selectors stop matching.
When an action fails the engine saves a **screenshot** whose path shows up in
`get_recent_actions`, together with the `aria-label`s it actually saw on the page.

### How the selectors are built, and why

Rewritten on 2026-08-20 after probing the live DOM, and verified in the field with real sends.
Two things to know before touching them:

- **Do not select by role.** The top-card controls are not `<button>`s: "Connect" is an `<a>` with
  `aria-label="Invite <Name> to connect"` and no `role="button"`. The old
  `getByRole('button', { name: /^connect$/ })` returned zero matches — that was the bug.
- **Every selector is anchored to the person's name tokens.** The "More profiles for you" sidebar
  has its own "Connect" buttons; without anchoring you end up inviting someone else. If the name
  can't be derived, the tool **clicks nothing** and reports the failure.

Two more invariants that look like details and are not: never `click({ force: true })` (it clicks
by coordinates, and with the sticky top-nav overlapping it hits the "Claim Premium Page" banner
and lands you in Premium checkout — this actually happened); and after every click the tool
verifies it hasn't ended up on a Premium/checkout page, stopping if it has.

### The repair loop

```bash
# 1. see how the page looks now, on real profiles
npx tsx scripts/probe-targets.ts targets.json

# 2. fix src/linkedin/selectors.ts

# 3. verify the logic against a synthetic DOM (no network, no account)
npm run test:selectors

# 4. try one real send in isolation, outside the engine
npx tsx scripts/connect-no-note.ts targets.json 0
```

`scripts/selectors-fixture-test.ts` locks in the regressions already seen (the sidebar Connect,
the sticky Premium banner, the hidden "Send" that stole the match). Re-run it every time you
touch `selectors.ts`. A green fixture does not prove the live UI still looks like that — only
step 1 tells you that.

> `targets.json` is a local file of real profile URLs used for probing. It is git-ignored and
> must stay that way: it contains third parties' personal data.

## Development

```bash
npm install
npm run typecheck
npm test               # pure logic: templates, CSV, safety controller
npm run test:selectors # selectors against a synthetic DOM (needs a browser)
npm run build
npm run dev            # daemon in the foreground
```

If `npm run test:selectors` can't find Playwright's browser, point it at Chrome:

```bash
PW_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:selectors
```

To work without touching your real data:

```bash
LKSQ_DATA_DIR=/tmp/lksq-dev LKSQ_PORT=4399 npm run dev
```

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Selector fixes are the most
valuable kind.

## Security

The MCP endpoint listens on loopback only and is protected by a bearer token, because reaching it
means being able to act on your LinkedIn account. To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## Disclaimer

This is a personal, educational project. Using it violates LinkedIn's Terms of Service and may
get your account restricted or permanently banned. It is provided **as is**, with no warranty of
any kind: the authors accept no liability for any consequence of its use, and anyone who
distributes or runs it assumes full responsibility.

You are also responsible for how you treat other people's data. Only contact people you have a
legitimate reason to contact, honour opt-outs, and remember that under the GDPR the contact list
you import is personal data you are processing.

Low volume, gradual ramp, common sense.

## License

[MIT](LICENSE) © Matteo Legrottaglie
