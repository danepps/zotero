"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
let CSL = require("citeproc");
// Optional verification against the exact processor bundled in a Zotero build.
if (process.env.BCF_CITEPROC_SOURCE) {
    const processorContext = { console };
    vm.createContext(processorContext);
    vm.runInContext(fs.readFileSync(process.env.BCF_CITEPROC_SOURCE, "utf8"), processorContext);
    CSL = processorContext.CSL;
}
const root = path.resolve(__dirname, "..");
const fixtures = path.join(__dirname, "fixtures");
const { MAIN, EXP, NS, codec, sample, minimumOf, tick, deferred, fixture, instance } = require("./helpers/engine-fixture");

async function memoizationTests() {
    const f = fixture(); f.pref = 3;
    let reads = 0, parses = 0;
    const original = f.Style.prototype.getXML;
    f.Style.prototype.getXML = function () { reads++; return original.call(this); };
    f.dependencies.parse = xml => { parses++; return codec.parse(xml); };
    const owner = instance(f); await owner.start();
    const style = f.styles[MAIN];
    const before = { reads, parses };
    for (let i = 0; i < 4; i++) style.getCiteProc("en-US", "text", { cache: true });
    assert.strictEqual(reads, before.reads); assert.strictEqual(parses, before.parses);
    f.change(4); await owner.api.whenSettled();
    assert.strictEqual(reads, before.reads + 1); assert.strictEqual(parses, before.parses + 1);
    f.styles[MAIN] = new f.Style(MAIN);
    f.styles[MAIN].getCiteProc();
    assert.strictEqual(reads, before.reads + 2); assert.strictEqual(parses, before.parses + 2);
    // A foreign reader replacement on the same object invalidates the memo.
    style.getXML = () => sample(MAIN).replace('<name/>', '<name form="short"/>');
    assert(style.getCiteProc().xml.includes('form="short"'));
    assert.strictEqual(parses, before.parses + 3);
    await owner.stop(); owner.patch.uninstall();
}
async function statusTests() {
    const f = fixture(); f.pref = 3; let notices = 0;
    f.dependencies.notify = () => { notices++; };
    f.styles[MAIN].xml = sample(MAIN, 'et-al-use-last="true"');
    const owner = instance(f); await owner.start();
    assert.strictEqual(owner.api.status().length, 1);
    assert.strictEqual(owner.api.status()[0].reason, "unsupported name options in this style version");
    const before = notices;
    f.styles[MAIN].getCiteProc(); assert.strictEqual(notices, before, "duplicate failure notification");
    // An uncached failed transform can succeed on retry; no stale warning.
    f.styles[MAIN].xml = sample(); f.styles[MAIN].getCiteProc();
    assert.strictEqual(owner.api.status().length, 0); assert(notices > before);
    f.styles[MAIN] = new f.Style(MAIN); f.styles[MAIN].xml = sample(MAIN, 'disambiguate-add-names="true"');
    f.styles[MAIN].getCiteProc(); assert.strictEqual(owner.api.status().length, 1);
    f.styles[MAIN] = new f.Style(MAIN);
    assert.strictEqual(owner.api.status().length, 0, "replaced revision kept old error");
    f.styles[MAIN].xml = sample(MAIN, 'et-al-use-last="true"');
    f.styles[MAIN].getCiteProc(); assert.strictEqual(owner.api.status().length, 1);
    f.change(0); await owner.api.whenSettled();
    assert.strictEqual(owner.api.status().length, 0, "Style default kept warning");
    f.change(4); await owner.api.whenSettled(); assert.strictEqual(owner.api.status().length, 1);
    await owner.stop(); assert.strictEqual(owner.api.status().length, 0); owner.patch.uninstall();
}
function retainedNameRendering(api) {
    const xml = api.rewriteXML(sample(MAIN, 'et-al-subsequent-min="3" et-al-subsequent-use-first="2"'), 4, MAIN, codec);
    const item = { id: "1", type: "book", author: ["Alpha", "Beta", "Gamma", "Delta"].map(family => ({ family })) };
    const engine = new CSL.Engine({ retrieveLocale: () => fs.readFileSync(path.join(fixtures, "locales-en-US.xml"), "utf8"),
        retrieveItem: id => id === "1" ? item : { id: "2", type: "book", author: [{ family: "Other" }] } }, xml, "en-US");
    engine.setOutputFormat("text");
    const outputs = {};
    for (const [id, note, previous] of [["1",1,[]], ["2",2,[["c1",1]]], ["1",3,[["c1",1],["c2",2]]]]) {
        const result = engine.processCitationCluster({ citationID: "c" + note, citationItems: [{ id }], properties: { noteIndex: note } }, previous, []);
        for (const row of result[1]) outputs[row[0]] = row[1];
    }
    assert.strictEqual(outputs[0], "Alpha et al.");
    assert.strictEqual(outputs[2], "Alpha et al.");
}
async function main() {
    await memoizationTests();
    await statusTests();
    const f = fixture(), first = instance(f), api = first.api;
    retainedNameRendering(api);
    for (const value of [undefined, null, -1, 1, 2, 12, 1000, 3.5, "3", NaN]) assert.strictEqual(api.option(value), 0);
    for (const value of [3, 4, 5, 6, 7, 8, 9, 10, 11]) assert.strictEqual(api.option(value), value);
    const raw = sample();
    assert.strictEqual(api.rewriteXML(raw, 0, MAIN, codec), raw);
    for (const n of [3, 4, 5]) {
        const changed = api.rewriteXML(raw, n, MAIN, codec);
        assert.strictEqual(minimumOf(changed), n);
        assert.strictEqual(api.rewriteXML(changed, n, MAIN, codec), changed);
    }
    const independent = codec.parse(api.rewriteXML(raw, 9, MAIN, codec));
    assert.strictEqual(independent.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-subsequent-min"), "9");
    const subsequentOnly = codec.parse(api.rewriteXML(raw, 0, MAIN, codec, 4));
    assert.strictEqual(subsequentOnly.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-min"), "5");
    assert.strictEqual(subsequentOnly.getElementsByTagNameNS(NS, "bibliography")[0].getAttribute("et-al-min"), "5");
    assert.strictEqual(subsequentOnly.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-subsequent-min"), "4");
    for (const option of ['et-al-use-last="true"', 'disambiguate-add-names="true"']) {
        assert.throws(() => api.rewriteXML(sample(MAIN, option), 3, MAIN, codec));
    }
    assert.throws(() => api.rewriteXML(raw, 3, EXP, codec));
    assert.throws(() => api.rewriteXML("<invalid/>", 3, MAIN, codec));
    const noBib = raw.replace(/<bibliography[\s\S]*<\/bibliography>/, "").replace('et-al-min="5"', "");
    const noBibDoc = codec.parse(api.rewriteXML(noBib, 3, MAIN, codec));
    assert.strictEqual(noBibDoc.getElementsByTagNameNS(NS, "bibliography").length, 0);
    assert.strictEqual(noBibDoc.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-min"), "3");
    const placements = raw.replace('<style xmlns=', '<style et-al-min="9" xmlns=')
        .replace('<names variable=', '<names et-al-use-first="2" variable=')
        .replace('<name/>', '<name et-al-min="7" et-al-use-first="2"/>');
    const placementDoc = codec.parse(api.rewriteXML(placements, 4, MAIN, codec));
    for (const node of Array.from(placementDoc.getElementsByTagNameNS(NS, "*"))) {
        if (node.hasAttribute("et-al-min")) {
            assert.strictEqual(node.getAttribute("et-al-min"), "4");
            assert.strictEqual(node.getAttribute("et-al-use-first"), "1");
        }
    }

    const published = sample(MAIN, 'et-al-subsequent-min="4" et-al-subsequent-use-first="1"');
    for (const [firstMin, laterMin, expected] of [[3,0,3], [0,8,5], [6,0,4], [4,7,4]]) {
        const doc = codec.parse(api.rewriteXML(published, firstMin, MAIN, codec, laterMin));
        assert.strictEqual(doc.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-subsequent-min"), String(expected));
    }
    const inheritedNames = published.replace('<name/>', '<name et-al-use-first="2"/>');
    const namesDoc = codec.parse(api.rewriteXML(inheritedNames, 3, MAIN, codec));
    assert.strictEqual(namesDoc.getElementsByTagNameNS(NS, "name")[0].getAttribute("et-al-subsequent-min"), "3");
    const retained = sample(MAIN, 'et-al-subsequent-min="3" et-al-subsequent-use-first="2"');
    const retainedDoc = codec.parse(api.rewriteXML(retained, 4, MAIN, codec));
    assert.strictEqual(retainedDoc.getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-subsequent-use-first"), "1");
    const localFirst = published.replace('<name/>', '<name et-al-min="7" et-al-use-first="1"/>');
    const localDoc = codec.parse(api.rewriteXML(localFirst, 0, MAIN, codec, 8));
    assert.strictEqual(localDoc.getElementsByTagNameNS(NS, "name")[0].getAttribute("et-al-subsequent-min"), "7");
    const bibliographyNames = published.replace('<text variable="title"/>', '<names variable="author"><name et-al-min="8" et-al-use-first="2"/></names>');
    const bibDoc = codec.parse(api.rewriteXML(bibliographyNames, 0, MAIN, codec, 3));
    assert.strictEqual(codec.serialize(bibDoc.getElementsByTagNameNS(NS, "bibliography")[0]), codec.serialize(codec.parse(bibliographyNames).getElementsByTagNameNS(NS, "bibliography")[0]));

    await first.start();
    assert.strictEqual(f.observers.size, 2);
    const style = f.styles[MAIN];
    const inheritedXML = style.getXML;
    const cachedDefault = style.getCiteProc("en-US", "html", { cache: true });
    f.change(3);
    await api.whenSettled();
    for (const format of ["rtf", "html", "text"]) {
        const engine = style.getCiteProc("en-US", format, { cache: true });
        assert.strictEqual(minimumOf(engine.xml), 3);
        assert.notStrictEqual(engine, cachedDefault);
    }
    f.subsequent = 9; f.change(3); await api.whenSettled();
    let splitXML = style.getCiteProc("en-US", "html", { cache: true }).xml;
    assert.strictEqual(minimumOf(splitXML), 3);
    assert.strictEqual(codec.parse(splitXML).getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-subsequent-min"), "3");
    f.subsequent = 0; f.change(3); await api.whenSettled();
    assert.strictEqual(style.getXML, inheritedXML);
    assert(!Object.hasOwn(style, "getXML"));
    assert.strictEqual(style.xml, raw, "installed CSL changed");
    assert.strictEqual(minimumOf(f.styles.other.getCiteProc().xml), 5);
    assert.strictEqual(minimumOf(f.styles[EXP].getCiteProc().xml), 3);
    const unidentified = new f.Style(MAIN);
    delete unidentified.styleID;
    assert.strictEqual(minimumOf(unidentified.getCiteProc().xml), 5);
    Object.defineProperty(unidentified, "styleID", { get() { throw new Error("unreadable identity"); } });
    assert.strictEqual(minimumOf(unidentified.getCiteProc().xml), 5);
    f.change(0); await api.whenSettled();
    assert.strictEqual(minimumOf(style.getCiteProc("en-US", "text", { cache: true }).xml), 5);
    f.change(4); f.change(5); f.change(3);
    const beforeReset = f.resets;
    await api.whenSettled();
    assert.strictEqual(f.resets - beforeReset, 1, "rapid changes did not coalesce");
    assert.strictEqual(minimumOf(f.sessions.document.engine.xml), 3);
    assert.strictEqual(f.Integration.sessions, f.sessions);

    // Preserve an own-property descriptor and restore after constructor errors
    // or nested construction. Only transformer failures delegate unchanged.
    Object.defineProperty(style, "getXML", { value: inheritedXML, configurable: true, enumerable: false, writable: false });
    const descriptor = Object.getOwnPropertyDescriptor(style, "getXML");
    const error = new Error("original engine failure");
    f.constructorAction = () => { throw error; };
    const calls = f.constructorCalls;
    assert.throws(() => style.getCiteProc(), e => e === error);
    assert.strictEqual(f.constructorCalls, calls + 1);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(style, "getXML"), descriptor);
    let nesting = false;
    f.constructorAction = current => {
        if (!nesting) { nesting = true; assert.strictEqual(minimumOf(current.getCiteProc().xml), 3); }
    };
    assert.strictEqual(minimumOf(style.getCiteProc().xml), 3);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(style, "getXML"), descriptor);
    f.constructorAction = null;
    const unsupported = new f.Style(MAIN);
    unsupported.xml = sample(MAIN, 'et-al-use-last="true"');
    assert.strictEqual(minimumOf(unsupported.getCiteProc().xml), 5);

    // A native command already active before hook entry postpones the reset.
    const native = deferred();
    f.Integration.currentDoc = true;
    f.Integration.currentCommandPromise = native.promise;
    const beforeNative = f.resets;
    f.change(4);
    await tick();
    assert.strictEqual(f.resets, beforeNative);
    f.Integration.currentDoc = false; native.resolve();
    await api.whenSettled();
    assert.strictEqual(minimumOf(f.sessions.document.engine.xml), 4);

    // A command through the hook holds the reset back; a later command waits
    // for that reset. Original results and argument lists are preserved.
    const active = deferred();
    f.command = async (...args) => { f.events.push("command:" + args[0]); await active.promise; return args; };
    const command = f.Integration.execCommand("first", 9);
    await tick();
    f.change(3);
    const next = f.Integration.execCommand("next", 10);
    await tick();
    assert(!f.events.includes("command:next"));
    active.resolve();
    assert.deepStrictEqual(await command, ["first", 9]);
    assert.deepStrictEqual(await next, ["next", 10]);
    assert(f.events.lastIndexOf("reset") < f.events.indexOf("command:next"));

    // Disable keeps the barrier until engines revert; no session is deleted.
    const resetWait = deferred();
    f.resetAction = () => resetWait.promise;
    const stopped = first.stop();
    await tick();
    const afterDisable = f.Integration.execCommand("disabled");
    await tick();
    assert(!f.events.includes("command:disabled"));
    resetWait.resolve();
    await stopped; await afterDisable;
    assert.strictEqual(f.observers.size, 0);
    assert.strictEqual(minimumOf(f.sessions.document.engine.xml), 5);
    first.patch.uninstall();
    first.context.BCF = null;

    // The latest generation owns the engine hook even under a foreign wrapper.
    const g = fixture(); g.pref = 3;
    const a = instance(g); await a.start();
    const old = g.Style.prototype.getCiteProc;
    let foreignCalls = 0;
    const foreign = function (...args) { foreignCalls++; return old.apply(this, args); };
    g.Style.prototype.getCiteProc = foreign;
    const b = instance(g); await b.start();
    await a.stop(); a.patch.uninstall(); a.context.BCF = null;
    assert.strictEqual(minimumOf(g.styles[MAIN].getCiteProc().xml), 3);
    assert(foreignCalls > 0);
    await b.stop(); b.patch.uninstall(); b.context.BCF = null;
    assert.strictEqual(g.Style.prototype.getCiteProc, foreign);
    assert.strictEqual(minimumOf(g.styles[MAIN].getCiteProc().xml), 5);

    // Disable before styles are ready cancels setup, including the observer.
    const h = fixture(), ready = deferred();
    h.dependencies.ready = () => ready.promise;
    const cancelled = instance(h);
    const setup = cancelled.start();
    await cancelled.stop();
    cancelled.patch.uninstall();
    cancelled.context.BCF = null;
    ready.resolve(); await setup;
    assert.strictEqual(h.observers.size, 0);
    assert.strictEqual(h.resets, 0);

    // The latest setting wins if changed while an earlier reset is running.
    const j = fixture(); j.pref = 3;
    const reentrant = instance(j); await reentrant.start();
    let changedDuringReset = false;
    j.resetAction = () => { if (!changedDuringReset) { changedDuringReset = true; j.change(5); } };
    j.change(4); await reentrant.api.whenSettled();
    assert.strictEqual(minimumOf(j.sessions.document.engine.xml), 5);
    await reentrant.stop(); reentrant.patch.uninstall();

    // A style-sync replacement constructs fresh Style objects; rebuilt session
    // engines must retain the preference without writing an overridden CSL.
    const k = fixture(); k.pref = 3;
    const synced = instance(k); await synced.start();
    k.styles[MAIN] = new k.Style(MAIN);
    const replacementXML = k.styles[MAIN].xml;
    await k.dependencies.reset();
    assert.strictEqual(minimumOf(k.sessions.document.engine.xml), 3);
    assert.strictEqual(k.styles[MAIN].getXML(), replacementXML);
    await synced.stop(); synced.patch.uninstall();


    // Real CSL + real citeproc-js: threshold boundaries in all output formats,
    // both built-ins, citations and bibliographies, with original XML retained.
    const locale = fs.readFileSync(path.join(fixtures, "locales-en-US.xml"), "utf8");
    let renders = 0;
    for (const [file, id] of [["BluebookDSEStyle.csl", MAIN], ["BluebookDSEStyle-Experimental.csl", EXP]]) {
        const xml = fs.readFileSync(path.join(fixtures, file), "utf8");
        const beforeDoc = codec.parse(xml), afterDoc = codec.parse(api.rewriteXML(xml, 3, id, codec));
        for (const doc of [beforeDoc, afterDoc]) {
            for (const node of Array.from(doc.getElementsByTagNameNS(NS, "*"))) {
                for (const name of ["et-al-min", "et-al-use-first", "et-al-subsequent-min", "et-al-subsequent-use-first"]) node.removeAttribute(name);
            }
        }
        assert.strictEqual(codec.serialize(afterDoc), codec.serialize(beforeDoc), "unrelated CSL content changed");
        for (const n of [0, 3, 4, 5, 6, 7, 8, 9, 10, 11])
        for (const subsequent of [0, 3, 4, 5, 6, 7, 8, 9, 10, 11])
        for (const type of ["book", "article-journal"])
        for (const count of [2, 3, 4, 5, 8, 9, 10, 11]) for (const format of ["text", "html", "rtf"]) {
            const rewritten = api.rewriteXML(xml, n, id, codec, subsequent);
            const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda"].slice(0, count);
            const item = { id: "1", type, title: "Fixture Work", "container-title": "Fixture Review", volume: "10", page: "100", author: names.map(family => ({ family, given: "A" })),
                issued: { "date-parts": [[2020]] }, publisher: "Fixture Press" };
            const intervening = { id: "2", type: "book", title: "Intervening Book", author: [{family: "Other"}],
                issued: { "date-parts": [[2021]] } };
            const engine = new CSL.Engine({ retrieveLocale: () => locale, retrieveItem: id => id === "1" ? item : intervening }, rewritten, "en-US");
            engine.setOutputFormat(format);
            function cite(id, note, previous) {
                const result = engine.processCitationCluster({citationID: "c" + note, citationItems: [{id}], properties: {noteIndex: note}}, previous, []);
                return result[1].find(row => row[0] === note - 1)[1];
            }
            const citation = cite("1", 1, []);
            cite("2", 2, [["c1", 1]]);
            const repeat = cite("1", 3, [["c1", 1], ["c2", 2]]);
            assert(names.filter(name => repeat.includes(name)).length <= names.filter(name => citation.includes(name)).length);
            const bibliography = engine.makeBibliography()[1].find(output => output.includes("Alpha"));
            for (const [kind, output, threshold] of [["first", citation, n || 5], ["subsequent", repeat, Math.min(subsequent || 4, n || 5)], ["bibliography", bibliography, n || 5]]) {
                assert(output.includes("Alpha"));
                const truncated = count >= threshold;
                assert.strictEqual(output.includes(names[count - 1]), !truncated, `${file} ${type} first=${n} subsequent=${subsequent} authors=${count} ${format} ${kind} threshold=${threshold}: ${output}`);
                assert.strictEqual(/et al\./.test(output.replace(/<[^>]*>/g, "")), truncated);
                renders++;
            }
        }
    }
    console.log(`bluebook-citations-fixer et-al tests passed (${renders} citation/bibliography renders)`);
}

const watchdog = setTimeout(() => { console.error("Et-al integration tests timed out (pending promise)"); process.exit(1); }, 180000);
main().then(() => clearTimeout(watchdog), error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
