/* Lineup CEP — Panel JavaScript */

var cs = new CSInterface();

// ── Section toggle ────────────────────────────────────────────────────────────

function toggleSection(id) {
    var hdr  = document.querySelector('#sec-' + id + ' .section-hdr');
    var body = document.getElementById('body-' + id);
    var collapsed = body.classList.toggle('hidden');
    hdr.classList.toggle('collapsed', collapsed);
    try { localStorage.setItem('lineup-sec-' + id, collapsed ? '1' : '0'); } catch(e) {}
}

function restoreCollapsed() {
    var ids = ['align','dist','anchor','ease','rigs','sort','autocrop','organize'];
    ids.forEach(function(id) {
        var stored;
        try { stored = localStorage.getItem('lineup-sec-' + id); } catch(e) {}
        if (stored === '1') {
            var body = document.getElementById('body-' + id);
            var hdr  = document.querySelector('#sec-' + id + ' .section-hdr');
            if (body) body.classList.add('hidden');
            if (hdr)  hdr.classList.add('collapsed');
        }
    });
}

// ── Toast notifications ───────────────────────────────────────────────────────

var _toastTimer = null;

function showToast(msg, type) {
    var toast = document.getElementById('toast');
    var msgEl = document.getElementById('toast-msg');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    toast.classList.toggle('toast-info', type === 'info');
    toast.classList.remove('toast-hidden');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, 3000);
}

function hideToast() {
    var toast = document.getElementById('toast');
    if (toast) toast.classList.add('toast-hidden');
    clearTimeout(_toastTimer);
}

// ── Generic evalScript wrapper ────────────────────────────────────────────────

function run(script, onSuccess) {
    cs.evalScript(script, function(result) {
        if (!result || result === 'undefined') return;
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        if (onSuccess) onSuccess(result);
    });
}

// ── Input helpers ─────────────────────────────────────────────────────────────

function numVal(id, fallback) {
    var v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? (fallback || 0) : v;
}
function selVal(id) {
    var el = document.getElementById(id);
    return el ? parseInt(el.value, 10) : 0;
}
function chkVal(id) {
    var el = document.getElementById(id);
    return (el && el.checked) ? 1 : 0;
}

// ── ALIGN ─────────────────────────────────────────────────────────────────────

function doAlign(idx) {
    var alignToSel = (selVal('alignMode') === 0) ? 1 : 0;
    var margin     = numVal('marginInput');
    var usePct     = selVal('pixelDropdown');
    var offsetKeys = chkVal('offsetCheck');
    run('lineup_align(' + idx + ',' + alignToSel + ',' + margin + ',' + usePct + ',' + offsetKeys + ')');
}

// ── DISTRIBUTE ────────────────────────────────────────────────────────────────

function doDist(horizontal) {
    var mode    = selVal('distMode');
    var spacing = numVal('distInput');
    run('lineup_distribute(' + horizontal + ',' + mode + ',' + spacing + ')');
}

function doDistZ() {
    var mode    = selVal('distMode');
    var spacing = numVal('distInput');
    var zStart  = parseFloat(document.getElementById('zStartInput').value);
    var zEnd    = parseFloat(document.getElementById('zEndInput').value);
    var even    = parseInt(document.getElementById('zEvenInput').value, 10);
    var step    = parseFloat(document.getElementById('zStepInput').value);
    if (isNaN(zStart)) zStart = 0;
    if (isNaN(zEnd))   zEnd   = 1000;
    if (isNaN(even))   even   = 1;
    if (isNaN(step))   step   = 100;
    run('lineup_zDistribute(' + mode + ',' + spacing + ',' + zStart + ',' + zEnd + ',' + even + ',' + step + ')');
}

function doDistPath() {
    var mode    = selVal('distMode');
    var spacing = numVal('distInput');
    var rotate  = chkVal('rotateCheck');
    run('lineup_pathDistribute(' + mode + ',' + spacing + ',' + rotate + ')');
}

function doDistRadial() {
    var mode    = selVal('distMode');
    var spacing = numVal('distInput');
    var radius  = numVal('radialInput', 500);
    var rotate  = chkVal('rotateCheck');
    run('lineup_radialDistribute(' + mode + ',' + spacing + ',' + radius + ',' + rotate + ')');
}

function doDistGrid() {
    var mode = selVal('distMode');
    var cols = parseInt(document.getElementById('gridColsInput').value, 10) || 3;
    var rows = parseInt(document.getElementById('gridRowsInput').value, 10) || 3;
    var alignEdges = chkVal('alignEdgesCheck');
    var hPad = parseFloat(document.getElementById('gridHPadInput').value);
    var vPad = parseFloat(document.getElementById('gridVPadInput').value);
    var hPadArg = isNaN(hPad) ? 'NaN' : hPad;
    var vPadArg = isNaN(vPad) ? 'NaN' : vPad;
    run('lineup_gridDistribute(' + mode + ',' + cols + ',' + rows + ',' + alignEdges + ',' + hPadArg + ',' + vPadArg + ')');
}

// Align Edges has no effect once both axes have a manual Gap override — dim it for clarity.
function _syncAlignEdgesDim() {
    var grp = document.getElementById('alignEdgesGroup');
    if (!grp) return;
    var h = parseFloat(document.getElementById('gridHPadInput').value);
    var v = parseFloat(document.getElementById('gridVPadInput').value);
    grp.classList.toggle('dimmed', !isNaN(h) && !isNaN(v));
}

// ── ANCHOR POINT ──────────────────────────────────────────────────────────────

function doAnchor(loc) {
    var mode = selVal('anchorMode');
    var ignoreMasks = chkVal('ignoreMasksCheck') ? 1 : 0;
    run('lineup_anchorMove(' + loc + ',' + mode + ',' + ignoreMasks + ')');
}

function doAnchorCopy() {
    run('lineup_anchorCopy()', function(result) {
        document.getElementById('anchorDisplay').textContent = result;
        document.getElementById('anchorPasteBtn').disabled = false;
    });
}

function doAnchorPaste() {
    run('lineup_anchorPaste()', function() {
        document.getElementById('anchorDisplay').textContent = '—, —';
        document.getElementById('anchorPasteBtn').disabled = true;
    });
}

function doAnchorClear() {
    run('lineup_anchorClear()', function() {
        document.getElementById('anchorDisplay').textContent = '—, —';
        document.getElementById('anchorPasteBtn').disabled = true;
    });
}

function doCreateNull() {
    run('lineup_createNull()');
}

// ── EASE COPY ─────────────────────────────────────────────────────────────────

function doEaseCopy() {
    run('lineup_easeCopy()', function(result) {
        if (result && result.length > 0) {
            document.getElementById('easeDisplay').textContent = result;
            document.getElementById('easePasteBtn').disabled = false;
            document.getElementById('easeValueBtn').disabled = false;
        }
    });
}

function doEasePaste() {
    run('lineup_easePaste()');
}

function doEaseValuePaste() {
    run('lineup_easeValuePaste()');
}

function doEaseClear() {
    run('lineup_easeClear()', function() {
        document.getElementById('easeDisplay').textContent = '—';
        document.getElementById('easePasteBtn').disabled = true;
        document.getElementById('easeValueBtn').disabled = true;
    });
}

// ── Grid Picker ───────────────────────────────────────────────────────────────

var _gridPicker         = null;
var _gridPickerCells    = null;
var _gridPickerWInput   = null;
var _gridPickerHInput   = null;
var _gridPickerHPadInput = null;
var _gridPickerVPadInput = null;

