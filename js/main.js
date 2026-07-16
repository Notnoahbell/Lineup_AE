/* Lineup CEP — Panel JavaScript */

var cs = new CSInterface();

// ── Tabs (Home / Tools / Settings) ─────────────────────────────────────────────

function switchTab(name) {
    ['home', 'tools', 'settings'].forEach(function(n) {
        var panel = document.getElementById(n === 'home' ? 'panel-content' : 'tab-' + n);
        if (panel) panel.classList.toggle('active', n === name);
        var btn = document.getElementById('tabBtn-' + n);
        if (btn) btn.classList.toggle('active', n === name);
    });
    try { localStorage.setItem('lineup-active-tab', name); } catch(e) {}

    // Refresh the Classic Sections list whenever Settings comes into view —
    // hidden state may have changed via Compact's editor since it was last
    // rendered, and this is cheap enough to just rebuild unconditionally.
    if (name === 'settings') {
        var clsBlock = document.getElementById('classicSettingsBlock');
        if (clsBlock && clsBlock.style.display !== 'none') _renderClassicSettingsList();
    }
}

function restoreActiveTab() {
    var name;
    try { name = localStorage.getItem('lineup-active-tab'); } catch(e) {}
    if (name === 'tools' || name === 'settings') switchTab(name);
}

// ── Home layout ──────────────────────────────────────────────────────────────
// Compact's bento boards are two separate 6-column CSS Grids: #homeTopGroup
// (Anchor, Quick Actions, and the Favorite slot — see _favApplyLayout) and
// #homeGrid (Align / Distribute / Sizing / Auto Crop / Sort / Quick Actions
// 2 / Spell Check / Ease Copy, user-reorderable via the Bottom Layout edit
// mode — see _blApplyLayout). --home-anchor-unit, set on #homeTopGroup,
// keeps rowspan-1 boxes there sized to half of Anchor's own rendered
// height, since Anchor's size changes with panel width/zoom.

function _homeBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll('#homeTopGroup .tool-box[data-block-id], #homeGrid .tool-box[data-block-id]'));
}

// Sums each child of Anchor's own tool-body (icon grid, divider, mode-line
// row) rather than reading the tool-body's own rendered height, which can
// be stretched taller by a tall neighbor sharing its grid row-track.
// Narrow stack lays these children out as a row instead (grid left,
// controls right — see the CSS), so summing them there would wildly
// overstate the natural height; the tallest child is the real height in
// that layout, same as any other row of same-height-cross-axis items.
function _anchorNaturalHeight() {
    var toolBox = document.querySelector('.tool-box[data-block-id="anchor"]');
    var body    = document.querySelector('.tool-body[data-block-id="anchor"]');
    if (!toolBox || !body) return 0;
    var boxCs = getComputedStyle(toolBox);
    var padding = (parseFloat(boxCs.paddingTop) || 0) + (parseFloat(boxCs.paddingBottom) || 0);

    if (_narrowStack) {
        var max = 0;
        Array.prototype.forEach.call(body.children, function(child) {
            var h = child.getBoundingClientRect().height;
            if (h > max) max = h;
        });
        return max + padding;
    }

    var gap = parseFloat(getComputedStyle(body).rowGap) || 0;
    var total = 0;
    Array.prototype.forEach.call(body.children, function(child, i) {
        if (i > 0) total += gap;
        total += child.getBoundingClientRect().height;
    });
    total += padding;
    return total;
}

function _syncAnchorRowUnit() {
    var grid = document.getElementById('homeTopGroup');
    var h = _anchorNaturalHeight();
    if (grid && h > 0) grid.style.setProperty('--home-anchor-unit', (h / 2) + 'px');
}

// Watches #homeTopGroup's width so a panel resize or zoom change re-derives
// Anchor's height immediately; fires once on observe with the current size.
function _initAnchorRowUnit() {
    var grid = document.getElementById('homeTopGroup');
    if (!grid || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(function() { _syncAnchorRowUnit(); }).observe(grid);
}

// ── Narrow stack ─────────────────────────────────────────────────────────────
// Below NARROW_STACK_THRESHOLD, every widget — including the top group
// (Anchor/Quick Actions/Favorite) — renders full width and stacks, no more
// half-width pairs. Purely a display-time override: _blApplyLayout (see
// below) still computes each widget's real stored span from _blGetRows()
// first and only forces it to 6 afterward when _narrowStack is on, so
// nothing here ever touches what's actually saved — widening back past the
// threshold re-applies the original pairing untouched. The top group's own
// stacking is handled in CSS alone (#homeToolGrid.narrow-stack #homeTopGroup
// .tool-box), since it isn't part of the rows/pack system at all.
var NARROW_STACK_THRESHOLD = 330;
var _narrowStack = false;

function _syncNarrowStack() {
    var grid = document.getElementById('homeToolGrid');
    if (!grid) return;
    var isNarrow = grid.getBoundingClientRect().width < NARROW_STACK_THRESHOLD;
    if (isNarrow === _narrowStack) return;
    _narrowStack = isNarrow;
    grid.classList.toggle('narrow-stack', isNarrow);
    _blApplyLayout(); // re-syncs quickactions2's placeholders too (see its tail)
    // _blApplyLayout only re-syncs quickactions2 (it's the one that's
    // actually part of that rows/pack system) — the original top-group bar
    // needs the same nudge directly, since its own shape just changed too.
    var qaMainGrid = document.getElementById(QA_INSTANCES.main.gridId);
    if (qaMainGrid) _qaSyncAddTiles('main', qaMainGrid);
    // #homeTopGroup's own ResizeObserver (see _initAnchorRowUnit) reacts to
    // ITS width changing, not to Anchor's children re-flowing from column
    // to row internally — that reflow is a same-tick side effect of this
    // same resize, not a further size change of #homeTopGroup itself, so
    // it may never re-fire on its own. Recomputing here directly is what
    // actually picks up _anchorNaturalHeight's now-narrow-aware reading.
    _syncAnchorRowUnit();
}

function _initNarrowStack() {
    var grid = document.getElementById('homeToolGrid');
    if (!grid || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(function() { _syncNarrowStack(); }).observe(grid);
}

// ── Layout mode (Compact / Classic) ──────────────────────────────────────────
// Compact is the bento peg-board above (#homeGrid); Classic is the original
// collapsible-section layout (#homeClassic, its sibling in the markup). Both
// drive the exact same underlying controls: each tool's actual guts live in
// one .tool-body[data-block-id] node, physically relocated between its
// Compact tool-box and its Classic section-body whenever the mode switches —
// so nothing here ever needs two copies of an id or an onclick handler.
var CLASSIC_BLOCK_IDS = ['anchor', 'organize', 'ease', 'align', 'distribute', 'sizing', 'autocrop', 'sort'];

function setLayoutMode(mode) {
    if (mode !== 'classic') mode = 'compact';
    try { localStorage.setItem('lineup-layout-mode', mode); } catch(e) {}
    _applyLayoutMode(mode);
}

function restoreLayoutMode() {
    var mode;
    try { mode = localStorage.getItem('lineup-layout-mode'); } catch(e) {}
    _applyLayoutMode(mode === 'classic' ? 'classic' : 'compact');
}

function _applyLayoutMode(mode) {
    var isClassic   = mode === 'classic';
    var compactGrid = document.getElementById('homeGrid');
    var compactTop  = document.getElementById('homeTopGroup');
    var classicGrid = document.getElementById('homeClassic');
    var clsBlock    = document.getElementById('classicSettingsBlock');

    CLASSIC_BLOCK_IDS.forEach(function(id) {
        var body = document.querySelector('.tool-body[data-block-id="' + id + '"]');
        if (!body) return;
        if (isClassic) {
            var target = document.querySelector('#homeClassic .section-body[data-body-for="' + id + '"]');
            if (target && body.parentElement !== target) target.appendChild(body);
        } else if (id === 'organize') {
            // Compact never shows Organize's original controls — it has its
            // own independent, freely-customizable Quick Actions widget
            // instead (#sec-quick-actions, see _renderQuickActions), which
            // shares no markup with Classic's Organize section. The
            // original body just sits stashed here, unused, so Classic can
            // still relocate and show it exactly as before.
            var stash = document.getElementById('sec-organize-original');
            if (stash && body.parentElement !== stash) stash.appendChild(body);
        } else {
            var box = document.querySelector('.tool-box[data-block-id="' + id + '"]');
            if (!box || body.parentElement === box) return;
            box.appendChild(body);
        }
    });

    // Null/Copy-Paste has no Compact home of its own (it's permanently
    // hidden there, kept in #sec-nullcp) — in Classic it docks beside the
    // Anchor grid instead, matching the original layout. Runs after the
    // loop above so #anchorRow (part of Anchor's own relocated tool-body)
    // is already wherever it needs to be for this call.
    var nullcp = document.querySelector('.cp-panel[data-block-id="nullcp"]');
    var anchorRow = document.getElementById('anchorRow');
    if (nullcp && anchorRow) {
        var nullcpHome = isClassic ? anchorRow : document.getElementById('sec-nullcp');
        if (nullcpHome && nullcp.parentElement !== nullcpHome) nullcpHome.appendChild(nullcp);
    }

    if (compactGrid) compactGrid.style.display = isClassic ? 'none' : '';
    if (compactTop)   compactTop.style.display  = isClassic ? 'none' : '';
    if (classicGrid) classicGrid.style.display = isClassic ? '' : 'none';
    if (clsBlock)     clsBlock.style.display    = isClassic ? '' : 'none';

    // The Favorite slot only exists in Compact — Classic already moved
    // everything above into its own section-bodies, nothing left to do here.
    if (!isClassic) _favApplyLayout();

    document.querySelectorAll('.layout-mode-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });

    _applySharedHiddenState();
    if (isClassic) _renderClassicSettingsList();
}

// ── Classic section collapse/expand ──────────────────────────────────────────

function toggleClassicSection(id) {
    var hdr  = document.querySelector('#cls-' + id + ' .section-hdr');
    var body = document.querySelector('#cls-' + id + ' .section-body');
    if (!hdr || !body) return;
    var collapsed = body.classList.toggle('hidden');
    hdr.classList.toggle('collapsed', collapsed);
    try { localStorage.setItem('lineup-cls-sec-' + id, collapsed ? '1' : '0'); } catch(e) {}
}

function restoreClassicCollapsed() {
    CLASSIC_BLOCK_IDS.forEach(function(id) {
        var stored;
        try { stored = localStorage.getItem('lineup-cls-sec-' + id); } catch(e) {}
        if (stored === '1') {
            var hdr  = document.querySelector('#cls-' + id + ' .section-hdr');
            var body = document.querySelector('#cls-' + id + ' .section-body');
            if (hdr)  hdr.classList.add('collapsed');
            if (body) body.classList.add('hidden');
        }
    });
}

// ── Shared hidden-module state ───────────────────────────────────────────────
// Single source of truth for "which tools are hidden," set from Classic's
// Sections list and applied to both layouts — hiding something there hides
// it in Compact's fixed grid too.

function _getHiddenBlockIds() {
    var ids;
    try { ids = JSON.parse(localStorage.getItem('lineup-hidden-blocks')); } catch(e) {}
    return Array.isArray(ids) ? ids : [];
}

function _commitHiddenBlockIds(ids) {
    try { localStorage.setItem('lineup-hidden-blocks', JSON.stringify(ids)); } catch(e) {}
    _applySharedHiddenState();
}

function _applySharedHiddenState() {
    var hidden = _getHiddenBlockIds();
    _homeBoxes().forEach(function(box) {
        var id = box.getAttribute('data-block-id');
        box.classList.toggle('home-hidden', hidden.indexOf(id) !== -1);
    });
    CLASSIC_BLOCK_IDS.forEach(function(id) {
        var sec = document.getElementById('cls-' + id);
        if (sec) sec.classList.toggle('sec-hidden', hidden.indexOf(id) !== -1);
    });
}

// ── High Contrast Mode ──────────────────────────────────────────────────────────

function toggleHighContrast(on) {
    document.body.classList.toggle('high-contrast', !!on);
    try { localStorage.setItem('lineup-high-contrast', on ? '1' : '0'); } catch(e) {}
}

function restoreHighContrast() {
    var on;
    try { on = localStorage.getItem('lineup-high-contrast') === '1'; } catch(e) { on = false; }
    if (on) {
        document.body.classList.add('high-contrast');
        var chk = document.getElementById('highContrastCheck');
        if (chk) chk.checked = true;
    }
}

// ── Tools search + filter groups ─────────────────────────────────────────────────

var _toolsFilter = 'all';

function setToolsFilter(name) {
    _toolsFilter = name;
    var btns = document.querySelectorAll('.tools-filter-btn');
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].getAttribute('data-filter') === name);
    }
    applyToolsFilter();
}

