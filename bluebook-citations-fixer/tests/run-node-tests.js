"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = {
    BCF: { features: {} },
    console,
    Services: {},
    Components: { classes: {}, interfaces: {}, utils: { reportError() {} } },
    Zotero: {
        Integration: {
            currentSession: null,
            Field: function () {},
            Session: function () {}
        }
    }
};
context.global = context;

function load(rel) {
    vm.runInNewContext(
        fs.readFileSync(path.join(root, rel), "utf8"),
        context,
        { filename: rel }
    );
}

load("lib/rtf.js");
load("lib/cite.js");
context.BCF.diag = { event() {}, log() {}, err() {} };
load("lib/session-run.js");
load("lib/features/hereinafter.js");
load("lib/features/journal-volume-year.js");
load("lib/features/book-at.js");
load("lib/features/id-suppress.js");
load("lib/features/registry.js");
load("lib/patch.js");

const BCF = context.BCF;
const Zotero = context.Zotero;

function cit(id, authorFamily, shortTitle, title, position, authors, extraItemData) {
    const item = {
        id,
        uris: [`http://zotero.org/users/local/items/${id}`],
        itemData: Object.assign({
            author: authors || [{ family: authorFamily }],
            "title-short": shortTitle,
            title
        }, extraItemData || {})
    };
    if (position !== undefined) item.position = position;
    return item;
}

function citation(noteIndex, citationItems) {
    return {
        citationItems,
        properties: { noteIndex }
    };
}

function buildRun(citationsByIndex) {
    return BCF.run.forSession({ citationsByIndex, outputFormat: "rtf" });
}

async function runPatch(session, codeJson, text) {
    const field = {
        async getCode() {
            return "ADDIN ZOTERO_ITEM CSL_CITATION " + JSON.stringify(codeJson);
        }
    };
    Zotero.Integration.currentSession = session;
    try {
        return await BCF.patch.run(field, text);
    } finally {
        Zotero.Integration.currentSession = null;
    }
}

{
    // Same FN, no subsequent cite anywhere in the document: even though both
    // works share an author and first appear together, neither is eligible
    // for hereinafter — a [hereinafter Short] on a work that's never cited
    // again is pure noise.
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        2: citation(1, [b]),
        1: citation(1, [a])
    });
    assert.strictEqual(run.ambiguousKeys.size, 2);
    assert.strictEqual(run.sameFootnoteKeys.size, 2);
    assert(!BCF.run.shouldUseHereinafter(run, a));
    assert(!BCF.run.shouldUseHereinafter(run, b));
}

{
    // Same FN with at least one subsequent cite for each work: both eligible.
    const a = cit("A2", "Epps", "Checks", "Checks and Balances");
    const b = cit("B2", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        1: citation(1, [a, b]),
        2: citation(2, [a]),
        3: citation(3, [b])
    });
    assert(BCF.run.shouldUseHereinafter(run, a));
    assert(BCF.run.shouldUseHereinafter(run, b));
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Reich", "Property", "The New Property");
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    });
    assert.strictEqual(run.ambiguousKeys.size, 0);
    assert.strictEqual(run.eligibleKeys.size, 0);
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(2, [b])
    });
    assert.strictEqual(run.ambiguousKeys.size, 2);
    assert.strictEqual(run.sameFootnoteKeys.size, 0);
    assert.strictEqual(run.thresholdKeys.size, 0);
    assert.strictEqual(run.eligibleKeys.size, 0);
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(2, [b]),
        3: citation(3, [a]),
        4: citation(4, [b]),
        5: citation(5, [a]),
        6: citation(6, [b])
    });
    assert.strictEqual(run.thresholdKeys.size, 2);
    assert(BCF.run.shouldUseHereinafter(run, a));
    assert(BCF.run.shouldUseHereinafter(run, b));
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const c = cit("C", "Epps", "Third", "Third Article");
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(2, [b]),
        3: citation(3, [a]),
        4: citation(4, [b]),
        5: citation(5, [a]),
        6: citation(6, [b]),
        7: citation(7, [c])
    });
    assert(BCF.run.shouldUseHereinafter(run, a));
    assert(BCF.run.shouldUseHereinafter(run, b));
    assert(!BCF.run.shouldUseHereinafter(run, c));
}

{
    const coauthors = [{ family: "Epps" }, { family: "Nelson" }];
    const a = cit("A", "Epps", "Checks", "Checks and Balances", undefined, coauthors);
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry", undefined, coauthors);
    const c = cit("C", "Epps", "Solo", "Solo Piece");
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(1, [b]),
        3: citation(2, [c]),
        4: citation(3, [a]),
        5: citation(4, [b])
    });
    assert(BCF.run.shouldUseHereinafter(run, a));
    assert(BCF.run.shouldUseHereinafter(run, b));
    assert(!BCF.run.shouldUseHereinafter(run, c));
}

// Temporarily stub Zotero.Prefs so BCF.run.options() reads the supplied values.
// Unknown pref reads throw, which BCF.run.options() catches and falls back from.
function withPrefs(prefs, fn) {
    const prev = Zotero.Prefs;
    Zotero.Prefs = {
        get(name) {
            if (Object.prototype.hasOwnProperty.call(prefs, name)) return prefs[name];
            throw new Error("unset pref " + name);
        }
    };
    try { return fn(); } finally { Zotero.Prefs = prev; }
}

{
    // crossFootnote = false: the frequency path is disabled, so a same-author
    // pair cited 3x each across different footnotes is NOT eligible...
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    withPrefs({ [BCF.run.PREF_CROSS_FOOTNOTE]: false }, () => {
        const run = buildRun({
            1: citation(1, [a]),
            2: citation(2, [b]),
            3: citation(3, [a]),
            4: citation(4, [b]),
            5: citation(5, [a]),
            6: citation(6, [b])
        });
        assert.strictEqual(run.thresholdKeys.size, 2);
        assert.strictEqual(run.eligibleKeys.size, 0);
        assert(!BCF.run.shouldUseHereinafter(run, a));
        assert(!BCF.run.shouldUseHereinafter(run, b));
    });
}

{
    // ...but with crossFootnote off, a same-footnote pair (with subsequent
    // cites) is still eligible — that path always applies.
    const a = cit("A2", "Epps", "Checks", "Checks and Balances");
    const b = cit("B2", "Epps", "Asymmetry", "Adversarial Asymmetry");
    withPrefs({ [BCF.run.PREF_CROSS_FOOTNOTE]: false }, () => {
        const run = buildRun({
            1: citation(1, [a, b]),
            2: citation(2, [a]),
            3: citation(3, [b])
        });
        assert(BCF.run.shouldUseHereinafter(run, a));
        assert(BCF.run.shouldUseHereinafter(run, b));
    });
}

