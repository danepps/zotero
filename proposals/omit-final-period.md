# Proposal: "Omit final period" checkbox (trailing-period suppression)

**Status:** designed, not implemented
**Plugin:** `bluebook-citations-fixer`
**Drafted:** 2026-06-10

## Context

Footnote cites under a Bluebook style normally end with a period. The current Epps style
(`BluebookDSEStyle.csl`) has citation `<layout suffix="" delimiter="; ">` — **no period in the
field text**; the user types it manually outside the field. A **future style variant will add
`suffix="."`**, and we want a per-cite checkbox in the citation dialog (like the existing
"Break id." box) to suppress that style-emitted period when a footnote continues after the cite.

**Critical ripple discovered during exploration:** under a period-emitting style, the existing
features silently break even when nothing is flagged — `journal-volume-year`
(`/\s\(\d{4}\)\s*$/`, `lib/features/journal-volume-year.js:56`), `book-at` (tail regex
`(?:\s*\([^)]*\))*\s*$`), and `hereinafter`'s segment-end/suffix-anchored insertion all anchor on
end-of-text and don't tolerate a trailing `.`. The design must fix both at once.

## Architecture: hold/restore wrapper around the feature chain

A new `lib/period.js`, called from both patch.js paths (not a registry feature):

1. **Before the chain** (`begin`): if the cluster's plain projection ends with `.` — and the
   period isn't owned by `Id.`/`ibid.` or by a user-typed suffix — strip it from the RTF and
   remember it was held. Also compute `suppress` = any `citationItems[i].prefix` carries the new
   sentinel.
2. **Run the chain unchanged** — every feature sees the historical un-perioded tail; no changes
   to journal-volume-year / book-at / hereinafter. Hereinafter's bracket correctly lands before
   the restored period.
3. **After the chain** (`finish`): re-append the held `.` unless `suppress`; **always** strip the
   sentinel (raw char + RTF escape forms) so it never reaches the document.

Why not a first+last registry-feature pair: the repo doctrine is "append new features to
`registry.list`" (CLAUDE.md) — anything appended after a restore-feature would see the
re-appended period and break; per-feature try/catch could also let a successful hold be followed
by a failed restore, eating the document's period. A patch.js-level wrapper fails closed to
pass-through. Under the current no-period style everything is a byte-identical no-op, preserving
today's behavior exactly. Idempotency: flagged, already-stripped text holds nothing → appends
nothing → stable on refresh.

## New sentinel

`BCF.NOPERIOD_CP = 0x200C` (ZERO WIDTH NON-JOINER), `BCF.NOPERIOD_SENTINEL` — same criteria as
NOID's U+200B: invisible, category Cf (survives trims), round-trips the field code. No regex
collision: `stripNoId`'s patterns target literal decimal `8203` with `\b`, so each strip
preserves the other sentinel; both can coexist at the prefix head in any order.

## Files to change

1. **`lib/cite.js`** (next to the NOID block, ~lines 164–196): generalize into
   `BCF.cite.hasSentinel(str, sentinel)` / `stripSentinelCp(rtf, cp)`; keep `hasNoId`/`stripNoId`
   as thin wrappers (existing tests must pass verbatim); add `NOPERIOD_*` constants +
   `hasNoPeriod`/`stripNoPeriod`.

2. **`lib/period.js`** (new): `BCF.period.begin(citOrJson, rtfText) -> {text, held, suppress}` and
   `BCF.period.finish(rtfText, state) -> string`; both never throw (try/catch → pass-through +
   `BCF.diag.err`). Internals: `TAIL_PERIOD_RE = /\.\s*$/`, `ID_TAIL_RE = /\b(?:ibid|id)\.\s*$/i`
   guard, `_suffixOwnsTail(items, plain)` guard, `_stripTail` via
   `BCF.rtf.findPlainRange` + slice + `BCF.rtf.repairGroups` (handles a period inside an
   italic/scaps group; same pattern book-at ships at `lib/features/book-at.js:126-139`).
   `finish` re-appends `.` as plain text outside groups (roman, matching citeproc's own layout
   suffix) with a double-period guard.

3. **`lib/patch.js`** — two surgical insertions inside the already-gated regions:
   - `_rewriteCitationText` (397–422): `var pst = BCF.period.begin(citation, text)` before the
     ctx build; seed `ctx.text` with `pst.text`; `return BCF.period.finish(ctx.text, pst)`.
   - `patch.run` (426–504): after `run` is obtained (474–478), `begin(codeJson, text)`; seed
     ctx; wrap the return at 502–503 with `finish`.
   - The `__bcfPrewriteActive` short-circuit (439) returns before any period work — correct:
     the prewrite pass already did hold/restore on that cluster. Delayed citations take the
     full `patch.run` path. The prewrite write-back check `rewritten !== text` (382) means an
     unflagged round trip writes nothing back.

4. **`lib/dialog.js`** — table-driven two-checkbox refactor:
   - Replace the `CHECKBOX_ID`/`ROW_ID`/`LABEL`/`TITLE` constants (24–28) with a
     `BCF.dialog.CONTROLS` table: `{rowId, boxId, labelParts, title, sentinel(), has(v), strip(v)}`
     — one entry for Break id. (existing values), one for the new box. Label: **"Omit final
     period"** (parallels Zotero's "Omit Author"); tooltip: "Drop the period this citation style
     adds at the end of the citation (for footnotes that continue after the cite)."
   - `_tryInject` (87–107): loop the table with a moving anchor row so re-injection passes keep
     row order (Break id. row, then Omit final period row, after Omit Author). Per-control
     `_align`/`_sync`; per-box `activeElement` skip.
   - `_inject` (115–166): parameterize on `(doc, omitBox, control, anchorRow)`; build label from
     `labelParts` (text vs `<i>`). All proven React/XHTML plumbing (`createElementNS`,
     click-derived toggle, `_setReactValue`) shared unchanged.
   - `_findOmitAuthor` self-skip (178): check membership in the set of all control boxIds.
   - `_toggle` (190–205) and `_sync` (244–246): parameterize on `control`; `strip` removes only
     its own sentinel so toggling either box preserves the other flag.

