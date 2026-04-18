"use strict";

// ===========================================================================
// Bluebook Hereinafter
//
// Detects multiple works by the same author in a Word document's Zotero
// citations. On the first cite of each such work, appends
//   [hereinafter <i>ShortTitle</i>]
// On subsequent short-form cites ("Reich, supra note 5"), inserts the short
// title, producing "Reich, <i>New Property</i>, supra note 5".
//
// Mac + Microsoft Word only (uses AppleScript).
// ===========================================================================

// Filled in by section files below.
var BH = {};

// ---- AppleScript bridge ---------------------------------------------------

BH.runAppleScript = function (script) {
    var Cc = Components.classes;
    var Ci = Components.interfaces;

    var tmpDir = Cc['@mozilla.org/file/directory_service;1']
        .getService(Ci.nsIProperties)
        .get('TmpD', Ci.nsIFile);

    var scriptFile = tmpDir.clone();
    scriptFile.append('bluebook-hereinafter.applescript');
    if (scriptFile.exists()) scriptFile.remove(false);
    scriptFile.create(Ci.nsIFile.NORMAL_FILE_TYPE, 0o600);

    var outFile = tmpDir.clone();
    outFile.append('bluebook-hereinafter-out.txt');
    if (outFile.exists()) outFile.remove(false);

    var os = Cc['@mozilla.org/network/file-output-stream;1']
        .createInstance(Ci.nsIFileOutputStream);
    os.init(scriptFile, 0x02 | 0x08 | 0x20, 0o600, 0);
    var cos = Cc['@mozilla.org/intl/converter-output-stream;1']
        .createInstance(Ci.nsIConverterOutputStream);
    cos.init(os, 'UTF-8', 0, 0);
    cos.writeString(script);
    cos.close();

    var shell = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
    shell.initWithPath('/bin/sh');

    var proc = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
    proc.init(shell);

    var cmd = 'osascript ' + scriptFile.path + ' > ' + outFile.path + ' 2>&1';
    var args = ['-c', cmd];
    proc.run(true, args, args.length);

    var result = '';
    if (outFile.exists()) {
        var is = Cc['@mozilla.org/network/file-input-stream;1']
            .createInstance(Ci.nsIFileInputStream);
        is.init(outFile, 0x01, 0o444, 0);
        var cis = Cc['@mozilla.org/intl/converter-input-stream;1']
            .createInstance(Ci.nsIConverterInputStream);
        cis.init(is, 'UTF-8', 0, 0);
        var str = {};
        while (cis.readString(4096, str) !== 0) result += str.value;
        cis.close();
        outFile.remove(false);
    }

    scriptFile.remove(false);
    return result;
};

// ---- Word field I/O -------------------------------------------------------

