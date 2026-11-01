pref("extensions.bluebook-citations-fixer.diag", false);

// Style gate. The fixer always runs under the hard-wired Epps Bluebook styles
// (see BCF.patch.BUILTIN_STYLE_IDS in lib/patch.js). `allStyles` turns it on
// under every citation style; `styleID` lists EXTRA style IDs (separated by
// spaces, commas, or semicolons) it should also run under — e.g. the
// traditional Bluebook Law Review style. Surfaced as checkboxes in Settings.
pref("extensions.bluebook-citations-fixer.allStyles", false);
pref("extensions.bluebook-citations-fixer.styleID", "");

// Hereinafter (Rule 4.2(b)) eligibility controls. See lib/session-run.js.
// crossFootnote: also apply hereinafter when same-author works do NOT first
// appear in the same footnote (the frequency path). frequencyThreshold: how
// many times each such work must be cited for that path to fire.
pref("extensions.bluebook-citations-fixer.hereinafter.crossFootnote", true);
pref("extensions.bluebook-citations-fixer.hereinafter.frequencyThreshold", 3);

// Style sync: keep the installed Epps Bluebook styles (the hard-wired
// built-ins in lib/patch.js) current. Checked at most once per 24h shortly
// after startup, plus on demand from the Settings pane. Routine updates only
// touch installed styles; separate startup repair restores missing main.
// lastCheck is a ms-epoch STRING because
// Zotero prefs have no int64.
pref("extensions.bluebook-citations-fixer.styleSync", true);
pref("extensions.bluebook-citations-fixer.styleSync.lastCheck", "0");

// Built-in Epps styles only: 0 = installed style default; otherwise 3–11.
// The existing min preference now controls first citations and bibliographies.
pref("extensions.bluebook-citations-fixer.etAl.min", 0);
pref("extensions.bluebook-citations-fixer.etAl.subsequentMin", 0);

// Main-style startup repair status, separate from the routine update throttle.
pref("extensions.bluebook-citations-fixer.styleSetup.lastAttempt", "0");
pref("extensions.bluebook-citations-fixer.styleSetup.status", "");
