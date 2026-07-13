// Lineup CEP — Host Script
// All ExtendScript logic. Called via CSInterface.evalScript() from the HTML panel.
// #include paths are relative to this file (host/).

#include "LST.js"

// ── Global clipboard state ────────────────────────────────────────────────────
var _anchorClipboard = null;   // { anchor: [x, y] }
var _easeClipboard   = null;   // array of { inType, outType, inEase, outEase }
var _easeClipboardType = null;

// ── Position helpers ──────────────────────────────────────────────────────────

function shiftPosition(posProp, dx, dy, is3D) {
    if (posProp.dimensionsSeparated) {
        var xp = posProp.getSeparationFollower(0);
        var yp = posProp.getSeparationFollower(1);
        if (xp.numKeys > 0) {
            for (var k = 1; k <= xp.numKeys; k++) xp.setValueAtKey(k, xp.keyValue(k) + dx);
        } else { xp.setValue(xp.value + dx); }
        if (yp.numKeys > 0) {
            for (var k = 1; k <= yp.numKeys; k++) yp.setValueAtKey(k, yp.keyValue(k) + dy);
        } else { yp.setValue(yp.value + dy); }
    } else if (posProp.numKeys > 0) {
        for (var k = 1; k <= posProp.numKeys; k++) {
            var v = posProp.keyValue(k);
            posProp.setValueAtKey(k, is3D ? [v[0]+dx, v[1]+dy, v[2]] : [v[0]+dx, v[1]+dy]);
        }
    } else {
        var v = posProp.value;
        posProp.setValue(is3D ? [v[0]+dx, v[1]+dy, v[2]] : [v[0]+dx, v[1]+dy]);
    }
}

function setPositionAt(posProp, newPos, t, is3D) {
    if (posProp.dimensionsSeparated) {
        var xp = posProp.getSeparationFollower(0);
        var yp = posProp.getSeparationFollower(1);
        if (xp.numKeys > 0) { xp.setValueAtTime(t, newPos[0]); } else { xp.setValue(newPos[0]); }
        if (yp.numKeys > 0) { yp.setValueAtTime(t, newPos[1]); } else { yp.setValue(newPos[1]); }
    } else if (posProp.numKeys > 0) {
        posProp.setValueAtTime(t, newPos);
    } else {
        posProp.setValue(newPos);
    }
}

function getZ(posProp) {
    if (posProp.dimensionsSeparated) return posProp.getSeparationFollower(2).value;
    return posProp.value[2];
}

function setZ(posProp, targetZ) {
    if (posProp.dimensionsSeparated) {
        var zp = posProp.getSeparationFollower(2);
        if (zp.numKeys > 0) {
            for (var k = 1; k <= zp.numKeys; k++) zp.setValueAtKey(k, targetZ);
        } else { zp.setValue(targetZ); }
    } else if (posProp.numKeys > 0) {
        for (var k = 1; k <= posProp.numKeys; k++) {
            var v = posProp.keyValue(k);
            posProp.setValueAtKey(k, [v[0], v[1], targetZ]);
        }
    } else {
        var v = posProp.value;
        posProp.setValue([v[0], v[1], targetZ]);
    }
}

// ── Bounds / anchor helpers ───────────────────────────────────────────────────

function getLayerCompBounds(layer, comp) {
    var r = layer.sourceRectAtTime(comp.time, false);
    var left = r.left, top = r.top, right = left + r.width, bottom = top + r.height;
    var p1 = LST.toComp(layer, [left,  top,    0]);
    var p2 = LST.toComp(layer, [right, top,    0]);
    var p3 = LST.toComp(layer, [right, bottom, 0]);
    var p4 = LST.toComp(layer, [left,  bottom, 0]);
    var xs = [p1[0], p2[0], p3[0], p4[0]];
    var ys = [p1[1], p2[1], p3[1], p4[1]];
    return {
        left:   Math.min.apply(null, xs), right:  Math.max.apply(null, xs),
        top:    Math.min.apply(null, ys), bottom: Math.max.apply(null, ys),
        width:  Math.max.apply(null, xs) - Math.min.apply(null, xs),
        height: Math.max.apply(null, ys) - Math.min.apply(null, ys)
    };
}

function anchorLocToPoint(loc, lw, lh, left, top) {
    return [left + (loc % 3) * lw / 2, top + Math.floor(loc / 3) * lh / 2];
}

function getSourceRect(layer, t, ignoreMasks) {
    if (ignoreMasks) return layer.sourceRectAtTime(t, false);
    var fullRect = layer.sourceRectAtTime(t, false);
    var mp;
    try { mp = layer.property("ADBE Mask Parade"); } catch(e) { return fullRect; }
    if (!mp || mp.numProperties === 0) return fullRect;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
    for (var i = 1; i <= mp.numProperties; i++) {
        try {
            var mask = mp.property(i);
            if (!mask.enabled) continue;
            var mode = mask.maskMode;
            if (mode === MaskMode.NONE || mode === MaskMode.SUBTRACT) continue;
            var shape = mask.property("ADBE Mask Shape").valueAtTime(t, false);
            var verts = shape.vertices, inT = shape.inTangents, outT = shape.outTangents;
            if (!verts || verts.length === 0) continue;
            for (var v = 0; v < verts.length; v++) {
                var vx = verts[v][0], vy = verts[v][1];
                if (vx < minX) minX = vx; if (vy < minY) minY = vy;
                if (vx > maxX) maxX = vx; if (vy > maxY) maxY = vy;
                if (outT && outT[v]) {
                    var ox = vx + outT[v][0], oy = vy + outT[v][1];
                    if (ox < minX) minX = ox; if (oy < minY) minY = oy;
                    if (ox > maxX) maxX = ox; if (oy > maxY) maxY = oy;
                }
                if (inT && inT[v]) {
                    var ix = vx + inT[v][0], iy = vy + inT[v][1];
                    if (ix < minX) minX = ix; if (iy < minY) minY = iy;
                    if (ix > maxX) maxX = ix; if (iy > maxY) maxY = iy;
                }
            }
            found = true;
        } catch(e) {}
    }
    if (!found || minX === Infinity) return fullRect;
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

function collapsePosition(layer) {
    var pos = layer.position;
    if (!pos.dimensionsSeparated) return;
    var x = pos.getSeparationFollower(0).value;
    var y = pos.getSeparationFollower(1).value;
    var z = layer.threeDLayer ? pos.getSeparationFollower(2).value : 0;
    pos.dimensionsSeparated = false;
    while (pos.numKeys > 0) pos.removeKey(1);
    pos.setValue(layer.threeDLayer ? [x, y, z] : [x, y]);
}

function fromComp(layer, compPoint) {
    var pos = layer.position.value;
    var anchor = layer.anchorPoint.value;
    var scale = layer.scale.value;
    var rotation = layer.rotation.value * (Math.PI / 180);
    if (layer.parent) compPoint = fromComp(layer.parent, compPoint);
    var dx = compPoint[0] - pos[0], dy = compPoint[1] - pos[1];
    var cos = Math.cos(-rotation), sin = Math.sin(-rotation);
    var rx = cos * dx - sin * dy, ry = sin * dx + cos * dy;
    return [rx / (scale[0] / 100) + anchor[0], ry / (scale[1] / 100) + anchor[1]];
}

function applyAnchorShift(layer, newAnchor) {
    var comp = app.project.activeItem;
    var t = comp.time;
    var is3D = layer.threeDLayer;
    var oldA = layer.anchorPoint.value;
    var dAx = newAnchor[0] - oldA[0];
    var dAy = newAnchor[1] - oldA[1];
    // Delta must be in parent space — use only this layer's own rotation/scale
    // (not the full parent chain) to convert from local to parent space.
    var rot = layer.rotation.value * (Math.PI / 180);
    var sx  = layer.scale.value[0] / 100;
    var sy  = layer.scale.value[1] / 100;
    var cos = Math.cos(rot), sin = Math.sin(rot);
    var deltaX = (cos * dAx - sin * dAy) * sx;
    var deltaY = (sin * dAx + cos * dAy) * sy;
    if (layer.anchorPoint.numKeys > 0) {
        layer.anchorPoint.setValueAtTime(t, newAnchor);
    } else {
        layer.anchorPoint.setValue(newAnchor);
    }
    shiftPosition(layer.position, deltaX, deltaY, is3D);
}

function pasteAnchor(layer, newAnchor) {
    try {
        if (!layer) return;
        var newAnchorLocal = fromComp(layer, newAnchor);
        var oldAnchorLocal = layer.anchorPoint.value;
        var dAx = newAnchorLocal[0] - oldAnchorLocal[0];
        var dAy = newAnchorLocal[1] - oldAnchorLocal[1];
        // Delta must be in parent space — use only this layer's own rotation/scale
        // (not the full parent chain) to convert from local to parent space.
        var rot = layer.rotation.value * (Math.PI / 180);
        var sx  = layer.scale.value[0] / 100;
        var sy  = layer.scale.value[1] / 100;
        var cos = Math.cos(rot), sin = Math.sin(rot);
        var deltaX = (cos * dAx - sin * dAy) * sx;
        var deltaY = (sin * dAx + cos * dAy) * sy;
        if (layer.anchorPoint.numKeys > 0) {
            for (var k = 1; k <= layer.anchorPoint.numKeys; k++) {
                var val = layer.anchorPoint.keyValue(k);
                var nv = [val[0] + dAx, val[1] + dAy];
                if (val.length > 2) nv.push(val[2]);
                layer.anchorPoint.setValueAtKey(k, nv);
            }
        } else {
            layer.anchorPoint.setValue(newAnchorLocal);
        }
        shiftPosition(layer.position, deltaX, deltaY, layer.threeDLayer);
    } catch (err) { alert("Anchor Paste ERROR:\n" + err.toString()); }
}

function derigLayers(comp, targetLayers) {
    function readExpr(layer) {
        try { var p = layer.position; if (p && p.expressionEnabled) return p.expression || ""; } catch (e) {}
        try { var xf = layer.position.getSeparationFollower(0); if (xf && xf.expressionEnabled) return xf.expression || ""; } catch (e) {}
        return "";
    }
    function clearExpr(layer) {
        try {
            if (layer.position.dimensionsSeparated) collapsePosition(layer);
            var p = layer.position;
            if (p && p.expressionEnabled) { p.expressionEnabled = false; p.expression = ""; }
        } catch (e) {}
    }
    var rigNames = [];
    for (var i = 0; i < targetLayers.length; i++) {
        var expr = readExpr(targetLayers[i]);
        if (expr) {
            var marker = 'thisComp.layer("', si = expr.indexOf(marker);
            if (si !== -1) {
                si += marker.length;
                var ei = expr.indexOf('"', si);
                if (ei !== -1) {
                    var rn = expr.substring(si, ei);
                    if (rn.indexOf("Path Rig") === 0) {
                        var known = false;
                        for (var k = 0; k < rigNames.length; k++) { if (rigNames[k] === rn) { known = true; break; } }
                        if (!known) rigNames.push(rn);
                    }
                }
            }
        }
        clearExpr(targetLayers[i]);
        try {
            var fxGrp = targetLayers[i].property("ADBE Effect Parade");
            if (fxGrp) {
                for (var j = fxGrp.numProperties; j >= 1; j--) {
                    try { if (fxGrp.property(j).name === "Progress") { fxGrp.property(j).remove(); break; } } catch (e) {}
                }
            }
        } catch (e) {}
    }
    for (var r = 0; r < rigNames.length; r++) {
        var rn = rigNames[r], stillUsed = false;
        for (var li = 1; li <= comp.numLayers; li++) {
            try {
                var expr = readExpr(comp.layer(li));
                if (expr && expr.indexOf('"' + rn + '"') !== -1) { stillUsed = true; break; }
            } catch (e) {}
        }
        if (!stillUsed) {
            for (var li = comp.numLayers; li >= 1; li--) {
                try { if (comp.layer(li).name === rn) { comp.layer(li).remove(); break; } } catch (e) {}
            }
        }
    }
}

// ── ALIGN ─────────────────────────────────────────────────────────────────────
// alignIdx: 0=left 1=centerX 2=right 3=top 4=centerY 5=bottom
// alignToSelection: 1=selection bounds 0=comp
// margin: number, usePercent: 0/1, offsetKeys: 0/1

function lineup_align(alignIdx, alignToSelection, margin, usePercent, offsetKeys) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";

        var modes  = ["left","centerX","right","top","centerY","bottom"];
        var labels = ["Align Left","Center Horizontal","Align Right","Align Top","Center Vertical","Align Bottom"];

        var selRect = null;
        if (alignToSelection) {
            var lf = Infinity, tp = Infinity, rt = -Infinity, bt = -Infinity;
            for (var i = 0; i < layers.length; i++) {
                var r = getLayerCompBounds(layers[i], comp);
                if (!r) continue;
                if (r.left < lf) lf = r.left; if (r.top  < tp) tp = r.top;
                if (r.right > rt) rt = r.right; if (r.bottom > bt) bt = r.bottom;
            }
            selRect = { left:lf, top:tp, right:rt, bottom:bt, width:rt-lf, height:bt-tp };
        }

        app.beginUndoGroup("Align: " + labels[alignIdx]);
        var mode = modes[alignIdx];

        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i], is3D = layer.threeDLayer;
            var rect  = getLayerCompBounds(layer, comp);
            var exr   = selRect;

            if (exr) {
                rect = { left:rect.left-exr.left, right:rect.right-exr.left,
                         top:rect.top-exr.top, bottom:rect.bottom-exr.top,
                         width:rect.width, height:rect.height };
            }

            var mH = margin, mW = margin;
            if (usePercent) { mH = (margin/100)*comp.height; mW = (margin/100)*comp.width; }

            var cw = exr ? exr.width  : comp.width;
            var ch = exr ? exr.height : comp.height;

            var posProp = layer.position;
            var pos = posProp.value;
            var np  = is3D ? [pos[0],pos[1],pos[2]] : [pos[0],pos[1]];

            switch (mode) {
                case "left":    np[0] += mW - rect.left;                        break;
                case "right":   np[0] += (cw-mW) - rect.right;                 break;
                case "top":     np[1] += mH - rect.top;                         break;
                case "bottom":  np[1] += (ch-mH) - rect.bottom;                break;
                case "centerX": np[0] += (cw/2) - (rect.left + rect.width/2);  break;
                case "centerY": np[1] += (ch/2) - (rect.top  + rect.height/2); break;
            }

            if (is3D && Math.abs(pos[2]) > 0.01) {
                for (var iter = 0; iter < 5; iter++) {
                    if (posProp.dimensionsSeparated) {
                        posProp.getSeparationFollower(0).setValue(np[0]);
                        posProp.getSeparationFollower(1).setValue(np[1]);
                        posProp.getSeparationFollower(2).setValue(np[2]);
                    } else { posProp.setValue(np); }
                    var nr = getLayerCompBounds(layer, comp);
                    var ex = 0, ey = 0;
                    switch (mode) {
                        case "left":    ex = mW - nr.left; break;
                        case "right":   ex = (cw-mW) - nr.right; break;
                        case "top":     ey = mH - nr.top; break;
                        case "bottom":  ey = (ch-mH) - nr.bottom; break;
                        case "centerX": ex = (cw/2) - (nr.left + nr.width/2); break;
                        case "centerY": ey = (ch/2) - (nr.top  + nr.height/2); break;
                    }
                    if (Math.abs(ex) < 0.5 && Math.abs(ey) < 0.5) break;
                    np[0] += ex; np[1] += ey;
                }
            }

            if (offsetKeys) {
                shiftPosition(posProp, np[0]-pos[0], np[1]-pos[1], is3D);
            } else {
                setPositionAt(posProp, np, comp.time, is3D);
            }
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── DISTRIBUTE ────────────────────────────────────────────────────────────────
// horizontal: 1=H 0=V, distMode: 0=comp 1=selection 2=keyLayer, spacing: px