{
    // frequencyThreshold = 2: a same-author pair cited only twice each across
    // different footnotes now qualifies (the default of 3 would exclude them).
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const byIndex = {
        1: citation(1, [a]),
        2: citation(2, [b]),
        3: citation(3, [a]),
        4: citation(4, [b])
    };
    // Default threshold (3): not eligible.
    const baseline = buildRun(byIndex);
    assert.strictEqual(baseline.eligibleKeys.size, 0);
    // Lowered threshold (2): eligible.
    withPrefs({ [BCF.run.PREF_THRESHOLD]: 2 }, () => {
        const run = buildRun(byIndex);
        assert.strictEqual(run.thresholdKeys.size, 2);
        assert(BCF.run.shouldUseHereinafter(run, a));
        assert(BCF.run.shouldUseHereinafter(run, b));
    });
}

// Helper: build a session where each work in `items` has at least one
// subsequent cite (so all are hereinafter-eligible under the count>=2 rule).
// Extra subsequent cites land in successive footnotes after the supplied
// initial cluster(s).
function eligibleRun(initialCitationsByIndex, items) {
    const byIndex = Object.assign({}, initialCitationsByIndex);
    const existingKeys = Object.keys(byIndex).map(Number).filter((n) => !isNaN(n));
    let nextIdx = (existingKeys.length ? Math.max(...existingKeys) : 0) + 1;
    let nextNote = nextIdx;
    items.forEach((item) => {
        byIndex[nextIdx++] = citation(nextNote++, [item]);
    });
    return buildRun(byIndex);
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Dan Epps, Checks and Balances",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Dan Epps, Checks and Balances [hereinafter Epps, {\\i{}Checks}]"
    );
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances", 1);
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Epps, supra note 4",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "Epps, {\\i{}Checks}, supra note 4");
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry", 1);
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const first = "Dan Epps, Checks and Balances [hereinafter Epps, {\\i{}Checks}]";
    const subsequent = "Epps, {\\i{}Asymmetry}, supra note 4";
    assert.strictEqual(BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: first,
        rtf: BCF.rtf
    }), first);
    assert.strictEqual(BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [b] },
        run,
        text: subsequent,
        rtf: BCF.rtf
    }), subsequent);
}

{
    const a = cit("Aid", "Kerr", "Theory", "An Equilibrium-Adjustment Theory of the Fourth Amendment");
    const b = cit("Bid", "Kerr", "Other", "The Curious History of Fourth Amendment Searches");
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const text = "Id. at 485";
    assert.strictEqual(BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text,
        rtf: BCF.rtf
    }), text);
}

{
    const a = cit("Aid2", "Kerr", "Theory", "An Equilibrium-Adjustment Theory of the Fourth Amendment");
    const b = cit("Bid2", "Kerr", "Other", "The Curious History of Fourth Amendment Searches");
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const text = "See id. at 526-27";
    assert.strictEqual(BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text,
        rtf: BCF.rtf
    }), text);
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = eligibleRun({
        1: citation(1, [a, b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a, b] },
        run,
        text: "Dan Epps, Checks and Balances; Dan Epps, Adversarial Asymmetry",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Dan Epps, Checks and Balances [hereinafter Epps, {\\i{}Checks}]; " +
            "Dan Epps, Adversarial Asymmetry [hereinafter Epps, {\\i{}Asymmetry}]"
    );
}

{
    // Two-author work: "Surname1 & Surname2, ShortTitle".
    const coauthors = [{ family: "Epps" }, { family: "Nelson" }];
    const a = cit("CA", "Epps", "Checks", "Checks and Balances", undefined, coauthors);
    const b = cit("CB", "Epps", "Asymmetry", "Adversarial Asymmetry", undefined, coauthors);
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Daniel Epps & William Ortman, Checks and Balances",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Daniel Epps & William Ortman, Checks and Balances " +
            "[hereinafter Epps & Nelson, {\\i{}Checks}]"
    );
}

{
    // Three-author work: "Surname1 et al., ShortTitle" with italic "et al.".
    const triauthors = [
        { family: "Epps" },
        { family: "Nelson" },
        { family: "Ortman" }
    ];
    const a = cit("TA", "Epps", "Checks", "Checks and Balances", undefined, triauthors);
    const b = cit("TB", "Epps", "Asymmetry", "Adversarial Asymmetry", undefined, triauthors);
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Daniel Epps et al., Checks and Balances",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Daniel Epps et al., Checks and Balances " +
            "[hereinafter Epps {\\i{}et al.}, {\\i{}Checks}]"
    );
}

{
    // Idempotency: a document already rewritten under the legacy form
    // ("[hereinafter <ShortTitle>]") must not get a second hereinafter
    // appended on reprocessing.
    const a = cit("LA", "Epps", "Checks", "Checks and Balances");
    const b = cit("LB", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const legacy = "Dan Epps, Checks and Balances [hereinafter {\\i{}Checks}]";
    assert.strictEqual(BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: legacy,
        rtf: BCF.rtf
    }), legacy);
}

{
    // Issue 3: book-like items render the author surname and short title in
    // large-and-small caps inside [hereinafter ...], not roman + italics.
    // "et al." stays italic.
    const a = cit(
        "BookA", "Taslitz", "Reconstructing",
        "Reconstructing the Fourth Amendment",
        undefined, undefined, { type: "book" }
    );
    const b = cit(
        "BookB", "Taslitz", "Treatise", "A Treatise on Search & Seizure",
        undefined, undefined, { type: "book" }
    );
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Andrew E. Taslitz, Reconstructing the Fourth Amendment",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Andrew E. Taslitz, Reconstructing the Fourth Amendment " +
            "[hereinafter {\\scaps Taslitz}, {\\scaps Reconstructing}]"
    );
}

{
    // Issue 3 — book subsequent cite: short title inserted in small caps
    // before ", supra note".
    const a = cit(
        "BookSA", "Taslitz", "Reconstructing", "Reconstructing the Fourth Amendment",
        1, undefined, { type: "book" }
    );
    const b = cit(
        "BookSB", "Taslitz", "Treatise", "A Treatise on Search & Seizure",
        undefined, undefined, { type: "book" }
    );
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "{\\scaps Taslitz}, supra note 4",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "{\\scaps Taslitz}, {\\scaps Reconstructing}, supra note 4"
    );
}

{
    // Issue 3 — two book authors: both surnames in one small-caps group.
    const coauthors = [{ family: "Taslitz" }, { family: "Friedman" }];
    const a = cit(
        "Book2A", "Taslitz", "Reconstructing", "Reconstructing the Fourth Amendment",
        undefined, coauthors, { type: "book" }
    );
    const b = cit(
        "Book2B", "Taslitz", "Treatise", "A Treatise on Search & Seizure",
        undefined, coauthors, { type: "book" }
    );
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Andrew E. Taslitz & Barry Friedman, Reconstructing the Fourth Amendment",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Andrew E. Taslitz & Barry Friedman, Reconstructing the Fourth Amendment " +
            "[hereinafter {\\scaps Taslitz & Friedman}, {\\scaps Reconstructing}]"
    );
}

