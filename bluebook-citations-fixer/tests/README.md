# Plugin tests

From the repository root:

```sh
npm ci --prefix bluebook-citations-fixer/tests --ignore-scripts
npm --prefix bluebook-citations-fixer/tests test
```

The wrapper, build, and pane scripts remain runnable with Node alone. The
regression and startup suites now also use the pinned `@xmldom/xmldom`
dependency for structural metadata checks; the et-al tests use that XML parser
and pinned `citeproc` for real citation rendering.
Neither dependency nor any test fixture is included in the XPI. Build tests need
Bash, zip, and unzip and create artifacts in a temporary copy.

Et-al coverage includes the settings values, XML mutations and unchanged content,
cache invalidation, preference propagation, original constructor errors and nested
calls, command/reset ordering, teardown and multi-instance ownership, and style
replacement. It checks 1728 first/subsequent citation and bibliography outputs across both built-ins,
books and journal articles with 2–5 and 8–11 authors, six independent
threshold combinations, and text/HTML/RTF formats. Repeated citations use
processCitationCluster with an intervening work to exercise native position
tracking without producing id. Subsequent thresholds above the first can cause
native citeproc-js to expand the first list; that processor limitation is
documented rather than patched by the plugin.

`fixtures/sources.json` records the provenance and hashes of the published CSL
fixtures and English locale. Keep the original copyright/license metadata when
updating these files; review rendered-output changes before replacing snapshots.

To additionally verify against the processor extracted from an installed Zotero
build, supply its `chrome/content/zotero/xpcom/citeproc.js` file:

```sh
BCF_CITEPROC_SOURCE=/path/to/extracted/citeproc.js node bluebook-citations-fixer/tests/run-et-al-tests.js
```

The harness uses an actual XML parser and citation processor but mocked Zotero
application APIs. It does not certify the live Settings window, word-processor
integration, Firefox's native XML parser, or citeproc-rs. Those remain manual
release checks.

Startup style repair tests cover missing main/experimental combinations,
verified silent installation, repeated startup after removal, already-installed
styles without a fetch, fetch/metadata/validation/install/verification failures,
visible success/failure notices, cancellation, active commands, racing manual
installation, startup scheduling with updates disabled, and concurrent checks.
Progress-window calls are verified with mocks; live notification appearance
still requires Zotero.

The interaction suite loads the production patch, et-al, and style-sync modules
together and uses the production shared gate. It covers an existing command, a
command arriving during installation or verification, concurrent preference
changes across three sessions, installer failure, hot upgrade, application
shutdown, cancellation, missing gates, and local style removal/newer revisions
while waiting. Native Zotero APIs remain mocked. A 30-second watchdog rejects
unresolved asynchronous tests instead of allowing Node to exit with a false pass.

Release regressions cover detached native session resets (including early rejection,
multiple resets, later commands, preference changes, disable, upgrade and shutdown),
XML comments/duplicate or nested metadata/namespaces, and title/visible-path/hidden-path/
unindexed-file collisions. Settings installations exercise the same validation and
collision path as automatic repair. The installer fixture deliberately starts the
native reset without awaiting it, matching Zotero rather than masking that race.
