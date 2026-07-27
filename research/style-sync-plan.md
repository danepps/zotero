# Style Sync: auto-update the Epps Bluebook CSL styles

## Context

The bluebook-citations-fixer style gate (`lib/patch.js:_styleAllowed`) compares style IDs
only, so a stale installed copy of the Epps Bluebook style passes the gate silently and
renders citations with outdated rules. Zotero's own style auto-update covers only styles
hosted on zotero.org/styles — the Epps styles at `danepps.github.io/bluebook/` never
update automatically. This feature closes that gap: check the installed copies against
the hosted CSL and silently install when the remote's `<updated>` timestamp is strictly
newer.

**Requirements (confirmed with the user):**
- **Sync mode:** silent auto-update — no prompt; a pref can disable it.
- **Triggers:** (a) automatic check shortly after Zotero startup, throttled to at most
  once per 24h; (b) manual "Check for style updates" button in the Settings pane.
- **Scope:** both built-ins (`BluebookDSEStyle.csl`, `BluebookDSEStyle-Experimental.csl`),
  but **only when already installed** — never auto-install a missing style (the pane's
  existing "Install style" button covers that case).

This is the plugin's **first network code**. Failure contract: all failures (network,
404, parse, install) are silent to the user — diag/Error Console only, never a dialog,
and **never uninstall or modify the local style on failure** (explicitly the opposite of
Zotero's plugin-update-manifest behavior, where a 404ing update JSON deletes the plugin).

Feasibility anchors already in the codebase:
- The pane already installs styles by URL: `Zotero.Styles.install({ url: id }, id, true)`
  at `prefs-pane.js:193` — the style IDs are their own download URLs, and the 3rd arg
  `true` suppresses the overwrite-confirmation dialog. Style sync reuses this exact call.
- Installed Zotero Style objects carry an `updated` field parsed from the CSL
  `<updated>` element, giving a local timestamp to compare against.
- `lib/patch.js:31-38` has the one-shot `nsITimer` pattern to defer work off startup.
- `lib/session-run.js:36-49` has the pref-read pattern (try/catch + hardcoded fallback,
  Node-harness safe).

## 1. New file: `bluebook-citations-fixer/lib/style-sync.js`

Loaded via `Services.scriptloader.loadSubScript` onto the shared `BCF` namespace like
every other lib file. **Nothing but `BCF.styleSync = {}` and constants run at load
time** — the Node harness vm context has no `Components`, `Zotero.HTTP`, or
`Zotero.Styles`, so all Zotero access is lazy or dependency-injected.

### Constants and state

```js
BCF.styleSync = {};
BCF.styleSync.PREF_ENABLED      = "extensions.bluebook-citations-fixer.styleSync";
BCF.styleSync.PREF_LAST_CHECK   = "extensions.bluebook-citations-fixer.styleSync.lastCheck";
BCF.styleSync.CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;  // 24h startup throttle
BCF.styleSync.STARTUP_DELAY_MS  = 60 * 1000;            // network work deferred 60s
BCF.styleSync._timer    = null;   // one-shot nsITimer; cancelled at shutdown
BCF.styleSync._inFlight = null;   // reentrancy guard: the pending check() promise
```

`lastCheck` is stored as a **string** ms-epoch (Zotero prefs have no int64).

### Style list — single source of truth

```js
// Read lazily off BCF.patch.BUILTIN_STYLE_IDS (lib/patch.js:281-284) so there is
// no third copy of the list; hardcoded fallback keeps the function total in the
// Node harness (which loads patch.js anyway) and against load-order changes.
BCF.styleSync.styleIDs = function () {
    if (BCF.patch && BCF.patch.BUILTIN_STYLE_IDS) return BCF.patch.BUILTIN_STYLE_IDS.slice();
    return [
        "https://danepps.github.io/bluebook/BluebookDSEStyle.csl",
        "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl"
    ];
};
```

### Pref helpers (mirror `session-run.js` pattern)

```js
// { enabled: bool (default true), lastCheck: number ms epoch (default 0) }
BCF.styleSync.options = function () { /* try/catch Zotero.Prefs.get(..., true) reads
    with hardcoded fallbacks; parseInt the lastCheck string, NaN -> 0 */ };
BCF.styleSync._setLastCheck = function (ms) {
    try { Zotero.Prefs.set(BCF.styleSync.PREF_LAST_CHECK, String(ms), true); } catch (_) {}
};
```

### Pure, Node-testable helpers

```js
// Extract the first <updated> element from raw CSL XML and Date.parse it.
// Regex, not DOMParser (no DOM in the Node harness; the element is flat text).
// CSL <updated> is RFC3339, which Date.parse handles as ISO 8601 (both "Z" and
// "+hh:mm" offsets). Returns ms epoch, or null when missing/unparseable.
BCF.styleSync.parseUpdated = function (cslText) {
    if (typeof cslText !== "string") return null;
    var m = /<updated[^>]*>\s*([^<]+?)\s*<\/updated>/.exec(cslText);
    if (!m) return null;
    var t = Date.parse(m[1]);
    return isNaN(t) ? null : t;
};

// Defensive read of an installed Style object's `updated` field.
// Returns ms epoch or null; null => skip sync for that style (fail SAFE —
// never install on an indeterminate comparison).
BCF.styleSync.localUpdated = function (style) { /* Date.parse(String(style.updated)) in try/catch */ };

// Strictly newer only. Equal => NOT newer (prevents a reinstall loop: Zotero
// rewrites the style file on install, timestamps match afterward, next check
// is a no-op). Either side null/NaN => false.
BCF.styleSync.isRemoteNewer = function (remoteMs, localMs) {
    return typeof remoteMs === "number" && isFinite(remoteMs) &&
           typeof localMs === "number" && isFinite(localMs) &&
           remoteMs > localMs;
};

// Startup-throttle decision. Due when enabled AND (never checked, OR >= 24h
// elapsed, OR lastCheck is in the future — clock-rollback guard so a bad
// stored value can't disable sync forever). The manual button bypasses this.
BCF.styleSync.shouldCheck = function (nowMs) { ... };

// Short status string for the Settings pane. Pure => Node-testable.
// Precedence: "Updated to YYYY-MM-DD" (newest of the updated styles) >
// "Check failed" (any failed/skipped) > "Up to date" >
// "Epps Bluebook styles not installed".
BCF.styleSync.summaryLabel = function (res) { ... };
```

### Injectable dependencies

```js
// Real implementations, resolved lazily off the context Zotero at call time.
// Builds closures only — touches no Zotero API until a member is invoked, so
// merging it in check() is harness-safe. Tests pass a complete deps object.
BCF.styleSync._defaultDeps = function () {
    return {
        now: function () { return Date.now(); },
        getStyle: async function (id) {      // installed Style object or null
            await Zotero.Styles.init();      // idempotent; get() is false pre-init
            return Zotero.Styles.get(id) || null;
        },
        fetch: async function (url) {        // raw CSL text; rejects on non-2xx
            var xhr = await Zotero.HTTP.request("GET", url, { timeout: 15000 });
            return xhr.responseText;
        },
        install: function (id) {             // same field-proven call as prefs-pane.js:193
            return Zotero.Styles.install({ url: id }, id, true);   // true = silent
        }
    };
};
```

### Per-style check — never rejects

```js
// Returns { id, status, remote?, local?, error? };
// status: "updated" | "up-to-date" | "not-installed" | "skipped" | "failed".
BCF.styleSync.checkStyle = async function (id, deps) { ... };
```

Order of operations (each step diag-logged via `BCF.diag.event("style-sync", ...)`):
1. `deps.getStyle(id)` — missing → `"not-installed"`, **no fetch** (never auto-install,
   don't waste the network round trip).
2. `localUpdated(style)` — unreadable → `"skipped"` (before any fetch).
3. `deps.fetch(id)` + `parseUpdated` — unparseable remote → `"skipped"`.
4. `isRemoteNewer(remote, local)` — false → `"up-to-date"`.
5. `deps.install(id)` → `"updated"`, log `updated <id> -> <remote ISO>`.
6. Any throw anywhere → catch, `BCF.diag.err("style-sync " + id, e)` (Error Console once
   + diag file), return `"failed"`. Local style untouched.

### Top-level check — reentrancy + throttle bookkeeping

```js
// Sequential over styleIDs() (two styles; parallelism not worth it). Resolves
// to { results, counts: {updated, upToDate, notInstalled, skipped, failed},
// checkedAt } and NEVER rejects. Concurrent callers (startup timer firing
// while the pane button is mid-check) share one run via _inFlight, cleared on
// settle. lastCheck is written when a run finishes — success OR failure — so
// a dead network can't turn the startup path into an every-launch fetch.
// Does NOT consult the enabled pref: only shouldCheck() does, so the manual
// pane button works even when automatic sync is switched off.
BCF.styleSync.check = function (deps) { ... };
```

### Startup scheduling + teardown

```js
// Called once from bootstrap startup(). Must not block or slow startup: the
// throttle test is two synchronous pref reads; the network work is deferred
// behind a one-shot nsITimer (+60s, pattern from lib/patch.js:31-38), which
// RE-TESTS shouldCheck() at fire time (prefs may have changed, or the pane
// button may have just run). Whole function try/catch'd — can never fail startup.
BCF.styleSync.scheduleStartupCheck = function () { ... };

// Called from bootstrap shutdown(): cancels a pending timer.
BCF.styleSync.cancel = function () { ... };
```

**Shutdown race:** `shutdown()` sets `BCF = null`, so the async bodies capture
`var sync = BCF.styleSync, diag = BCF.diag;` at function entry and use the captures
after every `await` — an in-flight check settles harmlessly after teardown (all its
side effects are already try/catch'd).

## 2. Edits to `bluebook-citations-fixer/bootstrap.js`

1. **Load line** — after `load("lib/patch.js");` (line 126): `load("lib/style-sync.js");`
   (after patch.js so `BCF.patch.BUILTIN_STYLE_IDS` exists before any check runs).
2. **Pane-sandbox bridge** — after the `BCF = {...}` construction (line 100):
   ```js
   // Expose the namespace on the Zotero object so the sandboxed Settings pane
   // script (prefs-pane.js) can reach BCF.styleSync.check().
   try { Zot.BluebookCitationsFixer = BCF; } catch (_) {}
   ```
   (prefs-pane.js runs in its own Cu.Sandbox and cannot see the bootstrap `BCF`.)
3. **Startup call** — after `_registerPrefsPane(Zot, rootURI);` (line 132):
   `BCF.styleSync.scheduleStartupCheck();`
4. **Shutdown teardown** — in `shutdown()` (line 166): first line
   `try { if (BCF && BCF.styleSync) BCF.styleSync.cancel(); } catch (_) {}`;
   and before `BCF = null;`, delete `BCF.Zotero.BluebookCitationsFixer` when it `=== BCF`.

## 3. Prefs + Settings pane

### `prefs.js` — append

```js
// Style sync: keep the installed Epps Bluebook styles (the hard-wired
// built-ins in lib/patch.js) current. Checked at most once per 24h shortly
// after startup, plus on demand from the Settings pane. Never installs a
// style that isn't already installed. lastCheck is a ms-epoch STRING because
// Zotero prefs have no int64.
pref("extensions.bluebook-citations-fixer.styleSync", true);
pref("extensions.bluebook-citations-fixer.styleSync.lastCheck", "0");
```

### `prefs.xhtml` — new groupbox between the Hereinafter (ends line 51) and About (line 52) groupboxes

```xml
<groupbox>
  <label><html:h2>Style updates</html:h2></label>
  <description>
    Automatically keeps your installed copies of the Epps Bluebook styles up
    to date. Only styles you already have installed are updated; nothing is
    installed automatically.
  </description>
  <checkbox id="bcf-style-sync-enabled"
            preference="extensions.bluebook-citations-fixer.styleSync"
            label="Automatically update the Epps Bluebook styles when a newer version is published"/>
  <hbox align="center">
    <button id="bcf-style-sync-check" label="Check for style updates"/>
    <label id="bcf-style-sync-status" value=""/>
  </hbox>
</groupbox>
```

The `preference` attribute is auto-bound by Zotero (same as `bcf-cross-footnote`) — no
script needed for the enable toggle. Static English literals, no FTL (existing convention).

### `prefs-pane.js` — add `wireStyleSync()`

Called from `init()` next to `wireLinks()` (before the `data-bcf-built` early return so
re-entry still wires it), idempotent via a `data-bcf-wired` attribute:

```js
// Manual "Check for style updates". The check logic lives in lib/style-sync.js,
// reached through Zotero.BluebookCitationsFixer (set by bootstrap.js) — this
// pane sandbox can't see the bootstrap BCF directly.
function wireStyleSync() {
    var btn = document.getElementById("bcf-style-sync-check");
    var status = document.getElementById("bcf-style-sync-status");
    if (!btn || !status) return;
    if (btn.getAttribute("data-bcf-wired") === "1") return;
    btn.setAttribute("data-bcf-wired", "1");
    btn.addEventListener("command", function () {
        var api = Zotero.BluebookCitationsFixer;
        if (!api || !api.styleSync) { status.value = "Check unavailable"; return; }
        btn.disabled = true;
        status.value = "Checking…";
        api.styleSync.check()
            .then(function (res) { status.value = api.styleSync.summaryLabel(res); })
            .catch(function (e) { report(e); status.value = "Check failed"; })
            .then(function () { btn.disabled = false; });
    });
}
```

Pane-environment rules honored: no top-level DOM access (wired under the `load`
listener / `tryInit` retry), no bare `setTimeout`, errors via the existing `report()`
→ `Zotero.logError`. The button intentionally bypasses the 24h throttle (it calls
`check()` directly, which still writes `lastCheck`, pushing the next automatic check
out 24h) and works regardless of the enable pref.

## 4. Node tests — `bluebook-citations-fixer/tests/run-node-tests.js`

1. Add `load("lib/style-sync.js");` after the patch.js load (~line 42) — this itself
   verifies the file loads cleanly in a Zotero-less vm context.
2. Helper + fixtures:
   ```js
   function syncDeps(o) {   // stub deps that record fetch/install calls
       const calls = { fetch: [], install: [] };
       const deps = {
           now: () => o.now !== undefined ? o.now : 1750000000000,
           getStyle: async (id) => (o.styles && id in o.styles) ? o.styles[id] : null,
           fetch: async (id) => { calls.fetch.push(id);
               if (o.fetchError) throw new Error("network down");
               return o.csl !== undefined ? o.csl : ""; },
           install: async (id) => { calls.install.push(id);
               if (o.installError) throw new Error("install failed"); }
       };
       return { deps, calls };
   }
   const csl = (updated) =>
       `<?xml version="1.0"?><style><info><updated>${updated}</updated></info></style>`;
   ```
3. Test cases (existing anonymous-block style, inside the trailing async IIFE where the
   style-gate tests live; pref cases via the `withPrefs` helper at lines 191-202):
   - **parseUpdated:** valid RFC3339 with `Z` and with `+00:00`; missing element → null;
     garbage timestamp → null; non-string input → null; surrounding whitespace tolerated.
   - **isRemoteNewer:** newer → true; **equal → false**; older → false; null/NaN either
     side → false.
   - **remote newer → install called** for both styles; statuses `updated`;
     `summaryLabel` → `"Updated to YYYY-MM-DD"`.
   - **remote equal/older → no install**; `up-to-date`; `"Up to date"`.
   - **style not installed → skipped without fetch:** `styles: {}` → `not-installed`,
     `calls.fetch.length === 0`, zero installs, label `"Epps Bluebook styles not installed"`.
   - **fetch failure → silent:** promise **resolves** (never rejects), `failed`, no
     install, `"Check failed"`.
   - **malformed remote CSL** → `skipped`, no install.
   - **unreadable local `updated`** (`{updated:"garbage"}`, `{}`) → `skipped`, zero fetches.
   - **throttle (`shouldCheck`):** unset prefs → true (defaults enabled/0); lastCheck 1h
     ago → false; 25h ago → true; future lastCheck (clock rollback) → true;
     enabled=false → false even when stale.
   - **lastCheck written after a run:** a `withPrefs` variant with a `set` recorder;
     after `await check(deps)`, the recorded value is the **string** `String(deps.now())`.
   - **reentrancy:** deferred fetch; two `check()` calls before resolution return the
     same promise; total fetches = 2 (one per style, not four); a third call after
     settle starts a fresh run.

## 5. Behavioral edge cases (encoded in code + tests)

- **Equality:** `remote === local` → no install (strictly-newer only).
- **Timestamps:** anything unparseable on either side → skip that style; never guess.
- **`Zotero.Styles.install({url}, url, true)`:** re-downloads the CSL itself; the tiny
  window where the remote changes between check-fetch and install-fetch is harmless
  (we'd install something even newer).
- **Remote 404 / network down:** `"failed"`, logged, local style **never** touched.
- **Missing style:** `"not-installed"`, no fetch, no install.
- **Startup cost:** two sync pref reads; network deferred 60s behind a one-shot nsITimer.
- **Shutdown:** timer cancelled; in-flight check settles on captured locals.
- **lastCheck written on failed runs too** — no every-launch retry on a dead network.

## 6. Docs (same commit, per CLAUDE.md rules)

- **`CLAUDE.md`:** add `style-sync.js` to the lib file-layout tree; new `### Style sync`
  subsection after `### Style gate` stating the contract (built-ins only via
  `BCF.patch.BUILTIN_STYLE_IDS`, installed-only, strictly-newer `<updated>` compare,
  silent failures / never uninstall, the two prefs, 24h throttle behind a one-shot
  nsITimer, `Zotero.BluebookCitationsFixer` exposure for the pane, `check()` never
  rejects + reentrancy guard, manual button ignores throttle and enable pref).
- **`AGENTS.md`:** mirror the identical edits — the two files must agree.
- **`bluebook-citations-fixer/README.md`:** add a Current Features bullet. Do **not**
  bump "Latest Released Version" or add a Release History entry (no release in this
  scope). Do **not** touch repo-root `README.md`.
- **No `build.sh` change** (globs `lib/`, already ships the prefs files); **no
  `manifest.json` version bump** (release-time only).

## 7. Implementation order

1. `lib/style-sync.js` (pure helpers → checkStyle/check → schedule/cancel)
2. `bootstrap.js` wiring (load line, exposure, startup call, shutdown teardown)
3. `prefs.js` defaults
4. `prefs.xhtml` groupbox + `prefs-pane.js` `wireStyleSync()`
5. Node tests
6. Docs (CLAUDE.md + AGENTS.md + plugin README)
7. Test build, commit, push to `claude/citations-epps-bbook-sync-s0bmdy`, open draft PR

## 8. Verification

1. **Node tests:** `node bluebook-citations-fixer/tests/run-node-tests.js` → prints
   `bluebook-citations-fixer node tests passed`, exit 0.
2. **Test XPI** per dev convention (last release is 1.3.1, so the 4-component version):
   `./bluebook-citations-fixer/build.sh 1.3.1.1`; confirm `style-sync.js` is in the zip
   (`unzip -l`); `git add -f` the XPI on the dev branch for side-loading.
3. **Manual in Zotero** (user-side; documented in the PR):
   - Install the XPI, set `extensions.bluebook-citations-fixer.diag = true`, restart →
     diag shows `startup check scheduled (+60000ms)`, then per-style
     `up to date:` / `updated ... ->` / `not installed:` lines and a `done {...counts}` line.
   - Restart again → throttled-skip line; reset `…styleSync.lastCheck` to `"0"` → runs again.
   - Doctor the installed style's `<updated>` back a year (or install an old copy),
     reset lastCheck, restart → `updated ... -> <ISO>` diag line, style replaced, no dialog.
   - Pane button: `Checking…` → `Up to date` / `Updated to YYYY-MM-DD`; with network
     down → `Check failed`, no dialog, error only in diag/Error Console.
   - Untick the enable box, reset lastCheck, restart → startup skip line; the button
     still works (manual check is independent of the enable pref).
