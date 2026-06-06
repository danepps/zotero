pref("extensions.bluebook-citations-fixer.diag", false);

// Hereinafter (Rule 4.2(b)) eligibility controls. See lib/session-run.js.
// crossFootnote: also apply hereinafter when same-author works do NOT first
// appear in the same footnote (the frequency path). frequencyThreshold: how
// many times each such work must be cited for that path to fire.
pref("extensions.bluebook-citations-fixer.hereinafter.crossFootnote", true);
pref("extensions.bluebook-citations-fixer.hereinafter.frequencyThreshold", 3);
