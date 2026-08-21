<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="" width="88" height="88">
  </picture>
</p>

<h1 align="center">Curtis</h1>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A5%2022.22.2-brightgreen.svg"></a>
  <a href="https://modelcontextprotocol.io"><img alt="MCP" src="https://img.shields.io/badge/protocol-MCP-8A2BE2.svg"></a>
  <a href="#requirements"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey.svg"></a>
</p>

**Curtis runs your LinkedIn outreach from your own machine, at the pace you would run it
yourself — and keeps running it after you have stopped paying attention.**

Curtis is an [MCP](https://modelcontextprotocol.io) server that runs on your laptop, which means
you talk to him from chat — in Claude Code, Codex, or any MCP client. You log into LinkedIn once,
in a real browser window. You hand him a list. He works through it over the following weeks: one
profile at a time, inside working hours, behind a warm-up ramp, slowing himself down when the
numbers say to.

```
you:     "import ~/prospects.csv and start reaching out"
Curtis:  → import_contacts → create_campaign → enroll_contacts → engine_control start
         "Campaign created: 350 contacts. Up to 12 invites/day, Mon–Fri 9–18,
          rising each week. At this pace the invitations take about a month."

...a week later...

you:     "how's it going?"
Curtis:  "48 invites sent, 23 accepted (48%), 3 replies. Acceptance rate is healthy,
          so next week the ramp moves to 16/day. Two profiles failed — both already
          1st-degree connections."
```

No LinkedIn API, no OAuth, no password handed to anyone. Curtis drives a real Chrome window with
Playwright, using your session and your IP.

---

## Contents

**The idea**
[Why Curtis exists](#why-curtis-exists) ·
[What Curtis actually does](#what-curtis-actually-does) ·
[A month with Curtis](#a-month-with-curtis) ·
[Who this is for](#who-this-is-for) ·
[What Curtis will not do](#what-curtis-will-not-do) ·
[Read this before installing](#read-this-before-installing)

**Getting it running**
[Requirements](#requirements) ·
[Install](#install) ·
[Connect your MCP client](#connect-your-mcp-client) ·
[Usage from chat](#usage-from-chat) ·
[How it works](#how-it-works)

**Reference**
[CSV format](#csv-format) ·
[The recommended sequence](#the-recommended-sequence-and-why) ·
[The safety controller](#the-safety-controller) ·
[MCP tools](#mcp-tools) ·
[CLI and environment](#curtis-cli) ·
[Where your data lives](#where-your-data-lives)

**Working on it**
[Architecture](#architecture) ·
[When it breaks: selectors](#when-it-breaks-selectors) ·
[Development](#development) ·
[Security](#security) ·
[Disclaimer](#disclaimer)

---

## Why Curtis exists

Outreach that works is not complicated. You find someone worth talking to, you connect, you wait,
and once they accept you say something that could only have been written to them. Each of those
steps takes about thirty seconds.

The problem is never the thirty seconds. It is thirty seconds times three hundred people, spread
across six weeks, where the part that actually converts — the message *after* they accept — lands
days later, on a day when you are busy with something else. Personal outreach is not hard. It is
boring, and it asks you to keep a routine alive for longer than enthusiasm lasts. That is a
scheduling problem, and willpower is a bad scheduler.

So people reach for a growth tool, and hit the other failure mode. Those tools solve the
persistence problem by removing the person: a few hundred invitations a week, from a data-centre
IP, with one template. That cuts against you twice. LinkedIn names
["using automation tools to send invitations"](https://www.linkedin.com/help/linkedin/answer/a551012)
as one of three stated triggers for restricting an account — and a second stated trigger is a
high share of invitations that get ignored, which is what a template sent to hundreds of people
earns. The volume that is supposed to compensate for the impersonality is the same volume that
makes it impersonal.

Both failure modes come from treating outreach as a volume problem. It is not. It is a
persistence problem wearing a volume problem's clothes.

Curtis is the third option. He does exactly the work you would do by hand, at roughly the speed
you would do it, from your own computer — and he is still doing it in week six.

## What Curtis actually does

**He works as you, not as a service.** There is no account to create and no integration to
authorise. Curtis opens the Chrome that is already on your machine, you log in by hand once — 2FA
and Google SSO both work fine — and from then on he reuses that session. Same browser, same
fingerprint, same home IP as when you browse LinkedIn yourself. Your credentials are never seen,
typed, or stored by anything but you and Chrome.

**He is slow, and the slowness is the product.** One action at a time, forty seconds to three
minutes twenty between actions, a longer break every six to twelve actions, and only inside the
window you configure — Monday to Friday, 9 to 18, by default. A list of two hundred contacts takes
weeks, not an afternoon. That is not a limitation Curtis works around; it is the entire design.
Bursts and 3 a.m. activity are the cheapest signals to detect, and they are also what makes
outreach feel like outreach to the person receiving it.

**He watches the number that matters and brakes himself.** The volume knob is not the interesting
one; the acceptance rate is. When it falls below your threshold, Curtis reduces the daily target
on his own, because a low acceptance rate means the list or the message is wrong, and sending
*more* of a message people ignore is precisely the behaviour that gets accounts restricted. If
LinkedIn shows a captcha or a restriction notice, he stops completely and stays stopped across
restarts until you tell him the situation is resolved.

**He keeps going when you are not there.** Installed as a user service, Curtis runs in the
background, survives you closing your editor, and keeps advancing sequences that are measured in
days. This is the part that is genuinely hard to replicate by hand: not the sending, the
remembering.

**He never takes over your screen.** After the login there is no window. Curtis works in the
background while you use your computer normally — no Chrome popping to the foreground, no cursor
moving on its own, no session you are afraid to touch.

## A month with Curtis

Concretely, on a 350-contact list with the default settings. The ramp sends 12 invitations a day
in week one, 16 in week two, 18 in week three and 20 in week four — 330 over four working weeks,
which is why a list this size is roughly a month of sending.

**Day 1.** You export a list — from a search, a CSV your CRM produced, a conference attendee
sheet — and say *"import ~/prospects.csv and start reaching out; after they accept, write:
`{Hi|Hello} {firstName}, saw you're building at {company} — curious how you're handling X`"*.
Curtis reports what he parsed: 350 rows, 344 valid, 6 with a broken URL, and 2 where the URL was
rebuilt from a bare name and is worth double-checking, plus a preview of the first three contacts
he actually loaded. Install the [`linkedin-outreach`](skills/linkedin-outreach/SKILL.md) playbook
as a skill and the model will also render your message against those three real people before
enrolling anyone, so you can see it reads like something a human wrote. Then he starts.

**Days 1–5, week one.** Twelve invitations a day, scattered irregularly across the working
window. Each contact gets their profile visited a day before the request, because that is what a
person does. No note attached to the invitation — free accounts get only five personalised notes
per *month*, and spending them on invitations is a bad trade when the same personalisation is
free in the first message.

**Day 4.** The first acceptances arrive. Curtis notices them on his next pass and sends the first
message to those people only — a message written for them, with spintax varying the opening so
that three hundred recipients do not receive three hundred byte-identical strings.

**Week two.** Acceptance rate is 49%. The ramp moves to 16 a day. You have not touched anything.

**Week three.** Acceptance drops to 31%. Curtis cuts the daily target without asking, logs why,
and tells you when you next check in: the problem is the targeting or the message, and more
volume would make it worse. You cut the weakest third of the list and rewrite the opener. Three
clean days later he starts climbing back.

**From day 15.** Invitations still pending when the *wait for acceptance* step runs out — 14 days
after the request, with the default sequence — are withdrawn automatically, to keep the pending
backlog from becoming its own risk. Remember you cannot re-invite that person for about three
weeks afterwards.

**Week four.** The last of the list goes out at 20 a day, while the first messages to people who
accepted in week three are still being sent — the two phases overlap for most of the month. You
ask *"how are we doing"* and get real numbers: invitations out, acceptance rate over a rolling
window, the funnel from visit to reply, and any signals LinkedIn has shown.

At no point in that month did you open LinkedIn to do outreach. At no point did Curtis do
anything you would not have done yourself, in an order you would not have chosen. What he
supplied was not speed — it was showing up on day 23.

## Who this is for

Curtis is built for people **whose LinkedIn account is personally theirs and personally
valuable**:

- **Founders and solo sellers** doing their own outreach, in their own name, where twenty good
  conversations beat two thousand invitations and the reply rate is the only metric that pays.
- **People building a network or looking for work** — reaching hiring managers, people in a field
  you are moving into, alumni. Low volume, high personalisation, and an account you cannot afford
  to have restricted, because it is your CV.

What those have in common: a restriction is not an inconvenience to be absorbed by rotating to
another seat. It is your professional identity. Curtis is conservative because the person running
him cannot be reckless.

He is **not** built for agencies running outreach across client accounts at volume, for anyone
who wants five hundred invitations a week, or for running unattended in the cloud. If that is the
job, the honest answer is that a different tool fits it better — and that the risk profile is
different from the one Curtis is designed around.

## What Curtis will not do

The refusals are as much the product as the features:

- **No cloud.** Curtis cannot run without your machine awake. That is a real limitation and it is
  also the reason LinkedIn sees your ordinary browser from your ordinary IP.
- **No note in the invitation** by default. Five per month on a free account is a budget, and it
  belongs in the first message where it costs nothing.
- **No silent limit-raising.** Curtis lowers his own limits on his own; he never raises them on
  his own. Raising one goes through `update_safety_settings`, whose tool description instructs the
  model to state the added risk and ask you first. Being honest about the mechanism: that is a
  prompt-level rule, not a code-level gate — the daemon will accept a raise it is handed. The hard
  bounds that *are* enforced in code are the schema's (`weeklyInviteCeiling` ≤ 700, and so on).
- **No "unlimited" mode.** The weekly ceiling is a hard stop, not a suggestion, and the HALT on a
  captcha or restriction survives restarts by design — clearing it is a deliberate act, not a
  retry.
- **No contact database.** Curtis works on a list you already have and have a legitimate reason
  to contact. He does not scrape one for you.
- **No telemetry.** No analytics, no phone-home: nothing about your contacts or your campaigns
  leaves your computer, and Curtis's own code opens exactly two kinds of connection — LinkedIn,
  and `127.0.0.1/healthz`, which is the CLI asking its own daemon whether it is up. What Curtis
  cannot claim is that *no packet* goes anywhere else: he drives your system Chrome, and Chrome
  keeps doing what Chrome does. Measured on a blank page with no LinkedIn navigation, it reached
  `accounts.google.com`, `android.clients.google.com`, `clients2.google.com`, `www.google.com`
  and `www.gstatic.com` — sign-in state, component updates, Safe Browsing. Those are Google's
  calls, not Curtis's, and they carry none of your data, but "no network call to anything but
  LinkedIn" would have been a false sentence and this one is the true one.
- **No promises about not getting banned.** See the next section, which you should read before
  installing anything.

---

## Read this before installing

> ⚠️ **This section is not boilerplate.** Read it before you install anything.

- **Automating LinkedIn violates its User Agreement** (§8.2 forbids "bots or other automated
  methods to access the Services, add or download contacts, send or redirect messages").
  Penalties range from a temporary restriction to a **permanent ban**.
- **Nobody can guarantee you won't get restricted** — not Curtis, not the paid tools. Low volume
  and human pacing *reduce* the risk. They do not remove it.
- **Be sceptical of the numbers you find online.** "100–200 invites/week", "75/day", "recovery
  under 15%" are figures from automation-vendor blogs with no primary source. **LinkedIn
  publishes no numeric invite limit**, weekly or total-pending, and states it cannot show you how
  much headroom you have left. Do not build your safety margin on them.

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

The ceilings Curtis ships with (`weeklyInviteCeiling`, `caps`, the ramp) are **deliberate
caution**, not known LinkedIn thresholds. The signal worth watching is your **acceptance rate**,
not a number from a blog post.

Use it responsibly, on **your own** account, at your own risk. See [Disclaimer](#disclaimer).

---

## Requirements

| | |
|---|---|
| **Node.js** | ≥ 22.22.2 (required by `mcp-use` v2) |
| **Browser** | Google Chrome (recommended) or Playwright's bundled Chromium |
| **OS** | macOS or Linux. On Windows everything works except service installation |

## Install

```bash
npm install -g "git+https://github.com/matteolegrottaglie/curtis.git"
```

> **Upgrading from LinkedIn Sequencer?** Remove the old package first:
>
> ```bash
> npm uninstall -g linkedin-sequencer-mcp
> ```
>
> The package was renamed, so npm sees two different packages both claiming the `lksq`
> command and aborts the install with `EEXIST: file already exists … bin/lksq`, leaving the
> old version in place. Uninstalling only removes the program; `~/.linkedin-sequencer-mcp`
> — session, contacts, history — is untouched and is picked up again after the install.

Then run the initial setup:

```bash
curtis setup
```

This creates `~/.curtis/`, generates the access token, verifies your browser and prints the next
steps. If you don't have Chrome installed:

```bash
npx playwright install chromium
```

## Connect your MCP client

Start the daemon and ask for the configuration line:

```bash
curtis daemon start && curtis mcp-config
```

**Claude Code**

```bash
claude mcp add --transport http curtis http://127.0.0.1:4311/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

**Codex** — in `~/.codex/config.toml`:

```toml
[mcp_servers.curtis]
url = "http://127.0.0.1:4311/mcp"
bearer_token_env_var = "CURTIS_TOKEN"
```

Codex reads the token from the environment rather than from the file, so it also needs, in your
shell profile:

```bash
export CURTIS_TOKEN="YOUR_TOKEN"
```

`curtis mcp-config` prints all of this already filled in with your token.

> The token lives in `~/.curtis/token` with mode `0600`. Do not share it: whoever holds it can
> send invites and messages as you.

## Usage, from chat

**1. Log into LinkedIn** (once)

> "log into LinkedIn"

A Chrome window opens on the login page. Sign in normally — Google SSO and 2FA both work. This is
the only moment you see the browser: once you are in, the window closes and Curtis works in the
background from then on. He never sees or stores your password, only the browser session, kept
locally. On later runs you are already signed in.

**2. Import your list and start**

> "import ~/Desktop/prospects.csv and start reaching out;
> once they accept, write: 'Hi {firstName}, thanks for connecting!'"

**3. Check in**

> "where are we?" · "how many invites went out this week?" · "what's the acceptance rate?"

**4. Slow down or stop**

> "drop to 8 invites a day" · "pause" · "stop everything"

---

## How it works

### You don't see the browser

Curtis works in the background: no window appearing or moving while you are doing something else.
The one time you see Chrome is the login, because you type the credentials yourself.

This is not plain headless mode, and the difference is worth explaining because the whole design
rests on it:

- it drives **system Chrome**, not an automation Chromium, so the reported WebGL renderer is your
  actual GPU (measured: `ANGLE (Apple, ANGLE Metal Renderer: Apple M1)` in background too, not
  SwiftShader);
- the **User-Agent is cleaned** of the `Headless` marker, in `navigator.userAgent` and in the HTTP
  `User-Agent` header alike. Client hints are *not* rewritten — they cannot be, a Playwright UA
  override does not propagate to them — but they need no rewriting: measured, headless Chrome
  already sends `Sec-CH-UA: "Google Chrome";v="151", "Chromium";v="151"`, identical to the
  windowed one;
- **real display values** (colour depth) are read during login and reused in the background.

Measured across `navigator.webdriver`, plugins, languages, User-Agent, client hints, WebGL
renderer and colour depth, the background browser after first login is identical to the windowed
one. **Window dimensions are the exception**, and honesty is worth more here than a clean claim:
`innerWidth`/`innerHeight` match (1440×900, Playwright's viewport), but `outerWidth`/`outerHeight`
do not — 1440×900 in background against 1420×786 in the window, with `screenX`/`screenY` differing
too. Neither value is what a real Chrome would report: viewport emulation makes the window smaller
than its own viewport when visible, and exactly equal to it when not. That is a residual tell in
both modes, not one that background mode introduces.

If you want to watch anyway, `HEADFUL=true` brings the window back. That is mostly useful when a
selector stops matching and you need to look at the page yourself.

### Keeping campaigns moving with the client closed

Sequences run for days. So they keep advancing after you close Claude Code, install the daemon as
a user service:

```bash
curtis service install
```

On macOS this creates a LaunchAgent, on Linux a systemd user unit. The service also starts the
engine at login, so campaigns proceed on their own — always inside the time window, ramp and
ceilings. `--no-autostart` keeps only the MCP server running.

```bash
curtis service uninstall   # to undo
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

Any other column becomes `{custom.COLUMN_NAME}`, usable in templates. One good `Industry` or
`Event` column is worth more than ten lines of generic copy.

> If a row contains only a *slug* (`jane-doe`) instead of a URL, it is reconstructed into a
> profile URL but flagged in the import result. Check those: a typo in that column would
> otherwise pass silently as a valid profile.

### Message templates

- Placeholders: `{firstName}` `{lastName}` `{fullName}` `{company}` `{headline}` `{location}`
  `{custom.NAME}`
- **Spintax**: `{Hi|Hello|Hey} {firstName}!` picks one variant per contact.

Identical messages sent in bulk are one of the strongest bot signals, and one of the strongest
*ignore me* signals to a human. Use spintax, and give one specific reason you are writing to that
person in particular. If the message works verbatim for anyone, it works for no one.

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
safety core. It is not a static schedule:

| Mechanism | Default behaviour |
|---|---|
| **Warm-up ramp** | Invites/day by week: 12 → 16 → 18 → 20 → 22 → 25 |
| **Weekly ceiling** | Hard limit, never exceeded (100) |
| **Acceptance rate** | Below the threshold (40%) the controller *reduces* invite volume |
| **Backoff** | On a "weekly limit" or warning signal, invites pause and the ceiling drops |
| **HALT** | On captcha or restriction it stops entirely. Survives restarts by design: sort the flag out on LinkedIn first, then clear it explicitly with `engine_control` → `clear_halt` ("the captcha is sorted, clear the halt") |
| **Recovery** | After N clean days (3) the limits climb back gradually |
| **Auto-withdraw** | An invite still pending when its campaign's *wait for acceptance* step expires is withdrawn (14 days by default, `wait_accept_days`). Note: `autoWithdrawAfterDays` in the settings is currently inert — the deadline that actually fires is the step's, not that field |
| **Pending backlog** | No new invite once `maxPendingBacklog` (500) pending ones are outstanding |
| **Daily caps** | Absolute per-action ceilings: 30 invites, 40 messages, 60 visits, 25 follows, 30 likes, 20 withdrawals |

All of it readable and adjustable from chat with `get_safety_settings` /
`update_safety_settings`. Lowering a limit never needs confirmation. Raising one always does.

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

Curtis ships his operating manual to the model through the MCP `instructions` field
([`src/mcp/instructions.ts`](src/mcp/instructions.ts)): operation order, real limits, how to
handle a HALT, and the fact that text scraped from a LinkedIn page is data and never an
instruction. The [`skills/linkedin-outreach`](skills/linkedin-outreach/SKILL.md) playbook adds
what the instructions cannot cover — how to build a list that converts and how to read the
numbers.

## `curtis` CLI

```bash
curtis setup                       # initial configuration
curtis daemon start|stop|status    # background daemon
curtis start                       # daemon in the foreground
curtis logs -f                     # follow the log
curtis login                       # terminal login (with the daemon stopped)
curtis mcp-config                  # config lines for Claude Code and Codex
curtis service install|uninstall|status   # unattended operation
curtis doctor                      # diagnose the installation
curtis version                     # what the issue templates ask for
```

`curtis --help` prints the same list plus the environment variables.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CURTIS_DATA_DIR` | `~/.curtis` | Where database, browser profile, token and logs live |
| `CURTIS_PORT` | `4311` | Daemon port. The host is always `127.0.0.1`, not configurable |
| `TIMEZONE` | `Europe/Rome` | IANA zone for the working-hours window |
| `LOG_LEVEL` | `info` | `trace` · `debug` · `info` · `warn` · `error` · `silent` |
| `BROWSER_CHANNEL` | auto | `chrome` for system Chrome, `chromium` to force Playwright's |
| `HEADFUL` | `false` | `true` keeps the browser window visible |
| `AUTO_CONNECT` | `true` | Reopen the saved LinkedIn session on daemon start |
| `AUTOSTART_ENGINE` | `false` | Start the engine with the daemon (what the service sets) |

Optional values can also go in `<CURTIS_DATA_DIR>/.env` — see [`.env.example`](.env.example).
Environment variables always win over the file.

> **Coming from LinkedIn Sequencer?** Curtis is the same project, renamed. `lksq` still works as
> a command, `LKSQ_*` variables are still read, and an existing `~/.linkedin-sequencer-mcp` keeps
> being used as the data directory — your session, contacts and history carry over with no
> migration. `curtis doctor` tells you which directory is in use. The one manual step is the
> install itself: run `npm uninstall -g linkedin-sequencer-mcp` before installing Curtis, or npm
> refuses to take over the `lksq` command. If you had the daemon running as a service, re-run
> `curtis service install` — it unregisters the pre-rename one on the way.

## Where your data lives

Everything under `~/.curtis/` (or `CURTIS_DATA_DIR`), owner-only (`0700`):

```
sequencer.db       contacts, campaigns, actions, signals, settings
browser-profile/   your LinkedIn session (this is your login: treat it like a password)
token              bearer token for the MCP endpoint (0600)
screenshots/       captured when an action fails
browser-hints.json display values recorded at login, replayed in the background
daemon.log
daemon.pid         pid of the running daemon
terms-accepted     records that you accepted the risk notice in `curtis setup`
.env               your optional settings, if you created one
```

None of it ever leaves your computer.

### Removing Curtis

```bash
curtis service uninstall     # if you installed the service
curtis daemon stop
npm uninstall -g curtis
rm -rf ~/.curtis             # deletes the LinkedIn session, contacts and history
```

The last line is the one that matters: uninstalling the package leaves the data directory in
place, and that directory contains a live LinkedIn session. Log out from chat with
`linkedin_logout` first if you want the session invalidated on LinkedIn's side too, rather than
just deleted locally.

---

## Architecture

```
curtis start
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
  cli.ts               the `curtis` command
  daemon.ts            daemon process
  config.ts            paths, port, token, safety defaults
  mcp/                 MCP server: instructions, zod schemas, tools
  service/             application logic shared by the tools
  safety/controller.ts adaptive rate controller (safety core)
  sequencer/engine.ts  worker loop
  browser/             persistent session, background mode, human behaviour
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

Rewritten after probing the live DOM, and verified in the field with real sends. Two things to
know before touching them:

- **Do not select by role.** The top-card controls are not `<button>`s: "Connect" is an `<a>` with
  `aria-label="Invite <Name> to connect"` and no `role="button"`. The old
  `getByRole('button', { name: /^connect$/ })` returned zero matches — that was the bug.
- **Every selector is anchored to the person's name tokens.** The "More profiles for you" sidebar
  has its own "Connect" buttons; without anchoring you end up inviting someone else. If the name
  can't be derived, Curtis **clicks nothing** and reports the failure.

Two more invariants that look like details and are not: never `click({ force: true })` (it clicks
by coordinates, and with the sticky top-nav overlapping it hits the "Claim Premium Page" banner
and lands you in Premium checkout — this actually happened); and after every click the tool
verifies it hasn't ended up on a Premium/checkout page, stopping if it has.

The `RX` table in [`src/linkedin/selectors.ts`](src/linkedin/selectors.ts) carries English **and**
Italian alternatives, because LinkedIn renders its UI in the account's language. Those Italian
strings are load-bearing: removing them blinds the tool on Italian accounts, silently, with every
test still green.

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

> **Step 4 sends real connection requests** to whoever is in `targets.json`, outside the engine
> and outside its counters. Point it at one profile you are happy to invite.
>
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
CURTIS_DATA_DIR=/tmp/curtis-dev CURTIS_PORT=4399 npm run dev
```

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Selector fixes are the most
valuable kind.

## Security

The MCP endpoint listens on loopback only and is protected by a bearer token, because reaching it
means being able to act on your LinkedIn account. Text scraped from LinkedIn pages is treated as
untrusted data on its way into a model's context. The threat model, the design decisions behind
it and how to report a vulnerability are in [SECURITY.md](SECURITY.md).

## Disclaimer

Curtis is a personal, educational project. Using it violates LinkedIn's Terms of Service and may
get your account restricted or permanently banned. It is provided **as is**, with no warranty of
any kind: the authors accept no liability for any consequence of its use, and anyone who
distributes or runs it assumes full responsibility.

You are also responsible for how you treat other people's data. Only contact people you have a
legitimate reason to contact, honour opt-outs, and remember that under the GDPR the contact list
you import is personal data you are processing.

Low volume, gradual ramp, common sense.

## License

[MIT](LICENSE) © Matteo Legrottaglie