{
    // Chapters are book-like in structure (the containing book is in small
    // caps in long form) but the chapter title itself is italic and the
    // chapter author is roman. A hereinafter naming the chapter follows the
    // chapter, not the book — so both the author and the short title render
    // like an article, not like a book.
    const a = cit(
        "ChapA", "Merrill", "Private and Public Law",
        "Private and Public Law",
        undefined, undefined, { type: "chapter" }
    );
    const b = cit(
        "ChapB", "Merrill", "Property and the Right to Exclude",
        "Property and the Right to Exclude",
        undefined, undefined, { type: "chapter" }
    );
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Thomas W. Merrill, Private and Public Law",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Thomas W. Merrill, Private and Public Law " +
            "[hereinafter Merrill, {\\i{}Private and Public Law}]"
    );
}

{
    // Chapter subsequent cite: short title injected in italics before
    // ", supra note", and the existing author surname (roman) is left alone.
    const a = cit(
        "ChapSA", "Merrill", "Private and Public Law",
        "Private and Public Law",
        1, undefined, { type: "chapter" }
    );
    const b = cit(
        "ChapSB", "Merrill", "Property and the Right to Exclude",
        "Property and the Right to Exclude",
        undefined, undefined, { type: "chapter" }
    );
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Merrill, supra note 4",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Merrill, {\\i{}Private and Public Law}, supra note 4"
    );
}

{
    // Regression: editing a short title in Zotero and refreshing the doc must
    // use the new title even though the field-code snapshot still has the old
    // one. _build must prefer a fresh Zotero.Items fetch over ci_.itemData.
    const staleData = { author: [{ family: "Epps" }], "title-short": "OldShort", title: "Checks and Balances" };
    const freshData = { author: [{ family: "Epps" }], "title-short": "NewShort", title: "Checks and Balances" };
    const otherData = { author: [{ family: "Epps" }], "title-short": "Asymmetry", title: "Adversarial Asymmetry" };
    const aStale = { id: 8001, uris: ["http://zotero.org/users/local/items/ST1"], itemData: staleData, position: 0 };
    const bOther = { id: 8002, uris: ["http://zotero.org/users/local/items/ST2"], itemData: otherData, position: 0 };

    const savedItems = Zotero.Items;
    const savedUtils = Zotero.Utilities;
    Zotero.Items = {
        get: function (id) {
            if (id === 8001) return { id: 8001 };
            if (id === 8002) return { id: 8002 };
            return null;
        }
    };
    Zotero.Utilities = {
        itemToCSLJSON: function (item) {
            if (item.id === 8001) return freshData;
            if (item.id === 8002) return otherData;
            return null;
        }
    };

    const run = BCF.run.forSession({
        citationsByIndex: {
            1: citation(1, [aStale, bOther]),
            2: citation(2, [aStale]),
            3: citation(3, [bOther])
        },
        outputFormat: "rtf"
    });

    Zotero.Items = savedItems;
    Zotero.Utilities = savedUtils;

    assert.strictEqual(BCF.run.itemData(run, aStale)["title-short"], "NewShort");

    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [aStale] },
        run,
        text: "Dan Epps, Checks and Balances",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Dan Epps, Checks and Balances [hereinafter Epps, {\\i{}NewShort}]"
    );
}

{
    assert.strictEqual(
        BCF.cite.shortTitle({
            "title-short": "<i>Katz</i> as Originalism",
            title: "Katz as Originalism"
        }),
        "Katz as Originalism"
    );
}

{
    // Straight apostrophes (U+0027) in short titles must be converted to the
    // typographic right single quotation mark (U+2019) to match citeproc’s
    // smart-quotes pass when rendering the first cite.
    const STRAIGHT = String.fromCharCode(0x0027); // straight apostrophe as it arrives from CSL JSON
    const CURLY    = String.fromCharCode(0x2019); // right single quotation mark as citeproc emits
    assert.strictEqual(
        BCF.cite.shortTitle({ "title-short": "Children" + STRAIGHT + "s Rights" }),
        "Children" + CURLY + "s Rights"
    );
    assert.strictEqual(
        BCF.cite.shortTitle({ "title-short": "Don" + STRAIGHT + "t Know" }),
        "Don" + CURLY + "t Know"
    );
    // Verify hereinafter injects the curly form encoded as \uc0舗{} in RTF.
    // (U+2019 decimal = 8217; citeproc-js RTF encoding: \uc0\uNNNN{})
    const item = cit("Apos", "Doe",
        "Children" + STRAIGHT + "s Rights",
        "Children" + STRAIGHT + "s Rights",
        undefined, undefined, { type: "article-journal" });
    const item2 = cit("Apos2", "Doe", "Other Work", "Other Work",
        undefined, undefined, { type: "article-journal" });
    const run = eligibleRun({
        1: citation(1, [item]),
        2: citation(1, [item2])
    }, [item, item2]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [item] },
        run,
        text: "Jane Doe, Children\\uc0\\u8217{}s Rights (2020)",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Jane Doe, Children\\uc0\\u8217{}s Rights (2020) " +
        "[hereinafter Doe, {\\i{}Children\\uc0\\u8217{}s Rights}]"
    );
}

{
    const journal = cit(
        "J1",
        "Epps",
        "Checks",
        "Checks and Balances",
        undefined,
        undefined,
        { type: "article-journal", volume: "2024", "container-title": "Yale Law Journal" }
    );
    const run = buildRun({ 1: citation(1, [journal]) });
    const out = BCF.features.journalVolumeYear.rewrite({
        codeJson: { citationItems: [journal] },
        run,
        text: "Dan Epps, Checks and Balances, 2024 Yale L.J. 15 (2023)",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "Dan Epps, Checks and Balances, 2024 Yale L.J. 15");
}

{
    const journal = cit(
        "J2",
        "Epps",
        "Checks",
        "Checks and Balances",
        undefined,
        undefined,
        { type: "article-journal", volume: "123", "container-title": "Yale Law Journal" }
    );
    const run = buildRun({ 1: citation(1, [journal]) });
    const text = "Dan Epps, Checks and Balances, 123 Yale L.J. 15 (2023)";
    assert.strictEqual(BCF.features.journalVolumeYear.rewrite({
        codeJson: { citationItems: [journal] },
        run,
        text,
        rtf: BCF.rtf
    }), text);
}

{
    const book = cit(
        "B1",
        "Epps",
        "Title 2",
        "Title 2",
        undefined,
        undefined,
        { type: "book" }
    );
    book.locator = "45";
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "Dan Epps, {\\i{}Title 2}, 45",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "Dan Epps, {\\i{}Title 2}, at 45");
}