function _buildGridPicker() {
    var el = document.createElement('div');
    el.className = 'grid-picker';

    // Top row: W/H inputs + confirm button
    var top = document.createElement('div');
    top.className = 'grid-picker-top';

    function gpLbl(txt) {
        var s = document.createElement('span');
        s.className = 'gp-lbl';
        s.textContent = txt;
        return s;
    }
    function gpInput() {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.maxLength = 2;
        return inp;
    }

    var wInput = gpInput(); wInput.value = '3';
    var hInput = gpInput(); hInput.value = '3';
    _gridPickerWInput = wInput;
    _gridPickerHInput = hInput;

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'grid-picker-confirm';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';

    top.appendChild(gpLbl('W'));
    top.appendChild(wInput);
    top.appendChild(gpLbl('×'));
    top.appendChild(gpLbl('H'));
    top.appendChild(hInput);
    top.appendChild(confirmBtn);
    el.appendChild(top);

    // Gap row: small icon + input pairs that mirror the main-panel
    // gridHPadInput/gridVPadInput fields, kept in sync both ways. On its own
    // row below W/H so the top row doesn't get cluttered.
    function gapIcon(horizontal) {
        var NS  = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 20 20');
        svg.setAttribute('fill', 'currentColor');
        svg.setAttribute('class', 'grid-picker-gap-icon');
        svg.innerHTML = horizontal
            ? '<path d="M3,4 L5,4 L5,16 L3,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="M17,4 L15,4 L15,16 L17,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<rect x="9" y="9" width="2" height="2" rx="0.4"/>'
            : '<path d="M4,3 L4,5 L16,5 L16,3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="M4,17 L4,15 L16,15 L16,17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<rect x="9" y="9" width="2" height="2" rx="0.4"/>';
        return svg;
    }

    function gapMirrorInput(mainId) {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'Auto';
        inp.className = 'grid-picker-gap-input';
        inp.addEventListener('input', function() {
            var raw   = inp.value;
            var clean = raw.replace(/[^0-9.\-]/g, '');
            clean = clean.replace(/(?!^)-/g, '');
            var parts = clean.split('.');
            if (parts.length > 2) clean = parts[0] + '.' + parts.slice(1).join('');
            if (clean !== raw) inp.value = clean;
            var mainEl = document.getElementById(mainId);
            if (mainEl) mainEl.value = inp.value;
            _syncAlignEdgesDim();
        });
        inp.addEventListener('mousemove', function(e) { e.stopPropagation(); });
        return inp;
    }

    var hPadInp = gapMirrorInput('gridHPadInput');
    var vPadInp = gapMirrorInput('gridVPadInput');
    _gridPickerHPadInput = hPadInp;
    _gridPickerVPadInput = vPadInp;

    var gapRow = document.createElement('div');
    gapRow.className = 'grid-picker-gap-row';
    gapRow.appendChild(gapIcon(true));
    gapRow.appendChild(hPadInp);
    gapRow.appendChild(gapIcon(false));
    gapRow.appendChild(vPadInp);
    el.appendChild(gapRow);

    // Grid
    var grid = document.createElement('div');
    grid.className = 'grid-picker-grid';
    var cells = [];
    for (var r = 0; r < 10; r++) {
        for (var c = 0; c < 10; c++) {
            var cell = document.createElement('div');
            cell.className = 'grid-picker-cell';
            cell.dataset.c = c;
            cell.dataset.r = r;
            grid.appendChild(cell);
            cells.push(cell);
        }
    }
    _gridPickerCells = cells;
    el.appendChild(grid);

    document.body.appendChild(el);

    // Hover → update highlight + inputs
    grid.addEventListener('mouseover', function(e) {
        var cell = e.target;
        if (!cell.classList.contains('grid-picker-cell')) return;
        _gridPickerHighlight(parseInt(cell.dataset.c, 10), parseInt(cell.dataset.r, 10));
    });

    // Click cell → commit + close
    grid.addEventListener('click', function(e) {
        var cell = e.target;
        if (!cell.classList.contains('grid-picker-cell')) return;
        _commitGridPicker();
    });

    // Manual input edits → update highlight
    function onWHInput() {
        var c = Math.min(9, Math.max(0, (parseInt(wInput.value, 10) || 1) - 1));
        var r = Math.min(9, Math.max(0, (parseInt(hInput.value, 10) || 1) - 1));
        _gridPickerHighlight(c, r, true); // don't overwrite user-typed values
    }
    wInput.addEventListener('input', onWHInput);
    hInput.addEventListener('input', onWHInput);

    // Stop grid-cell mouseover from propagating through inputs
    wInput.addEventListener('mouseover', function(e) { e.stopPropagation(); });
    hInput.addEventListener('mouseover', function(e) { e.stopPropagation(); });

    // Confirm button → commit + close
    confirmBtn.addEventListener('click', _commitGridPicker);

    return el;
}

function _gridPickerHighlight(maxC, maxR, skipInputs) {
    for (var i = 0; i < _gridPickerCells.length; i++) {
        var c = parseInt(_gridPickerCells[i].dataset.c, 10);
        var r = parseInt(_gridPickerCells[i].dataset.r, 10);
        _gridPickerCells[i].classList.toggle('lit', c <= maxC && r <= maxR);
    }
    if (!skipInputs) {
        if (_gridPickerWInput) _gridPickerWInput.value = maxC + 1;
        if (_gridPickerHInput) _gridPickerHInput.value = maxR + 1;
    }
}

function _commitGridPicker() {
    var cols = Math.max(1, parseInt(_gridPickerWInput.value, 10) || 1);
    var rows = Math.max(1, parseInt(_gridPickerHInput.value, 10) || 1);
    document.getElementById('gridColsInput').value = cols;
    document.getElementById('gridRowsInput').value = rows;
    _closeGridPicker();
}

function _openGridPicker(x, y) {
    if (!_gridPicker) _gridPicker = _buildGridPicker();

    var rawCols = parseInt(document.getElementById('gridColsInput').value, 10) || 3;
    var rawRows = parseInt(document.getElementById('gridRowsInput').value, 10) || 3;
    _gridPickerHighlight(Math.min(9, rawCols - 1), Math.min(9, rawRows - 1), true);
    _gridPickerWInput.value = rawCols;
    _gridPickerHInput.value = rawRows;

    var mainH = document.getElementById('gridHPadInput');
    var mainV = document.getElementById('gridVPadInput');
    if (_gridPickerHPadInput) _gridPickerHPadInput.value = mainH ? mainH.value : '';
    if (_gridPickerVPadInput) _gridPickerVPadInput.value = mainV ? mainV.value : '';

    // Position near cursor, clamp inside viewport
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = 190, ph = 214;
    _gridPicker.style.left = Math.min(x + 4, vw - pw - 4) + 'px';
    _gridPicker.style.top  = Math.min(y + 4, vh - ph - 4) + 'px';

    _gridPicker.classList.add('visible');
    _syncAlignEdgesDim();

    setTimeout(function() {
        document.addEventListener('mousedown', _gridPickerOutside);
        document.addEventListener('keydown',   _gridPickerKey);
    }, 0);
}

function _closeGridPicker() {
    if (_gridPicker) _gridPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _gridPickerOutside);
    document.removeEventListener('keydown',   _gridPickerKey);
}

function _gridPickerOutside(e) {
    if (_gridPicker && !_gridPicker.contains(e.target)) _closeGridPicker();
}

function _gridPickerKey(e) {
    if (e.key === 'Escape') _closeGridPicker();
}

// ── Radial Picker ─────────────────────────────────────────────────────────────

var RADIAL_PW = 176, RADIAL_PH = 108;

var _radialPicker    = null;
var _rpCompW         = 1920, _rpCompH = 1080;
var _rpScale         = RADIAL_PH / 1080;
var _rpCompLeft      = 0,    _rpCompTop = 0;
var _rpCx            = RADIAL_PW / 2, _rpCy = RADIAL_PH / 2;
var _rpRadius        = 500;
var _rpRadiusInput   = null;
var _rpCircle        = null;
var _rpCenterDot     = null;
var _rpCompBg        = null;

function _buildRadialPicker() {
    var el = document.createElement('div');
    el.className = 'radial-picker';

    var top = document.createElement('div');
    top.className = 'radial-picker-top';

    function rpLbl(txt) {
        var s = document.createElement('span');
        s.className = 'gp-lbl';
        s.textContent = txt;
        return s;
    }

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = '500';
    _rpRadiusInput = inp;

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'grid-picker-confirm';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';

    top.appendChild(rpLbl('Radius'));
    top.appendChild(inp);
    top.appendChild(rpLbl('px'));
    top.appendChild(confirmBtn);
    el.appendChild(top);

    var preview = document.createElement('div');
    preview.className = 'radial-preview';

    var compBg = document.createElement('div');
    compBg.className = 'radial-comp-bg';
    _rpCompBg = compBg;
    preview.appendChild(compBg);

    var NS  = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + RADIAL_PW + ' ' + RADIAL_PH);
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';

    var ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('fill', 'rgba(36,112,224,0.08)');
    ring.setAttribute('stroke', '#2470e0');
    ring.setAttribute('stroke-width', '2');
    _rpCircle = ring;
    svg.appendChild(ring);

    var dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', '2');
    dot.setAttribute('fill', 'rgba(36,112,224,0.55)');
    _rpCenterDot = dot;
    svg.appendChild(dot);

    preview.appendChild(svg);
    el.appendChild(preview);
    document.body.appendChild(el);

    preview.addEventListener('mousemove', function(e) {
        var rect = preview.getBoundingClientRect();
        var dx = e.clientX - rect.left - _rpCx;
        var dy = e.clientY - rect.top  - _rpCy;
        _rpRadius = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy) / _rpScale));
        _rpUpdateVisual();
    });

    preview.addEventListener('click', _commitRadialPicker);

    inp.addEventListener('input', function() {
        var r = parseFloat(inp.value);
        if (!isNaN(r) && r > 0) {
            _rpRadius = r;
            _rpUpdateCircle();
        }
    });
    inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') _commitRadialPicker();
    });
    inp.addEventListener('mousemove', function(e) { e.stopPropagation(); });

    confirmBtn.addEventListener('click', _commitRadialPicker);

    return el;
}

