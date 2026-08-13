(function () {
  'use strict';

  var rememberedView = 'comp';
  try { rememberedView = localStorage.getItem('BBQC.view') || 'comp'; } catch (e) {}
  if (rememberedView !== 'project') rememberedView = 'comp';

  var SORT_MODES = ['none', 'added', 'timecode'];
  var sortBy = 'none';
  try { sortBy = localStorage.getItem('BBQC.sortBy') || 'none'; } catch (e) {}
  if (SORT_MODES.indexOf(sortBy) === -1) sortBy = 'none';

  var hideCompleted = false;
  try { hideCompleted = localStorage.getItem('BBQC.hideCompleted') === '1'; } catch (e) {}

  var state = { projectName: '', activeCompName: '', activeCompId: -1, activeTime: 0, activeTimeText: '', notes: [], view: rememberedView, comps: [], frameioSyncs: [] };
  var viewMode = rememberedView;
  var expanded = {};
  var editingId = null;
  var addType = 'project';
  var dragPlacement = 'before';
  var visibleNotesCache = [];
  var lastStateJSON = null;

  var viewDropdown = document.getElementById('viewDropdown');
  var viewDropdownBtn = document.getElementById('viewDropdownBtn');
  var viewDropdownLabel = document.getElementById('viewDropdownLabel');
  var viewDropdownMenu = document.getElementById('viewDropdownMenu');
  var compViewOption = document.getElementById('compViewOption');
  var compViewOptionLabel = document.getElementById('compViewOptionLabel');
  var viewModeIconProject = document.getElementById('viewModeIconProject');
  var viewModeIconComp = document.getElementById('viewModeIconComp');
  var viewOptions = document.querySelectorAll('#viewDropdownMenu .custom-select-option');
  var notesList = document.getElementById('notesList');
  var emptyState = document.getElementById('emptyState');
  var emptyStateText = document.getElementById('emptyStateText');
  var statusText = document.getElementById('statusText');
  var markAllCheckbox = document.getElementById('markAllCheckbox');
  var selectAllBtn = document.getElementById('selectAllBtn');
  var batchDeleteBtn = document.getElementById('batchDeleteBtn');
  var sortDropdown = document.getElementById('sortDropdown');
  var sortDropdownBtn = document.getElementById('sortDropdownBtn');
  var sortDropdownMenu = document.getElementById('sortDropdownMenu');
  var sortOptions = document.querySelectorAll('#sortDropdownMenu .custom-select-option');
  var hideCompletedCheckbox = document.getElementById('hideCompletedCheckbox');
  var addNoteBtn = document.getElementById('addNoteBtn');
  var summaryBtn = document.getElementById('summaryBtn');
  var noteModal = document.getElementById('noteModal');
  var noteModalTitle = document.getElementById('noteModalTitle');
  var noteTypeBlock = document.getElementById('noteTypeBlock');
  var typeProject = document.getElementById('typeProject');
  var typeComp = document.getElementById('typeComp');
  var compTypeOptions = document.getElementById('compTypeOptions');
  var atPlayheadCheckbox = document.getElementById('atPlayheadCheckbox');
  var playheadPreview = document.getElementById('playheadPreview');
  var manualTimecodeBlock = document.getElementById('manualTimecodeBlock');
  var manualTimecodeInput = document.getElementById('manualTimecodeInput');
  var manualTimecodeHelper = document.getElementById('manualTimecodeHelper');
  var noteTitleInput = document.getElementById('noteTitleInput');
  var noteBodyInput = document.getElementById('noteBodyInput');
  var saveNoteBtn = document.getElementById('saveNoteBtn');
  var summaryModal = document.getElementById('summaryModal');
  var summaryText = document.getElementById('summaryText');
  var copySummaryBtn = document.getElementById('copySummaryBtn');
  var copyStatus = document.getElementById('copyStatus');

  var frameioToggleBtn = document.getElementById('frameioToggleBtn');
  var frameioSyncIndicator = document.getElementById('frameioSyncIndicator');
  var frameioSyncLabel = document.getElementById('frameioSyncLabel');
  var frameioSyncTime = document.getElementById('frameioSyncTime');
  var frameioSettingsModal = document.getElementById('frameioSettingsModal');
  var frameioTabButtons = document.querySelectorAll('.modal-tab');
  var frameioTabSync = document.getElementById('frameioTabSync');
  var frameioTabAccount = document.getElementById('frameioTabAccount');
  var frameioTabSettings = document.getElementById('frameioTabSettings');
  var frameioAutoPollCheckbox = document.getElementById('frameioAutoPollCheckbox');
  var frameioPollIntervalSelect = document.getElementById('frameioPollIntervalSelect');
  var frameioPollStatusText = document.getElementById('frameioPollStatusText');
  var frameioTestStatus = document.getElementById('frameioTestStatus');
  var frameioConnectBtn = document.getElementById('frameioConnectBtn');
  var frameioDisconnectBtn = document.getElementById('frameioDisconnectBtn');
  var frameioManualOpenBlock = document.getElementById('frameioManualOpenBlock');
  var frameioSigninLinkInput = document.getElementById('frameioSigninLinkInput');
  var frameioCopyLinkBtn = document.getElementById('frameioCopyLinkBtn');
  var frameioSyncList = document.getElementById('frameioSyncList');
  var frameioSyncEmpty = document.getElementById('frameioSyncEmpty');
  var frameioAddSyncBtn = document.getElementById('frameioAddSyncBtn');
  var frameioAddSyncForm = document.getElementById('frameioAddSyncForm');
  var frameioAddSyncCancelBtn = document.getElementById('frameioAddSyncCancelBtn');
  var frameioAddSyncSaveBtn = document.getElementById('frameioAddSyncSaveBtn');
  var frameioAddSyncStatus = document.getElementById('frameioAddSyncStatus');
  var frameioNewSyncCompSelect = document.getElementById('frameioNewSyncCompSelect');
  var frameioNewSyncLinkInput = document.getElementById('frameioNewSyncLinkInput');
  var frameioFpsModal = document.getElementById('frameioFpsModal');
  var frameioFpsModalText = document.getElementById('frameioFpsModalText');
  var frameioFpsModalConfirm = document.getElementById('frameioFpsModalConfirm');

  var deleteModal = document.getElementById('deleteModal');
  var deleteModalTitle = document.getElementById('deleteModalTitle');
  var deleteModalClose = document.getElementById('deleteModalClose');
  var deleteModalCancel = document.getElementById('deleteModalCancel');
  var deleteModalConfirm = document.getElementById('deleteModalConfirm');
  var deleteModalNoteTitle = document.getElementById('deleteModalNoteTitle');
  var pendingDeleteId = null;
  var pendingDeleteIds = [];
  var batchSelected = {};
  var selectionText = document.getElementById('selectionText');


  function isMultiModifier(e) {
    return !!(e && (e.ctrlKey || e.metaKey));
  }

  function selectedIds() {
    var ids = [];
    for (var id in batchSelected) {
      if (batchSelected.hasOwnProperty(id) && batchSelected[id]) ids.push(id);
    }
    return ids;
  }

  function updateSelectionStatus() {
    var ids = selectedIds();
    if (selectionText) selectionText.textContent = ids.length ? (ids.length + ' selected') : '';
    if (batchDeleteBtn) batchDeleteBtn.disabled = ids.length === 0;

    var allSelected = visibleNotesCache.length > 0 && visibleNotesCache.every(function (n) { return !!batchSelected[n.qcID]; });
    if (selectAllBtn) {
      selectAllBtn.disabled = visibleNotesCache.length === 0;
      selectAllBtn.classList.toggle('active', allSelected);
      selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
    }

    // Separate from batch selection: this checkbox looks like a note's own
    // completion checkbox on purpose, so it should behave like one — check
    // it and every visible note gets marked complete, not "selected".
    if (markAllCheckbox) {
      markAllCheckbox.disabled = visibleNotesCache.length === 0;
      markAllCheckbox.checked = visibleNotesCache.length > 0 && visibleNotesCache.every(function (n) { return !!n.checked; });
    }
  }

  function toggleBatchSelection(id) {
    if (batchSelected[id]) delete batchSelected[id];
    else batchSelected[id] = true;
    render();
  }

  function clearBatchSelection() {
    batchSelected = {};
    updateSelectionStatus();
  }

  function esc(str) { return JSON.stringify(String(str == null ? '' : str)); }

  function host(script, callback) {
    if (window.__adobe_cep__ && window.__adobe_cep__.evalScript) {
      window.__adobe_cep__.evalScript(script, function (result) { if (callback) callback(result); });
    } else {
      console.warn('CEP bridge unavailable:', script);
      if (callback) callback('');
    }
  }

  function parseHostJSON(result) {
    if (!result) return null;
    try { return JSON.parse(result); }
    catch (e) { console.error('BBQC host JSON parse error', e, result); return null; }
  }

  function saveViewPreference() {
    try { localStorage.setItem('BBQC.view', viewMode); } catch (e) {}
  }

  // The background poll (every 1.8s) calls this constantly so the list
  // picks up markers added/moved directly in AE. Rebuilding notesList on
  // every tick — even when nothing changed — periodically yanks the DOM
  // node out from under an in-flight click (mousedown lands on a node
  // that gets replaced before mouseup, so the click never fires), which
  // is why a comment could take two clicks to register. Skipping the
  // rebuild when the fetched state is byte-identical to last time fixes
  // that without losing responsiveness to real changes.
  function refresh(force) {
    host('BBQC.getState(' + esc(viewMode) + ')', function (result) {
      if (!result) return;
      if (!force && result === lastStateJSON) return;
      lastStateJSON = result;
      var next = parseHostJSON(result);
      if (!next) return;
      state = next;
      state.view = viewMode;
      updateViewControl();
      updateFrameioSyncIndicator();
      render();
    });
  }

  // General sync-state indicator in the top bar — reflects the aggregate
  // Frame.io state across every synced composition (not just whichever
  // comp happens to be active), since the background poll already checks
  // all of them. Label is always exactly "Synced" or "Sync" — the only
  // other text it ever shows is the relative last-synced time.
  var frameioLastSyncAt = null;
  var frameioSyncBusy = false;

  function formatRelativeSyncTime(ms) {
    var diff = Date.now() - ms;
    if (diff < 45 * 1000) return 'just now';
    var mins = Math.round(diff / 60000);
    if (mins < 60) return mins + ' min' + (mins === 1 ? '' : 's') + ' ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + ' hr' + (hours === 1 ? '' : 's') + ' ago';
    var days = Math.round(hours / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  // Yellow only ever means "the background poll found changes you haven't
  // pulled in yet" — a manual click always resolves in one step (scans
  // and imports immediately) rather than surfacing yellow and requiring
  // a second click.
  function updateFrameioSyncIndicator() {
    _updateFrameioPollStatusText();
    if (!frameioSyncIndicator) return;
    var connected = !!(window.BBQCFrameIO && window.BBQCFrameIO.isConnected());
    var hasSyncs = (state.frameioSyncs || []).length > 0;
    if (!connected || !hasSyncs) { frameioSyncIndicator.classList.add('hidden'); return; }
    frameioSyncIndicator.classList.remove('hidden');
    frameioSyncIndicator.disabled = frameioSyncBusy;

    var dot = frameioSyncIndicator.querySelector('.sync-dot');

    if (frameioSyncBusy) {
      dot.className = 'sync-dot';
      frameioSyncLabel.textContent = 'Sync';
      frameioSyncTime.textContent = '';
      return;
    }

    var totalNew = pendingFrameioChanges.reduce(function (sum, f) { return sum + f.newCount; }, 0);
    if (totalNew) {
      dot.className = 'sync-dot dot-yellow';
      frameioSyncLabel.textContent = 'Sync';
      frameioSyncTime.textContent = totalNew + ' change' + (totalNew === 1 ? '' : 's');
      return;
    }

    if (!frameioLastSyncAt) {
      dot.className = 'sync-dot';
      frameioSyncLabel.textContent = 'Sync';
      frameioSyncTime.textContent = '';
      return;
    }

    dot.className = 'sync-dot dot-green';
    frameioSyncLabel.textContent = 'Synced';
    frameioSyncTime.textContent = formatRelativeSyncTime(frameioLastSyncAt);
  }

  if (frameioSyncIndicator) frameioSyncIndicator.addEventListener('click', function () {
    if (frameioSyncBusy) return;
    if (pendingFrameioChanges.length) { applyPendingFrameioChanges(); return; }
    frameioSyncBusy = true;
    updateFrameioSyncIndicator();
    scanFrameioSyncs(function (found) {
      if (!found.length) {
        frameioSyncBusy = false;
        frameioLastSyncAt = Date.now();
        updateFrameioSyncIndicator();
        _scheduleFrameioPoll(); // just checked by hand — push the next automatic check back out a full interval
        return;
      }
      importFoundFrameioItems(found, function () {
        frameioSyncBusy = false;
        frameioLastSyncAt = Date.now();
        updateFrameioSyncIndicator();
        refresh(true);
        _scheduleFrameioPoll();
      });
    });
  });

  function icon(name) {
    if (name === 'edit') return '<svg viewBox="0 0 24 24"><path d="M4 20l4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16 4 20z"></path><path d="M14.7 6.5l3 3"></path></svg>';
    if (name === 'trash') return '<svg viewBox="0 0 24 24"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M7 7l1 13h8l1-13"></path><path d="M10 10v7M14 10v7"></path></svg>';
    return '<svg class="chevron-icon" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>';
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function setView(mode) {
    viewMode = mode === 'comp' ? 'comp' : 'project';
    state.view = viewMode;
    saveViewPreference();
    closeViewMenu();
    updateViewControl();
    refresh(true);
  }

  function updateViewControl() {
    var compName = state.activeCompName || 'Active Comp';
    compViewOptionLabel.textContent = compName;
    compViewOption.title = compName;
    viewDropdownLabel.textContent = viewMode === 'comp' ? compName : 'Project';
    viewDropdownLabel.title = viewMode === 'comp' ? compName : 'Project';
    viewModeIconProject.classList.toggle('hidden', viewMode === 'comp');
    viewModeIconComp.classList.toggle('hidden', viewMode !== 'comp');

    for (var i = 0; i < viewOptions.length; i++) {
      var selected = viewOptions[i].getAttribute('data-view') === viewMode;
      viewOptions[i].classList.toggle('selected', selected);
      viewOptions[i].setAttribute('aria-selected', selected ? 'true' : 'false');
    }
  }

  function openViewMenu() {
    viewDropdown.classList.add('open');
    viewDropdownMenu.classList.remove('hidden');
    viewDropdownBtn.setAttribute('aria-expanded', 'true');
    syncViewHighlight();
  }

  function closeViewMenu() {
    viewDropdown.classList.remove('open');
    viewDropdownMenu.classList.add('hidden');
    viewDropdownBtn.setAttribute('aria-expanded', 'false');
  }

  // The timestamp embedded in a qcID (BBQC_<epochMs>_<rand>) — a stable
  // creation order independent of any manual drag-reordering.
  function qcTimestamp(qcID) {
    var m = String(qcID || '').match(/^BBQC_(\d+)_/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // Notes with no timecode (project-wide, unlinked) sort after every
  // timed note when sorting by timecode — there's no position to compare.
  // "none" leaves state.notes in its raw stored order, which
  // is whatever the user last manually drag-reordered it to.
  function getVisibleNotes() {
    var notes = (state.notes || []).slice(0);
    if (hideCompleted) notes = notes.filter(function (n) { return !n.checked; });
    if (sortBy === 'timecode') {
      notes.sort(function (a, b) {
        var ta = a.linked ? a.time : Infinity;
        var tb = b.linked ? b.time : Infinity;
        return ta - tb;
      });
    } else if (sortBy === 'added') {
      notes.sort(function (a, b) { return qcTimestamp(a.qcID) - qcTimestamp(b.qcID); });
    }
    return notes;
  }

  // Dragging to manually reorder only makes sense against the raw stored
  // order ("none") — with a custom sort or a hidden-completed filter
  // active, the visible order no longer matches state.notes, so
  // reorderVisible()'s math (which walks state.notes) would silently do
  // the wrong thing.
  function dragReorderEnabled() {
    return sortBy === 'none' && !hideCompleted;
  }

  function render() {
    updateViewControl();
    var notes = state.notes || [];
    var visible = getVisibleNotes();
    visibleNotesCache = visible;
    notesList.innerHTML = '';
    emptyState.classList.toggle('hidden', visible.length > 0);

    if (!visible.length) {
      emptyStateText.textContent = state.view === 'comp' && !state.activeCompId ? 'Open a comp to view its comments.'
        : (hideCompleted && notes.length ? 'All comments are complete.' : 'No comments yet.');
    }

    var complete = 0;
    for (var i = 0; i < notes.length; i++) if (notes[i].checked) complete++;
    for (var j = 0; j < visible.length; j++) notesList.appendChild(buildCard(visible[j]));

    statusText.textContent = notes.length ? (complete + ' / ' + notes.length + ' complete') : '';
    updateSelectionStatus();
  }

  // Shared across both card styles: batch-select on ctrl/cmd-click,
  // otherwise toggle completion.
  function wireCheckbox(check, note) {
    check.addEventListener('click', function (e) {
      if (isMultiModifier(e)) {
        e.preventDefault();
        e.stopPropagation();
        check.checked = !!note.checked;
        toggleBatchSelection(note.qcID);
      }
    });
    check.addEventListener('change', function (e) {
      if (isMultiModifier(e)) return;
      host('BBQC.toggleNote(' + esc(note.qcID) + ',' + (check.checked ? 'true' : 'false') + ')', function () { refresh(true); });
    });
  }

  // Shared: batch-delete on ctrl/cmd-click when something's selected,
  // otherwise confirm deleting just this one note.
  function wireDeleteButton(del, note) {
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      var ids = selectedIds();
      if (isMultiModifier(e) && ids.length) {
        openBatchDeleteModal(ids);
      } else {
        pendingDeleteIds = [];
        pendingDeleteId = note.qcID;
        deleteModalTitle.textContent = 'Delete Comment';
        deleteModalNoteTitle.textContent = '“' + note.title + '”?';
        deleteModal.classList.remove('hidden');
        deleteModal.setAttribute('aria-hidden', 'false');
        deleteModalConfirm.focus();
      }
    });
  }

  function wireDragHandlers(card, note) {
    card.addEventListener('dragstart', function (e) {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', note.qcID);
    });
    card.addEventListener('dragend', function () {
      card.classList.remove('dragging');
      clearDropTargets();
    });
    card.addEventListener('dragover', function (e) {
      e.preventDefault();
      clearDropTargets();
      var rect = card.getBoundingClientRect();
      dragPlacement = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      card.classList.add(dragPlacement === 'before' ? 'drop-before' : 'drop-after');
    });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      var draggedId = e.dataTransfer.getData('text/plain');
      reorderVisible(draggedId, note.qcID, dragPlacement);
    });
  }

  // "AB"-style initials from a display name (or the first couple
  // characters of whatever string it is, e.g. an email, if there's no
  // space to split on).
  function frameioInitials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) {
      var word = parts[0].replace(/[^a-zA-Z0-9]/g, '') || parts[0];
      return word.slice(0, 2).toUpperCase();
    }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  // Deterministic (not literally random) color per commenter, so the
  // same person always gets the same avatar color across syncs/sessions.
  var FRAMEIO_AVATAR_COLORS = [
    '#c1440e', '#d4691e', '#e08a1e', '#c77b2f', '#b5501b',
    '#a8451f', '#cf6d2e', '#e0973a', '#a63c2e', '#8c5a2b',
    '#bf5b1f', '#d98a3d'
  ];

  function frameioAvatarColor(name) {
    var str = String(name || '');
    var hash = 0;
    for (var i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return FRAMEIO_AVATAR_COLORS[hash % FRAMEIO_AVATAR_COLORS.length];
  }

  function buildCard(note) {
    var card = document.createElement('article');
    card.dataset.id = note.qcID;
    card.draggable = dragReorderEnabled();

    if (note.frameioCommentId) buildFrameioCard(card, note);
    else buildStandardCard(card, note);

    wireDragHandlers(card, note);
    return card;
  }

  function buildStandardCard(card, note) {
    card.className = 'note-card' + (note.checked ? ' completed' : '') + (note.linked ? ' linked' : '') + (expanded[note.qcID] ? ' expanded' : '') + (batchSelected[note.qcID] ? ' batch-selected' : '');

    var timeLabel = note.linked ? (note.timeText || '0:00:00') : 'Project';
    var body = note.note ? escapeHTML(note.note) : 'No additional comments.';
    var meta = note.linked ? (escapeHTML(note.markerName || '') + (note.compName ? ' · ' + escapeHTML(note.compName) : '')) : 'Project comment';
    var navTitle = note.linked ? 'Jump to ' + (note.compName || 'linked comp') + ' at ' + timeLabel : 'Project-wide comment';

    card.innerHTML =
      '<div class="note-row">' +
        '<label class="check-wrap" title="' + (note.checked ? 'Mark incomplete' : 'Mark complete') + '">' +
          '<input class="note-check" type="checkbox" ' + (note.checked ? 'checked' : '') + ' />' +
          '<span class="fake-check"></span>' +
        '</label>' +
        '<div class="note-nav" title="' + escapeHTML(navTitle) + '">' +
          '<div class="note-title" title="' + escapeHTML(note.title) + '">' + escapeHTML(note.title) + '</div>' +
          '<div class="note-time" title="' + escapeHTML(timeLabel) + '">' + escapeHTML(timeLabel) + '</div>' +
        '</div>' +
        '<div class="note-actions">' +
          '<button class="icon-btn edit" title="Edit comment" aria-label="Edit comment">' + icon('edit') + '</button>' +
          '<button class="icon-btn delete" title="Delete comment" aria-label="Delete comment">' + icon('trash') + '</button>' +
          '<button class="icon-btn expand" title="' + (expanded[note.qcID] ? 'Collapse comment' : 'Expand comment') + '" aria-label="Expand or collapse comment">' + icon('chevron') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="note-body">' + body + '<div class="note-meta">' + meta + '</div></div>';

    var check = card.querySelector('.note-check');
    var nav = card.querySelector('.note-nav');
    var edit = card.querySelector('.edit');
    var del = card.querySelector('.delete');
    var exp = card.querySelector('.expand');

    wireCheckbox(check, note);

    nav.addEventListener('click', function () {
      if (!note.linked) return;
      host('BBQC.jumpTo(' + esc(note.qcID) + ')', function () { refresh(true); });
    });

    edit.addEventListener('click', function (e) { e.stopPropagation(); openEdit(note); });
    wireDeleteButton(del, note);
    exp.addEventListener('click', function (e) {
      e.stopPropagation();
      expanded[note.qcID] = !expanded[note.qcID];
      render();
    });
  }

  // Compact, non-expandable card for imported Frame.io comments — an
  // avatar + name + comment + delete, no edit/expand since the content
  // came from Frame.io rather than being authored here.
  function buildFrameioCard(card, note) {
    card.className = 'note-card frameio-comment-card' + (note.checked ? ' completed' : '') + (note.linked ? ' linked' : '') + (batchSelected[note.qcID] ? ' batch-selected' : '');

    var initials = frameioInitials(note.title);
    var color = frameioAvatarColor(note.title);
    var timeLabel = note.linked ? (note.timeText || '') : '';
    var navTitle = note.linked ? 'Jump to ' + (note.compName || 'linked comp') + (timeLabel ? ' at ' + timeLabel : '') : '';

    card.innerHTML =
      '<div class="frameio-comment-row">' +
        '<label class="check-wrap" title="' + (note.checked ? 'Mark incomplete' : 'Mark complete') + '">' +
          '<input class="note-check" type="checkbox" ' + (note.checked ? 'checked' : '') + ' />' +
          '<span class="fake-check"></span>' +
        '</label>' +
        '<div class="frameio-avatar" style="background:' + color + ';" title="' + escapeHTML(note.title) + '">' + escapeHTML(initials) + '</div>' +
        '<div class="frameio-comment-main" title="' + escapeHTML(navTitle) + '">' +
          '<div class="frameio-comment-head">' +
            '<span class="frameio-comment-name">' + escapeHTML(note.title) + '</span>' +
            (timeLabel ? '<span class="frameio-time-badge">' + escapeHTML(timeLabel) + '</span>' : '') +
          '</div>' +
          '<div class="frameio-comment-text">' + (note.note ? escapeHTML(note.note) : '') + '</div>' +
        '</div>' +
        '<button class="icon-btn delete" title="Delete comment" aria-label="Delete comment">' + icon('trash') + '</button>' +
      '</div>';

    var check = card.querySelector('.note-check');
    var row = card.querySelector('.frameio-comment-row');
    var del = card.querySelector('.delete');

    wireCheckbox(check, note);

    row.addEventListener('click', function (e) {
      if (e.target.closest('.check-wrap') || e.target.closest('.delete')) return;
      if (!note.linked) return;
      host('BBQC.jumpTo(' + esc(note.qcID) + ')', function () { refresh(true); });
    });

    wireDeleteButton(del, note);
  }

  function clearDropTargets() {
    var els = document.querySelectorAll('.drop-before, .drop-after');
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove('drop-before');
      els[i].classList.remove('drop-after');
    }
  }

  function reorderVisible(draggedId, targetId, placement) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    var ids = [];
    for (var i = 0; i < state.notes.length; i++) ids.push(state.notes[i].qcID);
    var from = ids.indexOf(draggedId);
    var target = ids.indexOf(targetId);
    if (from < 0 || target < 0) return;
    ids.splice(from, 1);
    target = ids.indexOf(targetId);
    if (placement === 'after') target++;
    ids.splice(target, 0, draggedId);
    host('BBQC.reorderVisible(' + esc(viewMode) + ',' + esc(ids.join('|')) + ')', function () { refresh(true); });
  }

  function openAdd() {
    editingId = null;
    noteModalTitle.textContent = 'Add Comment';
    noteTypeBlock.classList.remove('hidden');
    noteTitleInput.value = '';
    noteBodyInput.value = '';
    atPlayheadCheckbox.checked = true;
    manualTimecodeInput.value = '';
    setAddType('comp');
    noteModal.classList.remove('hidden');
    setTimeout(function () { noteTitleInput.focus(); }, 30);
  }

  function openEdit(note) {
    editingId = note.qcID;
    noteModalTitle.textContent = 'Edit Comment';
    noteTypeBlock.classList.add('hidden');
    noteTitleInput.value = note.title || '';
    noteBodyInput.value = note.note || '';
    noteModal.classList.remove('hidden');
    setTimeout(function () { noteTitleInput.focus(); }, 30);
  }

  function setAddType(type) {
    addType = type === 'project' ? 'project' : 'comp';
    typeProject.classList.toggle('active', addType === 'project');
    typeComp.classList.toggle('active', addType === 'comp');
    compTypeOptions.classList.toggle('hidden', addType !== 'comp');
    updateCompTypeUI();
  }

  function getActiveCompFrameRate() {
    var comps = state.comps || [];
    for (var i = 0; i < comps.length; i++) {
      if (comps[i].id === state.activeCompId) return comps[i].frameRate;
    }
    return null;
  }

  function updateCompTypeUI() {
    if (addType !== 'comp') return;
    var atPlayhead = atPlayheadCheckbox.checked;
    manualTimecodeBlock.classList.toggle('hidden', atPlayhead);
    playheadPreview.classList.toggle('hidden', !atPlayhead);

    if (!state.activeCompId) {
      playheadPreview.textContent = 'Open a composition first';
      manualTimecodeHelper.textContent = 'Open a composition first.';
      return;
    }
    if (atPlayhead) {
      playheadPreview.textContent = (state.activeCompName || 'Comp') + ' · ' + (state.activeTimeText || '0:00:00');
    } else {
      var fps = getActiveCompFrameRate();
      manualTimecodeHelper.textContent = fps
        ? 'Uses ' + (state.activeCompName || 'this comp') + '’s frame rate (' + trimFps(fps) + ' fps).'
        : '';
    }
  }

  // Parses "HH:MM:SS:FF" at the given frame rate into seconds; null if
  // the text isn't a valid 4-part timecode.
  function parseTimecodeToSeconds(text, fps) {
    var parts = String(text || '').trim().split(':');
    if (parts.length !== 4) return null;
    var nums = parts.map(function (p) { return parseInt(p, 10); });
    if (nums.some(function (n) { return isNaN(n) || n < 0; })) return null;
    var f = (fps && fps > 0) ? fps : 24;
    return nums[0] * 3600 + nums[1] * 60 + nums[2] + nums[3] / f;
  }

  function saveNote() {
    var title = noteTitleInput.value.trim();
    var body = noteBodyInput.value;
    if (!title) { noteTitleInput.focus(); return; }

    if (editingId) {
      host('BBQC.editNote(' + esc(editingId) + ',' + esc(title) + ',' + esc(body) + ')', function () {
        noteModal.classList.add('hidden'); refresh(true);
      });
      return;
    }

    if (addType === 'comp') {
      var explicitTime = null;
      if (!atPlayheadCheckbox.checked) {
        var seconds = parseTimecodeToSeconds(manualTimecodeInput.value, getActiveCompFrameRate());
        if (seconds === null) {
          manualTimecodeHelper.textContent = 'Enter a timecode as HH:MM:SS:FF.';
          manualTimecodeInput.focus();
          return;
        }
        explicitTime = seconds;
      }
      var args = esc(title) + ',' + esc(body) + (explicitTime !== null ? ',' + esc(explicitTime) : '');
      host('BBQC.addPlayheadNote(' + args + ')', function (result) {
        var response = parseHostJSON(result);
        if (response && response.ok === false) { alert(response.message || 'Could not add comment.'); return; }
        noteModal.classList.add('hidden'); refresh(true);
      });
    } else {
      host('BBQC.addProjectNote(' + esc(title) + ',' + esc(body) + ')', function () {
        noteModal.classList.add('hidden'); refresh(true);
      });
    }
  }

  function openSummary() {
    host('BBQC.getSummary(' + esc(viewMode) + ')', function (result) {
      summaryText.value = result || '';
      copyStatus.textContent = '';
      summaryModal.classList.remove('hidden');
    });
  }

  function copySummary() {
    summaryText.focus(); summaryText.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    copyStatus.textContent = ok ? 'Copied!' : 'Press Ctrl/Cmd+C';
  }

  addNoteBtn.addEventListener('click', function () { refresh(false); openAdd(); });
  summaryBtn.addEventListener('click', openSummary);


  function closeDeleteModal() {
    pendingDeleteId = null;
    pendingDeleteIds = [];
    deleteModal.classList.add('hidden');
    deleteModal.setAttribute('aria-hidden', 'true');
  }

  function openBatchDeleteModal(ids) {
    if (!ids.length) return;
    pendingDeleteId = null;
    pendingDeleteIds = ids.slice(0);
    deleteModalTitle.textContent = 'Delete ' + ids.length + ' Comment' + (ids.length === 1 ? '' : 's');
    deleteModalNoteTitle.textContent = 'This will remove all ' + ids.length + ' selected comments.';
    deleteModal.classList.remove('hidden');
    deleteModal.setAttribute('aria-hidden', 'false');
    deleteModalConfirm.focus();
  }

  if (batchDeleteBtn) batchDeleteBtn.addEventListener('click', function () { openBatchDeleteModal(selectedIds()); });

  if (selectAllBtn) selectAllBtn.addEventListener('click', function () {
    var allSelected = visibleNotesCache.length > 0 && visibleNotesCache.every(function (n) { return !!batchSelected[n.qcID]; });
    if (allSelected) {
      visibleNotesCache.forEach(function (n) { delete batchSelected[n.qcID]; });
    } else {
      visibleNotesCache.forEach(function (n) { batchSelected[n.qcID] = true; });
    }
    render();
  });

  if (markAllCheckbox) markAllCheckbox.addEventListener('change', function () {
    var markComplete = markAllCheckbox.checked;
    var ids = visibleNotesCache.map(function (n) { return n.qcID; });

    function next() {
      if (!ids.length) { refresh(true); return; }
      var id = ids.shift();
      host('BBQC.toggleNote(' + esc(id) + ',' + (markComplete ? 'true' : 'false') + ')', next);
    }

    next();
  });

  if (deleteModalClose) deleteModalClose.addEventListener('click', closeDeleteModal);
  if (deleteModalCancel) deleteModalCancel.addEventListener('click', closeDeleteModal);

  if (deleteModal) deleteModal.addEventListener('click', function (e) {
    if (e.target === deleteModal) closeDeleteModal();
  });

  if (deleteModalConfirm) deleteModalConfirm.addEventListener('click', function () {
    var ids = pendingDeleteIds.length ? pendingDeleteIds.slice(0) : (pendingDeleteId ? [pendingDeleteId] : []);
    if (!ids.length) return;

    closeDeleteModal();

    function removeNext() {
      if (!ids.length) {
        clearBatchSelection();
        refresh(true);
        return;
      }

      var id = ids.shift();

      host('BBQC.deleteNote(' + esc(id) + ')', function () {
        delete expanded[id];
        delete batchSelected[id];
        removeNext();
      });
    }

    removeNext();
  });


  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !deleteModal.classList.contains('hidden')) {
      closeDeleteModal();
    }
  });

  viewDropdownBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (viewDropdown.classList.contains('open')) closeViewMenu(); else openViewMenu();
  });
  for (var i = 0; i < viewOptions.length; i++) {
    viewOptions[i].addEventListener('click', function (e) {
      e.stopPropagation();
      setView(this.getAttribute('data-view'));
    });
  }

  function openSortMenu() {
    sortDropdown.classList.add('open');
    sortDropdownMenu.classList.remove('hidden');
    sortDropdownBtn.setAttribute('aria-expanded', 'true');
    syncSortHighlight();
  }

  function closeSortMenu() {
    sortDropdown.classList.remove('open');
    sortDropdownMenu.classList.add('hidden');
    sortDropdownBtn.setAttribute('aria-expanded', 'false');
  }

  // A single highlight bar that glides between options instead of each
  // one lighting up on its own. Returns a function that snaps the bar
  // (no animation) to whichever option is currently .selected — call it
  // right after the menu becomes visible, since a hidden (display:none)
  // option reports 0 for offsetTop/offsetHeight.
  function initSlidingHighlight(menu) {
    var bar = menu.querySelector('.select-highlight-bar');
    var options = Array.prototype.slice.call(menu.querySelectorAll('.custom-select-option'));
    if (!bar || !options.length) return function () {};

    function moveTo(option, animate) {
      if (!option) { bar.style.opacity = '0'; return; }
      if (!animate) bar.style.transition = 'none';
      bar.style.opacity = '1';
      bar.style.transform = 'translateY(' + option.offsetTop + 'px)';
      bar.style.height = option.offsetHeight + 'px';
      if (!animate) {
        void bar.offsetHeight; // force layout so this position applies before transitions are re-enabled
        bar.style.transition = '';
      }
    }

    options.forEach(function (opt) {
      opt.addEventListener('mouseenter', function () { moveTo(opt, true); });
    });
    menu.addEventListener('mouseleave', function () {
      moveTo(options.filter(function (o) { return o.classList.contains('selected'); })[0] || null, true);
    });

    return function syncToSelected() {
      moveTo(options.filter(function (o) { return o.classList.contains('selected'); })[0] || null, false);
    };
  }

  var syncViewHighlight = initSlidingHighlight(viewDropdownMenu);
  var syncSortHighlight = initSlidingHighlight(sortDropdownMenu);

  function updateSortControl() {
    for (var k = 0; k < sortOptions.length; k++) {
      var selected = sortOptions[k].getAttribute('data-sort') === sortBy;
      sortOptions[k].classList.toggle('selected', selected);
      sortOptions[k].setAttribute('aria-checked', selected ? 'true' : 'false');
    }
    if (hideCompletedCheckbox) hideCompletedCheckbox.checked = hideCompleted;
  }

  function setSortBy(mode) {
    sortBy = SORT_MODES.indexOf(mode) !== -1 ? mode : 'none';
    try { localStorage.setItem('BBQC.sortBy', sortBy); } catch (e) {}
    updateSortControl();
    render();
  }

  sortDropdownBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (sortDropdown.classList.contains('open')) closeSortMenu(); else openSortMenu();
  });
  for (var s = 0; s < sortOptions.length; s++) {
    sortOptions[s].addEventListener('click', function (e) {
      e.stopPropagation();
      setSortBy(this.getAttribute('data-sort'));
    });
  }
  if (hideCompletedCheckbox) hideCompletedCheckbox.addEventListener('change', function () {
    hideCompleted = hideCompletedCheckbox.checked;
    try { localStorage.setItem('BBQC.hideCompleted', hideCompleted ? '1' : '0'); } catch (e) {}
    render();
  });

  document.addEventListener('click', function (e) {
    if (!viewDropdown.contains(e.target)) closeViewMenu();
    if (!sortDropdown.contains(e.target)) closeSortMenu();
  });

  typeProject.addEventListener('click', function () { setAddType('project'); });
  typeComp.addEventListener('click', function () { setAddType('comp'); });
  atPlayheadCheckbox.addEventListener('change', updateCompTypeUI);
  saveNoteBtn.addEventListener('click', saveNote);
  copySummaryBtn.addEventListener('click', copySummary);

  var closeButtons = document.querySelectorAll('[data-close]');
  for (var j = 0; j < closeButtons.length; j++) {
    closeButtons[j].addEventListener('click', function () {
      document.getElementById(this.getAttribute('data-close')).classList.add('hidden');
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeViewMenu();
      closeSortMenu();
      noteModal.classList.add('hidden');
      summaryModal.classList.add('hidden');
    }
  });

  // ---------------------------------------------------------
  // Frame.io panel toggle
  // ---------------------------------------------------------

  if (frameioToggleBtn) frameioToggleBtn.addEventListener('click', function () { openFrameioSettings(); });

  // ---------------------------------------------------------
  // Frame.io composition syncs — each association is a composition
  // paired with the Frame.io link its comments come from. Comments only
  // ever make sense attached to a composition's timeline, never the
  // project as a whole, so the picker below only ever lists compositions.
  // ---------------------------------------------------------

  function populateNewSyncCompSelect() {
    var comps = state.comps || [];
    frameioNewSyncCompSelect.innerHTML = '';
    if (!comps.length) {
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'No compositions in this project';
      frameioNewSyncCompSelect.appendChild(placeholder);
      frameioNewSyncCompSelect.disabled = true;
      return;
    }
    frameioNewSyncCompSelect.disabled = false;
    comps.forEach(function (comp) {
      var option = document.createElement('option');
      option.value = String(comp.id);
      option.textContent = comp.name;
      frameioNewSyncCompSelect.appendChild(option);
    });
    if (state.activeCompId && comps.some(function (c) { return c.id === state.activeCompId; })) {
      frameioNewSyncCompSelect.value = String(state.activeCompId);
    }
  }

  function renderFrameioSyncList() {
    if (!frameioSyncList) return;
    host('BBQC.getFrameioSyncs()', function (result) {
      var syncs = parseHostJSON(result) || [];
      frameioSyncList.innerHTML = '';
      frameioSyncEmpty.classList.toggle('hidden', syncs.length > 0);

      syncs.forEach(function (sync) {
        var row = document.createElement('div');
        row.className = 'frameio-sync-row';
        row.innerHTML =
          '<div class="frameio-sync-info">' +
            '<div class="frameio-sync-comp">' + escapeHTML(sync.compName) + '</div>' +
            '<div class="frameio-sync-link" title="' + escapeHTML(sync.link) + '">' + escapeHTML(sync.link) + '</div>' +
          '</div>' +
          '<button class="icon-btn frameio-sync-edit" title="Edit link" aria-label="Edit this composition sync’s link">' + icon('edit') + '</button>' +
          '<button class="icon-btn frameio-sync-remove" title="Remove" aria-label="Remove this composition sync">' + icon('trash') + '</button>';

        row.querySelector('.frameio-sync-edit').addEventListener('click', function () {
          openAddSyncForm(sync);
        });
        row.querySelector('.frameio-sync-remove').addEventListener('click', function () {
          host('BBQC.removeFrameioSync(' + esc(sync.compId) + ')', function () { renderFrameioSyncList(); refresh(false); });
        });
        frameioSyncList.appendChild(row);
      });
    });
  }

  // Set while editing an existing sync, to whatever link it had when the
  // form opened — saveNewSync compares against this to tell "link actually
  // changed" (prune the old link's imported comments) from "just hit Save
  // with the same link" (nothing to prune). Null while adding a fresh sync.
  var _editingSyncOldLink = null;

  // Pass an existing sync to edit its link (and optionally reassign its
  // composition) instead of adding a new one — addFrameioSync upserts by
  // compId either way, so Save just works for both cases.
  function openAddSyncForm(existingSync) {
    populateNewSyncCompSelect();
    frameioNewSyncLinkInput.value = existingSync ? existingSync.link : '';
    if (existingSync) frameioNewSyncCompSelect.value = String(existingSync.compId);
    frameioAddSyncSaveBtn.textContent = existingSync ? 'Save' : 'Add';
    frameioAddSyncStatus.textContent = '';
    frameioAddSyncForm.classList.remove('hidden');
    frameioAddSyncBtn.classList.add('hidden');
    _editingSyncOldLink = existingSync ? existingSync.link : null;
  }

  function closeAddSyncForm() {
    frameioAddSyncForm.classList.add('hidden');
    frameioAddSyncBtn.classList.remove('hidden');
  }

  // New or edited, a sync always gets an immediate one-off sync so its
  // comments show up right away instead of waiting for the next poll.
  function saveNewSync() {
    var compId = frameioNewSyncCompSelect.value;
    var link = frameioNewSyncLinkInput.value.trim();
    if (!compId) { frameioAddSyncStatus.textContent = 'Create or open a composition first.'; return; }
    if (!link) { frameioNewSyncLinkInput.focus(); return; }

    // Captured now, not read again later — openAddSyncForm could in theory
    // be called again (a new edit) before this save's async chain resolves.
    var linkChanged = !!(_editingSyncOldLink && _editingSyncOldLink !== link);

    frameioAddSyncSaveBtn.disabled = true;
    frameioAddSyncStatus.textContent = 'Saving…';

    host('BBQC.addFrameioSync(' + esc(compId) + ',' + esc(link) + ')', function (result) {
      var response = parseHostJSON(result);
      if (!response || !response.ok) {
        frameioAddSyncSaveBtn.disabled = false;
        frameioAddSyncStatus.textContent = (response && response.message) || 'Could not add that composition sync.';
        return;
      }
      renderFrameioSyncList();
      refresh(false);
      frameioAddSyncStatus.textContent = 'Syncing…';

      syncComposition(compId, link, function (added, updated, skipped, err, assetFrameRate, shareId) {
        frameioAddSyncSaveBtn.disabled = false;
        closeAddSyncForm();
        if (err) { updateFrameioSyncIndicator(); return; }

        function finishSync() {
          frameioLastSyncAt = Date.now();
          updateFrameioSyncIndicator();
          refresh(true);
          maybePromptFrameRateMismatch(compId, assetFrameRate);
        }

        // The link was swapped for a different one on the same composition —
        // whatever comments got imported under the old link are no longer
        // relevant now that its comments have been imported instead. Comments
        // added manually here in BBQC (no frameioCommentId) are untouched.
        if (linkChanged) {
          host('BBQC.pruneFrameioComments(' + esc(compId) + ',' + esc(shareId || '') + ')', function () { finishSync(); });
        } else {
          finishSync();
        }
      });
    });
  }

  if (frameioAddSyncBtn) frameioAddSyncBtn.addEventListener('click', function () { openAddSyncForm(); });
  if (frameioAddSyncCancelBtn) frameioAddSyncCancelBtn.addEventListener('click', closeAddSyncForm);
  if (frameioAddSyncSaveBtn) frameioAddSyncSaveBtn.addEventListener('click', saveNewSync);

  // Purely informational, only surfaced right when a sync is first
  // assigned (or its link is edited) — not on every later sync. 23.976
  // vs 24, 29.97 vs 30 etc. are the same rate in practice, so those don't
  // count as a mismatch worth interrupting for.
  function maybePromptFrameRateMismatch(compId, assetFrameRate) {
    if (!assetFrameRate) return;
    var comp = null;
    for (var i = 0; i < (state.comps || []).length; i++) {
      if (String(state.comps[i].id) === String(compId)) { comp = state.comps[i]; break; }
    }
    if (!comp || !comp.frameRate) return;
    if (Math.abs(comp.frameRate - assetFrameRate) < 0.5) return;

    frameioFpsModal.dataset.compId = String(compId);
    frameioFpsModal.dataset.assetFps = String(assetFrameRate);
    frameioFpsModalText.textContent =
      '"' + comp.name + '" is ' + trimFps(comp.frameRate) + ' fps, but this Frame.io asset is ' +
      trimFps(assetFrameRate) + ' fps. Change the composition to ' + trimFps(assetFrameRate) + ' fps to match?';
    frameioFpsModal.classList.remove('hidden');
  }

  function trimFps(fps) {
    return (Math.round(fps * 100) / 100).toString();
  }

  if (frameioFpsModalConfirm) frameioFpsModalConfirm.addEventListener('click', function () {
    var compId = frameioFpsModal.dataset.compId;
    var assetFps = frameioFpsModal.dataset.assetFps;
    host('BBQC.setCompFrameRate(' + esc(compId) + ',' + esc(assetFps) + ')', function (result) {
      var response = parseHostJSON(result);
      frameioFpsModal.classList.add('hidden');
      if (!response || !response.ok) return;
      refresh(true);
    });
  });

  // ---------------------------------------------------------
  // Frame.io settings
  // ---------------------------------------------------------

  function setFrameioTab(tabName) {
    frameioTabButtons.forEach(function (btn) {
      var selected = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    frameioTabSync.classList.toggle('hidden', tabName !== 'sync');
    frameioTabAccount.classList.toggle('hidden', tabName !== 'account');
    if (frameioTabSettings) frameioTabSettings.classList.toggle('hidden', tabName !== 'settings');
  }

  frameioTabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { setFrameioTab(btn.getAttribute('data-tab')); });
  });

  // ---------------------------------------------------------
  // Frame.io auto-poll settings — how often the background poll (further
  // below) checks synced links for new comments, and whether it runs at all.
  // ---------------------------------------------------------

  var FRAMEIO_POLL_STORAGE_ENABLED = 'bbqc-frameio-autopoll-enabled';
  var FRAMEIO_POLL_STORAGE_MINUTES = 'bbqc-frameio-autopoll-minutes';
  var FRAMEIO_POLL_DEFAULT_MINUTES = 5;

  function _loadFrameioPollEnabled() {
    try {
      var v = localStorage.getItem(FRAMEIO_POLL_STORAGE_ENABLED);
      return v === null ? true : v === '1'; // absent (fresh install) defaults to on
    } catch (e) { return true; }
  }
  function _saveFrameioPollEnabled(enabled) {
    try { localStorage.setItem(FRAMEIO_POLL_STORAGE_ENABLED, enabled ? '1' : '0'); } catch (e) {}
  }
  function _loadFrameioPollMinutes() {
    try {
      var v = parseInt(localStorage.getItem(FRAMEIO_POLL_STORAGE_MINUTES), 10);
      return v > 0 ? v : FRAMEIO_POLL_DEFAULT_MINUTES;
    } catch (e) { return FRAMEIO_POLL_DEFAULT_MINUTES; }
  }
  function _saveFrameioPollMinutes(minutes) {
    try { localStorage.setItem(FRAMEIO_POLL_STORAGE_MINUTES, String(minutes)); } catch (e) {}
  }

  var _frameioPollTimer = null;

  function _clearFrameioPollTimers() {
    if (_frameioPollTimer) { clearInterval(_frameioPollTimer); _frameioPollTimer = null; }
  }

  // (Re)starts the background poll on the current enabled/interval settings —
  // called on load and any time either setting changes, so a change takes
  // effect immediately instead of waiting for the old interval to finish.
  function _scheduleFrameioPoll() {
    _clearFrameioPollTimers();
    _updateFrameioPollStatusText();
    if (!_loadFrameioPollEnabled()) return;

    var ms = _loadFrameioPollMinutes() * 60 * 1000;
    _frameioPollTimer = setInterval(function () { pollFrameioSyncs(); }, ms);
  }

  // Same "X ago" wording as the sync indicator (formatRelativeSyncTime) —
  // called from updateFrameioSyncIndicator below so it always reflects the
  // same frameioLastSyncAt, whether that came from a manual or automatic check.
  function _updateFrameioPollStatusText() {
    if (!frameioPollStatusText) return;
    if (!_loadFrameioPollEnabled()) { frameioPollStatusText.textContent = 'Auto-check is off.'; return; }
    frameioPollStatusText.textContent = frameioLastSyncAt ? ('Last checked ' + formatRelativeSyncTime(frameioLastSyncAt)) : 'Not checked yet.';
  }

  if (frameioAutoPollCheckbox) {
    frameioAutoPollCheckbox.checked = _loadFrameioPollEnabled();
    frameioAutoPollCheckbox.addEventListener('change', function () {
      _saveFrameioPollEnabled(frameioAutoPollCheckbox.checked);
      if (frameioPollIntervalSelect) frameioPollIntervalSelect.disabled = !frameioAutoPollCheckbox.checked;
      _scheduleFrameioPoll();
    });
  }
  if (frameioPollIntervalSelect) {
    frameioPollIntervalSelect.value = String(_loadFrameioPollMinutes());
    frameioPollIntervalSelect.disabled = !_loadFrameioPollEnabled();
    frameioPollIntervalSelect.addEventListener('change', function () {
      _saveFrameioPollMinutes(parseInt(frameioPollIntervalSelect.value, 10) || FRAMEIO_POLL_DEFAULT_MINUTES);
      _scheduleFrameioPoll();
    });
  }

  function updateFrameioConnectionUI() {
    var connected = !!(window.BBQCFrameIO && window.BBQCFrameIO.isConnected());
    frameioConnectBtn.classList.toggle('hidden', connected);
    frameioDisconnectBtn.classList.toggle('hidden', !connected);
    frameioTestStatus.textContent = connected ? 'Connected to Frame.io.' : 'Not connected.';
    updateFrameioSyncIndicator();
  }

  function openFrameioSettings() {
    frameioManualOpenBlock.classList.add('hidden');
    updateFrameioConnectionUI();
    closeAddSyncForm();
    renderFrameioSyncList();
    setFrameioTab('sync');
    frameioSettingsModal.classList.remove('hidden');
  }

  function copySigninLink() {
    frameioSigninLinkInput.focus();
    frameioSigninLinkInput.select();
    try { document.execCommand('copy'); } catch (e) {}
  }

  function signInToFrameio() {
    if (!window.BBQCFrameIO) return;
    frameioManualOpenBlock.classList.add('hidden');
    frameioConnectBtn.disabled = true;
    frameioTestStatus.textContent = 'Opening your browser to sign in…';

    window.BBQCFrameIO.beginSignIn(function (url) {
      frameioSigninLinkInput.value = url;
      frameioManualOpenBlock.classList.remove('hidden');
    }).then(function (result) {
      frameioConnectBtn.disabled = false;
      frameioManualOpenBlock.classList.add('hidden');
      updateFrameioConnectionUI();
      frameioTestStatus.textContent = 'Connected (' + result.accountCount + ' account' + (result.accountCount === 1 ? '' : 's') + ').';
    }).catch(function (err) {
      frameioConnectBtn.disabled = false;
      frameioTestStatus.textContent = err && err.message ? err.message : 'Sign-in failed.';
    });
  }

  function signOutOfFrameio() {
    if (!window.BBQCFrameIO) return;
    window.BBQCFrameIO.disconnect();
    updateFrameioConnectionUI();
  }

  if (frameioConnectBtn) frameioConnectBtn.addEventListener('click', signInToFrameio);
  if (frameioDisconnectBtn) frameioDisconnectBtn.addEventListener('click', signOutOfFrameio);
  if (frameioCopyLinkBtn) frameioCopyLinkBtn.addEventListener('click', copySigninLink);

  // ---------------------------------------------------------
  // Frame.io sync
  // ---------------------------------------------------------

  // done(added, updated, skipped) — "updated" means the comment was
  // already imported but its marker got moved because the time computed
  // for it today no longer matches what's stored (e.g. it was imported
  // before a fix to Frame.io timestamp math).
  function importFrameioItemsSequentially(items, compId, done) {
    var added = 0;
    var updated = 0;
    var skipped = 0;

    function next() {
      if (!items.length) { done(added, updated, skipped); return; }
      var item = items.shift();
      host(
        'BBQC.importFrameioComment(' + esc(item.commentId) + ',' + esc(item.shareId) + ',' + esc(item.title) + ',' + esc(item.note) + ',' + esc(item.timeSeconds) + ',' + esc(compId) + ')',
        function (result) {
          var response = parseHostJSON(result);
          if (response && response.ok === false) {
            // Import failed for this one comment — skip quietly and continue.
          } else if (response && response.added) {
            added++;
          } else if (response && response.updated) {
            updated++;
          } else {
            skipped++;
          }
          next();
        }
      );
    }

    next();
  }

  // Fetches one composition's Frame.io link and imports/corrects whatever
  // comments need it. done(added, updated, skipped, err, assetFrameRate,
  // shareId) — err is set only on failure; added/updated/skipped all 0 with
  // no err just means nothing changed. assetFrameRate/shareId are null on
  // failure. shareId identifies which Frame.io share this link resolved to —
  // callers use it to tell "comments from this link" apart from comments
  // imported under a since-replaced link on the same composition.
  function syncComposition(compId, link, done) {
    if (!window.BBQCFrameIO || !window.BBQCFrameIO.isConnected()) {
      done(0, 0, 0, new Error('Connect to Frame.io first.'), null, null);
      return;
    }
    window.BBQCFrameIO.syncShareLink(link).then(function (result) {
      if (!result.items.length) { done(0, 0, 0, null, result.assetFrameRate, result.shareId); return; }
      importFrameioItemsSequentially(result.items.slice(0), compId, function (added, updated, skipped) {
        done(added, updated, skipped, null, result.assetFrameRate, result.shareId);
      });
    }).catch(function (err) {
      done(0, 0, 0, err, null, null);
    });
  }

  // ---------------------------------------------------------
  // Frame.io background poll — checks (on the interval set in Frame.io
  // Settings, default 5 minutes; can be turned off entirely) for new
  // comments on each synced composition's link. scanFrameioSyncs() only
  // checks; it never imports on its own, so the background poll can't
  // silently rewrite the timeline — it just flags the indicator yellow
  // with a count.
  // ---------------------------------------------------------

  var pendingFrameioChanges = [];

  function scanFrameioSyncs(done) {
    if (!window.BBQCFrameIO || !window.BBQCFrameIO.isConnected()) { done([]); return; }

    host('BBQC.getFrameioSyncs()', function (result) {
      var syncs = parseHostJSON(result) || [];
      if (!syncs.length) { done([]); return; }

      var found = [];

      function checkNext(i) {
        if (i >= syncs.length) { done(found); return; }
        var sync = syncs[i];
        window.BBQCFrameIO.syncShareLink(sync.link).then(function (result) {
          if (!result.items.length) { checkNext(i + 1); return; }
          var ids = result.items.map(function (item) { return item.commentId; }).join(',');
          host('BBQC.countNewFrameioComments(' + esc(ids) + ')', function (countResult) {
            var newCount = parseInt(countResult, 10) || 0;
            if (newCount > 0) found.push({ compId: sync.compId, compName: sync.compName, items: result.items, newCount: newCount });
            checkNext(i + 1);
          });
        }).catch(function () { checkNext(i + 1); }); // background check — fail quietly, try again next poll
      }

      checkNext(0);
    });
  }

  function importFoundFrameioItems(found, done) {
    function next(i) {
      if (i >= found.length) { done(); return; }
      var p = found[i];
      importFrameioItemsSequentially(p.items.slice(0), p.compId, function () { next(i + 1); });
    }
    next(0);
  }

  // Only the automatic background poll ever stores pending changes /
  // turns the indicator yellow. A manual click (see updateFrameioSyncIndicator
  // below) always scans and imports in one step instead.
  function pollFrameioSyncs() {
    scanFrameioSyncs(function (found) {
      pendingFrameioChanges = found;
      if (!found.length) frameioLastSyncAt = Date.now();
      updateFrameioSyncIndicator();
    });
  }

  function applyPendingFrameioChanges() {
    var pending = pendingFrameioChanges.slice(0);
    pendingFrameioChanges = [];
    frameioSyncBusy = true;
    updateFrameioSyncIndicator();

    importFoundFrameioItems(pending, function () {
      frameioSyncBusy = false;
      frameioLastSyncAt = Date.now();
      updateFrameioSyncIndicator();
      refresh(true);
      _scheduleFrameioPoll(); // just checked everything by hand — push the next automatic check back out a full interval
    });
  }

  // A quick first check shortly after opening the panel, separate from the
  // recurring interval below (which, at the 5-minute default, would
  // otherwise leave a fresh sync with a stale-looking indicator for a while).
  if (_loadFrameioPollEnabled()) setTimeout(function () { pollFrameioSyncs(); }, 20 * 1000);
  _scheduleFrameioPoll();
  setInterval(updateFrameioSyncIndicator, 20 * 1000);

  window.addEventListener('focus', function () { refresh(false); });
  setInterval(function () { refresh(false); }, 1800);
  updateViewControl();
  updateSortControl();
  updateFrameioSyncIndicator();
  refresh(true);
})();