// Generate the AppleScript that iterates every Zotero field in the active
// Word document (body + footnotes) and emits, per field, a tab-separated
// record with base64-encoded code and display text.  Output format per line:
//
//     LOC\tFNIDX\tFIDX\tCODE_B64\tTEXT_B64
//
// where LOC is "body" or "fnote", FNIDX is the footnote index ("0" for body),
// and FIDX is the field index within its container.  Base64 is stripped of
// line wrapping so each record is exactly one line.
BH.readFieldsScript = function () {
    return [
        'set recs to ""',
        'tell application "Microsoft Word"',
        '    if not (exists active document) then return ""',
        '    set doc to active document',
        '    set bodyCount to count of fields of text object of doc',
        '    repeat with i from 1 to bodyCount',
        '        set f to field i of text object of doc',
        '        set fc to ""',
        '        try',
        '            set fcVal to content of field code of f',
        '            if fcVal is not missing value then set fc to fcVal as string',
        '        end try',
        '        if fc contains "ZOTERO_ITEM" then',
        '            set ft to ""',
        '            try',
        '                select f',
        '                set ftVal to content of selection',
        '                if ftVal is not missing value then set ft to ftVal as string',
        '            end try',
        '            set codeB64 to do shell script "printf %s " & quoted form of fc & " | base64 | tr -d \'\\n\'"',
        '            set textB64 to do shell script "printf %s " & quoted form of ft & " | base64 | tr -d \'\\n\'"',
        '            set recs to recs & "body" & tab & "0" & tab & (i as string) & tab & codeB64 & tab & textB64 & linefeed',
        '        end if',
        '    end repeat',
        '    set fnCount to count of footnotes of doc',
        '    repeat with fi from 1 to fnCount',
        '        set fn to footnote fi of doc',
        '        set fnFields to count of fields of text object of fn',
        '        repeat with j from 1 to fnFields',
        '            set f to field j of text object of fn',
        '            set fc to ""',
        '            try',
        '                set fcVal to content of field code of f',
        '                if fcVal is not missing value then set fc to fcVal as string',
        '            end try',
        '            if fc contains "ZOTERO_ITEM" then',
        '                set ft to ""',
        '                try',
        '                    select f',
        '                    set ftVal to content of selection',
        '                    if ftVal is not missing value then set ft to ftVal as string',
        '                end try',
        '                set codeB64 to do shell script "printf %s " & quoted form of fc & " | base64 | tr -d \'\\n\'"',
        '                set textB64 to do shell script "printf %s " & quoted form of ft & " | base64 | tr -d \'\\n\'"',
        '                set recs to recs & "fnote" & tab & (fi as string) & tab & (j as string) & tab & codeB64 & tab & textB64 & linefeed',
        '            end if',
        '        end repeat',
        '    end repeat',
        'end tell',
        'return recs'
    ].join('\n');
};

// Base64-decode a string (Zotero's Fx runtime exposes atob on the scope via
// the parent scope; fall back to a pure-JS impl).
BH.b64decode = function (s) {
    if (typeof atob === 'function') {
        try { return decodeURIComponent(escape(atob(s))); } catch (_) {}
    }
    // Pure-JS fallback
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var out = '';
    s = s.replace(/[^A-Za-z0-9+/=]/g, '');
    var i = 0;
    while (i < s.length) {
        var e1 = chars.indexOf(s.charAt(i++));
        var e2 = chars.indexOf(s.charAt(i++));
        var e3 = chars.indexOf(s.charAt(i++));
        var e4 = chars.indexOf(s.charAt(i++));
        var c1 = (e1 << 2) | (e2 >> 4);
        var c2 = ((e2 & 15) << 4) | (e3 >> 2);
        var c3 = ((e3 & 3) << 6) | e4;
        out += String.fromCharCode(c1);
        if (e3 !== 64) out += String.fromCharCode(c2);
        if (e4 !== 64) out += String.fromCharCode(c3);
    }
    try { return decodeURIComponent(escape(out)); } catch (_) { return out; }
};

// Parse the output of readFieldsScript.
// Returns: [{loc, fnIdx, fieldIdx, code, text}]
BH.parseFieldRecords = function (output) {
    var fields = [];
    if (!output) return fields;
    var lines = output.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line) continue;
        var parts = line.split('\t');
        if (parts.length < 5) continue;
        fields.push({
            loc: parts[0],
            fnIdx: parseInt(parts[1], 10) || 0,
            fieldIdx: parseInt(parts[2], 10) || 0,
            code: BH.b64decode(parts[3]),
            text: BH.b64decode(parts[4])
        });
    }
    return fields;
};

// ---- Citation JSON parsing ------------------------------------------------

// Extract the CSL_CITATION JSON from a Zotero field code.  Returns the parsed
// object or null.  The code looks like:
//   ADDIN ZOTERO_ITEM CSL_CITATION { ...json... }
BH.parseFieldCode = function (code) {
    if (!code) return null;
    var idx = code.indexOf('CSL_CITATION');
    if (idx === -1) return null;
    var jsonStart = code.indexOf('{', idx);
    if (jsonStart === -1) return null;
    var jsonStr = code.slice(jsonStart).trim();
    // Zotero sometimes appends a trailing mendeley/odf marker; strip anything
    // after the final closing brace that balances the opening one.
    var depth = 0, end = -1;
    for (var i = 0; i < jsonStr.length; i++) {
        var ch = jsonStr.charAt(i);
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) return null;
    try {
        return JSON.parse(jsonStr.slice(0, end + 1));
    } catch (e) {
        return null;
    }
};