function lineup_distribute(horizontal, distMode, spacing) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2) return "ERROR: Select at least 2 layers";
        var H = !!horizontal;

        app.beginUndoGroup("Distribute " + (H ? "Horizontal" : "Vertical"));

        if (distMode === 2) {
            var kl = layers[0], kb = getLayerCompBounds(kl, comp);
            var kc = H ? kb.left + kb.width/2 : kb.top + kb.height/2;
            var bef = [], aft = [];
            for (var i = 1; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                var c = H ? b.left + b.width/2 : b.top + b.height/2;
                (c < kc ? bef : aft).push(layers[i]);
            }
            bef.sort(function(a,b){ var A=getLayerCompBounds(a,comp),B=getLayerCompBounds(b,comp); return H?B.left-A.left:B.top-A.top; });
            aft.sort(function(a,b){ var A=getLayerCompBounds(a,comp),B=getLayerCompBounds(b,comp); return H?A.left-B.left:A.top-B.top; });
            var edgeBef = H ? kb.left  : kb.top;
            var edgeAft = H ? kb.right : kb.bottom;
            for (var i = 0; i < bef.length; i++) {
                var l = bef[i], bd = getLayerCompBounds(l, comp);
                var sz = H ? bd.width : bd.height, ctr = H ? bd.left+bd.width/2 : bd.top+bd.height/2;
                var dlt = (edgeBef - spacing - sz/2) - ctr;
                shiftPosition(l.position, H?dlt:0, H?0:dlt, l.threeDLayer);
                edgeBef -= spacing + sz;
            }
            for (var i = 0; i < aft.length; i++) {
                var l = aft[i], bd = getLayerCompBounds(l, comp);
                var sz = H ? bd.width : bd.height, ctr = H ? bd.left+bd.width/2 : bd.top+bd.height/2;
                var dlt = (edgeAft + spacing + sz/2) - ctr;
                shiftPosition(l.position, H?dlt:0, H?0:dlt, l.threeDLayer);
                edgeAft += spacing + sz;
            }
        } else {
            var ld = [];
            for (var i = 0; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                var ctr  = H ? b.left + b.width/2  : b.top + b.height/2;
                var half = H ? b.width/2            : b.height/2;
                ld.push({ layer:layers[i], center:ctr, half:half });
            }
            ld.sort(function(a,b){ return a.center-b.center; });
            // mode 0: end layers flush against comp edges (shift rStart/rEnd inward by each end layer's half-size)
            // mode 1: end layers stay put, middles distributed by center between them
            var rStart = (distMode===0) ? ld[0].half                                              : ld[0].center;
            var rEnd   = (distMode===0) ? (H ? comp.width : comp.height) - ld[ld.length-1].half   : ld[ld.length-1].center;
            var step   = (rEnd - rStart) / (ld.length - 1);
            for (var i = 0; i < ld.length; i++) {
                var dlt = (rStart + step*i) - ld[i].center;
                shiftPosition(ld[i].layer.position, H?dlt:0, H?0:dlt, ld[i].layer.threeDLayer);
            }
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_zDistribute(distMode, spacing, zStart, zEnd, even, step) {
    if (zStart === undefined || zStart === null) zStart = 0;
    if (zEnd   === undefined || zEnd   === null) zEnd   = 1000;
    if (even   === undefined || even   === null) even   = 1;
    if (step   === undefined || step   === null) step   = 100;
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2) return "ERROR: Select at least 2 layers";
        for (var i = 0; i < layers.length; i++)
            if (!layers[i].threeDLayer) return "ERROR: All layers must be 3D. \"" + layers[i].name + "\" is not 3D.";

        app.beginUndoGroup("Distribute Z");

        if (distMode === 2) {
            var kz = getZ(layers[0].position), bef = [], aft = [];
            for (var i = 1; i < layers.length; i++)
                (getZ(layers[i].position) < kz ? bef : aft).push(layers[i]);
            bef.sort(function(a,b){ return getZ(b.position)-getZ(a.position); });
            aft.sort(function(a,b){ return getZ(a.position)-getZ(b.position); });
            for (var i = 0; i < bef.length; i++) setZ(bef[i].position, kz-(i+1)*spacing);
            for (var i = 0; i < aft.length; i++) setZ(aft[i].position, kz+(i+1)*spacing);
        } else {
            var data = [];
            for (var i = 0; i < layers.length; i++) data.push({ layer:layers[i], z:getZ(layers[i].position) });
            data.sort(function(a,b){ return a.z-b.z; });
            var zMin = (distMode===0)?zStart:data[0].z, zMax = (distMode===0)?zEnd:data[data.length-1].z, n=data.length;
            var rangeLen = zMax - zMin;
            for (var i = 0; i < n; i++) {
                var tz;
                if (even || step <= 0 || rangeLen <= 0) {
                    tz = (n===1) ? (zMin+zMax)/2 : zMin+(i/(n-1))*rangeLen;
                } else {
                    var numSlots = Math.floor(rangeLen / step) + 1;
                    tz = zMin + (i % numSlots) * step;
                }
                setZ(data[i].layer.position, tz);
            }
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function clearPositionKeys(layer) {
    try {
        var pos = layer.position;
        if (pos.dimensionsSeparated) {
            var xp = pos.getSeparationFollower(0), yp = pos.getSeparationFollower(1);
            while (xp.numKeys > 0) xp.removeKey(1);
            while (yp.numKeys > 0) yp.removeKey(1);
        } else {
            while (pos.numKeys > 0) pos.removeKey(1);
        }
    } catch(e) {}
}

function lineup_pathDistribute(distMode, spacing, rotate) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2) return "ERROR: Select a shape layer as the topmost, then the layers to distribute.";
        var pathLayer = layers[0];
        if (!(pathLayer instanceof ShapeLayer)) return "ERROR: Topmost selected layer must be a shape layer.";

        function findShape(pg) {
            for (var i = 1; i <= pg.numProperties; i++) {
                try {
                    var p = pg.property(i);
                    if (p.matchName === "ADBE Vector Shape - Group") return p.property("ADBE Vector Shape").value;
                    try { if (p.numProperties > 0) { var f = findShape(p); if (f) return f; } } catch(e) {}
                } catch(e) {}
            }
            return null;
        }
        var shape = null;
        try { shape = findShape(pathLayer.property("ADBE Root Vectors Group")); } catch(e) {}
        if (!shape || !shape.vertices || shape.vertices.length < 2) return "ERROR: No bezier path found.";

        function bez(p0,p1,p2,p3,t) {
            var m=1-t;
            return [m*m*m*p0[0]+3*m*m*t*p1[0]+3*m*t*t*p2[0]+t*t*t*p3[0],
                    m*m*m*p0[1]+3*m*m*t*p1[1]+3*m*t*t*p2[1]+t*t*t*p3[1]];
        }
        var verts=shape.vertices, inT=shape.inTangents, outT=shape.outTangents;
        var n=verts.length, numSegs=shape.closed?n:n-1;
        var samples=[{len:0,pt:[verts[0][0],verts[0][1]]}], totalLen=0;
        for (var seg=0; seg<numSegs; seg++) {
            var i0=seg, i1=(seg+1)%n;
            var s0=verts[i0], s1b=[verts[i0][0]+outT[i0][0],verts[i0][1]+outT[i0][1]];
            var s2b=[verts[i1][0]+inT[i1][0],verts[i1][1]+inT[i1][1]], s3=verts[i1];
            for (var k=1; k<=100; k++) {
                var st=k/100, spt=bez(s0,s1b,s2b,s3,st);
                var sprev=samples[samples.length-1].pt;
                var sdx=spt[0]-sprev[0], sdy=spt[1]-sprev[1];
                totalLen+=Math.sqrt(sdx*sdx+sdy*sdy);
                samples.push({len:totalLen,pt:spt});
            }
        }
        function ptAt(progress) {
            if (totalLen===0) return [verts[0][0],verts[0][1]];
            var tgt=progress*totalLen;
            for (var si=1; si<samples.length; si++) {
                if (samples[si].len>=tgt) {
                    var a=samples[si-1],b=samples[si];
                    var frac=(b.len>a.len)?(tgt-a.len)/(b.len-a.len):0;
                    return [a.pt[0]+frac*(b.pt[0]-a.pt[0]),a.pt[1]+frac*(b.pt[1]-a.pt[1])];
                }
            }
            return samples[samples.length-1].pt;
        }
        function tanAt(progress) {
            var eps=0.005, p1=ptAt(Math.max(0,progress-eps)), p2=ptAt(Math.min(1,progress+eps));
            var c1=LST.toComp(pathLayer,[p1[0],p1[1],0]), c2=LST.toComp(pathLayer,[p2[0],p2[1],0]);
            return Math.atan2(c2[1]-c1[1],c2[0]-c1[0])*(180/Math.PI)+90;
        }
        function moveTo(layer, progress) {
            var ptL=ptAt(progress), ptC=LST.toComp(pathLayer,[ptL[0],ptL[1],0]);
            var bounds=getLayerCompBounds(layer,comp);
            var pos=layer.position, pv=pos.value, i3=layer.threeDLayer;
            var np=i3?[pv[0],pv[1],pv[2]]:[pv[0],pv[1]];
            np[0]+=ptC[0]-(bounds.left+bounds.width/2);
            np[1]+=ptC[1]-(bounds.top+bounds.height/2);
            if (pos.dimensionsSeparated) { collapsePosition(layer); layer.position.setValue(np); }
            else pos.setValue(np);
            return bounds;
        }

        var m = layers.length-1;
        app.beginUndoGroup("Path Distribute");

        for (var ai=1; ai<=m; ai++) {
            try { var ar=layers[ai].sourceRectAtTime(comp.time,false); applyAnchorShift(layers[ai],anchorLocToPoint(4,ar.width,ar.height,ar.left,ar.top)); } catch(e) {}
            clearPositionKeys(layers[ai]);
        }

        if (distMode===2) {
            var spc=spacing||0;
            if (spc===0) {
                var cur=0;
                for (var i=0; i<m; i++) {
                    var p=(totalLen>0)?(cur%totalLen)/totalLen:0;
                    var bd=moveTo(layers[i+1],p);
                    if (rotate) try { layers[i+1].rotation.setValue(tanAt(p)); } catch(e) {}
                    cur+=bd.width;
                }
            } else {
                for (var i=0; i<m; i++) {
                    var p=((i*spc)%100)/100;
                    moveTo(layers[i+1],p);
                    if (rotate) try { layers[i+1].rotation.setValue(tanAt(p)); } catch(e) {}
                }
            }
        } else {
            for (var i=0; i<m; i++) {
                var p=(m===1)?0:i/(m-1);
                moveTo(layers[i+1],p);
                if (rotate) try { layers[i+1].rotation.setValue(tanAt(p)); } catch(e) {}
            }
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_radialDistribute(distMode, spacing, radius, rotate) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 1) return "ERROR: Select at least one layer";
        if (isNaN(radius) || radius <= 0) return "ERROR: Enter a valid radius (px)";

        var m=layers.length, cx=comp.width/2, cy=comp.height/2;
        app.beginUndoGroup("Radial Distribute");

        for (var ai=0; ai<m; ai++) {
            try { var ar=layers[ai].sourceRectAtTime(comp.time,false); applyAnchorShift(layers[ai],anchorLocToPoint(4,ar.width,ar.height,ar.left,ar.top)); } catch(e) {}
            clearPositionKeys(layers[ai]);
        }

        function place(layer, angle) {
            var tx=cx+radius*Math.cos(angle), ty=cy+radius*Math.sin(angle);
            var bounds=getLayerCompBounds(layer,comp);
            var pos=layer.position, pv=pos.value, i3=layer.threeDLayer;
            var np=i3?[pv[0],pv[1],pv[2]]:[pv[0],pv[1]];
            np[0]+=tx-(bounds.left+bounds.width/2);
            np[1]+=ty-(bounds.top+bounds.height/2);
            if (pos.dimensionsSeparated) { collapsePosition(layer); layer.position.setValue(np); }
            else pos.setValue(np);
            if (rotate) { try { layer.rotation.setValue(Math.atan2(Math.cos(angle),-Math.sin(angle))*(180/Math.PI)+90); } catch(e) {} }
            return bounds;
        }

        if (distMode===2) {
            var spc=spacing||0;
            if (spc===0) {
                var cur=-Math.PI/2;
                for (var i=0; i<m; i++) { var bd=place(layers[i],cur); cur+=bd.width/radius; }
            } else {
                for (var i=0; i<m; i++) { var f=((i*spc)%100)/100; place(layers[i],-Math.PI/2+f*2*Math.PI); }
            }
        } else {
            for (var i=0; i<m; i++) place(layers[i],(i/m)*2*Math.PI-Math.PI/2);
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_gridDistribute(distMode, cols, rows, alignEdges, hPad, vPad) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 1) return "ERROR: Select at least 1 layer";

        cols = parseInt(cols, 10); if (isNaN(cols) || cols < 1) cols = 1;
        rows = parseInt(rows, 10); if (isNaN(rows) || rows < 1) rows = 1;
        hPad = parseFloat(hPad);
        vPad = parseFloat(vPad);
        var hPadOverride = !isNaN(hPad);
        var vPadOverride = !isNaN(vPad);

        var cLeft, cTop, cWidth, cHeight;
        if (distMode === 1) {
            var sl = Infinity, st = Infinity, sr = -Infinity, sb = -Infinity;
            for (var i = 0; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                if (b.left < sl) sl = b.left;  if (b.top  < st) st = b.top;
                if (b.right > sr) sr = b.right; if (b.bottom > sb) sb = b.bottom;
            }
            cLeft = sl; cTop = st; cWidth = sr - sl; cHeight = sb - st;
        } else {
            cLeft = 0; cTop = 0; cWidth = comp.width; cHeight = comp.height;
        }

        app.beginUndoGroup("Grid Distribute");
        var t = comp.time;

        var cells = [];
        for (var i = 0; i < layers.length; i++) {
            var idx = i % (cols * rows);
            cells.push({
                layer:  layers[i],
                bounds: getLayerCompBounds(layers[i], comp),
                col:    idx % cols,
                row:    Math.floor(idx / cols)
            });
        }

        var cellW = 0, cellH = 0, c, r, k;
        for (k = 0; k < cells.length; k++) {
            if (cells[k].bounds.width  > cellW) cellW = cells[k].bounds.width;
            if (cells[k].bounds.height > cellH) cellH = cells[k].bounds.height;
        }

        // Manual Gap overrides space cells by an exact pixel gap, edge-to-edge,
        // with the resulting grid re-centered on the comp/selection center —
        // taking precedence over both the auto-computed gap and Align Edges,
        // independently per axis.
        var colCX = [], rowCY = [];

        if (hPadOverride) {
            var gridW    = cols * cellW + (cols - 1) * hPad;
            var leftEdge = (cLeft + cWidth / 2) - gridW / 2;
            for (c = 0; c < cols; c++) colCX.push(leftEdge + cellW / 2 + c * (cellW + hPad));
        } else if (alignEdges) {
            for (c = 0; c < cols; c++) {
                colCX.push(cols > 1
                    ? cLeft + cellW / 2 + c * (cWidth  - cellW) / (cols - 1)
                    : cLeft + cWidth  / 2);
            }
        } else {
            var gapX = (cWidth - cols * cellW) / (cols + 1);
            for (c = 0; c < cols; c++) colCX.push(cLeft + gapX * (c + 1) + cellW * c + cellW / 2);
        }

        if (vPadOverride) {
            var gridH   = rows * cellH + (rows - 1) * vPad;
            var topEdge = (cTop + cHeight / 2) - gridH / 2;
            for (r = 0; r < rows; r++) rowCY.push(topEdge + cellH / 2 + r * (cellH + vPad));
        } else if (alignEdges) {
            for (r = 0; r < rows; r++) {
                rowCY.push(rows > 1
                    ? cTop + cellH / 2 + r * (cHeight - cellH) / (rows - 1)
                    : cTop + cHeight / 2);
            }
        } else {
            var gapY = (cHeight - rows * cellH) / (rows + 1);
            for (r = 0; r < rows; r++) rowCY.push(cTop + gapY * (r + 1) + cellH * r + cellH / 2);
        }

        for (k = 0; k < cells.length; k++) {
            var cell = cells[k];
            var pos    = cell.layer.position;
            var posVal = pos.value;
            var is3D   = cell.layer.threeDLayer;
            var newPos = is3D ? [posVal[0], posVal[1], posVal[2]] : [posVal[0], posVal[1]];
            newPos[0] += colCX[cell.col] - (cell.bounds.left + cell.bounds.width  / 2);
            newPos[1] += rowCY[cell.row] - (cell.bounds.top  + cell.bounds.height / 2);
            setPositionAt(pos, newPos, t, is3D);
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── SIZING ────────────────────────────────────────────────────────────────────
// mode: 0=Horizontal 1=Vertical 2=Both, sizeMode: 0=comp 1=selection 2=keyLayer
// crop: 0=Stretch 1=Crop (proportional — grows the other axis / covers the target)
// move: 0/1 — center each layer's bounds in the target before scaling

function lineup_sizeMatch(mode, sizeMode, crop, move) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";

        var targetLayers = layers;
        var targetWidth, targetHeight, targetCenterX, targetCenterY;

        if (sizeMode === 0) {
            targetWidth   = comp.width;
            targetHeight  = comp.height;
            targetCenterX = comp.width  / 2;
            targetCenterY = comp.height / 2;
        } else if (sizeMode === 1) {
            var lf = Infinity, tp = Infinity, rt = -Infinity, bt = -Infinity;
            for (var i = 0; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                if (b.left   < lf) lf = b.left;
                if (b.top    < tp) tp = b.top;
                if (b.right  > rt) rt = b.right;
                if (b.bottom > bt) bt = b.bottom;
            }
            targetWidth   = rt - lf;
            targetHeight  = bt - tp;
            targetCenterX = (lf + rt) / 2;
            targetCenterY = (tp + bt) / 2;
        } else {
            if (layers.length < 2) return "ERROR: Select a key layer first, then the layers to resize";
            var kb = getLayerCompBounds(layers[0], comp);
            targetWidth   = kb.width;
            targetHeight  = kb.height;
            targetCenterX = kb.left + kb.width  / 2;
            targetCenterY = kb.top  + kb.height / 2;
            targetLayers  = layers.slice(1);
        }

        if (!(targetWidth > 0) || !(targetHeight > 0)) return "ERROR: Target has zero size";

        var t = comp.time;
        app.beginUndoGroup("Match Size");
        for (var i = 0; i < targetLayers.length; i++) {
            var layer = targetLayers[i];
            try {
                if (move) {
                    var cb  = getLayerCompBounds(layer, comp);
                    var ccx = cb.left + cb.width  / 2;
                    var ccy = cb.top  + cb.height / 2;
                    shiftPosition(layer.position, targetCenterX - ccx, targetCenterY - ccy, layer.threeDLayer);
                }

                var rect = layer.sourceRectAtTime(t, false);
                if (!(rect.width > 0) || !(rect.height > 0)) continue;

                var scaleProp = layer.scale;
                var sVal = scaleProp.value;
                var curW = rect.width  * (sVal[0] / 100);
                var curH = rect.height * (sVal[1] / 100);
                if (!(curW > 0) || !(curH > 0)) continue;

                var factorX = targetWidth  / curW;
                var factorY = targetHeight / curH;
                var newScaleX = sVal[0], newScaleY = sVal[1];

                if (mode === 0) {
                    newScaleX = sVal[0] * factorX;
                    if (crop) newScaleY = sVal[1] * factorX;
                } else if (mode === 1) {
                    newScaleY = sVal[1] * factorY;
                    if (crop) newScaleX = sVal[0] * factorY;
                } else {
                    if (crop) {
                        var factor = Math.max(factorX, factorY);
                        newScaleX = sVal[0] * factor;
                        newScaleY = sVal[1] * factor;
                    } else {
                        newScaleX = sVal[0] * factorX;
                        newScaleY = sVal[1] * factorY;
                    }
                }

                if (scaleProp.dimensionsSeparated) {
                    var xs = scaleProp.getSeparationFollower(0);
                    var ys = scaleProp.getSeparationFollower(1);
                    if (xs.numKeys > 0) xs.setValueAtTime(t, newScaleX); else xs.setValue(newScaleX);
                    if (ys.numKeys > 0) ys.setValueAtTime(t, newScaleY); else ys.setValue(newScaleY);
                } else {
                    var newVal = sVal.length > 2 ? [newScaleX, newScaleY, sVal[2]] : [newScaleX, newScaleY];
                    if (scaleProp.numKeys > 0) scaleProp.setValueAtTime(t, newVal); else scaleProp.setValue(newVal);
                }
            } catch (e) {}
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── ANCHOR POINT ─────────────────────────────────────────────────────────────
// loc: 0-8 (TL,TC,TR, ML,C,MR, BL,BC,BR)
// anchorMode: 0=object (layer source bounds)  1=selection (combined bounds)  2=comp

function lineup_anchorMove(loc, anchorMode, ignoreMasks) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem && comp.selectedLayers.length > 0)) return "ERROR: No layers selected";
        var labels=["Top Left","Top Center","Top Right","Middle Left","Center","Middle Right","Bottom Left","Bottom Center","Bottom Right"];
        app.beginUndoGroup("Set Anchor: " + labels[loc]);
        var layers = comp.selectedLayers;

        // Pre-compute combined selection bounding box for Selection mode
        var selMinX, selMinY, selMaxX, selMaxY;
        if (anchorMode === 1) {
            selMinX = Infinity; selMinY = Infinity; selMaxX = -Infinity; selMaxY = -Infinity;
            for (var i = 0; i < layers.length; i++) {
                var b = getLayerCompBounds(layers[i], comp);
                if (b.left   < selMinX) selMinX = b.left;
                if (b.top    < selMinY) selMinY = b.top;
                if (b.right  > selMaxX) selMaxX = b.right;
                if (b.bottom > selMaxY) selMaxY = b.bottom;
            }
        }

        for (var i=0; i<layers.length; i++) {
            var layer=layers[i], t=comp.time;
            if (anchorMode === 0) {
                // Object: snap within each layer's own source bounds
                var r=getSourceRect(layer, t, !!ignoreMasks);
                applyAnchorShift(layer, anchorLocToPoint(loc,r.width,r.height,r.left,r.top));
            } else if (anchorMode === 1) {
                // Selection: snap to position within combined bounding box of all selected layers
                pasteAnchor(layer, anchorLocToPoint(loc, selMaxX-selMinX, selMaxY-selMinY, selMinX, selMinY));
            } else {
                // Composition: snap to comp bounds
                pasteAnchor(layer, anchorLocToPoint(loc,comp.width,comp.height,0,0));
            }
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_anchorCopy() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        if (layers.length > 1) return "ERROR: Select exactly 1 layer to copy anchor";
        var layer = layers[0];
        var anchorLocal = layer.anchorPoint.value.slice(0);
        var copAnchor   = LST.toComp(layer, anchorLocal);
        _anchorClipboard = { anchor: copAnchor };
        return "[" + Math.round(copAnchor[0]) + ", " + Math.round(copAnchor[1]) + "]";
    } catch (err) {
        return "ERROR: " + err.toString();
    }
}