function applyToolsFilter() {
    var input = document.getElementById('toolsSearchInput');
    var q = input ? input.value.trim().toLowerCase() : '';
    var tiles = document.querySelectorAll('.tools-grid-btn');
    for (var i = 0; i < tiles.length; i++) {
        var tile = tiles[i];
        var title = (tile.getAttribute('title') || '').toLowerCase();
        var group = tile.getAttribute('data-group') || '';
        var matchesGroup  = _toolsFilter === 'all' || group === _toolsFilter;
        var matchesSearch = q.length === 0 || title.indexOf(q) !== -1;
        tile.classList.toggle('tools-grid-btn-hidden', !(matchesGroup && matchesSearch));
    }
}

function initToolsSearch() {
    var input = document.getElementById('toolsSearchInput');
    if (!input) return;
    input.addEventListener('input', applyToolsFilter);
}

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
    var mode       = selVal('distMode');
    var offsetKeys = chkVal('distOffsetCheck');
    // Key Layer mode always lines layers up back to back — no user-set spacing.
    run('lineup_distribute(' + horizontal + ',' + mode + ',0,' + offsetKeys + ')');
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
            document.querySelector('#easeDisplay .ease-display-text').textContent = result;
            document.getElementById('easePasteBtn').disabled = false;
        }
        _easePreviewFetch();
    });
}

function doEasePaste() {
    run('lineup_easePaste()', function(result) { showToast(result, 'info'); });
}

// The display box now doubles as its own clear button (see #easeDisplay in
// index.html) — textContent is set on the nested .ease-display-text span,
// not the div itself, since the div also holds the hover-only trash icon svg.
function doEaseClear() {
    run('lineup_easeClear()', function() {
        document.querySelector('#easeDisplay .ease-display-text').textContent = '—';
        document.getElementById('easePasteBtn').disabled = true;
        _easePreviewRender(null);
    });
}

// ── Ease preview (live curve + speed graph) ─────────────────────────────────
// Only ever visible at half width (see the CSS on .ease-preview) — a value
// curve with a dot at each copied keyframe, plus a speed (velocity) graph
// beneath it that can dip negative wherever the interpolation temporarily
// reverses (e.g. a strong ease-out overshoot). Reconstructs the same
// speed/influence -> bezier handles AE's own graph editor uses (see
// _easeSegmentSamples), sampling each segment as a parametric curve rather
// than trying to invert time -> value, which sidesteps needing to solve the
// cubic for a given time. Multi-dimensional properties (Position, Scale,
// etc.) collapse to their first dimension — one representative curve rather
// than plotting several.
var EASE_PREVIEW_SAMPLES = 24; // per segment
var EASE_PREVIEW_W = 200;
var EASE_PREVIEW_H = 100;

// host.jsx's ExtendScript engine keeps _easeClipboard alive for the whole
// AE session — this is how a freshly (re)loaded panel picks back up
// whatever was already copied before it loaded.
function _easePreviewFetch() {
    run('lineup_easeGetClipboard()', function(result) {
        var data = null;
        try { data = JSON.parse(result); } catch(e) {}
        _easePreviewRender(Array.isArray(data) ? data : null);
    });
}

function _easeBezierPoint(p0, p1, p2, p3, u) {
    var mu = 1 - u;
    return mu*mu*mu*p0 + 3*mu*mu*u*p1 + 3*mu*u*u*p2 + u*u*u*p3;
}
function _easeBezierDeriv(p0, p1, p2, p3, u) {
    var mu = 1 - u;
    return 3*mu*mu*(p1 - p0) + 6*mu*u*(p2 - p1) + 3*u*u*(p3 - p2);
}

// A keyframe's dimension-0 value, whether it was copied as a plain number
// (Opacity, Rotation) or a per-dimension array (Position, Scale, ...).
function _easeDim0(v) {
    if (Array.isArray(v)) return v.length ? v[0] : 0;
    return typeof v === 'number' ? v : 0;
}

// Samples between two consecutive copied keyframes as {t, v, speed} triples
// — t/v walk the parametric bezier directly (exact, no time->value
// inversion needed) and speed is dv/dt = (dv/du)/(dt/du) at that point,
// which is what can legitimately go negative on a strong overshoot.
function _easeSegmentSamples(kA, kB) {
    var tA = kA.time, tB = kB.time, dt = tB - tA;
    if (!(typeof tA === 'number' && typeof tB === 'number' && dt > 0)) return [];
    var vA = _easeDim0(kA.value), vB = _easeDim0(kB.value);
    var out = [];

    if (kA.outType === 'hold') {
        for (var i = 0; i <= EASE_PREVIEW_SAMPLES; i++) {
            out.push({ t: tA + (i / EASE_PREVIEW_SAMPLES) * dt, v: vA, speed: 0 });
        }
        return out;
    }
    if (kA.outType === 'linear' && kB.inType === 'linear') {
        var linSpeed = (vB - vA) / dt;
        for (var j = 0; j <= EASE_PREVIEW_SAMPLES; j++) {
            var uu = j / EASE_PREVIEW_SAMPLES;
            out.push({ t: tA + uu * dt, v: vA + (vB - vA) * uu, speed: linSpeed });
        }
        return out;
    }

    // Bezier (or Bezier mixed with Linear on one side) — reconstruct the
    // handle positions from speed/influence the same way AE does; a
    // missing/non-Bezier side falls back to a neutral 1/3 influence, 0 speed.
    var outE = (kA.outEase && kA.outEase[0]) || { speed: 0, influence: 100 / 3 };
    var inE  = (kB.inEase  && kB.inEase[0])  || { speed: 0, influence: 100 / 3 };
    var t1 = tA + (outE.influence / 100) * dt;
    var v1 = vA + outE.speed * (t1 - tA);
    var t2 = tB - (inE.influence / 100) * dt;
    var v2 = vB - inE.speed * (tB - t2);

    for (var k = 0; k <= EASE_PREVIEW_SAMPLES; k++) {
        var u = k / EASE_PREVIEW_SAMPLES;
        var t = _easeBezierPoint(tA, t1, t2, tB, u);
        var v = _easeBezierPoint(vA, v1, v2, vB, u);
        var dtdu = _easeBezierDeriv(tA, t1, t2, tB, u);
        var dvdu = _easeBezierDeriv(vA, v1, v2, vB, u);
        out.push({ t: t, v: v, speed: Math.abs(dtdu) > 1e-6 ? (dvdu / dtdu) : 0 });
    }
    return out;
}