// Return a stable key for a citation item (prefers URI, falls back to id).
BH.itemKey = function (citItem) {
    if (citItem.uris && citItem.uris.length) return citItem.uris[0];
    if (citItem.uri && citItem.uri.length) return citItem.uri[0];
    return 'id:' + citItem.id;
};

// Extract author surname array from a CSL itemData.author array.
BH.surnamesOf = function (itemData) {
    var authors = (itemData && itemData.author) || [];
    var out = [];
    for (var i = 0; i < authors.length; i++) {
        var a = authors[i];
        var s = a.family || a.literal || a.name || '';
        if (s) out.push(s);
    }
    return out;
};

// Compute the "author key" used for ambiguity grouping: the concatenated
// surnames, lowercased.  Two items with the same authorKey are treated as
// potentially ambiguous with each other.
BH.authorKeyOf = function (itemData) {
    var ss = BH.surnamesOf(itemData);
    if (!ss.length) return '';
    return ss.join('|').toLowerCase();
};

// Short title the plugin will inject.  Prefers `title-short`; falls back to
// the full title per user instruction.
BH.shortTitleOf = function (itemData) {
    if (!itemData) return '';
    return itemData['title-short'] || itemData.title || '';
};

// ---- Ambiguity detection --------------------------------------------------

// Walk all fields, collect per-item metadata, and identify ambiguous items:
// those whose author-key matches the author-key of at least one other distinct
// item somewhere in the document.
//
// Returns:
//   {
//     items: Map<itemKey, {itemData, authorKey, shortTitle, firstFieldIdx}>,
//     ambiguous: Set<itemKey>
//   }
BH.analyzeDocument = function (fields) {
    var items = new Map();             // itemKey -> metadata
    var authorBuckets = new Map();     // authorKey -> Set<itemKey>

    for (var fi = 0; fi < fields.length; fi++) {
        var parsed = BH.parseFieldCode(fields[fi].code);
        if (!parsed || !parsed.citationItems) continue;

        for (var ci = 0; ci < parsed.citationItems.length; ci++) {
            var cit = parsed.citationItems[ci];
            var data = cit.itemData || {};
            var key = BH.itemKey(cit);
            var authorKey = BH.authorKeyOf(data);
            if (!authorKey) continue; // skip items without an author

            if (!items.has(key)) {
                items.set(key, {
                    itemData: data,
                    authorKey: authorKey,
                    shortTitle: BH.shortTitleOf(data),
                    firstFieldIdx: fi,
                    firstCitIdx: ci
                });
            }
            if (!authorBuckets.has(authorKey)) {
                authorBuckets.set(authorKey, new Set());
            }
            authorBuckets.get(authorKey).add(key);
        }
    }

    var ambiguous = new Set();
    authorBuckets.forEach(function (keys) {
        if (keys.size >= 2) {
            keys.forEach(function (k) { ambiguous.add(k); });
        }
    });

    return { items: items, ambiguous: ambiguous };
};

// ---- Edit computation -----------------------------------------------------

