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
    var ids = ['align','dist','sizing','anchor','ease','rigs','sort','autocrop','organize','spell'];
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

// ── Favorites ─────────────────────────────────────────────────────────────────

var _favorites  = {};
var _favCtx     = null;
var _favCtxBtn  = null;

var _FAV_STAR_SVG      = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="6,0.8 7.4,4.4 11.2,4.7 8.4,7.2 9.3,11 6,9.1 2.7,11 3.6,7.2 0.8,4.7 4.6,4.4"/></svg>';
var _FAV_STAR_SVG_FILL = '<svg viewBox="0 0 12 12" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="6,0.8 7.4,4.4 11.2,4.7 8.4,7.2 9.3,11 6,9.1 2.7,11 3.6,7.2 0.8,4.7 4.6,4.4"/></svg>';

function _loadFavorites() {
    try { _favorites = JSON.parse(localStorage.getItem('lineup-favorites') || '{}'); } catch(e) { _favorites = {}; }
}

function _saveFavorites() {
    try { localStorage.setItem('lineup-favorites', JSON.stringify(_favorites)); } catch(e) {}
}

function isFavorited(id) {
    return !!_favorites[id];
}

function toggleFavorite(id) {
    var adding = !_favorites[id];
    if (adding) { _favorites[id] = 1; } else { delete _favorites[id]; }
    _saveFavorites();
    _renderFavBar();
    _syncAllPickerStars();
    _closeFavCtx();
    if (adding) _showFavToast(id);
}

function _showFavToast(id) {
    var btn   = document.querySelector('[data-fav-id="' + id + '"]:not([data-fav-clone])');
    var label = btn ? (btn.title || 'Item') : 'Item';
    var toast = document.getElementById('toast');
    var msgEl = document.getElementById('toast-msg');
    if (!toast || !msgEl) return;
    msgEl.textContent = '★  ' + label + ' favorited';
    toast.className = 'toast toast-fav';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, 2500);
}

function _renderFavBar() {
    var bar  = document.getElementById('fav-bar');
    var cont = document.getElementById('fav-bar-btns');
    if (!bar || !cont) return;

    var ids = Object.keys(_favorites);
    if (ids.length === 0) {
        bar.classList.add('fav-bar-hidden');
        cont.innerHTML = '';
        return;
    }
    bar.classList.remove('fav-bar-hidden');
    cont.innerHTML = '';

    ids.forEach(function(id) {
        var src = document.querySelector('[data-fav-id="' + id + '"]:not([data-fav-clone])');
        if (!src) return;
        var clone = src.cloneNode(true);
        clone.removeAttribute('id');
        clone.removeAttribute('onclick');
        clone.setAttribute('data-fav-clone', id);
        clone.style.cssText = '';
        clone.addEventListener('click', function(e) {
            e.stopPropagation();
            var original = document.querySelector('[data-fav-id="' + id + '"]:not([data-fav-clone])');
            if (original) original.click();
        });
        clone.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            if      (id === 'dist-grid')   _openGridPicker(e.clientX, e.clientY);
            else if (id === 'dist-radial') _openRadialPicker(e.clientX, e.clientY);
            else if (id === 'dist-z')      _openZPicker(e.clientX, e.clientY);
            else if (id === 'dist-path')   _openPathPicker(e.clientX, e.clientY);
            else                           _openFavCtx(clone, e.clientX, e.clientY);
        });
        cont.appendChild(clone);
    });
}

function _syncAllPickerStars() {
    var stars = document.querySelectorAll('[data-picker-star]');
    for (var i = 0; i < stars.length; i++) {
        var id     = stars[i].getAttribute('data-picker-star');
        var active = isFavorited(id);
        stars[i].classList.toggle('fav-active', active);
        stars[i].innerHTML = active ? _FAV_STAR_SVG_FILL : _FAV_STAR_SVG;
    }
}

function _makePickerStarBtn(favId) {
    var btn    = document.createElement('button');
    btn.className = 'picker-star-btn';
    btn.setAttribute('data-picker-star', favId);
    btn.title  = 'Favorite';
    btn.type   = 'button';
    var active = isFavorited(favId);
    btn.innerHTML = active ? _FAV_STAR_SVG_FILL : _FAV_STAR_SVG;
    if (active) btn.classList.add('fav-active');
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleFavorite(favId);
    });
    return btn;
}

function _buildFavCtx() {
    var el   = document.createElement('div');
    el.className = 'fav-ctx';
    var item = document.createElement('button');
    item.className = 'fav-ctx-item';
    item.type = 'button';
    item.innerHTML = _FAV_STAR_SVG + '<span class="fav-ctx-lbl">Favorite</span>';
    el.appendChild(item);
    item.addEventListener('click', function() {
        if (_favCtxBtn) toggleFavorite(_favCtxBtn.getAttribute('data-fav-id'));
    });
    document.body.appendChild(el);
    return el;
}

function _openFavCtx(btn, x, y) {
    if (!_favCtx) _favCtx = _buildFavCtx();
    _favCtxBtn = btn;
    var id     = btn.getAttribute('data-fav-id');
    var active = isFavorited(id);
    var item   = _favCtx.querySelector('.fav-ctx-item');
    if (item) {
        item.classList.toggle('fav-active', active);
        item.querySelector('svg').setAttribute('fill', active ? 'currentColor' : 'none');
        item.querySelector('.fav-ctx-lbl').textContent = active ? 'Unfavorite' : 'Favorite';
    }
    var vw = window.innerWidth, vh = window.innerHeight;
    _favCtx.style.left = Math.min(x, vw - 152) + 'px';
    _favCtx.style.top  = Math.min(y, vh - 42)  + 'px';
    _favCtx.classList.add('visible');
    setTimeout(function() {
        document.addEventListener('mousedown', _favCtxOutside);
        document.addEventListener('keydown',   _favCtxKey);
    }, 0);
}

function _closeFavCtx() {
    if (_favCtx) _favCtx.classList.remove('visible');
    _favCtxBtn = null;
    document.removeEventListener('mousedown', _favCtxOutside);
    document.removeEventListener('keydown',   _favCtxKey);
}

function _favCtxOutside(e) {
    if (_favCtx && !_favCtx.contains(e.target)) _closeFavCtx();
}

function _favCtxKey(e) {
    if (e.key === 'Escape') _closeFavCtx();
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
    var mode = selVal('distMode');
    // Key Layer mode always lines layers up back to back — no user-set spacing.
    run('lineup_distribute(' + horizontal + ',' + mode + ',0)');
}

function doDistZ() {
    var mode    = selVal('distMode');
    var spacing = 0; // Key Layer mode always lines layers up back to back
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
    var spacing = numVal('pathSpacingInput');
    var rotate  = chkVal('pathRotateCheck');
    run('lineup_pathDistribute(' + mode + ',' + spacing + ',' + rotate + ')');
}