function _easePreviewRender(data) {
    var box = document.getElementById('easePreview');
    if (!box) return;
    var keys = Array.isArray(data) ? data.filter(function(k) { return typeof k.time === 'number'; }) : [];
    keys.sort(function(a, b) { return a.time - b.time; });

    if (keys.length < 2) {
        box.classList.add('is-empty');
        return;
    }
    box.classList.remove('is-empty');

    var segments = [];
    for (var i = 0; i < keys.length - 1; i++) segments.push(_easeSegmentSamples(keys[i], keys[i + 1]));

    var allSamples = [].concat.apply([], segments);
    if (!allSamples.length) { box.classList.add('is-empty'); return; }

    var tMin = keys[0].time, tMax = keys[keys.length - 1].time, tSpan = (tMax - tMin) || 1;
    var vMin = Infinity, vMax = -Infinity, speedAbsMax = 0;
    allSamples.forEach(function(s) {
        if (s.v < vMin) vMin = s.v;
        if (s.v > vMax) vMax = s.v;
        if (Math.abs(s.speed) > speedAbsMax) speedAbsMax = Math.abs(s.speed);
    });
    var vSpan = (vMax - vMin) || 1;

    var VALUE_TOP = 4, VALUE_H = EASE_PREVIEW_H * 0.55;
    var SPEED_MID = EASE_PREVIEW_H * 0.78, SPEED_H = EASE_PREVIEW_H * 0.2;

    function xOf(t) { return ((t - tMin) / tSpan) * EASE_PREVIEW_W; }
    function yOfValue(v) { return VALUE_TOP + VALUE_H - ((v - vMin) / vSpan) * VALUE_H; }
    function yOfSpeed(s) { return speedAbsMax > 0 ? (SPEED_MID - (s / speedAbsMax) * SPEED_H) : SPEED_MID; }

    var valuePath = '';
    allSamples.forEach(function(s, i) {
        valuePath += (i === 0 ? 'M' : 'L') + xOf(s.t).toFixed(2) + ',' + yOfValue(s.v).toFixed(2) + ' ';
    });

    function speedAreaPath(clampFn) {
        var d = 'M' + xOf(allSamples[0].t).toFixed(2) + ',' + SPEED_MID.toFixed(2) + ' ';
        allSamples.forEach(function(s) {
            d += 'L' + xOf(s.t).toFixed(2) + ',' + yOfSpeed(clampFn(s.speed)).toFixed(2) + ' ';
        });
        d += 'L' + xOf(allSamples[allSamples.length - 1].t).toFixed(2) + ',' + SPEED_MID.toFixed(2) + ' Z';
        return d;
    }

    var zeroLine = document.getElementById('easePreviewZeroLine');
    if (zeroLine) {
        zeroLine.setAttribute('y1', SPEED_MID); zeroLine.setAttribute('y2', SPEED_MID);
        zeroLine.setAttribute('x2', EASE_PREVIEW_W);
    }
    var valueEl = document.getElementById('easePreviewValuePath');
    if (valueEl) valueEl.setAttribute('d', valuePath.trim());
    var posEl = document.getElementById('easePreviewSpeedPos');
    if (posEl) posEl.setAttribute('d', speedAreaPath(function(s) { return Math.max(0, s); }));
    var negEl = document.getElementById('easePreviewSpeedNeg');
    if (negEl) negEl.setAttribute('d', speedAreaPath(function(s) { return Math.min(0, s); }));

    var pointsG = document.getElementById('easePreviewPoints');
    if (pointsG) {
        pointsG.innerHTML = '';
        keys.forEach(function(k) {
            var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', xOf(k.time).toFixed(2));
            c.setAttribute('cy', yOfValue(_easeDim0(k.value)).toFixed(2));
            c.setAttribute('r', 2.4);
            pointsG.appendChild(c);
        });
    }
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

// descend is passed directly from whichever of the two direction buttons
// was clicked (0 = ascending, 1 = descending) rather than read from a
// separate toggle's stored state. The Group-into-a-null option was removed
// as an unnecessary control — lineup_sortLayers still accepts it, so this
// just always passes 0 (its old default/unchecked state).
function doSort(descend) {
    var propIdx = selVal('sortProp');
    var axisIdx = selVal('sortAxis');
    run('lineup_sortLayers(' + propIdx + ',' + axisIdx + ',' + descend + ',0)');
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

// ── Quick Actions (Compact-only, customizable) ───────────────────────────────
// A freely editable icon grid — add or remove any tool from the Tools tab
// catalog. Independent of Classic's Organize section (which keeps its own
// fixed controls, stashed at #sec-organize-original while Compact is
// active — see the 'organize' special case in _applyLayoutMode); the two
// share no markup, so customizing one never touches the other.
//
// Generalized to support more than one bar — QA_INSTANCES holds one entry
// per grid (storage key + DOM id + its own default pins), keyed by the id
// _blApplyLayout uses for the widget as a whole ('main' for the original
// bar up top, 'quickactions2' for the second one addable down in Bottom
// Layout). Every function below takes that key as its first argument.
//
// _editMode is the single flag driving BOTH this and Bottom Layout's
// drag-reorder (see _toggleEditMode) — one pencil, one board-editing
// state, both editable at once.

var QA_INSTANCES = {
    main: {
        storageKey: 'lineup-quick-actions',
        gridId: 'quickActionsGrid',
        defaultIds: ['duplicateCompDeep', 'consolidateProject', 'projectStructure', 'batchCompSettings', 'batchRename', 'compExport']
    },
    quickactions2: {
        storageKey: 'lineup-quick-actions-2',
        gridId: 'quickActionsGrid2',
        defaultIds: []
    }
};
var QA_MAX         = 6; // 'main' bar only — fixed size, always a 3-wide, 2-row cap (3x2), never 3x3
var _editMode        = false;

// 'main' (top group) keeps the same 3x2 cap (3 cols, 2 rows) — same shape
// quickactions2 uses at half width, never the taller 3x3/9 it briefly had —
// except narrow-stack, which forces the whole top group (including this
// bar) full width, where it switches to 6-wide/one-line same as
// quickactions2 does there.
// 'quickactions2' lives in Bottom Layout and can be docked full-width (6 cols,
// capped at one row) or half-width (3 cols, capped at two rows) — either way
// that caps out at 6 tiles, so switching between them never truncates pins.
function _qaGridShape(instKey) {
    if (instKey !== 'quickactions2') return _narrowStack ? { cols: 6, max: QA_MAX } : { cols: 3, max: QA_MAX };
    // The Favorite slot matches whatever shape this bar would have if
    // simply docked at that same width in Bottom Layout (see the CSS): 3x2
    // normally, since the slot itself is always half-width of the top
    // group, or 6-wide/one-line once narrow-stack forces the whole top
    // group (and so the slot) full width instead.
    if (document.querySelector('#sec-favorite .fav-page[data-fav-id="quickactions2"]')) {
        return _narrowStack ? { cols: 6, max: 6 } : { cols: 3, max: 6 };
    }
    var box = _blBoxEl(instKey);
    var span = box ? box.getAttribute('data-span') : '3';
    return span === '6' ? { cols: 6, max: 6 } : { cols: 3, max: 6 };
}
var _qaPopover       = null;
var _qaPopoverInput  = null;
var _qaPopoverGrid   = null;

// Every tool that can be pinned — the Tools tab's own tiles, cloned rather
// than duplicated by hand so Quick Actions can never drift out of sync with
// what's actually available there. Shared by every bar instance.
function _qaCatalog() {
    return Array.prototype.slice.call(document.querySelectorAll('#tab-tools .tools-grid-btn[data-tool-id]'));
}

function _qaGetPinned(instKey) {
    var inst = QA_INSTANCES[instKey];
    var ids;
    try { ids = JSON.parse(localStorage.getItem(inst.storageKey)); } catch(e) {}
    if (!Array.isArray(ids)) ids = inst.defaultIds.slice();
    var validIds = _qaCatalog().map(function(t) { return t.getAttribute('data-tool-id'); });
    return ids.filter(function(id) { return validIds.indexOf(id) !== -1; }).slice(0, _qaGridShape(instKey).max); // drop stale ids + enforce this bar's cap
}

function _qaSavePinned(instKey, ids) {
    try { localStorage.setItem(QA_INSTANCES[instKey].storageKey, JSON.stringify(ids)); } catch(e) {}
}

var _qaCloneSeq = 0;

// A couple of catalog icons (e.g. Scan All Compositions) use an internal
// SVG <mask id="..."> referenced via url(#id) — cloneNode duplicates that
// id verbatim, and once two elements share an id, url(#id) resolution
// becomes ambiguous (usually snapping to whichever copy comes first in the
// document), breaking the icon on whichever tile got cloned. Renaming both
// ends of the reference the same way on every clone avoids that.
function _qaCloneCatalogTile(source) {
    var clone = source.cloneNode(true);
    var mask = clone.querySelector('mask[id]');
    if (mask) {
        var oldId = mask.id;
        var newId = oldId + '-qa' + (_qaCloneSeq++);
        mask.id = newId;
        Array.prototype.forEach.call(clone.querySelectorAll('[mask]'), function(el) {
            if (el.getAttribute('mask') === 'url(#' + oldId + ')') el.setAttribute('mask', 'url(#' + newId + ')');
        });
    }
    return clone;
}

// One Quick Actions tile — same icon/title/onclick as its Tools-tab source,
// icon-only (label stripped), plus the edit-mode remove badge.
function _qaBuildTile(instKey, id) {
    var source = _qaCatalog().filter(function(t) { return t.getAttribute('data-tool-id') === id; })[0];
    if (!source) return null;
    var tile = _qaCloneCatalogTile(source);
    tile.classList.remove('tools-grid-btn');
    tile.classList.add('quick-actions-btn');
    tile.removeAttribute('data-group');
    var lbl = tile.querySelector('span');
    if (lbl) lbl.remove();

    var removeBtn = document.createElement('span');
    removeBtn.className = 'quick-actions-remove';
    removeBtn.title = 'Remove from Quick Actions';
    removeBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="6.3" fill="#1c1c1c" stroke="#3a3a3a" stroke-width="1"/><line x1="4.8" y1="4.8" x2="9.2" y2="9.2"/><line x1="9.2" y1="4.8" x2="4.8" y2="9.2"/></svg>';
    removeBtn.onclick = function(e) {
        e.stopPropagation();
        e.preventDefault();
        _qaRemove(instKey, id);
    };
    tile.appendChild(removeBtn);
    return tile;
}

function _qaCreateAddTile(instKey) {
    var addTile = document.createElement('button');
    addTile.className = 'quick-actions-add-tile';
    addTile.title = 'Add a Quick Action';
    addTile.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>';
    addTile.onclick = function() { _qaOpenAddPopover(instKey, this); };
    return addTile;
}

// How many total slots (real + placeholder) should be visible for a given
// pinned count — reveals one row at a time (matching the bar's current
// column count/cap, see _qaGridShape) rather than showing the whole grid's
// worth of empty "+" tiles up front. A pinned count that exactly fills a row
// invites the NEXT row; otherwise it just completes the row already in progress.
function _qaAddTileTarget(pinnedCount, shape) {
    if (pinnedCount >= shape.max) return shape.max;
    if (pinnedCount % shape.cols === 0) return Math.min(shape.max, pinnedCount + shape.cols);
    return Math.min(shape.max, Math.ceil(pinnedCount / shape.cols) * shape.cols);
}

// Adds/removes add-tile placeholders (never touches real tiles) so the
// grid always shows exactly _qaAddTileTarget's count — used after any
// change that could shift how many should be visible (entering/leaving
// edit mode, a real tile being added/removed, or the bar's span changing).
function _qaSyncAddTiles(instKey, grid) {
    var shape = _qaGridShape(instKey);
    // Only the 1x6 (single-row) shape reads as one connected bar, like
    // every other tool's .btn-group-wide — the 3-wide 2-row shape keeps
    // its tiles as individually bordered/gapped squares as normal.
    grid.classList.toggle('qa-grid-1x6', shape.cols === 6);
    var pinnedCount = grid.querySelectorAll('.quick-actions-btn').length;
    var target = _editMode ? _qaAddTileTarget(pinnedCount, shape) : pinnedCount;
    var have = grid.querySelectorAll('.quick-actions-add-tile').length;
    var need = target - pinnedCount - have;
    for (var i = 0; i < need; i++) grid.appendChild(_qaCreateAddTile(instKey));
    for (var j = 0; j < -need; j++) {
        var current = grid.querySelectorAll('.quick-actions-add-tile');
        if (!current.length) break;
        grid.removeChild(current[current.length - 1]);
    }
}

// Only rebuilds the real tiles from scratch when the pinned SET has
// actually changed (i.e. the very first render, at page load) — _qaAdd/
// _qaRemove already patch the grid directly and keep it in sync, so by
// the time entering/leaving edit mode calls this again, the existing
// tiles already match _qaGetPinned() exactly. Wiping and replaying their
// pop-in animation anyway on every toggle (even though nothing about them
// changed) was what made switching edit mode on/off feel jumpy — now only
// the add-tile placeholders get added/removed, and real tiles are left
// completely alone.
function _renderQuickActions(instKey) {
    var grid = document.getElementById(QA_INSTANCES[instKey].gridId);
    if (!grid) return;
    var pinned = _qaGetPinned(instKey);
    var existingIds = Array.prototype.map.call(grid.querySelectorAll('.quick-actions-btn'), function(t) {
        return t.getAttribute('data-tool-id');
    });
    var samePinned = existingIds.length === pinned.length && existingIds.every(function(id, i) { return id === pinned[i]; });

    if (!samePinned) {
        grid.innerHTML = '';
        pinned.forEach(function(id) {
            var tile = _qaBuildTile(instKey, id);
            if (tile) {
                tile.classList.add('qa-anim-mode-switch');
                grid.appendChild(tile);
            }
        });
    }

    // Reveals add-tile placeholders one row at a time (see
    // _qaAddTileTarget) rather than the full 3x3 worth up front — also
    // handles clearing them all out when leaving edit mode.
    _qaSyncAddTiles(instKey, grid);
}

// Renders every registered bar — called whenever edit mode toggles, since
// both bars' dashed/+ state depends on it.
function _renderAllQuickActions() {
    Object.keys(QA_INSTANCES).forEach(function(instKey) { _renderQuickActions(instKey); });
}

// The single entry point for the whole board's edit mode — both Quick
// Actions bars' dashed tiles and Bottom Layout's drag-reorder/add-remove
// all switch on together, no more separate pencils.
function _toggleEditMode() {
    _editMode = !_editMode;
    var grid = document.getElementById('homeToolGrid');
    if (grid) grid.classList.toggle('board-editing', _editMode);
    var editBtn = document.getElementById('quickActionsEditBtn');
    if (editBtn) editBtn.classList.toggle('active', _editMode);
    var bar = document.getElementById('editModeBar');
    if (_editMode) {
        _editSnapshot = _captureEditSnapshot();
        if (bar) bar.classList.remove('edit-mode-bar-hidden');
        setTimeout(function() { document.addEventListener('mousedown', _editModeOutside); }, 0);
    } else {
        _editSnapshot = null;
        if (bar) bar.classList.add('edit-mode-bar-hidden');
        document.removeEventListener('mousedown', _editModeOutside);
        _qaCloseAddPopover();
        _blCloseAddPopover();
    }
    _renderAllQuickActions();
    _blRenderAddRow();
}

// ── Edit mode bar (Save / Cancel / Restore to Default) ──────────────────────
// Every edit already saves live to localStorage the moment it happens
// (Quick Actions x2, Bottom Layout, Favorites) — there's no pending/draft
// state to commit. So Save is just "exit, keep what's there"; Cancel
// reverts to a snapshot of those same keys taken the moment edit mode was
// entered, and Restore resets them to their built-in defaults — both swap
// localStorage wholesale and re-render, rather than undoing each step.
var EDIT_SNAPSHOT_KEYS = ['lineup-quick-actions', 'lineup-quick-actions-2', 'lineup-bottom-layout', 'lineup-favorite-widgets'];
var _editSnapshot = null;

function _captureEditSnapshot() {
    var snap = {};
    EDIT_SNAPSHOT_KEYS.forEach(function(key) {
        try { snap[key] = localStorage.getItem(key); } catch(e) { snap[key] = null; }
    });
    return snap;
}

function _restoreEditSnapshot(snap) {
    EDIT_SNAPSHOT_KEYS.forEach(function(key) {
        try {
            if (snap[key] === null) localStorage.removeItem(key);
            else localStorage.setItem(key, snap[key]);
        } catch(e) {}
    });
}

// _favApplyLayout already calls _blApplyLayout at its end, so this alone
// covers all three subsystems without redundant passes.
function _refreshAllEditableWidgets() {
    _renderAllQuickActions();
    _favApplyLayout();
}

function _editModeSaveClick() {
    if (_editMode) _toggleEditMode();
}

function _editModeCancelClick() {
    if (!_editMode || !_editSnapshot) return;
    _restoreEditSnapshot(_editSnapshot);
    _refreshAllEditableWidgets();
    _toggleEditMode();
}

// Resets Quick Actions (both bars), Bottom Layout, and Favorites to their
// defaults, then exits edit mode — a full "start over" command, not just
// another edit to keep tweaking.
function _editModeRestoreClick() {
    if (!_editMode) return;
    _qaCloseAddPopover();
    _blCloseAddPopover();
    EDIT_SNAPSHOT_KEYS.forEach(function(key) {
        try { localStorage.removeItem(key); } catch(e) {}
    });
    _refreshAllEditableWidgets();
    _toggleEditMode();
}

// Clicking anywhere outside either Quick Actions widget, the currently
// pinned Bottom Layout boxes, and either add popover exits edit mode —
// everything else on the board is pointer-events:none while editing
// anyway, so there's nothing meaningful to click there besides "I'm done".
// The pencil button itself is also excluded — it lives in the footer,
// well outside either widget, so without this a click on it would first
// get caught here (toggling edit mode off, since mousedown fires before
// click) and then immediately re-toggled back on by the button's own
// onclick, netting out to no change at all.
function _editModeOutside(e) {
    var editBtn = document.getElementById('quickActionsEditBtn');
    if (editBtn && editBtn.contains(e.target)) return;
    // Save/Cancel/Restore live in the bar at the top of the panel, well
    // outside either widget area — same double-toggle risk as the pencil
    // button above (each already calls _toggleEditMode/_editModeCancelClick
    // etc. itself via its own onclick).
    var editBar = document.getElementById('editModeBar');
    if (editBar && editBar.contains(e.target)) return;
    if (_qaPopover && _qaPopover.contains(e.target)) return;
    if (_blPopover && _blPopover.contains(e.target)) return;
    var mainQaBox = document.getElementById('sec-quick-actions');
    if (mainQaBox && mainQaBox.contains(e.target)) return;
    var favBox = document.getElementById('sec-favorite');
    if (favBox && favBox.contains(e.target)) return;
    // Covers the second Quick Actions bar too when it's pinned — it's just
    // another Bottom Layout box (data-block-id="quickactions2") as far as
    // this check is concerned.
    var insideBlBox = _blPinnedIds().some(function(id) {
        var el = _blBoxEl(id);
        return el && el.contains(e.target);
    });
    if (insideBlBox) return;
    if (_blAddRowEl && _blAddRowEl.contains(e.target)) return;
    _toggleEditMode();
}

// Patches the grid in place rather than calling _renderQuickActions, so
// only the removed tile's slot changes — the rest don't replay their
// entrance animation.
function _qaRemove(instKey, id) {
    _qaSavePinned(instKey, _qaGetPinned(instKey).filter(function(x) { return x !== id; }));

    var grid = document.getElementById(QA_INSTANCES[instKey].gridId);
    if (!grid) return;
    var tile = grid.querySelector('.quick-actions-btn[data-tool-id="' + id + '"]');
    if (tile) grid.removeChild(tile);
    // Placeholder count may need to shrink back down a whole row, not
    // just lose one slot — _qaSyncAddTiles handles that either way.
    _qaSyncAddTiles(instKey, grid);
}

// Patches the grid in place rather than calling _renderQuickActions — only
// the newly-pinned tile animates in (with a small bounce, see
// .qa-anim-bounce-in); the rest of the grid doesn't reload/rescale.
function _qaAdd(instKey, id) {
    var ids = _qaGetPinned(instKey);
    if (ids.length >= _qaGridShape(instKey).max) return; // bar's full — the popover shouldn't even be reachable here, but belt and suspenders
    if (ids.indexOf(id) === -1) ids.push(id);
    _qaSavePinned(instKey, ids);
    _qaCloseAddPopover();

    var grid = document.getElementById(QA_INSTANCES[instKey].gridId);
    if (!grid) return;
    var tile = _qaBuildTile(instKey, id);
    if (tile) {
        tile.classList.add('qa-anim-bounce-in');
        var firstAddTile = grid.querySelector('.quick-actions-add-tile');
        if (firstAddTile) grid.insertBefore(tile, firstAddTile);
        else grid.appendChild(tile);
    }
    // Filling the last slot in a row can reveal a whole new row of
    // placeholders rather than just losing one — _qaSyncAddTiles handles
    // that either way.
    _qaSyncAddTiles(instKey, grid);
}

// ── Add-tool popover — a mini version of the Tools tab: a search input and
// a scrollable grid of every not-yet-pinned tool, cloned from the same
// catalog tiles Quick Actions itself pulls from. Bottom Layout's own
// add-widget popover (see _blBuildPopover) reuses the same .qa-add-*
// classes for a consistent look, but keeps separate DOM/state since the
// two list completely different kinds of things.

function _qaBuildPopover() {
    var el = document.createElement('div');
    el.className = 'qa-add-popover';

    var searchRow = document.createElement('div');
    searchRow.className = 'qa-add-search-row';
    // A plain span with an innerHTML svg STRING, not document.createElement('svg')
    // — that creates the element in the wrong (HTML, not SVG) namespace, so
    // none of its child shapes render. Every other dynamically-built icon in
    // this file goes through createElementNS instead; this is simpler still.
    var icon = document.createElement('span');
    icon.className = 'qa-add-search-icon';
    icon.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="6"/><line x1="13" y1="13" x2="17.5" y2="17.5"/></svg>';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'qa-add-search-input';
    input.placeholder = 'Search…';
    input.addEventListener('input', _qaFilterPopover);
    searchRow.appendChild(icon);
    searchRow.appendChild(input);
    el.appendChild(searchRow);

    var grid = document.createElement('div');
    grid.className = 'qa-add-grid';
    el.appendChild(grid);

    document.body.appendChild(el);
    _qaPopoverInput = input;
    _qaPopoverGrid  = grid;
    return el;
}

function _qaFilterPopover() {
    var q = _qaPopoverInput.value.trim().toLowerCase();
    var tiles = _qaPopoverGrid.querySelectorAll('.qa-add-tile');
    for (var i = 0; i < tiles.length; i++) {
        var title = (tiles[i].getAttribute('title') || '').toLowerCase();
        tiles[i].classList.toggle('qa-add-tile-hidden', q.length > 0 && title.indexOf(q) === -1);
    }
}

function _qaOpenAddPopover(instKey, anchorEl) {
    if (!_qaPopover) _qaPopover = _qaBuildPopover();

    var pinned = _qaGetPinned(instKey);
    _qaPopoverGrid.innerHTML = '';
    _qaCatalog().forEach(function(source) {
        var id = source.getAttribute('data-tool-id');
        if (pinned.indexOf(id) !== -1) return;
        var tile = _qaCloneCatalogTile(source);
        tile.classList.remove('tools-grid-btn');
        tile.classList.add('qa-add-tile');
        tile.removeAttribute('data-group');
        tile.onclick = function() { _qaAdd(instKey, id); };
        _qaPopoverGrid.appendChild(tile);
    });
    if (_qaPopoverInput) _qaPopoverInput.value = '';

    var rect = anchorEl.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = 220, ph = 230;
    _qaPopover.style.left = Math.max(4, Math.min(rect.left, vw - pw - 4)) + 'px';
    _qaPopover.style.top  = Math.min(rect.bottom + 4, vh - ph - 4) + 'px';
    _qaPopover.classList.add('visible');
    if (_qaPopoverInput) _qaPopoverInput.focus();

    setTimeout(function() {
        document.addEventListener('mousedown', _qaPopoverOutside);
        document.addEventListener('keydown', _qaPopoverKey);
    }, 0);
}

function _qaCloseAddPopover() {
    if (_qaPopover) _qaPopover.classList.remove('visible');
    document.removeEventListener('mousedown', _qaPopoverOutside);
    document.removeEventListener('keydown', _qaPopoverKey);
}

function _qaPopoverOutside(e) {
    if (_qaPopover && !_qaPopover.contains(e.target) && !e.target.closest('.quick-actions-add-tile')) {
        _qaCloseAddPopover();
    }
}

function _qaPopoverKey(e) {
    if (e.key === 'Escape') _qaCloseAddPopover();
}

// ── BOTTOM LAYOUT (Align / Distribute / Sizing / Auto Crop / Sort) ─────────────
// A second customization scope alongside Quick Actions — separate data/
// storage, but both switch on together under the one _editMode/pencil (see
// _toggleEditMode). This one is a fixed set of 5 boxes (no add/remove) that
// can be reordered, docking side-by-side into half-width pairs purely by
// where you drop them — there is no separate full/half toggle. Layout is
// stored as an ordered list of rows: a row is either one id (full-line) or
// two ids (a half+half pair). Width is entirely derived from which kind of
// row a box is in (see _blPack), so dragging a box out of a pair
// automatically leaves its former partner alone as a full-line row, and
// dragging a box onto the side edge of a lone full-line box automatically
// docks them into a pair.

var BL_STORAGE_KEY = 'lineup-bottom-layout';
// Everything that CAN live in the bottom bento grid — pinned/order is
// stored separately (_blGetRows), so not every catalog entry has to be
// shown at once. label/icon here are only used to build the add-widget
// popover (see _blOpenAddPopover); the icon is cloned straight off each
// box's own .qa-collapse-icon rather than duplicated by hand.
var BL_CATALOG = [
    { id: 'align',         label: 'Align' },
    { id: 'distribute',    label: 'Distribute' },
    { id: 'sizing',        label: 'Sizing' },
    { id: 'autocrop',      label: 'Auto Crop' },
    { id: 'sort',          label: 'Layer Sort' },
    { id: 'quickactions2', label: 'Quick Actions (2nd Bar)' },
    { id: 'spellcheck',    label: 'Spell Check' },
    { id: 'ease',          label: 'Ease Copy' }
];
var BL_CATALOG_IDS = BL_CATALOG.map(function(c) { return c.id; });
var BL_DEFAULT_ROWS = [ ['align'], ['distribute'], ['sizing', 'autocrop'], ['sort'] ];

var _blDrag = null; // non-null while a drag is in progress

function _blBoxEl(id) {
    return document.querySelector('#homeGrid .tool-box[data-block-id="' + id + '"]');
}

// A row is 1-2 ids, each a valid catalog id appearing at most once —
// anything else (duplicate, unknown id, stale format) is rejected
// wholesale rather than partially repaired, falling back to the default
// arrangement. Unlike the original fixed-5 version, rows don't have to
// cover every catalog id — entries left out are simply not pinned.
function _blRowsValid(rows) {
    if (!Array.isArray(rows)) return false;
    var seen = [];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!Array.isArray(row) || row.length < 1 || row.length > 2) return false;
        for (var j = 0; j < row.length; j++) {
            if (BL_CATALOG_IDS.indexOf(row[j]) === -1 || seen.indexOf(row[j]) !== -1) return false;
            seen.push(row[j]);
        }
    }
    return true;
}