// For each field that needs modification, compute an ordered list of text
// edits.  Each edit is:
//   { pos: number, plain: string, italic: string, plain2: string }
//
// pos is a 0-based character offset within the field's current display text.
// If pos === text.length, the edit is an append.  The edit inserts, in order:
// `plain`, then `italic` (formatted italic), then `plain2` (formatted plain).
//
// Returns a Map<fieldIdx, edit[]>.
BH.computeEdits = function (fields, analysis) {
    var edits = new Map();

    for (var fi = 0; fi < fields.length; fi++) {
        var field = fields[fi];
        var parsed = BH.parseFieldCode(field.code);
        if (!parsed || !parsed.citationItems) continue;

        var items = parsed.citationItems;
        var fieldEdits = [];

        // Multi-item fields: split display text on "; " so each hereinafter
        // lands inline after its own sub-cite instead of stacked at the end
        // of the combined field.  If the split doesn't produce the expected
        // segment count, leave `segments` null and fall back to treating the
        // whole field as one cite.
        var segments = null;
        if (items.length > 1 && field.text) {
            segments = BH.splitMultiCite(field.text, items.length);
        }

        for (var ci = 0; ci < items.length; ci++) {
            var cit = items[ci];
            var key = BH.itemKey(cit);
            if (!analysis.ambiguous.has(key)) continue;

            var meta = analysis.items.get(key);
            if (!meta || !meta.shortTitle) continue;

            var subField = field;
            var offset = 0;
            if (segments) {
                subField = {
                    loc: field.loc,
                    fnIdx: field.fnIdx,
                    fieldIdx: field.fieldIdx,
                    code: field.code,
                    text: segments[ci].text
                };
                offset = segments[ci].start;
            }

            // cit.position: 0 = first cite, 1 = subsequent, 2 = ibid,
            // 3 = ibid-with-locator.  Treat ibid as subsequent for our
            // purposes; treat undefined/0 as first.
            var pos = (cit.position !== undefined) ? cit.position : 0;
            var edit = (pos === 0)
                ? BH.computeFirstCiteEdit(subField, cit, meta)
                : BH.computeSubsequentCiteEdit(subField, cit, meta);
            if (!edit) continue;
            edit.pos += offset;
            fieldEdits.push(edit);
        }

        if (fieldEdits.length) {
            // Apply in descending position order so earlier insertions don't
            // shift later ones.
            fieldEdits.sort(function (a, b) { return b.pos - a.pos; });
            edits.set(fi, fieldEdits);
        }
    }

    return edits;
};

// Split a multi-cite field's display text into per-sub-cite segments.
// Returns [{text, start, end}, ...] or null if the split doesn't match
// expectedCount.  Uses "; " — citeproc's default cite-group-delimiter for
// most legal styles including Bluebook.
BH.splitMultiCite = function (text, expectedCount) {
    var sep = '; ';
    var segments = [];
    var start = 0;
    var idx;
    while ((idx = text.indexOf(sep, start)) !== -1) {
        segments.push({ text: text.slice(start, idx), start: start, end: idx });
        start = idx + sep.length;
    }
    segments.push({ text: text.slice(start), start: start, end: text.length });
    return segments.length === expectedCount ? segments : null;
};

// Compute the edit for a first (full) cite of an ambiguous item: append
// " [hereinafter <i>ShortTitle</i>]" at the end of the field's display text.
// Skip if the hereinafter bracket is already present for this short title.
BH.computeFirstCiteEdit = function (field, citItem, meta) {
    var text = field.text;
    var shortTitle = meta.shortTitle;
    // Idempotency: if we already inserted a matching hereinafter, skip.
    var sentinel = '[hereinafter ' + shortTitle + ']';
    if (text.indexOf(sentinel) !== -1) return null;

    return {
        pos: text.length,
        plain: ' [hereinafter ',
        italic: shortTitle,
        plain2: ']'
    };
};

// Compute the edit for a subsequent (short-form) cite of an ambiguous item:
// insert ", <i>ShortTitle</i>" between the author-short and "supra note".
//
// Primary: search for ", supra note" in the display text and insert before it.
// Fallback (text is empty / unreadable): insert after the computed author-short
// string length, trusting citeproc produced "AuthorShort, supra note N".
BH.computeSubsequentCiteEdit = function (field, citItem, meta) {
    var text = field.text;
    var shortTitle = meta.shortTitle;
    var data = citItem.itemData || {};

    // Idempotency: skip if the short title already appears before "supra".
    if (text) {
        var titleBeforeSupra = new RegExp(
            BH.escapeRegex(shortTitle) + '[^,]*,?\\s*supra\\s+note',
            'i'
        );
        if (titleBeforeSupra.test(text)) return null;
    }

    // Primary: find ", supra note" in display text.
    if (text) {
        var m = /,\s+supra\s+note\b/i.exec(text);
        if (m) {
            return { pos: m.index, plain: ', ', italic: shortTitle, plain2: '' };
        }
    }

    // Fallback: insert after author-short.  Handle volume prefix for books.
    var authorShort = BH.renderedAuthorShort(data);
    if (!authorShort) return null;
    var volumePrefix = (data.type === 'book' && data.volume)
        ? String(data.volume) + ' '
        : '';
    var insertPos = (volumePrefix + authorShort).length;

    return { pos: insertPos, plain: ', ', italic: shortTitle, plain2: '' };
};