function _rpUpdateCircle() {
    if (!_rpCircle) return;
    _rpCircle.setAttribute('cx', _rpCx);
    _rpCircle.setAttribute('cy', _rpCy);
    _rpCircle.setAttribute('r', Math.max(1, _rpRadius * _rpScale));
    if (_rpCenterDot) {
        _rpCenterDot.setAttribute('cx', _rpCx);
        _rpCenterDot.setAttribute('cy', _rpCy);
    }
}

function _rpUpdateVisual() {
    if (_rpRadiusInput && document.activeElement !== _rpRadiusInput) {
        _rpRadiusInput.value = _rpRadius;
    }
    _rpUpdateCircle();
}

function _rpUpdateAspect() {
    _rpScale     = Math.min(RADIAL_PW / _rpCompW, RADIAL_PH / _rpCompH);
    var rw       = _rpCompW * _rpScale;
    var rh       = _rpCompH * _rpScale;
    _rpCompLeft  = (RADIAL_PW - rw) / 2;
    _rpCompTop   = (RADIAL_PH - rh) / 2;
    _rpCx        = _rpCompLeft + rw / 2;
    _rpCy        = _rpCompTop  + rh / 2;
    if (_rpCompBg) {
        _rpCompBg.style.left   = _rpCompLeft + 'px';
        _rpCompBg.style.top    = _rpCompTop  + 'px';
        _rpCompBg.style.width  = rw + 'px';
        _rpCompBg.style.height = rh + 'px';
    }
}

function _openRadialPicker(x, y) {
    cs.evalScript('lineup_getCompSize()', function(result) {
        var w = 1920, h = 1080;
        if (result && result !== 'undefined' && result.indexOf(',') > 0) {
            var parts = result.split(',');
            var pw2 = parseInt(parts[0], 10);
            var ph2 = parseInt(parts[1], 10);
            if (pw2 > 0 && ph2 > 0) { w = pw2; h = ph2; }
        }
        _rpCompW = w; _rpCompH = h;

        if (!_radialPicker) _radialPicker = _buildRadialPicker();

        _rpUpdateAspect();
        _rpRadius = Math.max(1, parseFloat(document.getElementById('radialInput').value) || 500);
        _rpUpdateVisual();

        var vw = window.innerWidth, vh = window.innerHeight;
        var popW = 192, popH = 149;
        _radialPicker.style.left = Math.min(x + 4, vw - popW - 4) + 'px';
        _radialPicker.style.top  = Math.min(y + 4, vh - popH - 4) + 'px';
        _radialPicker.classList.add('visible');

        setTimeout(function() {
            document.addEventListener('mousedown', _radialPickerOutside);
            document.addEventListener('keydown',   _radialPickerKey);
        }, 0);
    });
}

function _closeRadialPicker() {
    if (_radialPicker) _radialPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _radialPickerOutside);
    document.removeEventListener('keydown',   _radialPickerKey);
}

function _radialPickerOutside(e) {
    if (_radialPicker && !_radialPicker.contains(e.target)) _closeRadialPicker();
}

function _radialPickerKey(e) {
    if (e.key === 'Escape') _closeRadialPicker();
}

function _commitRadialPicker() {
    var r = Math.max(1, parseFloat(_rpRadiusInput.value) || 1);
    document.getElementById('radialInput').value = r;
    _closeRadialPicker();
}

// ── Z-Depth Picker ────────────────────────────────────────────────────────────

var Z_MAX_VIS = 5000;
var Z_LOG_EXP = 2.32;  // pos=0.5 → dist≈1000

var _zPicker         = null;
var _zpStart         = 0;
var _zpEnd           = 1000;
var _zpEven          = true;
var _zpStep          = 100;
var _zpStartInput    = null;
var _zpEndInput      = null;
var _zpCustomStepCb  = null;
var _zpStepInput     = null;
var _zpLineEl        = null;
var _zpCamIcon       = null;
var _zpWash          = null;
var _zpHandle        = null;
var _zpDotCont       = null;
var _zpTrackEl       = null;

function _zpDistToPos(dist) {
    if (dist <= 0) return 0;
    return Math.pow(Math.min(dist, Z_MAX_VIS) / Z_MAX_VIS, 1 / Z_LOG_EXP);
}

function _zpPosToDist(pos) {
    return Z_MAX_VIS * Math.pow(Math.max(0, Math.min(1, pos)), Z_LOG_EXP);
}