function _blGetRows() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(BL_STORAGE_KEY)); } catch(e) {}
    if (_blRowsValid(saved)) return saved;
    return BL_DEFAULT_ROWS.map(function(row) { return row.slice(); });
}

function _blSaveRows(rows) {
    try { localStorage.setItem(BL_STORAGE_KEY, JSON.stringify(rows)); } catch(e) {}
}

// Flat, ordered list of every id currently pinned (shown) — the dynamic
// equivalent of the old fixed BL_IDS constant.
function _blPinnedIds() {
    var ids = [];
    _blGetRows().forEach(function(row) { row.forEach(function(id) { ids.push(id); }); });
    return ids;
}

// Catalog entries not currently pinned — what the add-widget popover lists.
function _blAvailableIds() {
    var pinned = _blPinnedIds();
    return BL_CATALOG_IDS.filter(function(id) { return pinned.indexOf(id) === -1; });
}

// A row with 2 ids renders as span 3 + span 3; a row with 1 id renders as
// span 6 — there's no stored "preference" to fall out of sync with this.
function _blPack(rows) {
    var out = [];
    rows.forEach(function(row) {
        if (row.length === 2) {
            out.push({ id: row[0], span: 3 });
            out.push({ id: row[1], span: 3 });
        } else {
            out.push({ id: row[0], span: 6 });
        }
    });
    return out;
}

