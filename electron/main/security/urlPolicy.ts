import path from 'path';
import { fileURLToPath } from 'url';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const OLYMP_TRADE_HOSTS = new Set(['olymptrade.com', 'www.olymptrade.com']);
export const OLYMP_TRADE_PLATFORM_URL = 'https://olymptrade.com/platform';

/**
 * Development renderer URLs must stay on an explicit loopback origin.
 * String-prefix checks are intentionally forbidden because hosts such as
 * `localhost.evil.example` begin with the same characters as localhost.
 */
export function isTrustedDevServerUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * The embedded workstation may navigate only to explicitly approved Olymp
 * Trade HTTPS hosts. Look-alike domains, credentials, non-default ports and
 * unsafe protocols are rejected.
 */
export function isTrustedOlympTradeUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return false;
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      OLYMP_TRADE_HOSTS.has(url.hostname.toLowerCase()) &&
      (url.port === '' || url.port === '443') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

export function normalizeOlympTradeUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || !isTrustedOlympTradeUrl(rawUrl)) {
    return OLYMP_TRADE_PLATFORM_URL;
  }
  return new URL(rawUrl).toString();
}

function normalizeFilePath(filePath: string): string {
  const normalized = path.resolve(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Allow only the packaged renderer entry file or the exact configured
 * loopback development origin. Hash routes and query strings are permitted;
 * sibling files, look-alike hosts, different ports, and other protocols are not.
 */
export function isTrustedRendererNavigation(
  rawUrl: string,
  trustedFilePath: string,
  devServerUrl?: string,
): boolean {
  try {
    const target = new URL(rawUrl);

    if (target.protocol === 'file:') {
      return normalizeFilePath(fileURLToPath(target)) === normalizeFilePath(trustedFilePath);
    }

    if (!devServerUrl || !isTrustedDevServerUrl(devServerUrl)) {
      return false;
    }

    const devOrigin = new URL(devServerUrl);
    return (
      target.origin === devOrigin.origin &&
      target.username === '' &&
      target.password === ''
    );
  } catch {
    return false;
  }
}
