"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = {
    BCF: { features: {} },
    console
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

const BCF = context.BCF;

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

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        2: citation(1, [b]),
        1: citation(1, [a])
    });
    assert.strictEqual(run.ambiguousKeys.size, 2);
    assert.strictEqual(run.sameFootnoteKeys.size, 2);
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
        3: citation(2, [c])
    });
    assert(BCF.run.shouldUseHereinafter(run, a));
    assert(BCF.run.shouldUseHereinafter(run, b));
    assert(!BCF.run.shouldUseHereinafter(run, c));
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    });
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a] },
        run,
        text: "Dan Epps, Checks and Balances",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Dan Epps, Checks and Balances [hereinafter {\\i{}Checks}]"
    );
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances", 1);
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    });
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
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    });
    const first = "Dan Epps, Checks and Balances [hereinafter {\\i{}Checks}]";
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
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    });
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
    const run = buildRun({
        1: citation(1, [a]),
        2: citation(1, [b])
    });
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
    const run = buildRun({
        1: citation(1, [a, b])
    });
    const out = BCF.features.hereinafter.rewrite({
        codeJson: { citationItems: [a, b] },
        run,
        text: "Dan Epps, Checks and Balances; Dan Epps, Adversarial Asymmetry",
        rtf: BCF.rtf
    });
    assert.strictEqual(
        out,
        "Dan Epps, Checks and Balances [hereinafter {\\i{}Checks}]; " +
            "Dan Epps, Adversarial Asymmetry [hereinafter {\\i{}Asymmetry}]"
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

console.log("bluebook-citations-fixer node tests passed");
