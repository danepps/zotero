# Feasibility analysis: user-configurable "et al." thresholds (overriding the installed style)

> **Status: feasibility study, not slated for implementation.** Third entry in
> the research series alongside
> [`journal-abbreviation-feasibility.md`](./journal-abbreviation-feasibility.md)
> and
> [`journal-abbreviation-render-time-feasibility.md`](./journal-abbreviation-render-time-feasibility.md).
> This document evaluates letting the user change the **"et al." thresholds** —
> CSL's `et-al-min` (author count at which the list truncates) and
> `et-al-use-first` (how many names survive truncation) — from the
> `bluebook-citations-fixer` Settings pane, **overriding whatever the installed
> CSL style hardcodes**.

## Context / problem

The et-al thresholds are baked into the Epps Bluebook style's XML. Changing
them today means editing the style, re-installing it, and keeping a fork in
sync — for what is genuinely a *preference*, not a correctness question:
Bluebook Rule 15.1 permits **either** "first author *et al.*" **or** listing
all authors for works with three or more authors ("may include all"). A writer
who wants full author lists (common in student notes and when crediting
co-authors matters) has no knob; neither Zotero nor citeproc exposes one. The
feature under evaluation is a per-machine plugin pref that overrides the
style's thresholds at render time, so the installed style stays untouched.

## Verdict

**Technically feasible, with one clean seam — but it is a different *kind* of
patch than everything the plugin does today.** All five methods
`lib/patch.js` currently wraps (`Field.setText`, `Session._updateDocument`,
and the diagnostics wrappers) run **after** citeproc has already applied the
style's truncation; there is no pre-render seam in the plugin. Post-render RTF
surgery is the wrong tool here: *truncating* a rendered author list is
possible, but *expanding* one means re-synthesizing citeproc's name formatting
(initials, delimiters, small caps for books, disambiguation expansions) from
`itemData.author` — fragile, and unlike every existing feature there is no
stable tail anchor to splice against.

The clean seam is upstream, in Zotero core (verified against
`zotero/zotero@main`, July 2026): `Zotero.Style.prototype.getCiteProc` parses
`this.getXML()` fresh and hands the XML string to the engine constructor —
for **both** citeproc-js and the experimental citeproc-rs. Rewriting the
`et-al-min` / `et-al-use-first` attributes in that XML *before* the engine is
built makes citeproc render the desired author lists natively: no RTF surgery,
idempotent by construction, correct in citations and bibliography alike, and
robust regardless of *where* in the style the attributes live. This is the
same shape as the journal-abbreviation study's "Seam A" — swap the input at
the point Zotero produces it, and let citeproc do the rendering.

**The honest hard part is not the rewrite but propagation.** `getCiteProc`
caches built engines per style keyed only on
`{locale, automaticJournalAbbreviations}`, and an integration session keeps
its engine until the style ID changes or a reset is forced — so a pref change
must actively purge the engine cache and invalidate live sessions, or the user
sees stale thresholds until restart. That, plus deciding whether the same pref
should drive the plugin's own hand-built short-form author prefixes
(`hereinafter._authorPrefix`), is where the design effort goes.

## Decisions taken (this study)

- **Override at engine-construction time, persist nothing.** The installed
  style is the source of truth for everything else; only the four et-al name
  options are candidates for rewrite, and only when the user has switched the
  override on.
- **Packaging: a feature of the existing `bluebook-citations-fixer` plugin.**
  Reuses the bootstrap, the style-gate ID lists, the prefs pane, the diag
  harness, and the `vm` test harness. No new plugin, no new update JSON.
- **Scope: the allowed styles only** (`BCF.patch.BUILTIN_STYLE_IDS` + the
  `styleID` extras pref), gated by **style ID string**, not by session — see
  "Scope of the gate" below for why this seam necessarily reaches beyond the
  integration pipeline.

## The seam: four candidates

### Seam A — pre-parse CSL rewrite at `getCiteProc` (recommended)

