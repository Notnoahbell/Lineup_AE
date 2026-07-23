/* Lineup CEP — Leaderboard
   Syncs each user's total score/streak (from the Trophy tab's activity
   tracker — see main.js) to a shared Firebase project so everyone on the
   team can see how they stack up. Entirely optional and silently inert
   until FIREBASE_CONFIG/GOOGLE_OAUTH_CONFIG below are filled in with real
   values — see firestore.rules in the repo root for the security rules
   this expects to be deployed.

   The Firebase apiKey and Google OAuth client secret below are NOT
   confidential in the way a traditional backend's API credentials would
   be — there's no server of ours in between the client and Firestore for
   a secret to hide behind (that's the whole Firebase model: the client
   talks to it directly). Firebase's own docs say the apiKey is safe to
   expose publicly (it only routes requests to the right project), and
   Google's own OAuth docs for installed/Desktop apps say the same about
   that client secret (RFC 8252) — every client of this app needs these
   same values to function at all. The actual access control is
   firestore.rules, enforced on Google's servers regardless of what any
   client knows.

   No Firebase JS SDK — this is a vanilla CEP/CEF panel with no bundler, so
   this is plain XMLHttpRequest against Firebase's REST APIs (Identity
   Toolkit's signInWithIdp for federated Google sign-in, Firestore's REST
   endpoints for reads/writes), matching the same XHR-based style
   js/update.js already uses for the GitHub API.

   Identity: "Sign in with Google" — but a CEP panel has no addressable URL
   for Google's OAuth consent screen to redirect back to, so this can't use
   the normal in-page popup flow a website would. Instead (the same trick
   desktop apps like VS Code/gcloud CLI use): open the system's real
   browser to Google's consent screen via cs.openURLInDefaultBrowser, and
   spin up a temporary local HTTP server on 127.0.0.1 (Node's own `http`
   module — available here because of this extension's --enable-nodejs/
   --mixed-context CEF params, same as require('fs') elsewhere in this
   codebase) to catch the redirect once the user finishes in the browser.
   Google's own docs describe this exact loopback-redirect pattern for
   "Desktop app"-type OAuth clients, which is why the setup checklist below
   asks for that specific client type rather than reusing Firebase's
   auto-generated Web client.

   Since Google Workspace already verifies its own accounts, a successful
   Google sign-in is effectively always "emailVerified" already — there's
   no separate manual verification-link step like an email/password flow
   would need. Also gated to REQUIRE_DOMAIN below so only real company
   accounts can post a score; enforced both here (clean error message,
   plus the `hd` hint that narrows Google's own account picker) and in
   firestore.rules (the actual security boundary), since a CEP panel can't
   keep its API key or OAuth client secret truly confidential. */
