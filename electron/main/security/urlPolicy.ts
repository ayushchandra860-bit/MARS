import path from 'path';
import { fileURLToPath } from 'url';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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
