/*
    BBQC CEP Host v0.2
    ExtendScript / After Effects
*/

var BBQC = BBQC || {};

(function (api) {

    var SETTINGS_SECTION = "BBQC_v02";

    // ---------------------------------------------------------
    // Basic helpers
    // ---------------------------------------------------------

    function sanitizeKey(str) {
        var result = "";
        for (var i = 0; i < str.length; i++) {
            var c = str.charAt(i);
            if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9")) result += c;
            else result += "_";
        }
        return result;
    }

    function getProjectKey() {
        if (app.project && app.project.file) return "PROJECT_" + sanitizeKey(app.project.file.fsName);
        return "UNTITLED_PROJECT";
    }

    function getProjectName() {
        if (app.project && app.project.file) {
            try { return decodeURI(app.project.file.name); }
            catch (err) { return app.project.file.name; }
        }
        return "Unsaved Project";
    }

    function makeQCID() {
        var now = new Date();
        return "BBQC_" + now.getTime() + "_" + Math.floor(Math.random() * 100000);
    }

    function trackingTag(qcID) { return "BBQC:" + qcID; }

    function escapeText(str) {
        if (!str) return "";
        return str.replace(/%/g, "%25").replace(/\|/g, "%7C").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    }

    function unescapeText(str) {
        if (!str) return "";
        return str.replace(/%0A/g, "\n").replace(/%0D/g, "\r").replace(/%7C/g, "|").replace(/%25/g, "%");
    }

    function jsonEscape(str) {
        if (str === null || str === undefined) return "";
        str = String(str);
        return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    }

    function quote(str) { return '"' + jsonEscape(str) + '"'; }

    function bool(v) { return v ? "true" : "false"; }

    // ---------------------------------------------------------
    // Storage
    // ---------------------------------------------------------

    function serialize(data) {
        var parts = [];
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var fields = [
                item.checked ? "1" : "0",
                escapeText(item.title || ""),
                escapeText(item.note || ""),
                item.linked ? "1" : "0",
                item.compID !== undefined ? String(item.compID) : "-1",
                escapeText(item.compName || ""),
                item.time !== undefined ? String(item.time) : "0",
                escapeText(item.qcID || ""),
                escapeText(item.markerName || ""),
                escapeText(item.frameioCommentId || ""),
                escapeText(item.frameioShareId || "")
            ];
            parts.push(fields.join("|||"));
        }
        return parts.join("|||ITEM|||");
    }

    function deserialize(str) {
        var result = [];
        if (!str) return result;
        var items = str.split("|||ITEM|||");
        for (var i = 0; i < items.length; i++) {
            var v = items[i].split("|||");
            if (v.length < 2) continue;
            result.push({
                checked: v[0] === "1",
                title: unescapeText(v[1]),
                note: v.length > 2 ? unescapeText(v[2]) : "",
                linked: v.length > 3 ? v[3] === "1" : false,
                compID: v.length > 4 && v[4] !== "" ? parseInt(v[4], 10) : -1,
                compName: v.length > 5 ? unescapeText(v[5]) : "",
                time: v.length > 6 && v[6] !== "" ? parseFloat(v[6]) : 0,
                qcID: v.length > 7 ? unescapeText(v[7]) : "",
                markerName: v.length > 8 ? unescapeText(v[8]) : "",
                frameioCommentId: v.length > 9 ? unescapeText(v[9]) : "",
                frameioShareId: v.length > 10 ? unescapeText(v[10]) : ""
            });
        }
        return result;
    }

    function load() {
        var key = getProjectKey();
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, key)) return deserialize(app.settings.getSetting(SETTINGS_SECTION, key));
        } catch (e) {}
        return [];
    }

    function save(data) {
        try { app.settings.saveSetting(SETTINGS_SECTION, getProjectKey(), serialize(data)); }
        catch (e) {}
    }

    // ---------------------------------------------------------
    // Frame.io composition<->link sync associations
    // ---------------------------------------------------------

    var FRAMEIO_SYNCS_SECTION = "BBQC_v02_frameioSyncs";

    function serializeFrameioSyncs(data) {
        var parts = [];
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            parts.push([
                String(item.compId),
                escapeText(item.compName || ""),
                escapeText(item.link || "")
            ].join("|||"));
        }
        return parts.join("|||ITEM|||");
    }

    function deserializeFrameioSyncs(str) {
        var result = [];
        if (!str) return result;
        var items = str.split("|||ITEM|||");
        for (var i = 0; i < items.length; i++) {
            var v = items[i].split("|||");
            if (v.length < 3) continue;
            result.push({
                compId: parseInt(v[0], 10),
                compName: unescapeText(v[1]),
                link: unescapeText(v[2])
            });
        }
        return result;
    }

    function loadFrameioSyncs() {
        var key = getProjectKey();
        try {
            if (app.settings.haveSetting(FRAMEIO_SYNCS_SECTION, key)) return deserializeFrameioSyncs(app.settings.getSetting(FRAMEIO_SYNCS_SECTION, key));
        } catch (e) {}
        return [];
    }

    function saveFrameioSyncs(data) {
        try { app.settings.saveSetting(FRAMEIO_SYNCS_SECTION, getProjectKey(), serializeFrameioSyncs(data)); }
        catch (e) {}
    }

    // Drops syncs whose composition no longer exists, and refreshes the
    // remembered name for ones that were renamed — keeps the list honest
    // without the user having to manage it by hand.
    function refreshFrameioSyncs(data) {
        var out = [];
        for (var i = 0; i < data.length; i++) {
            var comp = findCompByID(data[i].compId);
            if (!comp) continue;
            data[i].compName = comp.name;
            out.push(data[i]);
        }
        return out;
    }

    function frameioSyncsJSON(data) {
        var parts = [];
        for (var i = 0; i < data.length; i++) {
            parts.push('{"compId":' + data[i].compId + ',"compName":' + quote(data[i].compName) + ',"link":' + quote(data[i].link) + '}');
        }
        return '[' + parts.join(",") + ']';
    }

    // ---------------------------------------------------------
    // Comp / marker helpers
    // ---------------------------------------------------------

    function findCompByID(id) {
        if (!app.project) return null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.id === id) return item;
        }
        return null;
    }

    function activeComp() {
        var item = app.project ? app.project.activeItem : null;
        return (item instanceof CompItem) ? item : null;
    }

    function listComps() {
        var out = [];
        if (!app.project) return out;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem) out.push({ id: item.id, name: item.name, frameRate: item.frameRate });
        }
        return out;
    }

    function pad(n, digits) {
        var s = String(n);
        while (s.length < digits) s = "0" + s;
        return s;
    }

    // HH:MM:SS:FF, frames at the comp's own frame rate — this is just
    // where `seconds` (already correct, real-world seconds) lands on the
    // comp's frame grid, the same way AE's own timeline ruler would show it.
    function timeText(comp, seconds) {
        if (!comp) return "0:00:00:00";
        var fps = comp.frameRate;
        var roundedFPS = Math.round(fps);
        var totalFrames = Math.round(seconds * fps);
        var frames = totalFrames % roundedFPS;
        var totalSeconds = Math.floor(totalFrames / fps);
        var secs = totalSeconds % 60;
        var mins = Math.floor(totalSeconds / 60) % 60;
        var hours = Math.floor(totalSeconds / 3600);
        return pad(hours, 2) + ":" + pad(mins, 2) + ":" + pad(secs, 2) + ":" + pad(frames, 2);
    }

    function getNextMarkerName(comp) {
        var highest = 0;
        if (!comp || !comp.markerProperty) return "Comment 1";
        var markers = comp.markerProperty;
        for (var i = 1; i <= markers.numKeys; i++) {
            var marker = markers.keyValue(i);
            if (marker && marker.comment) {
                var match = marker.comment.match(/^(?:Note|Comment)\s+(\d+)$/i);
                if (match) {
                    var num = parseInt(match[1], 10);
                    if (num > highest) highest = num;
                }
            }
        }
        return "Comment " + (highest + 1);
    }

    function findMarkerIndex(comp, item) {
        if (!comp || !comp.markerProperty || !item || !item.qcID) return -1;
        var markers = comp.markerProperty;
        var tag = trackingTag(item.qcID);
        for (var i = 1; i <= markers.numKeys; i++) {
            var marker = markers.keyValue(i);
            try { if (marker.chapter === tag) return i; } catch (e) {}
            if (marker.comment && marker.comment.indexOf("[BBQC:" + item.qcID + "]") !== -1) return i;
        }
        return -1;
    }

    function syncItem(item) {
        if (!item.linked) return;
        var comp = findCompByID(item.compID);
        if (!comp) return;
        var idx = findMarkerIndex(comp, item);
        if (idx < 1) return;
        item.time = comp.markerProperty.keyTime(idx);
        if (!item.markerName) item.markerName = getNextMarkerName(comp);

        var marker = comp.markerProperty.keyValue(idx);
        var changed = false;
        if (marker.comment !== item.markerName) { marker.comment = item.markerName; changed = true; }
        try { if (marker.chapter !== trackingTag(item.qcID)) { marker.chapter = trackingTag(item.qcID); changed = true; } } catch (e) {}
        if (changed) {
            try { comp.markerProperty.setValueAtKey(idx, marker); } catch (e2) {}
        }
    }

    function syncAll(data) {
        for (var i = 0; i < data.length; i++) syncItem(data[i]);
    }

    function createMarker(comp, time, qcID, markerName) {
        var marker = new MarkerValue(markerName);
        try { marker.chapter = trackingTag(qcID); } catch (e) {}
        comp.markerProperty.setValueAtTime(time, marker);
    }

    function visibleIndexes(data, viewMode) {
        var out = [];
        var comp = activeComp();
        for (var i = 0; i < data.length; i++) {
            if (viewMode !== "comp") out.push(i);
            else if (!data[i].linked) out.push(i);
            else if (comp && data[i].compID === comp.id) out.push(i);
        }
        return out;
    }

    function findItemIndex(data, qcID) {
        for (var i = 0; i < data.length; i++) if (data[i].qcID === qcID) return i;
        return -1;
    }

    function findItemByFrameioId(data, commentId) {
        for (var i = 0; i < data.length; i++) if (data[i].frameioCommentId === commentId) return i;
        return -1;
    }

    // ---------------------------------------------------------
    // State JSON
    // ---------------------------------------------------------

    function stateJSON(viewMode) {
        var data = load();
        syncAll(data);
        save(data);

        var comp = activeComp();
        var vis = visibleIndexes(data, viewMode);
        var notes = [];
        var comps = listComps();
        var compsJSON = [];
        for (var k = 0; k < comps.length; k++) {
            compsJSON.push('{"id":' + comps[k].id + ',"name":' + quote(comps[k].name) + ',"frameRate":' + comps[k].frameRate + '}');
        }

        for (var j = 0; j < vis.length; j++) {
            var item = data[vis[j]];
            var linkedComp = item.linked ? findCompByID(item.compID) : null;
            notes.push(
                "{" +
                '"qcID":' + quote(item.qcID) + ',' +
                '"checked":' + bool(item.checked) + ',' +
                '"title":' + quote(item.title) + ',' +
                '"note":' + quote(item.note) + ',' +
                '"linked":' + bool(item.linked) + ',' +
                '"compID":' + String(item.compID || -1) + ',' +
                '"compName":' + quote(item.compName || "") + ',' +
                '"time":' + String(item.time || 0) + ',' +
                '"timeText":' + quote(item.linked ? timeText(linkedComp, item.time) : "") + ',' +
                '"markerName":' + quote(item.markerName || "") + ',' +
                '"frameioCommentId":' + quote(item.frameioCommentId || "") +
                "}"
            );
        }

        var frameioSyncs = refreshFrameioSyncs(loadFrameioSyncs());
        saveFrameioSyncs(frameioSyncs);

        return "{" +
            '"projectKey":' + quote(getProjectKey()) + ',' +
            '"projectName":' + quote(getProjectName()) + ',' +
            '"activeCompId":' + String(comp ? comp.id : -1) + ',' +
            '"activeCompName":' + quote(comp ? comp.name : "") + ',' +
            '"activeTime":' + String(comp ? comp.time : 0) + ',' +
            '"activeTimeText":' + quote(comp ? timeText(comp, comp.time) : "") + ',' +
            '"notes":[' + notes.join(",") + "]," +
            '"comps":[' + compsJSON.join(",") + "]," +
            '"frameioSyncs":' + frameioSyncsJSON(frameioSyncs) +
            "}";
    }

    // ---------------------------------------------------------
    // Public API
    // ---------------------------------------------------------

    api.getState = function (viewMode) {
        try { return stateJSON(viewMode || "project"); }
        catch (e) { return '{"projectKey":"","projectName":"BBQC","activeCompId":-1,"activeCompName":"","activeTime":0,"activeTimeText":"","notes":[],"comps":[],"frameioSyncs":[]}'; }
    };

    api.addProjectNote = function (title, note) {
        var data = load();
        data.push({ checked: false, title: title, note: note || "", linked: false, compID: -1, compName: "", time: 0, qcID: makeQCID(), markerName: "" });
        save(data);
        return "1";
    };

    // `time` is optional — pass it to place the marker at an explicit
    // comp-relative time (e.g. a manually-typed timecode); omit it to use
    // the live playhead position instead.
    api.addPlayheadNote = function (title, note, time) {
        var comp = activeComp();
        if (!comp) return '{"ok":false,"message":"Open a composition first, then place the playhead where you want the comment."}';
        var data = load();
        var id = makeQCID();
        var markerName = getNextMarkerName(comp);
        var t = comp.time;
        if (time !== undefined && time !== null && String(time) !== "") {
            var parsed = parseFloat(time);
            if (!isNaN(parsed) && parsed >= 0) t = parsed;
        }
        app.beginUndoGroup("BBQC Add Comment");
        try { createMarker(comp, t, id, markerName); }
        catch (e) { app.endUndoGroup(); return '{"ok":false,"message":' + quote("Could not create the comp marker: " + e.toString()) + '}'; }
        app.endUndoGroup();
        data.push({ checked: false, title: title, note: note || "", linked: true, compID: comp.id, compName: comp.name, time: t, qcID: id, markerName: markerName });
        save(data);
        return '{"ok":true}';
    };

    api.importFrameioComment = function (commentId, shareId, title, note, time, compId) {
        var parsedCompId = parseInt(compId, 10);
        var comp = findCompByID(isNaN(parsedCompId) ? -1 : parsedCompId);
        if (!comp) return '{"ok":false,"added":false,"message":"Pick a composition to import Frame.io comments into."}';
        var data = load();
        var t = parseFloat(time);
        if (isNaN(t) || t < 0) t = 0;

        // Already imported — if its stored time no longer matches what we'd
        // compute today (e.g. it was imported before a fix to how Frame.io
        // timestamps convert to seconds), move its marker rather than
        // silently leaving stale data in place.
        var existingIdx = findItemByFrameioId(data, commentId);
        if (existingIdx >= 0) {
            var existing = data[existingIdx];
            if (existing.linked && Math.abs((existing.time || 0) - t) > 0.01) {
                var oldIdx = findMarkerIndex(comp, existing);
                app.beginUndoGroup("BBQC Update Frame.io Comment Time");
                try {
                    if (oldIdx > 0) comp.markerProperty.removeKey(oldIdx);
                    createMarker(comp, t, existing.qcID, existing.markerName || getNextMarkerName(comp));
                } catch (e) { app.endUndoGroup(); return '{"ok":true,"added":false,"updated":false}'; }
                app.endUndoGroup();
                existing.time = t;
                save(data);
                return '{"ok":true,"added":false,"updated":true}';
            }
            return '{"ok":true,"added":false,"updated":false}';
        }

        var id = makeQCID();
        var markerName = getNextMarkerName(comp);

        app.beginUndoGroup("BBQC Import Frame.io Comment");
        try { createMarker(comp, t, id, markerName); }
        catch (e) { app.endUndoGroup(); return '{"ok":false,"added":false,"message":' + quote("Could not create the comp marker: " + e.toString()) + '}'; }
        app.endUndoGroup();

        data.push({
            checked: false,
            title: title,
            note: note || "",
            linked: true,
            compID: comp.id,
            compName: comp.name,
            time: t,
            qcID: id,
            markerName: markerName,
            frameioCommentId: commentId || "",
            frameioShareId: shareId || ""
        });
        save(data);
        return '{"ok":true,"added":true,"updated":false}';
    };

    api.setCompFrameRate = function (compId, fps) {
        var id = parseInt(compId, 10);
        var comp = findCompByID(isNaN(id) ? -1 : id);
        if (!comp) return '{"ok":false,"message":"Composition not found."}';
        var rate = parseFloat(fps);
        if (isNaN(rate) || rate <= 0) return '{"ok":false,"message":"Invalid frame rate."}';
        app.beginUndoGroup("BBQC Set Composition Frame Rate");
        try { comp.frameRate = rate; }
        catch (e) { app.endUndoGroup(); return '{"ok":false,"message":' + quote("Could not change the frame rate: " + e.toString()) + '}'; }
        app.endUndoGroup();
        return '{"ok":true}';
    };

    api.getFrameioSyncs = function () {
        var data = refreshFrameioSyncs(loadFrameioSyncs());
        saveFrameioSyncs(data);
        return frameioSyncsJSON(data);
    };

    api.addFrameioSync = function (compId, link) {
        var id = parseInt(compId, 10);
        var comp = findCompByID(isNaN(id) ? -1 : id);
        if (!comp) return '{"ok":false,"message":"Pick a composition first."}';
        if (!link) return '{"ok":false,"message":"Paste a Frame.io link first."}';

        var data = refreshFrameioSyncs(loadFrameioSyncs());
        var existing = -1;
        for (var i = 0; i < data.length; i++) if (data[i].compId === id) { existing = i; break; }
        if (existing >= 0) data[existing].link = link;
        else data.push({ compId: id, compName: comp.name, link: link });

        saveFrameioSyncs(data);
        return '{"ok":true,"syncs":' + frameioSyncsJSON(data) + '}';
    };

    api.removeFrameioSync = function (compId) {
        var id = parseInt(compId, 10);
        var data = refreshFrameioSyncs(loadFrameioSyncs());
        var out = [];
        for (var i = 0; i < data.length; i++) if (data[i].compId !== id) out.push(data[i]);
        saveFrameioSyncs(out);
        return '{"ok":true,"syncs":' + frameioSyncsJSON(out) + '}';
    };

    // Used by the background poll to check for new Frame.io comments
    // without importing them — comment ids are Frame.io UUIDs, so a plain
    // comma join/split is safe (never contains a comma itself).
    api.countNewFrameioComments = function (commentIdsCsv) {
        var ids = commentIdsCsv ? String(commentIdsCsv).split(",") : [];
        var data = load();
        var newCount = 0;
        for (var i = 0; i < ids.length; i++) {
            if (findItemByFrameioId(data, ids[i]) < 0) newCount++;
        }
        return String(newCount);
    };

    api.toggleNote = function (qcID, checked) {
        var data = load();
        var i = findItemIndex(data, qcID);
        if (i >= 0) data[i].checked = checked === true;
        save(data);
        return "1";
    };

    api.editNote = function (qcID, title, note) {
        var data = load();
        var i = findItemIndex(data, qcID);
        if (i >= 0) { data[i].title = title; data[i].note = note || ""; syncItem(data[i]); }
        save(data);
        return "1";
    };

    api.deleteNote = function (qcID) {
        var data = load();
        var i = findItemIndex(data, qcID);
        if (i < 0) return "0";
        var item = data[i];
        if (item.linked) {
            var comp = findCompByID(item.compID);
            if (comp) {
                var idx = findMarkerIndex(comp, item);
                if (idx > 0) {
                    app.beginUndoGroup("BBQC Delete Comment");
                    try { comp.markerProperty.removeKey(idx); } catch (e) {}
                    app.endUndoGroup();
                }
            }
        }
        data.splice(i, 1);
        save(data);
        return "1";
    };

    api.jumpTo = function (qcID) {
        var data = load();
        var i = findItemIndex(data, qcID);
        if (i < 0 || !data[i].linked) return "0";
        var item = data[i];
        var comp = findCompByID(item.compID);
        if (!comp) return "0";
        var idx = findMarkerIndex(comp, item);
        if (idx > 0) item.time = comp.markerProperty.keyTime(idx);
        try { comp.openInViewer(); comp.time = item.time; } catch (e) { return "0"; }
        save(data);
        return "1";
    };


    api.reorderVisible = function (viewMode, joinedIDs) {
        var data = load();
        var ids = joinedIDs ? joinedIDs.split("|") : [];
        if (!ids.length) return "0";
        var vis = visibleIndexes(data, viewMode || "project");
        if (vis.length !== ids.length) return "0";
        var byID = {};
        for (var i = 0; i < data.length; i++) byID[data[i].qcID] = data[i];
        for (var j = 0; j < vis.length; j++) if (byID[ids[j]]) data[vis[j]] = byID[ids[j]];
        save(data);
        return "1";
    };

    api.getSummary = function (viewMode) {
        var data = load();
        syncAll(data);
        save(data);
        var vis = visibleIndexes(data, viewMode || "project");
        var comp = activeComp();
        var text = "BBQC - " + getProjectName() + "\n";
        if (viewMode === "comp") text += "View: " + (comp ? comp.name : "Active Comp") + "\n";
        text += "\nRemaining QC\n------------------------------\n";
        var complete = 0;
        var open = 0;
        for (var i = 0; i < vis.length; i++) {
            var item = data[vis[i]];
            if (item.checked) { complete++; continue; }
            open++;
            text += "\n- " + item.title + "\n";
            if (item.linked) {
                var lc = findCompByID(item.compID);
                text += "  " + (item.markerName ? item.markerName + " | " : "") + (lc ? lc.name + " | " + timeText(lc, item.time) : item.compName) + "\n";
            }
            if (item.note) text += "  " + item.note + "\n";
        }
        if (open === 0) text += "\nAll visible QC items are complete.\n";
        text += "\n------------------------------\n" + complete + " complete / " + vis.length + " total";
        return text;
    };

})(BBQC);