// Sets each PINNED box's rendered data-span and moves it to the end of
// #homeGrid in row order — .tool-col uses sparse (non-dense) auto-flow, so
// DOM order is what actually determines visual position; this is what
// makes reordering deterministic instead of leaving it to grid
// auto-placement to guess where gaps should be backfilled. Everything in
// the catalog that ISN'T pinned gets .bl-unpinned (display:none) instead —
// it stays in the DOM (so its icon can still be cloned for the add
// popover, and so re-adding it doesn't need to rebuild anything) but takes
// up no grid space.
function _blApplyLayout(rows) {
    rows = rows || _blGetRows();
    var grid = document.getElementById('homeGrid');
    if (!grid) return;
    var spanById = {};
    _blPack(rows).forEach(function(entry) {
        spanById[entry.id] = entry.span; // the real stored span — _narrowStack only overrides what's rendered, never this
        var box = _blBoxEl(entry.id);
        if (!box) return;
        box.classList.remove('bl-unpinned');
        box.setAttribute('data-span', _narrowStack ? 6 : entry.span);
        grid.appendChild(box);
    });
    BL_CATALOG_IDS.forEach(function(id) {
        if (spanById[id]) return;
        var box = _blBoxEl(id);
        if (box) box.classList.add('bl-unpinned');
    });
    _blRenderAddRow();
    // quickactions2's placeholder count depends on its column count (see
    // _qaGridShape), which just changed along with its span above.
    var qa2Grid = document.getElementById(QA_INSTANCES.quickactions2.gridId);
    if (qa2Grid) _qaSyncAddTiles('quickactions2', qa2Grid);
}

function _blCaptureRects(ids) {
    var map = {};
    ids.forEach(function(id) {
        var el = _blBoxEl(id);
        if (el) map[id] = el.getBoundingClientRect();
    });
    return map;
}

// FLIP: after a reflow, snap each box back to where it visually was via an
// inverse transform, then transition that transform away to '' — reads as
// the boxes smoothly sliding/resizing into their new positions.
function _blPlayFlip(ids, oldRects) {
    ids.forEach(function(id) {
        var el = _blBoxEl(id);
        var old = oldRects[id];
        if (!el || !old) return;
        var neu = el.getBoundingClientRect();
        var dx = old.left - neu.left;
        var dy = old.top - neu.top;
        if (!dx && !dy) return;
        el.style.transition = 'none';
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        void el.offsetWidth; // force reflow so the transition below actually starts from here
        el.style.transition = 'transform 0.12s cubic-bezier(0.4, 0, 0.2, 1)';
        el.style.transform = '';
    });
}

// Rows with `id` removed — a row that loses its only id disappears, a pair
// row that loses one id becomes a single (i.e. its old partner
// automatically reverts to full-line, no separate "un-dock" step needed).
function _blRemoveFromRows(rows, id) {
    var out = [];
    rows.forEach(function(row) {
        var filtered = row.filter(function(x) { return x !== id; });
        if (filtered.length) out.push(filtered);
    });
    return out;
}

// Finds whichever .bl-draggable box is actually under the cursor, using
// real hit-testing (elementFromPoint) rather than nearest-by-distance —
// exact and unambiguous, unlike Euclidean "nearest box", which could
// waver between two adjacent boxes right at their shared border. The
// dragged box itself is pointer-events:none while held (see
// .bl-dragging-source) so this always sees through it to whatever's
// actually underneath.
function _blTargetFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body) {
        if (el.classList && el.classList.contains('bl-draggable')) return el;
        el = el.parentElement;
    }
    return null;
}

// Resolves exactly one of 4 zones relative to a specific target widget —
// no dead zone at all, every point over a widget resolves to something:
//  - top ~25% of its height -> insert a new full-line row above it
//  - bottom ~25% -> insert a new full-line row below it
//  - remaining middle, left half -> dock to its left (if it has room)
//  - remaining middle, right half -> dock to its right (if it has room)
// Narrow stack (see _narrowStack) drops the dock-left/right half entirely —
// every widget renders full width there regardless of its real stored
// pairing, so a left/right split would be previewing a dock that couldn't
// possibly show as anything but full-width anyway. Every point just
// resolves to before/after off a plain 50/50 vertical split instead.
function _blZoneForTarget(targetBox, baseline, clientX, clientY) {
    var targetId = targetBox.getAttribute('data-block-id');
    var rowIdx = -1, canDock = false;
    baseline.forEach(function(row, i) {
        if (row.indexOf(targetId) !== -1) { rowIdx = i; canDock = row.length === 1; }
    });
    if (rowIdx === -1) return null;

    var r = targetBox.getBoundingClientRect();

    if (_narrowStack) {
        var narrowMid = (r.top + r.bottom) / 2;
        return { targetId: targetId, rowIdx: rowIdx, mode: clientY < narrowMid ? 'before' : 'after' };
    }

    var topBand = r.top + r.height * 0.25;
    var bottomBand = r.bottom - r.height * 0.25;

    if (clientY < topBand) return { targetId: targetId, rowIdx: rowIdx, mode: 'before' };
    if (clientY > bottomBand) return { targetId: targetId, rowIdx: rowIdx, mode: 'after' };

    // Already paired (no room to dock) — the vertical middle just falls
    // to whichever half, above/below, is closer.
    if (!canDock) {
        var rowCenter = (r.top + r.bottom) / 2;
        return { targetId: targetId, rowIdx: rowIdx, mode: clientY < rowCenter ? 'before' : 'after' };
    }

    var midX = r.left + r.width / 2;
    return { targetId: targetId, rowIdx: rowIdx, mode: clientX < midX ? 'dock-left' : 'dock-right' };
}