function lineup_anchorPaste() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        var anchor = _anchorClipboard ? _anchorClipboard.anchor : [comp.width/2, comp.height/2];
        app.beginUndoGroup("Paste Anchor");
        for (var i=0; i<layers.length; i++) pasteAnchor(layers[i], anchor);
        _anchorClipboard = null;
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_anchorClear() { _anchorClipboard = null; return "ok"; }

function lineup_createNull(anchorMode) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        app.beginUndoGroup("Create Null");
        var layers = comp.selectedLayers;

        var x, y;
        if (_anchorClipboard) {
            x = _anchorClipboard.anchor[0]; y = _anchorClipboard.anchor[1];
        } else if (anchorMode === 0 && layers.length > 0) {
            // Object: center of the (topmost-in-timeline) selected layer's own bounds.
            var b = getLayerCompBounds(layers[0], comp);
            x = (b.left + b.right) / 2; y = (b.top + b.bottom) / 2;
        } else if (anchorMode === 1 && layers.length > 0) {
            // Selection: center of the combined bounding box of all selected layers.
            var minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
            for (var i=0; i<layers.length; i++) {
                var bb = getLayerCompBounds(layers[i], comp);
                if (bb.left   < minX) minX = bb.left;
                if (bb.top    < minY) minY = bb.top;
                if (bb.right  > maxX) maxX = bb.right;
                if (bb.bottom > maxY) maxY = bb.bottom;
            }
            x = (minX + maxX) / 2; y = (minY + maxY) / 2;
        } else {
            x = comp.width/2; y = comp.height/2;
        }

        var nl = comp.layers.addNull();
        nl.name = "Null";
        nl.position.setValue([x, y]);
        var topIdx = 1;
        for (var i=0; i<layers.length; i++) { if (layers[i].index < topIdx || topIdx===1) topIdx = layers[i].index; }
        nl.moveToBeginning();
        if (topIdx > 1) nl.moveBefore(comp.layer(topIdx));
        for (var i=0; i<layers.length; i++) layers[i].parent = nl;
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── EASE COPY ─────────────────────────────────────────────────────────────────

// KeyframeEase arrays are per-dimension (Position on a 3D layer has 3, Opacity has
// 1, etc). Pasting ease copied from one property onto a differently-dimensioned
// property must resize to fit, or setTemporalEaseAtKey throws (silently swallowed
// by the caller's catch) and the target keeps whatever default ease it already had
// instead of the copied curve. Broadcasts a 1-dim source across all target dims,
// and otherwise pads/truncates by repeating the last value.
function adaptEaseDims(arr, dimN) {
    if (!arr || arr.length === 0 || !dimN || arr.length === dimN) return arr;
    var out = [];
    for (var d=0; d<dimN; d++) out.push(arr[d < arr.length ? d : arr.length-1]);
    return out;
}

// Applies a copied ease template entry to one target keyframe. Order matters:
// setTemporalEaseAtKey force-promotes both sides of the key to Bezier as a side
// effect (that's the AE API, not a bug here), so it has to run FIRST; the real
// interpolation type — which may be Hold or Linear on one or both sides — is
// (re)applied AFTER, which is what actually restores Hold/Linear. Doing it in the
// old order (type, then ease) let the ease call silently re-promote a just-set
// Hold side back to Bezier, and skipping the ease call for any non-Bezier side (as
// a previous fix did) lost the real ease on the side that *was* Bezier too.
function applyPastedEase(prop, keyIdx, src) {
    if (src.inEase && src.outEase) {
        var dimN = 0;
        try { dimN = prop.keyInTemporalEase(keyIdx).length; } catch (e) {}
        var inE = adaptEaseDims(src.inEase, dimN), outE = adaptEaseDims(src.outEase, dimN);
        try { prop.setTemporalEaseAtKey(keyIdx, inE, outE); } catch (e) {}
    }
    prop.setInterpolationTypeAtKey(keyIdx, src.inType, src.outType);
}

function pluralize(count, singular, plural) { return count + " " + (count===1 ? singular : (plural || singular + "s")); }

function formatPasteSummary(easings, properties, layers) {
    if (easings === 0) return "No matching keyframe selection to paste onto";
    return pluralize(easings, "easing") + " pasted on " + pluralize(properties, "property", "properties")
        + " on " + pluralize(layers, "layer");
}

function lineup_easeCopy() {
    try {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;

        function copyEaseArr(arr) {
            var out=[];
            for (var e=0; e<arr.length; e++) out.push(new KeyframeEase(arr[e].speed, arr[e].influence));
            return out;
        }
        function collectEase(pg, out) {
            for (var i=1; i<=pg.numProperties; i++) {
                var p; try { p=pg.property(i); } catch(e){ continue; }
                if (p.propertyType===PropertyType.PROPERTY) {
                    if (p.numKeys>0 && p.selectedKeys.length>0) {
                        var sel=p.selectedKeys;
                        for (var k=0; k<sel.length; k++) {
                            var ki=sel[k], inT, outT, inE=null, outE=null;
                            try { inT=p.keyInInterpolationType(ki); outT=p.keyOutInterpolationType(ki); } catch(e){ continue; }
                            try { inE=copyEaseArr(p.keyInTemporalEase(ki)); } catch(e) {}
                            try { outE=copyEaseArr(p.keyOutTemporalEase(ki)); } catch(e) {}
                            var val=null; try { val=p.keyValue(ki); } catch(e) {}
                            out.push({inType:inT, outType:outT, inEase:inE, outEase:outE, value:val});
                        }
                    }
                } else if (p.propertyType===PropertyType.NAMED_GROUP || p.propertyType===PropertyType.INDEXED_GROUP) {
                    collectEase(p, out);
                }
            }
        }

        var template = null;
        for (var l=0; l<layers.length; l++) {
            var res=[]; collectEase(layers[l], res);
            if (res.length > 0) { template=res; break; }
        }
        if (!template) return "";

        _easeClipboard     = template;
        _easeClipboardType = template[0].outType;
        var sym = (_easeClipboardType===KeyframeInterpolationType.HOLD)   ? "■"
                : (_easeClipboardType===KeyframeInterpolationType.LINEAR) ? "◆" : "⧗";
        return template.length + " " + sym;
    } catch (err) {
        return "ERROR: " + err.toString();
    }
}

