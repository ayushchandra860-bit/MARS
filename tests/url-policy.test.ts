import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  isTrustedDevServerUrl,
  isTrustedRendererNavigation,
} from '../electron/main/security/urlPolicy';

describe('privileged renderer URL policy', () => {
  const rendererEntry = path.resolve('/opt/mars/dist/index.html');
  const rendererUrl = pathToFileURL(rendererEntry).toString();

  it('accepts only the exact packaged renderer file, including hash routes', () => {
    expect(isTrustedRendererNavigation(`${rendererUrl}#/analytics`, rendererEntry)).toBe(true);
    expect(
      isTrustedRendererNavigation(
        pathToFileURL(path.resolve('/opt/mars/dist/other.html')).toString(),
        rendererEntry,
      ),
    ).toBe(false);
  });

  it('accepts routes on the exact configured loopback development origin', () => {
    const devServer = 'http://localhost:5173';
    expect(isTrustedDevServerUrl(devServer)).toBe(true);
    expect(
      isTrustedRendererNavigation('http://localhost:5173/settings?tab=signals', rendererEntry, devServer),
    ).toBe(true);
  });

  it('rejects localhost look-alike hosts, different ports, and credentials', () => {
    const devServer = 'http://localhost:5173';
    expect(
      isTrustedRendererNavigation('http://localhost.evil.example:5173/', rendererEntry, devServer),
    ).toBe(false);
    expect(
      isTrustedRendererNavigation('http://localhost:4173/', rendererEntry, devServer),
    ).toBe(false);
    expect(isTrustedDevServerUrl('http://user:pass@localhost:5173')).toBe(false);
  });

  it('rejects malformed and non-loopback development URLs', () => {
    expect(isTrustedDevServerUrl('not a url')).toBe(false);
    expect(isTrustedDevServerUrl('https://example.com')).toBe(false);
    expect(isTrustedRendererNavigation('javascript:alert(1)', rendererEntry)).toBe(false);
  });
});
