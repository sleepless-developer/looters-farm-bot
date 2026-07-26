import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

export function appDataDir() {
  const base = process.env.APPDATA;
  if (!base) throw new Error("APPDATA is not set; DPAPI vault is Windows-only.");
  return join(base, "looters-farm-bot");
}

export function sessionBlobPath() {
  return join(appDataDir(), "session-cookie.dpapi");
}

export function profilesDir() {
  return join(appDataDir(), "profiles");
}

export function profilesIndexPath() {
  return join(profilesDir(), "index.json");
}

export function profileCookiePath(id) {
  return join(profilesDir(), `${assertProfileId(id)}.cookie.dpapi`);
}

export function profileProxyPath(id) {
  return join(profilesDir(), `${assertProfileId(id)}.proxy.dpapi`);
}

export function normalizeCookieHeader(input) {
  const clean = String(input ?? "")
    .trim()
    .replace(/^cookie\s*:\s*/i, "")
    .trim();
  if (!clean) return "";

  const parts = clean.split(/\s+/).filter(Boolean);
  const looksLikeBrowserCookieRow =
    parts.length >= 3 &&
    !parts[0].includes("=") &&
    !parts[1].includes("=") &&
    (parts[2] === "lootersnft.xyz" || parts[2].endsWith(".lootersnft.xyz"));

  if (looksLikeBrowserCookieRow) {
    return `${parts[0]}=${parts[1]}`;
  }

  return clean;
}

export function looksLikeCookieHeader(input) {
  const clean = normalizeCookieHeader(input);
  if (!clean) return false;
  return clean
    .split(";")
    .map((part) => part.trim())
    .some((part) => /^[^=;\s]+=[^;]*$/.test(part));
}

export function normalizeProxyUrl(input) {
  const clean = String(input ?? "").trim();
  if (!clean) return "";
  const converted = convertHostPortUserPassProxy(clean);
  if (converted) return converted;
  const url = new URL(clean);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Proxy URL must start with http:// or https://");
  }
  if (!url.hostname || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Proxy URL must be host-only, for example: http://user:pass@host:port");
  }
  return url.toString();
}

function convertHostPortUserPassProxy(input) {
  const match = String(input).trim().match(/^(?:(https?):\/\/)?([^:@/\s]+):(\d{2,5}):([^:@/\s]+):(.+)$/i);
  if (!match) return "";
  const [, scheme = "http", host, port, user, rawPassword] = match;
  const password = rawPassword.replace(/:+$/, "");
  if (!password) return "";
  const protocol = `${scheme.toLowerCase()}:`;
  const url = new URL(`${protocol}//${host}:${port}/`);
  url.username = user;
  url.password = password;
  return url.toString();
}

export function looksLikeProxyUrl(input) {
  try {
    return Boolean(normalizeProxyUrl(input));
  } catch {
    return false;
  }
}

export function maskProxyUrl(input) {
  const clean = normalizeProxyUrl(input);
  if (!clean) return "";
  const url = new URL(clean);
  const auth = url.username ? `${decodeURIComponent(url.username)}:***@` : "";
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${auth}${url.hostname}${port}`;
}

function runPowerShell(script, input = "") {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "PowerShell DPAPI command failed").trim();
    throw new Error(message);
  }
  return result.stdout.trim();
}

export function protectString(plainText) {
  const script = `
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($inputText)
$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($protected)
`;
  return runPowerShell(script, plainText);
}

export function unprotectString(base64Blob) {
  const cleanBlob = String(base64Blob ?? "").replace(/^\uFEFF/, "").trim();
  const script = `
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd().Trim()
$inputText = $inputText.Trim([char]0xFEFF)
$protected = [Convert]::FromBase64String($inputText)
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Text.Encoding]::UTF8.GetString($bytes)
`;
  return runPowerShell(script, cleanBlob);
}

export async function saveSessionCookie(cookie) {
  const clean = normalizeCookieHeader(cookie);
  if (!looksLikeCookieHeader(clean)) {
    throw new Error("Cookie must look like a Cookie header, for example: key=value; other=value");
  }
  const active = await activeSessionProfile();
  if (active?.id) {
    await writeEncryptedCookie(profileCookiePath(active.id), clean);
    await touchProfile(active.id);
    return;
  }
  await writeEncryptedCookie(sessionBlobPath(), clean);
}

export async function saveMainSessionCookie(cookie) {
  const clean = normalizeCookieHeader(cookie);
  if (!looksLikeCookieHeader(clean)) {
    throw new Error("Cookie must look like a Cookie header, for example: key=value; other=value");
  }
  await writeEncryptedCookie(sessionBlobPath(), clean);
}

export async function promptAndSaveSessionCookie() {
  await mkdir(appDataDir(), { recursive: true });
  const encodedPath = Buffer.from(sessionBlobPath(), "utf8").toString("base64");
  const script = `