function lineup_easePaste() {
    try {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return "ERROR: No active composition";
        if (!_easeClipboard) return "ERROR: No easing copied";
        var n=_easeClipboard.length, layers=comp.selectedLayers;

        // Grouped per-property (not flattened across the whole layer) so that
        // pasting onto several properties at once — e.g. Position + Scale, each
        // with the same number of selected keys as the clipboard — applies the
        // template to each property independently instead of requiring the
        // layer's total selected-key count to match n.
        function collectRefGroups(pg, out) {
            for (var i=1; i<=pg.numProperties; i++) {
                var p; try { p=pg.property(i); } catch(e){ continue; }
                if (p.propertyType===PropertyType.PROPERTY) {
                    if (p.numKeys>0 && p.selectedKeys.length>0) {
                        var sel=p.selectedKeys, grp=[];
                        for (var k=0; k<sel.length; k++) grp.push({prop:p, keyIdx:sel[k]});
                        out.push(grp);
                    }
                } else if (p.propertyType===PropertyType.NAMED_GROUP || p.propertyType===PropertyType.INDEXED_GROUP) {
                    collectRefGroups(p, out);
                }
            }
        }

        var easingsPasted=0, propertiesPasted=0, layersPasted=0;
        app.beginUndoGroup("Paste Easing");
        for (var l=0; l<layers.length; l++) {
            var groups=[]; collectRefGroups(layers[l], groups);
            var layerHit=false;
            for (var g=0; g<groups.length; g++) {
                var targets=groups[g];
                if (targets.length !== n) continue;
                for (var t=0; t<targets.length; t++) {
                    var ref=targets[t], src=_easeClipboard[t];
                    try { applyPastedEase(ref.prop, ref.keyIdx, src); easingsPasted++; } catch(e) {}
                }
                propertiesPasted++;
                layerHit=true;
            }
            if (layerHit) layersPasted++;
        }
        app.endUndoGroup();
        return formatPasteSummary(easingsPasted, propertiesPasted, layersPasted);
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_easeValuePaste() {
    try {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return "ERROR: No active composition";
        if (!_easeClipboard) return "ERROR: No easing copied";
        var n=_easeClipboard.length, layers=comp.selectedLayers;

        function collectRefGroups(pg, out) {
            for (var i=1; i<=pg.numProperties; i++) {
                var p; try { p=pg.property(i); } catch(e){ continue; }
                if (p.propertyType===PropertyType.PROPERTY) {
                    if (p.numKeys>0 && p.selectedKeys.length>0) {
                        var sel=p.selectedKeys, grp=[];
                        for (var k=0; k<sel.length; k++) grp.push({prop:p, keyIdx:sel[k]});
                        out.push(grp);
                    }
                } else if (p.propertyType===PropertyType.NAMED_GROUP || p.propertyType===PropertyType.INDEXED_GROUP) {
                    collectRefGroups(p, out);
                }
            }
        }

        var easingsPasted=0, propertiesPasted=0, layersPasted=0;
        app.beginUndoGroup("Paste Ease + Value");
        for (var l=0; l<layers.length; l++) {
            var groups=[]; collectRefGroups(layers[l], groups);
            var layerHit=false;
            for (var g=0; g<groups.length; g++) {
                var targets=groups[g];
                if (targets.length !== n) continue;
                for (var t=0; t<targets.length; t++) {
                    var ref=targets[t], src=_easeClipboard[t];
                    try {
                        if (src.value !== null && src.value !== undefined) ref.prop.setValueAtKey(ref.keyIdx, src.value);
                        applyPastedEase(ref.prop, ref.keyIdx, src);
                        easingsPasted++;
                    } catch(e) {}
                }
                propertiesPasted++;
                layerHit=true;
            }
            if (layerHit) layersPasted++;
        }
        app.endUndoGroup();
        return formatPasteSummary(easingsPasted, propertiesPasted, layersPasted);
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_easeClear() { _easeClipboard=null; _easeClipboardType=null; return "ok"; }

// ── SHAPE RIGS ────────────────────────────────────────────────────────────────

function lineup_rig() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 1) return "ERROR: Select at least 1 layer to rig.";

        var n=layers.length, cw=comp.width, ch=comp.height;
        var ld=[];
        for (var i=0; i<n; i++) ld.push({layer:layers[i], cx:layers[i].position.value[0]});
        ld.sort(function(a,b){ return a.cx-b.cx; });

        var rigName="Path Rig", sfx=2, taken=true;
        while (taken) {
            taken=false;
            for (var li=1; li<=comp.numLayers; li++) {
                if (comp.layer(li).name===rigName) { rigName="Path Rig "+sfx++; taken=true; break; }
            }
        }

        app.beginUndoGroup("Path Rig");

        var rawLayers=[]; for (var i=0; i<n; i++) rawLayers.push(ld[i].layer);
        derigLayers(comp, rawLayers);

        var sl=comp.layers.addShape(); sl.name=rigName; sl.label=5;
        sl.position.setValue([cw/2, ch/2]);

        var topC=sl.property("ADBE Root Vectors Group");
        var grp=topC.addProperty("ADBE Vector Group"); grp.name="Shape 1";
        var grpC=grp.property("ADBE Vectors Group");
        if (!grpC) { app.endUndoGroup(); return "ERROR: Could not access shape group contents."; }

        var pathItem=grpC.addProperty("ADBE Vector Shape - Group"); pathItem.name="Path 1";
        var s=new Shape();
        s.vertices=[[-cw*0.4,0],[cw*0.4,0]]; s.inTangents=[[0,0],[0,0]]; s.outTangents=[[0,0],[0,0]]; s.closed=false;
        pathItem.property("ADBE Vector Shape").setValue(s);

        var stk=grpC.addProperty("ADBE Vector Graphic - Stroke");
        stk.property("ADBE Vector Stroke Color").setValue([0.9,0.75,0.1,1]);
        stk.property("ADBE Vector Stroke Width").setValue(2);
        try { var dg=stk.property("ADBE Vector Stroke Dashes"); dg.addProperty("ADBE Vector Stroke Dash 1").setValue(8); dg.addProperty("ADBE Vector Stroke Gap 1").setValue(8); } catch(e) {}

        sl.guideLayer=true;
        var cyFx=sl.property("ADBE Effect Parade").addProperty("ADBE Angle Control");
        if (cyFx) cyFx.name="Cycle Angle";

        for (var i=0; i<n; i++) {
            var layer=ld[i].layer, progress=(i/n)*100;
            var fxGrp=layer.property("ADBE Effect Parade");
            if (!fxGrp) { app.endUndoGroup(); return "ERROR: No Effects group on layer."; }
            var fx=fxGrp.addProperty("ADBE Slider Control");
            if (!fx) { app.endUndoGroup(); return "ERROR: Could not add Slider Control."; }
            fx.name="Progress"; fx.property(1).setValue(progress);

            var exprBase='var rl=thisComp.layer("'+rigName+'");'+
                'var cyc=rl.effect("Cycle Angle")("Angle")/360;'+
                'var t=((effect("Progress")("Slider")/100+cyc)%1+1)%1;'+
                'var pth=rl("ADBE Root Vectors Group")(1)("ADBE Vectors Group")(1)("ADBE Vector Shape");'+
                'rl.toComp(pth.pointOnPath(t))';

            var pos=layer.position;
            if (!pos) { app.endUndoGroup(); return "ERROR: Position property is null."; }
            if (pos.dimensionsSeparated) collapsePosition(layer);
            pos.expression=exprBase+';'; pos.expressionEnabled=true;
        }
        sl.moveToBeginning();
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_derig() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: Select a Path Rig layer or rigged layers.";

        app.beginUndoGroup("Remove Path Rig");
        var toDerig=[];
        for (var i=0; i<layers.length; i++) {
            var layer=layers[i];
            if (layer.name.indexOf("Path Rig")===0) {
                var rn=layer.name;
                for (var li=1; li<=comp.numLayers; li++) {
                    var l=comp.layer(li);
                    try {
                        var pos=l.position;
                        var expr=pos.dimensionsSeparated ? pos.getSeparationFollower(0).expression : pos.expression;
                        if (expr && expr.indexOf('"'+rn+'"')!==-1) toDerig.push(l);
                    } catch(e) {}
                }
            } else { toDerig.push(layer); }
        }
        derigLayers(comp, toDerig);
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_recalcRig() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) return "ERROR: Select a Path Rig layer and optionally new layers.";

        var pathLayer=null;
        for (var i=0; i<sel.length; i++) if (sel[i].name.indexOf("Path Rig")===0) { pathLayer=sel[i]; break; }
        if (!pathLayer) for (var i=0; i<sel.length; i++) if (sel[i] instanceof ShapeLayer && sel[i].guideLayer) { pathLayer=sel[i]; break; }
        if (!pathLayer) return "ERROR: No Path Rig layer found.";
        var rigName=pathLayer.name;

        var existing=[];
        for (var li=1; li<=comp.numLayers; li++) {
            var l=comp.layer(li); if (l===pathLayer) continue;
            try {
                var expr="", pos=l.position;
                if (pos.expressionEnabled) { expr=pos.expression; }
                else if (pos.dimensionsSeparated) { var xf=pos.getSeparationFollower(0); if (xf.expressionEnabled) expr=xf.expression; }
                if (expr.indexOf('"'+rigName+'"')!==-1) existing.push(l);
            } catch(e) {}
        }

        var newLayers=[];
        for (var i=0; i<sel.length; i++) {
            if (sel[i]===pathLayer) continue;
            var already=false;
            for (var j=0; j<existing.length; j++) { if (existing[j]===sel[i]) { already=true; break; } }
            if (!already) newLayers.push(sel[i]);
        }

        var allLayers=existing.concat(newLayers), n=allLayers.length;
        if (n===0) return "ERROR: No rigged layers found for \""+rigName+"\".";

        app.beginUndoGroup("Recalculate Rig");

        var exprBase='var rl=thisComp.layer("'+rigName+'");'+
            'var cyc=rl.effect("Cycle Angle")("Angle")/360;'+
            'var t=((effect("Progress")("Slider")/100+cyc)%1+1)%1;'+
            'var pth=rl("ADBE Root Vectors Group")(1)("ADBE Vectors Group")(1)("ADBE Vector Shape");'+
            'rl.toComp(pth.pointOnPath(t))';

        for (var i=0; i<newLayers.length; i++) {
            var layer=newLayers[i];
            var fx=layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
            fx.name="Progress";
            var pos=layer.position;
            if (pos.dimensionsSeparated) collapsePosition(layer);
            pos=layer.position; pos.expression=exprBase+';'; pos.expressionEnabled=true;
        }
        for (var i=0; i<n; i++) {
            try { allLayers[i].property("ADBE Effect Parade").property("Progress").property(1).setValue((i/n)*100); } catch(e) {}
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── AUTO CROP ─────────────────────────────────────────────────────────────────

function saveMaskShapes(layer) {
    var saved = [];
    var mp;
    try { mp = layer.property("ADBE Mask Parade"); } catch(e) { return saved; }
    if (!mp || mp.numProperties === 0) return saved;
    for (var mi = 1; mi <= mp.numProperties; mi++) {
        try {
            var sp = mp.property(mi).property("ADBE Mask Shape");
            var entry = { prop: sp, keys: [] };
            if (sp.numKeys > 0) {
                for (var k = 1; k <= sp.numKeys; k++)
                    entry.keys.push({ index: k, shape: sp.keyValue(k) });
            } else {
                entry.keys.push({ index: 0, shape: sp.value });
            }
            saved.push(entry);
        } catch(e) {}
    }
    return saved;
}

function restoreMaskShapes(saved, dx, dy) {
    for (var mi = 0; mi < saved.length; mi++) {
        var entry = saved[mi];
        for (var ki = 0; ki < entry.keys.length; ki++) {
            try {
                var sh = entry.keys[ki].shape;
                var nv = [];
                for (var v = 0; v < sh.vertices.length; v++)
                    nv.push([sh.vertices[v][0] + dx, sh.vertices[v][1] + dy]);
                sh.vertices = nv;
                if (entry.keys[ki].index === 0) {
                    entry.prop.setValue(sh);
                } else {
                    entry.prop.setValueAtKey(entry.keys[ki].index, sh);
                }
            } catch(e) {}
        }
    }
}

function applyCropBounds(precompLayer, minX, minY, maxX, maxY, padding, expandBeyond, compensateMasks) {
    var innerComp = precompLayer.source;
    var padMinX = minX - padding, padMinY = minY - padding;
    var padMaxX = maxX + padding, padMaxY = maxY + padding;
    if (!expandBeyond) {
        padMinX = Math.max(0, padMinX); padMinY = Math.max(0, padMinY);
        padMaxX = Math.min(innerComp.width, padMaxX); padMaxY = Math.min(innerComp.height, padMaxY);
    }
    var cropL = Math.floor(padMinX), cropT = Math.floor(padMinY);
    var cropW = Math.ceil(padMaxX) - cropL, cropH = Math.ceil(padMaxY) - cropT;
    if (cropW < 1) cropW = 1;
    if (cropH < 1) cropH = 1;
    if (cropL === 0 && cropT === 0 && cropW === innerComp.width && cropH === innerComp.height) return;

    var anchorBefore = precompLayer.anchorPoint.value.slice(0);
    var savedMasks = compensateMasks ? saveMaskShapes(precompLayer) : [];

    for (var i = 1; i <= innerComp.numLayers; i++) {
        var layer = innerComp.layer(i);
        if (layer.parent !== null) continue;
        try { shiftPosition(layer.position, -cropL, -cropT, layer.threeDLayer); } catch(e) {}
    }

    innerComp.width = cropW;
    innerComp.height = cropH;

    // AE auto-rescales outer-layer masks on resize — restore from pre-resize snapshot.
    if (compensateMasks) restoreMaskShapes(savedMasks, -cropL, -cropT);

    try {
        var anchorProp = precompLayer.anchorPoint;
        if (anchorProp.numKeys > 0) {
            for (var k = 1; k <= anchorProp.numKeys; k++) {
                var av = anchorProp.keyValue(k);
                var na = [av[0] - cropL, av[1] - cropT];
                if (av.length > 2) na.push(av[2]);
                anchorProp.setValueAtKey(k, na);
            }
        } else {
            anchorProp.setValue([anchorBefore[0] - cropL, anchorBefore[1] - cropT]);
        }
    } catch(e) {}
}

function lineup_autoCrop(padding, expandBeyond) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i].source && layers[i].source instanceof CompItem))
                return "ERROR: \"" + layers[i].name + "\" is not a precomp";
        }
        var processed = [];
        app.beginUndoGroup("Auto Crop");
        for (var i = 0; i < layers.length; i++) {
            var src = layers[i].source, done = false;
            for (var j = 0; j < processed.length; j++) { if (processed[j] === src) { done = true; break; } }
            if (done) continue;
            var innerComp = src, t = innerComp.time;
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
            for (var li = 1; li <= innerComp.numLayers; li++) {
                var layer = innerComp.layer(li);
                try { if (layer instanceof CameraLayer || layer instanceof LightLayer) continue; } catch(e) {}
                try { if (layer.nullLayer || layer.adjustmentLayer || layer.guideLayer) continue; } catch(e) {}
                if (!layer.enabled || t < layer.inPoint || t >= layer.outPoint) continue;
                try {
                    var rect = getLayerCompBounds(layer, innerComp);
                    if (!rect) continue;
                    if (rect.left < minX) minX = rect.left; if (rect.top < minY) minY = rect.top;
                    if (rect.right > maxX) maxX = rect.right; if (rect.bottom > maxY) maxY = rect.bottom;
                    found = true;
                } catch(e) {}
            }
            if (!found) { app.endUndoGroup(); return "ERROR: No visible content in \"" + innerComp.name + "\" at current time"; }
            applyCropBounds(layers[i], minX, minY, maxX, maxY, padding || 0, expandBeyond || false, true);
            processed.push(src);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_maskCrop(padding, expandBeyond) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i].source && layers[i].source instanceof CompItem))
                return "ERROR: \"" + layers[i].name + "\" is not a precomp";
        }
        var processed = [];
        app.beginUndoGroup("Mask Crop");
        for (var i = 0; i < layers.length; i++) {
            var src = layers[i].source, done = false;
            for (var j = 0; j < processed.length; j++) { if (processed[j] === src) { done = true; break; } }
            if (done) continue;
            var maskProp;
            try { maskProp = layers[i].property("ADBE Mask Parade"); } catch(e) {}
            if (!maskProp || maskProp.numProperties === 0) { app.endUndoGroup(); return "ERROR: No masks on \"" + layers[i].name + "\""; }
            var targetMask = null;
            for (var mi = 1; mi <= maskProp.numProperties; mi++) {
                try { var m = maskProp.property(mi); if (m.enabled && m.maskMode === MaskMode.ADD) { targetMask = m; break; } } catch(e) {}
            }
            if (!targetMask) { app.endUndoGroup(); return "ERROR: No enabled Add mask on \"" + layers[i].name + "\""; }
            var shape = targetMask.property("ADBE Mask Shape").valueAtTime(comp.time, false);
            var verts = shape.vertices, inT = shape.inTangents, outT = shape.outTangents;
            if (!verts || verts.length === 0) { app.endUndoGroup(); return "ERROR: Mask on \"" + layers[i].name + "\" has no vertices"; }
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (var v = 0; v < verts.length; v++) {
                var vx = verts[v][0], vy = verts[v][1];
                if (vx < minX) minX = vx; if (vy < minY) minY = vy;
                if (vx > maxX) maxX = vx; if (vy > maxY) maxY = vy;
                if (outT && outT[v]) { var ox=vx+outT[v][0],oy=vy+outT[v][1]; if(ox<minX)minX=ox;if(oy<minY)minY=oy;if(ox>maxX)maxX=ox;if(oy>maxY)maxY=oy; }
                if (inT  && inT[v])  { var ix=vx+inT[v][0], iy=vy+inT[v][1]; if(ix<minX)minX=ix;if(iy<minY)minY=iy;if(ix>maxX)maxX=ix;if(iy>maxY)maxY=iy; }
            }
            applyCropBounds(layers[i], minX, minY, maxX, maxY, padding || 0, expandBeyond || false, true);
            try { targetMask.remove(); } catch(e) {}
            processed.push(src);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

function lineup_cropMaxArea(padding, expandBeyond) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: No layers selected";
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i].source && layers[i].source instanceof CompItem))
                return "ERROR: \"" + layers[i].name + "\" is not a precomp";
        }
        var processed = [];
        app.beginUndoGroup("Crop Max Area");
        for (var i = 0; i < layers.length; i++) {
            var src = layers[i].source, done = false;
            for (var j = 0; j < processed.length; j++) { if (processed[j] === src) { done = true; break; } }
            if (done) continue;

            var innerComp = src, origTime = innerComp.time;
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;

            for (var li = 1; li <= innerComp.numLayers; li++) {
                var layer = innerComp.layer(li);
                try { if (layer instanceof CameraLayer || layer instanceof LightLayer) continue; } catch(e) {}
                try { if (layer.nullLayer || layer.adjustmentLayer || layer.guideLayer) continue; } catch(e) {}
                if (!layer.enabled) continue;

                var tProps = [];
                try {
                    var pos = layer.position;
                    if (pos.dimensionsSeparated) {
                        var dims = layer.threeDLayer ? 3 : 2;
                        for (var d = 0; d < dims; d++) tProps.push(pos.getSeparationFollower(d));
                    } else { tProps.push(pos); }
                } catch(e) {}
                try { tProps.push(layer.anchorPoint); } catch(e) {}
                try { tProps.push(layer.scale);       } catch(e) {}
                try { tProps.push(layer.rotation);    } catch(e) {}
                if (layer.threeDLayer) {
                    try { tProps.push(layer.orientation); } catch(e) {}
                    try { tProps.push(layer.xRotation);   } catch(e) {}
                    try { tProps.push(layer.yRotation);   } catch(e) {}
                }

                for (var pi = 0; pi < tProps.length; pi++) {
                    try {
                        if (tProps[pi].expressionEnabled) {
                            innerComp.time = origTime;
                            app.endUndoGroup();
                            return "ERROR: \"" + layer.name + "\" has an expression on a transform — max area crop cannot be calculated";
                        }
                    } catch(e) {}
                }

                var seenTimes = {}, timesArr = [];
                var tKey, tVal;
                tVal = layer.inPoint;
                if (tVal >= layer.inPoint && tVal < layer.outPoint) {
                    tKey = Math.round(tVal * 10000) + "";
                    if (!seenTimes[tKey]) { seenTimes[tKey] = true; timesArr.push(tVal); }
                }
                for (var pi = 0; pi < tProps.length; pi++) {
                    try {
                        var tp = tProps[pi];
                        for (var k = 1; k <= tp.numKeys; k++) {
                            tVal = tp.keyTime(k);
                            if (tVal >= layer.inPoint && tVal < layer.outPoint) {
                                tKey = Math.round(tVal * 10000) + "";
                                if (!seenTimes[tKey]) { seenTimes[tKey] = true; timesArr.push(tVal); }
                            }
                        }
                    } catch(e) {}
                }

                timesArr.sort(function(a, b) { return a - b; });
                var withMids = timesArr.slice();
                for (var ti = 0; ti < timesArr.length - 1; ti++)
                    withMids.push((timesArr[ti] + timesArr[ti + 1]) / 2);
                withMids.sort(function(a, b) { return a - b; });

                for (var ti = 0; ti < withMids.length; ti++) {
                    var st = withMids[ti];
                    if (st < layer.inPoint || st >= layer.outPoint) continue;
                    try {
                        innerComp.time = st;
                        var rect = getLayerCompBounds(layer, innerComp);
                        if (!rect) continue;
                        if (rect.left < minX) minX = rect.left; if (rect.top < minY) minY = rect.top;
                        if (rect.right > maxX) maxX = rect.right; if (rect.bottom > maxY) maxY = rect.bottom;
                        found = true;
                    } catch(e) {}
                }
            }

            innerComp.time = origTime;
            if (!found) { app.endUndoGroup(); return "ERROR: No visible content in \"" + innerComp.name + "\""; }
            applyCropBounds(layers[i], minX, minY, maxX, maxY, padding || 0, expandBeyond || false, true);
            processed.push(src);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── DECOMPOSE ─────────────────────────────────────────────────────────────────

function lineup_decompose() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "ERROR: Select one or more precomp layers to decompose";
        for (var i = 0; i < layers.length; i++) {
            if (!(layers[i].source && layers[i].source instanceof CompItem))
                return "ERROR: \"" + layers[i].name + "\" is not a precomp — select only precomp layers";
        }

        function copyTransformProp(src, dst) {
            try {
                if (src.expressionEnabled && src.expression !== "") {
                    try { dst.expression = src.expression; } catch(e) {}
                    return;
                }
                if (src.numKeys === 0) { dst.setValue(src.value); return; }
                for (var k = 1; k <= src.numKeys; k++) {
                    var t = src.keyTime(k), v = src.keyValue(k);
                    var ki = src.keyInInterpolationType(k), ko = src.keyOutInterpolationType(k);
                    var idx = dst.addKey(t);
                    dst.setValueAtKey(idx, v);
                    dst.setInterpolationTypeAtKey(idx, ki, ko);
                    try { dst.setTemporalEaseAtKey(idx, src.keyInTemporalEase(k), src.keyOutTemporalEase(k)); } catch(e) {}
                    try { if (src.isSpatial) dst.setSpatialTangentsAtKey(idx, src.keyInSpatialTangent(k), src.keyOutSpatialTangent(k)); } catch(e) {}
                }
            } catch(e) {}
        }

        function decomposePrecomp(precompLayer, outerComp) {
            var innerComp = precompLayer.source;
            var innerW = innerComp.width, innerH = innerComp.height;
            var is3D = precompLayer.threeDLayer;
            var innerLayerCount = innerComp.numLayers;

            var infos = [];
            for (var j = 1; j <= innerLayerCount; j++) {
                var il = innerComp.layer(j);
                infos.push({ innerIdx: j, parentIdx: il.parent ? il.parent.index : 0 });
            }

            var layerMap = {};
            for (var j = innerLayerCount; j >= 1; j--) {
                innerComp.layer(j).copyToComp(outerComp);
                layerMap[j] = outerComp.layer(1);
            }

            var shapeLayer = outerComp.layers.addShape();
            shapeLayer.name = precompLayer.name;
            shapeLayer.label = precompLayer.label;
            shapeLayer.threeDLayer = is3D;
            shapeLayer.inPoint = precompLayer.inPoint;
            shapeLayer.outPoint = precompLayer.outPoint;
            shapeLayer.startTime = precompLayer.startTime;
            shapeLayer.blendingMode = precompLayer.blendingMode;

            var rootVecs = shapeLayer.property("ADBE Root Vectors Group");
            var grp = rootVecs.addProperty("ADBE Vector Group");
            grp.name = "Bounds";
            var gc = grp.property("ADBE Vectors Group");
            var rect = gc.addProperty("ADBE Vector Shape - Rect");
            rect.property("ADBE Vector Rect Size").setValue([innerW, innerH]);
            rect.property("ADBE Vector Rect Position").setValue([innerW / 2, innerH / 2]);
            var rectFill = gc.addProperty("ADBE Vector Graphic - Fill");
            rectFill.property("ADBE Vector Fill Opacity").setValue(0);

            var pt = precompLayer.transform, st = shapeLayer.transform;
            st.anchorPoint.setValue(pt.anchorPoint.value);
            st.position.setValue(pt.position.value);
            st.scale.setValue(pt.scale.value);
            st.rotation.setValue(pt.rotation.value);
            st.opacity.setValue(pt.opacity.value);
            if (is3D) {
                try { st.xRotation.setValue(pt.xRotation.value); } catch(e) {}
                try { st.yRotation.setValue(pt.yRotation.value); } catch(e) {}
                try { st.zRotation.setValue(pt.zRotation.value); } catch(e) {}
                try { st.orientation.setValue(pt.orientation.value); } catch(e) {}
            }

            shapeLayer.guideLayer = true;

            function snapProp(p) {
                if (p.expressionEnabled && p.expression) return { expr: p.expression };
                if (p.numKeys > 0) {
                    var ks = [];
                    for (var k = 1; k <= p.numKeys; k++)
                        ks.push({ t: p.keyTime(k), v: p.keyValue(k),
                                  ki: p.keyInInterpolationType(k), ko: p.keyOutInterpolationType(k) });
                    return { keys: ks };
                }
                var v = p.value;
                return { value: (v && v.slice) ? v.slice(0) : v };
            }
            function restoreSnap(p, d) {
                try {
                    if (d.expr !== undefined) { p.expression = d.expr; p.expressionEnabled = true; return; }
                    while (p.numKeys > 0) p.removeKey(1);
                    if (d.keys) {
                        for (var k = 0; k < d.keys.length; k++) {
                            var kd = d.keys[k], idx = p.addKey(kd.t);
                            p.setValueAtKey(idx, kd.v);
                            p.setInterpolationTypeAtKey(idx, kd.ki, kd.ko);
                        }
                    } else { p.setValue(d.value); }
                } catch(e) {}
            }

            var posSnaps = [];
            for (var j = 0; j < infos.length; j++) {
                var sl2 = layerMap[infos[j].innerIdx], sp = sl2.position;
                var sn = { sep: sp.dimensionsSeparated };
                if (sn.sep) {
                    sn.x = snapProp(sp.getSeparationFollower(0));
                    sn.y = snapProp(sp.getSeparationFollower(1));
                    try { if (sl2.threeDLayer) sn.z = snapProp(sp.getSeparationFollower(2)); } catch(e) {}
                } else {
                    sn.data = snapProp(sp);
                }
                posSnaps.push(sn);
            }

            for (var j = 0; j < infos.length; j++) {
                if (infos[j].parentIdx !== 0 && layerMap[infos[j].parentIdx])
                    layerMap[infos[j].innerIdx].parent = layerMap[infos[j].parentIdx];
            }
            for (var j = 0; j < infos.length; j++) {
                if (infos[j].parentIdx === 0)
                    layerMap[infos[j].innerIdx].parent = shapeLayer;
            }

            for (var j = 0; j < posSnaps.length; j++) {
                var rl2 = layerMap[infos[j].innerIdx], rp = rl2.position, rs = posSnaps[j];
                if (rs.sep && rp.dimensionsSeparated) {
                    restoreSnap(rp.getSeparationFollower(0), rs.x);
                    restoreSnap(rp.getSeparationFollower(1), rs.y);
                    try { if (rs.z) restoreSnap(rp.getSeparationFollower(2), rs.z); } catch(e) {}
                } else if (!rs.sep && !rp.dimensionsSeparated) {
                    restoreSnap(rp, rs.data);
                }
            }

            copyTransformProp(pt.anchorPoint, st.anchorPoint);
            copyTransformProp(pt.position,    st.position);
            copyTransformProp(pt.scale,       st.scale);
            copyTransformProp(pt.rotation,    st.rotation);
            copyTransformProp(pt.opacity,     st.opacity);
            if (is3D) {
                try { copyTransformProp(pt.xRotation,   st.xRotation);   } catch(e) {}
                try { copyTransformProp(pt.yRotation,   st.yRotation);   } catch(e) {}
                try { copyTransformProp(pt.zRotation,   st.zRotation);   } catch(e) {}
                try { copyTransformProp(pt.orientation, st.orientation); } catch(e) {}
            }

            try {
                var srcFx = precompLayer.property("ADBE Effect Parade");
                if (srcFx && srcFx.numProperties > 0) {
                    var dstFx = shapeLayer.property("ADBE Effect Parade");
                    for (var ei = 1; ei <= srcFx.numProperties; ei++) {
                        try {
                            var fx = srcFx.property(ei);
                            if (fx.matchName !== "ADBE Geometry2") continue;
                            var newFx = dstFx.addProperty("ADBE Geometry2");
                            if (!newFx) continue;
                            newFx.name = fx.name;
                            for (var pi = 1; pi <= fx.numProperties; pi++) {
                                try { copyTransformProp(fx.property(pi), newFx.property(pi)); } catch(e) {}
                            }
                        } catch(e) {}
                    }
                }
            } catch(e) {}

            precompLayer.remove();
        }

        // Process highest index first so lower indices remain stable
        var sorted = [];
        for (var i = 0; i < layers.length; i++) sorted.push(layers[i]);
        sorted.sort(function(a, b) { return b.index - a.index; });

        app.beginUndoGroup("Decompose Precomp");
        for (var i = 0; i < sorted.length; i++) {
            decomposePrecomp(sorted[i], comp);
        }
        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── DUPLICATE COMP (DEEP) ─────────────────────────────────────────────────────
// Recursively duplicates a comp and every nested precomp used inside it, so the
// copy is fully independent of the original — editing one never touches the
// other. Names are versioned (Comp -> Comp_2 -> Comp_3 ...) and each duplicate
// is placed in the same Project panel folder as its original. A comp used more
// than once inside the same tree is only duplicated once and shared by every
// reference to it, mirroring the original structure.
//
// If precomp layers are selected in the active comp's timeline, each one gets
// its own independent deep duplicate and that layer's source is swapped to it
// in place. Otherwise it deep-duplicates whichever comp(s) are selected in the
// Project panel.

function lineup_duplicateCompDeep() {
    try {
        var proj = app.project;

        function nameExists(name) {
            for (var i = 1; i <= proj.numItems; i++) {
                try { if (proj.item(i).name === name) return true; } catch(e) {}
            }
            return false;
        }

        function versionedName(baseName) {
            var m = baseName.match(/^(.*)_(\d+)$/);
            var base = m ? m[1] : baseName;
            var n = m ? parseInt(m[2], 10) + 1 : 2;
            var candidate;
            do { candidate = base + "_" + n; n++; } while (nameExists(candidate));
            return candidate;
        }

        function deepDup(comp, cloneMap) {
            if (cloneMap[comp.id]) return cloneMap[comp.id];
            var dup = comp.duplicate();
            dup.name = versionedName(comp.name);
            try { dup.parentFolder = comp.parentFolder; } catch(e) {}
            cloneMap[comp.id] = dup;
            for (var li = 1; li <= dup.numLayers; li++) {
                var layer = dup.layer(li);
                if (!(layer instanceof AVLayer)) continue;
                var src = layer.source;
                if (src && src instanceof CompItem) {
                    var newSrc = deepDup(src, cloneMap);
                    if (newSrc !== src) layer.replaceSource(newSrc, false);
                }
            }
            return dup;
        }

        var activeComp = proj.activeItem;
        var precompLayers = [];
        if (activeComp && activeComp instanceof CompItem) {
            var sel = activeComp.selectedLayers;
            for (var i = 0; i < sel.length; i++) {
                if (sel[i] instanceof AVLayer && sel[i].source && sel[i].source instanceof CompItem)
                    precompLayers.push(sel[i]);
            }
        }

        var messages = [];

        if (precompLayers.length > 0) {
            app.beginUndoGroup("Duplicate Comp (Deep)");
            for (var i = 0; i < precompLayers.length; i++) {
                var cloneMap = {};
                var origName = precompLayers[i].source.name;
                var newTop = deepDup(precompLayers[i].source, cloneMap);
                precompLayers[i].replaceSource(newTop, false);
                messages.push('"' + origName + '" -> "' + newTop.name + '"');
            }
            app.endUndoGroup();
        } else {
            var roots = [];
            for (var i = 0; i < proj.selection.length; i++) {
                if (proj.selection[i] instanceof CompItem) roots.push(proj.selection[i]);
            }
            if (roots.length === 0)
                return "ERROR: Select a precomp layer in the timeline, or select one or more comps in the Project panel.";

            app.beginUndoGroup("Duplicate Comp (Deep)");
            for (var i = 0; i < roots.length; i++) {
                var cloneMap = {};
                var newTop = deepDup(roots[i], cloneMap);
                messages.push('"' + roots[i].name + '" -> "' + newTop.name + '"');
            }
            app.endUndoGroup();
        }

        return "Duplicated " + messages.join(", ");
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── ORGANIZE PROJECT ──────────────────────────────────────────────────────────

function lineup_organizeProject() {
    try {
        var proj = app.project;

        function propSig(prop) {
            function vStr(v) {
                if (typeof v === 'number') return "" + Math.round(v * 1000);
                var s = "";
                for (var i = 0; i < v.length; i++) { if (i) s += ","; s += Math.round(v[i] * 1000); }
                return s;
            }
            try {
                if (prop.dimensionsSeparated) {
                    var sig = "sep:";
                    for (var d = 0; d <= 2; d++) {
                        try { sig += propSig(prop.getSeparationFollower(d)) + "|"; } catch(e) { break; }
                    }
                    return sig;
                }
                if (prop.numKeys === 0) return "=" + vStr(prop.value);
                var s = "";
                for (var k = 1; k <= prop.numKeys; k++) {
                    s += Math.round(prop.keyTime(k) * 10000) + ":" + vStr(prop.keyValue(k)) + ";";
                }
                return s;
            } catch(e) { return "?"; }
        }

        function fingerprint(comp) {
            var s = comp.name + "|" + comp.width + "|" + comp.height + "|" +
                    Math.round(comp.frameRate * 1000) + "|" +
                    Math.round(comp.duration * 10000) + "|" +
                    comp.numLayers;
            for (var i = 1; i <= comp.numLayers; i++) {
                try {
                    var layer = comp.layer(i);
                    var src = layer.source ? layer.source.name : ("@" + layer.matchName);
                    s += "|" + layer.name + "~" + src +
                         "~" + Math.round(layer.inPoint  * 1000) +
                         "~" + Math.round(layer.outPoint * 1000);
                } catch(e) { s += "|?"; }
            }
            return s;
        }

        function identical(a, b) {
            if (a === b) return true;
            if (a.name !== b.name || a.width !== b.width || a.height !== b.height) return false;
            if (Math.abs(a.frameRate - b.frameRate) > 0.0001) return false;
            if (Math.abs(a.duration  - b.duration)  > 0.001)  return false;
            if (a.numLayers !== b.numLayers) return false;
            var bA = a.bgColor, bB = b.bgColor;
            if (Math.round(bA[0]*255) !== Math.round(bB[0]*255) ||
                Math.round(bA[1]*255) !== Math.round(bB[1]*255) ||
                Math.round(bA[2]*255) !== Math.round(bB[2]*255)) return false;
            for (var i = 1; i <= a.numLayers; i++) {
                try {
                    var la = a.layer(i), lb = b.layer(i);
                    if (la.name !== lb.name || la.matchName !== lb.matchName) return false;
                    if (la.enabled !== lb.enabled || la.blendingMode !== lb.blendingMode) return false;
                    if (Math.abs(la.inPoint   - lb.inPoint)   > 0.001) return false;
                    if (Math.abs(la.outPoint  - lb.outPoint)  > 0.001) return false;
                    if (Math.abs(la.startTime - lb.startTime) > 0.001) return false;
                    var sA = la.source ? la.source.name : null;
                    var sB = lb.source ? lb.source.name : null;
                    if (sA !== sB) return false;
                    var ta = la.transform, tb = lb.transform;
                    if (propSig(ta.anchorPoint) !== propSig(tb.anchorPoint)) return false;
                    if (propSig(ta.position)    !== propSig(tb.position))    return false;
                    if (propSig(ta.scale)       !== propSig(tb.scale))       return false;
                    if (propSig(ta.rotation)    !== propSig(tb.rotation))    return false;
                    if (propSig(ta.opacity)     !== propSig(tb.opacity))     return false;
                    var eA = la.property("ADBE Effect Parade");
                    var eB = lb.property("ADBE Effect Parade");
                    if (eA.numProperties !== eB.numProperties) return false;
                    for (var e = 1; e <= eA.numProperties; e++) {
                        if (eA.property(e).matchName !== eB.property(e).matchName) return false;
                    }
                } catch(e) { return false; }
            }
            return true;
        }

        function replaceUsages(target, canon) {
            for (var i = 1; i <= proj.numItems; i++) {
                try {
                    var item = proj.item(i);
                    if (!(item instanceof CompItem) || item === target || item === canon) continue;
                    for (var j = 1; j <= item.numLayers; j++) {
                        try {
                            if (item.layer(j).source === target) item.layer(j).replaceSource(canon, false);
                        } catch(e) {}
                    }
                } catch(e) {}
            }
        }

        app.beginUndoGroup("Organize Project");
        var totalMerged = 0;

        // Consolidate duplicate footage items and solids
        var footageMerged = 0;
        var fileBuckets = {}, solidBuckets = {};
        for (var i = 1; i <= proj.numItems; i++) {
            try {
                var fi = proj.item(i);
                if (!(fi instanceof FootageItem)) continue;
                var fs = fi.mainSource;
                if (!fs) continue;
                if (fs instanceof FileSource) {
                    try {
                        var fk = "F|" + fs.file.absoluteURI;
                        if (!fileBuckets[fk]) fileBuckets[fk] = [];
                        fileBuckets[fk].push(fi);
                    } catch(e) {}
                } else if (fs instanceof SolidSource) {
                    var sk = "S|" + fi.width + "|" + fi.height + "|" +
                             Math.round(fs.color[0]*255) + "|" +
                             Math.round(fs.color[1]*255) + "|" +
                             Math.round(fs.color[2]*255);
                    if (!solidBuckets[sk]) solidBuckets[sk] = [];
                    solidBuckets[sk].push(fi);
                }
            } catch(e) {}
        }
        function mergeFootageBuckets(bkts) {
            for (var bk in bkts) {
                if (!bkts.hasOwnProperty(bk)) continue;
                var grp = bkts[bk];
                if (grp.length < 2) continue;
                var dead = {};
                for (var j = 1; j < grp.length; j++) {
                    if (dead[j]) continue;
                    replaceUsages(grp[j], grp[0]);
                    grp[j].remove();
                    dead[j] = true;
                    footageMerged++;
                }
            }
        }
        mergeFootageBuckets(fileBuckets);
        mergeFootageBuckets(solidBuckets);

        // Consolidate duplicate compositions (multi-pass)
        var changed = true;
        while (changed) {
            changed = false;
            var comps = [];
            for (var i = 1; i <= proj.numItems; i++) {
                try { if (proj.item(i) instanceof CompItem) comps.push(proj.item(i)); } catch(e) {}
            }
            if (comps.length < 2) break;

            var buckets = {};
            for (var i = 0; i < comps.length; i++) {
                var key = "K|" + fingerprint(comps[i]);
                if (!buckets[key]) buckets[key] = [];
                buckets[key].push(comps[i]);
            }
            for (var key in buckets) {
                if (!buckets.hasOwnProperty(key)) continue;
                var grp = buckets[key];
                if (grp.length < 2) continue;
                var dead = {};
                for (var i = 0; i < grp.length; i++) {
                    if (dead[i]) continue;
                    for (var j = i + 1; j < grp.length; j++) {
                        if (dead[j]) continue;
                        if (identical(grp[i], grp[j])) {
                            replaceUsages(grp[j], grp[i]);
                            grp[j].remove();
                            dead[j] = true;
                            totalMerged++;
                            changed = true;
                        }
                    }
                }
            }
        }

        app.endUndoGroup();

        var parts = [];
        if (footageMerged > 0) parts.push(footageMerged + " footage item" + (footageMerged === 1 ? "" : "s"));
        if (totalMerged   > 0) parts.push(totalMerged   + " composition"  + (totalMerged   === 1 ? "" : "s"));
        return parts.length > 0 ? "Merged " + parts.join(" and ") + "." : "No duplicates found.";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── PROJECT STRUCTURE ─────────────────────────────────────────────────────────

// Extension -> target-bucket key. Only file types AE can actually hold as a
// FootageItem are listed; anything else is left where it is rather than guessed at.
var STRUCTURE_EXT_MAP = {
    psd:"PSD", psb:"PSD",
    ai:"AI", eps:"AI",
    jpg:"IMG", jpeg:"IMG", png:"IMG", gif:"IMG", bmp:"IMG", tif:"IMG", tiff:"IMG",
    tga:"IMG", webp:"IMG", svg:"IMG", exr:"IMG", dpx:"IMG", hdr:"IMG",
    mov:"FOOTAGE", mp4:"FOOTAGE", avi:"FOOTAGE", mxf:"FOOTAGE", mkv:"FOOTAGE",
    wmv:"FOOTAGE", m4v:"FOOTAGE", webm:"FOOTAGE", mpg:"FOOTAGE", mpeg:"FOOTAGE",
    m2v:"FOOTAGE", r3d:"FOOTAGE", braw:"FOOTAGE",
    wav:"AUDIO", mp3:"AUDIO", aif:"AUDIO", aiff:"AUDIO", m4a:"AUDIO", wma:"AUDIO",
    ogg:"AUDIO", flac:"AUDIO",
    c4d:"C4D"
};

function itemsInFolder(folder) {
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        try { if (it.parentFolder === folder) out.push(it); } catch(e) {}
    }
    return out;
}

function findChildFolder(parent, name) {
    var kids = itemsInFolder(parent);
    for (var i = 0; i < kids.length; i++) {
        if (kids[i] instanceof FolderItem && kids[i].name === name) return kids[i];
    }
    return null;
}

function footageExt(fi) {
    try {
        var fs = fi.mainSource;
        if (fs && fs instanceof FileSource && fs.file) {
            var m = fs.file.name.match(/\.([a-zA-Z0-9]+)$/);
            if (m) return m[1].toLowerCase();
        }
    } catch(e) {}
    return null;
}

// Folders drawn from a preset's tree carry an explicit "role" only when the
// panel created them as one of Heist's built-ins (see _structMakeNode in
// main.js) — that's what lets the sorter keep finding "the PSD folder" etc.
// even after the user renames that node. Anything else (every folder in a
// custom preset, or a Heist node the user re-typed a brand new child under)
// has no role, so it's matched here by name instead — same keywords, so
// naming a custom folder "PSD" or "Audio" gets the same routing for free.
var STRUCTURE_ROLE_NAME_MAP = {
    precomps:"precomps", precomp:"precomps",
    psd:"psd", psds:"psd",
    ai:"ai",
    images:"images", image:"images", stills:"images", still:"images",
    footage:"footage", video:"footage", videos:"footage",
    audio:"audio", sfx:"audio", sound:"audio",
    c4d_scenes:"c4d", c4d:"c4d",
    ae_projects:"imported", imported:"imported"
};

function structureRoleKey(name) {
    return name.toLowerCase()
        .replace(/^\d+[.\-_\s]*/, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

// Walks a parsed preset tree, creating/reusing folders under `parent` (reusing
// by exact name match, so re-applying the same preset is idempotent). Depth-0
// folders are collected into topFolders (used to tell "part of this structure"
// apart from a pre-existing foreign folder); every folder's role — explicit or
// name-inferred — is recorded into roleFolders (first match wins on collision).
function buildStructureTree(nodes, parent, roleFolders, topFolders, isTop) {
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i], name = (n && n.name ? String(n.name) : "");
        if (!name) continue;
        var folder = findChildFolder(parent, name);
        if (!folder) {
            folder = app.project.items.addFolder(name);
            folder.parentFolder = parent;
        }
        if (isTop) topFolders.push(folder);
        var role = n.role || STRUCTURE_ROLE_NAME_MAP[structureRoleKey(name)];
        if (role && !roleFolders[role]) roleFolders[role] = folder;
        if (n.children && n.children.length) buildStructureTree(n.children, folder, roleFolders, topFolders, false);
    }
}

function lineup_configureProjectStructure(treeJson, breakStructure) {
    try {
        var tree;
        try { tree = JSON.parse(treeJson); } catch(e) { return "ERROR: Invalid structure data."; }
        if (!tree || !tree.length) return "ERROR: This preset has no folders — add at least one before applying.";

        app.beginUndoGroup("Configure Project Structure");

        var roleFolders = {}, topFolders = [];
        buildStructureTree(tree, app.project.rootFolder, roleFolders, topFolders, true);

        var fPre    = roleFolders.precomps;
        var fAeProj = roleFolders.imported;
        var DEST = {
            PSD: roleFolders.psd, AI: roleFolders.ai, IMG: roleFolders.images,
            FOOTAGE: roleFolders.footage, AUDIO: roleFolders.audio, C4D: roleFolders.c4d
        };

        function sortItem(it) {
            if (it instanceof CompItem) {
                if (!fPre) return false;
                it.parentFolder = fPre; return true;
            }
            if (it instanceof FootageItem) {
                var ext = footageExt(it), cat = ext ? STRUCTURE_EXT_MAP[ext] : null;
                if (!cat || !DEST[cat]) return false;
                it.parentFolder = DEST[cat];
                return true;
            }
            return false;
        }

        // Recursively pulls every Comp/Footage item out of a foreign folder tree,
        // sorts each one into its proper bucket, then deletes folders left empty
        // behind it. Items we can't classify (no matching extension, or a role
        // this preset doesn't have a folder for) are left in place, which also
        // leaves their containing folder un-deleted — nothing unclassified is
        // ever silently dropped.
        function unpackFolder(folder) {
            var count = 0, kids = itemsInFolder(folder);
            for (var i = 0; i < kids.length; i++) {
                var kid = kids[i];
                if (kid instanceof FolderItem) count += unpackFolder(kid);
                else if (sortItem(kid)) count++;
            }
            try { if (itemsInFolder(folder).length === 0) folder.remove(); } catch(e) {}
            return count;
        }

        var topItems = itemsInFolder(app.project.rootFolder);
        var foreignFolders = [];
        for (var i = 0; i < topItems.length; i++) {
            var it = topItems[i];
            if (it instanceof FolderItem) {
                var known = false;
                for (var s = 0; s < topFolders.length; s++) if (topFolders[s] === it) { known = true; break; }
                if (!known) foreignFolders.push(it);
            }
        }

        var brokenCount = 0, movedFolders = 0, leftFolders = 0;
        if (breakStructure) {
            for (var i = 0; i < foreignFolders.length; i++) brokenCount += unpackFolder(foreignFolders[i]);
        } else if (fAeProj) {
            for (var i = 0; i < foreignFolders.length; i++) { foreignFolders[i].parentFolder = fAeProj; movedFolders++; }
        } else {
            leftFolders = foreignFolders.length;
        }

        var movedComps = 0, movedAssets = 0;
        var rootItems = itemsInFolder(app.project.rootFolder);
        for (var i = 0; i < rootItems.length; i++) {
            var it = rootItems[i];
            if (it instanceof FolderItem) continue;
            if (sortItem(it)) { if (it instanceof CompItem) movedComps++; else movedAssets++; }
        }

        app.endUndoGroup();

        var sortedTotal = movedComps + movedAssets + brokenCount;
        if (sortedTotal === 0 && foreignFolders.length === 0) {
            return "Created folder structure — nothing loose to sort.";
        }
        var msg = "Sorted " + pluralize(sortedTotal, "item") + " into folders";
        if (breakStructure) {
            if (foreignFolders.length > 0) msg += "; broke apart " + pluralize(foreignFolders.length, "existing folder");
        } else if (movedFolders > 0) {
            msg += "; moved " + pluralize(movedFolders, "existing folder") + " into the imported folder";
        } else if (leftFolders > 0) {
            msg += "; left " + pluralize(leftFolders, "existing folder") + " as-is (this preset has no \"imported\" folder)";
        }
        return msg;
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── LINK PROPERTY TO CONTROLLER ───────────────────────────────────────────────

// Climbs parentProperty links from a Property up to the Layer that owns it.
function ownerLayer(prop) {
    var p = prop;
    while (p && !(p instanceof Layer)) p = p.parentProperty;
    return p;
}

// Spatial properties (Position, Anchor Point) can be split into per-axis
// followers in the timeline; a linked expression has to assign a single
// combined array, so merge them back into one property first.
function collapseSeparatedDims(prop) {
    if (!prop.dimensionsSeparated) return;
    var n = prop.value.length, vals = [];
    for (var d=0; d<n; d++) vals.push(prop.getSeparationFollower(d).value);
    prop.dimensionsSeparated = false;
    while (prop.numKeys > 0) prop.removeKey(1);
    prop.setValue(vals);
}

function lineup_linkPropertyToController(offset) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2) return "ERROR: Select at least 2 layers with the same property selected.";

        var selProps = comp.selectedProperties, props = [];
        for (var i=0; i<selProps.length; i++) if (selProps[i].propertyType === PropertyType.PROPERTY) props.push(selProps[i]);
        if (props.length === 0) return "ERROR: Select a property (e.g. Rotation, Opacity, Position) on the selected layers.";

        var targets = [];
        for (var i=0; i<layers.length; i++) {
            var lyr = layers[i], found = null, matchCount = 0;
            for (var j=0; j<props.length; j++) {
                if (ownerLayer(props[j]) === lyr) { matchCount++; if (!found) found = props[j]; }
            }
            if (matchCount === 0) return "ERROR: Select the same property on every selected layer.";
            if (matchCount > 1) return "ERROR: Select only one property across all selected layers.";
            targets.push({layer: lyr, prop: found});
        }

        var refName = targets[0].prop.matchName;
        for (var i=1; i<targets.length; i++) {
            if (targets[i].prop.matchName !== refName) return "ERROR: Select the same property on every selected layer.";
        }

        var refProp = targets[0].prop, pvt = refProp.propertyValueType;
        var controlMatchName, valIdx=1;
        if (pvt === PropertyValueType.COLOR) controlMatchName = "ADBE Color Control";
        else if (pvt === PropertyValueType.TwoD || pvt === PropertyValueType.TwoD_SPATIAL) controlMatchName = "ADBE Point Control";
        else if (pvt === PropertyValueType.OneD && refProp.unitsText === "degrees") controlMatchName = "ADBE Angle Control";
        else if (pvt === PropertyValueType.OneD) controlMatchName = "ADBE Slider Control";
        else return "ERROR: Unsupported property type for linking.";

        app.beginUndoGroup("Link Property to Controller");

        for (var i=0; i<targets.length; i++) {
            if (targets[i].prop.dimensionsSeparated) collapseSeparatedDims(targets[i].prop);
        }

        var propLabel = refProp.name;
        var nullName = propLabel + " Controller", sfx=2, taken=true;
        while (taken) {
            taken=false;
            for (var li=1; li<=comp.numLayers; li++) {
                if (comp.layer(li).name===nullName) { nullName=propLabel+" Controller "+sfx++; taken=true; break; }
            }
        }

        var nullLayer = comp.layers.addNull();
        nullLayer.name = nullName;

        var fx = nullLayer.property("ADBE Effect Parade").addProperty(controlMatchName);
        fx.name = propLabel;
        var baseValue = targets[0].prop.value;
        fx.property(valIdx).setValue(baseValue);

        var safeNull = nullName.replace(/"/g, '\\"'), safeFx = propLabel.replace(/"/g, '\\"');
        var ctrlRef = 'thisComp.layer("'+safeNull+'").effect("'+safeFx+'")('+valIdx+')';

        for (var i=0; i<targets.length; i++) {
            var prop = targets[i].prop, expr = ctrlRef;
            if (offset) {
                var own = prop.value, diff;
                if (typeof own === "number") diff = own - baseValue;
                else { diff=[]; for (var d=0; d<own.length; d++) diff.push(own[d] - baseValue[d]); }
                expr += (typeof diff === "number") ? (' + ' + diff) : (' + [' + diff.join(",") + ']');
            }
            prop.expression = expr + ';';
            prop.expressionEnabled = true;
        }

        app.endUndoGroup();
        return "Linked \""+propLabel+"\" on "+targets.length+" layers to \""+nullName+"\"";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── GET COMP SIZE ─────────────────────────────────────────────────────────────

function lineup_getCompSize() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "1920,1080";
        return comp.width + "," + comp.height;
    } catch(e) { return "1920,1080"; }
}

// ── LAYER SORT ────────────────────────────────────────────────────────────────

function lineup_sortLayers(propIdx, axisIdx, descend, groupNull) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem))
            return "ERROR: No active composition";
        var layers = comp.selectedLayers;
        if (!layers || layers.length < 2)
            return "ERROR: Select at least 2 layers to sort";

        function getSortValue(layer) {
            try {
                if (propIdx === 0) {
                    var pos = layer.position;
                    if (pos.dimensionsSeparated)
                        return pos.getSeparationFollower(axisIdx).value;
                    return pos.value[axisIdx];
                } else if (propIdx === 1) {
                    return layer.rotation.value;
                } else {
                    return layer.scale.value[0];
                }
            } catch(e) { return 0; }
        }

        var layerData = [];
        for (var i = 0; i < layers.length; i++) {
            layerData.push({ layer: layers[i], value: getSortValue(layers[i]), origIndex: layers[i].index });
        }
        layerData.sort(function(a, b) {
            return descend ? b.value - a.value : a.value - b.value;
        });

        var topIndex = layerData[0].origIndex;
        for (var i = 1; i < layerData.length; i++) {
            if (layerData[i].origIndex < topIndex) topIndex = layerData[i].origIndex;
        }

        app.beginUndoGroup("Sort Layers");
        if (topIndex === 1) {
            layerData[0].layer.moveToBeginning();
        } else {
            layerData[0].layer.moveAfter(comp.layer(topIndex - 1));
        }
        for (var i = 1; i < layerData.length; i++) {
            layerData[i].layer.moveAfter(layerData[i - 1].layer);
        }

        if (groupNull) {
            var nullLayer = comp.layers.addNull();
            nullLayer.name = "Sort Group";
            nullLayer.position.setValue([comp.width / 2, comp.height / 2]);
            nullLayer.moveBefore(layerData[0].layer);
            for (var i = 0; i < layerData.length; i++) {
                layerData[i].layer.parent = nullLayer;
            }
        }

        app.endUndoGroup();
        return "ok";
    } catch (err) {
        try { app.endUndoGroup(); } catch(e) {}
        return "ERROR: " + err.toString();
    }
}