// Reintroduce renderedAuthorShort (needed for the fallback above).
BH.renderedAuthorShort = function (itemData) {
    var ss = BH.surnamesOf(itemData);
    if (ss.length === 0) return '';
    if (ss.length === 1) return ss[0];
    if (ss.length === 2) return ss[0] + ' & ' + ss[1];
    return ss[0] + ' et al.';
};

BH.escapeRegex = function (s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// ---- AppleScript string helpers -------------------------------------------

// Escape a JS string for embedding in an AppleScript string literal.
BH.asEscape = function (s) {
    return String(s)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '')
        .replace(/\n/g, '" & return & "');
};

// Build an AppleScript reference for a field.
BH.fieldRef = function (field) {
    if (field.loc === 'fnote') {
        return 'field ' + field.fieldIdx +
            ' of text object of footnote ' + field.fnIdx +
            ' of active document';
    }
    return 'field ' + field.fieldIdx + ' of text object of active document';
};

// ---- AppleScript edit writer ----------------------------------------------

// Build an AppleScript program that applies every edit in `editsByField` to
// the active Word document.  Each edit is applied via selection-hopping:
//  1. select the field's result range
//  2. collapse the selection to start or end
//  3. move the insertion point forward `pos` characters (skipped on append)
//  4. type plain / italic / plain segments, toggling italic on the font of
//     the selection between them
BH.buildWriterScript = function (fields, editsByField) {
    var lines = [];
    lines.push('set errLog to ""');
    lines.push('set editsApplied to 0');
    lines.push('tell application "Microsoft Word"');
    lines.push('    set origSel to selection');

    var editNum = 0;
    editsByField.forEach(function (edits, fi) {
        var field = fields[fi];
        var ref = BH.fieldRef(field);
        var textLen = field.text.length;

        for (var i = 0; i < edits.length; i++) {
            var ed = edits[i];
            var tag = 'f' + fi + '.' + i + ' (' + field.loc + '#' +
                      field.fnIdx + '/' + field.fieldIdx +
                      ' pos=' + ed.pos + ' textLen=' + textLen + ')';
            lines.push('    set step to "start"');
            lines.push('    try');
            lines.push('        set step to "select_field"');
            lines.push('        select ' + ref);
            lines.push('        set step to "text_object"');
            lines.push('        set selRange to text object of selection');
            lines.push('        set step to "selRange_len=" & (count of characters of selRange)');
            if (ed.pos >= textLen && textLen > 0) {
                lines.push('        set step to "collapse_end"');
                lines.push('        collapse range selRange direction collapse end');
                lines.push('        set step to "select_selRange_end"');
                lines.push('        select selRange');
            } else if (ed.pos === 0) {
                lines.push('        set step to "collapse_start"');
                lines.push('        collapse range selRange direction collapse start');
                lines.push('        set step to "select_selRange_start"');
                lines.push('        select selRange');
            } else {
                // mid-field: get the character AT position `pos` (1-indexed
                // via pos+1), collapse to its start, select. Gives a zero-
                // length insertion point exactly at offset `pos` within the
                // field. Avoids 'move right' entirely.
                lines.push('        set step to "char_access"');
                lines.push(
                    '        set ptRange to character ' + (ed.pos + 1) +
                    ' of selRange'
                );
                lines.push('        set step to "collapse_pt_start"');
                lines.push('        collapse range ptRange direction collapse start');
                lines.push('        set step to "select_ptRange"');
                lines.push('        select ptRange');
            }
            lines.push('        set step to "typing"');
            if (ed.plain) {
                lines.push('        set italic of font object of selection to false');
                lines.push('        type text selection text "' + BH.asEscape(ed.plain) + '"');
            }
            if (ed.italic) {
                lines.push('        set italic of font object of selection to true');
                lines.push('        type text selection text "' + BH.asEscape(ed.italic) + '"');
                lines.push('        set italic of font object of selection to false');
            }
            if (ed.plain2) {
                lines.push('        set italic of font object of selection to false');
                lines.push('        type text selection text "' + BH.asEscape(ed.plain2) + '"');
            }
            lines.push('        set editsApplied to editsApplied + 1');
            lines.push('    on error errMsg');
            lines.push('        set errLog to errLog & "' +
                       BH.asEscape(tag) + ' [step=" & step & "]: " & errMsg & linefeed');
            lines.push('    end try');
            editNum++;
        }
    });

    lines.push('    try');
    lines.push('        select origSel');
    lines.push('    end try');
    lines.push('end tell');
    lines.push('return (editsApplied as string) & "|||" & errLog');
    return lines.join('\n');
};

