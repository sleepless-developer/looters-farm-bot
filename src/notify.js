import { spawn } from "node:child_process";

export function formatGangAcceptedNotification(row) {
  return {
    title: "Looters: gang request accepted",
    body: `Accepted request id=${row.id} · earned=${row.earned}`,
  };
}

function encodePowerShellCommand(command) {
  return Buffer.from(command, "utf16le").toString("base64");
}

function psSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

export function showDesktopNotification({ title, body }) {
  if (process.platform !== "win32") return false;

  const safeTitle = psSingleQuoted(title).slice(0, 120);
  const safeBody = psSingleQuoted(body).slice(0, 240);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle = '${safeTitle}'
$notify.BalloonTipText = '${safeBody}'
$notify.Visible = $true
$notify.ShowBalloonTip(5000)
Start-Sleep -Seconds 6
$notify.Dispose()
`;

  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-EncodedCommand",
    encodePowerShellCommand(script),
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return true;
}

export function notifyGangAccepted(row, options = {}) {
  if (!options.enabled) return false;
  return showDesktopNotification(formatGangAcceptedNotification(row));
}