// ── BATCH COMP SETTINGS ─────────────────────────────────────────────────────────

function hasExpression(posProp) {
    if (posProp.dimensionsSeparated) {
        for (var d = 0; d < 3; d++) {
            try { if (posProp.getSeparationFollower(d).expressionEnabled) return true; } catch (e) {}
        }
        return false;
    }
    try { return !!posProp.expressionEnabled; } catch (e) { return false; }
}

function positionIs3D(posProp) {
    if (posProp.dimensionsSeparated) {
        try { posProp.getSeparationFollower(2); return true; } catch (e) { return false; }
    }
    return posProp.value.length === 3;
}

// Recursively collects every comp used as a layer source inside the given root
// comps (and inside those, etc) — backs the "Also update nested compositions" option.
function collectNestedComps(rootComps) {
    var seen = {}, all = [], queue = [];
    for (var i = 0; i < rootComps.length; i++) {
        seen[rootComps[i].id] = true;
        all.push(rootComps[i]);
        queue.push(rootComps[i]);
    }
    while (queue.length > 0) {
        var c = queue.shift();
        for (var li = 1; li <= c.numLayers; li++) {
            var layer = c.layer(li);
            if (!(layer instanceof AVLayer)) continue;
            var src = layer.source;
            if (src && src instanceof CompItem && !seen[src.id]) {
                seen[src.id] = true;
                all.push(src);
                queue.push(src);
            }
        }
    }
    return all;
}

