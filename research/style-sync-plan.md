# Style sync: implementation contract and remaining verification

> **Status: built; live verification pending. Revised 2026-10-31.** This replaces
> superseded implementation sketches. The [roadmap](v2.0-roadmap.md) controls
> remaining work; [the July review](2.0-plan-review.md) is historical rationale.

## Scope and integration

Update installed Epps styles when published CSL has a strictly newer `<updated>`.
Obtain IDs only from `BCF.patch.BUILTIN_STYLE_IDS`; if unavailable, log and return
an empty list. Do not maintain fallback IDs. Routine update checks remain
installed-only. A separate 5-second startup presence check restores missing
main via `PRIMARY_STYLE_ID`; experimental stays opt-in. It runs every startup,
including after removal and with updates disabled. It fetches nothing when
main is already present. Startup results live in `styleSetup.status` and
`styleSetup.lastAttempt`, with no persistent completion flag or retry throttle.

`extensions.bluebook-citations-fixer.styleSync` defaults to true;
`styleSync.lastCheck` is a string of epoch milliseconds, default `"0"`.
After startup presence repair, schedule an ordinary check 60 seconds later
when enabled and due, and
recheck at timer fire. Due means never checked, 24 hours elapsed, or a stored
time in the future. The manual button bypasses automatic enable/throttle checks.

`lib/style-sync.js` uses lazy Zotero access and injected dependencies.
`bootstrap.js` loads it after `patch.js`, schedules startup, and cancels it first
on shutdown. The pane receives only `{ checkStyleUpdates, styleUpdateSummary, installedStyleVersions, styleSetupStatus, installStyle, etAlStatus }`
through `Zotero.BluebookCitationsFixer`; remove that bridge only when it is still
this instance's object. Never expose the entire BCF namespace.

The Style updates section displays an installed revision date for each built-in
(UTC date; full timestamp on hover), or Not installed / Revision date unavailable.
Its read-only bridge method does not fetch or alter lastCheck. Dates refresh on
pane initialization, after checks/installs, and on lastCheck or startup-attempt preference changes;
stale reads are discarded and the preference observer is removed on window unload.
The permanent Latest style release notes link targets the existing style
changelog at `https://danepps.github.io/bluebook/#changelog`.

No confirmation dialog is used. Routine failures are logged. Startup repair
shows a brief success notice only after verification, or a visible warning on
failure/unverified installation, and persists Settings status. Pre-install failures leave the local style untouched.
After installation starts, Zotero owns file effects: no preservation or rollback
guarantee. The plugin never calls uninstall.

## Check contract

`checkStyle(id, deps, generation, setupOnly)` resolves to an object with status and relevant
metadata. Capture modules before awaits; cancellation prevents new installs.

1. In startup repair mode, existing main returns `already-installed` without
   fetching; missing main proceeds through validated installation below. A
   style appearing during fetch/validation is preserved. In routine mode, missing means `not-installed`, unreadable timestamp
   means `skipped`; neither fetches. Read the original `<updated>` from
   `style.getXML()`: Zotero's display `Style.updated` drops positive offsets,
   so parsing that field as local time produces false mismatches. If an XML
   read fails, do not fall back to that metadata. Lightweight callers without
   `getXML` must supply an explicitly zoned timestamp.
2. Fetch once. Require an exact remote `<id>` match; mismatch/missing ID is
   `failed`. Unparseable remote `<updated>` is `skipped`.
3. Equal/older timestamps mean `up-to-date`, with no installation.
4. Explicitly validate the fetched text with `Zotero.Styles.validate(text)`.
   Rejection means `failed`, with no installation.
5. Queue installation through `BCF.styleGate.withStyleChange`, synchronously blocking
   later integration commands. Wait for existing commands, rechecking activity
   and generation after each wait. Retain the gate through installation and
   verification. Re-read local state inside the gate: preserve independently
   newer styles and styles installed during startup repair; skip routine updates
   if the style was removed while waiting.
6. Recheck generation immediately before
   `Zotero.Styles.install({ string: text }, id, true)`. Install exactly the
   fetched and validated bytes, not a URL that causes a second fetch.
7. Re-read installed metadata. Its parsed `<updated>` must equal the fetched
   value for `updated`. Missing/unreadable/stale metadata or a throwing lookup
   means `unverified`. This is metadata verification, not disk-byte equality.
8. Exceptions resolve to `failed`; cancellation before install is `cancelled`.
   Already-started installs may still finish after cancellation; shutdown retains
   the command barrier until they settle.