function _buildZPicker() {
    var el = document.createElement('div');
    el.className = 'z-picker';

    // Input row: Start [input]  spacer  End [input] [✓]
    var inputsRow = document.createElement('div');
    inputsRow.className = 'z-picker-inputs';

    function zpLbl(txt) {
        var s = document.createElement('span');
        s.className = 'gp-lbl';
        s.textContent = txt;
        return s;
    }

    var startInp = document.createElement('input');
    startInp.type = 'text';
    startInp.value = '0';
    _zpStartInput = startInp;

    var endInp = document.createElement('input');
    endInp.type = 'text';
    endInp.value = '1000';
    _zpEndInput = endInp;

    var spacer = document.createElement('span');
    spacer.className = 'z-spacer';

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'grid-picker-confirm';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';

    inputsRow.appendChild(zpLbl('Start'));
    inputsRow.appendChild(startInp);
    inputsRow.appendChild(spacer);
    inputsRow.appendChild(zpLbl('End'));
    inputsRow.appendChild(endInp);
    inputsRow.appendChild(confirmBtn);
    el.appendChild(inputsRow);

    // Depth line row: track with camera icon floating on it at Z=0 position
    var depthRow = document.createElement('div');
    depthRow.className = 'z-picker-depth';

    var track = document.createElement('div');
    track.className = 'z-track';
    _zpTrackEl = track;

    var lineEl = document.createElement('div');
    lineEl.className = 'z-track-line';
    _zpLineEl = lineEl;
    track.appendChild(lineEl);

    var wash = document.createElement('div');
    wash.className = 'z-track-wash';
    _zpWash = wash;
    track.appendChild(wash);

    var dotCont = document.createElement('div');
    dotCont.className = 'z-track-dots';
    _zpDotCont = dotCont;
    track.appendChild(dotCont);

    // Camera icon lives on the line at the position of Z=0
    var camIcon = document.createElement('div');
    camIcon.className = 'z-cam-icon';
    camIcon.innerHTML = '<svg viewBox="0 0 14 14" width="18" height="18" fill="#1e1e1e" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><rect x="1" y="4" width="8" height="6" rx="1"/><polygon points="9,5.5 13,3.5 13,10.5 9,8.5"/></svg>';
    _zpCamIcon = camIcon;
    track.appendChild(camIcon);

    var handle = document.createElement('div');
    handle.className = 'z-track-handle';
    _zpHandle = handle;
    track.appendChild(handle);

    depthRow.appendChild(track);
    el.appendChild(depthRow);

    // Footer: Custom Step toggle + step input
    var footer = document.createElement('div');
    footer.className = 'z-picker-footer';

    var stepCbLabel = document.createElement('label');
    stepCbLabel.className = 'check-label';
    var stepCb = document.createElement('input');
    stepCb.type = 'checkbox';
    stepCb.checked = false;
    _zpCustomStepCb = stepCb;
    stepCbLabel.appendChild(stepCb);
    stepCbLabel.appendChild(document.createTextNode(' Step'));

    var stepInp = document.createElement('input');
    stepInp.type = 'text';
    stepInp.value = '100';
    stepInp.className = 'z-step-input';
    stepInp.disabled = true;
    _zpStepInput = stepInp;

    footer.appendChild(stepCbLabel);
    footer.appendChild(stepInp);
    el.appendChild(footer);

    stepCb.addEventListener('change', function() {
        _zpEven = !stepCb.checked;
        stepInp.disabled = !stepCb.checked;
        _zpUpdateVisual();
    });

    stepInp.addEventListener('input', function() {
        var v = parseFloat(stepInp.value);
        if (!isNaN(v) && v > 0) { _zpStep = v; _zpUpdateVisual(); }
    });
    stepInp.addEventListener('mousemove', function(e) { e.stopPropagation(); });

    document.body.appendChild(el);

    // Track: drag moves handle only; confirm button commits
    track.addEventListener('mousedown', function(e) {
        e.preventDefault();
        _zpOnTrackDrag(e);
        function onMove(e2) { _zpOnTrackDrag(e2); }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // Input handlers update pending state only (not hidden inputs)
    startInp.addEventListener('input', function() {
        var v = parseFloat(startInp.value);
        if (!isNaN(v)) {
            _zpStart = v;
            if (_zpStart > _zpEnd) { _zpEnd = _zpStart; endInp.value = _zpEnd; }
            _zpUpdateVisual();
        }
    });
    endInp.addEventListener('input', function() {
        var v = parseFloat(endInp.value);
        if (!isNaN(v)) {
            _zpEnd = v;
            if (_zpEnd < _zpStart) { _zpEnd = _zpStart; endInp.value = _zpEnd; }
            _zpUpdateVisual();
        }
    });

    // Confirm button commits and closes
    confirmBtn.addEventListener('click', _zpCommit);

    startInp.addEventListener('mousemove', function(e) { e.stopPropagation(); });
    endInp.addEventListener('mousemove',   function(e) { e.stopPropagation(); });

    return el;
}

function _zpOnTrackDrag(e) {
    if (!_zpTrackEl) return;
    var rect = _zpTrackEl.getBoundingClientRect();
    var pos  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    _zpEnd   = Math.round(_zpStart + _zpPosToDist(pos));
    _zpUpdateVisual();
}

function _zpUpdateVisual() {
    var dist = Math.max(0, _zpEnd - _zpStart);
    var pct  = _zpDistToPos(dist) * 100;
    if (_zpWash)   _zpWash.style.width  = pct + '%';
    if (_zpHandle) _zpHandle.style.left = pct + '%';

    // Camera at the Z=0 linear position within [start, end]
    if (_zpCamIcon) {
        var range = _zpEnd - _zpStart;
        var camFrac;
        if (range <= 0) {
            camFrac = _zpStart >= 0 ? 0 : 1;
        } else {
            camFrac = Math.max(0, Math.min(1, (0 - _zpStart) / range));
        }
        _zpCamIcon.style.left = (camFrac * 100) + '%';
    }

    // Step dots — linearly scaled between left edge and handle position
    if (_zpDotCont) {
        _zpDotCont.innerHTML = '';
        if (!_zpEven && _zpStep > 0 && dist > 0) {
            var numSlots = Math.floor(dist / _zpStep) + 1;
            var cap = Math.min(numSlots, 80);
            for (var d = 0; d < cap; d++) {
                var posInRange = d * _zpStep;
                if (posInRange > dist) break;
                var dot = document.createElement('div');
                dot.className = 'z-track-dot';
                dot.style.left = (posInRange / dist * pct) + '%';
                _zpDotCont.appendChild(dot);
            }
        }
    }

    if (_zpStartInput && document.activeElement !== _zpStartInput) _zpStartInput.value = _zpStart;
    if (_zpEndInput   && document.activeElement !== _zpEndInput)   _zpEndInput.value   = _zpEnd;
}

function _zpCommit() {
    var hs = document.getElementById('zStartInput');
    var he = document.getElementById('zEndInput');
    var hev = document.getElementById('zEvenInput');
    var hst = document.getElementById('zStepInput');
    if (hs)  hs.value  = _zpStart;
    if (he)  he.value  = _zpEnd;
    if (hev) hev.value = _zpEven ? '1' : '0';
    if (hst) hst.value = _zpStep;
    _closeZPicker();
}

function _openZPicker(x, y) {
    if (!_zPicker) _zPicker = _buildZPicker();

    var hs  = document.getElementById('zStartInput');
    var he  = document.getElementById('zEndInput');
    var hev = document.getElementById('zEvenInput');
    var hst = document.getElementById('zStepInput');
    _zpStart = hs  ? (parseFloat(hs.value)  || 0)    : 0;
    _zpEnd   = he  ? (parseFloat(he.value)  || 1000) : 1000;
    _zpEven  = hev ? (hev.value !== '0')              : true;
    _zpStep  = hst ? (parseFloat(hst.value) || 100)  : 100;

    if (_zpCustomStepCb) _zpCustomStepCb.checked = !_zpEven;
    if (_zpStepInput)    { _zpStepInput.value = _zpStep; _zpStepInput.disabled = _zpEven; }

    _zpUpdateVisual();

    var vw = window.innerWidth, vh = window.innerHeight;
    var popW = 196, popH = 90;
    _zPicker.style.left = Math.min(x + 4, vw - popW - 4) + 'px';
    _zPicker.style.top  = Math.min(y + 4, vh - popH - 4) + 'px';
    _zPicker.classList.add('visible');

    setTimeout(function() {
        document.addEventListener('mousedown', _zPickerOutside);
        document.addEventListener('keydown',   _zPickerKey);
    }, 0);
}

function _closeZPicker() {
    if (_zPicker) _zPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _zPickerOutside);
    document.removeEventListener('keydown',   _zPickerKey);
}

function _zPickerOutside(e) {
    if (_zPicker && !_zPicker.contains(e.target)) _closeZPicker();
}

function _zPickerKey(e) {
    if (e.key === 'Escape') _closeZPicker();
}

// ── LAYER SORT ────────────────────────────────────────────────────────────────

function doSort() {
    var propIdx   = selVal('sortProp');
    var axisIdx   = selVal('sortAxis');
    var descend   = document.getElementById('sortDirCheck').checked ? 0 : 1;
    var groupNull = chkVal('sortGroup');
    run('lineup_sortLayers(' + propIdx + ',' + axisIdx + ',' + descend + ',' + groupNull + ')');
}

function setSortProp(val) {
    document.getElementById('sortProp').value = val;
    var btns = document.querySelectorAll('#sortPropSeg .seg-btn');
    btns.forEach(function(btn, i) { btn.classList.toggle('active', i === val); });
    document.getElementById('segSlider').style.transform = 'translateX(' + (val * 100) + '%)';
    syncSortAxis();
}

function syncSortAxis() {
    var axisEl = document.getElementById('sortAxis');
    if (axisEl) axisEl.disabled = (selVal('sortProp') !== 0);
}

// ── AUTO CROP ─────────────────────────────────────────────────────────────────

function doAutoCrop() {
    var pad    = numVal('autoCropPad');
    var expand = chkVal('autoCropExpand');
    run('lineup_autoCrop(' + pad + ',' + expand + ')');
}

function doCropMaxArea() {
    var pad    = numVal('autoCropPad');
    var expand = chkVal('autoCropExpand');
    run('lineup_cropMaxArea(' + pad + ',' + expand + ')');
}

function doMaskCrop() {
    var pad    = numVal('autoCropPad');
    var expand = chkVal('autoCropExpand');
    run('lineup_maskCrop(' + pad + ',' + expand + ')');
}

// ── ORGANIZE ──────────────────────────────────────────────────────────────────

function doDecompose() {
    run('lineup_decompose()');
}

function doDuplicateCompDeep() {
    run('lineup_duplicateCompDeep()', function(result) {
        showToast(result, 'info');
    });
}

function doConsolidateProject() {
    run('lineup_organizeProject()', function(result) {
        showToast(result, 'info');
    });
}

// ── SHAPE RIGS ────────────────────────────────────────────────────────────────

function doRig()       { run('lineup_rig()'); }
function doDerig()     { run('lineup_derig()'); }
function doRecalcRig() { run('lineup_recalcRig()'); }

// ── Panel scale ───────────────────────────────────────────────────────────────

var SCALE_FACTORS = [0.85, 1.0, 1.15];

function applyScale(val) {
    var f = SCALE_FACTORS[Math.max(0, Math.min(2, val))];
    var content = document.getElementById('panel-content');
    if (content) content.style.zoom = (f === 1.0) ? '' : String(f);

    // Overlay modals (Settings, Help, Batch Comp Settings, Batch Rename, Comp
    // Export) live outside #panel-content, so the zoom above doesn't reach them.
    // Scale each one with a CSS transform instead — transform doesn't affect
    // layout/spacing, just visually scales the box from its own center (the
    // overlay already centers it via flexbox).
    var scaleStr = (f === 1.0) ? '' : 'scale(' + f + ')';
    document.querySelectorAll('.settings-modal').forEach(function (m) {
        m.style.transform = scaleStr;
    });
}

function restoreScale() {
    var val = 1;
    try { var s = localStorage.getItem('lineup-scale'); if (s !== null) val = parseInt(s, 10); } catch(e) {}
    if (isNaN(val) || val < 0 || val > 2) val = 1;
    var slider = document.getElementById('scaleSlider');
    if (slider) slider.value = val;
    applyScale(val);
}

// ── Settings persistence ──────────────────────────────────────────────────────

function saveSettings() {
    var panel    = document.querySelector('.panel');
    var sections = panel.querySelectorAll('.section');
    var order      = [];
    var visibility = {};
    sections.forEach(function(s) {
        if (!s.id) return;
        order.push(s.id);
        visibility[s.id] = !s.classList.contains('sec-hidden');
    });
    try {
        localStorage.setItem('lineup-order',      JSON.stringify(order));
        localStorage.setItem('lineup-visibility', JSON.stringify(visibility));
    } catch(e) {}
}

function restoreSettings() {
    var order, visibility;
    try {
        order      = JSON.parse(localStorage.getItem('lineup-order'));
        visibility = JSON.parse(localStorage.getItem('lineup-visibility'));
    } catch(e) {}

    if (order && Array.isArray(order) && order.length > 0) {
        var content = document.getElementById('panel-content');
        order.forEach(function(id) {
            var el = document.getElementById(id);
            if (el && el.classList.contains('section')) content.appendChild(el);
        });
    }

    if (visibility && typeof visibility === 'object') {
        Object.keys(visibility).forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.classList.toggle('sec-hidden', !visibility[id]);
        });
    }
}