function doDistRadial() {
    var mode    = selVal('distMode');
    var spacing = 0; // Key Layer mode always lines layers up back to back
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

// ── SIZING ────────────────────────────────────────────────────────────────────

function doSizeMatch(mode) {
    var sizeMode = selVal('sizeMode');
    var crop     = selVal('sizeFitMode');
    var move     = chkVal('sizeMoveCheck');
    run('lineup_sizeMatch(' + mode + ',' + sizeMode + ',' + crop + ',' + move + ')');
}

function setSizeFitMode(val) {
    document.getElementById('sizeFitMode').value = val;
    var btns = document.querySelectorAll('#sizeFitSeg .fit-seg-btn');
    btns.forEach(function(btn, i) { btn.classList.toggle('active', i === val); });
    document.getElementById('sizeFitSlider').style.transform = 'translateX(' + (val * 100) + '%)';
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
    var mode = selVal('anchorMode');
    run('lineup_createNull(' + mode + ')');
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
    run('lineup_easePaste()', function(result) { showToast(result, 'info'); });
}

function doEaseValuePaste() {
    run('lineup_easeValuePaste()', function(result) { showToast(result, 'info'); });
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
var _gridPickerAlignCb   = null;

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
    var gpStarBtn = _makePickerStarBtn('dist-grid');
    gpStarBtn.style.marginLeft = 'auto';
    confirmBtn.style.marginLeft = '4px';
    top.appendChild(gpStarBtn);
    top.appendChild(confirmBtn);
    el.appendChild(top);

    // Align Edges sits up top, mirroring the hidden main-panel checkbox, so it
    // doesn't interfere with hovering/clicking the grid cells below.
    var alignRow = document.createElement('div');
    alignRow.className = 'grid-picker-align-row';
    var alignGroup = document.createElement('span');
    alignGroup.id = 'alignEdgesGroup';
    alignGroup.className = 'spacing-group';
    var alignLabel = document.createElement('label');
    alignLabel.className = 'check-label';
    alignLabel.title = 'Align corner layers to composition/selection edges; distribute the rest evenly between them. Ignored on any axis where Gap is set manually.';
    var alignCb = document.createElement('input');
    alignCb.type = 'checkbox';
    _gridPickerAlignCb = alignCb;
    alignLabel.appendChild(alignCb);
    alignLabel.appendChild(document.createTextNode(' Align Edges'));
    alignGroup.appendChild(alignLabel);
    alignRow.appendChild(alignGroup);
    el.appendChild(alignRow);

    alignCb.addEventListener('change', function() {
        var mainEl = document.getElementById('alignEdgesCheck');
        if (mainEl) mainEl.checked = alignCb.checked;
        _syncAlignEdgesDim();
    });

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

    var mainAlign = document.getElementById('alignEdgesCheck');
    if (_gridPickerAlignCb) _gridPickerAlignCb.checked = mainAlign ? mainAlign.checked : false;

    // Position near cursor, clamp inside viewport
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = 190, ph = 246;
    _gridPicker.style.left = Math.min(x + 4, vw - pw - 4) + 'px';
    _gridPicker.style.top  = Math.min(y + 4, vh - ph - 4) + 'px';

    _gridPicker.classList.add('visible');
    _syncAlignEdgesDim();
    _syncAllPickerStars();

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
var _rpRotate        = false;
var _rpRotateCb      = null;

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
    var rpStarBtn = _makePickerStarBtn('dist-radial');
    rpStarBtn.style.marginLeft = 'auto';
    confirmBtn.style.marginLeft = '4px';
    top.appendChild(rpStarBtn);
    top.appendChild(confirmBtn);
    el.appendChild(top);

    // Rotate sits up top so it doesn't interfere with dragging in the preview below
    var rotRow = document.createElement('div');
    rotRow.className = 'radial-picker-rotate-row';
    var rotLabel = document.createElement('label');
    rotLabel.className = 'check-label';
    rotLabel.title = 'Auto Rotate each layer outward along the radial angle';
    var rotCb = document.createElement('input');
    rotCb.type = 'checkbox';
    _rpRotateCb = rotCb;
    rotLabel.appendChild(rotCb);
    rotLabel.appendChild(document.createTextNode(' Rotate'));
    rotRow.appendChild(rotLabel);
    el.appendChild(rotRow);

    rotCb.addEventListener('change', function() { _rpRotate = rotCb.checked; });

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

        var mainRotate = document.getElementById('rotateCheck');
        _rpRotate = mainRotate ? mainRotate.checked : false;
        if (_rpRotateCb) _rpRotateCb.checked = _rpRotate;

        var vw = window.innerWidth, vh = window.innerHeight;
        var popW = 192, popH = 180;
        _radialPicker.style.left = Math.min(x + 4, vw - popW - 4) + 'px';
        _radialPicker.style.top  = Math.min(y + 4, vh - popH - 4) + 'px';
        _radialPicker.classList.add('visible');
        _syncAllPickerStars();

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
    var rotEl = document.getElementById('rotateCheck');
    if (rotEl) rotEl.checked = _rpRotate;
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
    var zpStarBtn = _makePickerStarBtn('dist-z');
    zpStarBtn.style.marginLeft = '4px';
    confirmBtn.style.marginLeft = '4px';
    inputsRow.appendChild(zpStarBtn);
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
    _syncAllPickerStars();

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

// ── Path Picker ───────────────────────────────────────────────────────────────
// Decorative sine-wave curve — not the actual selected layer's path, just a
// stand-in for previewing spacing.

var PATH_PW = 176, PATH_PH = 92;
var _PP_X0 = 14, _PP_X1 = 162, _PP_CY = 46, _PP_AMP = 24, _PP_CYCLES = 2;

var _pathPicker      = null;
var _ppSpacing       = 0;
var _ppRotate        = false;
var _ppSpacingInput  = null;
var _ppRotateCb      = null;
var _ppHandle        = null;
var _ppSquaresG      = null;
var _ppPreviewEl     = null;
var _ppSamples       = null;

function _ppCurvePoint(t) {
    var x = _PP_X0 + t * (_PP_X1 - _PP_X0);
    var y = _PP_CY + _PP_AMP * Math.sin(t * _PP_CYCLES * 2 * Math.PI);
    return { x: x, y: y };
}

function _ppBuildSamples() {
    var pts = [], total = 0, steps = 160;
    var prev = _ppCurvePoint(0);
    pts.push({ x: prev.x, y: prev.y, len: 0 });
    for (var i = 1; i <= steps; i++) {
        var t = i / steps;
        var p = _ppCurvePoint(t);
        var dx = p.x - prev.x, dy = p.y - prev.y;
        total += Math.sqrt(dx * dx + dy * dy);
        pts.push({ x: p.x, y: p.y, len: total });
        prev = p;
    }
    for (var i = 0; i < pts.length; i++) pts[i].frac = total > 0 ? pts[i].len / total : 0;
    _ppSamples = pts;
}

function _ppCurveD() {
    if (!_ppSamples) _ppBuildSamples();
    var d = 'M' + _ppSamples[0].x.toFixed(1) + ',' + _ppSamples[0].y.toFixed(1);
    for (var i = 2; i < _ppSamples.length; i += 2) {
        d += ' L' + _ppSamples[i].x.toFixed(1) + ',' + _ppSamples[i].y.toFixed(1);
    }
    var last = _ppSamples[_ppSamples.length - 1];
    d += ' L' + last.x.toFixed(1) + ',' + last.y.toFixed(1);
    return d;
}

function _ppPointAtFrac(frac) {
    if (!_ppSamples) _ppBuildSamples();
    frac = Math.max(0, Math.min(1, frac));
    for (var i = 1; i < _ppSamples.length; i++) {
        if (_ppSamples[i].frac >= frac) {
            var a = _ppSamples[i - 1], b = _ppSamples[i];
            var span = b.frac - a.frac;
            var f = span > 0 ? (frac - a.frac) / span : 0;
            return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        }
    }
    var last = _ppSamples[_ppSamples.length - 1];
    return { x: last.x, y: last.y };
}

function _ppNearestFrac(mx, my) {
    if (!_ppSamples) _ppBuildSamples();
    var best = 0, bestD = Infinity;
    for (var i = 0; i < _ppSamples.length; i++) {
        var dx = _ppSamples[i].x - mx, dy = _ppSamples[i].y - my;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = _ppSamples[i].frac; }
    }
    return best;
}

function _buildPathPicker() {
    var el = document.createElement('div');
    el.className = 'path-picker';

    var top = document.createElement('div');
    top.className = 'path-picker-top';

    function ppLbl(txt) {
        var s = document.createElement('span');
        s.className = 'gp-lbl';
        s.textContent = txt;
        return s;
    }

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = '0';
    _ppSpacingInput = inp;

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'grid-picker-confirm';
    confirmBtn.title = 'Confirm';
    confirmBtn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';

    top.appendChild(ppLbl('Spacing'));
    top.appendChild(inp);
    top.appendChild(ppLbl('%'));
    var ppStarBtn = _makePickerStarBtn('dist-path');
    ppStarBtn.style.marginLeft = 'auto';
    confirmBtn.style.marginLeft = '4px';
    top.appendChild(ppStarBtn);
    top.appendChild(confirmBtn);
    el.appendChild(top);

    // Rotate sits above the preview so it doesn't interfere with curve-dragging below
    var rotRow = document.createElement('div');
    rotRow.className = 'path-picker-rotate-row';
    var rotLabel = document.createElement('label');
    rotLabel.className = 'check-label';
    rotLabel.title = 'Rotate each layer to follow the path tangent (separate from Radial\'s Rotate)';
    var rotCb = document.createElement('input');
    rotCb.type = 'checkbox';
    _ppRotateCb = rotCb;
    rotLabel.appendChild(rotCb);
    rotLabel.appendChild(document.createTextNode(' Rotate'));
    rotRow.appendChild(rotLabel);
    el.appendChild(rotRow);

    rotCb.addEventListener('change', function() { _ppRotate = rotCb.checked; });

    var preview = document.createElement('div');
    preview.className = 'path-preview';
    _ppPreviewEl = preview;

    var NS  = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + PATH_PW + ' ' + PATH_PH);
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';

    var curve = document.createElementNS(NS, 'path');
    curve.setAttribute('d', _ppCurveD());
    curve.setAttribute('fill', 'none');
    curve.setAttribute('stroke', '#4a4a4a');
    curve.setAttribute('stroke-width', '2');
    curve.setAttribute('stroke-linecap', 'round');
    curve.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(curve);

    var squaresG = document.createElementNS(NS, 'g');
    _ppSquaresG = squaresG;
    svg.appendChild(squaresG);

    var handle = document.createElementNS(NS, 'circle');
    handle.setAttribute('r', '4.5');
    handle.setAttribute('fill', '#2470e0');
    handle.setAttribute('stroke', '#1e1e1e');
    handle.setAttribute('stroke-width', '1.5');
    _ppHandle = handle;
    svg.appendChild(handle);

    preview.appendChild(svg);
    el.appendChild(preview);

    document.body.appendChild(el);

    function onCurveDrag(e) {
        var rect = preview.getBoundingClientRect();
        var mx = (e.clientX - rect.left) / rect.width  * PATH_PW;
        var my = (e.clientY - rect.top)  / rect.height * PATH_PH;
        _ppSpacing = _ppNearestFrac(mx, my) * 100;
        _ppUpdateVisual();
    }

    preview.addEventListener('mousedown', function(e) {
        e.preventDefault();
        onCurveDrag(e);
        function onMove(e2) { onCurveDrag(e2); }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    inp.addEventListener('input', function() {
        var v = parseFloat(inp.value);
        if (!isNaN(v)) { _ppSpacing = Math.max(0, v); _ppUpdateVisual(); }
    });
    inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') _ppCommit();
    });
    inp.addEventListener('mousemove', function(e) { e.stopPropagation(); });

    confirmBtn.addEventListener('click', _ppCommit);

    return el;
}