**Confirmed against Zotero source.** The relevant chain:

- `Zotero.Integration.Session.prototype.setData` (`xpcom/integration.js`)
  builds the session engine via
  `getStyle.getCiteProc(data.style.locale, this.outputFormat, { automaticJournalAbbreviations })`,
  and rebuilds only when the style ID changes, `resetStyle` is passed, or no
  prior engine exists.
- `Zotero.Style.prototype.getCiteProc(locale, format, options)`
  (`xpcom/style.js`) obtains the CSL as a string via **`this.getXML()`**,
  parses it (`new DOMParser().parseFromString(this.getXML(), "text/xml")`),
  and constructs `new Zotero.CiteProc.CSL.Engine(sys, xml, locale,
  overrideLocale)` — or `Zotero.CiteprocRs.Engine` when the
  `cite.useCiteprocRs` pref is on. Built engines are cached in
  `this._cachedEngines`, keyed on
  `JSON.stringify({ locale, automaticJournalAbbreviations })`.

So the patch is concrete: at startup, wrap
`Zotero.Style.prototype.getCiteProc`. When the override is enabled **and**
`this.styleID` is in the allowed set, temporarily swap `this.getXML` (in a
`try/finally`) for a version that returns the rewritten XML, then delegate to
the original:

```js
var orig = Zotero.Style.prototype.getCiteProc;
Zotero.Style.prototype.getCiteProc = function (locale, format, options) {
    var opts = BCF.etal.options();
    if (opts.enabled && BCF.patch._styleIDAllowed(this.styleID)) {
        var origGetXML = this.getXML;
        this.getXML = function () {
            return BCF.etal.rewriteXML(origGetXML.call(this), opts);
        };
        try {
            return orig.apply(this, arguments);
        } finally {
            this.getXML = origGetXML;
        }
    }
    return orig.apply(this, arguments);
};
```

`BCF.etal.rewriteXML(xml, opts)` is a pure string function (hence
`vm`-testable in the node harness):

1. Replace the value of every existing `et-al-min="…"` and
   `et-al-use-first="…"` attribute with the configured values (handle both
   quote styles).
2. If an attribute appears nowhere in the style, inject it as a global name
   option on the `<citation>` (and `<bibliography>`, if present) opening tag —
   CSL inheritable name options are legal there and flow down to every
   `<names>`/`<name>` element.
3. Leave `et-al-subsequent-min` / `et-al-subsequent-use-first` untouched
   (deferrable — see Open questions).

Why this is the clean choice:

- **Placement-agnostic.** CSL allows the et-al options on `<style>`,
  `<citation>`, `<bibliography>`, `<names>`, and `<name>`. In citeproc-js,
  root/citation/bibliography-level values land in the area's
  `opt.inheritedAttributes`, but values set on `<names>`/`<name>` elements are
  stored per-token in `token.strings` and win at render time — so *where* the
  Epps style sets them determines whether any post-build mutation would even
  work. A pre-parse rewrite doesn't care.
- **Engine-agnostic.** citeproc-js and citeproc-rs consume the same XML
  string; the rewrite covers both, including any future engine swap.
- **citeproc renders natively.** Delimiters, the "et al." term (including any
  `<et-al>` formatting the style declares), disambiguation, small caps,
  bibliography-vs-citation differences — all stay the style's job. No RTF
  string surgery, no locating problem, idempotent by construction (the
  rewrite always starts from the style's pristine XML, never from its own
  output).

### Seam B — post-build engine mutation (fallback, conditionally viable)

After `getCiteProc` returns, mutate
`engine.citation.opt.inheritedAttributes["et-al-min"]` (and
`…["et-al-use-first"]`, and the `bibliography` area). Cheaper — no XML
handling — but it **only works if the style sets the attributes at
style/citation/bibliography level**; values carried on `<names>`/`<name>`
tokens (`token.strings`) shadow the inherited ones and would ignore the
mutation. Since the Epps style's attribute placement is unverified (see Open
questions), and since this leans on citeproc-js internals that citeproc-rs
doesn't share, Seam B is a fallback only — worth having in the back pocket if
a future Zotero makes `getCiteProc` hard to wrap.

