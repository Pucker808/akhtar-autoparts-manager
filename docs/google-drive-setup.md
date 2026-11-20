# Google Drive backup setup

The app keeps its working database in the browser (IndexedDB). Google Drive provides a portable backup and restore point in the owner's own Drive.

## Configure Google OAuth once

1. Open Google Cloud Console and create/select a project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen for the intended owner account.
4. Create an OAuth Client ID with application type **Web application**.
5. Add the exact local development origin (for example `http://localhost:8080`) to Authorized JavaScript origins. Add the production site origin too after deployment.
6. Put the client ID in a local `.env` file as `VITE_GOOGLE_CLIENT_ID=...` (see `.env.example`).
7. Restart the dev server.

The app requests the limited `drive.file` scope. It creates an **Akhtar Autos Data** folder and keeps one `akhtar-autos-backup.json` snapshot there.

## Use

- Connect Google Drive from Settings.
- Turn on Automatic upload to upload a fresh snapshot after each successful app transaction.
- Use Upload / Sync Now for a manual snapshot.
- On a new device, connect the same owner's Google account and choose Import / Restore from Drive.

## Important behavior

- The browser database remains the working copy; Drive stores a snapshot backup. It is not a live shared database or simultaneous multi-device merge.
- Automatic upload requires an internet connection and an active Google authorization session. Reconnect after a browser restart or when Google expires the token.
- Restore replaces the current device's app tables. Download a local backup first if its data may be needed.
- Do not use the app for live shop accounting until the project has been built and tested with real workflows and a recovery copy.
