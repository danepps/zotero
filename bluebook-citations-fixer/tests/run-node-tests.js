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

const BCF = context.BCF;

function cit(id, authorFamily, shortTitle, title, position) {
    const item = {
        id,
        uris: [`http://zotero.org/users/local/items/${id}`],
        itemData: {
            author: [{ family: authorFamily }],
            "title-short": shortTitle,
            title
        }
    };
    if (position !== undefined) item.position = position;
    return item;
}

function buildRun(citationsByIndex) {
    return BCF.run.forSession({ citationsByIndex, outputFormat: "rtf" });
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        2: { citationItems: [b] },
        1: { citationItems: [a] }
    });
    assert.strictEqual(run.ambiguousKeys.size, 2);
    assert(BCF.run.isAmbiguous(run, a));
    assert(BCF.run.isAmbiguous(run, b));
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Reich", "Property", "The New Property");
    const run = buildRun({
        1: { citationItems: [a] },
        2: { citationItems: [b] }
    });
    assert.strictEqual(run.ambiguousKeys.size, 0);
}

{
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        1: { citationItems: [a] },
        2: { citationItems: [b] }
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
        1: { citationItems: [a] },
        2: { citationItems: [b] }
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
        1: { citationItems: [a] },
        2: { citationItems: [b] }
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
    const a = cit("A", "Epps", "Checks", "Checks and Balances");
    const b = cit("B", "Epps", "Asymmetry", "Adversarial Asymmetry");
    const run = buildRun({
        1: { citationItems: [a, b] }
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

console.log("bluebook-citations-fixer node tests passed");