function _ppUpdateVisual() {
    if (_ppSpacingInput && document.activeElement !== _ppSpacingInput) {
        _ppSpacingInput.value = Math.round(_ppSpacing * 10) / 10;
    }

    var frac = ((_ppSpacing % 100) + 100) % 100 / 100;
    var hp = _ppPointAtFrac(frac);
    if (_ppHandle) { _ppHandle.setAttribute('cx', hp.x); _ppHandle.setAttribute('cy', hp.y); }

    // Squares illustrate the back-to-back wrap pattern at the current spacing %
    if (_ppSquaresG) {
        _ppSquaresG.innerHTML = '';
        var NS = 'http://www.w3.org/2000/svg';
        var n = 5, sz = 6;
        for (var i = 0; i < n; i++) {
            var f = (_ppSpacing <= 0) ? (i / n) : (((i * _ppSpacing) % 100) / 100);
            var p = _ppPointAtFrac(f);
            var sq = document.createElementNS(NS, 'rect');
            sq.setAttribute('x', p.x - sz / 2);
            sq.setAttribute('y', p.y - sz / 2);
            sq.setAttribute('width', sz);
            sq.setAttribute('height', sz);
            sq.setAttribute('rx', 1.3);
            sq.setAttribute('fill', i === 0 ? '#2470e0' : 'rgba(36,112,224,0.45)');
            _ppSquaresG.appendChild(sq);
        }
    }
}

function _ppCommit() {
    var s = document.getElementById('pathSpacingInput');
    var r = document.getElementById('pathRotateCheck');
    if (s) s.value = _ppSpacing;
    if (r) r.checked = _ppRotate;
    _closePathPicker();
}

