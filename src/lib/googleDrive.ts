import { db, DATA_TABLES } from "./db";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const FOLDER_NAME = "Akhtar Autos Data";
const BACKUP_NAME = "akhtar-autos-backup.json";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
type DriveFile = { id: string; name: string; mimeType?: string; modifiedTime?: string };
let tokenClient: { requestAccessToken: (opts?: { prompt?: string }) => void } | null = null;
let accessToken = "";
let pendingResolve: ((token: string) => void) | null = null;
let pendingReject: ((error: Error) => void) | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector('script[data-google-identity]')) { resolve(); return; }
    const script = document.createElement("script");
    script.src = src; script.async = true; script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve(); script.onerror = () => reject(new Error("Google sign-in library load nahi hui."));
    document.head.appendChild(script);
  });
}
declare global {
  interface Window { google?: any }
}
export function driveConfigured() { return Boolean(CLIENT_ID); }
export async function connectGoogleDrive(): Promise<string> {
  if (!CLIENT_ID) throw new Error("Google Drive connect karne ke liye VITE_GOOGLE_CLIENT_ID configure karna zaroori hai.");
  await loadScript("https://accounts.google.com/gsi/client");
  const google = window.google;
  if (!google?.accounts?.oauth2) throw new Error("Google authorization library available nahi.");
  return new Promise((resolve, reject) => {
    pendingResolve = resolve; pendingReject = reject;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE, callback: (response: any) => {
        if (response.error || !response.access_token) { pendingReject?.(new Error(response.error_description || response.error || "Google sign-in failed.")); }
        else { accessToken = response.access_token; pendingResolve?.(accessToken); }
        pendingResolve = null; pendingReject = null;
      },
    });
    tokenClient!.requestAccessToken({ prompt: "consent" });
  });
}
export function disconnectGoogleDrive() { accessToken = ""; tokenClient = null; }
export function isGoogleDriveConnected() { return Boolean(accessToken); }
async function api(path: string, init: RequestInit = {}) {
  if (!accessToken) throw new Error("Pehle Google Drive connect karein.");
  const response = await fetch("https://www.googleapis.com/drive/v3/" + path, {
    ...init, headers: { Authorization: "Bearer " + accessToken, ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error("Google Drive error: " + response.status + " " + (await response.text()).slice(0, 250));
  return response;
}
async function findOrCreateFolder(): Promise<string> {
  const q = encodeURIComponent("name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const found = await (await api("files?q=" + q + "&fields=files(id,name)&pageSize=10")).json();
  if (found.files?.length) return (found.files as DriveFile[])[0].id;
  const created = await (await api("files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }) })).json();
  return created.id as string;
}
export async function uploadDriveBackup() {
  const folderId = await findOrCreateFolder();
  const data: Record<string, unknown> = { app: "Akhtar Autos", formatVersion: 1, savedAt: new Date().toISOString() };
  for (const name of DATA_TABLES) data[name] = await db.table(name).toArray();
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const q = encodeURIComponent("name='" + BACKUP_NAME + "' and '" + folderId + "' in parents and trashed=false");
  const found = await (await api("files?q=" + q + "&fields=files(id,name)&pageSize=10")).json();
  const existing = (found.files as DriveFile[] | undefined)?.[0];
  const metadata = { name: BACKUP_NAME, mimeType: "application/json", parents: existing ? undefined : [folderId] };
  const boundary = "akhtar_autos_boundary";
  const body = new Blob([
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + "\r\n",
    "--" + boundary + "\r\nContent-Type: application/json\r\n\r\n", blob, "\r\n--" + boundary + "--",
  ]);
  const url = existing ? "https://www.googleapis.com/upload/drive/v3/files/" + existing.id + "?uploadType=multipart" : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const response = await fetch(url, { method: existing ? "PATCH" : "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "multipart/related; boundary=" + boundary }, body });
  if (!response.ok) throw new Error("Backup upload failed: " + response.status + " " + (await response.text()).slice(0, 250));
  return new Date().toISOString();
}
export async function restoreDriveBackup() {
  const folderId = await findOrCreateFolder();
  const q = encodeURIComponent("name='" + BACKUP_NAME + "' and '" + folderId + "' in parents and trashed=false");
  const found = await (await api("files?q=" + q + "&fields=files(id,name,modifiedTime)&pageSize=10")).json();
  const file = (found.files as DriveFile[] | undefined)?.sort((a,b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""))[0];
  if (!file) throw new Error("Connected Google Drive mein Akhtar Autos backup nahi mila.");
  const payload = await (await api("files/" + file.id + "?alt=media")).json();
  if (payload.app !== "Akhtar Autos" || !payload.formatVersion) throw new Error("Drive backup format valid nahi.");
  await db.transaction("rw", DATA_TABLES.map((name) => db.table(name)), async () => {
    for (const name of DATA_TABLES) {
      const rows = payload[name];
      if (!Array.isArray(rows)) throw new Error("Backup mein " + name + " table missing hai.");
      await db.table(name).clear();
      if (rows.length) await db.table(name).bulkAdd(rows);
    }
  });
  return file.modifiedTime || new Date().toISOString();
}
