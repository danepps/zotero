# bluebook-inserter

A standalone macOS utility: press a global hotkey (default **⌘⇧-Space**) from *any*
app, get a floating Spotlight-style search box, type a case name, pick a result from
**CourtListener**, optionally add an introductory signal and a pincite, and have a
properly-formatted Bluebook **case** citation pasted into whatever you're typing in.

> This project is self-contained and shares **no code** with the Zotero plugins it
> currently sits beside in this repo — only Bluebook *domain knowledge* carries over.
> It is intended to graduate into its own repository.

## Status

Phase 1 (the substantive core) is implemented and tested: the pure `BluebookFormat`
library and its unit tests. The `CourtListener` client and the `App` agent layer are
scaffolded per the plan and build on macOS.

## Architecture

```
Sources/
  BluebookFormat/   pure, dependency-free formatter (no UI/network) — fully tested
  CourtListener/    async REST client + Codable models -> CaseRecord
  App/              menu-bar/LSUIElement agent: hotkey, floating panel, paste-back
Tests/
  BluebookFormatTests/   fixture -> expected Bluebook string (both style modes, signals)
```

The formatter assembles, as styled text projectable to RTF or plain:

```
[<italic signal> ]<name>, <vol> <reporter> <page>[, <pincite>] (<court> <year>).
e.g.  See Obergefell v. Hodges, 576 U.S. 644, 681 (2015).
```

### Citation style toggle

Bluebook italicizes the **full** case name in court documents/briefs, but **not** in
law-review footnote citations (there the full name is roman; only procedural phrases
like *In re* / *ex rel.*, short forms, and textual references are italic). The
`CitationStyle` flag (`lawReview` default vs. `courtDocument`) drives this. Signals are
always italic in both modes.

## Build & test

```sh
swift test                 # runs the BluebookFormat unit tests (any platform)
swift build                # builds everything (macOS)
swift run bluebook-inserter # launches the agent (macOS)
```

### Running the agent locally

The app needs:

1. A bundle **Info.plist** declaring `LSUIElement = true` (no Dock icon) and
   `NSAppleEventsUsageDescription`. `swift run` produces a bare executable, so for the
   real agent wrap it in an `.app` bundle (Xcode app target, or a small bundling
   script) with that Info.plist.
2. The **Accessibility** permission (System Settings ▸ Privacy & Security ▸
   Accessibility) — required to synthesize ⌘V for paste-back. The app prompts on first
   launch via `AXIsProcessTrustedWithOptions`.
3. A free **CourtListener API token** (Settings) for higher rate limits; anonymous
   search works but is throttled.

Distribution is **local-first** for now (ad-hoc sign, right-click ▸ Open to bypass
Gatekeeper). Notarized-DMG distribution is a later decision.

## Keyboard-only flow

`⌘⇧-Space` → type query → `↑/↓` select → `⌃S` pick signal → `⇥` enter pincite →
`⏎` insert → `esc` to dismiss. No mouse required.

## Scope (v1)

Cases only. Statutes, secondary sources, and id./supra short forms are out of scope.
The T6/T10 case-name abbreviation tables are intentionally a **permissive subset** —
they abbreviate common words and leave the rest verbatim, and are grown test-first.
