/**
 * The one-file installer that makes a self-signed certificate a single press
 * at a branch.
 *
 * A self-signed certificate is free, and its whole cost is that each counter
 * machine has to trust it once: QZ Tray reads `override.crt` from its own
 * installation directory. A browser cannot write there, so *something* has to
 * run with administrator rights on that machine — and the difference between a
 * branch coping with this and a branch ringing for help is whether that
 * something is **one file they already have** or a certificate emailed
 * separately, a path to type and an order to do them in.
 *
 * So the certificate is **embedded in the script**. The POS fetches it from the
 * platform and builds the installer in the browser: the branch downloads one
 * file, runs it as administrator, and the script writes the certificate,
 * restarts QZ Tray and says what happened. Nothing to pair up, no path to type,
 * nothing that can be done in the wrong order.
 *
 * Pure, and tested, because none of it is visible from a screen: a script with
 * the wrong path writes a certificate nowhere and the branch is still prompted,
 * with everything on screen saying it worked.
 */

export type CounterPlatform = 'windows' | 'macos' | 'linux';

/**
 * Which installer this machine needs, from the browser's own reading of itself.
 *
 * Windows is the overwhelmingly common counter machine, and it is also the one
 * where the answer is unambiguous — so an unrecognised platform falls to the
 * shell script rather than to Windows: a `.sh` on Windows is an inert text
 * file somebody asks about, where a `.ps1` on a Mac would be a confusing
 * failure at the moment it mattered.
 */
export function detectPlatform(userAgent: string): CounterPlatform {
  if (/windows|win32|win64/i.test(userAgent)) {
    return 'windows';
  }
  if (/mac os|macintosh/i.test(userAgent)) {
    return 'macos';
  }
  return 'linux';
}

/** Where QZ Tray reads a trusted certificate from, per platform. */
export const OVERRIDE_PATHS: Record<CounterPlatform, string> = {
  // Since QZ Tray 2.1.
  windows: 'C:\\Program Files\\QZ Tray\\override.crt',
  // Inside the app bundle, not beside it.
  macos: '/Applications/QZ Tray.app/Contents/Resources/override.crt',
  linux: '/opt/qz-tray/override.crt',
};

export function installerFilename(platform: CounterPlatform): string {
  return platform === 'windows' ? 'install-printer-certificate.ps1' : 'install-printer-certificate.sh';
}

/**
 * PowerShell, for the counter machine that is almost always Windows.
 *
 * Three things it does beyond copying a file, each of which is a support call
 * it prevents: it looks in both Program Files locations rather than assuming
 * the 64-bit one, it **restarts QZ Tray** (which reads the certificate at
 * startup, so a copy without a restart changes nothing until somebody reboots),
 * and it refuses clearly when QZ Tray is not installed rather than creating a
 * directory that looks right and does nothing.
 */
function windowsInstaller(certificatePem: string): string {
  return `# Trusts this restaurant's printing certificate on this computer, once.
#
# Right-click this file and choose "Run with PowerShell" as an administrator.
# It writes the certificate QZ Tray checks, restarts QZ Tray, and stops asking
# you to allow printing.

$ErrorActionPreference = "Stop"

$certificate = @'
${certificatePem.trim()}
'@

# The roots are filtered *before* Join-Path: on a machine where
# ProgramFiles(x86) is not set, joining a null path throws under
# ErrorActionPreference=Stop, and the script dies before it can say why.
$roots = @($env:ProgramFiles, \${env:ProgramFiles(x86)}) | Where-Object { $_ }
$installDir = $roots |
  ForEach-Object { Join-Path $_ "QZ Tray" } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1

if (-not $installDir) {
  Write-Host "QZ Tray is not installed on this computer." -ForegroundColor Red
  Write-Host "Install QZ Tray first, then run this file again."
  Read-Host "Press Enter to close"
  exit 1
}

$target = Join-Path $installDir "override.crt"

try {
  Set-Content -Path $target -Value $certificate -Encoding Ascii -Force
} catch {
  Write-Host "Could not write to $target." -ForegroundColor Red
  Write-Host "Right-click this file and choose Run as administrator, then try again."
  Read-Host "Press Enter to close"
  exit 1
}

# QZ Tray reads the certificate when it starts, so a copy without a restart
# changes nothing until the machine is next rebooted.
Get-Process -Name "qz-tray" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$exe = Join-Path $installDir "qz-tray.exe"
if (Test-Path $exe) {
  Start-Process $exe
}

Write-Host "Done. This computer now trusts the printing certificate." -ForegroundColor Green
Write-Host "Print a test receipt from the POS to check."
Read-Host "Press Enter to close"
`;
}

/** The same, for a Mac or Linux counter. Run with sudo. */
function unixInstaller(certificatePem: string, platform: CounterPlatform): string {
  const target = OVERRIDE_PATHS[platform];
  const restart =
    platform === 'macos'
      ? `pkill -f "QZ Tray" 2>/dev/null || true
sleep 2
open -a "QZ Tray" 2>/dev/null || true`
      : `pkill -f qz-tray 2>/dev/null || true
sleep 2
(/opt/qz-tray/qz-tray >/dev/null 2>&1 &) || true`;

  return `#!/bin/sh
# Trusts this restaurant's printing certificate on this computer, once.
#
# Run it with:   sudo sh install-printer-certificate.sh
# It writes the certificate QZ Tray checks, restarts QZ Tray, and stops asking
# you to allow printing.

set -e

TARGET="${target}"
DIR=$(dirname "$TARGET")

if [ ! -d "$DIR" ]; then
  echo "QZ Tray is not installed on this computer."
  echo "Install QZ Tray first, then run this file again."
  exit 1
fi

cat > "$TARGET" <<'CERTIFICATE'
${certificatePem.trim()}
CERTIFICATE

# QZ Tray reads the certificate when it starts.
${restart}

echo "Done. This computer now trusts the printing certificate."
echo "Print a test receipt from the POS to check."
`;
}

/** The installer this machine needs, with the certificate already inside it. */
export function buildCertificateInstaller(
  certificatePem: string,
  platform: CounterPlatform,
): string {
  return platform === 'windows'
    ? windowsInstaller(certificatePem)
    : unixInstaller(certificatePem, platform);
}
