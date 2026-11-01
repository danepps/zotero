# Et-al threshold override: 2.0 implementation plan

> **Status: implemented with 1.3.3.11 hardening; live acceptance pending. Revised 2026-10-31.** This replaces the
> feasibility-study assignment. Work lands on `v2.0`; the [roadmap](v2.0-roadmap.md)
> controls milestones. July Zotero-source findings in [the review](2.0-plan-review.md)
> have been rechecked against Zotero 7.0.0 source and installed Zotero 10.0.2.
> Original source snapshots are in `.codex-memo/runs/et-al-20260912/`; split-threshold verification is in `.codex-memo/runs/et-al-split-20260912/`.

## User-visible contract

**Author-list truncation** has independent dropdowns for **First citation and bibliography** and **Subsequent citations**. Each offers Style default and 3 through 11 authors. For eight names on first appearance, set the first threshold to 9. Preferences are `extensions.bluebook-citations-fixer.etAl.min` (retained from the earlier single-setting build) and `…etAl.subsequentMin`, each defaulting to 0. The native CSL options are `et-al-min` / `et-al-use-first` and `et-al-subsequent-min` / `et-al-subsequent-use-first`, respectively; each override retains one name before et al. With either override active, the effective subsequent threshold and retained-name count are capped by the effective first values. Explicit subsequent defaults are preserved up to this cap; absent subsequent options follow the effective first values. Both defaults leave the original XML unchanged. Subsequent-only changes leave the bibliography unchanged.

The published style defaults are first/bibliography 5 and subsequent 4. These produce all four names on a four-author work's first citation and et al. on subsequent citations, while three-author works retain all names. Settings disables options above the effective first threshold without changing saved values. The transformer constrains both thresholds and retained-name counts to prevent processor expansion. Current transform failures appear below the controls; retry success, replacement, Style default and teardown clear obsolete failures.
Apply to the two IDs from `BCF.patch.BUILTIN_STYLE_IDS`, in citations and
bibliographies, in all output formats, including HTML and text. Previews and
Create Bibliography under these styles use the same preference. This changes
citeproc input; it does not extend the RTF feature chain to Google Docs.

Unknown/unreadable style IDs, missing built-in metadata, and other styles
pass through. The RTF chain's extra-style list and `allStyles` do not expand
this feature's scope. Preserve the existing RTF-chain gate; this global hook
has its own strict gate.

Keep `hereinafter._authorPrefix()` and `id-suppress` short forms unchanged.
Explain that distinction in the pane. Do not expose `use-first`, extra styles, or an unlimited-author option in 2.0.

## Files

| File | Planned change |
|---|---|
| `bluebook-citations-fixer/lib/et-al-override.js` | Options, XML transformer/memoization, engine wrapper, current status and preference observers |
| `bluebook-citations-fixer/lib/style-change-gate.js` | Independent command/reset barrier, legacy coordinator migration and lifecycle |
| `bluebook-citations-fixer/bootstrap.js` | Load, install after API readiness, and tear down the module |
| `bluebook-citations-fixer/prefs.js` | Default both threshold preferences to `0` |
| `bluebook-citations-fixer/prefs.xhtml` and `prefs-pane.js` | Accessible dropdown controls and short-form explanation |
| `bluebook-citations-fixer/tests/run-et-al-tests.js` and `run-gate-tests.js` | Transformer, memoization, status, gate, propagation and lifecycle tests |
| Plugin README, changelog, and `AGENTS.md` | Document the implemented feature and its distinct format scope |

No installed CSL file is edited. This module is not a feature-chain entry;
the existing build already packages `lib/`. Claude-owned instructions remain
read-only: provide any needed sister-document delta for the user to give
Claude unless specifically authorized to edit it.

## Engine seam and XML transformer

1. Verify `Style.prototype.getCiteProc`, `getXML`, `clearEngineCache`, session
   engine construction, preference-observer APIs, and shutdown semantics in
   the exact supported Zotero builds. Record source revisions in hidden evidence.
2. Wrap `getCiteProc`, capturing the original and module references at install.
   Default settings and disallowed styles delegate directly.
3. Candidate seam: temporarily override the instance's `getXML` while the
   original constructor consumes transformed XML, restoring in `finally`.
   Use this only after confirming synchronous XML consumption. Preserve the
   original own-property descriptor, or remove the temporary own property if
   the method was inherited. Test nested calls and exceptions. If construction
   can yield, choose and document a seam that never leaves a shared method
   replaced across an await before implementation proceeds.
