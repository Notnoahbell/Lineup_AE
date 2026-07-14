/* Lineup CEP — Update checker
   Compares the installed manifest version against the latest GitHub Release
   for this repo, and surfaces a dismissible banner (plus a manual "Check for
   Updates" button in Settings) when a newer one is available. */

(function () {

    var REPO = 'Notnoahbell/Lineup_AE';
    var CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // re-hit the GitHub API at most once a day
    var LS_LATEST    = 'lineup-update-latest';    // cached { version, url, checkedAt }
    var LS_DISMISSED = 'lineup-update-dismissed'; // version string the user closed the banner for

    // TEMP TESTING SWITCH — flip to false (or delete this block) once the
    // banner has been eyeballed. Forces the banner on with fake data on every
    // launch, bypassing the real version check and the dismissed-state check.
    var DEBUG_FORCE_SHOW_BANNER = false;

    var _localVersion = null;
    var _installing = false; // true while the confirm dialog's install is running — blocks dismissal

    function _parseManifestVersion(xml) {
        var m = /ExtensionBundleVersion="([^"]+)"/.exec(xml);
        return m ? m[1] : null;
    }

    function _compareVersions(a, b) {
        var pa = String(a).split('.'), pb = String(b).split('.');
        var len = Math.max(pa.length, pb.length);
        for (var i = 0; i < len; i++) {
            var na = parseInt(pa[i], 10) || 0;
            var nb = parseInt(pb[i], 10) || 0;
            if (na !== nb) return na > nb ? 1 : -1;
        }
        return 0;
    }

    function _readCachedLatest() {
        try { return JSON.parse(localStorage.getItem(LS_LATEST) || 'null'); } catch (e) { return null; }
    }
    function _writeCachedLatest(latest) {
        try { localStorage.setItem(LS_LATEST, JSON.stringify(latest)); } catch (e) {}
    }

    function _showBanner(latest) {
        var banner = document.getElementById('updateBanner');
        var text   = document.getElementById('updateBannerText');
        if (!banner || !text) return;
        text.textContent = 'Lineup v' + latest.version + ' is available (you have v' + _localVersion + ')';
        banner.setAttribute('data-latest-version', latest.version);
        banner.setAttribute('data-latest-url', latest.url || '');
        banner.setAttribute('data-latest-zip', latest.zipUrl || '');
        banner.classList.remove('update-banner-hidden');
    }

    function _hideBanner() {
        var banner = document.getElementById('updateBanner');
        if (banner) banner.classList.add('update-banner-hidden');
    }

    // Decides whether to show/hide the passive banner for a given "latest
    // release" result. Only used by the background check now — a manual
    // "Check for Updates" click uses _showInstallConfirm instead, which
    // always prompts regardless of a prior dismissal.
    function _evaluateBanner(latest) {
        if (!latest || !_localVersion) return;
        if (_compareVersions(latest.version, _localVersion) <= 0) { _hideBanner(); return; }
        var dismissed = null;
        try { dismissed = localStorage.getItem(LS_DISMISSED); } catch (e) {}
        if (dismissed === latest.version) return;
        _showBanner(latest);
    }

    // The manual "Check for Updates" result: instead of the passive
    // dismissible banner, ask the user directly whether to install now.
    function _showInstallConfirm(latest) {
        var overlay = document.getElementById('updateConfirmOverlay');
        var text    = document.getElementById('updateConfirmText');
        if (!overlay || !text) return;

        // "Check for Updates" lives inside the Settings modal — both share
        // the same .settings-overlay z-index, so Settings (later in the DOM)
        // would otherwise sit on top and hide this dialog entirely.
        if (typeof closeSettings === 'function') closeSettings();

        _installing = false;
        var actions      = document.getElementById('updateConfirmActions');
        var progressWrap = document.getElementById('updateConfirmProgressWrap');
        var progressFill = document.getElementById('updateConfirmProgressFill');
        if (actions) actions.classList.remove('update-progress-hidden');
        if (progressWrap) progressWrap.classList.add('update-progress-hidden');
        if (progressFill) progressFill.style.width = '0%';

        text.textContent = 'Lineup v' + latest.version + ' is available (you have v' + _localVersion + '). Install it now?';
        overlay.setAttribute('data-latest-version', latest.version);
        overlay.setAttribute('data-latest-url', latest.url || '');
        overlay.setAttribute('data-latest-zip', latest.zipUrl || '');
        overlay.classList.remove('update-confirm-hidden');
    }

    function _hideInstallConfirm() {
        var overlay = document.getElementById('updateConfirmOverlay');
        if (overlay) overlay.classList.add('update-confirm-hidden');
    }

    window.dismissInstallConfirm = function () {
        if (_installing) return; // no backing out mid-install
        _hideInstallConfirm();
    };

    // "Update" on the confirm dialog. When Node's available, installs right
    // inside the dialog — swap the Not Now/Update buttons for a progress bar,
    // run the download/extract/copy, then force a reload. Without Node (or
    // no zip to install), there's nothing to show progress for, so just fall
    // back to opening the release in a browser via the banner, as before.
    window.confirmInstallUpdate = function () {
        var overlay = document.getElementById('updateConfirmOverlay');
        var version = overlay ? overlay.getAttribute('data-latest-version') : '';
        var url     = overlay ? overlay.getAttribute('data-latest-url') : '';
        var zipUrl  = overlay ? overlay.getAttribute('data-latest-zip') : '';

        if (!_nodeAvailable() || !zipUrl) {
            _hideInstallConfirm();
            _showBanner({ version: version, url: url, zipUrl: zipUrl });
            _openInBrowser(url, document.getElementById('updateBannerText'));
            return;
        }

        _installing = true;
        var actions      = document.getElementById('updateConfirmActions');
        var progressWrap = document.getElementById('updateConfirmProgressWrap');
        var progressText = document.getElementById('updateConfirmProgressText');
        var progressFill = document.getElementById('updateConfirmProgressFill');
        if (actions) actions.classList.add('update-progress-hidden');
        if (progressWrap) progressWrap.classList.remove('update-progress-hidden');

        _installUpdate(zipUrl, progressText, function (pct) {
            if (progressFill) progressFill.style.width = pct + '%';
        }, function () {
            // Install failed — showToast already explained why; let the
            // user close the dialog and try again instead of being stuck.
            _installing = false;
            if (actions) actions.classList.remove('update-progress-hidden');
            if (progressWrap) progressWrap.classList.add('update-progress-hidden');
        });
    };

    function _loadLocalVersion(cb) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'CSXS/manifest.xml', true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200 || xhr.status === 0) _localVersion = _parseManifestVersion(xhr.responseText);
            cb(_localVersion);
        };
        xhr.onerror = function () { cb(null); };
        xhr.send();
    }

    // cb(latest, errorReason) — errorReason is null on success, otherwise a
    // short human-readable string distinguishing "no release published yet"
    // (404 — expected until the first Release is drafted) from an actual
    // network/connectivity failure, since those need very different fixes.
    function _fetchLatestRelease(cb) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.github.com/repos/' + REPO + '/releases/latest', true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 404) { cb(null, 'no releases published yet'); return; }
            if (xhr.status !== 200) { cb(null, 'GitHub returned status ' + xhr.status); return; }
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { cb(null, 'bad response from GitHub'); return; }
            var tag = (data.tag_name || '').replace(/^v/i, '');
            if (!tag) { cb(null, 'release has no tag'); return; }
            // Prefer a packaged asset (.zxp/.zip) if the release has one; fall
            // back to the release page itself for the "open in browser" link.
            var url = data.html_url;
            // zipUrl is what the in-app installer actually downloads — a
            // manually-attached asset takes priority since its contents are
            // curated, but GitHub auto-generates a source zipball for every
            // release/tag with zero setup, so there's always a fallback even
            // if no asset is ever attached.
            var zipUrl = data.zipball_url || null;
            if (data.assets && data.assets.length) {
                for (var i = 0; i < data.assets.length; i++) {
                    if (/\.(zxp|zip)$/i.test(data.assets[i].name || '')) {
                        url = data.assets[i].browser_download_url;
                        zipUrl = data.assets[i].browser_download_url;
                        break;
                    }
                }
            }
            cb({ version: tag, url: url, zipUrl: zipUrl, checkedAt: Date.now() }, null);
        };
        xhr.onerror = function () { cb(null, 'no connection to GitHub'); };
        xhr.send();
    }

    // force=true (from the Settings button) always hits the network and
    // reports back even when already up to date; the passive startup check
    // only hits the network once a day and stays silent either way.
    window.checkForUpdates = function (force) {
        _loadLocalVersion(function (localVer) {
            if (!localVer) return;

            var footerEl = document.getElementById('footerVersion');
            if (footerEl) footerEl.textContent = 'v' + localVer;
            var settingsVerEl = document.getElementById('settingsVersionLbl');
            if (settingsVerEl) settingsVerEl.textContent = 'Version ' + localVer;

            if (DEBUG_FORCE_SHOW_BANNER) {
                _showBanner({ version: '9.9.9', url: 'https://github.com/' + REPO + '/releases/latest' });
                return;
            }

            var cached = _readCachedLatest();
            // A manual "Check for Updates" always hits the network fresh
            // (below) and confirms via a modal instead of the passive
            // banner — showing the banner from stale cached data first
            // would just be a banner immediately superseded by the modal.
            if (!force && cached) _evaluateBanner(cached);

            var stale = !cached || (Date.now() - (cached.checkedAt || 0) > CHECK_INTERVAL_MS);
            if (!force && !stale) return;

            _fetchLatestRelease(function (latest, errorReason) {
                if (!latest) {
                    if (force) showToast('Could not check for updates — ' + (errorReason || 'unknown error') + '.');
                    return;
                }
                _writeCachedLatest(latest);

                if (!force) { _evaluateBanner(latest); return; }

                if (_compareVersions(latest.version, localVer) > 0) {
                    _showInstallConfirm(latest);
                } else {
                    showToast("You're on the latest version (v" + localVer + ")", 'info');
                }
            });
        });
    };

    // Selects text in a throwaway textarea and copies it via the legacy
    // execCommand path — the modern Clipboard API needs a "secure context"
    // that a file:// panel may not qualify as, so this is the one clipboard
    // method that reliably works from a CEP panel regardless.
    function _copyText(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        return ok;
    }

    // ── Self-update install (Node.js, mixed-context) ────────────────────────
    // Requires <CEFCommandLine><Parameter>--enable-nodejs</Parameter>
    // <Parameter>--mixed-context</Parameter></CEFCommandLine> in manifest.xml
    // (see CSXS/manifest.xml). Manifest changes only take effect after After
    // Effects restarts — so on a machine that hasn't restarted since this
    // shipped, `require` won't exist yet and downloadUpdate() below falls
    // back to the old "open in browser" behavior automatically.

    function _nodeAvailable() {
        return typeof require === 'function';
    }

    // GitHub requires a User-Agent on every request and 3xx-redirects zipball
    // downloads (api.github.com -> codeload.github.com); Node's https.get
    // doesn't follow redirects on its own.
    function _httpsGetFollowingRedirects(url, cb, redirectsLeft) {
        var https = require('https');
        if (redirectsLeft === undefined) redirectsLeft = 5;
        var req = https.get(url, { headers: { 'User-Agent': 'Lineup-CEP-Updater' } }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (redirectsLeft <= 0) { cb(new Error('too many redirects')); return; }
                _httpsGetFollowingRedirects(res.headers.location, cb, redirectsLeft - 1);
                return;
            }
            if (res.statusCode !== 200) { cb(new Error('HTTP ' + res.statusCode)); return; }
            cb(null, res);
        });
        req.on('error', function (err) { cb(err); });
    }

    // onProgress(pct) reports 0-100 based on bytes received vs. Content-Length
    // when GitHub sends one; if it doesn't, progress just stays put until the
    // download finishes rather than guessing.
    function _downloadToFile(url, destPath, onProgress, cb) {
        var fs = require('fs');
        _httpsGetFollowingRedirects(url, function (err, res) {
            if (err) { cb(err); return; }
            var total = parseInt(res.headers['content-length'], 10) || 0;
            var received = 0;
            if (total > 0 && typeof onProgress === 'function') {
                res.on('data', function (chunk) {
                    received += chunk.length;
                    onProgress(Math.min(70, Math.round((received / total) * 70)));
                });
            }
            var file = fs.createWriteStream(destPath);
            res.pipe(file);
            file.on('finish', function () { file.close(function () { cb(null); }); });
            file.on('error', function (err2) { cb(err2); });
        });
    }

    // Shell out to the OS's own unzip rather than hand-rolling a zip parser —
    // `unzip` ships with macOS and PowerShell's Expand-Archive ships with
    // Windows 10+, so this needs nothing bundled with the extension.
    function _extractZip(zipPath, destDir, cb) {
        var cp = require('child_process');
        var isWin = (typeof process !== 'undefined' && process.platform === 'win32');
        if (isWin) {
            var psCmd = 'Expand-Archive -LiteralPath "' + zipPath.replace(/"/g, '""') +
                '" -DestinationPath "' + destDir.replace(/"/g, '""') + '" -Force';
            cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], function (err) { cb(err || null); });
        } else {
            cp.execFile('/usr/bin/unzip', ['-o', '-q', zipPath, '-d', destDir], function (err) { cb(err || null); });
        }
    }

    // Hand-rolled instead of fs.mkdirSync(dir, {recursive:true}) / fs.cpSync —
    // the Node version bundled with CEP is whatever shipped with the user's
    // AE version (as old as Node 7 on CEP 8 / AE 2018), predating both APIs.
    function _mkdirp(dir) {
        var fs = require('fs');
        var path = require('path');
        if (fs.existsSync(dir)) return;
        _mkdirp(path.dirname(dir));
        try { fs.mkdirSync(dir); } catch (e) { if (!fs.existsSync(dir)) throw e; }
    }

    function _copyRecursive(srcDir, destDir) {
        var fs = require('fs');
        var path = require('path');
        _mkdirp(destDir);
        var entries = fs.readdirSync(srcDir);
        for (var i = 0; i < entries.length; i++) {
            var srcPath = path.join(srcDir, entries[i]);
            var destPath = path.join(destDir, entries[i]);
            if (fs.statSync(srcPath).isDirectory()) {
                _copyRecursive(srcPath, destPath);
            } else {
                fs.writeFileSync(destPath, fs.readFileSync(srcPath));
            }
        }
    }

    function _removeRecursive(dir) {
        var fs = require('fs');
        var path = require('path');
        if (!fs.existsSync(dir)) return;
        var entries = fs.readdirSync(dir);
        for (var i = 0; i < entries.length; i++) {
            var p = path.join(dir, entries[i]);
            if (fs.statSync(p).isDirectory()) _removeRecursive(p);
            else fs.unlinkSync(p);
        }
        fs.rmdirSync(dir);
    }

    // The folders/files an install actually needs to touch — mirrors the
    // allowlist in update_mac.sh / update_win.cmd rather than copying the
    // whole downloaded repo (install scripts, README, etc.) over the live
    // extension.
    var INSTALL_FOLDERS = ['CSXS', 'host', 'css', 'js', 'data'];

    // onProgress(pct) gets called with a 0-100 milestone as each phase
    // (download/extract/copy) advances; onError(err) fires instead of the
    // rest of the chain running whenever a phase fails, after showToast has
    // already explained why, so a caller with its own UI (the confirm
    // dialog) can revert out of its "installing" state.
    function _installUpdate(zipUrl, text, onProgress, onError) {
        var fs = require('fs');
        var os = require('os');
        var path = require('path');

        function setProgress(pct) { if (typeof onProgress === 'function') onProgress(pct); }
        function fail(msg) {
            showToast(msg);
            if (typeof onError === 'function') onError(msg);
        }

        var extDir = cs.getSystemPath(SystemPath.EXTENSION);
        if (!extDir || !/CEP[\\\/]extensions/i.test(extDir)) {
            fail('Could not safely locate the installed extension folder — download it manually instead.');
            return false;
        }

        var tmpRoot = path.join(os.tmpdir(), 'lineup-update-' + Date.now());
        var zipPath = path.join(tmpRoot, 'update.zip');
        var extractDir = path.join(tmpRoot, 'extracted');

        try { _mkdirp(tmpRoot); } catch (e) {
            fail('Could not create a temp folder for the update.');
            return false;
        }

        if (text) text.textContent = 'Downloading update…';
        setProgress(2);
        _downloadToFile(zipUrl, zipPath, setProgress, function (err) {
            if (err) { fail('Download failed — ' + err.message); return; }

            if (text) text.textContent = 'Installing update…';
            setProgress(75);
            try { _mkdirp(extractDir); } catch (e) {}
            _extractZip(zipPath, extractDir, function (err2) {
                if (err2) { fail('Could not extract the update — ' + err2.message); return; }
                setProgress(88);

                try {
                    var rootEntries = fs.readdirSync(extractDir);
                    var sourceRoot = (rootEntries.length === 1 && fs.statSync(path.join(extractDir, rootEntries[0])).isDirectory())
                        ? path.join(extractDir, rootEntries[0])
                        : extractDir;

                    for (var i = 0; i < INSTALL_FOLDERS.length; i++) {
                        var src = path.join(sourceRoot, INSTALL_FOLDERS[i]);
                        if (fs.existsSync(src)) _copyRecursive(src, path.join(extDir, INSTALL_FOLDERS[i]));
                    }
                    var indexSrc = path.join(sourceRoot, 'index.html');
                    if (fs.existsSync(indexSrc)) fs.writeFileSync(path.join(extDir, 'index.html'), fs.readFileSync(indexSrc));
                } catch (copyErr) {
                    fail('Install failed while copying files — ' + copyErr.message);
                    return;
                }

                try { _removeRecursive(tmpRoot); } catch (e) {}

                setProgress(100);
                if (text) text.textContent = 'Update installed — reloading…';
                setTimeout(function () { window.location.reload(true); }, 500);
            });
        });
        return true;
    }

    // Both CSInterface.openURLInDefaultBrowser and window.open swallow their
    // own failures (the former has an empty catch inside it; the latter just
    // returns null with no exception), so neither can reliably tell us
    // whether a browser actually opened — on a locked-down machine (registry
    // writes already need extra handling in install_win.cmd) both can fail
    // silently. Attempt them as a convenience, but always also show the link
    // in the banner itself so there's a fallback that isn't relying on either.
    function _openInBrowser(url, text) {
        if (!url) { showToast('No download link found — try Check for Updates again.'); return; }

        if (typeof window.__adobe_cep__ !== 'undefined' && typeof cs !== 'undefined') {
            try { cs.openURLInDefaultBrowser(url); } catch (e) {}
        }
        try { window.open(url, '_blank'); } catch (e) {}

        if (text) text.textContent = "If your browser didn't open: " + url;
    }

    // Installs in place and reloads the panel when Node.js integration is
    // available; otherwise falls back to just opening the release in a
    // browser so the user can install it by hand.
    window.downloadUpdate = function () {
        var banner  = document.getElementById('updateBanner');
        var text    = document.getElementById('updateBannerText');
        var pageUrl = banner ? banner.getAttribute('data-latest-url') : '';
        var zipUrl  = banner ? banner.getAttribute('data-latest-zip') : '';

        if (_nodeAvailable() && zipUrl) {
            _installUpdate(zipUrl, text);
            return;
        }

        _openInBrowser(pageUrl, text);
    };

    window.copyUpdateLink = function () {
        var banner = document.getElementById('updateBanner');
        var url = banner ? banner.getAttribute('data-latest-url') : '';
        if (!url) { showToast('No download link found — try Check for Updates again.'); return; }
        showToast(_copyText(url) ? 'Link copied — paste it into your browser.' : ('Copy failed — link: ' + url), 'info');
    };

    window.dismissUpdateBanner = function () {
        var banner = document.getElementById('updateBanner');
        var ver = banner ? banner.getAttribute('data-latest-version') : '';
        _hideBanner();
        if (ver) { try { localStorage.setItem(LS_DISMISSED, ver); } catch (e) {} }
    };

    document.addEventListener('DOMContentLoaded', function () { checkForUpdates(false); });

})();