### Seam C — RTF post-processing feature in the existing chain (rejected)

A `lib/features/et-al.js` that splits clusters with `BCF.rtf.segments`, finds
the author run, and rewrites it using `BCF.cite.surnames(itemData)` /
`itemData.author`. Rejected:

- **Expansion re-implements citeproc.** The full author data is available in
  `itemData.author`, but rendering it means reproducing name order, initials
  vs full given names, delimiter and ampersand rules, small caps for
  book-like items, and citeproc's disambiguation expansions. Every existing
  feature avoids exactly this by rewriting *around* citeproc's output, not
  re-deriving it.
- **No anchor.** The author run opens the cite; every current feature anchors
  on segment tails (`$`-anchored `(YYYY)`, `, at`, `supra note`) or a unique
  literal (`Id.`). There is no reliable RTF anchor for "the author list", and
  no prior art in the chain for one.
- **Idempotency is hard here.** A truncated-then-refreshed cluster no longer
  contains the text the feature would key on.

### Seam D — zero-code: edit the installed style (the baseline)

The user owns the style; changing two attributes and re-installing works
today. This is precisely what the feature is meant to avoid: it forks the
style per preference, affects every user of the published style if pushed, and
must be re-applied on every style update. Kept in the comparison table as the
do-nothing baseline.

## Head-to-head

| Dimension | Seam A (XML rewrite) | Seam B (engine mutation) | Seam C (RTF feature) | Seam D (edit style) |
|---|---|---|---|---|
| Works regardless of attribute placement | **Yes** | No — inherited-level only | n/a | Yes |
| Covers citeproc-rs | **Yes** | No | Yes (post-render) | Yes |
| Expansion (more names than style) | **Yes** | Yes (where viable) | Effectively no | Yes |
| Idempotent | **By construction** | By construction | Hard | n/a |
| Touches Zotero internals | One documented method | citeproc-js private state | None new | None |
| Per-machine preference | **Yes** | Yes | Yes | No — forks the style |
| Style stays pristine | **Yes** | Yes | Yes | No |
| Plumbing cost | Low (one wrap + pure rewriter) | Low | High | Zero code, recurring manual cost |

## Prefs & UI design

Three prefs, following the exact existing patterns (defaults in root
`prefs.js`, auto-bound controls in `prefs.xhtml`, a clamped reader beside
`BCF.run.options` in `lib/session-run.js:36-49`, `withPrefs` coverage in
`tests/run-node-tests.js:191-201`):

```js
pref("extensions.bluebook-citations-fixer.etAl.enabled", false);
pref("extensions.bluebook-citations-fixer.etAl.min", 3);
pref("extensions.bluebook-citations-fixer.etAl.useFirst", 1);
```

- `enabled` off by default — the installed style's own values are the
  default behavior, and the override is opt-in (mirrors how `allStyles`
  extends the style gate rather than replacing it).
- Clamps in the reader: `min >= 1`, `useFirst >= 1`, and `useFirst < min`
  (a `useFirst >= min` configuration renders nothing sensible).
- UI: a new "Author lists (et al.)" groupbox in `prefs.xhtml` — one
  `<checkbox preference="…etAl.enabled">` plus two
  `<html:input type="number" preference="…">` rows, copying the shapes at
  `prefs.xhtml:42-50`. No pane script needed; the declarative `preference=`
  binding suffices (the style-gate picker in `prefs-pane.js` is the only
  script-backed section, and stays that way).

## Propagation (the real design work)

Two caches sit between a pref change and the rendered document:

1. **`Style._cachedEngines`** — keyed only on
   `{locale, automaticJournalAbbreviations}`; our thresholds are not in the
   key, so a cached engine built under old values would be reused verbatim.
