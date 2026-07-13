/* Lineup CEP — Update checker
   Compares the installed manifest version against the latest GitHub Release
   for this repo, and surfaces a dismissible banner (plus a manual "Check for
   Updates" button in Settings) when a newer one is available. */

(function () {

    var REPO = 'Notnoahbell/Lineup_AE';
    var CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // re-hit the GitHub API at most once a day
    var LS_LATEST    = 'lineup-update-latest';    // cached { version, url, checkedAt }
    var LS_DISMISSED = 'lineup-update-dismissed'; // version string the user closed the banner for

    var _localVersion = null;

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
        banner.classList.remove('update-banner-hidden');
    }

    function _hideBanner() {
        var banner = document.getElementById('updateBanner');
        if (banner) banner.classList.add('update-banner-hidden');
    }

    // Decides whether to show/hide the banner for a given "latest release"
    // result — called both from the cheap cached value (instant) and again
    // once a fresh network check comes back.
    function _evaluateBanner(latest) {
        if (!latest || !_localVersion) return;
        if (_compareVersions(latest.version, _localVersion) <= 0) { _hideBanner(); return; }
        var dismissed = null;
        try { dismissed = localStorage.getItem(LS_DISMISSED); } catch (e) {}
        if (dismissed === latest.version) return;
        _showBanner(latest);
    }

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

    function _fetchLatestRelease(cb) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.github.com/repos/' + REPO + '/releases/latest', true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status !== 200) { cb(null); return; }
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { cb(null); return; }
            var tag = (data.tag_name || '').replace(/^v/i, '');
            if (!tag) { cb(null); return; }
            // Prefer a packaged asset (.zxp/.zip) if the release has one; fall
            // back to the release page itself.
            var url = data.html_url;
            if (data.assets && data.assets.length) {
                for (var i = 0; i < data.assets.length; i++) {
                    if (/\.(zxp|zip)$/i.test(data.assets[i].name || '')) { url = data.assets[i].browser_download_url; break; }
                }
            }
            cb({ version: tag, url: url, checkedAt: Date.now() });
        };
        xhr.onerror = function () { cb(null); };
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

            var cached = _readCachedLatest();
            if (cached) _evaluateBanner(cached);

            var stale = !cached || (Date.now() - (cached.checkedAt || 0) > CHECK_INTERVAL_MS);
            if (!force && !stale) return;

            _fetchLatestRelease(function (latest) {
                if (!latest) {
                    if (force) showToast('Could not check for updates — no connection to GitHub.');
                    return;
                }
                _writeCachedLatest(latest);
                _evaluateBanner(latest);
                if (force && _compareVersions(latest.version, localVer) <= 0) {
                    showToast("You're on the latest version (v" + localVer + ")", 'info');
                }
            });
        });
    };

    window.downloadUpdate = function () {
        var banner = document.getElementById('updateBanner');
        var url = banner ? banner.getAttribute('data-latest-url') : '';
        if (url && typeof cs !== 'undefined') cs.openURLInDefaultBrowser(url);
    };

    window.dismissUpdateBanner = function () {
        var banner = document.getElementById('updateBanner');
        var ver = banner ? banner.getAttribute('data-latest-version') : '';
        _hideBanner();
        if (ver) { try { localStorage.setItem(LS_DISMISSED, ver); } catch (e) {} }
    };

    document.addEventListener('DOMContentLoaded', function () { checkForUpdates(false); });

})();