// ---- Diagnostics ----------------------------------------------------------

// Build a short human-readable summary of what the plugin saw in the doc.
// Used by the menu alert to help debug why edits weren't applied.
BH.diagnose = function (fields, analysis, edits) {
    var out = [];
    out.push('Fields: ' + fields.length);
    out.push('Ambiguous items: ' + analysis.ambiguous.size);
    out.push('Edits planned: ' + edits.size);
    out.push('');
    for (var fi = 0; fi < fields.length && fi < 8; fi++) {
        var f = fields[fi];
        var parsed = BH.parseFieldCode(f.code);
        var items = (parsed && parsed.citationItems) || [];
        var itemStrs = [];
        for (var ci = 0; ci < items.length; ci++) {
            var cit = items[ci];
            var data = cit.itemData || {};
            var key = BH.itemKey(cit);
            var keyShort = key.length > 40 ? '…' + key.slice(-40) : key;
            var amb = analysis.ambiguous.has(key) ? 'AMB' : 'uniq';
            itemStrs.push(
                '    ' + amb + ' key=' + keyShort +
                ' author=' + JSON.stringify(BH.authorKeyOf(data)) +
                ' short=' + JSON.stringify(BH.shortTitleOf(data))
            );
        }
        out.push('[' + fi + '] ' + f.loc + '#' + f.fnIdx + ' field ' + f.fieldIdx);
        out.push('  text: ' + JSON.stringify(f.text.slice(0, 80)));
        out.push('  items: ' + items.length);
        out.push(itemStrs.join('\n'));
    }
    return out.join('\n');
};

