"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const root = path.resolve(__dirname, "../..");
const MAIN = "https://danepps.github.io/bluebook/BluebookDSEStyle.csl";
const EXP = "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl";
const NS = "http://purl.org/net/xbiblio/csl";
const codec = {
    parse: xml => new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(xml, "application/xml"),
    serialize: doc => new XMLSerializer().serializeToString(doc)
};
const sample = (id = MAIN, extra = "") => `<style xmlns="${NS}" version="1.0"><info><id>${id}</id><title>${id}</title></info>` +
    `<citation et-al-min="5" et-al-use-first="1" ${extra}><layout><names variable="author"><name/></names></layout></citation>` +
    `<bibliography et-al-min="5" et-al-use-first="1"><layout><text variable="title"/></layout></bibliography></style>`;
const minimumOf = xml => Number(codec.parse(xml).getElementsByTagNameNS(NS, "citation")[0].getAttribute("et-al-min"));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture() {
    const f = { pref: 0, subsequent: 0, resets: 0, events: [], observers: new Set(), constructorCalls: 0 };
    f.Style = function (id) { this.styleID = id; this.title = id; this.xml = sample(id); this.cache = new Map(); };
    f.Style.prototype.getXML = function () { return this.xml; };
    f.Style.prototype.clearEngineCache = function () { this.cache.clear(); };
    f.Style.prototype.getCiteProc = function (locale, format, options) {
        f.constructorCalls++;
        if (f.constructorAction) f.constructorAction(this);
        if (options && options.cache && this.cache.has("engine")) return this.cache.get("engine");
        const engine = { xml: this.getXML(), locale, format, options };
        if (options && options.cache) this.cache.set("engine", engine);
        return engine;
    };
    f.styles = { [MAIN]: new f.Style(MAIN), [EXP]: new f.Style(EXP), other: new f.Style("other") };
    f.sessions = { document: { engine: null } };
    f.Integration = {
        currentDoc: false, currentCommandPromise: Promise.resolve(), sessions: f.sessions,
        Field: function () {}, Session: function () {},
        async execCommand(...args) { return f.command ? f.command(...args) : "command-result"; }
    };
    f.Integration.Field.prototype.setText = t => t;
    for (const name of ["updateDocument", "_updateDocument", "writeDelayedCitation"]) f.Integration.Session.prototype[name] = async () => {};
    f.dependencies = {
        ...codec, notify() {}, ready: async () => {}, stylePrototype: () => f.Style.prototype,
        integration: () => f.Integration, getStyle: id => f.styles[id], pref: name => name.endsWith("subsequentMin") ? f.subsequent : f.pref,
        observe: fn => { f.observers.add(fn); return fn; }, unobserve: fn => f.observers.delete(fn),
        commandActive: () => f.Integration.currentDoc, commandPromise: () => f.Integration.currentCommandPromise,
        delay: tick, timer: () => ({ cancel() {} }),
        reset: async () => {
            f.resets++;
            f.events.push("reset");
            if (f.resetAction) await f.resetAction();
            for (const session of Object.values(f.sessions)) session.engine = f.styles[MAIN].getCiteProc("en-US", "rtf");
        }
    };
    f.Integration.resetSessionStyles = f.dependencies.reset;
    f.dependencies.reset = () => f.Integration.resetSessionStyles();
    f.change = value => { f.pref = value; for (const observer of f.observers) observer(); };
    return f;
}

function instance(f) {
    const context = { BCF: { diag: { event() {}, err(_tag, e) { f.events.push("error:" + e.message); } },
        run: { clearSession() {} } }, Zotero: { Integration: f.Integration, Style: f.Style, getMainWindow: () => ({ DOMParser }) }, Components: { classes: {}, interfaces: {} } };
    vm.createContext(context);
    for (const name of ["patch.js", "style-change-gate.js", "et-al-override.js"]) vm.runInContext(fs.readFileSync(path.join(root, "lib", name), "utf8"), context);
    context.BCF.patch.install();
    return { api: context.BCF.etAl, gate: context.BCF.styleGate, patch: context.BCF.patch, context,
        start: () => { context.BCF.styleGate.install(f.dependencies); return context.BCF.etAl.install(f.dependencies); },
        stop: async appShutdown => { await context.BCF.etAl.uninstall(appShutdown); await context.BCF.styleGate.uninstall(appShutdown); } };
}

function styleSyncFixture(f, owner) {
    vm.runInContext(fs.readFileSync(path.join(root, "lib/style-sync.js"), "utf8"), owner.context);
    const sync = owner.context.BCF.styleSync;
    const dated = date => sample().replace("</info>", `<updated>${date}</updated></info>`);
    f.styles[MAIN].xml = dated("2026-09-01T00:00:00Z");
    const remote = dated("2026-09-12T00:00:00Z");
    const d = {
        parse: codec.parse, getInstalledStyles: () => f.styles, installTargets: () => [],
        getStyle: async id => f.styles[id] || null,
        fetch: async () => remote,
        validate: async () => {},
        // Intentionally use the production withStyleChange adapter, which
        // resolves the actual independent gate in this shared VM.
        install: async (id, xml) => {
            f.events.push("install:start");
            if (f.installAction) await f.installAction();
            f.styles[id] = new f.Style(id); f.styles[id].xml = xml;
            f.Integration.resetSessionStyles(); // Native reinit starts this WITHOUT await
            f.events.push("install:end");
        }
    };
    return { sync, deps: d, remote, run: () => sync.checkStyle(MAIN, d) };
}


module.exports = { MAIN, EXP, NS, codec, sample, minimumOf, tick, deferred, fixture, instance, styleSyncFixture };