// ── Settings modal ────────────────────────────────────────────────────────────

function openSettings() {
    var list     = document.getElementById('settingsSectionList');
    var panel    = document.querySelector('.panel');
    var sections = panel.querySelectorAll('.section');

    list.innerHTML = '';
    sections.forEach(function(sec) {
        var row = buildSettingsRow(sec);
        if (row) list.appendChild(row);
    });

    initSettingsDrag();
    document.getElementById('settingsOverlay').classList.remove('settings-hidden');
}

function closeSettings() {
    document.getElementById('settingsOverlay').classList.add('settings-hidden');
    saveSettings();
}

function openHelp() {
    document.getElementById('helpOverlay').classList.remove('help-hidden');
}

function closeHelp() {
    document.getElementById('helpOverlay').classList.add('help-hidden');
}

function toggleHelpSection(hdr) {
    hdr.parentElement.classList.toggle('collapsed');
}

function buildSettingsRow(secEl) {
    var nameEl = secEl.querySelector('.sec-title');
    var iconEl = secEl.querySelector('.sec-icon');
    if (!nameEl || !iconEl) return null;

    var row = document.createElement('div');
    row.className = 'settings-sec-row';
    row.dataset.secId = secEl.id;

    // Drag handle — no draggable attr; mouse events handle everything
    var handle = document.createElement('span');
    handle.className = 'settings-drag-handle';
    handle.innerHTML = '<svg viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="1.5" r="1"/><circle cx="6" cy="1.5" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10.5" r="1"/><circle cx="6" cy="10.5" r="1"/></svg>';

    // Icon — clone from section header, swap CSS class for larger size
    var iconClone = iconEl.cloneNode(true);
    iconClone.classList.remove('sec-icon');
    iconClone.classList.add('settings-sec-icon');

    // Name
    var name = document.createElement('span');
    name.className = 'settings-sec-name';
    name.textContent = nameEl.textContent;

    // Toggle
    var label = document.createElement('label');
    label.className = 'settings-toggle';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !secEl.classList.contains('sec-hidden');
    var track = document.createElement('span');
    track.className = 'toggle-track';
    label.appendChild(cb);
    label.appendChild(track);

    if (!cb.checked) row.classList.add('row-disabled');

    cb.addEventListener('change', function() {
        document.getElementById(secEl.id).classList.toggle('sec-hidden', !cb.checked);
        row.classList.toggle('row-disabled', !cb.checked);
    });

    row.appendChild(handle);
    row.appendChild(iconClone);
    row.appendChild(name);
    row.appendChild(label);
    return row;
}

function applySettingsOrder() {
    var list    = document.getElementById('settingsSectionList');
    var rows    = list.querySelectorAll('.settings-sec-row');
    var content = document.getElementById('panel-content');
    rows.forEach(function(row) {
        var sec = document.getElementById(row.dataset.secId);
        if (sec) content.appendChild(sec);
    });
}

function initSettingsDrag() {
    var list = document.getElementById('settingsSectionList');

    list.querySelectorAll('.settings-drag-handle').forEach(function(handle) {
        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();

            var row = handle.closest('.settings-sec-row');
            if (!row) return;

            var rowEls    = Array.from(list.querySelectorAll('.settings-sec-row'));
            var dragIdx   = rowEls.indexOf(row);
            var origRects = rowEls.map(function(r) { return r.getBoundingClientRect(); });
            var rowH      = origRects[dragIdx].height;
            var shiftAmt  = rowH + 4; // 4px matches CSS gap

            // Ghost — full row clone, X-locked, floats with cursor
            var rect  = origRects[dragIdx];
            var ghost = row.cloneNode(true);
            ghost.className = 'settings-sec-row settings-drag-ghost';
            ghost.style.cssText = [
                'position:fixed',
                'left:' + rect.left + 'px',
                'top:'  + rect.top  + 'px',
                'width:' + rect.width + 'px',
                'pointer-events:none',
                'z-index:2000'
            ].join(';');
            document.body.appendChild(ghost);

            // Hide original row in place (keeps layout slot)
            row.style.visibility = 'hidden';

            var startY    = e.clientY;
            var originTop = rect.top;

            // Given ghost center Y, return the DOM index to insert the row before
            function getInsertIdx(ghostCenterY) {
                var above = 0;
                for (var i = 0; i < rowEls.length; i++) {
                    if (i === dragIdx) continue;
                    if (ghostCenterY > origRects[i].top + origRects[i].height / 2) above++;
                }
                var c = 0;
                for (var i = 0; i < rowEls.length; i++) {
                    if (i === dragIdx) continue;
                    if (c++ === above) return i;
                }
                return rowEls.length;
            }

            // Slide other rows out of the way to show the live insertion point
            function applyShifts(insertIdx) {
                rowEls.forEach(function(r, i) {
                    if (i === dragIdx) return;
                    var dy = 0;
                    if (insertIdx > dragIdx  && i > dragIdx  && i < insertIdx) dy = -shiftAmt;
                    if (insertIdx <= dragIdx && i >= insertIdx && i < dragIdx)  dy =  shiftAmt;
                    r.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
                });
            }

            function onMove(ev) {
                var top = originTop + ev.clientY - startY;
                ghost.style.top = top + 'px';
                applyShifts(getInsertIdx(top + rowH / 2));
            }

            function onUp(ev) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                ghost.remove();

                var finalIdx = getInsertIdx(originTop + ev.clientY - startY + rowH / 2);

                // Instantly clear transforms before DOM reorder to avoid visual jump
                rowEls.forEach(function(r) { r.style.transition = 'none'; r.style.transform = ''; });
                void list.offsetHeight; // force reflow
                rowEls.forEach(function(r) { r.style.transition = ''; });

                row.style.visibility = '';

                if (finalIdx >= rowEls.length) {
                    list.appendChild(row);
                } else {
                    list.insertBefore(row, rowEls[finalIdx]);
                }
                applySettingsOrder();
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}

// ── Batch Comp Settings ─────────────────────────────────────────────────────────

var BCS_PAR_PRESETS = [1.0, 0.9090909090909091, 1.2121212121212122, 1.0936, 1.4581, 2.0];

var _bcsLocked      = true;
var _bcsLockedRatio = 1;
var _bcsWidthScrub  = null;
var _bcsHeightScrub = null;
var _bcsDurField    = null;
var _bcsStartField  = null;
var _bcsDirty       = false;
var _bcsCompNames   = []; // every comp selected when the panel was opened
var _bcsExcluded    = {}; // index (into _bcsCompNames) -> true, removed from the batch

function _bcsParIndexForValue(v) {
    var best = 0, bestDiff = Infinity;
    for (var i = 0; i < BCS_PAR_PRESETS.length; i++) {
        var diff = Math.abs(BCS_PAR_PRESETS[i] - v);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
}

function _bcsCurrentFrameRate() {
    var f = parseFloat(document.getElementById('bcsFrInput').value);
    return (!isNaN(f) && f > 0) ? f : 30;
}

function _bcsFormatSeconds(sec) {
    return String(Math.round(sec * 100) / 100);
}

// Seconds ⟷ Frames field — canonical value is always seconds, converted through
// the Frame Rate field when the unit is switched to Frames.
function _bcsMakeSecondsField(inputId, unitId) {
    var input   = document.getElementById(inputId);
    var unitSel = document.getElementById(unitId);
    var prevMode = unitSel.value;

    function render(seconds) {
        input.value = (unitSel.value === '1')
            ? String(Math.round(seconds * _bcsCurrentFrameRate()))
            : _bcsFormatSeconds(seconds);
    }
    function getSeconds() {
        var v = parseFloat(input.value);
        if (isNaN(v)) return NaN;
        return (unitSel.value === '1') ? v / _bcsCurrentFrameRate() : v;
    }
    unitSel.addEventListener('change', function () {
        var seconds = (prevMode === '1')
            ? (function () { var f = parseFloat(input.value); return isNaN(f) ? 0 : f / _bcsCurrentFrameRate(); })()
            : (parseFloat(input.value) || 0);
        prevMode = unitSel.value;
        render(seconds);
    });
    return { render: render, getSeconds: getSeconds };
}

// Scrubbable number field, mimicking After Effects' blue scrub fields: click-drag
// left/right to change the value, or click without dragging to type an exact one.
function _bcsMakeScrub(el, opts) {
    opts = opts || {};
    var min      = (opts.min !== undefined) ? opts.min : 1;
    var onChange = opts.onChange || function () {};
    var dragging = false, moved = false, startX = 0, startVal = 0;

    function get() { var v = parseInt(el.textContent, 10); return isNaN(v) ? min : v; }
    function set(v, silent) {
        v = Math.max(min, Math.round(v));
        el.textContent = String(v);
        if (!silent) onChange(v);
        return v;
    }

    el.addEventListener('mousedown', function (e) {
        if (el.classList.contains('editing')) return;
        dragging = true; moved = false;
        startX   = e.clientX;
        startVal = get();
        el.classList.add('scrubbing');
        e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var dx = e.clientX - startX;
        if (Math.abs(dx) > 2) moved = true;
        if (!moved) return;
        var mult = e.shiftKey ? 10 : 1;
        set(startVal + Math.round(dx * mult));
    });

    window.addEventListener('mouseup', function () {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('scrubbing');
        if (!moved) _bcsEnterEdit(el, get, set);
    });

    set(get(), true);
    return { get: get, set: set };
}

function _bcsEnterEdit(el, get, set) {
    el.classList.add('editing');
    var current = get();
    el.textContent = '';
    var input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    el.appendChild(input);
    input.focus();
    input.select();

    function commit() {
        var v = parseFloat(input.value);
        el.classList.remove('editing');
        set(isNaN(v) ? current : v);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') input.blur();
        else if (e.key === 'Escape') { input.value = current; input.blur(); }
        e.stopPropagation();
    });
}

function _bcsBindEnable(checkId, ids) {
    var chk = document.getElementById(checkId);
    function sync() {
        ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.disabled = !chk.checked;
        });
    }
    chk.addEventListener('change', sync);
    sync();
}

