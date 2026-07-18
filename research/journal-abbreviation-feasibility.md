# Feasibility analysis: bulk "Journal Abbr." fixer for the Zotero library

> **Status: feasibility study, not slated for implementation.** This documents
> whether the feature is buildable, the hard parts, the recommended shape, and
> the effort — so the decision to build (and the design) can be made later.

## Context / problem

Importing journal articles from JSTOR, HeinOnline, publisher pages, etc. either
leaves Zotero's **Journal Abbr.** (`journalAbbreviation`) field empty or fills
it with a non-Bluebook abbreviation. For a Bluebook law-review workflow the
correct short form (e.g. *Yale L.J.*, *Harv. L. Rev.*) matters, and there is no
native fix:

- Zotero's automatic abbreviation runs **only at render time inside the
  word-processor plugin** and uses **Index Medicus/MEDLINE** format
  (*Proc. Natl. Acad. Sci. U. S. A.*) — not Bluebook. Confirmed on
  [Zotero's KB](https://www.zotero.org/support/kb/journal_abbreviations).
- Per Zotero docs, if `journalAbbreviation` is empty on import "there's no way
  to automatically populate it later." There is **no built-in bulk populate**.

So the goal — a tool that sweeps selected library items, computes the correct
Bluebook abbreviation of the publication title, and writes it into
`journalAbbreviation` — fills a real gap. Bluebook abbreviation rules are
codified in **Table T6** (the old periodical-word table T13.2 was merged into
T6 in the 21st ed.), **T10** (geographic), and **T13** (alphabetical list of
select periodicals + common words), with "one abbreviation per word." That is a
finite, implementable spec.

## Verdict

**Technically feasible, low risk.** The Zotero item read/write API is stable and
the UI-trigger pattern (window-watcher + DOM injection) is already proven in
this repo. With the **table + lightweight fallback** design, the failure mode is
benign: the fallback abbreviates only words it knows and leaves the rest alone,
so an unknown title comes out *partially* abbreviated rather than confidently
wrong.

**Where the actual cost lives.** The plumbing (menu, sweep, prefs, build/release)
is a known quantity — a day or two of copying proven patterns from the two
existing plugins. The real risk surface is the **engine**: the notation parser
(bracket stems, paired positional brackets, optional in/out segments) and
especially the **institutional-aware spacing pass** (knowing *U.* in *U. Chi.*
closes up but *U.* in *N.Y.U.* sets off). That spacing pass is the one genuinely
hard sub-problem, solvable only because each map entry carries an `institutional`
flag. Curating the exceptions table over time is the long-tail cost; the spacing
pass is the *upfront* one.

**Recommended next step before committing: build the Phase-1 spike engine.**
`engine.abbreviate(title)` is pure string logic, fully testable in the existing
`vm` harness with zero Zotero. The scary part (correctness) is therefore the
*cheap* part to de-risk. Write the fixture table and a spike engine, confirm the
spacing/notation rules actually compose, and you'll know whether the feature is
real before writing a line of plugin plumbing. That spike — not more design — is
the feasibility test to run next.

## Decisions taken (this study)

- **Rule source: hybrid (table + lightweight fallback)** — exact curated lookup
  table for known journals first; if no hit, a **simple common-word
  substitution + stopword deletion** pass (not a full T6/T10/T13 engine):
  word-by-word abbreviate a small curated list (*Law* → *L.*, *Review* → *Rev.*
  so *Law Review* → *L. Rev.*, *Journal* → *J.*, *Policy* → *Pol'y*, …) and
  delete connective words (*of*, *the*, *for*, *in*; *and* → *&*).
- **Safety: scoped, no preview** — operate on the current selection or a
  collection (`ZoteroPane.getSelectedItems()`), write immediately, **never sweep
  the whole library unprompted**.
- **Packaging: new standalone sibling plugin** (own `manifest.json`,
  `bootstrap.js`, `update-*.json`). A library-data mutator is conceptually
  unrelated to the render-time citation rewriter and should version/install
  independently.

## Repo reuse inventory (from exploration)

This is **greenfield for library writes** — verified: no existing code calls
`setField` / `saveTx` / `executeTransaction` anywhere in the repo. The one
library touch is a read-only `Zotero.Items.get(id)` + `itemToCSLJSON` in
`bluebook-citations-fixer/lib/session-run.js:83`. Reusable as templates (copy,
don't share — plugins share no code):

- **Bootstrap lifecycle & Zotero resolution** — `bluebook-citations-fixer/bootstrap.js:31`
  (`_resolveZotero()` handling Zotero 7/10/legacy; `await Zot.initializationPromise`;
  `loadSubScript` loader pattern).
- **Window-watcher UI injection** — `Services.ww.registerNotification` +
  `domwindowopened` in `bluebook-citations-fixer/lib/dialog.js:32` and
  `bluebook-signals/bootstrap.js:121`. The menu-injection idiom for adding a
  trigger is in `bluebook-signals` (XUL `menupopup`/`menuitem` creation).
- **Prefs pane** — `PreferencePanes.register({ src, scripts, label })` at
  `bluebook-citations-fixer/bootstrap.js:66`; auto-bound `preference="..."`
  controls in `prefs.xhtml`; defaults in `prefs.js`; action-button wiring
  (`addEventListener("command", …)`) in `prefs-pane.js`.
- **Build/release** — `build.sh` (zips root files), gitignored `releases/` that
  are force-added to dev branches, root `update-*.json` served via GitHub Pages,
  `manifest.json` `update_url`. A new plugin needs its **own**
  `update-journal-abbr.json` + matching `update_url`, or Zotero will delete it
  on the missing-JSON 404 (the auto-update invariant in CLAUDE.md).
- **Node test harness** — `tests/run-node-tests.js` loads pure lib files into a
  `vm` context with stubbed `Zotero`. **The abbreviation engine is pure string
  logic and is fully unit-testable here without a running Zotero** — this is the
  most important reuse, since correctness is the main risk.

## Proposed architecture (new plugin `bluebook-journal-abbr/`)

```
bluebook-journal-abbr/
├── manifest.json            # new id + update_url -> update-journal-abbr.json
├── bootstrap.js             # startup: resolve Zotero, load lib, register menu + prefs
├── chrome.manifest
├── build.sh
├── prefs.js / prefs.xhtml / prefs-pane.js   # options + table editor/import
├── locale/en-US/*.ftl       # optional (existing plugins use static labels)
└── lib/
    ├── abbrev/
    │   ├── table.js         # SMALL exceptions table: full-title -> abbr for
    │   │                    #   cases the maps can't compose (single-word
    │   │                    #   titles, journal-specific overrides, acronym
    │   │                    #   journals: JAMA/NEJM/PNAS)
    │   ├── words-t6.js      # T6/T13 word map (~250 entries, user-supplied)
    │   ├── institutions.js  # institutional/geographic/proper-noun map
    │   │                    #   (user-supplied: Harv., Colum., N.Y.U., UCLA,
    │   │                    #   B.C., …) — entries carry an `institutional`
    │   │                    #   flag for the spacing pass + a literal rendered
    │   │                    #   form (periods vs none)
    │   └── engine.js        # phrase/word substitute -> stopword drop ->
    │                        #   first-word rule -> close-up spacing pass
    ├── sweep.js             # iterate selected/collection items, apply, saveTx
    └── menu.js              # inject "Fix Journal Abbreviations" menu item
```

### Trigger & sweep (the easy part)
- Inject a menu item into `zotero-itemmenu` (right-click on selected items) and
  optionally `zotero-collectionmenu`. No menu precedent in-repo, but it's the
  same window-watcher + element-creation idiom as `bluebook-signals`.
- Gather scope: `ZoteroPane.getSelectedItems()` (or the selected collection's
  items). Filter to `item.itemType === "journalArticle"` (the only type with a
  `journalAbbreviation` field; verify against `Zotero.ItemFields`).
- Per item: read `item.getField("publicationTitle")`, compute abbreviation,
  read existing `item.getField("journalAbbreviation")`, then
  `item.setField("journalAbbreviation", abbr)`. Batch the writes inside one
  `Zotero.DB.executeTransaction(async () => { … await item.save(); … })` (faster
  and atomic) rather than per-item `saveTx()`.
- Guard read-only libraries: skip items whose `Zotero.Libraries.get(libraryID)`
  is not `editable` (group libraries).

### Abbreviation engine (bounded, but more than a flat map)
The data is supplied (the two user lists), which is the big win. The *logic*,
though, is a real little engine: a parser for the bracket/variant/multiword
notation, longest-phrase-first matching, stopword + single-word + first-word
rules, and the institutional-aware spacing pass. `engine.abbreviate(title)`
resolution order:
1. **Exact table hit** → return the curated abbreviation verbatim. Seed the
   table from public-domain sources (the **Indigo Book**, CC0; Cardiff Index;
   T13's periodical list) rather than copying the copyrighted Bluebook tables
   directly — note the **IP consideration**: Bluebook table *text* is
   copyrighted; the individual abbreviations are facts, but a wholesale copy of
   T6/T13 is risky. The Indigo Book is the safe basis.
2. **Word-map fallback** (only if no table hit). Pipeline order matters:
   - **a. tokenize** the title.
   - **b. omit stopwords** — exactly *a, at, in, of, the* (**retain *on***, and
     retain all other connectives like *for*; *and* → *&* via the map). [User
     rule.]
   - **c. single-word short-circuit** — if **only one word remains** after the
     omission, output that word **unchanged** (do *not* abbreviate). So
     *Jurimetrics* → *Jurimetrics*, *The Forum* → *Forum* (not *F.*). [User
     rule.] This is the precise single-word-title pass-through.
   - **d. substitute** each remaining word/phrase from the **full Bluebook
     T6/T13 word map** (~250 entries, user-supplied) and the
     **institutions/geographic map** — longest phrase first. Note
     *University* → ***U.*** in periodical names (*U. Chi. L. Rev.*) per the
     user rule. Unmapped words pass through unchanged (no guessing).
   - **e. first-word rule** — *Law* as the title's first word stays *Law*.
   - **f. close-up spacing pass** (Rule 6.1(a), below).
   So *Journal of Law and Policy* → *J. L. & Pol'y*; *Harvard Law Review* →
   *Harv. L. Rev.*

   > **Data conflict to resolve:** the T6 list you pasted has
   > `University  Univ.`, but the spacing/abbreviation rule says *University* →
   > *U.* for periodical names. Periodical context wins → use ***U.*** here;
   > the *Univ.* form belongs to institutional-author citations (a different
   > Bluebook context this tool doesn't target).

   **Data-format conventions in the supplied list** — the map is *not* a flat
   string→string lookup; a small parser is needed:
   - `Word[suffix1, suffix2]  Abbr` — a stem plus variant suffixes that all map
     to one abbreviation (e.g. `Academ[ic, y]` → *Acad.* matches *Academic* and
     *Academy*; `Environment[al]` matches *Environment* and *Environmental*).
   - `Word[a, b]  Abbr'[x, y]` — **paired positional** brackets: the Nth left
     variant maps to the Nth right variant (`Administrat[or, rix]` →
     *Adm'r* / *Adm'x*; `Execut[or, rix]` → *Ex'r* / *Ex'x*).
   - `Word1, Word2  Abbr` — alternative input words, same abbreviation
     (`Review, Revista` → *Rev.*).
   - **Multi-word phrase keys** — `American Bar Association` → *A.B.A.*,
     `Supreme Court` → *Sup. Ct.*, `United States` → *U.S.*, `Civil Rights` →
     *C.R.* Must be matched **longest-phrase-first, before single-word
     substitution**.
   - **Context rule** — `Law (first word)  Law`: *Law* stays *Law* when it is
     the title's first word, else → *L.* (so *Law & Contemp. Probs.* but
     *Harv. L. Rev.*). The engine needs token-position awareness for this.
   - **Alternate spellings** — `Year[book] (or Year Book)` → *Y.B.*
   - Apostrophes throughout are the typographic right single quote U+2019
     (*Ass'n*, *Dep't*, *Int'l*, *Pol'y*, *S'holder*, …) — confirms the glyph
     note above.

   Conventions added by the **institutions/geographic list** (second paste):
   - **Two acronym renderings, stored literally** — some entities use periods
     (*N.Y.U.*, *B.C.*, *U.C.*, *U.P.R.*), others none (*UCLA*, *CUNY*, *NEJM*,
     *PNAS*, *AIPLA*, *ASCAP*, *BYU*, *SMU*, *JAG*, *AMA*). There is **no
     derivable rule** for which — the exact form must be stored per entry.
   - **Bracketed optional input *and* output** — `[Journal of the] American
     Medical Association  [J]AMA` means *American Medical Association* → *AMA*
     and *Journal of the American Medical Association* → *JAMA*; likewise
     `New York University [School of Law]  N.Y.U.` and `Judge Advocate
     General['s]  JAG`. The optional input chunk toggles the bracketed output.
   - **Journal-specific context overrides** — `California (California Law Review
     only)  Calif.` applies only inside that one journal (elsewhere
     *California* → *Cal.*). Best modeled as a **full-title exceptions-table**
     entry, not a word rule.
   - Institutional/proper-noun entries carry the **`institutional` flag** that
     the spacing pass consumes (below).

#### Post-substitution spacing pass (Bluebook 6.1(a)) — user-supplied rule
> "In abbreviations of periodical names (see tables T6 and T13), close up all
> adjacent single capitals except when one or more of the capitals refers to
> the name of an institutional entity, in which case set the capital or
> capitals referring to the entity off from other adjacent single capitals
> with a space."

After token substitution, run a spacing pass over the result: find runs of
adjacent **single-capital** abbreviations (a single letter + period, e.g.
*L.*, *J.*) and **close them up** (drop the inter-token space) — so
*Yale L. J.* → *Yale L.J.* But if a token in/adjacent to the run is an
**institutional-entity** abbreviation, keep a space separating the entity from
the rest — e.g. *N.Y.U. L. Rev.* stays *N.Y.U. L. Rev.* (the *N.Y.U.* entity is
set off from *L.*). Multi-letter abbreviations (*Rev.*, *Cal.*, *Harv.*) are
unaffected — only single capitals close up.

**The one hard sub-problem this introduces:** the engine must know which
single-capital tokens "refer to the name of an institutional entity." That
isn't derivable from the letter alone (*U.* = University vs *U.* in *U.S.*). So
the common-word map / table entries need an **institutional flag** per entry
(e.g. *University* → *U.* tagged institutional), and the spacing pass keeps a
space around flagged tokens. This is implementable but is the part to get
test-covered carefully.

With the institutions/geographic map supplied, proper-noun and place
abbreviation **is now in scope** (*Harvard* → *Harv.*, *Columbia* → *Colum.*,
*New York University* → *N.Y.U.*). What remains for the small exceptions table:
journal-specific context overrides (*Calif.*), acronym journals (*JAMA*,
*NEJM*, *PNAS*), and anything the maps mis-compose. Words in neither map pass
through unchanged. *(The lines below predate the second paste and are now
largely covered; kept only for the residual long tail.)* Still **not
attempted**: geographic/institutional *word* abbreviation beyond the supplied
maps, single-word
-title nuances, and ordinals. An unmapped word passes through unchanged, so the
fallback under-abbreviates rather than overreaching.

**Apostrophe glyph**: emit the typographic right single quote (U+2019) in forms
like *Pol'y* / *Int'l*, matching what the Epps style/citeproc produce —
consistent with `BCF.cite.normalizeTitleMarkup` in the citations-fixer.

### Options (prefs)
- **Overwrite policy**: fill-empty-only vs overwrite-existing (default
  fill-empty-only — safest; the JSTOR-wrong-abbrev case needs overwrite, so
  expose it as an explicit toggle).
- **Algorithmic fallback on/off**: when off, only table hits are written
  (predictable, no guesses).
- **Table editor / import**: let the user add/override entries (a textarea of
  `Full Title = Abbr` lines, parsed like the citations-fixer styleID pref).

## Safety considerations

- **No batch undo in Zotero.** Mitigations: scoped-only (never whole library),
  fill-empty-only default, and a prominent one-time "back up your library / it
  will sync" notice before the first overwrite run.
  - **The overwrite path needs more than the default carries.** Fill-empty-only
    is genuinely safe — it only ever writes where there was nothing to lose. But
    overwrite (required by the motivating case, per the scoping note above)
    silently replaces existing data across synced devices and group
    collaborators, with no batch undo. For that path specifically, the
    "no preview" decision should be revisited. Minimum bar before the first
    overwrite sweep: a **confirm dialog showing the affected count + a sample of
    old→new diffs**. Stronger option: write prior values to a sidecar (e.g. an
    `extra`-field stash) so a revert sweep is possible. Do **not** ship overwrite
    on the fill-empty path's safety story alone.
- **Sync propagation**: writes go to zotero.org sync and to any collaborators on
  a group library — another reason to keep scope explicit and overwrite opt-in.
- **Idempotency**: re-running on already-correct items is a no-op (compare
  computed vs existing before writing; only `setField` on change to avoid
  bumping `dateModified` needlessly).

## Effort estimate

- **Plumbing** (new plugin scaffold, menu trigger, sweep, prefs, build/release):
  small–medium — mostly copying proven patterns from the two existing plugins.
- **Abbreviation engine + maps**: **moderate**. The two maps are supplied
  (data done), but the engine needs a notation parser (bracket stems, paired
  brackets, alt-words, optional in/out segments), longest-phrase matching, the
  stopword/single-word/first-word rules, and the institutional-aware spacing
  pass. All pure, all heavily unit-testable. Recommend phasing:
  - **Phase 0 (spike, do this first)**: pure `engine.abbreviate()` + `vm`
    fixture table, no plugin. Confirms the spacing/notation rules compose before
    any plumbing is written. This is the real feasibility gate.
  - **Phase 1**: transcribe both lists into data files; implement the core
    pipeline (stopwords → single-word → substitute → first-word → spacing) over
    selected items. **Ship the overwrite toggle here, not in Phase 2** — see the
    scoping note below. Validates plumbing + the common cases.
  - **Phase 2**: notation parser for the bracket/optional-segment conventions,
    the small full-title exceptions table (Calif./JAMA/NEJM/PNAS), and a
    table/word-map editor in prefs.

  > **Scoping correction:** the motivating problem is JSTOR/HeinOnline writing a
  > *non-Bluebook* abbreviation — those fields are **wrong, not empty**. A
  > fill-empty-only Phase 1 therefore does nothing for the case that motivated
  > the tool. The overwrite toggle is a trivial branch; pull it into Phase 1 so
  > the first release actually solves the stated problem. (Default still stays
  > fill-empty-only; overwrite is the opt-in path — see Safety.)
  - **Phase 3** (optional): grow the exceptions table from real misses; tune
    the stopword/spacing edges.

## Open questions to resolve before building

Not all four are equal — two gate the data work and must be answered first; two
are post-Phase-1 tuning.

**Blockers (decide before transcribing any data):**
- **Seed-table licensing** — Indigo Book (CC0) vs hand-curated. Bluebook table
  *text* is copyrighted; this gates whether the plugin can be published at all.
- **Bluebook edition** (20th vs 21st T6 merge) — determines which word map you
  transcribe; getting it wrong means redoing the data.

**Deferrable (Phase 2+ tuning):**
- Should non-`journalArticle` types with periodical-ish fields be in scope
  (e.g. `magazineArticle`, `newspaperArticle` use `publicationTitle` too)?
- Menu placement: item context menu only, or also a Tools-menu "sweep selected"?

## Verification (when/if built)

- **Unit**: extend the `vm`-based `tests/run-node-tests.js` pattern with an
  `engine.abbreviate()` fixture table — `title → expected` cases covering
  table-vs-fallback precedence, the common-word substitutions, stopword
  deletion, *and* → *&*, the U+2019 apostrophe forms, and unmapped-word
  pass-through. Pure functions, no Zotero needed.
- **Integration (manual)**: side-load the XPI, select a handful of imported
  journal articles, run the menu action, confirm `journalAbbreviation` is
  correct, empty-only vs overwrite behaves, group-library items are skipped, and
  a second run is a no-op. Back up the library first.