BH.fixHereinafters = function (win) {
    try {
        var rawOut = BH.runAppleScript(BH.readFieldsScript());
        if (!rawOut || /execution error/i.test(rawOut)) {
            if (win) win.console.warn(
                'Bluebook Hereinafter: read script returned: ' + rawOut
            );
            return { applied: 0, fieldsScanned: 0, error: rawOut };
        }

        var fields = BH.parseFieldRecords(rawOut);
        if (!fields.length) {
            return { applied: 0, fieldsScanned: 0, diagnostic: '(no Zotero fields found)' };
        }

        var analysis = BH.analyzeDocument(fields);
        var edits = BH.computeEdits(fields, analysis);

        var diagnostic = '(diagnose not run)';
        try { diagnostic = BH.diagnose(fields, analysis, edits); }
        catch (de) { diagnostic = 'diagnose() threw: ' + de; }

        BH.writeDiagFile(
            'v0.1.6 | fields=' + fields.length +
            ' ambig=' + analysis.ambiguous.size +
            ' edits=' + edits.size + '\n\n' + diagnostic
        );

        if (edits.size === 0) {
            return {
                applied: 0,
                fieldsScanned: fields.length,
                diagnostic: diagnostic
            };
        }

        var writer = BH.buildWriterScript(fields, edits);
        BH.writeFile('/tmp/bluebook-hereinafter-writer.applescript', writer);
        var appliedOut = BH.runAppleScript(writer);
        var applied = 0;
        var writerErrLog = '';
        if (appliedOut && appliedOut.indexOf('|||') !== -1) {
            var parts = appliedOut.split('|||');
            applied = parseInt((parts[0] || '').trim(), 10) || 0;
            writerErrLog = parts.slice(1).join('|||').trim();
        } else {
            writerErrLog = 'SCRIPT FAILED (no delimiter in output):\n' +
                (appliedOut || '(empty)');
            // Extract character offsets from osascript error if present
            // (format "Script:startChar:endChar: message").
            var m = /:(\d+):(\d+):/.exec(appliedOut || '');
            if (m) {
                var startChar = parseInt(m[1], 10);
                var endChar = parseInt(m[2], 10);
                var ctxStart = Math.max(0, startChar - 60);
                var ctxEnd = Math.min(writer.length, endChar + 60);
                writerErrLog += '\n\n--- writer script around offset ' +
                    startChar + '-' + endChar + ' ---\n' +
                    writer.slice(ctxStart, startChar) +
                    '>>>' + writer.slice(startChar, endChar) + '<<<' +
                    writer.slice(endChar, ctxEnd);
            }
        }

        BH.writeDiagFile(
            'v0.1.15 | fields=' + fields.length +
            ' ambig=' + analysis.ambiguous.size +
            ' edits=' + edits.size +
            ' applied=' + applied + '\n\n' + diagnostic +
            '\n\n--- writer raw output ---\n' + (appliedOut || '(empty)') +
            '\n\n--- writer errors ---\n' + (writerErrLog || '(none)')
        );

        return {
            applied: applied,
            fieldsScanned: fields.length,
            diagnostic: diagnostic +
                (writerErrLog ? '\n\n--- writer errors ---\n' + writerErrLog : '')
        };
    } catch (e) {
        var errStr = String(e) + '\n' + (e.stack || '');
        Components.utils.reportError('Bluebook Hereinafter fix error: ' + errStr);
        BH.writeDiagFile('CAUGHT ERROR: ' + errStr);
        return { applied: 0, fieldsScanned: 0, error: String(e) };
    }
};

// Write a string to a file for debugging.
BH.writeFile = function (path, text) {
    try {
        var Cc = Components.classes;
        var Ci = Components.interfaces;
        var f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        f.initWithPath(path);
        var os = Cc['@mozilla.org/network/file-output-stream;1']
            .createInstance(Ci.nsIFileOutputStream);
        os.init(f, 0x02 | 0x08 | 0x20, 0o644, 0);
        var cos = Cc['@mozilla.org/intl/converter-output-stream;1']
            .createInstance(Ci.nsIConverterOutputStream);
        cos.init(os, 'UTF-8', 0, 0);
        cos.writeString(text);
        cos.close();
    } catch (_) {}
};

BH.writeDiagFile = function (text) {
    BH.writeFile('/tmp/bluebook-hereinafter-diag.txt', text);
};

// ---- Menu + integration hook ----------------------------------------------

BH.origExecCommand = null;

BH.installHook = function () {
    if (BH.origExecCommand) return; // already installed
    if (typeof Zotero === 'undefined' || !Zotero.Integration ||
            typeof Zotero.Integration.execCommand !== 'function') {
        // Zotero.Integration may not be ready yet at startup.  Retry shortly.
        BH.hookRetryTimer = Components.classes['@mozilla.org/timer;1']
            .createInstance(Components.interfaces.nsITimer);
        BH.hookRetryTimer.initWithCallback(
            { notify: function () { BH.installHook(); } },
            1000,
            Components.interfaces.nsITimer.TYPE_ONE_SHOT
        );
        return;
    }
    BH.origExecCommand = Zotero.Integration.execCommand;
    Zotero.Integration.execCommand = function () {
        var args = arguments;
        var self = this;
        var result;
        try {
            result = BH.origExecCommand.apply(self, args);
        } catch (e) {
            // Let the original error propagate after running post-processor.
            BH.runPostProcessor();
            throw e;
        }
        // If result is a Promise, chain; otherwise run synchronously.
        if (result && typeof result.then === 'function') {
            return result.then(function (val) {
                BH.runPostProcessor();
                return val;
            }, function (err) {
                BH.runPostProcessor();
                throw err;
            });
        }
        BH.runPostProcessor();
        return result;
    };
};