function _bcsBindRowEnable(checkId, rowEl) {
    var chk = document.getElementById(checkId);
    function sync() { rowEl.classList.toggle('dimmed', !chk.checked); }
    chk.addEventListener('change', sync);
    sync();
}

function _bcsOnWidthChange(w) {
    if (_bcsLocked) _bcsHeightScrub.set(Math.round(w / _bcsLockedRatio), true);
    _bcsUpdateLockTip();
    _bcsMarkDirty();
}
function _bcsOnHeightChange(h) {
    if (_bcsLocked) _bcsWidthScrub.set(Math.round(h * _bcsLockedRatio), true);
    _bcsUpdateLockTip();
    _bcsMarkDirty();
}

function _bcsUpdateLockTip() {
    var w = _bcsWidthScrub.get(), h = _bcsHeightScrub.get();
    var ratio = (h > 0) ? (Math.max(w, h) / Math.min(w, h)) : 1;
    document.getElementById('bcsLockBtn').title = 'Lock Aspect Ratio (1:' + ratio.toFixed(3) + ')';
}

function toggleBcsLock() {
    _bcsLocked = !_bcsLocked;
    if (_bcsLocked) _bcsLockedRatio = _bcsWidthScrub.get() / _bcsHeightScrub.get();
    document.getElementById('bcsLockBtn').classList.toggle('locked', _bcsLocked);
    _bcsUpdateLockTip();
}

// Apply lights up blue the moment anything in the panel is touched.
function _bcsMarkDirty() {
    if (_bcsDirty) return;
    _bcsDirty = true;
    var btn = document.getElementById('bcsApplyBtn');
    if (btn) btn.classList.add('dirty');
}
function _bcsClearDirty() {
    _bcsDirty = false;
    var btn = document.getElementById('bcsApplyBtn');
    if (btn) btn.classList.remove('dirty');
}

function _bcsInit() {
    _bcsWidthScrub  = _bcsMakeScrub(document.getElementById('bcsWidthScrub'),  { min: 1, onChange: _bcsOnWidthChange });
    _bcsHeightScrub = _bcsMakeScrub(document.getElementById('bcsHeightScrub'), { min: 1, onChange: _bcsOnHeightChange });
    _bcsDurField    = _bcsMakeSecondsField('bcsDurInput',   'bcsDurUnit');
    _bcsStartField  = _bcsMakeSecondsField('bcsStartInput', 'bcsStartUnit');

    _bcsBindEnable('bcsParCheck',   ['bcsParSelect']);
    _bcsBindEnable('bcsFrCheck',    ['bcsFrInput']);
    _bcsBindEnable('bcsResCheck',   ['bcsResSelect']);
    _bcsBindEnable('bcsDurCheck',   ['bcsDurInput', 'bcsDurUnit']);
    _bcsBindEnable('bcsStartCheck', ['bcsStartInput', 'bcsStartUnit']);
    _bcsBindRowEnable('bcsDimsCheck', document.getElementById('bcsDimsControls'));
    _bcsBindRowEnable('bcsFrCheck',   document.getElementById('bcsSnapRow'));

    // Delegated dirty-tracking for every native control in the panel — the scrub
    // fields are custom (no native events while dragging) so they call
    // _bcsMarkDirty() directly from their onChange callbacks above instead.
    var overlay = document.getElementById('bcsOverlay');
    overlay.addEventListener('input',  _bcsMarkDirty);
    overlay.addEventListener('change', _bcsMarkDirty);

    _bcsUpdateLockTip();
}

// Renders from _bcsCompNames / _bcsExcluded — each row has a remove button that
// excludes that comp from the batch without touching the actual Project panel
// selection. Re-run after every removal to refresh the list and empty state.
function _bcsRenderCompList() {
    var list = document.getElementById('bcsCompList');
    list.innerHTML = '';
    var shown = 0;
    for (var i = 0; i < _bcsCompNames.length; i++) {
        if (_bcsExcluded[i]) continue;
        shown++;
        var row = document.createElement('div');
        row.className = 'bcs-comp-row';
        row.innerHTML =
            '<svg viewBox="0 0 14 10" fill="currentColor"><rect x="0.5" y="0.5" width="13" height="9" rx="1.3" fill="none" stroke="currentColor" stroke-width="1"/></svg>' +
            '<span></span>' +
            '<button class="bcs-comp-remove" title="Remove from batch">' +
                '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>' +
            '</button>';
        row.querySelector('span').textContent = _bcsCompNames[i];
        row.querySelector('.bcs-comp-remove').addEventListener('click', (function (idx) {
            return function () {
                _bcsExcluded[idx] = true;
                _bcsMarkDirty();
                _bcsRenderCompList();
            };
        })(i));
        list.appendChild(row);
    }
    if (shown === 0) {
        var empty = document.createElement('div');
        empty.className = 'bcs-complist-empty';
        empty.id = 'bcsCompEmpty';
        empty.textContent = 'No comp selected';
        list.appendChild(empty);
    }
}

function openBatchCompSettings() {
    cs.evalScript('lineup_getBatchCompSettingsSeed()', function (result) {
        if (!result || result === 'undefined') {
            // No live ExtendScript bridge — e.g. previewing index.html directly in a
            // browser via Live Server. Fall back to mock data (no comps selected) so
            // the panel can still be opened and tested visually.
            result = '0,1920,1080,1,30,1,5,0|';
        }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        var bar   = result.split('|');
        var p     = bar[0].split(',');
        var names = bar.slice(1).filter(function (n) { return n.length > 0; });

        var width  = parseInt(p[1], 10) || 1920;
        var height = parseInt(p[2], 10) || 1080;
        var par    = parseFloat(p[3])   || 1;
        var fr     = parseFloat(p[4])   || 30;
        var res    = parseInt(p[5], 10) || 1;
        var dur    = parseFloat(p[6]);
        var start  = parseFloat(p[7])   || 0;

        _bcsCompNames = names;
        _bcsExcluded  = {};
        _bcsRenderCompList();

        _bcsWidthScrub.set(width, true);
        _bcsHeightScrub.set(height, true);
        _bcsLocked = true; // reopen defaulted to linked
        document.getElementById('bcsLockBtn').classList.add('locked');
        _bcsLockedRatio = width / height;
        _bcsUpdateLockTip();

        document.getElementById('bcsParSelect').value = _bcsParIndexForValue(par);
        document.getElementById('bcsFrInput').value   = fr;
        document.getElementById('bcsResSelect').value = res;

        document.getElementById('bcsDurUnit').value   = '0'; // reopen defaulted to Seconds
        document.getElementById('bcsStartUnit').value = '0';
        _bcsDurField.render(isNaN(dur) ? 5 : dur);
        _bcsStartField.render(start);

        _bcsClearDirty();
        document.getElementById('bcsOverlay').classList.remove('bcs-hidden');
    });
}

function closeBatchCompSettings() {
    document.getElementById('bcsOverlay').classList.add('bcs-hidden');
    _bcsClearDirty();
}

