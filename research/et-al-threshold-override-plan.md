# Plan: Evaluate user-configurable "et al." thresholds (overriding the installed style)

## Context

The user wants an evaluation of a feature that would let them change the "et al." thresholds — CSL's `et-al-min` (how many authors trigger truncation) and `et-al-use-first` (how many names to keep) — from the **bluebook-citations-fixer settings pane**, overriding whatever the installed CSL style hardcodes. Today those values are baked into the Epps Bluebook style's XML; changing them means editing/forking the style. Bluebook Rule 15.1 genuinely permits either "first author et al." or listing all authors for 3+ author works, so this is a legitimate user preference, not a correctness fix.

This repo has an established convention for exactly this kind of request: **committed feasibility studies** in `research/` (`journal-abbreviation-feasibility.md` and `journal-abbreviation-render-time-feasibility.md`, the latter marked "Status: feasibility study, not slated for implementation"). The deliverable is a new research doc in that series — **evaluation only, no plugin code changes**.

## Key findings from research (feed these into the doc)

**The plugin has no pre-render seam today.** All five patched methods in `lib/patch.js` (`Field.setText`, `Session._updateDocument`, etc.) run *after* citeproc has already applied the style's et-al truncation. Post-render RTF surgery could truncate an author list but expanding one means re-synthesizing citeproc's name formatting (initials, delimiters, small caps for books, disambiguation) from `itemData.author` — fragile, no anchor prior art (every existing feature anchors on segment tails).

**A clean pre-render seam exists in Zotero core** (verified against `zotero/zotero@main`, July 2026):
- `Zotero.Integration.Session.prototype.setData` builds the session engine via `getStyle.getCiteProc(data.style.locale, this.outputFormat, { automaticJournalAbbreviations })`; it rebuilds only when the style ID changes or `resetStyle` is passed.
- `Zotero.Style.prototype.getCiteProc(locale, format, options)` parses `this.getXML()` with `DOMParser` and constructs `new Zotero.CiteProc.CSL.Engine(sys, xml, locale, overrideLocale)` (or `Zotero.CiteprocRs.Engine` when the `cite.useCiteprocRs` pref is on). **Engines are cached** in `this._cachedEngines`, keyed only on `{locale, automaticJournalAbbreviations}` — an override must purge this cache on pref change.
- Because both engines consume the same XML, a **pre-parse XML rewrite** is engine-agnostic and works regardless of *where* the style places the attributes (CSL allows them on `<style>`, `<citation>`, `<bibliography>`, `<names>`, or `<name>`; citeproc-js stores root/citation-level values in `opt.inheritedAttributes` but name-element values in per-token `strings`, so post-build mutation only works for some placements).

**Unverifiable this session:** where the Epps style (`https://danepps.github.io/bluebook/BluebookDSEStyle.csl`) actually sets its et-al attributes — the host is blocked by the network policy and `danepps/bluebook` is outside GitHub scope. The doc records this as the open verification item; the recommended seam is robust either way.

**Interactions to cover:** `hereinafter.js:180-191` `_authorPrefix` hardcodes the Rule 15.1 *short-form* thresholds (2 → "X & Y", 3+ → "X *et al.*") for the `[hereinafter …]` bracket; `disambiguate-add-names` in the style can re-expand names past `et-al-use-first`; `et-al-subsequent-min`/`et-al-subsequent-use-first` exist as separate CSL knobs.

## Deliverable

One new file: **`research/et-al-threshold-override-feasibility.md`**, matching the structure and register of `research/journal-abbreviation-render-time-feasibility.md`:

1. **Status header** — feasibility study, not slated for implementation; part of the research series.
2. **Context / problem** — style hardcodes et-al thresholds; Bluebook 15.1 permits either form; goal is a per-machine pref override without forking the style.
3. **Verdict** — technically feasible with a small, low-risk seam (recommended: XML rewrite at `getCiteProc` time). Real costs: pref-change propagation (engine + session caching) and the decision about whether the same pref drives the plugin's own short-form author rendering.
4. **The seam: candidates, head-to-head**
   - **Seam A (recommended): pre-parse CSL rewrite.** Wrap `Zotero.Style.prototype.getCiteProc`; when the override prefs are set and the style ID is in `BCF.patch.BUILTIN_STYLE_IDS`/extras (reuse `_styleAllowed`-style gating against `this.styleID`), temporarily swap `this.getXML` to return XML with `et-al-min`/`et-al-use-first` attributes rewritten wherever they appear (and injected on `<citation>`/`<bibliography>` if absent), then delegate. Engine-agnostic (covers citeproc-rs), placement-agnostic, and citeproc renders natively — no RTF surgery, idempotent by construction, covers citations and bibliography. Same shape as the abbreviation doc's "Seam A".
   - **Seam B: post-build engine mutation** (`engine.citation.opt.inheritedAttributes["et-al-min"] = n` after `getCiteProc` returns). Cheaper, but only works if the style sets the attributes at root/citation level (not on `<name>` tokens) — blocked on the unverified style-placement question; fallback only.
   - **Seam C: RTF post-processing feature** in the existing chain — rejected: truncation-only is feasible but expansion re-implements citeproc name rendering; no anchor precedent; disambiguation conflicts.
   - **Seam D: zero-code — edit/fork the style.** The baseline the feature is explicitly meant to avoid (style drift, re-install churn, affects all users of the style); include for the comparison table.
5. **Prefs & UI design** — two int prefs (`extensions.bluebook-citations-fixer.etAl.min`, `…etAl.useFirst`, plus an enable checkbox or a `0 = use style` sentinel), following the exact existing patterns: defaults in `prefs.js`, a groupbox in `prefs.xhtml` copying the `checkbox`/`html:input type="number"` auto-binding shapes at lines 42–50, a clamped `options()`-style reader beside `BCF.run.options` (`lib/session-run.js:36-49`), `withPrefs` coverage in `tests/run-node-tests.js`. Defer `et-al-subsequent-*` as an open question.
6. **Propagation problem (the honest hard part)** — `_cachedEngines` is keyed without our prefs, and integration sessions keep their engine until style reset. Design: a pref observer purges the allowed styles' `_cachedEngines` and drops `Zotero.Integration.sessions` entries so the next command rebuilds; document the fallback UX ("reopen Document Preferences / restart") if session-dropping proves risky.
7. **Interactions** — the hardcoded short-form thresholds in `hereinafter._authorPrefix` (recommend: leave at Rule 15.1 defaults, note the option of wiring the pref through); `disambiguate-add-names` re-expansion; scope of the style gate (patching `getCiteProc` fires outside integration too — style previews, Create Bibliography — argue that's desirable consistency under a gated style).
8. **Verification plan (when/if built)** — node-harness fixtures for the XML rewriter (attribute present at each placement / absent / already-overridden), manual: side-load, set thresholds, insert 3+-author cites in Word/LibreOffice, Refresh stability, non-allowed style + Google Docs pass-through, pref-change propagation.
9. **Open questions** — where the Epps style places its et-al attributes (the one real check, needs the style file); whether subsequent-cite thresholds get their own prefs; whether the pref should also drive short-form/`hereinafter` rendering.

## Steps

1. Write `research/et-al-threshold-override-feasibility.md` per the outline above.
2. Cross-link it from the two existing research docs only if they have a "companion" header pattern that warrants it (they cross-reference each other; a one-line pointer is optional — do not restructure them). **No changes** to `CLAUDE.md`/`AGENTS.md` (no plugin/build/architecture change) and no plugin code changes.
3. Commit on branch `claude/et-al-threshold-settings-6hd1hz` with a descriptive message, push with `git push -u origin`, and open a **draft PR** (no open PR exists for this branch; repo has no PR template — check `.github/` to confirm before writing the body).

## Verification

- The doc renders cleanly as Markdown and follows the existing research-doc structure (status header, Verdict, seam comparison, open questions).
- Every Zotero-core claim in the doc carries its source (file + symbol, traced against `zotero/zotero@main`), matching the "Research findings (verified …)" convention of the prior doc.
- Branch pushed, draft PR open.