{
    const book = cit(
        "B1b",
        "Epps",
        "Title 2",
        "Title 2",
        undefined,
        undefined,
        { type: "book" }
    );
    book.locator = "45";
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "Dan Epps, {\\i{}Title 2} 45",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "Dan Epps, {\\i{}Title 2}, at 45");
}

{
    const book = cit(
        "B1c",
        "Epps",
        "Title 2",
        "Title 2",
        undefined,
        undefined,
        { type: "" }
    );
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "Dan Epps, {\\i{}Title 2} 45",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "Dan Epps, {\\i{}Title 2}, at 45");
}

{
    const book = cit(
        "B1d",
        "Taslitz",
        "Reconstructing the Fourth Amendment: A History of Search & Seizure, 1789-1868",
        "Reconstructing the Fourth Amendment: A History of Search & Seizure, 1789-1868",
        undefined,
        undefined,
        { type: "book" }
    );
    book.locator = "59";
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "Andrew E. Taslitz, RECONSTRUCTING THE FOURTH AMENDMENT: A HISTORY OF SEARCH & SEIZURE, 1789-1868 59 (2006)",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Andrew E. Taslitz, RECONSTRUCTING THE FOURTH AMENDMENT: A HISTORY OF SEARCH & SEIZURE, 1789-1868, at 59 (2006)"
    );
}

{
    const book = cit(
        "B1e",
        "Taslitz",
        "Reconstructing the Fourth Amendment: A History of Search & Seizure, 1789-1868",
        "Reconstructing the Fourth Amendment: A History of Search & Seizure, 1789-1868",
        undefined,
        undefined,
        { type: "report" }
    );
    book.locator = "45";
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "Andrew E. Taslitz, RECONSTRUCTING THE FOURTH AMENDMENT: A HISTORY OF SEARCH & SEIZURE, 1789-1868 45 (2006)",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Andrew E. Taslitz, RECONSTRUCTING THE FOURTH AMENDMENT: A HISTORY OF SEARCH & SEIZURE, 1789-1868, at 45 (2006)"
    );
}

{
    // Regression: edition-bearing trailing parenthetical like
    // "(rev. ed. 2005)" must not block book-at. The screenshot from
    // 2026-05-23 showed Middlekauff's `Glorious Cause` cite ending in
    // "1763–1789 12 (rev. ed. 2005)" with no `, at` inserted because the
    // tail-regex only allowed `(YYYY)`.
    const book = cit(
        "B1f",
        "Middlekauff",
        "Glorious Cause",
        "The Glorious Cause: The American Revolution, 1763–1789",
        undefined,
        undefined,
        { type: "book" }
    );
    book.locator = "12";
    book.label = "page";
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "Robert Middlekauff, The Glorious Cause: The American Revolution, 1763–1789 12 (rev. ed. 2005)",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Robert Middlekauff, The Glorious Cause: The American Revolution, 1763–1789, at 12 (rev. ed. 2005)"
    );
}

{
    // Editor parenthetical: "(Sarah Smith ed., 2010)".
    const book = cit(
        "B1g",
        "Jones",
        "Title 1900",
        "Some Title 1900",
        undefined,
        undefined,
        { type: "book" }
    );
    book.locator = "45";
    book.label = "page";
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "Mary Jones, Some Title 1900 45 (Sarah Smith ed., 2010)",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Mary Jones, Some Title 1900, at 45 (Sarah Smith ed., 2010)"
    );
}

{
    // Regression: pincite "403-07" must get ", at" even when the CSL style
    // renders the range separator as an en-dash. In RTF the en-dash is the
    // control sequence \uc0\u8211{}; plainish decodes it so the action
    // check sees an en-dash while escapedLocator had a plain hyphen.
    const book = cit(
        "BA_endash",
        "Jones",
        "Short",
        "Some Title Ending in 1900",
        undefined, undefined,
        { type: "book" }
    );
    book.locator = "403-07";
    book.label = "page";
    const run = buildRun({ 1: citation(1, [book]) });
    const rtfWithEndash = "Mary Jones, Some Title Ending in 1900 403\\uc0\\u8211{}07 (2006)";
    assert.strictEqual(
        BCF.features.bookAt.rewrite({
            codeJson: { citationItems: [book] },
            run,
            text: rtfWithEndash,
            rtf: BCF.rtf
        }),
        "Mary Jones, Some Title Ending in 1900, at 403\\uc0\\u8211{}07 (2006)"
    );
    // Hyphen form (CSL style preserves hyphen) also works.
    assert.strictEqual(
        BCF.features.bookAt.rewrite({
            codeJson: { citationItems: [book] },
            run,
            text: "Mary Jones, Some Title Ending in 1900 403-07 (2006)",
            rtf: BCF.rtf
        }),
        "Mary Jones, Some Title Ending in 1900, at 403-07 (2006)"
    );
}

{
    // Regression: a page-plus-note pincite ("94 n.30", Rule 3.2(b)) must still
    // get ", at" — the locator isn't a bare page/range, so book-at must accept
    // it once it merely opens on a digit rather than requiring the whole
    // string to be numeric.
    const book = cit(
        "B1h",
        "Currie",
        "Currie",
        "The Constitution in the Supreme Court: The First Hundred Years, 1789–1888",
        undefined,
        undefined,
        { type: "book" }
    );
    book.locator = "94 n.30";
    book.label = "page";
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "David P. Currie, The Constitution in the Supreme Court: The First Hundred " +
            "Years, 1789–1888 94 n.30 (1992)",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "David P. Currie, The Constitution in the Supreme Court: The First Hundred " +
            "Years, 1789–1888, at 94 n.30 (1992)"
    );
}

{
    const book = cit(
        "B2",
        "Epps",
        "Title 2",
        "Title 2",
        undefined,
        undefined,
        { type: "book" }
    );
    book.locator = "45";
    const run = buildRun({ 1: citation(1, [book]) });
    const text = "Dan Epps, {\\i{}Title 2}, at 45";
    assert.strictEqual(BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text,
        rtf: BCF.rtf
    }), text);
}

{
    const book = cit(
        "B3",
        "Epps",
        "Title Two",
        "Title Two",
        undefined,
        undefined,
        { type: "book" }
    );
    book.locator = "45";
    const run = buildRun({ 1: citation(1, [book]) });
    const text = "Dan Epps, {\\i{}Title Two}, 45";
    assert.strictEqual(BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text,
        rtf: BCF.rtf
    }), text);
}

{
    // Regression: when a book has a short title that doesn't end in a
    // numeral but the long-form title does, the rendered first-cite still
    // ends in "<title-numeral> <locator>" and book-at must rewrite.
    const book = cit(
        "B4",
        "Stites",
        "Stites",
        "Private Interest and Public Gain: The Dartmouth College Case, 1819",
        undefined,
        undefined,
        { type: "book" }
    );
    book.locator = "78";
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "Francis N. Stites, Private Interest and Public Gain: The Dartmouth College Case, 1819 78",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Francis N. Stites, Private Interest and Public Gain: The Dartmouth College Case, 1819, at 78"
    );
}