function applyBatchCompSettings() {
    var applyDims = chkVal('bcsDimsCheck');
    var width     = _bcsWidthScrub.get();
    var height    = _bcsHeightScrub.get();

    var applyPAR = chkVal('bcsParCheck');
    var par      = BCS_PAR_PRESETS[selVal('bcsParSelect')];

    var applyFR   = chkVal('bcsFrCheck');
    var frameRate = numVal('bcsFrInput', 30);
    var snapKeys  = chkVal('bcsSnapCheck');

    var applyRes  = chkVal('bcsResCheck');
    var resFactor = selVal('bcsResSelect');

    var applyDur = chkVal('bcsDurCheck');
    var duration = _bcsDurField.getSeconds();

    var applyStart = chkVal('bcsStartCheck');
    var startTime  = _bcsStartField.getSeconds();

    var includeNested = chkVal('bcsNested');

    var excludedIdx = [];
    for (var i = 0; i < _bcsCompNames.length; i++) {
        if (_bcsExcluded[i]) excludedIdx.push(i);
    }

    if (!applyDims && !applyPAR && !applyFR && !applyRes && !applyDur && !applyStart) {
        showToast('Check at least one setting to apply.');
        return;
    }
    if (applyDims && (width < 1 || height < 1)) {
        showToast('Enter a valid width and height.');
        return;
    }
    if (applyDur && (isNaN(duration) || duration <= 0)) {
        showToast('Enter a valid duration.');
        return;
    }
    if (applyStart && isNaN(startTime)) {
        showToast('Enter a valid start time.');
        return;
    }
    if (_bcsCompNames.length > 0 && excludedIdx.length === _bcsCompNames.length) {
        showToast('All compositions were removed from the list — nothing to apply.');
        return;
    }

    var script = 'lineup_batchApplyCompSettings(' +
        applyDims + ',' + width + ',' + height + ',' +
        applyPAR + ',' + par + ',' +
        applyFR + ',' + frameRate + ',' + snapKeys + ',' +
        applyRes + ',' + resFactor + ',' +
        applyDur + ',' + duration + ',' +
        applyStart + ',' + startTime + ',' +
        includeNested + ',' +
        '"' + excludedIdx.join(',') + '"' + ')';

    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') { closeBatchCompSettings(); return; }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        if (result.indexOf('WARN:') === 0) showToast(result.replace(/^WARN:/, ''));
        closeBatchCompSettings();
    });
}

// ── Batch Rename ─────────────────────────────────────────────────────────────

var _brnCompNames = [];   // every comp selected when the panel was opened (stable, by original index)
var _brnOrder     = [];   // original indices, in current (draggable) numbering order — removing a
                           // comp just splices its index out of this array entirely
var _brnDirty     = false;

