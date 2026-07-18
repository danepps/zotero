# Feasibility analysis: render-time Bluebook journal abbreviation (alternative to MEDLINE)

> **Status: feasibility study, not slated for implementation.** Companion to
> [`journal-abbreviation-feasibility.md`](./journal-abbreviation-feasibility.md),
> which studies the *library-write* pathway (sweep selected items, persist a
> Bluebook abbreviation into the `journalAbbreviation` field). This document
> studies the **alternative pathway**: compute the Bluebook abbreviation **at
> citation-render time** and substitute it for Zotero's MEDLINE/Index-Medicus
> abbreviation, touching no library data. It closes with a head-to-head
> comparison and a recommendation on which pathway is superior.

## Context / problem (same gap, different seam)

The motivating gap is identical: Zotero's only automatic journal abbreviation is
**MEDLINE/Index Medicus** (*Proc. Natl. Acad. Sci. U. S. A.*), applied at render
time inside the word-processor plugin and controlled by the
`automaticJournalAbbreviations` setting — never Bluebook (*Yale L.J.*,
*Harv. L. Rev.*). The two pathways differ only in **where** the Bluebook form is
produced:

- **Library-write** (the other doc): produce it once, ahead of time, and store
  it in `journalAbbreviation`. Zotero then renders the stored field.
- **Render-time** (this doc): leave the library untouched; produce the Bluebook
  form *during* citation rendering, in place of the MEDLINE form Zotero would
  otherwise emit. This is the natural mirror of how Zotero's own MEDLINE
  abbreviation works — and the natural mirror of how **this very plugin**
  (`bluebook-citations-fixer`) already operates: it rewrites citation output
  inside the integration pipeline rather than mutating items.

The engine that turns *Harvard Law Review* → *Harv. L. Rev.* is **the same pure
string engine** in both pathways. Everything in the other doc's "Abbreviation
engine" section — the T6/T13 word map, the institutions/geographic map, the
notation parser, the institutional-aware spacing pass (Rule 6.1(a)), the
stopword/single-word/first-word rules, the U+2019 apostrophe glyph, the IP
consideration around copying Bluebook table text — carries over **unchanged**.
This document does not re-derive it; it analyzes only the **delivery seam** and
how that seam changes the trade-offs.

## Verdict

**Technically feasible, and a better fit for the stated goal than the
library-write path.** The abbreviation seam is now **confirmed in Zotero source**
(see "Research findings" below): the MEDLINE algorithm *is* a single
monkey-patchable function, `Zotero.Cite.getAbbreviation`. The only remaining
dependency is on the **CSL style**, not on Zotero internals — the Epps Bluebook
style must request the short container-title form, or neither the seam nor the
Document-Preferences checkbox exists. The render-time approach is **non-destructive,
self-healing, and reversible**: it never writes to the library, so the entire
Safety section of the other doc — no batch undo, sync propagation to synced
devices and group collaborators, the overwrite-confirm dialog, the sidecar-stash
revert plan — **simply does not exist here**. New imports are handled
automatically on the next render; an engine bug is corrected by re-rendering, not
by repairing persisted bad data.

**Its real cost is narrower coverage, not risk.** A render-time fix only changes
what the *rendering pipeline* emits. It does nothing for the Journal Abbr. column
in the library pane, for BibTeX/CSL-JSON/RIS exports, or for documents formatted
under a different citation style or a non-RTF output (Google Docs). Whether that
matters depends entirely on the user's workflow (see the comparison).

**Recommended next step is identical to the other doc:** build the Phase-0 spike
engine (`engine.abbreviate(title)`, pure string logic, `vm`-testable, zero
Zotero). That spike de-risks **both** pathways at once, because the engine is
shared. Only after it passes does the seam choice matter — and at that point the
render-time seam is a far smaller, lower-risk piece of plumbing than a new
standalone mutator plugin with its own update JSON, menu, sweep, and safety
machinery.

## Decisions taken (this study)

- **Delivery: substitute at render time, persist nothing.** The full
  `publicationTitle` / CSL `container-title` is the source of truth; the Bluebook
  short form is computed fresh on every render and never stored.