// ---------------------------------------------------------------------------
// id-suppress: manual "Break id." correction.
// ---------------------------------------------------------------------------

// RTF escape citeproc-js emits for the U+200B sentinel, and the raw character
// the dialog stores in the cite's prefix.
const NOID_RTF = "\\uc0\\u8203{}";
const NOID = String.fromCharCode(0x200B);

{
    // Secondary source: wrong "Id." -> "Author, supra note N, at <loc>".
    // The flag rides on the prefix; the escaped sentinel rides at the head of
    // the rendered RTF. Both must be gone from the output.
    const a = cit("IDsupra", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    const aFlag = cit("IDsupra", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    aFlag.prefix = NOID;
    aFlag.locator = "526-27";
    const b = cit("IDsupraB", "Brown", "Other", "Other Piece",
        undefined, undefined, { type: "article-journal" });
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(2, [b]),
        3: citation(3, [aFlag])
    });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [aFlag] },
        run,
        text: NOID_RTF + "See id. at 526-27",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "See Kerr, {\\i{}supra} note 1, at 526-27");

    // Idempotency: feeding the output back through is a no-op even though the
    // sentinel still rides on the prefix.
    assert.strictEqual(BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [aFlag] },
        run,
        text: out,
        rtf: BCF.rtf
    }), out);
}

{
    // Same input WITHOUT the flag: untouched.
    const a = cit("IDsupra2", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    const run = buildRun({ 1: citation(1, [a]), 2: citation(2, [a]) });
    const text = "See id. at 33";
    assert.strictEqual(BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text,
        rtf: BCF.rtf
    }), text);
}