// Captures every keyframe on a leaf property, then rebuilds them at frame-rounded
// times. ExtendScript has no "move this keyframe" call — removing and re-adding is
// the only way to relocate one — so all interpolation/ease/spatial data has to be
// captured up front and reapplied afterward.
function snapLeafKeyframes(prop, frameDur) {
    var n = prop.numKeys;
    if (n === 0) return;

    var data = [];
    var anyChanged = false;
    for (var k = 1; k <= n; k++) {
        var t       = prop.keyTime(k);
        var snapped = Math.round(t / frameDur) * frameDur;
        if (Math.abs(snapped - t) > 1e-6) anyChanged = true;
        var item = { time: snapped, value: prop.keyValue(k) };
        try { item.inInterp   = prop.keyInInterpolationType(k); } catch (e) {}
        try { item.outInterp  = prop.keyOutInterpolationType(k); } catch (e) {}
        try { item.inEase     = prop.keyInTemporalEase(k); } catch (e) {}
        try { item.outEase    = prop.keyOutTemporalEase(k); } catch (e) {}
        try { item.autoBezier = prop.keySpatialAutoBezier(k); } catch (e) {}
        try { item.continuous = prop.keySpatialContinuous(k); } catch (e) {}
        try { item.inTangent  = prop.keyInSpatialTangent(k); } catch (e) {}
        try { item.outTangent = prop.keyOutSpatialTangent(k); } catch (e) {}
        try { item.roving     = prop.keyRoving(k); } catch (e) {}
        data.push(item);
    }
    if (!anyChanged) return;

    for (var k = n; k >= 1; k--) prop.removeKey(k);
    for (var i = 0; i < data.length; i++) prop.setValueAtTime(data[i].time, data[i].value);

    for (var i = 0; i < data.length; i++) {
        var idx = prop.nearestKeyIndex(data[i].time);
        if (data[i].inInterp !== undefined && data[i].outInterp !== undefined) {
            try { prop.setInterpolationTypeAtKey(idx, data[i].inInterp, data[i].outInterp); } catch (e) {}
        }
        // setTemporalEaseAtKey requires the key to already be Bezier on both sides —
        // calling it on a Linear/Hold key silently force-promotes it to Bezier, which
        // is exactly the "snap is adding bezier curves" bug. keyInTemporalEase/
        // keyOutTemporalEase return a value for every key regardless of type, so this
        // has to be gated on the captured interpolation type, not just truthiness.
        if (data[i].inInterp === KeyframeInterpolationType.BEZIER &&
            data[i].outInterp === KeyframeInterpolationType.BEZIER &&
            data[i].inEase && data[i].outEase) {
            try { prop.setTemporalEaseAtKey(idx, data[i].inEase, data[i].outEase); } catch (e) {}
        }
        if (data[i].autoBezier !== undefined) { try { prop.setSpatialAutoBezierAtKey(idx, data[i].autoBezier); } catch (e) {} }
        if (data[i].continuous !== undefined) { try { prop.setSpatialContinuousAtKey(idx, data[i].continuous); } catch (e) {} }
        // Auto-Bezier tangents are recomputed by AE from the (now snapped) neighboring
        // keyframe spacing — forcing back the pre-snap tangent values here would fight
        // that recompute and visibly kink the curve. Only restore explicit tangents for
        // keys that were already in manual (non-auto) Bezier mode.
        if (!data[i].autoBezier && data[i].inTangent && data[i].outTangent) {
            try { prop.setSpatialTangentsAtKey(idx, data[i].inTangent, data[i].outTangent); } catch (e) {}
        }
        if (data[i].roving) { try { prop.setRovingAtKey(idx, true); } catch (e) {} }
    }
}

