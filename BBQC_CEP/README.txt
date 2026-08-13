BBQC CEP v0.5
==============

UI/UX polish pass for the BBQC CEP prototype, plus Frame.io comment sync.

Included features
-----------------
- Paste a Frame.io share link and sync its comments into the active comp as notes + markers, in timestamp order (one-way; Frame.io -> AE only)
- Frame.io Settings modal: sign in via Adobe IMS OAuth (Client ID/Secret from an Adobe Developer Console "Web App" credential), stored locally
- Frame.io-sourced notes are tagged with a badge and are safe to re-sync (no duplicates)
- Compact custom View dropdown
- Project / active-comp filtering; active comp name appears in the dropdown
- Remembers Project vs Comp view between panel sessions
- Project-specific checklist storage using After Effects app.settings
- Project-wide notes
- Notes linked to the current comp playhead
- Clean Note 1 / Note 2 / Note 3 composition markers
- Click linked title/timecode area to jump back to the comp + marker
- Orange navigation hover on linked notes
- Check complete / incomplete with dimmed completed state
- Expand / collapse note details
- Edit note title + comment
- Delete note + linked marker
- Drag notes to reorder with orange insertion-line feedback
- Completion count for current view
- QC Summary preview + clipboard copy
- Reset current view
- Library-style cursor-follow orange glow on bottom action buttons
- 5% hover scale on bottom action buttons
- Compact one-row footer: Add Note / QC Summary / Reset
- Tooltips on note controls
- Auto-refresh when active comp/project changes

Install (manual CEP development install)
----------------------------------------
1. Copy the BBQC_CEP folder into your CEP extensions folder.

Windows:
%APPDATA%\Adobe\CEP\extensions\BBQC_CEP

macOS:
~/Library/Application Support/Adobe/CEP/extensions/BBQC_CEP

2. Unsigned CEP extensions may require PlayerDebugMode enabled for your installed CSXS version.
3. Restart After Effects.
4. Open Window > Extensions (Legacy) > BBQC.

Notes
-----
- Save your .aep before relying on project-specific separation. Unsaved projects share the UNTITLED_PROJECT storage key.
- Icons are inline SVGs and can be replaced with custom SVG assets later.
- This build intentionally does not include the old Add to Render Queue button yet.
- Frame.io sign-in requires an Adobe Developer Console project with a Frame.io API "Web App" OAuth credential. Register https://localhost:8734/callback as its redirect URI, then paste the Client ID/Secret into BBQC's Frame.io Settings and click "Connect to Frame.io" — this opens your default browser to sign in.
- No Node.js integration is required. Since nothing can actually listen on that localhost redirect URI without a server, your browser will land on a "can't reach this page" error after signing in — that's expected. Copy the full URL from the address bar and paste it into the "Finish Connecting" field in Frame.io Settings to complete sign-in.
- Frame.io API calls and the OAuth token exchange happen via the panel's own browser fetch(), not Node — no manifest changes or extra restarts needed for this feature.