2. **The integration session** — `Zotero.Integration.sessions` keeps a
   session (and its engine) per document; `setData` rebuilds the engine only
   on a style-ID change or explicit `resetStyle`. A Refresh alone re-renders
   with the *existing* engine.

Design: register a pref observer (`Zotero.Prefs.registerObserver`) on the
three `etAl.*` prefs. On change: (a) clear `_cachedEngines` on each allowed
style (`Zotero.Styles.get(id)` for the built-ins + extras), and (b) drop the
entries in `Zotero.Integration.sessions` so the next integration command
builds a fresh session from the document — the same thing a Zotero restart
does, and safe because the pane can't be open mid-command. If (b) proves
fragile across Zotero versions, the documented fallback UX is "reopen
Document Preferences (or restart Zotero) after changing the thresholds" —
worth stating in the pane as a caption either way. Unregister the observer on
shutdown alongside the existing pane/patch teardown in `bootstrap.js`.

## Scope of the gate

This would be the plugin's first patch that fires **outside the integration
pipeline**: `getCiteProc` also serves the style preview in Zotero's Cite
pane, Create Bibliography, and quick copy. Two consequences, both argued
acceptable:

- **Gate by style ID, not session.** `Zotero.Integration.currentSession` is
  unset for non-integration consumers, so the gate is a pure
  ID-membership check against `this.styleID` (a `_styleIDAllowed(id)` helper
  refactored out of `BCF.patch._styleAllowed`, which keeps its fail-open
  session semantics for the RTF chain).
- **No output-format gate.** Unlike every RTF feature, nothing here emits
  RTF — citeproc renders natively in whatever format the consumer asked for.
  The override therefore works for HTML (Google Docs) and plain-text sessions
  too, for free, and gating it to RTF would only create inconsistency
  between preview and document.

Consistency across those surfaces is a feature: the preview shows what the
document will render.

## Interactions

- **`hereinafter._authorPrefix` (`lib/features/hereinafter.js:180-191`)**
  hand-builds the author prefix inside `[hereinafter …]` brackets with
  hardcoded Rule 15.1 *short-form* thresholds (1 → surname, 2 → "X & Y",
  3+ → "X *et al.*"). That is a **different Bluebook rule** than the
  long-form list the CSL thresholds control, so the recommendation is to
  leave it hardcoded and *not* couple it to the new prefs. If a user who
  lists all authors long-form finds the mismatch jarring, wiring the pref
  through is a one-line change to that function — note it in the pane
  caption, defer the decision.
- **`id-suppress` needs nothing.** Its supra rewrites reuse the author string
  citeproc already rendered (it never rebuilds one from `itemData`), so it
  inherits the override automatically.
- **`disambiguate-add-names`.** If the style enables it, citeproc may expand
  a truncated list past `et-al-use-first` to disambiguate two works — that
  behavior survives the override and is desirable; document it so an
  "extra" name isn't mistaken for a bug.
- **Node harness.** `tests/run-node-tests.js` leaves `Zotero.Prefs`
  unstubbed, so the new reader's `try/catch` defaults (`enabled: false`)
  keep every existing test's behavior unchanged — same trick the style gate
  relies on.

## Research findings (Zotero source, verified July 2026)

Traced against `zotero/zotero@main`:

- **`Zotero.Style.prototype.getCiteProc(locale, format, options)`**
  (`xpcom/style.js`) — parses `this.getXML()` via `DOMParser`; constructs
  `Zotero.CiteProc.CSL.Engine` (or `Zotero.CiteprocRs.Engine` under the
  `cite.useCiteprocRs` pref); caches engines in `this._cachedEngines` keyed
  on `{locale, automaticJournalAbbreviations}`. **Seam A target.**
- **`Zotero.Style.prototype.getXML`** (`xpcom/style.js`) — returns the
  style's CSL XML string (file contents for independent styles). The swap
  point inside the wrapper.
