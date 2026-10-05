import { describe, expect, it } from 'vitest';

import {
  OVERRIDE_PATHS,
  buildCertificateInstaller,
  detectPlatform,
  installerFilename,
} from './certificateInstaller';

const CERT = '-----BEGIN CERTIFICATE-----\nMIIBmock\n-----END CERTIFICATE-----';

/**
 * A script with the wrong path writes a certificate nowhere, and the branch is
 * still prompted with everything on screen saying it worked. None of that is
 * visible from a screen, which is why it is asserted here.
 */
describe('detectPlatform', () => {
  it('reads the counter machine, which is almost always Windows', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macos');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
  });

  it('falls to the shell script, not to Windows, when it cannot tell', () => {
    // A .sh on Windows is an inert file somebody asks about; a .ps1 on a Mac is
    // a failure at the moment it mattered.
    expect(detectPlatform('something else entirely')).toBe('linux');
  });
});

describe('buildCertificateInstaller', () => {
  it('carries the certificate inside the script, so there is nothing to pair up', () => {
    for (const platform of ['windows', 'macos', 'linux'] as const) {
      const script = buildCertificateInstaller(CERT, platform);

      expect(script).toContain('BEGIN CERTIFICATE');
      expect(script).toContain('MIIBmock');
    }
  });

  it('writes to the path QZ Tray actually reads, per platform', () => {
    expect(buildCertificateInstaller(CERT, 'windows')).toContain('override.crt');
    // Inside the app bundle on a Mac, not beside it.
    expect(buildCertificateInstaller(CERT, 'macos')).toContain(
      '/Applications/QZ Tray.app/Contents/Resources/override.crt',
    );
    expect(buildCertificateInstaller(CERT, 'linux')).toContain('/opt/qz-tray/override.crt');
    expect(OVERRIDE_PATHS.windows).toBe('C:\\Program Files\\QZ Tray\\override.crt');
  });

  it('restarts QZ Tray, because it reads the certificate at startup', () => {
    // A copy without a restart changes nothing until the machine is next
    // rebooted — and the branch is told it worked.
    expect(buildCertificateInstaller(CERT, 'windows')).toContain('Stop-Process');
    expect(buildCertificateInstaller(CERT, 'macos')).toContain('pkill');
    expect(buildCertificateInstaller(CERT, 'linux')).toContain('pkill');
  });

  it('looks in both Program Files locations rather than assuming the 64-bit one', () => {
    const script = buildCertificateInstaller(CERT, 'windows');

    expect(script).toContain('$env:ProgramFiles');
    expect(script).toContain('ProgramFiles(x86)');
  });

  it('filters the roots before joining, so an unset ProgramFiles(x86) is not fatal', () => {
    // Under ErrorActionPreference=Stop, Join-Path on a null path throws — and
    // the script dies before it can say what was wrong.
    const script = buildCertificateInstaller(CERT, 'windows');
    const rootsLine = script.indexOf('$roots = @(');
    const joinLine = script.indexOf('ForEach-Object { Join-Path');

    expect(rootsLine).toBeGreaterThan(-1);
    expect(joinLine).toBeGreaterThan(rootsLine);
    expect(script).toContain('Where-Object { $_ }');
  });

  it('refuses clearly when QZ Tray is not installed', () => {
    // Rather than creating a directory that looks right and does nothing.
    for (const platform of ['windows', 'macos', 'linux'] as const) {
      expect(buildCertificateInstaller(CERT, platform)).toContain('QZ Tray is not installed');
    }
  });

  it('names the file so the counter knows what to do with it', () => {
    expect(installerFilename('windows')).toBe('install-printer-certificate.ps1');
    expect(installerFilename('macos')).toBe('install-printer-certificate.sh');
  });

  it('embeds the certificate literally, with no interpolation to go wrong', () => {
    // A PEM is ASCII with no quoting hazards, and both scripts use a literal
    // block — PowerShell's @'…'@ and a quoted heredoc — so nothing in a
    // certificate can be read as a command.
    expect(buildCertificateInstaller(CERT, 'windows')).toContain("@'");
    expect(buildCertificateInstaller(CERT, 'linux')).toContain("<<'CERTIFICATE'");
  });
});