(function () {

    // ── Fill these in from Firebase Console > Project Settings > General
    // (the "Web app" config block) after creating the project and enabling
    // Firestore. Everything below silently no-ops until this is a real
    // value. ────────────────────────────────────────────────────────────
    var FIREBASE_CONFIG = {
        apiKey: 'AIzaSyBJYEeqegMi-Ympu4SqDyjUWPPMcWJi-b4',
        projectId: 'lineup-leaderboard'
    };

    // ── From Firebase Console > Authentication > Sign-in method, enable
    // Google. Then, in the SAME project over in Google Cloud Console >
    // APIs & Services > Credentials, create an OAuth client ID of type
    // "Desktop app" (not "Web application" — Desktop-type clients are the
    // ones Google allows to use an arbitrary localhost port as their
    // redirect URI without pre-registering it). Paste that client's ID
    // and secret here — Google's own docs note a Desktop app's secret
    // isn't treated as confidential, so embedding it here is expected,
    // same as the Firebase apiKey above. ────────────────────────────────
    var GOOGLE_OAUTH_CONFIG = {
        clientId: '522059130874-4c4t0fq2mfq2vtd3785nq3cissglhncv.apps.googleusercontent.com',
        clientSecret: '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'
    };

    // Only accounts with this email domain can sign in — must match the
    // domain baked into firestore.rules (request.auth.token.email.matches).
    var REQUIRE_DOMAIN = 'thinkingbox.com';

    function _lbConfigured() {
        return FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' && FIREBASE_CONFIG.projectId !== 'YOUR_PROJECT_ID';
    }
    function _lbGoogleConfigured() {
        return GOOGLE_OAUTH_CONFIG.clientId.indexOf('YOUR_GOOGLE_CLIENT_ID') !== 0
            && GOOGLE_OAUTH_CONFIG.clientSecret !== 'YOUR_GOOGLE_CLIENT_SECRET';
    }

    function _lbEmailAllowed(email) {
        if (!REQUIRE_DOMAIN) return true;
        return new RegExp('@' + REQUIRE_DOMAIN.replace(/\./g, '\\.') + '$', 'i').test(email);
    }

    var LS_AUTH = 'lineup-lb-auth'; // { uid, email, emailVerified, idToken, refreshToken, expiresAt }
    var LS_NAME = 'lineup-lb-name'; // display name, chosen once (defaults to the account's name/email)
    // Per-day snapshot of the LOCAL history values this machine has already
    // told the cloud about — lets every sync send only the delta since last
    // time (via Firestore's atomic increment transform) instead of the full
    // local value, which is what makes repeated syncs safe to run forever
    // without double-counting. See _lbPushActivityDeltas/_lbMergeCloudHistory.
    var LS_PUSHED_SNAPSHOT = 'lineup-lb-pushed-snapshot';

    var LB_HISTORY_FIELDS = ['keyframes', 'layers', 'exports', 'score', 'seconds'];

    var LS_PERIOD = 'lineup-lb-period'; // which leaderboard tab was last selected — persists across opens
    var LB_PERIODS = ['daily', 'weekly', 'monthly', 'allTime'];
    var LB_PERIOD_LABELS = { daily: 'Today', weekly: 'This Week', monthly: 'This Month', allTime: 'All-Time' };

    function _lbGetPeriod() {
        var p = null;
        try { p = localStorage.getItem(LS_PERIOD); } catch (e) {}
        return LB_PERIODS.indexOf(p) >= 0 ? p : 'daily'; // daily by default, matching the rest of the Trophy tab now showing today's numbers first
    }
    function _lbSetPeriodPref(p) {
        try { localStorage.setItem(LS_PERIOD, p); } catch (e) {}
    }

    var PUSH_MIN_INTERVAL_MS = 2 * 60 * 1000; // don't write more than once per 2 minutes
    var TICK_MS = 30 * 1000;                  // cheap local (no-network) check every 30s

    var _lbAuth = null; // in-memory cache of LS_AUTH
    var _lbLastPushAt = 0;
    var _lbSigningIn = false; // true while waiting on the browser/loopback round-trip

    function _lbFriendlyError(err) {
        if (!err) return 'Something went wrong.';
        return err.message || String(err);
    }

    function _lbXhr(method, url, headers, body, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        for (var h in headers) { if (headers.hasOwnProperty(h)) xhr.setRequestHeader(h, headers[h]); }
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            var data = null;
            try { data = JSON.parse(xhr.responseText); } catch (e) {}
            if (xhr.status >= 200 && xhr.status < 300) {
                cb(null, data);
            } else {
                var msg = (data && data.error && data.error.message) || ('HTTP ' + xhr.status);
                cb(new Error(msg));
            }
        };
        xhr.onerror = function () { cb(new Error('network error')); };
        xhr.send(body ? JSON.stringify(body) : null);
    }

    function _lbSaveAuth(auth) {
        _lbAuth = auth;
        try { localStorage.setItem(LS_AUTH, JSON.stringify(auth)); } catch (e) {}
    }
    function _lbLoadAuth() {
        if (_lbAuth) return _lbAuth;
        try { _lbAuth = JSON.parse(localStorage.getItem(LS_AUTH) || 'null'); } catch (e) { _lbAuth = null; }
        return _lbAuth;
    }
    function _lbClearAuth() {
        _lbAuth = null;
        try { localStorage.removeItem(LS_AUTH); } catch (e) {}
    }

    // accounts:lookup is the Identity Toolkit call that returns
    // emailVerified — signInWithIdp's own response doesn't reliably
    // include it, so every sign-in follows up with this for the
    // authoritative status (in practice always true for Google, but worth
    // confirming rather than assuming).
    function _lbLookupVerified(idToken, cb) {
        var url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_CONFIG.apiKey;
        _lbXhr('POST', url, { 'Content-Type': 'application/json' }, { idToken: idToken }, function (err, data) {
            if (err || !data || !data.users || !data.users[0]) { cb(err || new Error('lookup failed')); return; }
            cb(null, !!data.users[0].emailVerified);
        });
    }

    function _lbStoreAuthFromResponse(data, cb) {
        var auth = {
            uid: data.localId,
            email: data.email,
            emailVerified: false,
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            expiresAt: Date.now() + (parseInt(data.expiresIn, 10) || 3600) * 1000
        };
        _lbSaveAuth(auth);
        _lbLookupVerified(auth.idToken, function (err, verified) {
            if (!err) { auth.emailVerified = verified; _lbSaveAuth(auth); }
            cb();
        });
    }

    // Firebase's token-refresh endpoint uses snake_case field names and a
    // form-encoded body, unlike every other call here — its own quirk, not
    // an inconsistency in this file. Provider-agnostic once you have a
    // Firebase refresh token, so this is unchanged from a password-based
    // setup.
    function _lbRefreshToken(auth, cb) {
        var url = 'https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_CONFIG.apiKey;
        var body = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(auth.refreshToken);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status < 200 || xhr.status >= 300) { cb(new Error('refresh failed: ' + xhr.status)); return; }
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { cb(new Error('bad refresh response')); return; }
            var refreshed = {
                uid: data.user_id,
                email: auth.email,
                emailVerified: auth.emailVerified,
                idToken: data.id_token,
                refreshToken: data.refresh_token,
                expiresAt: Date.now() + (parseInt(data.expires_in, 10) || 3600) * 1000
            };
            _lbSaveAuth(refreshed);
            cb(null, refreshed);
        };
        xhr.onerror = function () { cb(new Error('network error')); };
        xhr.send(body);
    }

    // Hands cb(err, auth) a guaranteed-valid (non-expired, non-imminently-
    // expiring) idToken for the CURRENTLY signed-in account. If there's no
    // account at all, or the refresh token itself has gone stale, the
    // caller just has to sign in again — no silent fallback identity.
    function _lbEnsureAuth(cb) {
        var auth = _lbLoadAuth();
        if (!auth) { cb(new Error('not signed in')); return; }
        if (auth.expiresAt - Date.now() > 5 * 60 * 1000) { cb(null, auth); return; }
        _lbRefreshToken(auth, cb);
    }

    // ── Google sign-in (system browser + local loopback redirect) ──────────

    // Matches _nodeAvailable in js/update.js exactly — just checks that
    // require exists at all, and leaves the actual require('http') for
    // when it's really needed (see below). Eagerly calling require('http')
    // here too was the actual bug: something about doing it this early
    // made it fail even though the identical call works fine a moment
    // later inside lbGoogleSignIn itself.
    function _lbNodeAvailable() {
        return typeof require === 'function';
    }

    var _lbActiveServer = null; // the loopback server currently waiting on a redirect, if any — lets Cancel actually stop it

    function _lbSetSigningIn(state) {
        _lbSigningIn = state;
        var googleBtn = document.getElementById('lbGoogleBtn');
        var cancelBtn = document.getElementById('lbCancelBtn');
        if (googleBtn) googleBtn.style.display = state ? 'none' : '';
        if (cancelBtn) cancelBtn.style.display = state ? '' : 'none';
    }

    window.lbGoogleSignIn = function () {
        if (_lbSigningIn) return;
        _lbClearAuthError();
        if (!_lbGoogleConfigured()) { _lbShowAuthError('Google sign-in isn\'t configured yet.'); return; }
        if (!_lbNodeAvailable()) { _lbShowAuthError('Node integration isn\'t available — cannot sign in with Google here.'); return; }

        var http = require('http');
        var urlLib = require('url');
        var port = null;

        var server = http.createServer(function (req, res) {
            var parsed = urlLib.parse(req.url, true);
            if (parsed.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="font-family:sans-serif;text-align:center;padding-top:60px;color:#333">' +
                '<h2>Signed in — you can close this tab and return to After Effects.</h2></body></html>');
            var query = parsed.query;
            server.close();
            _lbActiveServer = null;
            _lbSetSigningIn(false);
            if (query.error) { _lbShowAuthError('Google sign-in was cancelled.'); return; }
            _lbExchangeGoogleCode(query.code, 'http://127.0.0.1:' + port + '/callback');
        });
        server.on('error', function () {
            _lbActiveServer = null;
            _lbSetSigningIn(false);
            _lbShowAuthError('Could not start the local sign-in listener.');
        });

        _lbActiveServer = server;
        _lbSetSigningIn(true);
        server.listen(0, '127.0.0.1', function () {
            port = server.address().port;
            var redirectUri = 'http://127.0.0.1:' + port + '/callback';
            var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
                '?client_id=' + encodeURIComponent(GOOGLE_OAUTH_CONFIG.clientId) +
                '&redirect_uri=' + encodeURIComponent(redirectUri) +
                '&response_type=code' +
                '&scope=' + encodeURIComponent('openid email profile') +
                (REQUIRE_DOMAIN ? '&hd=' + encodeURIComponent(REQUIRE_DOMAIN) : '') +
                '&prompt=select_account';
            if (typeof cs !== 'undefined' && cs.openURLInDefaultBrowser) {
                cs.openURLInDefaultBrowser(authUrl);
            } else {
                window.open(authUrl, '_blank');
            }
            _lbShowAuthWaiting('Continue signing in in your browser…');
        });
    };

    // Covers the case the whole feature was missing a way out of: the
    // browser tab gets closed (or the wrong account picked, or the user
    // just changes their mind) before Google ever redirects back — without
    // this, the loopback server sits open forever and lbGoogleSignIn's own
    // "already signing in" guard means clicking it again does nothing,
    // with no way to retry short of closing the whole panel.
    window.lbCancelGoogleSignIn = function () {
        if (_lbActiveServer) { try { _lbActiveServer.close(); } catch (e) {} _lbActiveServer = null; }
        _lbSetSigningIn(false);
        _lbClearAuthError();
    };

    function _lbExchangeGoogleCode(code, redirectUri) {
        var body = 'code=' + encodeURIComponent(code) +
            '&client_id=' + encodeURIComponent(GOOGLE_OAUTH_CONFIG.clientId) +
            '&client_secret=' + encodeURIComponent(GOOGLE_OAUTH_CONFIG.clientSecret) +
            '&redirect_uri=' + encodeURIComponent(redirectUri) +
            '&grant_type=authorization_code';
        var xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://oauth2.googleapis.com/token', true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status < 200 || xhr.status >= 300) { _lbShowAuthError('Google sign-in failed.'); return; }
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { _lbShowAuthError('Bad response from Google.'); return; }
            _lbSignInToFirebaseWithGoogle(data.id_token);
        };
        xhr.onerror = function () { _lbShowAuthError('Network error talking to Google.'); };
        xhr.send(body);
    }

    // Only ever prompts for a display name once per ACCOUNT, not once per
    // machine — if this machine has no local name yet, check whether the
    // account already has one saved in the cloud (from a prior sign-in on
    // any other machine) before falling back to actually asking. Also
    // kicks off the push-then-pull activity sync either way.
    function _lbAfterSignIn(uid) {
        function proceed() {
            _lbRefreshView();
            _lbPushActivityDeltas(function () { _lbPullAndMergeActivity(function () { _lbRefreshView(); }); });
        }
        if (_lbGetName()) { proceed(); return; }
        _lbFetchExistingName(uid, function (existingName) {
            if (existingName) _lbSetName(existingName);
            proceed();
        });
    }

    function _lbSignInToFirebaseWithGoogle(googleIdToken) {
        var url = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=' + FIREBASE_CONFIG.apiKey;
        var body = {
            postBody: 'id_token=' + encodeURIComponent(googleIdToken) + '&providerId=google.com',
            requestUri: 'http://localhost',
            returnSecureToken: true
        };
        _lbXhr('POST', url, { 'Content-Type': 'application/json' }, body, function (err, data) {
            if (err || !data) { _lbShowAuthError(err || new Error('Firebase sign-in failed')); return; }
            if (!_lbEmailAllowed(data.email || '')) {
                _lbShowAuthError('Please sign in with your @' + REQUIRE_DOMAIN + ' account.');
                return;
            }
            _lbStoreAuthFromResponse(data, function () {
                _lbClearAuthError();
                _lbAfterSignIn(data.localId);
            });
        });
    }

    function _lbGetName() {
        try { return localStorage.getItem(LS_NAME) || ''; } catch (e) { return ''; }
    }
    function _lbSetName(name) {
        try { localStorage.setItem(LS_NAME, name); } catch (e) {}
    }

    // Reads the Trophy tab's own persisted totals directly out of
    // localStorage (see _activityData/_activitySave in main.js) rather
    // than reaching into any of its in-memory state — keeps this module
    // fully decoupled, same as every other single-purpose js/*.js file in
    // this app.
    function _lbReadLocalActivity() {
        var data = null;
        try { data = JSON.parse(localStorage.getItem('lineup-activity') || 'null'); } catch (e) {}
        return data;
    }

    // Daily/Weekly/Monthly aren't separately-tracked counters — they're
    // recomputed fresh from the same local day-by-day history every push,
    // just summed over a different date range. That's what makes the
    // "reset" automatic: the moment the wall clock crosses into a new
    // week/month, the range this sums over shifts with it, with no
    // scheduled job or explicit reset step needed anywhere.
    function _lbDateKey(d) {
        var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
        return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
    }
    function _lbWeekStartKey(today) {
        var dow = today.getDay(); // 0=Sun..6=Sat
        var sinceMonday = (dow === 0) ? 6 : dow - 1;
        return _lbDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday));
    }
    function _lbMonthStartKey(today) {
        return _lbDateKey(new Date(today.getFullYear(), today.getMonth(), 1));
    }
    function _lbSumScoreInRange(history, startKey, endKey) {
        var sum = 0;
        for (var day in history) {
            if (history.hasOwnProperty(day) && day >= startKey && day <= endKey) sum += (history[day].score || 0);
        }
        return sum;
    }
    function _lbComputePeriodScores(activity) {
        var history = activity.history || {};
        var today = new Date();
        var todayKey = _lbDateKey(today);
        return {
            daily: _lbSumScoreInRange(history, todayKey, todayKey),
            weekly: _lbSumScoreInRange(history, _lbWeekStartKey(today), todayKey),
            monthly: _lbSumScoreInRange(history, _lbMonthStartKey(today), todayKey),
            allTime: activity.score || 0
        };
    }
    function _lbPeriodsEqual(a, b) {
        return a.daily === b.daily && a.weekly === b.weekly && a.monthly === b.monthly && a.allTime === b.allTime;
    }

    var _lbLastPushedPeriods = null;

    function _lbPushScore(force) {
        if (!_lbConfigured()) return;
        var auth = _lbLoadAuth();
        if (!auth || !auth.emailVerified) return;
        var name = _lbGetName();
        if (!name) return;
        var activity = _lbReadLocalActivity();
        if (!activity) return;

        var periods = _lbComputePeriodScores(activity);
        if (!force && _lbLastPushedPeriods && _lbPeriodsEqual(periods, _lbLastPushedPeriods) && (Date.now() - _lbLastPushAt) < PUSH_MIN_INTERVAL_MS) return;

        _lbEnsureAuth(function (err, freshAuth) {
            if (err) return; // offline, Firebase unreachable, or signed out — skip this tick, try again next time
            var streak = activity.streak || {};
            var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_CONFIG.projectId +
                '/databases/(default)/documents/leaderboard/' + freshAuth.uid +
                '?updateMask.fieldPaths=name&updateMask.fieldPaths=score&updateMask.fieldPaths=scoreDaily' +
                '&updateMask.fieldPaths=scoreWeekly&updateMask.fieldPaths=scoreMonthly' +
                '&updateMask.fieldPaths=streakCurrent&updateMask.fieldPaths=streakBest&updateMask.fieldPaths=updatedAt';
            var body = {
                fields: {
                    name: { stringValue: name.slice(0, 40) },
                    score: { integerValue: String(periods.allTime) },
                    scoreDaily: { integerValue: String(periods.daily) },
                    scoreWeekly: { integerValue: String(periods.weekly) },
                    scoreMonthly: { integerValue: String(periods.monthly) },
                    streakCurrent: { integerValue: String(streak.current || 0) },
                    streakBest: { integerValue: String(streak.best || 0) },
                    updatedAt: { timestampValue: new Date().toISOString() }
                }
            };
            _lbXhr('PATCH', url, { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + freshAuth.idToken }, body, function (err2) {
                if (err2) return;
                _lbLastPushedPeriods = periods;
                _lbLastPushAt = Date.now();
            });
        });
    }

    // ── Cross-device sync of the FULL activity history ─────────────────────
    // The `leaderboard` collection above is deliberately lean (just enough
    // to render the ranked list) and public-read by everyone — the complete
    // per-day history lives in its own private `activityData/{uid}` doc
    // instead (owner-only read/write, see firestore.rules), so a public
    // leaderboard fetch never has to transfer anyone's full history just to
    // show a name and a score.
    //
    // Same-day activity from two machines is meant to SUM (per the user's
    // own call on this) — so pushing has to send only the delta since this
    // machine's own last successful push, via Firestore's atomic `increment`
    // transform, not the full local value each time. Sending the full value
    // every sync would double(triple, quadruple...)-count on every single
    // sync cycle, forever. LS_PUSHED_SNAPSHOT is what makes each push a
    // delta instead of a full resend.
    function _lbLoadPushedSnapshot() {
        try { return JSON.parse(localStorage.getItem(LS_PUSHED_SNAPSHOT) || '{}'); } catch (e) { return {}; }
    }
    function _lbSavePushedSnapshot(snap) {
        try { localStorage.setItem(LS_PUSHED_SNAPSHOT, JSON.stringify(snap)); } catch (e) {}
    }

    // Firestore field-path segments containing anything other than plain
    // identifier characters (a date like "2026-07-17" has hyphens) must be
    // backtick-quoted per Firestore's own field path escaping rules.
    function _lbHistoryFieldPath(day, field) {
        return 'history.`' + day + '`.' + field;
    }

    function _lbPushActivityDeltas(cb) {
        if (!_lbConfigured()) { if (cb) cb(); return; }
        var activity = _lbReadLocalActivity();
        if (!activity || !activity.history) { if (cb) cb(); return; }

        var pushed = _lbLoadPushedSnapshot();
        var fieldTransforms = [];
        var newPushed = {};

        for (var day in activity.history) {
            if (!activity.history.hasOwnProperty(day)) continue;
            var local = activity.history[day];
            var prev = pushed[day] || {};
            LB_HISTORY_FIELDS.forEach(function (f) {
                var delta = (local[f] || 0) - (prev[f] || 0);
                if (delta > 0) {
                    fieldTransforms.push({ fieldPath: _lbHistoryFieldPath(day, f), increment: { integerValue: String(delta) } });
                }
            });
            newPushed[day] = {
                keyframes: local.keyframes || 0,
                layers: local.layers || 0,
                exports: local.exports || 0,
                score: local.score || 0,
                seconds: local.seconds || 0
            };
        }

        if (!fieldTransforms.length) { if (cb) cb(); return; }

        _lbEnsureAuth(function (err, auth) {
            if (err) { if (cb) cb(err); return; } // offline/signed out — try again next tick, nothing lost since the snapshot only advances on success
            var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_CONFIG.projectId + '/databases/(default)/documents:commit';
            var body = {
                writes: [{
                    transform: {
                        document: 'projects/' + FIREBASE_CONFIG.projectId + '/databases/(default)/documents/activityData/' + auth.uid,
                        fieldTransforms: fieldTransforms
                    }
                }]
            };
            _lbXhr('POST', url, { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.idToken }, body, function (err2) {
                if (err2) { if (cb) cb(err2); return; }
                _lbSavePushedSnapshot(newPushed);
                if (cb) cb();
            });
        });
    }

    // Firestore's GET-a-document response nests everything as
    // {fields: {history: {mapValue: {fields: {DAY: {mapValue: {fields: {...}}}}}}}}
    // — this flattens that back into a plain {DAY: {keyframes, layers, ...}} object.
    function _lbParseFirestoreHistory(doc) {
        if (!doc || !doc.fields || !doc.fields.history || !doc.fields.history.mapValue) return {};
        var raw = doc.fields.history.mapValue.fields || {};
        var out = {};
        for (var day in raw) {
            if (!raw.hasOwnProperty(day)) continue;
            var dayFields = (raw[day].mapValue && raw[day].mapValue.fields) || {};
            var entry = {};
            LB_HISTORY_FIELDS.forEach(function (f) {
                entry[f] = (dayFields[f] && parseInt(dayFields[f].integerValue, 10)) || 0;
            });
            out[day] = entry;
        }
        return out;
    }

    function _lbParseDate(key) {
        var p = key.split('-');
        return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    }
    function _lbIsWeekend(d) { var dow = d.getDay(); return dow === 0 || dow === 6; }
    function _lbWorkdaysBetween(start, end) {
        var count = 0;
        var cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
        while (cur.getTime() < end.getTime()) {
            if (!_lbIsWeekend(cur)) count++;
            cur.setDate(cur.getDate() + 1);
        }
        return count;
    }

    // Streak isn't a per-day sum like totals/score are — it's a sequential
    // "consecutive workdays" computation, so merging it means replaying that
    // same rule (matching _activityCheckStreak's own gap logic in main.js)
    // across every day now known to have activity from ANY machine, in
    // chronological order, rather than trying to reconcile it as its own
    // separate delta stream.
    function _lbRecomputeStreak(history, existingStreak) {
        var days = Object.keys(history).sort();
        var best = (existingStreak && existingStreak.best) || 0;
        var current = 0;
        var prevDate = null;
        days.forEach(function (key) {
            var d = _lbParseDate(key);
            if (prevDate) {
                var gap = _lbWorkdaysBetween(prevDate, d);
                current = (gap === 0) ? current + 1 : 1;
            } else {
                current = 1;
            }
            if (current > best) best = current;
            prevDate = d;
        });
        return {
            current: current,
            best: best,
            lastActiveDate: days.length ? days[days.length - 1] : ((existingStreak && existingStreak.lastActiveDate) || null)
        };
    }

    function _lbTodayKey() { return _lbDateKey(new Date()); }

    // Merges a freshly-pulled cloud history into the local copy — two
    // different rules depending on whether a day is still "open":
    //
    // TODAY is additive: "cloud" already reflects everything every machine
    // has successfully pushed for it, EXCEPT this machine's own
    // not-yet-pushed delta (the gap between its local value and its own
    // last-pushed snapshot), which gets added back on top — genuine
    // same-day activity from two machines should sum, not have one mask
    // the other.
    //
    // Any OTHER (closed) day instead takes whichever side has the larger
    // number per field, not a sum — a past day shouldn't be changing
    // anymore, so there's no legitimate "new activity to add"; the only
    // reason local and cloud would ever disagree on a closed day is drift
    // in the local push-tracking snapshot, and summing in that case would
    // silently inflate a day's numbers every time it gets re-merged. Taking
    // the max is idempotent — safe to re-run indefinitely with no risk of
    // ever double-counting a day that's already finished.
    function _lbMergeCloudHistory(cloudHistory) {
        var activity = _lbReadLocalActivity() || { totals: { keyframes: 0, layers: 0, exports: 0 }, score: 0, streak: { current: 0, best: 0, lastActiveDate: null }, history: {} };
        var localHistory = activity.history || {};
        var pushed = _lbLoadPushedSnapshot();
        var todayKey = _lbTodayKey();
        var mergedHistory = {};

        var allDays = {};
        for (var d1 in cloudHistory) { if (cloudHistory.hasOwnProperty(d1)) allDays[d1] = true; }
        for (var d2 in localHistory) { if (localHistory.hasOwnProperty(d2)) allDays[d2] = true; }

        for (var day in allDays) {
            var cloud = cloudHistory[day] || {};
            var local = localHistory[day] || {};
            var entry = {};
            if (day === todayKey) {
                var prev = pushed[day] || {};
                LB_HISTORY_FIELDS.forEach(function (f) {
                    var notYetPushed = Math.max(0, (local[f] || 0) - (prev[f] || 0));
                    entry[f] = (cloud[f] || 0) + notYetPushed;
                });
            } else {
                LB_HISTORY_FIELDS.forEach(function (f) {
                    entry[f] = Math.max(cloud[f] || 0, local[f] || 0);
                });
            }
            mergedHistory[day] = entry;
        }

        activity.history = mergedHistory;

        var totals = { keyframes: 0, layers: 0, exports: 0 };
        var score = 0;
        for (var dk in mergedHistory) {
            totals.keyframes += mergedHistory[dk].keyframes;
            totals.layers += mergedHistory[dk].layers;
            totals.exports += mergedHistory[dk].exports;
            score += mergedHistory[dk].score;
        }
        activity.totals = totals;
        activity.score = score;
        activity.streak = _lbRecomputeStreak(mergedHistory, activity.streak);

        try { localStorage.setItem('lineup-activity', JSON.stringify(activity)); } catch (e) {}

        // main.js loaded its own in-memory copy once at startup and never
        // re-reads localStorage on its own — without this hook, the merge
        // above would sit in localStorage until main.js's NEXT periodic
        // save silently overwrote it with its stale pre-merge state.
        if (typeof window._activityReloadFromCloud === 'function') window._activityReloadFromCloud();
    }

    function _lbPullAndMergeActivity(cb) {
        if (!_lbConfigured()) { if (cb) cb(); return; }
        _lbEnsureAuth(function (err, auth) {
            if (err) { if (cb) cb(err); return; }
            var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_CONFIG.projectId + '/databases/(default)/documents/activityData/' + auth.uid;
            _lbXhr('GET', url, { 'Authorization': 'Bearer ' + auth.idToken }, null, function (err2, doc) {
                if (err2) { if (cb) cb(err2); return; } // includes "not found" on a brand-new account — nothing to merge yet
                _lbMergeCloudHistory(_lbParseFirestoreHistory(doc));
                if (cb) cb();
            });
        });
    }

    // The `leaderboard/{uid}` doc already carries whatever name was last
    // pushed for this account (from ANY machine) — public read, so this
    // needs no auth. Used right after sign-in to tell "this account has
    // never picked a name, anywhere" apart from "this is just a new
    // machine that hasn't seen the name yet," so the join prompt only ever
    // shows once per account, not once per machine.
    function _lbFetchExistingName(uid, cb) {
        var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_CONFIG.projectId + '/databases/(default)/documents/leaderboard/' + uid;
        _lbXhr('GET', url, {}, null, function (err, doc) {
            if (err || !doc || !doc.fields || !doc.fields.name) { cb(null); return; }
            cb(doc.fields.name.stringValue || null);
        });
    }

    var LB_PERIOD_FIELD = { daily: 'scoreDaily', weekly: 'scoreWeekly', monthly: 'scoreMonthly', allTime: 'score' };

    // Public read (see firestore.rules) — no auth header needed, so the
    // board is visible even before this install has signed in. 50 is
    // enough for the full popup while still a single cheap query — the
    // compact card just slices its own first 5 off the same result rather
    // than running a second, separately-limited query. Note: any account
    // that hasn't pushed since scoreDaily/Weekly/Monthly were added won't
    // show up under those tabs yet (Firestore excludes documents missing
    // the orderBy field entirely) — its very next push adds them.
    function _lbFetchLeaderboard(period, cb) {
        if (!_lbConfigured()) { cb(new Error('not configured')); return; }
        var field = LB_PERIOD_FIELD[period] || 'score';
        var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_CONFIG.projectId + '/databases/(default)/documents:runQuery';
        var body = {
            structuredQuery: {
                from: [{ collectionId: 'leaderboard' }],
                orderBy: [{ field: { fieldPath: field }, direction: 'DESCENDING' }],
                limit: 50
            }
        };
        _lbXhr('POST', url, { 'Content-Type': 'application/json' }, body, function (err, data) {
            if (err || !data) { cb(err || new Error('empty response')); return; }
            var rows = [];
            for (var i = 0; i < data.length; i++) {
                var doc = data[i] && data[i].document;
                if (!doc) continue;
                var f = doc.fields || {};
                rows.push({
                    uid: doc.name.split('/').pop(),
                    name: (f.name && f.name.stringValue) || 'Anonymous',
                    score: (f[field] && parseInt(f[field].integerValue, 10)) || 0
                });
            }
            cb(null, rows);
        });
    }

    function _lbEscape(s) {
        var div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    // Cursor-follow glow on hover for the top 3 rows — same recipe as the
    // Home tab's Anchor Point grid (_initAnchorGridGlow/_anchorGlowTick in
    // main.js: a radial-gradient masked to the element, position eased
    // toward the raw cursor position via requestAnimationFrame, only
    // running while actually hovered), just generalized to per-element
    // closures here since there can be up to three of these on screen at
    // once (compact list) instead of one single fixed target.
    function _lbInitRowGlow(el) {
        var rawX = -9999, rawY = -9999, curX = -9999, curY = -9999, raf = null;
        function move(e) { rawX = e.clientX; rawY = e.clientY; }
        function tick() {
            var dx = rawX - curX, dy = rawY - curY;
            curX += dx * 0.12;
            curY += dy * 0.12;
            var rect = el.getBoundingClientRect();
            el.style.setProperty('--glow-x', (curX - rect.left) + 'px');
            el.style.setProperty('--glow-y', (curY - rect.top) + 'px');
            raf = requestAnimationFrame(tick);
        }
        el.addEventListener('mouseenter', function (e) {
            rawX = curX = e.clientX;
            rawY = curY = e.clientY;
            document.addEventListener('mousemove', move);
            if (!raf) raf = requestAnimationFrame(tick);
        });
        el.addEventListener('mouseleave', function () {
            document.removeEventListener('mousemove', move);
            if (raf) { cancelAnimationFrame(raf); raf = null; }
        });
    }

    var LB_MEDAL_CLASS = { 1: 'lb-medal-gold', 2: 'lb-medal-silver', 3: 'lb-medal-bronze' };

    // Shared by the compact (top 5) and full-popup lists — one row-DOM
    // builder so rank/medal/glow/is-me logic only lives in one place.
    function _lbBuildRow(row, rank) {
        var myAuth = _lbLoadAuth();
        var isMe = myAuth && row.uid === myAuth.uid;
        var isPodium = rank <= 3;

        var el = document.createElement('div');
        el.className = 'lb-row' + (isMe ? ' is-me' : '') + (isPodium ? ' rank-' + rank : '');

        var rankHtml = isPodium
            ? '<span class="lb-rank lb-medal ' + LB_MEDAL_CLASS[rank] + '">' + rank + '</span>'
            : '<span class="lb-rank">' + rank + '</span>';

        el.innerHTML = rankHtml +
            '<span class="lb-name">' + _lbEscape(row.name) + '</span>' +
            '<span class="lb-score">' + row.score + '</span>';

        if (isPodium) _lbInitRowGlow(el);
        return el;
    }

    function _lbRenderRows(listEl, rows, limit) {
        if (!listEl) return;
        listEl.innerHTML = '';
        if (!rows.length) {
            listEl.innerHTML = '<div class="lb-empty">No scores yet — be the first.</div>';
            return;
        }
        var shown = limit ? rows.slice(0, limit) : rows;
        shown.forEach(function (row, i) { listEl.appendChild(_lbBuildRow(row, i + 1)); });
    }

    // The Trophy tab's own card — always just the top 5, so it fits
    // without scrolling; see lbOpenFull for the full, scrollable popup.
    function _lbRenderLeaderboard(rows) {
        _lbRenderRows(document.getElementById('lbList'), rows, 5);
    }
    function _lbRenderFullList(rows) {
        _lbRenderRows(document.getElementById('lbFullList'), rows, null);
    }

    // The same status line doubles as an error (red) or a neutral status
    // message ("continue in your browser…") depending on which shows it —
    // one slot, since only ever one applies at a time.
    function _lbShowAuthError(err) {
        var el = document.getElementById('lbAuthError');
        if (!el) return;
        el.classList.remove('lb-auth-status');
        el.textContent = (err instanceof Error) ? _lbFriendlyError(err) : String(err);
        el.style.display = '';
    }
    function _lbShowAuthWaiting(msg) {
        var el = document.getElementById('lbAuthError');
        if (!el) return;
        el.classList.add('lb-auth-status');
        el.textContent = msg;
        el.style.display = '';
    }
    function _lbClearAuthError() {
        var el = document.getElementById('lbAuthError');
        if (el) el.style.display = 'none';
    }

    // Four possible states, most to least "further along": not configured
    // → signed out → verified but no display name yet → fully set up (the
    // ranked list). Google sign-in is always email-verified by the time it
    // resolves, so unlike a password-based flow there's no separate
    // "check your inbox" state to show here.
    function _lbRefreshView() {
        var els = {
            notConfigured: document.getElementById('lbNotConfigured'),
            authForm: document.getElementById('lbAuthForm'),
            joinRow: document.getElementById('lbJoinRow'),
            listWrap: document.getElementById('lbListWrap'),
            signOutBtn: document.getElementById('lbSignOutBtn')
        };
        function hideAll() {
            for (var k in els) { if (els[k] && k !== 'signOutBtn') els[k].style.display = 'none'; }
        }
        // Mirrors the guard in window.lbOpenFull — disabled rather than
        // just silently no-op-ing on click, so it's visually clear there's
        // nothing to expand into until you're signed in.
        var expandBtn = document.getElementById('lbExpandBtn');
        function setExpandEnabled(enabled) { if (expandBtn) expandBtn.disabled = !enabled; }

        if (!_lbConfigured()) {
            hideAll();
            if (els.notConfigured) els.notConfigured.style.display = '';
            if (els.signOutBtn) els.signOutBtn.style.display = 'none';
            setExpandEnabled(false);
            return;
        }

        var auth = _lbLoadAuth();
        if (!auth) {
            hideAll();
            if (els.authForm) els.authForm.style.display = '';
            if (els.signOutBtn) els.signOutBtn.style.display = 'none';
            setExpandEnabled(false);
            return;
        }
        setExpandEnabled(true);

        if (els.signOutBtn) els.signOutBtn.style.display = '';

        if (!_lbGetName()) {
            hideAll();
            if (els.signOutBtn) els.signOutBtn.style.display = '';
            if (els.joinRow) {
                els.joinRow.style.display = '';
                var input = document.getElementById('lbNameInput');
                if (input && !input.value) input.value = (auth.displayName || (auth.email || '').split('@')[0]);
            }
            return;
        }

        hideAll();
        if (els.signOutBtn) els.signOutBtn.style.display = '';
        if (els.listWrap) els.listWrap.style.display = '';
        var periodLbl = document.getElementById('lbPeriodLabel');
        if (periodLbl) periodLbl.textContent = LB_PERIOD_LABELS[_lbGetPeriod()];
        _lbFetchLeaderboard(_lbGetPeriod(), function (err, rows) {
            if (!err) _lbRenderLeaderboard(rows);
        });
    }

    window.lbJoin = function () {
        var input = document.getElementById('lbNameInput');
        if (!input) return;
        var name = input.value.trim();
        if (!name) return;
        _lbSetName(name);
        _lbPushScore(true);
        _lbRefreshView();
    };

    window.lbSignOut = function () {
        _lbClearAuth();
        try { localStorage.removeItem(LS_NAME); } catch (e) {}
        _lbLastPushedPeriods = null;
        _lbRefreshView();
    };

    function _lbRenderPeriodTabs() {
        var active = _lbGetPeriod();
        var tabs = document.querySelectorAll('.lb-period-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-period') === active);
        }
    }

    window.lbSetPeriod = function (period) {
        if (LB_PERIODS.indexOf(period) < 0) return;
        _lbSetPeriodPref(period);
        _lbRenderPeriodTabs();
        _lbFetchLeaderboard(period, function (err, rows) { if (!err) _lbRenderFullList(rows); });
        // Keep the compact card's own (tab-less) view in sync with whatever
        // was just picked here, rather than it silently disagreeing with
        // the popup until the next unrelated refresh.
        var periodLbl = document.getElementById('lbPeriodLabel');
        if (periodLbl) periodLbl.textContent = LB_PERIOD_LABELS[period];
        _lbFetchLeaderboard(period, function (err, rows) { if (!err) _lbRenderLeaderboard(rows); });
    };

    window.lbOpenFull = function () {
        if (!_lbLoadAuth()) return; // signed out — nothing of yours to view/edit here
        var overlay = document.getElementById('lbFullOverlay');
        if (!overlay) return;
        overlay.classList.remove('lb-full-hidden');
        _lbRenderPeriodTabs();
        _lbFetchLeaderboard(_lbGetPeriod(), function (err, rows) { if (!err) _lbRenderFullList(rows); });
        // Reset the edit-name row closed each time the popup opens, rather
        // than leaving it wherever it was left from a previous visit.
        var editBtn = document.getElementById('lbEditNameBtn');
        var editRow = document.getElementById('lbEditNameRow');
        if (editBtn) editBtn.style.display = '';
        if (editRow) editRow.style.display = 'none';
    };
    window.lbCloseFull = function () {
        var overlay = document.getElementById('lbFullOverlay');
        if (overlay) overlay.classList.add('lb-full-hidden');
    };

    // The only way to change a display name after its one-time initial
    // prompt (see _lbAfterSignIn) — deliberately tucked away in the full
    // popup rather than re-prompted on every sign-in, per the whole point
    // of this feature.
    window.lbShowEditName = function () {
        if (!_lbLoadAuth()) return; // defensive — this is only reachable from inside the popup, which is itself gated on being signed in
        var btn = document.getElementById('lbEditNameBtn');
        var row = document.getElementById('lbEditNameRow');
        var input = document.getElementById('lbEditNameInput');
        if (btn) btn.style.display = 'none';
        if (row) row.style.display = '';
        if (input) input.value = _lbGetName();
    };
    window.lbSaveEditedName = function () {
        var input = document.getElementById('lbEditNameInput');
        if (!input) return;
        var name = input.value.trim();
        if (!name) return;
        _lbSetName(name);
        _lbPushScore(true); // forces an immediate push, carrying the new name up to the cloud doc too
        var btn = document.getElementById('lbEditNameBtn');
        var row = document.getElementById('lbEditNameRow');
        if (btn) btn.style.display = '';
        if (row) row.style.display = 'none';
        _lbFetchLeaderboard(_lbGetPeriod(), function (err, rows) { if (!err) _lbRenderFullList(rows); });
    };

    // Same localStorage key main.js's Settings > Enable Scoring toggle
    // writes — checked directly rather than through any main.js function,
    // same decoupled-module convention as _lbReadLocalActivity above. Only
    // gates the PUSH/PULL side (this machine's own sync work); viewing the
    // public board itself (_lbRefreshView's own interval) keeps running
    // either way — that's a read, not a source of lag, and turning your
    // own scoring off shouldn't stop you from watching the board.
    function _lbScoringEnabled() {
        var v;
        try { v = localStorage.getItem('lineup-scoring-enabled'); } catch (e) {}
        return v !== '0';
    }

    document.addEventListener('DOMContentLoaded', function () {
        _lbRefreshView();
        setInterval(function () {
            if (!_lbScoringEnabled()) return;
            _lbPushScore(false);
            _lbPushActivityDeltas(function () {}); // no-ops instantly if nothing changed since last push
        }, TICK_MS);
        // Slower cadence — this is about catching what OTHER machines
        // contributed since we last checked, not this machine's own state.
        setInterval(function () {
            if (!_lbScoringEnabled()) return;
            _lbPullAndMergeActivity(function () {});
        }, PUSH_MIN_INTERVAL_MS);
        setInterval(_lbRefreshView, PUSH_MIN_INTERVAL_MS);
    });

})();