{
    // Composition: id-suppress output feeds hereinafter, which injects the
    // short title before "supra note" when the work is ambiguous.
    const a = cit("IDcomp", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    const a2 = cit("IDcompB", "Kerr", "History", "A Curious History",
        undefined, undefined, { type: "article-journal" });
    const run = eligibleRun({ 1: citation(1, [a, a2]) }, [a, a2]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "See Kerr, supra note 1, at 526-27",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "See Kerr, {\\i{}Theory}, supra note 1, at 526-27");
}

{
    // Case WITH a Short Title: "Id." -> "<i>Iqbal</i>, 556 U.S. at 678".
    const c = cit("IDcase", null, "Iqbal", "Ashcroft v. Iqbal", undefined, [],
        { type: "legal_case", volume: "556", "container-title": "U.S." });
    const cFlag = cit("IDcase", null, "Iqbal", "Ashcroft v. Iqbal", undefined, [],
        { type: "legal_case", volume: "556", "container-title": "U.S." });
    cFlag.prefix = NOID;
    cFlag.locator = "678";
    const run = buildRun({ 1: citation(1, [c]), 2: citation(2, [cFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [cFlag] },
        run,
        text: NOID_RTF + "See id. at 678",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "See {\\i{}Iqbal}, 556 U.S. at 678");
}

{
    // Case WITHOUT a Short Title: falls back to the full Case Name (italic).
    const cFlag = cit("IDcase2", null, undefined, "Ashcroft v. Iqbal", undefined, [],
        { type: "legal_case", volume: "556", "container-title": "U.S." });
    cFlag.prefix = NOID;
    cFlag.locator = "678";
    const run = buildRun({ 1: citation(1, [cFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [cFlag] },
        run,
        text: NOID_RTF + "Id. at 678",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "{\\i{}Ashcroft v. Iqbal}, 556 U.S. at 678");
}

{
    // Case missing Reporter Volume: can't build a reporter cite -> leave the
    // text (sentinel stripped) and skip.
    const cFlag = cit("IDcase3", null, "Iqbal", "Ashcroft v. Iqbal", undefined, [],
        { type: "legal_case", "container-title": "U.S." });
    cFlag.prefix = NOID;
    cFlag.locator = "678";
    const run = buildRun({ 1: citation(1, [cFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [cFlag] },
        run,
        text: NOID_RTF + "See id. at 678",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "See id. at 678");
}

{
    // Statute (deferred type): leave the text, strip the sentinel.
    const sFlag = cit("IDstat", null, "Short", "Some Act", undefined, [],
        { type: "legislation" });
    sFlag.prefix = NOID;
    const run = buildRun({ 1: citation(1, [sFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [sFlag] },
        run,
        text: NOID_RTF + "See id. at 5",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "See id. at 5");
}

{
    // Flagged but renders the long form (it's the first real cite): nothing to
    // suppress; strip the sentinel and leave the long form intact.
    const aFlag = cit("IDfirst", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    aFlag.prefix = NOID;
    const run = buildRun({ 1: citation(1, [aFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [aFlag] },
        run,
        text: NOID_RTF + "Orin S. Kerr, An Equilibrium Theory, 125 Harv. L. Rev. 476 (2011)",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Orin S. Kerr, An Equilibrium Theory, 125 Harv. L. Rev. 476 (2011)"
    );
}

{
    // Sentinel-strip robustness: raw character form and the RTF-escape form.
    assert.strictEqual(BCF.cite.stripNoId(NOID + "See id."), "See id.");
    assert.strictEqual(BCF.cite.stripNoId(NOID_RTF + "See id."), "See id.");
    assert.strictEqual(BCF.cite.hasNoId(NOID + "See"), true);
    assert.strictEqual(BCF.cite.hasNoId("See"), false);
}

{
    // Regression: citeproc italicizes "Id." per Bluebook ("{\\i{}Id.}"). The
    // rewrite must close that italic group so the short form renders roman, not
    // leave it open and italicize the whole cite. (No signal here.)
    const a = cit("IDital", "Merrill", "Common Law", "The Common Law Powers",
        undefined, undefined, { type: "chapter" });
    const aFlag = cit("IDital", "Merrill", "Common Law", "The Common Law Powers",
        undefined, undefined, { type: "chapter" });
    aFlag.prefix = NOID;
    const run = buildRun({ 1: citation(1, [a]), 2: citation(2, [aFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [aFlag] },
        run,
        text: NOID_RTF + "{\\i{}Id.}",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "{\\i{}}Merrill, {\\i{}supra} note 1");
}

{
    // Italic signal + italic "Id." in one group ("{\\i{}See id.} at 5"): the
    // signal stays italic (group closed after it), the short form roman.
    const a = cit("IDital2", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    const aFlag = cit("IDital2", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    aFlag.prefix = NOID;
    const run = buildRun({ 1: citation(1, [a]), 2: citation(2, [aFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [aFlag] },
        run,
        text: NOID_RTF + "{\\i{}See id.} at 5",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "{\\i{}See }Kerr, {\\i{}supra} note 1, at 5");
}

{
    // Signature fallback: the earlier cite (note 2) and the flagged repeat
    // (note 12) are the same source but resolve to DIFFERENT item keys
    // (duplicate library item / URI variance). The URI map would make note 12
    // point at itself; the author+title signature recovers the real target,
    // note 2.
    const early = cit("URI_A", "Merrill", "Common Law", "The Common Law Powers",
        undefined, undefined, { type: "chapter" });
    const flagged = cit("URI_B", "Merrill", "Common Law", "The Common Law Powers",
        undefined, undefined, { type: "chapter" });
    flagged.prefix = NOID;
    const run = buildRun({ 1: citation(2, [early]), 2: citation(12, [flagged]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [flagged], properties: { noteIndex: 12 } },
        run,
        text: NOID_RTF + "{\\i{}Id.}",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "{\\i{}}Merrill, {\\i{}supra} note 2");
}

{
    // Self/forward guard: the earliest known appearance is this very note (the
    // prior same-source cite is invisible to Zotero, or this is the first cite).
    // We can't form a valid supra, so leave the "Id." (sentinel stripped).
    const flagged = cit("URI_SELF", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    flagged.prefix = NOID;
    const run = buildRun({ 1: citation(5, [flagged]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [flagged], properties: { noteIndex: 5 } },
        run,
        text: NOID_RTF + "{\\i{}Id.} at 9",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "{\\i{}Id.} at 9");
}

{
    // Suffix preservation: everything after the "Id. [at <loc>]" span — e.g.
    // a user-typed explanatory parenthetical — survives the rewrite.
    const a = cit("IDsfx", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    const aFlag = cit("IDsfx", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    aFlag.prefix = NOID;
    const run = buildRun({ 1: citation(1, [a]), 2: citation(2, [aFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [aFlag] },
        run,
        text: NOID_RTF + "See id. at 5 (discussing X)",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "See Kerr, {\\i{}supra} note 1, at 5 (discussing X)");

    // Idempotency even when the kept suffix itself contains "id.": the
    // supra-note guard recognizes the rewritten form and no-ops.
    const rewritten = "See Kerr, {\\i{}supra} note 1, at 5 (discussing id.)";
    assert.strictEqual(BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [aFlag] },
        run,
        text: rewritten,
        rtf: BCF.rtf
    }), rewritten);
}

{
    // Multi-pincite scrape: "Id. at 12, 15" keeps both pages, with no stray
    // trailing punctuation captured into the locator.
    const a = cit("IDmp", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    const aFlag = cit("IDmp", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    aFlag.prefix = NOID;
    const run = buildRun({ 1: citation(1, [a]), 2: citation(2, [aFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [aFlag] },
        run,
        text: NOID_RTF + "Id. at 12, 15",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "Kerr, {\\i{}supra} note 1, at 12, 15");
}

{
    // Case rewrite keeps the suffix, and an "id." inside that suffix doesn't
    // retrigger on a later pass (the "<Vol> <Reporter>" guard catches it).
    const c = cit("IDcsfx", null, "Iqbal", "Ashcroft v. Iqbal", undefined, [],
        { type: "legal_case", volume: "556", "container-title": "U.S." });
    const cFlag = cit("IDcsfx", null, "Iqbal", "Ashcroft v. Iqbal", undefined, [],
        { type: "legal_case", volume: "556", "container-title": "U.S." });
    cFlag.prefix = NOID;
    cFlag.locator = "678";
    const run = buildRun({ 1: citation(1, [c]), 2: citation(2, [cFlag]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [cFlag] },
        run,
        text: NOID_RTF + "Id. at 678 (overruling id.)",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "{\\i{}Iqbal}, 556 U.S. at 678 (overruling id.)");
    assert.strictEqual(BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [cFlag] },
        run,
        text: out,
        rtf: BCF.rtf
    }), out);
}

{
    // Authorless secondary source (e.g. a student note): cited by title, so
    // the synthesized short form is "<i>Short Title</i>, supra note N" — the
    // same shape the style itself renders for its ordinary supra cites.
    const early = cit("NoAuth", null, "Promise", "Originalism's Promise",
        undefined, [], { type: "article-journal" });
    const flagged = cit("NoAuth", null, "Promise", "Originalism's Promise",
        undefined, [], { type: "article-journal" });
    flagged.prefix = NOID;
    flagged.locator = "30";
    const run = buildRun({ 1: citation(2, [early]), 2: citation(12, [flagged]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [flagged], properties: { noteIndex: 12 } },
        run,
        text: NOID_RTF + "Id. at 30",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "{\\i{}Promise}, {\\i{}supra} note 2, at 30");
}

{
    // Never "supra note 0": when note numbering is unavailable (noteIndex 0,
    // e.g. an in-text document), leave the "Id." (sentinel stripped).
    const early = cit("Note0", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    const flagged = cit("Note0", "Kerr", "Theory", "An Equilibrium Theory",
        undefined, undefined, { type: "article-journal" });
    flagged.prefix = NOID;
    const run = buildRun({ 1: citation(0, [early]), 2: citation(0, [flagged]) });
    const out = BCF.features.idSuppress.rewrite({
        codeJson: { citationItems: [flagged], properties: { noteIndex: 0 } },
        run,
        text: NOID_RTF + "Id. at 9",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "Id. at 9");
}

{
    // repairGroups: closes groups left open, drops unmatched closers, leaves
    // escaped braces alone.
    assert.strictEqual(BCF.rtf.repairGroups("{\\i{}abc"), "{\\i{}abc}");
    assert.strictEqual(BCF.rtf.repairGroups("abc}"), "abc");
    assert.strictEqual(BCF.rtf.repairGroups("a\\}b\\{c"), "a\\}b\\{c");
    assert.strictEqual(BCF.rtf.repairGroups("{\\i{}a}b"), "{\\i{}a}b");
}

{
    // book-at with the comma inside the italic group ("{\i{}Title 2,} 45"):
    // the splice must not eat the closing brace. repairGroups keeps the RTF
    // well-formed (at worst the italic span grows — never corrupt output).
    const book = cit("B5", "Epps", "Title 2", "Title 2",
        undefined, undefined, { type: "book" });
    book.locator = "45";
    const run = buildRun({ 1: citation(1, [book]) });
    const out = BCF.features.bookAt.rewrite({
        codeJson: { citationItems: [book] },
        run,
        text: "Dan Epps, {\\i{}Title 2,} 45",
        rtf: BCF.rtf
    });
    assert.strictEqual(out, "Dan Epps, {\\i{}Title 2, at 45}");
}

{
    // Rule 4.2(b) placement: the [hereinafter ...] bracket lands before the
    // cite's explanatory-parenthetical suffix, not after it.
    const a = cit("SfxA", "Epps", "Checks", "Checks and Balances");
    const b = cit("SfxB", "Epps", "Asymmetry", "Adversarial Asymmetry");
    a.suffix = "(discussing X)";
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Dan Epps, Checks and Balances (discussing X)",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Dan Epps, Checks and Balances [hereinafter Epps, {\\i{}Checks}] (discussing X)"
    );
}

{
    // Rule 4.2(b) placement: when the rendered citation ends with a URL,
    // the bracket goes before the URL (not after), even if the cite also has a
    // suffix that appears between the date parenthetical and the URL.
    const a = cit("UrlA", "Bellia", "Erie", "Erie and the Constitution");
    const b = cit("UrlB", "Bellia", "Asymmetry", "Adversarial Asymmetry");
    a.suffix = "(manuscript at 71)";
    const run = eligibleRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    }, [a, b]);
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Bellia, Erie (forthcoming 2026) (manuscript at 71), https://example.com/paper",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Bellia, Erie (forthcoming 2026) (manuscript at 71) [hereinafter Bellia, {\\i{}Erie}], https://example.com/paper"
    );
    // Also works with no suffix — just a URL at the tail.
    const c = cit("UrlC", "Clark", "Erie", "Erie and the Constitution");
    const d = cit("UrlD", "Clark", "Other", "Other Work");
    const run2 = eligibleRun({
        1: citation(1, [c]),
        2: citation(1, [d])
    }, [c, d]);
    const out2 = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [c] },
        run: run2,
        text: "Clark, Erie (2024), https://example.com/paper",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out2,
        "Clark, Erie (2024) [hereinafter Clark, {\\i{}Erie}], https://example.com/paper"
    );
}

{
    // Authorless works still land in the first-note map (id-suppress needs a
    // supra target even though they can't join the author-ambiguity buckets).
    const noAuth = cit("NAmap", null, "Promise", "Originalism's Promise",
        undefined, [], { type: "article-journal" });
    const run = buildRun({ 1: citation(3, [noAuth]) });
    assert.strictEqual(run.itemFirstNotes.get(BCF.cite.itemKey(noAuth)), 3);
    assert.strictEqual(run.itemCounts.get(BCF.cite.itemKey(noAuth)), 1);
}

{
    // parseFieldCode is string-aware: a brace inside a citation prefix/suffix
    // (JSON does NOT escape literal braces) must not fool the boundary scanner.
    // Unmatched closer in a suffix: a naive depth counter stops early and
    // JSON.parse fails; the string-aware scanner skips it.
    const withCloser = 'ADDIN ZOTERO_ITEM CSL_CITATION ' +
        JSON.stringify({ citationItems: [{ id: 1, suffix: "see } foo" }] }) +
        ' RAW';
    const parsedCloser = BCF.cite.parseFieldCode(withCloser);
    assert(parsedCloser && parsedCloser.citationItems.length === 1);
    assert.strictEqual(parsedCloser.citationItems[0].suffix, "see } foo");

    // Unmatched opener in a prefix: a naive counter never returns to depth 0
    // inside the object and runs past the real close brace.
    const withOpener = 'ADDIN ZOTERO_ITEM CSL_CITATION ' +
        JSON.stringify({ citationItems: [{ id: 2, prefix: "see { foo" }] });
    const parsedOpener = BCF.cite.parseFieldCode(withOpener);
    assert(parsedOpener && parsedOpener.citationItems.length === 1);
    assert.strictEqual(parsedOpener.citationItems[0].prefix, "see { foo");

    // An escaped quote inside a string must not be mistaken for the string's
    // closing quote.
    const withQuote = 'ADDIN ZOTERO_ITEM CSL_CITATION ' +
        JSON.stringify({ citationItems: [{ id: 3, prefix: 'a "}" b' }] });
    const parsedQuote = BCF.cite.parseFieldCode(withQuote);
    assert.strictEqual(parsedQuote.citationItems[0].prefix, 'a "}" b');
}

{
    // itemKey handles the array uris (preferred), the array uri fallback, and
    // a singular string uri — the last of which a naive [0] index would
    // collapse to its first character.
    assert.strictEqual(
        BCF.cite.itemKey({ uris: ["http://z/items/A"] }), "http://z/items/A");
    assert.strictEqual(
        BCF.cite.itemKey({ uri: ["http://z/items/B"] }), "http://z/items/B");
    assert.strictEqual(
        BCF.cite.itemKey({ uri: "http://z/items/C" }), "http://z/items/C");
    assert.strictEqual(BCF.cite.itemKey({ id: 7 }), "id:7");
    assert.strictEqual(BCF.cite.itemKey(null), "");
}

(async function () {
    {
        const journal = cit(
            "PJ1",
            "Smith",
            "Journal Piece",
            "Journal Piece",
            undefined,
            undefined,
            { type: "article-journal", volume: "2024" }
        );
        const session = {
            outputFormat: "rtf",
            citationsByIndex: { 1: citation(1, [journal]) }
        };
        const out = await runPatch(
            session,
            session.citationsByIndex[1],
            "John Smith, Journal Piece, 2024 Yale L.J. 55 (2024)"
        );
        assert.strictEqual(out, "John Smith, Journal Piece, 2024 Yale L.J. 55");
    }

    {
        const book = cit(
            "PB1",
            "Jones",
            "History of 1868",
            "History of 1868",
            undefined,
            undefined,
            { type: "book" }
        );
        book.locator = "45";
        book.label = "page";
        const session = {
            outputFormat: "rtf",
            citationsByIndex: { 1: citation(1, [book]) }
        };
        const out = await runPatch(
            session,
            session.citationsByIndex[1],
            "Mary Jones, History of 1868 45 (2006)"
        );
        assert.strictEqual(out, "Mary Jones, History of 1868, at 45 (2006)");
    }

    {
        const journal = cit(
            "PJ2",
            "Taylor",
            "Another Journal Piece",
            "Another Journal Piece",
            undefined,
            undefined,
            { type: "article-journal", volume: "2023" }
        );
        const session = {
            outputFormat: "rtf",
            citationsByIndex: { 1: citation(1, [journal]) }
        };
        session.citationsByIndex[1].text =
            "Alex Taylor, Another Journal Piece, 2023 Harv. L. Rev. 10 (2023)";
        BCF.patch._prepareCitationTexts(session);
        assert.strictEqual(
            session.citationsByIndex[1].text,
            "Alex Taylor, Another Journal Piece, 2023 Harv. L. Rev. 10"
        );
    }

    {
        // Issue 2: book-at must still rewrite ", at" when the cite is *also*
        // hereinafter-eligible. Before the registry reorder, hereinafter ran
        // first, appended "[hereinafter ...]" to the end of the segment, and
        // book-at's $-anchored regex silently no-opped.
        const a = cit(
            "BAH1", "Taslitz", "Reconstructing",
            "Reconstructing the Fourth Amendment: A History of Search & Seizure, 1789-1868",
            undefined, undefined, { type: "book" }
        );
        a.locator = "59";
        a.label = "page";
        const b = cit(
            "BAH2", "Taslitz", "Treatise", "A Treatise on Search & Seizure",
            undefined, undefined, { type: "book" }
        );
        const session = {
            outputFormat: "rtf",
            citationsByIndex: {
                1: citation(1, [a]),
                2: citation(1, [b]),
                3: citation(2, [a]),
                4: citation(3, [b])
            }
        };
        const out = await runPatch(
            session,
            session.citationsByIndex[1],
            "Andrew E. Taslitz, Reconstructing the Fourth Amendment: A History of Search & Seizure, 1789-1868 59 (2006)"
        );
        assert.strictEqual(
            out,
            "Andrew E. Taslitz, Reconstructing the Fourth Amendment: A History of Search & Seizure, 1789-1868, at 59 (2006) " +
                "[hereinafter {\\scaps Taslitz}, {\\scaps Reconstructing}]"
        );
    }

    {
        // Output-format gate on the prewrite pass: HTML (Google Docs) and
        // plain-text sessions must pass through untouched — the chain emits
        // RTF fragments.
        const journal = cit(
            "HG1", "Smith", "Gate Piece", "Gate Piece",
            undefined, undefined, { type: "article-journal", volume: "2024" }
        );
        const RAW = "John Smith, Gate Piece, 2024 Yale L.J. 55 (2024)";
        const s = {
            outputFormat: "html",
            citationsByIndex: { 1: citation(1, [journal]) }
        };
        s.citationsByIndex[1].text = RAW;
        BCF.patch._prepareCitationTexts(s);
        assert.strictEqual(s.citationsByIndex[1].text, RAW);
    }

    {
        // While _updateDocument's prewrite pass is active, the setText hook
        // short-circuits (the cluster text was already rewritten upstream).
        // Delayed citations and other writes outside _updateDocument (no flag)
        // still get the full chain.
        const journal = cit(
            "PA1", "Smith", "Active Piece", "Active Piece",
            undefined, undefined, { type: "article-journal", volume: "2024" }
        );
        const RAW = "John Smith, Active Piece, 2024 Yale L.J. 55 (2024)";
        const session = {
            outputFormat: "rtf",
            citationsByIndex: { 1: citation(1, [journal]) }
        };
        session.__bcfPrewriteActive = true;
        assert.strictEqual(
            await runPatch(session, session.citationsByIndex[1], RAW), RAW);
        session.__bcfPrewriteActive = false;
        assert.strictEqual(
            await runPatch(session, session.citationsByIndex[1], RAW),
            "John Smith, Active Piece, 2024 Yale L.J. 55");
    }

    {
        // Style gate: the Epps Bluebook styles are HARD-WIRED (always allowed);
        // the styleID pref lists extra styles; the allStyles pref disables the
        // gate. Reuse journal-volume-year (strips a trailing "(YYYY)" when the
        // volume is itself that year) as an observable rewrite to gate on.
        const MAIN = "https://danepps.github.io/bluebook/BluebookDSEStyle.csl";
        const EXPERIMENTAL = "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl";
        const TRADITIONAL = "http://www.zotero.org/styles/bluebook-law-review";
        const APA = "http://www.zotero.org/styles/apa";
        const PREF_EXTRAS = "extensions.bluebook-citations-fixer.styleID";
        const PREF_ALL = "extensions.bluebook-citations-fixer.allStyles";

        function journalSession(styleID) {
            const journal = cit(
                "SG1", "Lopez", "Gate Piece", "Gate Piece",
                undefined, undefined, { type: "article-journal", volume: "2024" }
            );
            const session = {
                outputFormat: "rtf",
                citationsByIndex: { 1: citation(1, [journal]) }
            };
            if (styleID !== undefined) session.data = { style: { styleID } };
            session.citationsByIndex[1].text =
                "Maria Lopez, Gate Piece, 2024 Yale L.J. 5 (2024)";
            return session;
        }
        const GATED = "Maria Lopez, Gate Piece, 2024 Yale L.J. 5";       // (2024) stripped
        const RAW = "Maria Lopez, Gate Piece, 2024 Yale L.J. 5 (2024)";  // untouched

        // (a) Built-in styles always pass, with NO pref configuration at all.
        withPrefs({}, () => {
            for (const id of [MAIN, EXPERIMENTAL]) {
                const s = journalSession(id);
                BCF.patch._prepareCitationTexts(s);
                assert.strictEqual(s.citationsByIndex[1].text, GATED);
            }
        });

        // (b) Any other style is blocked by default...
        withPrefs({}, () => {
            const s = journalSession(APA);
            BCF.patch._prepareCitationTexts(s);
            assert.strictEqual(s.citationsByIndex[1].text, RAW);
        });

        // (c) ...unless listed in the extras pref (e.g. the traditional
        // Bluebook Law Review checkbox) — any separator works...
        for (const extras of [TRADITIONAL, TRADITIONAL + ", " + APA, APA + ";" + TRADITIONAL]) {
            withPrefs({ [PREF_EXTRAS]: extras }, () => {
                const s = journalSession(TRADITIONAL);
                BCF.patch._prepareCitationTexts(s);
                assert.strictEqual(s.citationsByIndex[1].text, GATED);
            });
        }

        // (d) ...or allStyles is on (gate disabled).
        withPrefs({ [PREF_ALL]: true }, () => {
            const s = journalSession(APA);
            BCF.patch._prepareCitationTexts(s);
            assert.strictEqual(s.citationsByIndex[1].text, GATED);
        });

        // (e) Style unreadable -> fail open (rewrite), never silently dark.
        withPrefs({}, () => {
            const s = journalSession(undefined); // no session.data.style
            BCF.patch._prepareCitationTexts(s);
            assert.strictEqual(s.citationsByIndex[1].text, GATED);
        });

        // Direct predicate checks, including the fallback styleID locations
        // and the legacy "(none)" sentinel (filtered out of extras; built-ins
        // unaffected).
        withPrefs({ [PREF_EXTRAS]: TRADITIONAL }, () => {
            assert(BCF.patch._styleAllowed({ data: { style: { styleID: MAIN } } }));
            assert(BCF.patch._styleAllowed({ data: { style: { styleID: TRADITIONAL } } }));
            assert(!BCF.patch._styleAllowed({ data: { style: { styleID: APA } } }));
            assert(BCF.patch._styleAllowed({}));                 // unknown -> fail open
            assert(BCF.patch._styleAllowed({ styleID: MAIN }));  // session.styleID fallback
        });
        withPrefs({ [PREF_EXTRAS]: "(none)" }, () => {
            assert(BCF.patch._styleAllowed({ data: { style: { styleID: MAIN } } }));
            assert(!BCF.patch._styleAllowed({ data: { style: { styleID: "(none)" } } }));
            assert(!BCF.patch._styleAllowed({ data: { style: { styleID: APA } } }));
        });
    }

    console.log("bluebook-citations-fixer node tests passed");
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