function _blRowsFromCandidate(baseline, draggedId, candidate) {
    if (!candidate) return null;
    var rows = baseline.map(function(row) { return row.slice(); });
    if (candidate.mode === 'dock-left' || candidate.mode === 'dock-right') {
        rows[candidate.rowIdx] = candidate.mode === 'dock-left' ? [draggedId, candidate.targetId] : [candidate.targetId, draggedId];
    } else {
        rows.splice(candidate.mode === 'after' ? candidate.rowIdx + 1 : candidate.rowIdx, 0, [draggedId]);
    }
    return rows;
}

var _blIndicatorEl = null;
function _blIndicator() {
    if (!_blIndicatorEl) {
        _blIndicatorEl = document.createElement('div');
        _blIndicatorEl.className = 'bl-drop-indicator';
        document.body.appendChild(_blIndicatorEl);
    }
    return _blIndicatorEl;
}

// The rect of whichever row sits at baseline[rowIdx] — either id in a
// paired row shares the same top/bottom by construction, so the first is
// enough. Returns null past either end (no neighboring row there).
function _blRowRect(baseline, rowIdx) {
    if (rowIdx < 0 || rowIdx >= baseline.length) return null;
    var el = _blBoxEl(baseline[rowIdx][0]);
    return el ? el.getBoundingClientRect() : null;
}

// Pure visual feedback with zero effect on layout — nothing else on the
// board moves until you actually drop, so there's no moving-target fight
// to land a dock. Two looks depending on what the candidate means:
//  - dock-left/right: a dashed box over the half of the target widget
//    that the dragged box would actually occupy (the target itself will
//    shrink into the other half) — reads as "your box goes here" rather
//    than an abstract line. Transitions left/width so switching sides on
//    the same widget slides rather than snaps.
//  - before/after: a plain dashed line, 90% of the full grid width and
//    centered, regardless of the target's own current width — the
//    inserted row is always full-line even when the target you're
//    hovering is itself only half-width. Positioned at the true midpoint
//    between the two rows on either side of the gap (falling back to a
//    fixed offset past the target's own edge only at the very top/bottom
//    of the board, where there's no neighboring row) — hovering the
//    bottom band of row N and the top band of row N+1 refer to the exact
//    same gap, so both now land the line in the exact same spot instead
//    of two slightly different heights depending on which row's edge you
//    happened to be closer to.
function _blShowIndicator(targetBox, candidate, baseline) {
    var mode = candidate.mode;
    var el = _blIndicator();
    var r = targetBox.getBoundingClientRect();
    el.style.display = 'block';

    if (mode === 'dock-left' || mode === 'dock-right') {
        el.className = 'bl-drop-indicator bl-drop-indicator-box';
        var halfWidth = (r.width - 10) / 2; // same half-width math .bl-pack uses (10 = grid gap)
        el.style.top    = r.top + 'px';
        el.style.height = r.height + 'px';
        el.style.width  = halfWidth + 'px';
        el.style.left   = (mode === 'dock-left' ? r.left : r.right - halfWidth) + 'px';
    } else {
        el.className = 'bl-drop-indicator bl-drop-indicator-line';
        var gridRect = document.getElementById('homeGrid').getBoundingClientRect();
        var lineWidth = gridRect.width * 0.95;
        var THICK = 6;
        el.style.left   = (gridRect.left + gridRect.width * 0.025) + 'px';
        el.style.width  = lineWidth + 'px';
        el.style.height = THICK + 'px';

        var neighborRect = mode === 'before'
            ? _blRowRect(baseline, candidate.rowIdx - 1)
            : _blRowRect(baseline, candidate.rowIdx + 1);
        var centerY;
        if (mode === 'before') {
            centerY = neighborRect ? (neighborRect.bottom + r.top) / 2 : r.top - 6;
        } else {
            centerY = neighborRect ? (r.bottom + neighborRect.top) / 2 : r.bottom + 6;
        }
        el.style.top = (centerY - THICK / 2) + 'px'; // centered on the computed gap midpoint
    }
}

function _blHideIndicator() {
    if (_blIndicatorEl) _blIndicatorEl.style.display = 'none';
}

// Strips id attributes from a subtree — the ghost is a deep clone of the
// real box (buttons, selects, inputs and all, so it looks identical while
// floating), and cloneNode duplicates every id in it verbatim, which
// would otherwise leave two elements answering to the same id in the DOM.
function _blStripIds(el) {
    if (el.id) el.removeAttribute('id');
    Array.prototype.forEach.call(el.querySelectorAll('[id]'), function(child) {
        child.removeAttribute('id');
    });
}

function _blStartDrag(id, startX, startY) {
    var box = _blBoxEl(id);
    if (!box) return;

    var rect = box.getBoundingClientRect();

    // The real box stays exactly where it is — dimmed in place, inert —
    // for the entire drag. Nothing about the grid reflows until the actual
    // drop; a separate floating clone is what follows the cursor. Moving
    // the real box (or re-packing the other 4 around its absence) is what
    // made everything slide around mid-drag before.
    box.classList.add('bl-dragging-source');

    var ghost = box.cloneNode(true);
    _blStripIds(ghost);
    ghost.classList.remove('bl-dragging-source');
    ghost.classList.add('bl-drag-ghost');
    ghost.style.width  = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    // Narrow stack (see _narrowStack): every widget is full width there, so
    // the ghost is locked to the same left edge it already sits at instead
    // of centering under the cursor — dragging only ever moves it up/down,
    // matching there being nothing to dock left/right into anyway.
    ghost.style.left = (_narrowStack ? rect.left : (startX - rect.width / 2)) + 'px';
    ghost.style.top  = (startY - rect.height / 2) + 'px';
    document.body.appendChild(ghost);

    var originalRows = _blGetRows();
    _blDrag = {
        id: id,
        sourceBox: box,
        ghost: ghost,
        heldWidth: rect.width,
        heldHeight: rect.height,
        lockedLeft: rect.left,
        originalRows: originalRows,
        baseline: _blRemoveFromRows(originalRows, id),
        candidate: null // {targetId, rowIdx, mode} | null
    };
    document.body.classList.add('bl-drag-active');
    document.addEventListener('mousemove', _blOnDragMove);
    document.addEventListener('mouseup', _blOnDragEnd);
}

function _blOnDragMove(e) {
    if (!_blDrag) return;
    _blDrag.ghost.style.left = (_narrowStack ? _blDrag.lockedLeft : (e.clientX - _blDrag.heldWidth / 2)) + 'px';
    _blDrag.ghost.style.top  = (e.clientY - _blDrag.heldHeight / 2) + 'px';

    // The source box is still sitting in its real grid slot (just dimmed
    // and pointer-events:none), so hit-testing naturally sees through it —
    // no explicit self-exclusion needed.
    var targetBox = _blTargetFromPoint(e.clientX, e.clientY);
    var candidate = targetBox ? _blZoneForTarget(targetBox, _blDrag.baseline, e.clientX, e.clientY) : null;

    // The source box's own row is never removed from the board (it's just
    // dimmed in place), so the gap on either side of it isn't real empty
    // space — hovering the widgets immediately above/below it can resolve
    // to "insert right here", which just reconstructs the exact original
    // arrangement. That's not a meaningful placement, and having it show
    // up as its own indicator (redundant with just... not moving it) was
    // confusing, so it's suppressed the same as any other dead zone.
    if (candidate && JSON.stringify(_blRowsFromCandidate(_blDrag.baseline, _blDrag.id, candidate)) === JSON.stringify(_blDrag.originalRows)) {
        candidate = null;
    }

    _blDrag.candidate = candidate;

    if (candidate) _blShowIndicator(targetBox, candidate, _blDrag.baseline);
    else _blHideIndicator();
}

function _blOnDragEnd() {
    if (!_blDrag) return;
    document.removeEventListener('mousemove', _blOnDragMove);
    document.removeEventListener('mouseup', _blOnDragEnd);

    var finalRows = _blRowsFromCandidate(_blDrag.baseline, _blDrag.id, _blDrag.candidate) || _blGetRows();
    var droppedId = _blDrag.id;

    // The other 4 boxes haven't moved all drag long, so their current
    // rects are the correct FLIP starting point — they slide into their
    // new spots. The dropped box itself doesn't: sliding it in from the
    // ghost's floating position read as sliding weirdly, so it instead
    // gets a quick scale-bounce "landing" animation (see .bl-drop-land).
    var otherIds = _blPinnedIds().filter(function(x) { return x !== droppedId; });
    var oldRects = _blCaptureRects(otherIds);

    _blDrag.sourceBox.classList.remove('bl-dragging-source');
    _blDrag.ghost.remove();
    _blHideIndicator();

    _blSaveRows(finalRows);
    _blApplyLayout(finalRows);
    _blPlayFlip(otherIds, oldRects);

    var droppedBox = _blBoxEl(droppedId);
    if (droppedBox) {
        droppedBox.classList.remove('bl-drop-land');
        void droppedBox.offsetWidth; // force reflow so a rapid re-drop of the same box replays the animation
        droppedBox.classList.add('bl-drop-land');
        droppedBox.addEventListener('animationend', function handler() {
            droppedBox.classList.remove('bl-drop-land');
            droppedBox.removeEventListener('animationend', handler);
        });
    }

    document.body.classList.remove('bl-drag-active');
    _blDrag = null;
}

