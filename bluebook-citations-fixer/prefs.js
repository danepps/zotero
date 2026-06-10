pref("extensions.bluebook-citations-fixer.diag", false);

// Style gate. The fixer only rewrites citations when the document's active CSL
// style matches one of these IDs exactly (separate multiple IDs with spaces,
// commas, or semicolons). Defaults to the Epps Bluebook style and its
// experimental variant so the plugin stays dormant under every other style out
// of the box. Set this pref to an empty string to apply the rules under all
// styles. See lib/patch.js.
pref("extensions.bluebook-citations-fixer.styleID", "https://danepps.github.io/bluebook/BluebookDSEStyle.csl https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl");

// Hereinafter (Rule 4.2(b)) eligibility controls. See lib/session-run.js.
// crossFootnote: also apply hereinafter when same-author works do NOT first
// appear in the same footnote (the frequency path). frequencyThreshold: how
// many times each such work must be cited for that path to fire.
pref("extensions.bluebook-citations-fixer.hereinafter.crossFootnote", true);
pref("extensions.bluebook-citations-fixer.hereinafter.frequencyThreshold", 3);