- **Packaging: a feature of the *existing* `bluebook-citations-fixer` plugin,
  not a new sibling.** This pathway *is* render-time citation rewriting — the
  thing this plugin already is. It reuses the bootstrap, the style gate, the
  diag harness, the `vm` test harness, and the build/release flow. No new
  `manifest.json`, no new `update-*.json`, no new auto-update invariant to honor,
  no menu/sweep/undo machinery.
- **Scope: the Epps Bluebook style under RTF output**, exactly like every other
  feature here. Non-RTF sessions (Google Docs HTML) and non-allowed styles pass
  through untouched, per the existing output-format and style gates.

## The seam: two candidates

Zotero feeds journal abbreviations to citeproc through an **abbreviation
provider** — the `sys.getAbbreviation` callback citeproc-js calls when a CSL
style requests `container-title` with `form="short"`. With
`automaticJournalAbbreviations` on and the field empty, that provider returns the
**MEDLINE** form. There are two ways to put Bluebook there instead.

### Seam A — patch the abbreviation provider (recommended)

**Confirmed against Zotero source.** The MEDLINE algorithm is a single function,
`Zotero.Cite.getAbbreviation` (`chrome/content/zotero/xpcom/cite.js:446–608`),
exposed as a property on the `Zotero.Cite` object. citeproc-js calls it as
`sys.getAbbreviation(listname, obj, jurisdiction, category, key)`; for a journal,
`category === "container-title"` and `key` is the full publication title. The
function looks `key` up in `abbreviations.json` and, on a miss, abbreviates the
title **word-by-word** from that bundled word list (this loop *is* the
Index-Medicus output). It returns by mutating the accumulator:
`obj[jurisdiction][category][key] = abbreviation`.

So the patch is concrete: at startup, wrap `Zotero.Cite.getAbbreviation`. When
`category === "container-title"` under an allowed style, compute
`engine.abbreviate(key)` and write it into `obj` exactly as the original does;
otherwise delegate to the saved original (so MEDLINE behaves normally everywhere
else). citeproc then renders **our** string natively — italics, position in the
cite, short-vs-long selection, bibliography vs note — all handled by the CSL
style. **No RTF string surgery at all.**

```js
var orig = Zotero.Cite.getAbbreviation;
Zotero.Cite.getAbbreviation = function (listname, obj, jurisdiction, category, key) {
    var s = Zotero.Integration.currentSession;
    if (category === "container-title" && s && BCF.patch._styleAllowed(s)) {
        var abbr = BCF.abbrev.engine.abbreviate(key);
        if (abbr) {
            if (!obj[jurisdiction]) {
                obj[jurisdiction] = new Zotero.CiteProc.CSL.AbbreviationSegments();
            }
            obj[jurisdiction][category][key] = abbr;
            return;
        }
    }
    return orig.apply(this, arguments);
};
```

Why this is the clean choice:

- **It is literally "an alternative abbreviation system to MEDLINE, rendered at
  insertion time."** Same function Zotero uses; we swap the algorithm.
- **Idempotent by construction.** citeproc always hands the provider the *full*
  title, never a prior output, so there is no "did I already abbreviate this?"
  problem — the defining idempotency hazard of every RTF feature here disappears.
- **Covers citations *and* the Zotero-rendered bibliography** in the same
  document, because both go through citeproc and the same provider.
- **No locating problem.** We never have to find the journal name inside a
  rendered RTF string; citeproc places it.

Two confirmed constraints (neither is a blocker, but both shape the design):

1. **The patch only fires when the MEDLINE checkbox is ON.** `Zotero.Cite.System`
   (`cite.js:617`) wires `this.getAbbreviation = Zotero.Cite.getAbbreviation`
   *only* when `automaticJournalAbbreviations` is true. So the provider — and our
   patch — is consulted **iff** the document's "automatically abbreviate journal
   titles" checkbox is checked. This is a feature, not a bug: **the existing
   checkbox becomes our on/off switch for free** (see "Can it be a checkbox…"
   below). Checked → Bluebook (under our style); unchecked → Zotero falls back to
   the `journalAbbr` field / full title.