- **`Zotero.Integration.Session.prototype.setData`** (`xpcom/integration.js`)
  — builds `this.style` via `getCiteProc`; rebuilds only on style-ID change /
  `resetStyle` / first init. Sessions cached in
  `Zotero.Integration.sessions`. The propagation constraint.
- **citeproc-js et-al storage** (traced from citeproc-js source; re-verify at
  implementation time): `CSL.Attributes["@et-al-min"]` →
  `state.setOpt(token, …)`; root/citation/bibliography-level values →
  the area's `opt.inheritedAttributes`; `<names>`/`<name>`-element values →
  `token.strings`, which shadow inherited values at render time. This is why
  Seam B is conditional and Seam A is not.

**Not verifiable this session:** where
`https://danepps.github.io/bluebook/BluebookDSEStyle.csl` (and its
Experimental variant) actually place their et-al attributes — the style host
and its source repo were outside this session's network/GitHub scope. Seam A
does not depend on the answer; Seam B and the "inject if absent" branch of
the rewriter do. **First implementation step: grep the style for `et-al-`.**

## Proposed architecture (no new plugin)

```
bluebook-citations-fixer/
├── prefs.js                 # + three etAl.* defaults
├── prefs.xhtml              # + "Author lists (et al.)" groupbox (declarative binding)
├── bootstrap.js             # + load lib/etal.js; register/unregister pref observer
└── lib/
    ├── etal.js              # NEW: options() reader + rewriteXML(xml, opts) (pure, vm-testable)
    └── patch.js             # + wrap Zotero.Style.prototype.getCiteProc;
                             #   refactor _styleIDAllowed(id) out of _styleAllowed(session)
```

Not a `lib/features/` entry: it has no `rewrite`/`rewriteCitation` contract,
runs upstream of the chain, and must not be confused with the RTF features.
`CLAUDE.md` / `AGENTS.md` would need their architecture sections updated in
the same change (new hook seam, new prefs) — per the repo's own maintenance
rules.

## Verification (when/if built)

- **Unit (node harness):** fixture table for `rewriteXML` — attribute present
  on `<citation>` / on a `<name>` inside a macro / both / absent (inject
  path) / single-quoted / already at the target value (no-op output equality);
  clamp behavior of the `options()` reader under `withPrefs`.
- **Integration (manual):** side-load; enable the override with
  `min=99` (list-all) and with `min=2, useFirst=1` (aggressive truncation);
  insert 3+-author cites under the Epps style in Word or LibreOffice; confirm
  long-form author lists follow the pref, the bibliography matches, Refresh
  is stable, and the style preview in Zotero's Cite pane agrees. Change the
  pref with a document open and confirm the next Refresh (after the observer
  fires) picks it up. Confirm a non-allowed style renders untouched, and that
  disabling the pref restores the style's own thresholds without reinstall.

## Open questions

**Blockers (decide first):**

- **Where does the Epps style set its et-al attributes?** Determines whether
  the rewriter's replace path or inject path does the work, and whether Seam
  B is even on the table. One grep once the style file is reachable.
- **Pref-change propagation:** is dropping `Zotero.Integration.sessions`
  entries from a pref observer safe across the supported Zotero versions, or
  does the pane fall back to a "reopen Document Preferences" caption?

**Deferrable:**

- Expose `et-al-subsequent-min` / `et-al-subsequent-use-first` as a second
  pref pair, or keep subsequent cites on the style's values? (Bluebook short
  forms are largely handled by the style's own short-form macros and the
  plugin's supra machinery, so the subsequent knobs may never matter.)
- Should the same pref optionally drive `hereinafter._authorPrefix` and thus
  the `[hereinafter …]` bracket's author prefix? (Recommended default: no —
  different Bluebook rule.)
- Distinct thresholds for bibliography vs citations? (CSL supports it; the
  UI cost probably isn't worth it for a footnote-style workflow.)