function _openPathPicker(x, y) {
    if (!_pathPicker) _pathPicker = _buildPathPicker();

    var s = document.getElementById('pathSpacingInput');
    var r = document.getElementById('pathRotateCheck');
    _ppSpacing = s ? (parseFloat(s.value) || 0) : 0;
    _ppRotate  = r ? r.checked : false;
    if (_ppRotateCb) _ppRotateCb.checked = _ppRotate;

    _ppUpdateVisual();

    var vw = window.innerWidth, vh = window.innerHeight;
    var popW = 192, popH = 180;
    _pathPicker.style.left = Math.min(x + 4, vw - popW - 4) + 'px';
    _pathPicker.style.top  = Math.min(y + 4, vh - popH - 4) + 'px';
    _pathPicker.classList.add('visible');
    _syncAllPickerStars();

    setTimeout(function() {
        document.addEventListener('mousedown', _pathPickerOutside);
        document.addEventListener('keydown',   _pathPickerKey);
    }, 0);
}

function _closePathPicker() {
    if (_pathPicker) _pathPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _pathPickerOutside);
    document.removeEventListener('keydown',   _pathPickerKey);
}

function _pathPickerOutside(e) {
    if (_pathPicker && !_pathPicker.contains(e.target)) _closePathPicker();
}

function _pathPickerKey(e) {
    if (e.key === 'Escape') _closePathPicker();
}

// ── Properties Picker ────────────────────────────────────────────────────────
// Flat list of every Z / Path / Radial / Grid setting as plain text/checkbox
// inputs (no draggable previews). Edits write straight through to the same
// hidden fields the individual right-click menus read from, so everything is
// saved continuously — closing the popup (Escape or clicking outside) never
// discards anything, unlike the confirm-gated drag pickers above.

var _distPropsPicker  = null;
var _alignPropsPicker = null;
var _propsTextInputs  = [];
var _propsCheckboxes  = [];
var _propsSelects     = [];

function _propsTextInput(mainId, placeholder, width) {
    var inp = document.createElement('input');
    inp.type = 'text';
    if (placeholder) inp.placeholder = placeholder;
    if (width) inp.style.width = width + 'px';
    inp.addEventListener('input', function() {
        var raw   = inp.value;
        var clean = raw.replace(/[^0-9.\-]/g, '');
        clean = clean.replace(/(?!^)-/g, '');
        var parts = clean.split('.');
        if (parts.length > 2) clean = parts[0] + '.' + parts.slice(1).join('');
        if (clean !== raw) inp.value = clean;
        var el = document.getElementById(mainId);
        if (el) el.value = inp.value;
        if (mainId === 'gridHPadInput' || mainId === 'gridVPadInput') _syncAlignEdgesDim();
    });
    inp.addEventListener('mousemove', function(e) { e.stopPropagation(); });
    inp._propsMainId = mainId;
    _propsTextInputs.push(inp);
    return inp;
}

function _propsCheckbox(mainId, inverted) {
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', function() {
        var el = document.getElementById(mainId);
        if (!el) return;
        var on = inverted ? !cb.checked : cb.checked;
        if (el.type === 'checkbox') el.checked = on; else el.value = on ? '1' : '0';
        if (mainId === 'alignEdgesCheck') _syncAlignEdgesDim();
    });
    cb._propsMainId   = mainId;
    cb._propsInverted = inverted;
    _propsCheckboxes.push(cb);
    return cb;
}

function _propsSelect(mainId, options) {
    var sel = document.createElement('select');
    options.forEach(function(opt) {
        var o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
    });
    sel.addEventListener('change', function() {
        var el = document.getElementById(mainId);
        if (el) el.value = sel.value;
    });
    sel.addEventListener('mousemove', function(e) { e.stopPropagation(); });
    sel._propsMainId = mainId;
    _propsSelects.push(sel);
    return sel;
}

function _propsCloseBtn(closeFn) {
    var btn = document.createElement('button');
    btn.className = 'grid-picker-confirm';
    btn.title = 'Close';
    btn.innerHTML = '<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>';
    btn.addEventListener('click', closeFn);
    return btn;
}

function _propsHeaderRow(title, closeFn) {
    var row = document.createElement('div');
    row.className = 'props-header-row';
    var h = document.createElement('span');
    h.className = 'props-header-title';
    h.textContent = title;
    row.appendChild(h);
    row.appendChild(_propsCloseBtn(closeFn));
    return row;
}

function _propsCheckLabel(mainId, text, inverted) {
    var label = document.createElement('label');
    label.className = 'check-label';
    label.appendChild(_propsCheckbox(mainId, inverted));
    label.appendChild(document.createTextNode(' ' + text));
    return label;
}

function _propsLbl(text) {
    var s = document.createElement('span');
    s.className = 'gp-lbl';
    s.textContent = text;
    return s;
}

function _propsVsep() {
    var s = document.createElement('span');
    s.className = 'vsep';
    return s;
}

function _propsLine() {
    var row = document.createElement('div');
    row.className = 'props-line';
    return row;
}