2. **The style must request the short form.** Zotero computes
   `style._usesAbbreviation` (`style.js:686`) as the xpath
   `//csl:text[(@variable="container-title" and @form="short") or @variable="container-title-short"]`.
   That single flag governs **both** whether the checkbox is shown *and* whether
   citeproc ever calls `getAbbreviation`. **Action item:** confirm the Epps
   Bluebook CSL contains a `container-title` `form="short"` (or
   `container-title-short`) text node for `article-journal`. If it doesn't, add
   one — this is a one-line style edit and is the true precondition for the whole
   pathway.

One residual gate to handle in code: `getAbbreviation` is also called for case
**reporters** (`legal_case` `container-title` = *U.S.*), so the engine must
recognize and pass through reporter-shaped keys, or the patch must consult item
context. Item type isn't in the call signature, so gate by key shape (the engine
already returns the input unchanged for things it doesn't recognize — the benign
failure mode) or restrict the engine's journal map so a reporter never matches.

### Seam B — RTF post-processing feature (fallback, fits the existing chain)

Add `lib/features/journal-abbrev.js` to the feature chain (registered in
`registry.js`, loaded in `bootstrap.js`), structured exactly like
`journal-volume-year.js`: split the cluster into per-item segments with
`BCF.rtf.segments`, gate each on `BCF.cite.isJournalArticleLike(data)`, and
rewrite the journal-name span.

The precedent already exists: `id-suppress.js:123` reads `data["container-title"]`
and splices it into RTF via `BCF.rtf.findPlainRange` — Seam B is the same move
applied to the journal name.

Hard parts unique to Seam B:

- **Locating the span.** Unlike every current feature, the journal name sits in
  the *middle* of the cite (`Author, Title, 100 <journal> 200 (2020)`), so it
  can't anchor on `$`. It must match the italic container-title group. Workable
  via `findPlainRange` against the known `container-title`, but —
- **Collision with MEDLINE.** If `automaticJournalAbbreviations` is **on**, the
  rendered text is the MEDLINE abbr, not the full title, so a match against the
  full `container-title` fails. Mitigation: require the user to **turn MEDLINE
  auto-abbreviation off** (so the full title renders), then replace full →
  Bluebook. That's a documented setup step, not code — acceptable but a UX wart
  Seam A doesn't have.