`check(deps, setupOnly)` shares one in-flight run, processes styles sequentially, and
resolves to `{ results, counts, checkedAt }`. Counts distinguish `installed`, `alreadyInstalled`, `updated`,
`upToDate`, `notInstalled`, `skipped`, `failed`, `unverified`, and `cancelled`.
Clear the shared promise on settlement. Routine checks write lastCheck on success/failure; startup repair writes its separate status/attempt,
but do not write it after generation cancellation.

Summary labels retain mixed outcomes: for example, `Updated 1 style; 1 check
failed` and `1 style installed but not verified`. Success must not hide another
style's failure or uncertainty. `cancel()` increments generation and cancels
the timer; timer cancellation alone cannot stop an in-flight check.

## Remaining hardening and compatibility

- Test build `1.3.3.9` shares one queue for style installations and preference
  resets, preserves local changes made while waiting, and keeps the command
  barrier across disable/upgrade/shutdown. Combined production-module tests cover
  these interleavings and multiple open sessions. Native Zotero/Word validation
  remains pending; direct installs outside the plugin are not intercepted.
- Before publishing either built-in CSL, run rendered-output fixtures with the
  latest released plugin and the 2.0 candidate. Record exact CSL hashes and
  plugin versions. Cover multi-cite separators, hereinafter, Break id.,
  suffixes/URLs, year suppression, and numeral-ending titles. Preserve output
  contracts required by older plugins at the existing automatically synced IDs.
- If a CSL change breaks those contracts, hold publication at those IDs until
  a compatible transition is designed. This is a release-process gate; the
  current runtime has no compatibility-version or hash allowlist. Journal
  abbreviation and its associated CSL changes are deferred.

## Verification

The Node harness passes as of 2026-09-12 in America/Chicago, UTC, and Asia/Kolkata.
The 2026-09-12 live test imported the exact published CSL bytes but reported
`unverified` because of the timezone bug; the timestamp fix is in test build
`1.3.3.2`. A second timestamp-only publication then passed live verification: the user saw
`Updated 1 style`, installed bytes exactly matched GitHub Pages, and diagnostics
reported one update, one up-to-date style, and zero failed/unverified checks.
Combined document-refresh/lifecycle tests remain pending.
Keep detailed evidence hidden and enter dated results with exact versions in
the roadmap. Do not equate mocked tests with Zotero or word-processor validation.

Automated coverage: timestamp offsets and equality, missing styles/no fetch,
wrong IDs, network/validation failure, exact-byte installation, post-install
uncertainty, mixed status, throttle/clock rollback, string-pref writes, shared
runs, cancellation, command/local-state rechecks, installer rejection,
post-install verification waits, and update/preference/lifecycle interactions.

Live checks on disposable test styles/documents:

1. Side-load a freshly versioned untracked test XPI; verify internal manifest
   and module contents. Never publish tests through the production update JSON.
2. Verify delayed/throttled startup, resetting lastCheck, disabled automatic
   checks, independent manual button, real pane sandbox, and missing styles.
3. Install an older test copy of each built-in and confirm silent update to
   the newer published copy, then no reinstall on another check.
4. Exercise controlled network/HTTP failure, invalid XML, wrong ID, validation
   failure, mixed outcomes, and uncertain installs. Check actual file effects
   against the pre-/post-install distinction.
5. Refresh Word/LibreOffice while requesting updates; verify deferral,
   propagation, repeat-refresh stability, disable/upgrade, and later et-al
   interactions. Record results before calling the feature verified.

Choose the next test version from release/branch history, not an old example.
No XPI is committed and no test build enters the production update manifest.

Startup repair is implemented in test build 1.3.3.7. The dedicated Node suite
covers missing/existing main, experimental-only profiles, removal/reinstallation,
validation and verification failures, visible notification calls, cancellation,
active commands, manual-install races, and startup/manual-check ordering.
Live Zotero notification appearance and integration behavior remain pending.

## 2026-10-31 review fixes

Implemented for test build `1.3.3.10`: native `resetSessionStyles` promises are
observed by the shared coordinator and awaited through installer completion,
failure, disable and upgrade; metadata uses direct namespaced XML elements;
and automatic/Settings installations check title and destination-file collisions
before touching styles. Success notices follow native-reset completion. Tests
model Zotero’s detached reset instead of awaiting it inside the installer mock.
See the roadmap for the final verification record and remaining live gates.

October 31 memo hardening (1.3.3.11): the command gate is independent of the
optional et-al feature, owns `Integration.__bcfStyleGate`, and migrates legacy
Style-prototype coordinators synchronously. Bootstrap isolates et-al loading
and synchronous/asynchronous setup errors; regression tests verify that missing
main-style repair still runs. All detached-reset exclusion guarantees remain.