function snapPropertyTreeKeyframes(prop, frameDur) {
    if (prop.propertyType === PropertyType.PROPERTY) {
        if (prop.dimensionsSeparated) {
            var dims = prop.value.length;
            for (var d = 0; d < dims; d++) {
                try { snapLeafKeyframes(prop.getSeparationFollower(d), frameDur); } catch (e) {}
            }
        } else if (prop.numKeys > 0) {
            snapLeafKeyframes(prop, frameDur);
        }
    } else {
        for (var i = 1; i <= prop.numProperties; i++) {
            try { snapPropertyTreeKeyframes(prop.property(i), frameDur); } catch (e) {}
        }
    }
}

function snapCompKeyframesToFrames(comp) {
    var frameDur = comp.frameDuration;
    for (var li = 1; li <= comp.numLayers; li++) {
        var layer = comp.layer(li);
        for (var pi = 1; pi <= layer.numProperties; pi++) {
            try { snapPropertyTreeKeyframes(layer.property(pi), frameDur); } catch (e) {}
        }
    }
}

// Rounds each layer's in/out points to the nearest whole frame at the new frame
// rate. Order of assignment matters — AE rejects an inPoint/outPoint write that
// would momentarily put inPoint >= outPoint, so whichever edge isn't crossing
// the other (relative to the layer's *current* points) is set first.
function snapLayerInOutToFrames(comp) {
    var frameDur = comp.frameDuration;
    for (var li = 1; li <= comp.numLayers; li++) {
        var layer = comp.layer(li);
        try {
            var newIn  = Math.round(layer.inPoint  / frameDur) * frameDur;
            var newOut = Math.round(layer.outPoint / frameDur) * frameDur;
            if (newOut <= newIn) newOut = newIn + frameDur;
            if (Math.abs(newIn - layer.inPoint) < 1e-6 && Math.abs(newOut - layer.outPoint) < 1e-6) continue;

            if (newIn < layer.outPoint) {
                layer.inPoint  = newIn;
                layer.outPoint = newOut;
            } else {
                layer.outPoint = newOut;
                layer.inPoint  = newIn;
            }
        } catch (e) {}
    }
}

// Only un-parented layers are shifted directly: a parented layer's position is in
// its parent's local space, not comp space, so once the parent (also a layer in this
// comp) is shifted, every descendant inherits that shift through the parenting
// transform automatically. Shifting them too would double the offset.
function applyBatchSettingsToComp(comp, s, warnings) {
    if (s.applyDims) {
        var oldW = comp.width, oldH = comp.height;
        comp.width  = s.width;
        comp.height = s.height;
        var dx = (s.width - oldW) / 2, dy = (s.height - oldH) / 2;
        if (dx !== 0 || dy !== 0) {
            for (var li = 1; li <= comp.numLayers; li++) {
                var layer = comp.layer(li);
                if (layer.parent) continue; // falsy check — comes back as undefined, not null, when unset
                var pos = layer.position;
                if (hasExpression(pos)) {
                    warnings.push(layer.name + " — position has an expression");
                    continue;
                }
                try { shiftPosition(pos, dx, dy, positionIs3D(pos)); } catch (e) {}
            }
        }
    }
    if (s.applyPAR)   { comp.pixelAspect = s.pixelAspect; }
    if (s.applyRes)   { comp.resolutionFactor = [s.resolutionFactor, s.resolutionFactor]; }
    if (s.applyDur)   { comp.duration = s.duration; }
    if (s.applyStart) { comp.displayStartTime = s.startTime; }
    if (s.applyFR) {
        comp.frameRate = s.frameRate;
        if (s.snapKeyframes) {
            snapCompKeyframesToFrames(comp);
            snapLayerInOutToFrames(comp);
        }
    }
}

// Always succeeds — even with nothing selected — so the panel can open and show
// "No comp selected" instead of being blocked. Seeds from the top selected comp
// in the Project panel when available, otherwise falls back to sane defaults
// (1920x1080, Square Pixels, 30fps, Full res, 5s duration, 0s start).
function lineup_getBatchCompSettingsSeed() {
    try {
        var proj = app.project;
        var comps = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) comps.push(proj.selection[i]);
        }
        var seed = comps.length > 0 ? comps[0] : null; // top selected comp in the Project panel

        var width = 1920, height = 1080, par = 1, fr = 30, res = 1, dur = 5, start = 0;
        if (seed) {
            width  = seed.width;
            height = seed.height;
            par    = seed.pixelAspect;
            fr     = seed.frameRate;
            res    = seed.resolutionFactor ? seed.resolutionFactor[0] : 1;
            dur    = seed.duration;
            start  = seed.displayStartTime;
        }

        var names = [];
        for (var i = 0; i < comps.length; i++) names.push(comps[i].name.replace(/\|/g, "/"));

        return [comps.length, width, height, par, fr, res, dur, start].join(",") + "|" + names.join("|");
    } catch (e) { return "ERROR: " + e.toString(); }
}

