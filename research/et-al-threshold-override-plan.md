# Plan: Evaluate user-configurable "et al." thresholds (overriding the installed style)

> **Status note (2026-07-27):** this document is still a *feasibility-study plan* — its
> deliverable is a research doc, not code. Before building the 2.0 feature, rewrite it
> as an implementation plan per [`2.0-plan-review.md`](./2.0-plan-review.md)
> §"Configurable et al." Adopted decisions that supersede passages below: **never
> delete `Zotero.Integration.sessions` entries** — propagation is `clearEngineCache()`
> + `await Zotero.Integration.resetSessionStyles()` (sessions never pass `cache` to
> `getCiteProc`, so the global engine cache isn't the issue this plan assumed); the
> global `getCiteProc` hook **fails closed** on an unreadable styleID (unlike the
> RTF-chain gate); initial scope is the built-in Epps styles only; prefer a single
> `et-al-min` pref (3/4/5 or "use style default") with `use-first` fixed at 1; the
> override applies in **all output formats** (it changes citeproc input, not RTF); the
> XML rewriter needs a dependency-injected parse/serialize seam (the node harness has
> no `DOMParser`). The obsolete separate-branch/draft-PR step is void — work lands on
> `v2.0`.

## Context

The user wants an evaluation of a feature that would let them change the "et al." thresholds — CSL's `et-al-min` (how many authors trigger truncation) and `et-al-use-first` (how many names to keep) — from the **bluebook-citations-fixer settings pane**, overriding whatever the installed CSL style hardcodes. Today those values are baked into the Epps Bluebook style's XML; changing them means editing/forking the style. Bluebook Rule 15.1 genuinely permits either "first author et al." or listing all authors for 3+ author works, so this is a legitimate user preference, not a correctness fix.

This repo has an established convention for exactly this kind of request: **committed feasibility studies** in `research/` (`journal-abbreviation-feasibility.md` and `journal-abbreviation-render-time-feasibility.md`, the latter marked "Status: feasibility study, not slated for implementation"). The deliverable is a new research doc in that series — **evaluation only, no plugin code changes**.

## Key findings from research (feed these into the doc)

**The plugin has no pre-render seam today.** All five patched methods in `lib/patch.js` (`Field.setText`, `Session._updateDocument`, etc.) run *after* citeproc has already applied the style's et-al truncation. Post-render RTF surgery could truncate an author list but expanding one means re-synthesizing citeproc's name formatting (initials, delimiters, small caps for books, disambiguation) from `itemData.author` — fragile, no anchor prior art (every existing feature anchors on segment tails).

**A clean pre-render seam exists in Zotero core** (verified against `zotero/zotero@main`, July 2026):
- `Zotero.Integration.Session.prototype.setData` builds the session engine via `getStyle.getCiteProc(data.style.locale, this.outputFormat, { automaticJournalAbbreviations })`; it rebuilds only when the style ID changes or `resetStyle` is passed.
- `Zotero.Style.prototype.getCiteProc(locale, format, options)` parses `this.getXML()` with `DOMParser` and constructs `new Zotero.CiteProc.CSL.Engine(sys, xml, locale, overrideLocale)` (or `Zotero.CiteprocRs.Engine` when the `cite.useCiteprocRs` pref is on). **Engines are cached** in `this._cachedEngines`, keyed only on `{locale, automaticJournalAbbreviations}` — an override must purge this cache on pref change.
- Because both engines consume the same XML, a **pre-parse XML rewrite** is engine-agnostic and works regardless of *where* the style places the attributes (CSL allows them on `<style>`, `<citation>`, `<bibliography>`, `<names>`, or `<name>`; citeproc-js stores root/citation-level values in `opt.inheritedAttributes` but name-element values in per-token `strings`, so post-build mutation only works for some placements).

**Style placement — verified locally** (the style repo lives at `~/ClaudeCode/bluebook`): both `BluebookDSEStyle.csl` and `BluebookDSEStyle-Experimental.csl` set `et-al-min="5" et-al-use-first="1"` on the `<citation>` element (line 622) and the `<bibliography>` element (line 804), and **never on `<name>` tokens**. Two consequences: (1) Seam B (post-build `inheritedAttributes` mutation) is *viable for the built-in styles* — element-level placement is exactly the case where it works — though Seam A remains the recommendation because user-configured extra styles may place the attributes anywhere and Seam A also covers citeproc-rs. (2) The motivation sharpens: with min=5 / use-first=1, three- and four-author works currently list **all** authors, and Rule 15.1 permits "first author et al." from three up — so the meaningful pref space is precisely `et-al-min ∈ {3, 4, 5}`. Neither style sets any `disambiguate-*` attribute (CSL's `disambiguate-add-names` defaults to off), so the re-expansion interaction is moot for the built-ins; neither sets `et-al-subsequent-*`, which supports deferring subsequent-cite prefs.

**Interactions to cover:** `hereinafter.js:180-191` `_authorPrefix` hardcodes the Rule 15.1 *short-form* thresholds (2 → "X & Y", 3+ → "X *et al.*") for the `[hereinafter …]` bracket, **and `id-suppress.js:174` calls the same `_authorPrefix` for its `supra` rewrites** — the hardcoded short forms affect both features; `disambiguate-add-names` re-expansion (a note only — absent from the built-in styles, relevant just for user-added extras); `et-al-subsequent-min`/`et-al-subsequent-use-first` exist as separate CSL knobs (also absent from the built-ins).

## Deliverable

One new file: **`research/et-al-threshold-override-feasibility.md`**, matching the structure and register of `research/journal-abbreviation-render-time-feasibility.md`:

1. **Status header** — feasibility study, not slated for implementation; part of the research series.
2. **Context / problem** — style hardcodes et-al thresholds; Bluebook 15.1 permits either form; goal is a per-machine pref override without forking the style.
3. **Verdict** — technically feasible with a small, low-risk seam (recommended: XML rewrite at `getCiteProc` time). Real costs: pref-change propagation (engine + session caching) and the decision about whether the same pref drives the plugin's own short-form author rendering.
4. **The seam: candidates, head-to-head**
   - **Seam A (recommended): pre-parse CSL rewrite.** Wrap `Zotero.Style.prototype.getCiteProc`; when the override prefs are set and the style ID is in `BCF.patch.BUILTIN_STYLE_IDS`/extras (reuse `_styleAllowed`-style gating against `this.styleID`), temporarily swap `this.getXML` to return XML with `et-al-min`/`et-al-use-first` attributes rewritten wherever they appear (and injected on `<citation>`/`<bibliography>` if absent), then delegate. Engine-agnostic (covers citeproc-rs), placement-agnostic, and citeproc renders natively — no RTF surgery, idempotent by construction, covers citations and bibliography. **Fail-open:** if the XML rewrite throws for any reason, return the original XML untouched — matching the plugin's existing posture (unreadable styleID fails open, `segments()` null → pass-through). Same shape as the abbreviation doc's "Seam A".
   - **Seam B: post-build engine mutation** (`engine.citation.opt.inheritedAttributes["et-al-min"] = n` after `getCiteProc` returns). Cheaper, and **now verified viable for the built-in styles** (both set the attributes at `<citation>`/`<bibliography>` level, never on `<name>` tokens). Still the fallback, not the recommendation: it doesn't cover citeproc-rs, and a user-added extra style could place the attributes on `<name>` tokens where the mutation is silently ignored.
   - **Seam C: RTF post-processing feature** in the existing chain — rejected: truncation-only is feasible but expansion re-implements citeproc name rendering; no anchor precedent; disambiguation conflicts.
   - **Seam D: zero-code — edit/fork the style.** The baseline the feature is explicitly meant to avoid (style drift, re-install churn, affects all users of the style); include for the comparison table.
5. **Prefs & UI design** — two int prefs (`extensions.bluebook-citations-fixer.etAl.min`, `…etAl.useFirst`, plus an enable checkbox or a `0 = use style` sentinel), following the exact existing patterns: defaults in `prefs.js`, a groupbox in `prefs.xhtml` copying the `checkbox`/`html:input type="number"` auto-binding shapes at lines 42–50, a clamped `options()`-style reader beside `BCF.run.options` (`lib/session-run.js:36-49`), `withPrefs` coverage in `tests/run-node-tests.js`. Defer `et-al-subsequent-*` as an open question.
6. **Propagation problem (the honest hard part)** — `_cachedEngines` is keyed without our prefs, and integration sessions keep their engine until style reset. Design: a pref observer purges the allowed styles' `_cachedEngines` and drops `Zotero.Integration.sessions` entries so the next command rebuilds; document the fallback UX ("reopen Document Preferences / restart") if session-dropping proves risky.
7. **Interactions** — the hardcoded short-form thresholds in `hereinafter._authorPrefix`, shared by `id-suppress` (`id-suppress.js:174`) for its `supra` rewrites (recommend: leave both at Rule 15.1 defaults, note the option of wiring the pref through); `disambiguate-add-names` re-expansion (extras only — absent from the built-in styles); scope of the style gate (patching `getCiteProc` fires outside integration too — style previews, Create Bibliography — argue that's desirable consistency under a gated style).
8. **Verification plan (when/if built)** — node-harness fixtures for the XML rewriter (attribute present at each placement / absent / already-overridden), manual: side-load, set thresholds, insert 3+-author cites in Word/LibreOffice, Refresh stability, non-allowed style + Google Docs pass-through, pref-change propagation.
9. **Open questions** — whether subsequent-cite thresholds get their own prefs (the built-in styles don't set `et-al-subsequent-*`, favoring deferral); whether the pref should also drive the plugin's own short-form rendering (`hereinafter` + `id-suppress` via the shared `_authorPrefix`). The former open item — where the Epps style places its et-al attributes — is **resolved**: `<citation>`/`<bibliography>` element level, verified against the local style repo (see "Style placement — verified locally" above).

## Steps

1. Write `research/et-al-threshold-override-feasibility.md` per the outline above.
2. Cross-link it from the two existing research docs only if they have a "companion" header pattern that warrants it (they cross-reference each other; a one-line pointer is optional — do not restructure them). **No changes** to `CLAUDE.md`/`AGENTS.md` (no plugin/build/architecture change) and no plugin code changes.
3. Commit on branch `claude/et-al-threshold-settings-6hd1hz` with a descriptive message, push with `git push -u origin`, and open a **draft PR** (no open PR exists for this branch; repo has no PR template — check `.github/` to confirm before writing the body).

## Verification

- The doc renders cleanly as Markdown and follows the existing research-doc structure (status header, Verdict, seam comparison, open questions).
- Every Zotero-core claim in the doc carries its source (file + symbol, traced against `zotero/zotero@main`), matching the "Research findings (verified …)" convention of the prior doc.
- Branch pushed, draft PR open.