function _propsGapIcon(horizontal) {
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

function _propsGroupLbl(text) {
    var l = document.createElement('div');
    l.className = 'props-group-lbl';
    l.textContent = text;
    return l;
}

function _buildDistPropsPicker() {
    var el = document.createElement('div');
    el.className = 'props-picker';

    el.appendChild(_propsHeaderRow('All Distribute Settings', _closeDistPropsPicker));

    el.appendChild(_propsGroupLbl('Radial'));
    var rLine = _propsLine();
    rLine.appendChild(_propsLbl('Radius'));
    rLine.appendChild(_propsTextInput('radialInput', null, 50));
    rLine.appendChild(_propsLbl('px'));
    rLine.appendChild(_propsVsep());
    rLine.appendChild(_propsCheckLabel('rotateCheck', 'Rotate'));
    el.appendChild(rLine);

    el.appendChild(_propsGroupLbl('Path'));
    var pLine = _propsLine();
    pLine.appendChild(_propsLbl('Spacing'));
    pLine.appendChild(_propsTextInput('pathSpacingInput', null, 44));
    pLine.appendChild(_propsLbl('%'));
    pLine.appendChild(_propsVsep());
    pLine.appendChild(_propsCheckLabel('pathRotateCheck', 'Rotate'));
    el.appendChild(pLine);

    el.appendChild(_propsGroupLbl('Grid'));
    var gLine1 = _propsLine();
    gLine1.appendChild(_propsTextInput('gridColsInput', null, 32));
    gLine1.appendChild(_propsLbl('×'));
    gLine1.appendChild(_propsTextInput('gridRowsInput', null, 32));
    gLine1.appendChild(_propsVsep());
    gLine1.appendChild(_propsCheckLabel('alignEdgesCheck', 'Align Edges'));
    el.appendChild(gLine1);

    var gLine2 = _propsLine();
    gLine2.appendChild(_propsGapIcon(true));
    gLine2.appendChild(_propsTextInput('gridHPadInput', 'Auto', 42));
    gLine2.appendChild(_propsGapIcon(false));
    gLine2.appendChild(_propsTextInput('gridVPadInput', 'Auto', 42));
    el.appendChild(gLine2);

    el.appendChild(_propsGroupLbl('Z Depth'));
    var zLine1 = _propsLine();
    zLine1.appendChild(_propsLbl('Start'));
    zLine1.appendChild(_propsTextInput('zStartInput', null, 44));
    zLine1.appendChild(_propsLbl('End'));
    zLine1.appendChild(_propsTextInput('zEndInput', null, 44));
    el.appendChild(zLine1);

    var zLine2 = _propsLine();
    zLine2.appendChild(_propsCheckLabel('zEvenInput', 'Step', true));
    zLine2.appendChild(_propsTextInput('zStepInput', null, 44));
    el.appendChild(zLine2);

    document.body.appendChild(el);
    return el;
}

function _propsRefreshValues() {
    for (var i = 0; i < _propsTextInputs.length; i++) {
        var inp = _propsTextInputs[i];
        var el  = document.getElementById(inp._propsMainId);
        if (el && document.activeElement !== inp) inp.value = el.value;
    }
    for (var j = 0; j < _propsCheckboxes.length; j++) {
        var cb  = _propsCheckboxes[j];
        var el2 = document.getElementById(cb._propsMainId);
        if (!el2) continue;
        var on = el2.type === 'checkbox' ? el2.checked : el2.value !== '0';
        cb.checked = cb._propsInverted ? !on : on;
    }
    for (var k = 0; k < _propsSelects.length; k++) {
        var sel = _propsSelects[k];
        var el3 = document.getElementById(sel._propsMainId);
        if (el3) sel.value = el3.value;
    }
}

function toggleDistProps(e) {
    if (_distPropsPicker && _distPropsPicker.classList.contains('visible')) {
        _closeDistPropsPicker();
    } else {
        _openDistPropsPicker(e.clientX, e.clientY);
    }
}

function _openDistPropsPicker(x, y) {
    if (!_distPropsPicker) _distPropsPicker = _buildDistPropsPicker();
    _propsRefreshValues();

    var vw = window.innerWidth, vh = window.innerHeight;
    var popW = 230, popH = 310;
    _distPropsPicker.style.left = Math.max(4, Math.min(x + 4, vw - popW - 4)) + 'px';
    _distPropsPicker.style.top  = Math.max(4, Math.min(y + 4, vh - popH - 4)) + 'px';
    _distPropsPicker.classList.add('visible');

    setTimeout(function() {
        document.addEventListener('mousedown', _distPropsPickerOutside);
        document.addEventListener('keydown',   _distPropsPickerKey);
    }, 0);
}

function _closeDistPropsPicker() {
    if (_distPropsPicker) _distPropsPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _distPropsPickerOutside);
    document.removeEventListener('keydown',   _distPropsPickerKey);
}

function _distPropsPickerOutside(e) {
    var btn = document.getElementById('distPropsBtn');
    if (_distPropsPicker && !_distPropsPicker.contains(e.target) && !(btn && btn.contains(e.target))) {
        _closeDistPropsPicker();
    }
}

function _distPropsPickerKey(e) {
    if (e.key === 'Escape') _closeDistPropsPicker();
}

function _buildAlignPropsPicker() {
    var el = document.createElement('div');
    el.className = 'props-picker';

    el.appendChild(_propsHeaderRow('All Align Settings', _closeAlignPropsPicker));

    el.appendChild(_propsGroupLbl('Margin'));
    var mLine = _propsLine();
    mLine.appendChild(_propsTextInput('marginInput', null, 44));
    mLine.appendChild(_propsSelect('pixelDropdown', [{ value: '0', label: 'px' }, { value: '1', label: '%' }]));
    mLine.appendChild(_propsVsep());
    mLine.appendChild(_propsCheckLabel('offsetCheck', 'Offset Keys'));
    el.appendChild(mLine);

    document.body.appendChild(el);
    return el;
}

function toggleAlignProps(e) {
    if (_alignPropsPicker && _alignPropsPicker.classList.contains('visible')) {
        _closeAlignPropsPicker();
    } else {
        _openAlignPropsPicker(e.clientX, e.clientY);
    }
}

function _openAlignPropsPicker(x, y) {
    if (!_alignPropsPicker) _alignPropsPicker = _buildAlignPropsPicker();
    _propsRefreshValues();

    var vw = window.innerWidth, vh = window.innerHeight;
    var popW = 200, popH = 110;
    _alignPropsPicker.style.left = Math.max(4, Math.min(x + 4, vw - popW - 4)) + 'px';
    _alignPropsPicker.style.top  = Math.max(4, Math.min(y + 4, vh - popH - 4)) + 'px';
    _alignPropsPicker.classList.add('visible');

    setTimeout(function() {
        document.addEventListener('mousedown', _alignPropsPickerOutside);
        document.addEventListener('keydown',   _alignPropsPickerKey);
    }, 0);
}

function _closeAlignPropsPicker() {
    if (_alignPropsPicker) _alignPropsPicker.classList.remove('visible');
    document.removeEventListener('mousedown', _alignPropsPickerOutside);
    document.removeEventListener('keydown',   _alignPropsPickerKey);
}

function _alignPropsPickerOutside(e) {
    var btn = document.getElementById('alignPropsBtn');
    if (_alignPropsPicker && !_alignPropsPicker.contains(e.target) && !(btn && btn.contains(e.target))) {
        _closeAlignPropsPicker();
    }
}