- **Idempotency.** On re-render the segment already shows the Bluebook abbr; the
  engine must be a no-op on its own output (or guard with an "already
  abbreviated" check). Seam A sidesteps this entirely.
- **Reporter confusion.** Must gate strictly on `article-journal` so a
  `legal_case` reporter (`container-title` = *U.S.*) is never rewritten.

Seam B is the safe fallback if Seam A's provider turns out not to be cleanly
patchable. The source confirms Seam A *is* cleanly patchable, so Seam B is now a
true contingency rather than an expected path — but it lives entirely within the
proven feature-chain architecture and the existing gates, so it remains cheap
insurance.

## Can it be a checkbox in the Document Preferences dialog?

> Direct answer to the question "could the plugin add a checkbox to the document
> preferences, in the same place where the user selects MEDLINE."

**Yes — but the better move is to *reuse* the checkbox that's already there, not
inject a second one.** What I found in the dialog source:

- The dialog is `chrome/content/zotero/integration/integrationDocPrefs.xhtml`,
  root element id **`integration-doc-prefs`**. The MEDLINE control is a **native
  XUL checkbox** (`native="true"`) with id **`automaticJournalAbbreviations`**,
  inside container **`automaticJournalAbbreviations-container`**. Its checked
  state is read/written through `_io.automaticJournalAbbreviations`
  (`bibliography.js:202`) and persisted **per-document** into
  `data.prefs.automaticJournalAbbreviations` by the integration controller.
- Crucially, that one persisted bit already gates rendering (constraint 1 under
  Seam A). So if we patch `getAbbreviation`, **the existing checkbox is exactly
  the toggle the user pictured** — "checked" now means *Bluebook* under our
  style, "unchecked" means the `journalAbbr` field / full title. No injection, no
  new persistence, and Zotero stores the choice in the document for us.

That yields two designs:

**Design 1 — reuse the existing checkbox (recommended).** Patch `getAbbreviation`
only. The user ticks the same box they already use for MEDLINE; under the Epps
style it produces Bluebook. *Optional cosmetic touch:* inject **only a label /
description tweak** into `automaticJournalAbbreviations-container` (via the same
window-watcher idiom `lib/dialog.js` already uses, matching `documentElement.id
=== "integration-doc-prefs"`) so the row reads "Bluebook abbreviations" instead
of "Index Medicus (MEDLINE)" when our plugin + an allowed style are active. This
changes display text only — **no value to persist**, so it sidesteps the entire
persistence problem. Injecting into this dialog is in fact *easier* than the
React citation dialog the plugin already handles, because the checkbox here is a
plain native XUL control.

**Design 2 — a genuinely separate "Use Bluebook (not MEDLINE)" checkbox.**
Injectable in the same spot, but now you need a per-document home for its state,
and **that's the real work**: the dialog persists only the known
`data.prefs.*` keys through its accept path, which a plugin can't cleanly extend,
and the prefs blob is serialized into the document under a fixed schema (an extra
key may not round-trip). Options, none free:
  - *Drive the native checkbox from ours* — our control is pure UI that sets
    `automaticJournalAbbreviations` before accept; Zotero still persists the bit.
    (This collapses back into Design 1 with extra chrome.)
  - *Hook the dialog accept to stash a key in `data.prefs`* — needs round-trip
    testing against Zotero's serializer; fragile across versions.
  - *Store in a per-profile pref* (`extensions.bluebook-citations-fixer.*`) — easy
    and robust, but loses per-document granularity. Acceptable for a
    single-author Bluebook workflow; wrong if the user mixes Bluebook and
    non-Bluebook documents on one machine.

**Recommendation:** Design 1. Patch the provider, let the existing checkbox be
the switch, and (optionally) relabel the row cosmetically. It gives the user the
exact UX they described — a toggle in the Document Preferences dialog, right where
MEDLINE lives — with zero persistence hack and zero new failure modes. Reach for
Design 2 only if the requirement is to offer MEDLINE *and* Bluebook side-by-side
in the same document set, which the Epps single-style workflow doesn't need.

## Research findings (Zotero source, verified June 2026)

Traced against `zotero/zotero@main`:

- **`Zotero.Cite.getAbbreviation`** (`xpcom/cite.js:446–608`) — the MEDLINE
  provider; a property on `Zotero.Cite`, called by citeproc as
  `getAbbreviation(listname, obj, jurisdiction, category, key)`. Word-by-word
  abbreviation from `resource://zotero/schema/abbreviations.json`. **Seam A
  target.**
- **`Zotero.Cite.System`** (`xpcom/cite.js:617`) — assigns
  `this.getAbbreviation = Zotero.Cite.getAbbreviation` **only** when
  `automaticJournalAbbreviations` is true. The render-time gate.
- **`Zotero.Style._usesAbbreviation`** (`xpcom/style.js:686`) — xpath
  `//csl:text[(@variable="container-title" and @form="short") or @variable="container-title-short"]`.
  Governs both checkbox visibility and whether `getAbbreviation` is ever called.
  **Precondition: the Epps CSL must satisfy this.**
- **Document Preferences dialog** — `integration/integrationDocPrefs.xhtml`, root
  `integration-doc-prefs`; checkbox `automaticJournalAbbreviations`
  (`native="true"`) in `automaticJournalAbbreviations-container`. No
  `integrationDocPrefs.js`; logic lives in `bibliography.js` (loaded by the
  dialog) and the `style-configurator` element. The MEDLINE checkbox is shown
  only for styles where `usesAbbreviation` is true ("Use MEDLINE journal
  abbreviations … will only appear when you select a style that uses journal
  abbreviations" — Zotero KB).
- **Persistence** — checkbox ⇄ `_io.automaticJournalAbbreviations`
  (`bibliography.js:202`) ⇄ `data.prefs.automaticJournalAbbreviations`
  (`xpcom/integration.js`), stored in the document's field data.

Sources: [Zotero KB — Journal Abbreviations](https://www.zotero.org/support/kb/journal_abbreviations),
[zotero/zotero `cite.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/cite.js),
[`style.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/style.js),
[`integrationDocPrefs.xhtml`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/integration/integrationDocPrefs.xhtml).

## Proposed architecture (no new plugin)

```
bluebook-citations-fixer/
└── lib/
    ├── abbrev/                 # SHARED engine — identical to the other doc
    │   ├── table.js            #   exceptions table (JAMA/NEJM/PNAS/Calif.)
    │   ├── words-t6.js         #   T6/T13 word map (~250, user-supplied)
    │   ├── institutions.js     #   institutional/geographic map + flags
    │   └── engine.js           #   engine.abbreviate(title) — pure string logic
    ├── patch.js                # Seam A: also patch the abbreviation provider
    └── features/
        └── journal-abbrev.js   # Seam B only: RTF-chain fallback feature
```

The `abbrev/` tree is **byte-for-byte the engine the library-write doc
specifies.** The only render-time-specific code is the provider patch in
`patch.js` (Seam A) or the one feature file (Seam B). Everything else — style
gate, output-format gate, diag, `run` context, build/release — already exists.

### Engine integration points
- Source title: the CSL item data already in hand at render time —
  `data["container-title"]` from the parsed `CSL_CITATION` (Seam B) or the string
  citeproc passes the provider (Seam A). Same field the other doc reads from
  `item.getField("publicationTitle")`, just upstream.
- Output glyphs: emit the U+2019 apostrophe forms (*Pol'y*, *Int'l*) consistent
  with `BCF.cite.normalizeTitleMarkup`, as the other doc notes.
- Gating: reuse `BCF.patch._styleAllowed(session)` and the RTF output gate
  verbatim — no new gate logic.

### Verification (when/if built)
- **Unit:** extend `tests/run-node-tests.js` with the shared `engine.abbreviate()`
  fixture table (the other doc's unit plan, unchanged). Seam B adds RTF-splice
  fixtures (`container-title` in a rendered cluster → abbreviated, reporter
  untouched, idempotent re-run). Seam A's provider swap is mostly engine tests
  plus one integration check.
- **Integration (manual):** side-load, insert journal cites under the Epps style
  in Word/LibreOffice, confirm the Bluebook abbr renders, the bibliography
  matches, a Refresh is stable, MEDLINE is fully displaced, and non-allowed
  styles / Google Docs pass through. **No library backup needed** — nothing is
  written.

## Head-to-head: render-time vs library-write

| Dimension | Render-time (this doc) | Library-write (other doc) |
|---|---|---|
| **Touches library data** | No — pure rendering | Yes — mutates `journalAbbreviation` |
| **Reversibility** | Uninstall / disable; nothing to undo | No batch undo; needs sidecar-stash plan |
| **Sync / group-collab risk** | None | Propagates to synced devices & collaborators |
| **New imports** | Self-healing — abbreviated on next render | Must re-run the sweep |
| **Failure mode of a bad abbr** | Transient — fix engine, re-render | Persisted bad *data* until repaired |
| **Idempotency** | Free (Seam A) / guarded (Seam B) | Compare-before-write |
| **Where the fix shows up** | Only the rendering pipeline (cites + Zotero biblio) under an allowed style + RTF | Everywhere: every style, library pane, exports, other tools, sync |
| **Other citation styles** | No (style-gated) | Yes (it's just data) |
| **Non-RTF output (Google Docs)** | No (output-format gated) | Yes |
| **BibTeX/RIS/CSL-JSON export** | No | Yes |
| **Engine** | Shared, identical | Shared, identical |
| **Plumbing cost** | Low — one seam in an existing plugin | Medium — new plugin, update JSON, menu, sweep, prefs, safety/undo |
| **IP exposure (table text)** | Same for both | Same for both |
| **Net risk** | Low (one seam to verify) | Higher (destructive writes dominate the design) |

### Reading the table

The split is clean: **render-time wins on safety and lifecycle; library-write
wins on coverage and portability.** They are not really competitors so much as
two halves — render-time makes the *document you're writing now* correct without
risk; library-write makes the *data correct everywhere* at the cost of a
destructive, irreversible, sync-propagating write with no batch undo.

## Which is superior?

**For the goal as stated — "an alternative abbreviation system to MEDLINE
rendered at time of citation insertion" — the render-time pathway (Seam A) is
superior**, and by a clear margin:

1. **It is the literal description of the request.** Seam A swaps the algorithm
   at the exact point Zotero produces MEDLINE. The library-write path is a
   different thing (a data fixer) that happens to also yield correct citations.
2. **It deletes the hardest part of the other design.** The library-write doc's
   single largest section is Safety — no undo, sync propagation, overwrite
   confirm dialogs, sidecar revert. Render-time makes that section *empty*. The
   motivating case (JSTOR/Hein wrote a *wrong* abbr) needed the **overwrite**
   path — exactly the destructive path the other doc flags as needing more than
   the default safety story. Render-time overwrites the rendered MEDLINE form
   freely and harmlessly, because it overwrites *output*, not *data*.
3. **It is self-healing.** Every future import is correct on next render with no
   action. The sweep has to be re-run forever.
4. **It is a smaller build.** One seam inside a plugin that already does exactly
   this, versus a new standalone plugin carrying its own auto-update invariant
   (a missing update JSON makes Zotero delete the plugin — a standing liability
   the render-time path never takes on).
5. **The shared engine means no capability is sacrificed.** The correctness risk
   (the engine) is identical and is de-risked once, for both, in Phase 0.

**When library-write is the better choice instead:** if the user's real need is
*portable correct data* — they format under multiple citation styles, rely on
the library pane's Journal Abbr. column, export to BibTeX/RIS for other tools, or
publish to Google Docs (non-RTF) — then only the persisted field reaches those
surfaces, and render-time can't help. For a single-style, Word/LibreOffice,
Bluebook-only workflow (the workflow this whole repo targets), that caveat is
mostly moot.

**Recommendation:** treat render-time as the **primary** pathway and build it
first. Concretely:

1. **Phase 0 — shared engine spike.** Build `engine.abbreviate()` + the `vm`
   fixture table. This is the real feasibility gate and is common to both paths;
   do it before choosing anything else.
2. **Phase 0.5 — style precondition (the one real check left).** The Zotero seam
   is already confirmed (`Zotero.Cite.getAbbreviation`); the open item is the
   **CSL**. Verify the Epps Bluebook style has a `container-title` `form="short"`
   (or `container-title-short`) text node for `article-journal`; if not, add one
   (one-line edit). This is what makes both the Document-Preferences checkbox
   appear and `getAbbreviation` fire. Then build **Seam A** (patch
   `getAbbreviation`, reuse the existing checkbox per Design 1). Keep **Seam B**
   as contingency only. Either way it's one seam plus the shared engine, inside
   the existing plugin.
3. **Library-write stays an optional later companion** — worth it only if/when a
   user needs correct data *outside* the rendering pipeline (exports, other
   styles, the library pane). Because the engine is shared, that companion is
   "wrap the existing engine in a scoped sweep + the safety machinery," not a
   from-scratch effort.

## Open questions to resolve before building

**Blockers (decide first):**
- **Engine licensing + Bluebook edition** — identical to the other doc (Indigo
  Book / CC0 basis; 20th vs 21st T6 merge). Gates the shared engine, hence both
  paths.
- **Epps CSL requests the short form** — the *only* render-time-specific blocker
  left (Seam A patchability is **confirmed**: `Zotero.Cite.getAbbreviation`). The
  style must contain a `container-title` `form="short"` / `container-title-short`
  node, or neither the seam nor the checkbox engages. Verify in Phase 0.5; it's a
  one-line style edit if missing. Seam B remains the fallback if for some reason
  the provider can't be patched in a future Zotero.

**Deferrable:**
- Should `magazineArticle` / `newspaperArticle` (`article-magazine` /
  `article-newspaper`, also `container-title`-bearing) be in scope? The render
  gate makes this a one-line predicate change.
- Provide a pref to also *suppress* MEDLINE when our engine returns no
  abbreviation (fall back to full title vs. let MEDLINE through)?