// ── FAVORITE SLOT (top group) ────────────────────────────────────────────────
// #sec-favorite is a fixed half-width slot up in the top group holding a
// sliding stack of up to FAV_MAX BL_CATALOG widgets, one per page,
// physically relocating each real .tool-body the same way Compact/Classic
// already share one (see _applyLayoutMode) rather than cloning anything.
// Defaults to a single Ease Copy page, which otherwise has no Compact home
// of its own. Starring a widget elsewhere pushes a new page onto the end of
// the stack and jumps to it; starring past FAV_MAX evicts the oldest page
// back to Bottom Layout to make room. Each page's own X does the same
// eviction manually — returns that widget to Bottom Layout as a new
// full-line row (see _blAddWidget) rather than leaving the user to re-add
// it. _favApplyLayout is the single place that reconciles _favGet()'s id
// list against the actual DOM (which pages exist, where each one's body
// currently lives) — re-run after every layout-mode switch and after the
// favorite list itself changes.
var FAV_KEY = 'lineup-favorite-widgets';
var FAV_MAX = 3;
var _favActiveIndex = 0;

function _favGet() {
    var raw;
    try { raw = localStorage.getItem(FAV_KEY); } catch(e) {}
    if (raw === null) return ['ease']; // key never written -> first-run default
    var ids;
    try { ids = JSON.parse(raw); } catch(e) {}
    if (!Array.isArray(ids)) return [];
    var out = [];
    ids.forEach(function(id) {
        if (BL_CATALOG_IDS.indexOf(id) !== -1 && out.indexOf(id) === -1) out.push(id);
    });
    return out.slice(0, FAV_MAX);
}

function _favSave(ids) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch(e) {}
}

function _favSlotEl()  { return document.getElementById('sec-favorite'); }
function _favTrackEl() { return document.getElementById('favPagesTrack'); }
function _favDotsEl()  { return document.getElementById('favDots'); }

function _favBuildPage(id) {
    var page = document.createElement('div');
    page.className = 'fav-page';
    page.setAttribute('data-fav-id', id);

    // A cloned copy of the widget's own collapse icon (mask-safe — see
    // _qaCloneCatalogTile) so this page can show it during board-editing,
    // same as every other Bottom Layout widget — the original stays behind
    // in the widget's home box, which .tool-body physically leaves.
    var homeBox = _blBoxEl(id);
    var iconSrc = homeBox && homeBox.querySelector('.qa-collapse-icon');
    if (iconSrc) page.appendChild(_qaCloneCatalogTile(iconSrc));

    var badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'bl-widget-remove';
    badge.title = 'Remove from favorites';
    badge.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4.8" y1="4.8" x2="9.2" y2="9.2"/><line x1="9.2" y1="4.8" x2="4.8" y2="9.2"/></svg>';
    badge.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    badge.addEventListener('click', function(e) {
        e.stopPropagation();
        _favRemoveId(id);
    });
    page.appendChild(badge);
    return page;
}

function _favRenderDots(count) {
    var dots = _favDotsEl();
    if (!dots) return;
    dots.innerHTML = '';
    dots.classList.toggle('fav-dots-hidden', count <= 1);
    for (var i = 0; i < count; i++) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'fav-dot' + (i === _favActiveIndex ? ' active' : '');
        dot.title = 'Page ' + (i + 1);
        (function(idx) {
            dot.addEventListener('click', function() { _favGoToPage(idx); });
        })(i);
        dots.appendChild(dot);
    }
}

function _favUpdateTrackPosition() {
    var track = _favTrackEl();
    if (track) track.style.transform = 'translateX(-' + (_favActiveIndex * 100) + '%)';
}

function _favGoToPage(index) {
    var count = _favGet().length;
    if (!count) return;
    _favActiveIndex = Math.max(0, Math.min(index, count - 1));
    _favUpdateTrackPosition();
    var dots = _favDotsEl();
    if (dots) {
        Array.prototype.forEach.call(dots.children, function(dot, i) {
            dot.classList.toggle('active', i === _favActiveIndex);
        });
    }
}

// Reconciles _favGet()'s id list against the DOM: drops pages for ids no
// longer favorited (sending their real content home first), builds/
// relocates pages for every currently-favorited id, and re-syncs the dots,
// track position, and Bottom Layout's pinned state to match.
function _favApplyLayout() {
    var favBox = _favSlotEl();
    var track = _favTrackEl();
    if (!favBox || !track) return;
    var ids = _favGet();

    Array.prototype.slice.call(track.querySelectorAll('.fav-page')).forEach(function(page) {
        var pid = page.getAttribute('data-fav-id');
        if (ids.indexOf(pid) === -1) {
            var body = page.querySelector('.tool-body');
            var home = _blBoxEl(pid);
            if (body && home) home.appendChild(body);
            page.remove();
        }
    });

    ids.forEach(function(id) {
        var page = track.querySelector('.fav-page[data-fav-id="' + id + '"]');
        if (!page) page = _favBuildPage(id);
        var homeBox = _blBoxEl(id);
        var body = homeBox && homeBox.querySelector('.tool-body');
        if (body && body.parentElement !== page) page.appendChild(body);
        track.appendChild(page); // (re-)appends in id order, so DOM order always matches
    });

    favBox.classList.toggle('fav-empty', ids.length === 0);
    _favActiveIndex = ids.length ? Math.max(0, Math.min(_favActiveIndex, ids.length - 1)) : 0;
    _favRenderDots(ids.length);
    _favUpdateTrackPosition();

    // Can't be favorited AND pinned in Bottom Layout at the same time —
    // its real content just moved up here.
    var rows = _blGetRows();
    var pinnedIds = _blPinnedIds();
    var needsSave = false;
    ids.forEach(function(id) {
        if (pinnedIds.indexOf(id) !== -1) {
            rows = _blRemoveFromRows(rows, id);
            needsSave = true;
        }
    });
    if (needsSave) _blSaveRows(rows);
    _blApplyLayout();
}

function _favPlayLand() {
    var track = _favTrackEl();
    var page = track && track.children[_favActiveIndex];
    if (!page) return;
    page.classList.remove('bl-drop-land');
    void page.offsetWidth; // force reflow so back-to-back adds each replay the animation
    page.classList.add('bl-drop-land');
    page.addEventListener('animationend', function handler() {
        page.classList.remove('bl-drop-land');
        page.removeEventListener('animationend', handler);
    });
}

// Pushes a new favorite onto the end of the stack and jumps to it. Past
// FAV_MAX, the oldest page is evicted first — sent back to Bottom Layout as
// a new full-line row (see _blAddWidget), same as manual removal below.
function _favAdd(id) {
    if (BL_CATALOG_IDS.indexOf(id) === -1) return;
    var ids = _favGet();
    if (ids.indexOf(id) !== -1) return;
    var evicted = null;
    if (ids.length >= FAV_MAX) evicted = ids.shift();
    ids.push(id);
    _favSave(ids);
    _favActiveIndex = ids.length - 1;
    _favApplyLayout();
    if (evicted) _blAddWidget(evicted);
    _favPlayLand();
}

// A page's own X — un-favorites just that one and returns it to Bottom
// Layout as a new full-line row instead of leaving it unpinned/delisted.
function _favRemoveId(id) {
    var ids = _favGet().filter(function(x) { return x !== id; });
    _favSave(ids);
    _favActiveIndex = ids.length ? Math.min(_favActiveIndex, ids.length - 1) : 0;
    _favApplyLayout();
    _blAddWidget(id);
}

// Wires up EVERY catalog id, not just currently-pinned ones — a box that's
// unpinned (hidden) right now still needs to be drag-ready the moment
// it's added back in, and this only ever runs once, at page load.
function _blInitControls() {
    BL_CATALOG_IDS.forEach(function(id) {
        var box = _blBoxEl(id);
        if (!box) return;
        box.classList.add('bl-draggable');
        // Every other widget collapses to icon-only (inert) while editing,
        // so the whole box can safely be the drag surface. Quick Actions
        // bars stay fully interactive instead (you need to click their
        // tiles/add-tile/remove-badges), so for those specifically a drag
        // can only start from the dedicated .bl-drag-handle — otherwise
        // every click anywhere on the widget picked it up instead of
        // reaching whatever was actually clicked.
        var isQa = box.classList.contains('tool-box-quick-actions');
        box.addEventListener('mousedown', function(e) {
            if (!_editMode || e.button !== 0) return;
            if (isQa && !e.target.closest('.bl-drag-handle')) return;
            e.preventDefault();
            _blStartDrag(id, e.clientX, e.clientY);
        });
    });
    _blInitRemoveBadges();
    _blInitFavBadges();
}

// ── Bottom Layout add/remove — same X-badge / empty "+" tile pattern as
// Quick Actions, scaled up to whole widgets instead of icon tiles. ────────────

// One badge per catalog box, injected once at load (harmless on a
// currently-unpinned/hidden box — it just sits inert until that widget is
// pinned and board-editing is on).
function _blInitRemoveBadges() {
    BL_CATALOG_IDS.forEach(function(id) {
        var box = _blBoxEl(id);
        if (!box || box.querySelector('.bl-widget-remove')) return;
        var badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'bl-widget-remove';
        badge.title = 'Remove this widget';
        badge.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4.8" y1="4.8" x2="9.2" y2="9.2"/><line x1="9.2" y1="4.8" x2="4.8" y2="9.2"/></svg>';
        // Stops the box's own mousedown (drag-start) listener from firing —
        // without this, tapping the badge would also pick the box up.
        badge.addEventListener('mousedown', function(e) { e.stopPropagation(); });
        badge.addEventListener('click', function(e) {
            e.stopPropagation();
            _blRemoveWidget(id);
        });
        box.appendChild(badge);
    });
}

// Star badge, opposite corner from the remove-X — clicking it pushes that
// widget onto the Favorite slot's stack (see _favAdd), same one-badge-per-
// box injected-once pattern as the remove badges above.
function _blInitFavBadges() {
    BL_CATALOG_IDS.forEach(function(id) {
        var box = _blBoxEl(id);
        if (!box || box.querySelector('.bl-widget-fav')) return;
        var badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'bl-widget-fav';
        badge.title = 'Add to favorites';
        badge.innerHTML = '<svg viewBox="0 0 14 14" fill="currentColor"><polygon points="7,1.3 8.7,4.9 12.6,5.4 9.8,8 10.5,11.9 7,10 3.5,11.9 4.2,8 1.4,5.4 5.3,4.9"/></svg>';
        badge.addEventListener('mousedown', function(e) { e.stopPropagation(); });
        badge.addEventListener('click', function(e) {
            e.stopPropagation();
            _favAdd(id);
        });
        box.appendChild(badge);
    });
}