function _alignPropsPickerKey(e) {
    if (e.key === 'Escape') _closeAlignPropsPicker();
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

function doLinkPropertyToController() {
    var offset = chkVal('linkOffsetCheck');
    run('lineup_linkPropertyToController(' + offset + ')', function(result) {
        showToast(result, 'info');
    });
}

// ── Project Structure ───────────────────────────────────────────────────────────

var _structNodeSeq       = 0;
var _structPresets       = [];   // persisted
var _structActiveIdx     = 0;
var _structEditPresets   = [];   // working copy, edited while the modal is open — discarded on Cancel
var _structEditActiveIdx = 0;
var _structCollapsed     = {};   // nodeId -> true, reset each time the modal opens

var _STRUCT_FOLDER_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2,5.5 a1,1 0 0,1 1,-1 H7 L8.5,6 H17 a1,1 0 0,1 1,1 V15 a1,1 0 0,1 -1,1 H3 a1,1 0 0,1 -1,-1 Z"/></svg>';
var _STRUCT_PLUS_SVG   = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5" y1="1.5" x2="5" y2="8.5"/><line x1="1.5" y1="5" x2="8.5" y2="5"/></svg>';
var _STRUCT_X_SVG      = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"/></svg>';
var _STRUCT_TRASH_SVG  = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polyline points="3,5 4.5,12 9.5,12 11,5"/><line x1="2" y1="4" x2="12" y2="4"/><line x1="5.5" y1="4" x2="5.5" y2="2.5"/><line x1="8.5" y1="4" x2="8.5" y2="2.5"/><line x1="5.5" y1="2.5" x2="8.5" y2="2.5"/></svg>';
var _STRUCT_GRIP_SVG   = '<svg viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="1.5" r="1"/><circle cx="6" cy="1.5" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10.5" r="1"/><circle cx="6" cy="10.5" r="1"/></svg>';
var _STRUCT_CHEV_SVG   = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5,3.5 5,6.5 7.5,3.5"/></svg>';

// role is optional metadata carried on built-in Heist nodes so the host-side
// sorter can still find e.g. "the PSD folder" after the user renames it —
// custom folders (role: null) fall back to name-based matching in host.jsx.
function _structMakeNode(name, role, children) {
    return { id: 'n' + (_structNodeSeq++), name: name, role: role || null, children: children || [] };
}

function _structHeistTree() {
    return [
        _structMakeNode('1.COMPS', null, [
            _structMakeNode('1.MASTER', null),
            _structMakeNode('2.BUILD', null),
            _structMakeNode('3.PRECOMPS', 'precomps')
        ]),
        _structMakeNode('2.ASSETS', null, [
            _structMakeNode('3D_RENDERS', null),
            _structMakeNode('AE_RENDERS', null),
            _structMakeNode('ARTWORK', null, [
                _structMakeNode('AI', 'ai'),
                _structMakeNode('PSD', 'psd')
            ]),
            _structMakeNode('AUDIO', 'audio'),
            _structMakeNode('FOOTAGE', 'footage'),
            _structMakeNode('IMAGES', 'images')
        ]),
        _structMakeNode('3.IMPORTED', null, [
            _structMakeNode('AE_PROJECTS', 'imported'),
            _structMakeNode('C4D_SCENES', 'c4d')
        ]),
        _structMakeNode('4.REFERENCES', null, [
            _structMakeNode('BOARDS', null),
            _structMakeNode('OFFLINES', null),
            _structMakeNode('STYLEFRAMES', null)
        ])
    ];
}

function _structHeistPreset() { return { name: 'Heist', tree: _structHeistTree() }; }

function _structCloneTree(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
        out.push({ id: nodes[i].id, name: nodes[i].name, role: nodes[i].role, children: _structCloneTree(nodes[i].children || []) });
    }
    return out;
}

function _structClonePresets(presets) {
    var out = [];
    for (var i = 0; i < presets.length; i++) out.push({ name: presets[i].name, tree: _structCloneTree(presets[i].tree) });
    return out;
}

// Persisted node ids restart from 0 each session — seed the counter past
// whatever's already saved so newly-added nodes can't collide with them.
function _structSeedSeq() {
    var max = 0;
    function walk(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var m = /^n(\d+)$/.exec(nodes[i].id);
            if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
            walk(nodes[i].children || []);
        }
    }
    for (var i = 0; i < _structPresets.length; i++) walk(_structPresets[i].tree);
    _structNodeSeq = max + 1;
}

function _loadStructPresets() {
    var raw = null;
    try { raw = localStorage.getItem('lineup-structure-presets'); } catch(e) {}
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch(e) {} }
    if (parsed && parsed.presets && parsed.presets.length) {
        _structPresets   = parsed.presets;
        _structActiveIdx = (typeof parsed.activeIndex === 'number' && parsed.activeIndex < _structPresets.length) ? parsed.activeIndex : 0;
    } else {
        _structPresets   = [_structHeistPreset()];
        _structActiveIdx = 0;
    }
    _structSeedSeq();
}

function _saveStructPresets() {
    try {
        localStorage.setItem('lineup-structure-presets', JSON.stringify({ presets: _structPresets, activeIndex: _structActiveIdx }));
    } catch(e) {}
}

function openProjectStructure() {
    if (!_structPresets.length) _loadStructPresets();
    _structEditPresets   = _structClonePresets(_structPresets);
    _structEditActiveIdx = Math.min(_structActiveIdx, _structEditPresets.length - 1);
    _structCollapsed      = {};
    var brk = document.getElementById('structBreakCheck');
    if (brk) { try { brk.checked = localStorage.getItem('lineup-break-structure') === '1'; } catch(e) {} }
    _structRenderTabs();
    _structRenderTree();
    document.getElementById('structOverlay').classList.remove('struct-hidden');
}

function closeProjectStructure() {
    var el = document.getElementById('structOverlay');
    if (el) el.classList.add('struct-hidden');
}

function _structRenderTabs() {
    var bar = document.getElementById('structTabs');
    if (!bar) return;
    bar.innerHTML = '';
    for (var i = 0; i < _structEditPresets.length; i++) {
        (function(idx) {
            var preset = _structEditPresets[idx];
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'struct-tab' + (idx === _structEditActiveIdx ? ' active' : '');

            var lbl = document.createElement('span');
            lbl.className = 'struct-tab-lbl';
            lbl.textContent = preset.name;
            lbl.title = preset.name + ' (double-click to rename)';
            tab.appendChild(lbl);

            var del = document.createElement('span');
            del.className = 'struct-tab-del';
            del.title = 'Delete preset';
            del.innerHTML = _STRUCT_X_SVG;
            tab.appendChild(del);

            tab.addEventListener('click', function(e) {
                if (e.target === del || del.contains(e.target)) return;
                _structEditActiveIdx = idx;
                _structRenderTabs();
                _structRenderTree();
            });
            del.addEventListener('click', function(e) {
                e.stopPropagation();
                _structDeleteTab(idx);
            });
            lbl.addEventListener('dblclick', function(e) {
                e.stopPropagation();
                _structRenameTabStart(idx, lbl);
            });

            bar.appendChild(tab);
        })(i);
    }

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'struct-tab-add';
    add.title = 'Add preset';
    add.innerHTML = _STRUCT_PLUS_SVG;
    add.addEventListener('click', _structAddPreset);
    bar.appendChild(add);
}

function _structRenameTabStart(idx, lblEl) {
    var preset = _structEditPresets[idx];
    if (!preset) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'struct-tab-lbl-input';
    input.value = preset.name;
    lblEl.parentNode.replaceChild(input, lblEl);
    input.focus();
    input.select();
    function commit() {
        var v = input.value.replace(/^\s+|\s+$/g, '');
        preset.name = v || preset.name;
        _structRenderTabs();
        _structRenderTree();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); input.value = preset.name; input.blur(); }
    });
    input.addEventListener('click', function(e) { e.stopPropagation(); });
}