4. Parse with namespace awareness. Rewrite existing `et-al-min` and
   `et-al-use-first` on supported CSL formatting elements and supply defaults
   on existing `citation` and `bibliography` elements. Do not invent a missing
   bibliography. Resolve inherited attributes from an unmodified snapshot and cap subsequent-citation thresholds and retained-name counts. Shared macro local options fall back to citation then style; actual bibliography descendants inherit bibliography then style.
   Preserve metadata, locales, and unrelated formatting.
5. Verify built-in fixtures for conflicting `et-al-use-last`,
   and disambiguation options. Unsupported combinations delegate unchanged
   with a diagnostic and a current Settings warning until their semantics are explicitly supported.
6. Transformer failure logs and supplies original XML. Original constructor
   errors restore temporary state and propagate normally; do not retry the
   constructor and duplicate its side effects.

Inject `parse` and `serialize` dependencies. The runtime adapter uses Zotero's
XML APIs. Node tests use pinned @xmldom/xmldom and citeproc development dependencies,
including 28800 real first/subsequent citation and bibliography outputs from published built-in CSL
fixtures. The same output suite passes against the processor extracted from
installed Zotero 11.0. Native Firefox parser and application integration checks
still require Zotero. Do not replace this with broad XML regex surgery.

## Lifecycle and propagation

Implementation note (2026-10-31): the shared wrapper mechanism covers the new
`Style.getCiteProc` hook and an additional `Integration.execCommand` barrier.
The independent `BCF.styleGate` owns a coordinator on `Zotero.Integration.__bcfStyleGate`, queues complete style installations and
coalesces resets, accounts for commands already running, and keeps later commands
behind pending engine changes. New instances adopt the coordinator and command
hook synchronously before awaiting initialization so upgrades preserve the gate. Legacy Style-prototype coordinators are adopted and moved. Bootstrap isolates optional et-al load/setup failures so main-style repair continues.
The command barrier stays until disable cleanup finishes. Bootstrap now awaits
asynchronous shutdown before removing shared wrappers and clearing BCF; both
Zotero 7 and 10 source support this. Application exit skips new rebuilds but waits for already-running installations
to settle before releasing the command gate.


Complete shared wrapper hardening before adding this global hook. Use
instance-owned wrapper metadata and exact-identity restoration; do not remove
another plugin's wrapper during stale recovery.

On install, relevant preference changes, and uninstall, clear optional engine
caches on affected installed styles with `clearEngineCache()` and arrange
`Zotero.Integration.resetSessionStyles()`. Never delete integration sessions.
Global cache clearing alone does not rebuild session-held engines.

Serialize/coalesce resets so repeated changes settle on the latest preference.
Wait for active integration commands and recheck activity immediately before a
reset. Use generation tokens to invalidate obsolete feature work, capture all
references across awaits, and unregister observers on teardown. Restore the
owned hook before the teardown reset so existing engines return to style
defaults. Keep required cleanup separate from cancelled enable/change work.
Bootstrap shutdown awaits cleanup; deferred cleanup must
use the current hook and must never reinstall an old instance.

Style sync installs original published bytes. Engine rebuilds then apply the
current preference through this hook; never maintain patched style files.
Transformed XML is memoized per Style instance and preference mode, with reader
identity checks for foreign replacements. Zotero reinitialization creates new
Style objects and therefore invalidates cached revisions. Test update, preference change, disable/re-enable,
and upgrade while a reset is waiting.

## Acceptance and delivery

- Default, all thresholds, invalid values, unknown identity, both built-ins,
  and another style; boundary renders with two through five authors.
- XML placements, missing attributes/bibliography, namespaces, repeated
  transformation, malformed XML, unsupported options, and unchanged metadata.
- Citations and bibliographies preserve native formatting; hereinafter and
  Break id. author prefixes remain unchanged.
- Cached previews and open documents pick up changed preferences; selecting
  style default restores installed-style behavior without deleting sessions.
- Nested/throwing construction, coalesced changes, active-command deferral,
  observer cleanup, third-party wrappers, and two-instance upgrades.
- Style sync with override on/off; Word and LibreOffice RTF; HTML/text engines
  and Google Docs according to this feature's scope. Check each claimed
  processor backend and keep the RTF chain inactive for HTML.

After build guardrails land, choose the next unused fourth-component version
from the latest release and shared branch build history. Side-load an untracked
XPI; do not reuse historical example versions or publish a test through the
production update JSON. Record artifact/application versions and results in
the roadmap. Mark verified only after automated and live acceptance checks pass.