5. **`bootstrap.js`**: `load("lib/period.js")` after `lib/diag.js`, before `lib/patch.js`
   (depends on `BCF.rtf` + `BCF.cite` only).

6. **`lib/features/registry.js`**: no list change; extend the ordering comment — patch.js holds
   a style-emitted cluster-final "." before the chain and restores it after, so `$`-anchored
   tail regexes stay valid and new features need no period handling.

## Edge-case decisions

| Case | Decision |
|---|---|
| Bare `Id.` / `See id.` / `Ibid.` tail | `ID_TAIL_RE` guard — never held (citeproc collapses the style period into the abbreviation's; stripping would yield "Id"). Suppression is a no-op there. |
| NOID-flagged `Id. at 678.` | Tail `8.` held normally; id-suppress rewrites mid-chain; period restored after the short form. Composes. |
| NOID-flagged **bare** `Id.` under period style | Guard skips the hold → the id-suppress rewrite ends without the cluster period. Accepted, documented limitation, pinned by a test. |
| Multi-cite clusters | Hold/restore wraps the whole cluster outside segmentation; flag honored if **any** item carries the sentinel (popup is per-item, period is cluster-final). |
| User suffix ending in `.` (e.g. `(discussing X.)`) | `_suffixOwnsTail` guard: period treated as user-owned, not held — keeps hereinafter's suffix-anchored placement matching. |
| Sentinel rendered into RTF (`\uc0舄{}` at segment head) | `finish` always strips all forms even when nothing else changed. |
| Abbreviation tails generally (e.g. `…Harv. L. Rev.`) | Unflagged: hold+restore is a verbatim round trip — harmless. Flagged: the period is removed, which is what the user asked for. Documented. |

## Tests (`tests/run-node-tests.js`)

Add `load("lib/period.js")` after `lib/cite.js`; define `NOPD`/`NOPD_RTF` fixtures next to the
NOID ones (~981–984). Cases:

- **Unit:** hold/restore round trip (`"…55 (2024)."`); no-period input no-op; guards
  (`See id.`, `{\i{}Id.}`, `Ibid.`, suffix-owned tail); period inside a format group
  (`…{\i{}Title.}` → balanced strip, restore outside the group); sentinel helpers incl. both
  sentinels coexisting and stripping one preserving the other; existing `stripNoId` assertions
  unchanged.
- **Integration** (via `runPatch` / `_prepareCitationTexts`, patterns at ~1388–1533):
  journal-volume-year still fires on `"…2024 Yale L.J. 55 (2024)."` → `"…55."`;
  book-at on `"…1868 45 (2006)."` → `"…1868, at 45 (2006)."`;
  hereinafter bracket lands before the restored period;
  flagged suppression (`"…55 (2024)."` → `"…55"`, sentinel gone) in both paths;
  flagged under the current no-period style (silent no-op, sentinel still stripped);
  multi-cite cluster with the flag on one item; NOID + NOPERIOD coexisting on one cite;
  bare-`Id.` pinning test; idempotency (feed outputs back through); prewrite/setText parity
  with a perioded input (extend the `__bcfPrewriteActive` test).

Run with `node bluebook-citations-fixer/tests/run-node-tests.js`.

## Docs (same commit, per repo policy)

- **CLAUDE.md + AGENTS.md** (mirrored edits): add `period.js` to the file-layout tree; a
  "trailing-period hold/restore" paragraph in the feature-contract section (features may assume
  the un-perioded tail); extend the dialog-surface section (second checkbox, table-driven
  CONTROLS, U+200C sentinel); add the bare-`Id.`/abbreviation-tail limitations.
- **`bluebook-citations-fixer/README.md`**: new feature bullet — "Omit final period" checkbox;
  only does anything under a style variant that appends a cluster-final period; flag any cite in
  a multi-cite cluster; `Id.` clusters exempt.
- No prefs changes. Dev builds use a fourth version component (`1.2.x.N`) via
  `./bluebook-citations-fixer/build.sh`; no release work in this proposal.

## Verification

1. `node bluebook-citations-fixer/tests/run-node-tests.js` — all existing + new tests pass.
2. Side-load build: `./bluebook-citations-fixer/build.sh 1.2.0.N`, install in Zotero, enable the
   `…diag` pref. In a doc using the period-emitting style variant: insert cites, confirm the
   trailing period renders; tick "Omit final period" on one cite, Refresh, confirm the period is
   gone and the diag shows the hold/suppress events; untick, Refresh, period returns.
3. In a doc using the **current** style: confirm byte-identical behavior (no new periods, no
   regressions in the four existing features).

## Risks

- **citeproc period-collapse on abbreviation tails** — structurally harmless when unflagged
  (verbatim round trip); only flagged abbreviation tails lose the period. Documented.
- **React dialog fragility** — zero new plumbing; the second checkbox reuses the proven
  machinery via the table, so a Zotero dialog change breaks both boxes identically (one fix).
  Documented fallback (menu-item/keystroke writing the sentinel) applies to this sentinel too.
- **RTF tail splice** — confined to `_stripTail`, using the same `findPlainRange` +
  `repairGroups` pattern book-at already ships, with dedicated unit tests.