function _structDeleteTab(idx) {
    _structEditPresets.splice(idx, 1);
    if (_structEditPresets.length === 0) {
        _structEditPresets.push(_structHeistPreset());
        _structEditActiveIdx = 0;
    } else if (idx < _structEditActiveIdx) {
        _structEditActiveIdx--;
    } else if (_structEditActiveIdx >= _structEditPresets.length) {
        _structEditActiveIdx = _structEditPresets.length - 1;
    }
    _structRenderTabs();
    _structRenderTree();
}

function _structUniqueName(base, names) {
    var name = base, n = 2;
    function taken(nm) { for (var i = 0; i < names.length; i++) if (names[i] === nm) return true; return false; }
    while (taken(name)) { name = base + ' ' + n; n++; }
    return name;
}

function _structAddPreset() {
    var names = [];
    for (var i = 0; i < _structEditPresets.length; i++) names.push(_structEditPresets[i].name);
    var preset = { name: _structUniqueName('New Structure', names), tree: [] };
    _structEditPresets.push(preset);
    _structEditActiveIdx = _structEditPresets.length - 1;
    _structRenderTabs();
    _structRenderTree();
    var lbl = document.querySelector('#structTabs .struct-tab.active .struct-tab-lbl');
    if (lbl) _structRenameTabStart(_structEditActiveIdx, lbl);
}

function _structRenderTree() {
    var box = document.getElementById('structTreeBox');
    if (!box) return;
    box.innerHTML = '';
    var preset = _structEditPresets[_structEditActiveIdx];
    if (!preset || preset.tree.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'struct-tree-empty';
        empty.textContent = 'No folders yet — click "+ Add Folder" below.';
        box.appendChild(empty);
        return;
    }
    _structRenderNodes(preset.tree, 0, box);
}

function _structRenderNodes(nodes, depth, container) {
    for (var i = 0; i < nodes.length; i++) {
        (function(node) {
            var hasKids = !!(node.children && node.children.length);

            var row = document.createElement('div');
            row.className = 'struct-node-row';
            row.setAttribute('data-node-id', node.id);
            row.style.marginLeft = (depth * 16) + 'px';

            var handle = document.createElement('span');
            handle.className = 'struct-node-handle';
            handle.title = 'Drag to reorder or nest inside another folder';
            handle.innerHTML = _STRUCT_GRIP_SVG;
            handle.addEventListener('mousedown', function(e) { _structStartDrag(node.id, e); });
            row.appendChild(handle);

            var chevron = document.createElement('span');
            chevron.className = 'struct-node-chevron' + (hasKids ? '' : ' struct-node-chevron-empty') + (_structCollapsed[node.id] ? ' collapsed' : '');
            if (hasKids) {
                chevron.innerHTML = _STRUCT_CHEV_SVG;
                chevron.title = _structCollapsed[node.id] ? 'Expand' : 'Collapse';
                chevron.addEventListener('click', function() {
                    _structCollapsed[node.id] = !_structCollapsed[node.id];
                    _structRenderTree();
                });
            }
            row.appendChild(chevron);

            var icon = document.createElement('span');
            icon.className = 'struct-node-icon';
            icon.innerHTML = _STRUCT_FOLDER_SVG;
            row.appendChild(icon);

            var lbl = document.createElement('span');
            lbl.className = 'struct-node-lbl';
            lbl.textContent = node.name;
            lbl.title = 'Click to rename';
            lbl.addEventListener('click', function() { _structRenameNodeStart(node.id, lbl); });
            row.appendChild(lbl);

            var spacer = document.createElement('span');
            spacer.className = 'struct-node-spacer';
            row.appendChild(spacer);

            var addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'struct-node-btn';
            addBtn.title = 'Add subfolder';
            addBtn.innerHTML = _STRUCT_PLUS_SVG;
            addBtn.addEventListener('click', function() { _structAddChildFolder(node.id); });
            row.appendChild(addBtn);

            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'struct-node-btn struct-node-del';
            delBtn.title = 'Delete folder';
            delBtn.innerHTML = _STRUCT_TRASH_SVG;
            delBtn.addEventListener('click', function() { _structDeleteNode(node.id); });
            row.appendChild(delBtn);

            container.appendChild(row);
            if (hasKids && !_structCollapsed[node.id]) {
                _structRenderNodes(node.children, depth + 1, container);
            }
        })(nodes[i]);
    }
}

function _structRenameNodeStart(nodeId, lblEl) {
    var found = _structFindNode(nodeId);
    if (!found) return;
    var node = found.node;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'struct-node-lbl-input';
    input.value = node.name;
    lblEl.parentNode.replaceChild(input, lblEl);
    input.focus();
    input.select();
    function commit() {
        var v = input.value.replace(/^\s+|\s+$/g, '');
        node.name = v || node.name;
        _structRenderTree();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); input.value = node.name; input.blur(); }
    });
}

function _structFindNode(nodeId) {
    var preset = _structEditPresets[_structEditActiveIdx];
    if (!preset) return null;
    function walk(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === nodeId) return { node: nodes[i], parentArr: nodes, index: i };
            var r = walk(nodes[i].children || []);
            if (r) return r;
        }
        return null;
    }
    return walk(preset.tree);
}

function _structAddChildFolder(nodeId) {
    var found = _structFindNode(nodeId);
    if (!found) return;
    if (!found.node.children) found.node.children = [];
    var names = [];
    for (var i = 0; i < found.node.children.length; i++) names.push(found.node.children[i].name);
    var child = _structMakeNode(_structUniqueName('New Folder', names), null);
    found.node.children.push(child);
    _structRenderTree();
}

function _structAddRootFolder() {
    var preset = _structEditPresets[_structEditActiveIdx];
    if (!preset) return;
    var names = [];
    for (var i = 0; i < preset.tree.length; i++) names.push(preset.tree[i].name);
    var node = _structMakeNode(_structUniqueName('New Folder', names), null);
    preset.tree.push(node);
    _structRenderTree();
}

function _structDeleteNode(nodeId) {
    var found = _structFindNode(nodeId);
    if (!found) return;
    found.parentArr.splice(found.index, 1);
    _structRenderTree();
}

// True if candidateId is somewhere inside ancestorId's own subtree — used to
// block dropping a folder into itself or one of its own descendants.
function _structIsDescendant(candidateId, ancestorId) {
    var ancestor = _structFindNode(ancestorId);
    if (!ancestor) return false;
    function walk(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === candidateId) return true;
            if (walk(nodes[i].children || [])) return true;
        }
        return false;
    }
    return walk(ancestor.node.children || []);
}