BH.uninstallHook = function () {
    if (BH.hookRetryTimer) {
        try { BH.hookRetryTimer.cancel(); } catch (_) {}
        BH.hookRetryTimer = null;
    }
    if (!BH.origExecCommand) return;
    try {
        Zotero.Integration.execCommand = BH.origExecCommand;
    } catch (_) {}
    BH.origExecCommand = null;
};

BH.runPostProcessor = function () {
    try {
        var res = BH.fixHereinafters(null);
        if (res && res.applied) {
            Zotero.debug('Bluebook Hereinafter: applied ' + res.applied +
                ' edit(s) across ' + res.fieldsScanned + ' field(s).');
        }
    } catch (e) {
        Components.utils.reportError(
            'Bluebook Hereinafter post-processor error: ' + e
        );
    }
};

BH.addMenuItem = function (win) {
    var doc = win.document;
    if (doc.getElementById('bluebook-hereinafter-menuitem')) return;
    var toolsMenu = doc.getElementById('menu_ToolsPopup');
    if (!toolsMenu) return;

    var item = doc.createElementNS(
        'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul',
        'menuitem'
    );
    item.id = 'bluebook-hereinafter-menuitem';
    item.setAttribute('label', 'Fix Hereinafters');
    item.addEventListener('command', function () {
        var res = BH.fixHereinafters(win);
        if (res && res.error) {
            win.alert('Bluebook Hereinafter error:\n\n' + res.error);
        } else if (res) {
            var msg = 'Bluebook Hereinafter\n\n' +
                'Fields scanned: ' + res.fieldsScanned + '\n' +
                'Edits applied: ' + res.applied;
            if (res.diagnostic) msg += '\n\n--- diagnostic ---\n' + res.diagnostic;
            win.alert(msg);
        }
    });
    toolsMenu.appendChild(item);
};

BH.removeMenuItem = function (win) {
    var item = win.document.getElementById('bluebook-hereinafter-menuitem');
    if (item) item.parentNode.removeChild(item);
};

BH.windowWatcher = {
    observe: function (subject, topic) {
        if (topic !== 'domwindowopened') return;
        subject.addEventListener('load', function onLoad() {
            subject.removeEventListener('load', onLoad);
            var root = subject.document.documentElement;
            if (root && root.getAttribute('windowtype') === 'navigator:browser') {
                BH.addMenuItem(subject);
            }
        });
    }
};

// ---------------------------------------------------------------------------
// Bootstrap entry points
// ---------------------------------------------------------------------------

function startup({ id, version, rootURI }, reason) {
    try {
        BH.installHook();
        var windows = Services.wm.getEnumerator('navigator:browser');
        while (windows.hasMoreElements()) {
            BH.addMenuItem(windows.getNext());
        }
        Services.ww.registerNotification(BH.windowWatcher);
    } catch (e) {
        Components.utils.reportError('Bluebook Hereinafter startup error: ' + e);
    }
}

function shutdown(data, reason) {
    try {
        BH.uninstallHook();
        Services.ww.unregisterNotification(BH.windowWatcher);
        var windows = Services.wm.getEnumerator('navigator:browser');
        while (windows.hasMoreElements()) {
            BH.removeMenuItem(windows.getNext());
        }
    } catch (e) {
        Components.utils.reportError('Bluebook Hereinafter shutdown error: ' + e);
    }
}

function install(data, reason) {}
function uninstall(data, reason) {}
