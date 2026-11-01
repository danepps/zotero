"use strict";

// Build only in a temporary copy: never replace a developer's side-load XPI.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const source = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bcf-build-test-"));
const root = path.join(temp, "plugin");

function build(args, success) {
    const result = spawnSync("bash", ["build.sh", ...args], { cwd: root, encoding: "utf8" });
    assert.ifError(result.error);
    if (success) assert.strictEqual(result.status, 0, result.stderr);
    else assert.notStrictEqual(result.status, 0, "unexpected success: " + args.join(" "));
    return result.stdout;
}

function inspect(version) {
    const file = path.join(root, "releases", `Bluebook_Citations_Fixer_v${version}.xpi`);
    const manifest = spawnSync("unzip", ["-p", file, "manifest.json"], { encoding: "utf8" });
    assert.strictEqual(manifest.status, 0, manifest.stderr);
    assert.strictEqual(JSON.parse(manifest.stdout).version, version);
    const listing = spawnSync("unzip", ["-Z1", file], { encoding: "utf8" });
    assert.strictEqual(listing.status, 0, listing.stderr);
    const entries = listing.stdout.trim().split("\n");
    for (const required of ["bootstrap.js", "prefs.js", "prefs.xhtml", "prefs-pane.js",
        "chrome.manifest", "COPYING.txt", "lib/patch.js", "lib/style-sync.js"]) {
        assert(entries.includes(required), "missing " + required);
    }
    assert(!entries.some(name => /^(macros|tests|releases)\//.test(name)));
    assert(!entries.some(name => name.endsWith(".xpi")));
    return file;
}

try {
    fs.cpSync(source, root, { recursive: true,
        filter: file => !path.relative(source, file).split(path.sep).some(part => part === "releases" || part === "node_modules") });
    const manifestPath = path.join(root, "manifest.json");
    const originalManifest = fs.readFileSync(manifestPath, "utf8");
    for (const args of [[], ["--release"], ["1.3.3"], ["1.3.3.0"], ["01.3.3.1"],
        ["1.3.3.1/../../x"], ["1.3.3.1", "extra"], ["--release", "2.0"],
        ["--release", "1.3.3.1"], ["1x3x3x1"]]) {
        build(args, false);
        assert(!fs.existsSync(path.join(root, "releases")), "invalid input created releases");
    }
    const output = build(["1.3.3.987"], true);
    assert(output.includes("Side-load"));
    assert(!output.includes("Create GitHub release"));
    assert.strictEqual(fs.readFileSync(manifestPath, "utf8"), originalManifest);
    const artifact = inspect("1.3.3.987");
    const before = fs.readFileSync(artifact);
    fs.unlinkSync(path.join(root, "bootstrap.js"));
    build(["1.3.3.987"], false);
    assert.deepStrictEqual(fs.readFileSync(artifact), before, "failed build replaced artifact");
    fs.copyFileSync(path.join(source, "bootstrap.js"), path.join(root, "bootstrap.js"));
    const releaseManifest = JSON.parse(originalManifest);
    releaseManifest.version = "2.0";
    fs.writeFileSync(manifestPath, JSON.stringify(releaseManifest));
    const releaseOutput = build(["--release", "2.0"], true);
    assert(releaseOutput.includes("bluebook-citations-fixer-v2.0"));
    assert(releaseOutput.includes("nothing has been published"));
    inspect("2.0");
    console.log("bluebook-citations-fixer build tests passed");
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}