Add-Type -AssemblyName System.Security
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedPath}"))
$secure = Read-Host "Cookie" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $plain = ($plain -replace '^(?i)cookie\\s*:\\s*', '').Trim()
  $parts = @($plain -split '\\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if (
    $parts.Count -ge 3 -and
    -not $parts[0].Contains("=") -and
    -not $parts[1].Contains("=") -and
    ($parts[2] -eq "lootersnft.xyz" -or $parts[2].EndsWith(".lootersnft.xyz"))
  ) {
    $plain = "$($parts[0])=$($parts[1])"
  }
  $looksLikeCookie = $false
  foreach ($part in $plain.Split(";")) {
    if ($part.Trim() -match '^[^=;\\s]+=[^;]*$') {
      $looksLikeCookie = $true
      break
    }
  }
  if (-not $looksLikeCookie) {
    throw "Cookie must be copied from Request Headers as a full Cookie header, for example: PHPSESSID=...; other=value"
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes($plain)
  $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($path, [Convert]::ToBase64String($protected), $utf8NoBom)
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    stdio: "inherit",
    windowsHide: false,
  });
  if (result.status !== 0) {
    throw new Error("Failed to save cookie with DPAPI.");
  }
}

export async function loadSessionCookie() {
  const active = await activeSessionProfile();
  if (active?.id) {
    try {
      const blob = await readFile(profileCookiePath(active.id), "utf8");
      return unprotectString(blob);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Active Looters profile has no saved cookie. Update profile cookie or switch profile: ${active.name}`);
      }
      throw error;
    }
  }

  try {
    return await loadMainSessionCookie();
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`No saved Looters session cookie. Run: node src/cli.js vault set-cookie`);
    }
    throw error;
  }
}

export async function loadMainSessionCookie() {
  const blob = await readFile(sessionBlobPath(), "utf8");
  return unprotectString(blob);
}

export async function loadSessionProfileCookie(id) {
  const profileId = assertProfileId(id);
  const blob = await readFile(profileCookiePath(profileId), "utf8");
  return unprotectString(blob);
}

export async function clearSessionCookie() {
  const active = await activeSessionProfile();
  if (active?.id) {
    await rm(profileCookiePath(active.id), { force: true });
    await touchProfile(active.id);
    return;
  }
  await rm(sessionBlobPath(), { force: true });
}

export async function clearMainSessionCookie() {
  await rm(sessionBlobPath(), { force: true });
}

export async function hasSessionCookie() {
  const active = await activeSessionProfile();
  if (active?.id) {
    return fileExists(profileCookiePath(active.id));
  }
  return fileExists(sessionBlobPath());
}

export async function listSessionProfiles() {
  const index = await readProfilesIndex();
  const profiles = [];
  for (const profile of index.profiles) {
    profiles.push(await publicProfile(profile, index.activeProfileId));
  }
  return {
    activeProfileId: index.activeProfileId,
    profiles,
    legacy: {
      hasCookie: await fileExists(sessionBlobPath()),
      path: sessionBlobPath(),
      active: index.activeProfileId === null,
      proxy: { hasProxy: false, maskedProxy: null },
    },
    indexPath: profilesIndexPath(),
  };
}

export async function listSessionAccounts() {
  const state = await listSessionProfiles();
  return [
    {
      id: "main",
      kind: "main",
      name: "Main account",
      active: state.activeProfileId === null,
      hasCookie: Boolean(state.legacy?.hasCookie),
      proxy: { hasProxy: false, maskedProxy: null },
      note: "Direct connection / no proxy",
    },
    ...(state.profiles ?? []).map((profile) => ({
      id: profile.id,
      kind: "profile",
      name: profile.name,
      active: Boolean(profile.active),
      hasCookie: Boolean(profile.hasCookie),
      proxy: profile.proxy ?? { hasProxy: false, maskedProxy: null },
      note: profile.proxy?.hasProxy ? "Proxy profile" : "No proxy set",
    })),
  ];
}

export async function loadSessionAccountCredentials(accountId) {
  const id = String(accountId ?? "main").trim();
  if (id === "main") {
    return {
      account: {
        id: "main",
        kind: "main",
        name: "Main account",
        active: (await activeSessionAccountId()) === "main",
        hasCookie: await fileExists(sessionBlobPath()),
        proxy: { hasProxy: false, maskedProxy: null },
      },
      cookie: await loadMainSessionCookie(),
      proxyUrl: null,
    };
  }

  const profileId = assertProfileId(id);
  const state = await listSessionProfiles();
  const account = state.profiles.find((profile) => profile.id === profileId);
  if (!account) throw new Error(`Unknown profile: ${profileId}`);
  return {
    account: {
      ...account,
      kind: "profile",
      note: account.proxy?.hasProxy ? "Proxy profile" : "No proxy set",
    },
    cookie: await loadSessionProfileCookie(profileId),
    proxyUrl: await loadSessionProfileProxyUrl(profileId),
  };
}

export async function activeSessionProfile() {
  const index = await readProfilesIndex();
  return index.profiles.find((profile) => profile.id === index.activeProfileId) ?? null;
}

export async function activeSessionAccountId() {
  const index = await readProfilesIndex();
  return index.activeProfileId ?? "main";
}

export async function addSessionProfile({ name, cookie, proxy, setActive = true } = {}) {
  const clean = normalizeCookieHeader(cookie);
  if (!looksLikeCookieHeader(clean)) {
    throw new Error("Cookie must look like a Cookie header, for example: key=value; other=value");
  }
  const index = await readProfilesIndex();
  const now = new Date().toISOString();
  const profile = {
    id: makeProfileId(name),
    name: normalizeProfileName(name),
    createdAt: now,
    updatedAt: now,
  };
  index.profiles.push(profile);
  if (setActive || !index.activeProfileId) index.activeProfileId = profile.id;
  await writeEncryptedCookie(profileCookiePath(profile.id), clean);
  if (String(proxy ?? "").trim()) {
    await writeEncryptedSecret(profileProxyPath(profile.id), normalizeProxyUrl(proxy));
  }
  await writeProfilesIndex(index);
  return await publicProfile(profile, index.activeProfileId);
}

export async function updateSessionProfileCookie(id, cookie) {
  const profileId = assertProfileId(id);
  const clean = normalizeCookieHeader(cookie);
  if (!looksLikeCookieHeader(clean)) {
    throw new Error("Cookie must look like a Cookie header, for example: key=value; other=value");
  }
  const index = await readProfilesIndex();
  const profile = index.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  await writeEncryptedCookie(profileCookiePath(profileId), clean);
  profile.updatedAt = new Date().toISOString();
  await writeProfilesIndex(index);
  return await publicProfile(profile, index.activeProfileId);
}

export async function updateSessionProfileProxy(id, proxy) {
  const profileId = assertProfileId(id);
  const index = await readProfilesIndex();
  const profile = index.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  const clean = normalizeProxyUrl(proxy);
  if (!clean) {
    await rm(profileProxyPath(profileId), { force: true });
  } else {
    await writeEncryptedSecret(profileProxyPath(profileId), clean);
  }
  profile.updatedAt = new Date().toISOString();
  await writeProfilesIndex(index);
  return await publicProfile(profile, index.activeProfileId);
}

export async function setActiveSessionProfile(id) {
  const profileId = assertProfileId(id);
  const index = await readProfilesIndex();
  const profile = index.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  index.activeProfileId = profileId;
  await writeProfilesIndex(index);
  return await publicProfile(profile, index.activeProfileId);
}

export async function setActiveMainSessionProfile() {
  const index = await readProfilesIndex();
  index.activeProfileId = null;
  await writeProfilesIndex(index);
  return {
    id: "main",
    name: "Main account",
    active: true,
    hasCookie: await fileExists(sessionBlobPath()),
    proxy: { hasProxy: false, maskedProxy: null },
  };
}

export async function removeSessionProfile(id) {
  const profileId = assertProfileId(id);
  const index = await readProfilesIndex();
  const profile = index.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  index.profiles = index.profiles.filter((item) => item.id !== profileId);
  if (index.activeProfileId === profileId) {
    index.activeProfileId = index.profiles[0]?.id ?? null;
  }
  await rm(profileCookiePath(profileId), { force: true });
  await rm(profileProxyPath(profileId), { force: true });
  await writeProfilesIndex(index);
  return { id: profile.id, name: profile.name, removed: true, activeProfileId: index.activeProfileId };
}

async function writeEncryptedCookie(path, cleanCookie) {
  await writeEncryptedSecret(path, cleanCookie);
}

async function writeEncryptedSecret(path, plainText) {
  await mkdir(appDataDir(), { recursive: true });
  await mkdir(profilesDir(), { recursive: true });
  await writeFile(path, protectString(plainText), "utf8");
}

export async function loadActiveProfileProxyUrl() {
  const active = await activeSessionProfile();
  if (!active?.id) return null;
  try {
    const blob = await readFile(profileProxyPath(active.id), "utf8");
    return normalizeProxyUrl(unprotectString(blob));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadSessionProfileProxyUrl(id) {
  const profileId = assertProfileId(id);
  try {
    const blob = await readFile(profileProxyPath(profileId), "utf8");
    return normalizeProxyUrl(unprotectString(blob));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function touchProfile(id) {
  const index = await readProfilesIndex();
  const profile = index.profiles.find((item) => item.id === id);
  if (profile) {
    profile.updatedAt = new Date().toISOString();
    await writeProfilesIndex(index);
  }
}

async function readProfilesIndex() {
  try {
    const raw = await readFile(profilesIndexPath(), "utf8");
    return normalizeProfilesIndex(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") return { activeProfileId: null, profiles: [] };
    throw error;
  }
}

async function publicProfile(profile, activeProfileId) {
  let proxy = { hasProxy: false, maskedProxy: null };
  try {
    const blob = await readFile(profileProxyPath(profile.id), "utf8");
    proxy = { hasProxy: true, maskedProxy: maskProxyUrl(unprotectString(blob)) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    active: profile.id === activeProfileId,
    hasCookie: await fileExists(profileCookiePath(profile.id)),
    proxy,
  };
}

async function writeProfilesIndex(index) {
  await mkdir(profilesDir(), { recursive: true });
  const normalized = normalizeProfilesIndex(index);
  await writeFile(profilesIndexPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

function normalizeProfilesIndex(input = {}) {
  const seen = new Set();
  const profiles = [];
  for (const item of Array.isArray(input.profiles) ? input.profiles : []) {
    const id = safeProfileId(item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    profiles.push({
      id,
      name: normalizeProfileName(item?.name || id),
      createdAt: validIso(item?.createdAt) ? item.createdAt : new Date().toISOString(),
      updatedAt: validIso(item?.updatedAt) ? item.updatedAt : validIso(item?.createdAt) ? item.createdAt : new Date().toISOString(),
    });
  }
  const activeProfileId = safeProfileId(input.activeProfileId);
  return {
    activeProfileId: profiles.some((profile) => profile.id === activeProfileId) ? activeProfileId : null,
    profiles,
  };
}

function makeProfileId(name) {
  const base = normalizeProfileName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "profile";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

function normalizeProfileName(name) {
  const clean = String(name ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (!clean) return "Looters profile";
  return clean.slice(0, 48);
}

function assertProfileId(id) {
  const clean = safeProfileId(id);
  if (!clean) throw new Error("Invalid profile id.");
  return clean;
}

function safeProfileId(id) {
  const clean = String(id ?? "").trim();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(clean) ? clean : "";
}

function validIso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

async function fileExists(path) {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