function lineup_batchApplyCompSettings(
    applyDims, width, height,
    applyPAR, pixelAspect,
    applyFR, frameRate, snapKeyframes,
    applyRes, resolutionFactor,
    applyDur, duration,
    applyStart, startTime,
    includeNested,
    excludedIndices
) {
    try {
        var proj = app.project;
        var allComps = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) allComps.push(proj.selection[i]);
        }
        if (allComps.length === 0) return "ERROR: Select at least one composition in the Project panel.";

        // Indices (into allComps, same order the panel's comp list was built from)
        // the user removed from the batch via the panel's per-row remove button.
        var excluded = {};
        if (excludedIndices) {
            var exParts = String(excludedIndices).split(",");
            for (var i = 0; i < exParts.length; i++) {
                var exIdx = parseInt(exParts[i], 10);
                if (!isNaN(exIdx)) excluded[exIdx] = true;
            }
        }
        var comps = [];
        for (var i = 0; i < allComps.length; i++) {
            if (!excluded[i]) comps.push(allComps[i]);
        }
        if (comps.length === 0) return "ERROR: No compositions left to apply to — all were removed from the list.";

        var s = {
            applyDims: !!applyDims, width: width, height: height,
            applyPAR: !!applyPAR, pixelAspect: pixelAspect,
            applyFR: !!applyFR, frameRate: frameRate, snapKeyframes: !!snapKeyframes,
            applyRes: !!applyRes, resolutionFactor: resolutionFactor,
            applyDur: !!applyDur, duration: duration,
            applyStart: !!applyStart, startTime: startTime,
            includeNested: !!includeNested
        };

        var targets  = s.includeNested ? collectNestedComps(comps) : comps;
        var warnings = [];

        app.beginUndoGroup("Batch Composition Settings");
        try {
            for (var i = 0; i < targets.length; i++) applyBatchSettingsToComp(targets[i], s, warnings);
        } catch (err) {
            app.endUndoGroup();
            return "ERROR: " + err.toString();
        }
        app.endUndoGroup();

        if (warnings.length > 0) {
            var shown = warnings.slice(0, 12).join(" | ");
            var extra = warnings.length > 12 ? " …and " + (warnings.length - 12) + " more." : "";
            return "WARN:Done, but couldn't shift these (expression-driven — check manually): " + shown + extra;
        }
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

// ── BATCH RENAME ─────────────────────────────────────────────────────────────

// Always succeeds — even with nothing selected — so the panel can open and show
// "No comp selected" instead of being blocked.
function lineup_getBatchRenameSeed() {
    try {
        var proj  = app.project;
        var names = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) names.push(proj.selection[i].name.replace(/\|/g, "/"));
        }
        return names.join("|");
    } catch (e) { return "ERROR: " + e.toString(); }
}

// Spreadsheet-style column letters: 1 -> A, 2 -> B, … 26 -> Z, 27 -> AA, …
function numberToLetters(num) {
    var s = "";
    while (num > 0) {
        var rem = (num - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        num = Math.floor((num - 1) / 26);
    }
    return s;
}

function lineup_batchRenameComps(pattern, start, orderIndices) {
    try {
        var proj = app.project;
        var allComps = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) allComps.push(proj.selection[i]);
        }
        if (allComps.length === 0) return "ERROR: Select at least one composition in the Project panel.";
        if (!pattern) return "ERROR: Enter a name pattern.";

        // orderIndices is a CSV of indices into allComps, in the (possibly
        // reordered, possibly trimmed) order the panel's comp list ended up in —
        // that order, not allComps' original order, drives the numbering.
        var order = [];
        if (orderIndices) {
            var parts = String(orderIndices).split(",");
            for (var i = 0; i < parts.length; i++) {
                var idx = parseInt(parts[i], 10);
                if (!isNaN(idx) && allComps[idx]) order.push(idx);
            }
        }
        if (order.length === 0) return "ERROR: No compositions left to rename — all were removed from the list.";

        var startNum = parseInt(start, 10);
        if (isNaN(startNum)) startNum = 1;

        app.beginUndoGroup("Batch Rename Compositions");
        try {
            for (var pos = 0; pos < order.length; pos++) {
                var num      = startNum + pos;
                var letterPos = pos + 1; // [A] always starts at A, independent of Start-at
                // Replace every [#], [##], [###]… run with the index, zero-padded to
                // the number of # characters between the brackets, and the semi-secret
                // [A] token with a letter based on position alone.
                var newName = pattern.replace(/\[#+\]/g, function (m) {
                    var width = m.length - 2;
                    var s = String(num);
                    while (s.length < width) s = "0" + s;
                    return s;
                });
                newName = newName.replace(/\[A\]/g, numberToLetters(letterPos));
                allComps[order[pos]].name = newName;
            }
        } catch (err) {
            app.endUndoGroup();
            return "ERROR: " + err.toString();
        }
        app.endUndoGroup();
        return "ok";
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return "ERROR: " + e.toString();
    }
}

// ── COMP EXPORT ──────────────────────────────────────────────────────────────

// Always succeeds — even with nothing selected — so the panel can open and show
// "No comp selected" instead of being blocked. Returns the current project's
// folder and base filename (both empty if it's never been saved) so the panel
// can build the suggested save name itself as the comp selection changes.
function lineup_getCompExportSeed() {
    try {
        var proj  = app.project;
        var names = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) names.push(proj.selection[i].name.replace(/\|/g, "/"));
        }

        var folderPath = proj.file ? proj.file.parent.fsName.replace(/\|/g, "/") : "";
        var projBase   = proj.file ? proj.file.name.replace(/\.aep$/i, "").replace(/\|/g, "/") : "";

        return folderPath + "|" + projBase + "|" + names.join("|");
    } catch (e) { return "ERROR: " + e.toString(); }
}

// Native Save dialog (same call on Mac and Windows — ExtendScript's File object
// always shows the OS's own file picker). Returns "" if the user cancels.
function lineup_pickExportLocation(defaultPath) {
    try {
        var seed = defaultPath ? new File(defaultPath) : new File(Folder.myDocuments.fsName + "/Untitled_export.aep");
        var picked = seed.saveDlg("Save Reduced Project As", "After Effects Project:*.aep");
        if (!picked) return "";
        var path = picked.fsName;
        if (!/\.aep$/i.test(path)) path += ".aep";
        return path;
    } catch (e) { return "ERROR: " + e.toString(); }
}

// Combines AE's own "Save" + "Save As" + "Reduce Project": saves the current
// project in place first (so nothing unsaved is left behind), duplicates it to
// a new file, strips the duplicate down to just the chosen comps (asset links
// stay where they are, nothing gets copied/collected), saves that, and leaves
// the new reduced project open as the active one.
function lineup_exportReducedProject(exportPath, excludedIndices) {
    try {
        var proj = app.project;
        if (!proj.file) return "ERROR: Save this project at least once before exporting a reduced copy.";
        if (!exportPath) return "ERROR: Choose a save location first.";

        var allComps = [];
        for (var i = 0; i < proj.selection.length; i++) {
            if (proj.selection[i] instanceof CompItem) allComps.push(proj.selection[i]);
        }
        if (allComps.length === 0) return "ERROR: Select at least one composition in the Project panel.";

        // Indices (into allComps, same order the panel's comp list was built from)
        // the user removed from the batch via the panel's per-row remove button.
        var excluded = {};
        if (excludedIndices) {
            var exParts = String(excludedIndices).split(",");
            for (var i = 0; i < exParts.length; i++) {
                var exIdx = parseInt(exParts[i], 10);
                if (!isNaN(exIdx)) excluded[exIdx] = true;
            }
        }
        var comps = [];
        for (var i = 0; i < allComps.length; i++) {
            if (!excluded[i]) comps.push(allComps[i]);
        }
        if (comps.length === 0) return "ERROR: No compositions left to export — all were removed from the list.";

        proj.save();                      // persist the original project as-is first
        proj.save(new File(exportPath));  // duplicate to the new file
        proj.reduceProject(comps);
        proj.save();                      // persist the reduction to the new file

        return "ok";
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// ── Spellcheck ────────────────────────────────────────────────────────────────

function spellcheck_getComps(idsJson) {
    try {
        var comps = [];
        if (idsJson && idsJson !== "null" && idsJson !== "") {
            var ids = JSON.parse(idsJson);
            for (var ii = 0; ii < ids.length; ii++) {
                for (var n = 1; n <= app.project.numItems; n++) {
                    var item = app.project.item(n);
                    if ((item instanceof CompItem) && item.id === ids[ii]) { comps.push(item); break; }
                }
            }
        } else {
            for (var n = 1; n <= app.project.numItems; n++) {
                var item = app.project.item(n);
                if (item instanceof CompItem) comps.push(item);
            }
        }
        if (comps.length === 0) return JSON.stringify([]);

        var result = [];
        for (var c = 0; c < comps.length; c++) {
            var comp = comps[c];
            var layers = [];
            for (var i = 1; i <= comp.numLayers; i++) {
                var layer = comp.layer(i);
                if (!(layer instanceof TextLayer)) continue;
                var srcText = layer.property("ADBE Text Properties").property("ADBE Text Document");
                var texts = [];
                if (srcText.numKeys > 0) {
                    for (var k = 1; k <= srcText.numKeys; k++) {
                        texts.push({ text: srcText.keyValue(k).text, keyIndex: k, time: srcText.keyTime(k) });
                    }
                } else {
                    texts.push({ text: srcText.value.text, keyIndex: 0, time: layer.inPoint });
                }
                layers.push({ index: i, name: layer.name, inPoint: layer.inPoint, texts: texts });
            }
            result.push({ id: comp.id, name: comp.name, fps: comp.frameRate, label: comp.label, layers: layers });
        }
        return JSON.stringify(result);
    } catch (e) {
        return "ERROR:" + e.message;
    }
}

function spellcheck_goto(compId, layerIndex, time) {
    try {
        var comp = null;
        var cid  = parseInt(compId, 10);
        for (var n = 1; n <= app.project.numItems; n++) {
            var item = app.project.item(n);
            if ((item instanceof CompItem) && item.id === cid) { comp = item; break; }
        }
        if (!comp) return "ERROR:Comp not found.";
        comp.openInViewer();
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        var layer = comp.layer(parseInt(layerIndex, 10));
        layer.selected = true;
        comp.time = parseFloat(time);
        return "OK";
    } catch (e) {
        return "ERROR:" + e.message;
    }
}

var _spellLastCompId = null;

function spellcheck_getState() {
    try {
        var result = { activeCompId: null, selectedCompIds: [], lastCompId: _spellLastCompId };
        var active = app.project.activeItem;
        if (active instanceof CompItem) {
            result.activeCompId = active.id;
            _spellLastCompId    = active.id;
            result.lastCompId   = active.id;
        }
        var sel = app.project.selection;
        if (sel) {
            for (var i = 0; i < sel.length; i++) {
                if (sel[i] instanceof CompItem) result.selectedCompIds.push(sel[i].id);
            }
        }
        return JSON.stringify(result);
    } catch (e) { return "ERROR:" + e.message; }
}

// ── Find & Replace ────────────────────────────────────────────────────────────

function _frApply(text, lq, query, repl, mode, invert) {
    var lText = text.toLowerCase();
    var idx, result, si, fi;

    if (!invert) {
        if (mode === 'contains') {
            if (lText.indexOf(lq) === -1) return null;
            result = ''; si = 0; fi = lText.indexOf(lq, 0);
            while (fi !== -1) {
                result += text.slice(si, fi) + repl;
                si = fi + lq.length;
                fi = lText.indexOf(lq, si);
            }
            return result + text.slice(si);
        }
        if (mode === 'starts') {
            if (lText.indexOf(lq) !== 0) return null;
            return repl + text.slice(query.length);
        }
        if (mode === 'ends') {
            idx = lText.length - lq.length;
            if (idx < 0 || lText.lastIndexOf(lq) !== idx) return null;
            return text.slice(0, text.length - query.length) + repl;
        }
    } else {
        if (mode === 'starts') {
            if (lText.indexOf(lq) === 0) return null;
            return query + text;
        }
        if (mode === 'ends') {
            idx = lText.length - lq.length;
            if (idx >= 0 && lText.lastIndexOf(lq) === idx) return null;
            return text + query;
        }
    }
    return null;
}

function find_replace(paramsJson) {
    try {
        app.beginUndoGroup("Find & Replace");
        var p      = JSON.parse(paramsJson);
        var query  = p.query  || '';
        var repl   = (p.repl !== undefined && p.repl !== null) ? p.repl : '';
        var mode   = p.mode   || 'contains';
        var invert = !!p.invert;
        var ids    = p.ids    || null;
        var lq     = query.toLowerCase();
        var count      = 0;
        var layerSet   = {};
        var layerCount = 0;
        var n, item, c, i, k, comp, layer, srcText, td, newText, layerKey;

        if (!query || (invert && mode === 'contains')) {
            app.endUndoGroup();
            return JSON.stringify({ count: 0 });
        }

        var comps = [];
        if (ids && ids.length) {
            for (var ii = 0; ii < ids.length; ii++) {
                for (n = 1; n <= app.project.numItems; n++) {
                    item = app.project.item(n);
                    if ((item instanceof CompItem) && item.id === ids[ii]) { comps.push(item); break; }
                }
            }
        } else {
            for (n = 1; n <= app.project.numItems; n++) {
                item = app.project.item(n);
                if (item instanceof CompItem) comps.push(item);
            }
        }

        for (c = 0; c < comps.length; c++) {
            comp = comps[c];
            for (i = 1; i <= comp.numLayers; i++) {
                layer = comp.layer(i);
                if (!(layer instanceof TextLayer)) continue;
                srcText = layer.property("ADBE Text Properties").property("ADBE Text Document");
                layerKey = comp.id + ':' + i;
                if (srcText.numKeys > 0) {
                    for (k = 1; k <= srcText.numKeys; k++) {
                        td      = srcText.keyValue(k);
                        newText = _frApply(td.text, lq, query, repl, mode, invert);
                        if (newText !== null) {
                            td.text = newText; srcText.setValueAtKey(k, td); count++;
                            if (!layerSet[layerKey]) { layerSet[layerKey] = true; layerCount++; }
                        }
                    }
                } else {
                    td      = srcText.value;
                    newText = _frApply(td.text, lq, query, repl, mode, invert);
                    if (newText !== null) {
                        td.text = newText; srcText.setValue(td); count++;
                        if (!layerSet[layerKey]) { layerSet[layerKey] = true; layerCount++; }
                    }
                }
            }
        }

        app.endUndoGroup();
        return JSON.stringify({ count: count, layers: layerCount });
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return 'ERROR:' + e.message;
    }
}

function spellcheck_replace(layerIndex, keyIndex, oldWord, newWord) {
    try {
        app.beginUndoGroup("Spellcheck Fix");
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) { app.endUndoGroup(); return "ERROR:No active composition."; }
        var layer = comp.layer(parseInt(layerIndex, 10));
        if (!(layer instanceof TextLayer)) { app.endUndoGroup(); return "ERROR:Not a text layer."; }
        var srcText = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var ki = parseInt(keyIndex, 10);
        var td = ki > 0 ? srcText.keyValue(ki) : srcText.value;
        td.text = td.text.replace(new RegExp("\\b" + oldWord + "\\b", "gi"), newWord);
        if (ki > 0) { srcText.setValueAtKey(ki, td); } else { srcText.setValue(td); }
        app.endUndoGroup();
        return "OK";
    } catch (e) {
        try { app.endUndoGroup(); } catch (_) {}
        return "ERROR:" + e.message;
    }
}
