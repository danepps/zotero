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
