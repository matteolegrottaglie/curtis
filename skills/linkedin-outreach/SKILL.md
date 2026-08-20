---
name: linkedin-outreach
description: Playbook for using the Curtis server — preparing the contact list, writing the messages, reading the right numbers, and repairing selectors when LinkedIn changes the DOM. Use it when the user wants to send connection requests or messages on LinkedIn with this tool.
---

# LinkedIn outreach with Curtis

The MCP server already carries its own manual in its `instructions` (operation order, limits,
handling a HALT). This skill covers what those instructions cannot say: how to prepare a campaign
that actually works, and how to read the result.

## Preparing the list

Before importing, look at the CSV. Only the profile-URL column is required, but the quality of
the others decides the quality of the messages:

- A `first_name` separate from `last_name` makes `{firstName}` reliable. With only `full_name`
  the tool takes the first word: on "Dr. Mark White" that becomes "Dr.".
- Every extra column becomes `{custom.COLUMN_NAME}`. One `Industry` or `Event` column is worth
  more than ten lines of generic copy.
- After `import_contacts`, check `rows_invalid` and `rows_url_inferred`. "Inferred" rows carried
  only a slug: if there are many, the wrong column almost always ended up in the URL field.

Always show the user a preview before enrolling contacts into a campaign.

## Writing the first message

It goes in the step *after* acceptance, never in the invite note (free accounts get 5 notes per
month).

Rules that move the acceptance rate more than any setting:

- **Spintax is mandatory** on the opening: `{Hi|Hello|Hey} {firstName}`. Identical messages sent
  in bulk are one of the strongest bot signals.
- **One specific reason** for writing to this person in particular: `{company}`, `{headline}`, or
  a custom column. If the message works verbatim for anyone, it works for no one.
- **No pitch in the first message.** Its goal is a reply, not a call.
- Stay under 400 characters.

Before launching, show the user the message rendered against 2–3 real contacts from their list,
not an invented example.

## Reading the numbers

In `get_metrics`, the only number that really matters is the **acceptance rate**:

| What you see | What it means | What to do |
|---|---|---|
| > 60% | targeting is right | volume can grow, gradually |
| 40–60% | normal | change nothing |
| < 40% | the list or the message is the problem | the controller brakes on its own: don't fight it, fix the targeting |
| entries in `signals_7d` | LinkedIn noticed something | lower the volume, don't raise it |

If the user asks for more volume while the acceptance rate is low, say so plainly: raising invite
volume on a low acceptance rate is exactly the behaviour that leads to a restriction, because the
share of ignored invites is one of the three triggers LinkedIn states explicitly.

## When selectors break

Symptom: `get_recent_actions` shows `connect / failed` with "no Invite … to connect" on **every**
contact. On a single contact it's normal — already connected, or out of network.

The repair loop, from the project directory:

```bash
npx tsx scripts/probe-targets.ts targets.json      # look at the real DOM
# fix src/linkedin/selectors.ts
npm run test:selectors                             # regressions on a synthetic DOM
npx tsx scripts/connect-no-note.ts targets.json 0  # one isolated real send
```

Two invariants never to break while fixing selectors:

1. **Anchor to the name.** Every control must be found by an `aria-label` containing the target
   person's name tokens. The "More profiles for you" sidebar has its own "Connect" buttons —
   without anchoring you invite a stranger. If the name can't be derived, click nothing.
2. **Never `click({ force: true })`.** It clicks by coordinates and, with the sticky top-nav
   overlapping, hits the "Claim Premium Page" banner and lands in Premium checkout.

## What not to do

- Don't promise the user their account won't be restricted.
- Don't quote volumes from vendor blogs ("100 invites a week"): LinkedIn publishes no numeric
  limits.
- Don't clear a HALT before the user has actually resolved the flag on LinkedIn.
- Don't start campaigns on lists the user has no legitimate reason to contact.