// Moves nodeId out of its current spot and before/after/into targetId. Looks
// targetId up fresh AFTER removing the dragged node so a same-parent reorder
// (where removal shifts sibling indices) still lands in the right place.
function _structMoveNode(nodeId, targetId, mode) {
    var src = _structFindNode(nodeId);
    if (!src) return;
    src.parentArr.splice(src.index, 1);
    var node = src.node;

    var target = _structFindNode(targetId);
    if (!target) { src.parentArr.splice(src.index, 0, node); return; }

    if (mode === 'into') {
        if (!target.node.children) target.node.children = [];
        target.node.children.push(node);
    } else {
        var insertAt = target.index + (mode === 'after' ? 1 : 0);
        target.parentArr.splice(insertAt, 0, node);
    }
    _structRenderTree();
}

function _structStartDrag(nodeId, startEvent) {
    startEvent.preventDefault();
    var box = document.getElementById('structTreeBox');
    if (!box) return;

    var rowEls = Array.prototype.slice.call(box.querySelectorAll('.struct-node-row'));
    var rows = [];
    for (var i = 0; i < rowEls.length; i++) {
        rows.push({ el: rowEls[i], id: rowEls[i].getAttribute('data-node-id'), rect: rowEls[i].getBoundingClientRect() });
    }

    var dragIdx = -1, draggedRow = null, draggedRect = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].id === nodeId) { dragIdx = i; draggedRow = rows[i].el; draggedRect = rows[i].rect; }
    if (!draggedRow) return;
    var rowH = draggedRect.height;

    // Floating preview clone that tracks the cursor — same treatment as the
    // Settings section-reorder drag, so dragging a folder on top of another
    // one to nest it reads the same way that reorder does.
    var ghost = draggedRow.cloneNode(true);
    ghost.className = 'struct-node-row struct-node-ghost';
    ghost.style.cssText = [
        'position:fixed',
        'left:' + draggedRect.left + 'px',
        'top:'  + draggedRect.top  + 'px',
        'width:' + draggedRect.width + 'px',
        'margin-left:0',
        'pointer-events:none',
        'z-index:2000'
    ].join(';');
    document.body.appendChild(ghost);

    // Hide the original row in place — keeps its slot as a fixed gap that the
    // other rows slide around, same technique as the Settings section drag.
    draggedRow.style.visibility = 'hidden';

    var startY = startEvent.clientY, originTop = draggedRect.top;
    var lastTarget = null, lastMode = null;

    function clearShifts() {
        for (var i = 0; i < rows.length; i++) rows[i].el.style.transform = '';
    }

    // Only before/after (sibling reorder) opens a gap — "into" just highlights
    // the target row itself since nothing is being inserted between siblings.
    function applyShifts(insertIdx) {
        for (var i = 0; i < rows.length; i++) {
            if (i === dragIdx) continue;
            var dy = 0;
            if (insertIdx > dragIdx && i > dragIdx && i < insertIdx) dy = -rowH;
            if (insertIdx <= dragIdx && i >= insertIdx && i < dragIdx) dy = rowH;
            rows[i].el.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
        }
    }

    function onMove(ev) {
        ghost.style.top = (originTop + ev.clientY - startY) + 'px';

        if (lastTarget) lastTarget.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');
        lastTarget = null; lastMode = null;

        var targetIdx = -1, mode = null;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i].rect;
            if (ev.clientY < r.top || ev.clientY > r.bottom) continue;
            if (i === dragIdx || _structIsDescendant(rows[i].id, nodeId)) break;
            // Thin edges reorder as a sibling; the wide middle band nests the
            // dragged folder inside whatever row it's dropped on top of.
            var frac = (ev.clientY - r.top) / r.height;
            mode = frac < 0.2 ? 'before' : (frac > 0.8 ? 'after' : 'into');
            targetIdx = i;
            break;
        }

        if (targetIdx === -1) { clearShifts(); return; }

        rows[targetIdx].el.classList.add('drag-over-' + mode);
        lastTarget = rows[targetIdx].el; lastMode = mode;

        if (mode === 'into') clearShifts();
        else applyShifts(mode === 'after' ? targetIdx + 1 : targetIdx);
    }

    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        var targetEl = lastTarget, mode = lastMode;
        if (lastTarget) lastTarget.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');
        clearShifts();
        ghost.remove();
        draggedRow.style.visibility = '';
        if (targetEl && mode) {
            _structMoveNode(nodeId, targetEl.getAttribute('data-node-id'), mode);
        }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function _structRestoreDefault() {
    for (var i = 0; i < _structEditPresets.length; i++) {
        if (_structEditPresets[i].name === 'Heist') {
            _structEditPresets[i].tree = _structHeistTree();
            _structEditActiveIdx = i;
            _structRenderTabs();
            _structRenderTree();
            return;
        }
    }
    _structEditPresets.push(_structHeistPreset());
    _structEditActiveIdx = _structEditPresets.length - 1;
    _structRenderTabs();
    _structRenderTree();
}

function applyProjectStructure() {
    var preset = _structEditPresets[_structEditActiveIdx];
    if (!preset) return;
    var breakStructure = chkVal('structBreakCheck');

    _structPresets   = _structClonePresets(_structEditPresets);
    _structActiveIdx = _structEditActiveIdx;
    _saveStructPresets();
    try { localStorage.setItem('lineup-break-structure', breakStructure ? '1' : '0'); } catch(e) {}

    var treeJson = JSON.stringify(preset.tree);
    var escaped  = treeJson.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    closeProjectStructure();
    run("lineup_configureProjectStructure('" + escaped + "'," + breakStructure + ")", function(result) {
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

    // Favorites: load persisted state, render bar, wire up right-click context menus
    _loadFavorites();
    _renderFavBar();
    var _pickerFavIds = { 'dist-z': 1, 'dist-path': 1, 'dist-radial': 1, 'dist-grid': 1 };
    var _favBtns = document.querySelectorAll('[data-fav-id]:not([data-fav-clone])');
    for (var _fi = 0; _fi < _favBtns.length; _fi++) {
        (function(btn) {
            var fid = btn.getAttribute('data-fav-id');
            if (_pickerFavIds[fid]) return; // picker buttons get star inside their popup
            btn.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                _openFavCtx(btn, e.clientX, e.clientY);
            });
        })(_favBtns[_fi]);
    }

    var scaleEl = document.getElementById('scaleSlider');
    if (scaleEl) {
        scaleEl.addEventListener('input', function() {
            var val = parseInt(scaleEl.value, 10);
            applyScale(val);
            try { localStorage.setItem('lineup-scale', val); } catch(e) {}
        });
    }

    // Restrict numeric inputs
    ['marginInput','radialInput','gridColsInput','gridRowsInput','gridHPadInput','gridVPadInput','autoCropPad'].forEach(function(id) {
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

    // Path distribute button: right-click → spacing/rotation picker
    var pathDistBtn = document.getElementById('pathDistBtn');
    if (pathDistBtn) {
        pathDistBtn.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            _openPathPicker(e.clientX, e.clientY);
        });
    }

    // Project Structure: load persisted presets so the modal has data ready
    _loadStructPresets();

});