// Replaces every [#], [##], [###]… run with the index (zero-padded to the number
// of # characters), and the semi-secret [A] token with a spreadsheet-style letter
// (A, B, … Z, AA, AB, …) based on position alone — [A] always starts at A and
// ignores the Start-at field, by design.
function _brnNumberToLetters(num) {
    var s = '';
    while (num > 0) {
        var rem = (num - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        num = Math.floor((num - 1) / 26);
    }
    return s;
}
function _brnApplyPattern(pattern, num, letterPos) {
    if (!pattern) return '';
    var out = pattern.replace(/\[#+\]/g, function (m) {
        var width = m.length - 2;
        var s = String(num);
        while (s.length < width) s = '0' + s;
        return s;
    });
    out = out.replace(/\[A\]/g, _brnNumberToLetters(letterPos));
    return out;
}

function _brnMarkDirty() {
    if (_brnDirty) return;
    _brnDirty = true;
    var btn = document.getElementById('brnApplyBtn');
    if (btn) btn.classList.add('dirty');
}
function _brnClearDirty() {
    _brnDirty = false;
    var btn = document.getElementById('brnApplyBtn');
    if (btn) btn.classList.remove('dirty');
}

// Renders a live preview of the resulting names (pattern + index applied in
// _brnOrder) — re-run on every pattern/start-number edit, removal, and reorder.
function _brnRenderCompList() {
    var list    = document.getElementById('brnCompList');
    var pattern = document.getElementById('brnPattern').value;
    var start   = parseInt(document.getElementById('brnStart').value, 10);
    if (isNaN(start)) start = 1;

    list.innerHTML = '';
    for (var pos = 0; pos < _brnOrder.length; pos++) {
        var origIdx  = _brnOrder[pos];
        var origName = _brnCompNames[origIdx];
        var newName  = _brnApplyPattern(pattern, start + pos, pos + 1) || origName;

        var row = document.createElement('div');
        row.className = 'bcs-comp-row';
        row.title = origName;
        row.innerHTML =
            '<button class="bcs-drag-handle" title="Drag to reorder">' +
                '<svg viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="1.5" r="1"/><circle cx="6" cy="1.5" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10.5" r="1"/><circle cx="6" cy="10.5" r="1"/></svg>' +
            '</button>' +
            '<svg viewBox="0 0 14 10" fill="currentColor"><rect x="0.5" y="0.5" width="13" height="9" rx="1.3" fill="none" stroke="currentColor" stroke-width="1"/></svg>' +
            '<span class="bcs-comp-name"></span>' +
            '<span class="bcs-comp-orig"></span>' +
            '<button class="bcs-comp-remove" title="Remove from batch">' +
                '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>' +
            '</button>';
        row.querySelector('.bcs-comp-name').textContent = newName;
        row.querySelector('.bcs-comp-orig').textContent = origName;
        row.querySelector('.bcs-comp-remove').addEventListener('click', (function (p) {
            return function () {
                _brnOrder.splice(p, 1);
                _brnMarkDirty();
                _brnRenderCompList();
            };
        })(pos));
        list.appendChild(row);
    }
    if (_brnOrder.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'bcs-complist-empty';
        empty.textContent = 'No comp selected';
        list.appendChild(empty);
    }

    _brnInitDrag();
}

// Drag-to-reorder, same mechanic as the Settings section list: grab the handle,
// a ghost row follows the cursor, other rows slide to show the live insertion
// point, and on release _brnOrder is spliced to match — which changes numbering.
function _brnInitDrag() {
    var list = document.getElementById('brnCompList');
    list.querySelectorAll('.bcs-drag-handle').forEach(function (handle) {
        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();

            var row = handle.closest('.bcs-comp-row');
            if (!row) return;

            var rowEls    = Array.from(list.querySelectorAll('.bcs-comp-row'));
            var dragIdx   = rowEls.indexOf(row);
            var origRects = rowEls.map(function (r) { return r.getBoundingClientRect(); });
            var rowH      = origRects[dragIdx].height;
            var shiftAmt  = rowH + 2; // matches list gap

            var rect  = origRects[dragIdx];
            var ghost = row.cloneNode(true);
            ghost.className = 'bcs-comp-row bcs-comp-drag-ghost';
            ghost.style.cssText = [
                'position:fixed',
                'left:' + rect.left + 'px',
                'top:'  + rect.top  + 'px',
                'width:' + rect.width + 'px',
                'pointer-events:none',
                'z-index:2000'
            ].join(';');
            document.body.appendChild(ghost);
            row.style.visibility = 'hidden';

            var startY    = e.clientY;
            var originTop = rect.top;

            function getInsertIdx(ghostCenterY) {
                var above = 0;
                for (var i = 0; i < rowEls.length; i++) {
                    if (i === dragIdx) continue;
                    if (ghostCenterY > origRects[i].top + origRects[i].height / 2) above++;
                }
                var c = 0;
                for (var i = 0; i < rowEls.length; i++) {
                    if (i === dragIdx) continue;
                    if (c++ === above) return i;
                }
                return rowEls.length;
            }

            function applyShifts(insertIdx) {
                rowEls.forEach(function (r, i) {
                    if (i === dragIdx) return;
                    var dy = 0;
                    if (insertIdx > dragIdx  && i > dragIdx  && i < insertIdx) dy = -shiftAmt;
                    if (insertIdx <= dragIdx && i >= insertIdx && i < dragIdx)  dy =  shiftAmt;
                    r.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
                });
            }

            function onMove(ev) {
                var top = originTop + ev.clientY - startY;
                ghost.style.top = top + 'px';
                applyShifts(getInsertIdx(top + rowH / 2));
            }

            function onUp(ev) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                ghost.remove();

                var finalIdx  = getInsertIdx(originTop + ev.clientY - startY + rowH / 2);
                var insertAt  = finalIdx > dragIdx ? finalIdx - 1 : finalIdx;
                var moved     = _brnOrder.splice(dragIdx, 1)[0];
                _brnOrder.splice(insertAt, 0, moved);

                _brnMarkDirty();
                _brnRenderCompList(); // rebuilds rows (clears transforms) and renumbers
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}

function _brnInit() {
    document.getElementById('brnPattern').addEventListener('input', function () { _brnRenderCompList(); _brnMarkDirty(); });
    document.getElementById('brnStart').addEventListener('input',   function () { _brnRenderCompList(); _brnMarkDirty(); });
}

function openBatchRename() {
    cs.evalScript('lineup_getBatchRenameSeed()', function (result) {
        if (!result || result === 'undefined') {
            // No live ExtendScript bridge — preview with nothing selected.
            result = '';
        }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        _brnCompNames = result.length > 0 ? result.split('|') : [];
        _brnOrder = _brnCompNames.map(function (_, i) { return i; });
        document.getElementById('brnPattern').value = '';
        document.getElementById('brnStart').value   = '1';
        _brnRenderCompList();
        _brnClearDirty();
        document.getElementById('brnOverlay').classList.remove('brn-hidden');
    });
}

function closeBatchRename() {
    document.getElementById('brnOverlay').classList.add('brn-hidden');
    _brnClearDirty();
}

// Wraps a user-typed string as a safely-escaped ExtendScript string literal
// for embedding directly into an evalScript() call.
function _esQuote(str) {
    return '"' + String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
}

function applyBatchRename() {
    var pattern = document.getElementById('brnPattern').value;
    var start   = parseInt(document.getElementById('brnStart').value, 10);
    if (isNaN(start)) start = 1;

    if (!pattern) {
        showToast('Enter a name pattern.');
        return;
    }
    if (_brnOrder.length === 0) {
        showToast('All compositions were removed from the list — nothing to apply.');
        return;
    }

    var script = 'lineup_batchRenameComps(' +
        _esQuote(pattern) + ',' + start + ',' +
        _esQuote(_brnOrder.join(',')) + ')';

    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') { closeBatchRename(); return; }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        closeBatchRename();
    });
}

// ── Comp Export ──────────────────────────────────────────────────────────────

var _cexCompNames  = []; // every comp selected when the panel was opened
var _cexExcluded   = {}; // index (into _cexCompNames) -> true, removed from the batch
var _cexFolder     = ''; // current project's folder, for the suggested save location
var _cexProjBase   = ''; // current project's filename, without extension
var _cexPath       = '';
var _cexManualPath = false; // true once the user has Browse'd to a custom location

function _cexSanitizeFilename(name) {
    return String(name).replace(/[\\\/:*?"<>|]/g, '_');
}

function _cexJoinPath(folder, filename) {
    var sep = folder.indexOf('\\') !== -1 ? '\\' : '/';
    return folder.charAt(folder.length - 1) === sep ? folder + filename : folder + sep + filename;
}

// One comp left -> "ProjectName_CompName.aep"; more than one -> "ProjectName_reduced.aep".
function _cexSuggestedPath() {
    var visible = [];
    for (var i = 0; i < _cexCompNames.length; i++) {
        if (!_cexExcluded[i]) visible.push(_cexCompNames[i]);
    }
    var filename = (visible.length === 1)
        ? _cexProjBase + '_' + _cexSanitizeFilename(visible[0]) + '.aep'
        : _cexProjBase + '_reduced.aep';
    return _cexFolder ? _cexJoinPath(_cexFolder, filename) : filename;
}

function _cexRenderCompList() {
    var list = document.getElementById('cexCompList');
    list.innerHTML = '';
    var shown = 0;
    for (var i = 0; i < _cexCompNames.length; i++) {
        if (_cexExcluded[i]) continue;
        shown++;
        var row = document.createElement('div');
        row.className = 'bcs-comp-row';
        row.innerHTML =
            '<svg viewBox="0 0 14 10" fill="currentColor"><rect x="0.5" y="0.5" width="13" height="9" rx="1.3" fill="none" stroke="currentColor" stroke-width="1"/></svg>' +
            '<span></span>' +
            '<button class="bcs-comp-remove" title="Remove from batch">' +
                '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>' +
            '</button>';
        row.querySelector('span').textContent = _cexCompNames[i];
        row.querySelector('.bcs-comp-remove').addEventListener('click', (function (idx) {
            return function () {
                _cexExcluded[idx] = true;
                _cexRenderCompList();
                if (!_cexManualPath) _cexSetPath(_cexSuggestedPath());
            };
        })(i));
        list.appendChild(row);
    }
    if (shown === 0) {
        var empty = document.createElement('div');
        empty.className = 'bcs-complist-empty';
        empty.textContent = 'No comp selected';
        list.appendChild(empty);
    }

    var applyBtn = document.getElementById('cexApplyBtn');
    if (applyBtn) {
        applyBtn.disabled = shown === 0;
        applyBtn.classList.toggle('dirty', shown > 0);
    }
}

function _cexSetPath(path) {
    _cexPath = path || '';
    var el = document.getElementById('cexPath');
    el.textContent = _cexPath || '(no location chosen)';
    el.title = _cexPath;
}

function openCompExport() {
    cs.evalScript('lineup_getCompExportSeed()', function (result) {
        if (!result || result === 'undefined') {
            // No live ExtendScript bridge — preview with nothing selected.
            result = '||';
        }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        var bar = result.split('|');

        _cexFolder     = bar[0];
        _cexProjBase   = bar[1];
        _cexCompNames  = bar.slice(2).filter(function (n) { return n.length > 0; });
        _cexExcluded   = {};
        _cexManualPath = false;
        _cexRenderCompList();
        _cexSetPath(_cexSuggestedPath());

        document.getElementById('cexOverlay').classList.remove('cex-hidden');
    });
}

function closeCompExport() {
    document.getElementById('cexOverlay').classList.add('cex-hidden');
}

function browseCompExport() {
    var script = 'lineup_pickExportLocation(' + _esQuote(_cexPath) + ')';
    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') return;
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        if (result.length === 0) return; // user canceled the native dialog
        _cexManualPath = true;
        _cexSetPath(result);
    });
}

function applyCompExport() {
    var excludedIdx = [];
    for (var i = 0; i < _cexCompNames.length; i++) {
        if (_cexExcluded[i]) excludedIdx.push(i);
    }
    if (_cexCompNames.length > 0 && excludedIdx.length === _cexCompNames.length) {
        showToast('All compositions were removed from the list — nothing to export.');
        return;
    }
    if (!_cexPath) {
        showToast('Choose a save location first.');
        return;
    }

    var script = 'lineup_exportReducedProject(' +
        _esQuote(_cexPath) + ',' + _esQuote(excludedIdx.join(',')) + ')';

    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') { closeCompExport(); return; }
        if (result.indexOf('ERROR:') === 0) {
            showToast(result.replace(/^ERROR:\s*/, ''));
            return;
        }
        showToast('Saved your project, then exported and opened the reduced copy.', 'info');
        closeCompExport();
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
    restoreSettings();
    restoreCollapsed();
    restoreScale();
    _bcsInit();
    _brnInit();

    var scaleEl = document.getElementById('scaleSlider');
    if (scaleEl) {
        scaleEl.addEventListener('input', function() {
            var val = parseInt(scaleEl.value, 10);
            applyScale(val);
            try { localStorage.setItem('lineup-scale', val); } catch(e) {}
        });
    }

    // Restrict numeric inputs
    ['marginInput','distInput','radialInput','gridColsInput','gridRowsInput','gridHPadInput','gridVPadInput','autoCropPad'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', function() {
            var raw   = el.value;
            var clean = raw.replace(/[^0-9.\-]/g, '');
            clean = clean.replace(/(?!^)-/g, '');
            var parts = clean.split('.');
            if (parts.length > 2) clean = parts[0] + '.' + parts.slice(1).join('');
            if (clean !== raw) el.value = clean;
            _syncAlignEdgesDim();
        });
    });
    _syncAlignEdgesDim();

    // Grid distribute button: right-click → picker at cursor
    var gridDistBtn = document.getElementById('gridDistBtn');
    if (gridDistBtn) {
        gridDistBtn.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            _openGridPicker(e.clientX, e.clientY);
        });
    }

    // Radial distribute button: right-click → radius picker
    var radialDistBtn = document.getElementById('radialDistBtn');
    if (radialDistBtn) {
        radialDistBtn.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            _openRadialPicker(e.clientX, e.clientY);
        });
    }

    // Z-depth distribute button: right-click → depth range picker
    var zDistBtn = document.getElementById('zDistBtn');
    if (zDistBtn) {
        zDistBtn.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            _openZPicker(e.clientX, e.clientY);
        });
    }

    // Grey out Spacing when distMode is not Key Layer
    var distModeEl   = document.getElementById('distMode');
    var distInputEl  = document.getElementById('distInput');
    var spacingGroup = document.getElementById('spacingGroup');
    function syncDistInput() {
        var disabled = (parseInt(distModeEl.value, 10) !== 2);
        if (distInputEl)  distInputEl.disabled = disabled;
        if (spacingGroup) spacingGroup.classList.toggle('dimmed', disabled);
    }
    if (distModeEl) { distModeEl.addEventListener('change', syncDistInput); syncDistInput(); }
});