// Unpins a widget and FLIPs the remaining pinned ones into their newly
// packed positions — mirrors the drag-drop settle, just triggered by a
// click instead of a drop.
function _blRemoveWidget(id) {
    var beforeIds = _blPinnedIds().filter(function(x) { return x !== id; });
    var oldRects = _blCaptureRects(beforeIds);

    _blSaveRows(_blRemoveFromRows(_blGetRows(), id));
    _blApplyLayout();
    _blPlayFlip(beforeIds, oldRects);
}

// Pins a widget as its own new full-line row at the end, FLIPping the
// already-pinned ones aside and giving the new box the same "landing"
// bounce a drag-drop gets (see .bl-drop-land).
function _blAddWidget(id) {
    var beforeIds = _blPinnedIds();
    var oldRects = _blCaptureRects(beforeIds);

    var rows = _blGetRows();
    rows.push([id]);
    _blSaveRows(rows);
    _blCloseAddPopover();

    _blApplyLayout(rows);
    _blPlayFlip(beforeIds, oldRects);

    var newBox = _blBoxEl(id);
    if (newBox) {
        newBox.classList.remove('bl-drop-land');
        void newBox.offsetWidth; // force reflow so back-to-back adds each replay the animation
        newBox.classList.add('bl-drop-land');
        newBox.addEventListener('animationend', function handler() {
            newBox.classList.remove('bl-drop-land');
            newBox.removeEventListener('animationend', handler);
        });
    }
}

// The dashed "+" affordance — a single full-width row appended after every
// pinned widget, shown only while editing and only when there's actually
// something left to add. Reused (not rebuilt) across renders, just
// inserted/removed from the grid as needed.
var _blAddRowEl = null;

function _blRenderAddRow() {
    var grid = document.getElementById('homeGrid');
    if (!grid) return;
    if (!_blAddRowEl) {
        _blAddRowEl = document.createElement('button');
        _blAddRowEl.type = 'button';
        _blAddRowEl.className = 'tool-box bl-add-row';
        _blAddRowEl.title = 'Add a widget';
        _blAddRowEl.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>';
        _blAddRowEl.setAttribute('data-span', '6');
        _blAddRowEl.setAttribute('data-rowspan', '1');
        _blAddRowEl.addEventListener('mousedown', function(e) { e.stopPropagation(); }); // never a drag source
        _blAddRowEl.addEventListener('click', function() { _blOpenAddPopover(_blAddRowEl); });
    }
    var show = _editMode && _blAvailableIds().length > 0;
    if (!show) {
        if (_blAddRowEl.parentElement) _blAddRowEl.parentElement.removeChild(_blAddRowEl);
        return;
    }
    grid.appendChild(_blAddRowEl); // _blApplyLayout has already placed every pinned box before this runs, so this always lands last
}

// ── Add-widget popover — same search + scrollable grid pattern as Quick
// Actions' own (.qa-add-popover etc., reused directly for a consistent
// look), but listing whole BL_CATALOG entries instead of Tools-tab tiles.
// Kept as separate state/DOM from Quick Actions' popover since the two
// list entirely different kinds of things.

var _blPopover      = null;
var _blPopoverInput = null;
var _blPopoverGrid  = null;

function _blBuildPopover() {
    var el = document.createElement('div');
    el.className = 'qa-add-popover';

    var searchRow = document.createElement('div');
    searchRow.className = 'qa-add-search-row';
    var icon = document.createElement('span');
    icon.className = 'qa-add-search-icon';
    icon.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="6"/><line x1="13" y1="13" x2="17.5" y2="17.5"/></svg>';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'qa-add-search-input';
    input.placeholder = 'Search…';
    input.addEventListener('input', _blFilterPopover);
    searchRow.appendChild(icon);
    searchRow.appendChild(input);
    el.appendChild(searchRow);

    var grid = document.createElement('div');
    grid.className = 'qa-add-grid';
    el.appendChild(grid);

    document.body.appendChild(el);
    _blPopoverInput = input;
    _blPopoverGrid  = grid;
    return el;
}

function _blFilterPopover() {
    var q = _blPopoverInput.value.trim().toLowerCase();
    var tiles = _blPopoverGrid.querySelectorAll('.qa-add-tile');
    for (var i = 0; i < tiles.length; i++) {
        var title = (tiles[i].getAttribute('title') || '').toLowerCase();
        tiles[i].classList.toggle('qa-add-tile-hidden', q.length > 0 && title.indexOf(q) === -1);
    }
}

// Each tile shows the catalog entry's own icon — cloned straight off its
// box's .qa-collapse-icon, so it can never drift out of sync with what the
// widget actually looks like once pinned — plus its label.
function _blBuildCatalogTile(entry) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'qa-add-tile';
    tile.title = entry.label;

    var box = _blBoxEl(entry.id);
    var iconSrc = box && box.querySelector('.qa-collapse-icon');
    if (iconSrc) {
        // Reuses _qaCloneCatalogTile purely for its mask-id-renaming logic
        // (generic, not actually Quick-Actions-specific) — Spell Check's
        // icon has an internal <mask id>, and cloning it verbatim would
        // collide with the original still sitting in the DOM.
        var icon = _qaCloneCatalogTile(iconSrc);
        icon.classList.remove('qa-collapse-icon');
        icon.removeAttribute('style'); // drop its collapsed-state opacity:0/centering, irrelevant here
        tile.appendChild(icon);
    }
    var lbl = document.createElement('span');
    lbl.textContent = entry.label;
    tile.appendChild(lbl);

    tile.onclick = function() { _blAddWidget(entry.id); };
    return tile;
}

function _blOpenAddPopover(anchorEl) {
    if (!_blPopover) _blPopover = _blBuildPopover();

    _blPopoverGrid.innerHTML = '';
    var pinned = _blPinnedIds();
    BL_CATALOG.forEach(function(entry) {
        if (pinned.indexOf(entry.id) !== -1) return;
        _blPopoverGrid.appendChild(_blBuildCatalogTile(entry));
    });
    if (_blPopoverInput) _blPopoverInput.value = '';

    var rect = anchorEl.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = 220, ph = 230;
    _blPopover.style.left = Math.max(4, Math.min(rect.left, vw - pw - 4)) + 'px';
    _blPopover.style.top  = Math.min(rect.bottom + 4, vh - ph - 4) + 'px';
    _blPopover.classList.add('visible');
    if (_blPopoverInput) _blPopoverInput.focus();

    setTimeout(function() {
        document.addEventListener('mousedown', _blPopoverOutside);
        document.addEventListener('keydown', _blPopoverKey);
    }, 0);
}

function _blCloseAddPopover() {
    if (_blPopover) _blPopover.classList.remove('visible');
    document.removeEventListener('mousedown', _blPopoverOutside);
    document.removeEventListener('keydown', _blPopoverKey);
}

function _blPopoverOutside(e) {
    if (_blPopover && !_blPopover.contains(e.target) && !e.target.closest('.bl-add-row')) {
        _blCloseAddPopover();
    }
}

function _blPopoverKey(e) {
    if (e.key === 'Escape') _blCloseAddPopover();
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

// Recentered ~20% smaller than the original [0.85, 1.0, 1.15] — the whole
// Home tab (Compact and Classic both live inside #panel-content) reads
// noticeably large at native size, and zoom scales it as one unit without
// disturbing any internal flex/grid proportions.
var SCALE_FACTORS = [0.65, 0.8, 0.95];

function applyScale(val) {
    var f = SCALE_FACTORS[Math.max(0, Math.min(2, val))];
    var content = document.getElementById('panel-content');
    if (content) content.style.zoom = String(f);

    // Overlay modals (Settings, Help, Batch Comp Settings, Batch Rename, Comp
    // Export) live outside #panel-content, so the zoom above doesn't reach them.
    // Scale each one with a CSS transform instead — transform doesn't affect
    // layout/spacing, just visually scales the box from its own center (the
    // overlay already centers it via flexbox).
    document.querySelectorAll('.settings-modal').forEach(function (m) {
        m.style.transform = 'scale(' + f + ')';
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

// ── Classic section order persistence ────────────────────────────────────────
// Ordering is independent per layout (Compact's own order lives in
// lineup-home-layout) — only hidden-state is shared between the two, via
// _commitHiddenBlockIds/_getHiddenBlockIds above.

function saveClassicOrder() {
    var sections = document.querySelectorAll('#homeClassic .section[data-block-id]');
    var order = [];
    sections.forEach(function(s) { order.push(s.getAttribute('data-block-id')); });
    try { localStorage.setItem('lineup-classic-order', JSON.stringify(order)); } catch(e) {}
}

function restoreClassicOrder() {
    var order;
    try { order = JSON.parse(localStorage.getItem('lineup-classic-order')); } catch(e) {}
    if (!order || !Array.isArray(order) || !order.length) return;
    var content = document.getElementById('homeClassic');
    if (!content) return;
    order.forEach(function(id) {
        var el = document.getElementById('cls-' + id);
        if (el) content.appendChild(el);
    });
}

// ── Classic Sections list (Settings tab) ─────────────────────────────────────
// Rebuilt fresh each time Classic becomes the active layout (or the Settings
// tab is opened while it's active) — the original settings page's own
// drag-to-reorder + toggle-to-hide list, just inline instead of a modal.

function _renderClassicSettingsList() {
    var list = document.getElementById('settingsSectionList');
    if (!list) return;
    var sections = document.querySelectorAll('#homeClassic .section[data-block-id]');

    list.innerHTML = '';
    sections.forEach(function(sec) {
        var row = buildSettingsRow(sec);
        if (row) list.appendChild(row);
    });

    initSettingsDrag();
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

    var blockId = secEl.getAttribute('data-block-id');
    cb.addEventListener('change', function() {
        row.classList.toggle('row-disabled', !cb.checked);
        // Hidden state is the one thing shared with Compact — route the
        // toggle through the shared commit instead of just this row's own
        // section, so Compact reflects it the moment you switch back.
        var ids = _getHiddenBlockIds();
        var idx = ids.indexOf(blockId);
        if (!cb.checked && idx === -1) ids.push(blockId);
        if (cb.checked && idx !== -1) ids.splice(idx, 1);
        _commitHiddenBlockIds(ids);
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
    var content = document.getElementById('homeClassic');
    rows.forEach(function(row) {
        var sec = document.getElementById(row.dataset.secId);
        if (sec) content.appendChild(sec);
    });
    saveClassicOrder();
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
    restoreActiveTab();
    _initAnchorRowUnit();
    _initNarrowStack();
    restoreClassicOrder();
    restoreClassicCollapsed();
    restoreLayoutMode();
    _renderAllQuickActions();
    _blInitControls();
    _blApplyLayout();
    restoreHighContrast();
    initToolsSearch();
    restoreCollapsed();
    restoreScale();
    _bcsInit();
    _brnInit();
    _easePreviewFetch();

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
