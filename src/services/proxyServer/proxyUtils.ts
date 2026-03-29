/**
 * Utility functions for detecting streams that need proxying.
 */

// Known debrid service domains
const DEBRID_DOMAINS = [
  'real-debrid.com',
  'rd-direct.link',
  'torbox.app',
  'alldebrid.com',
  'premiumize.me',
  'debrid-link.com',
  'offcloud.com',
  'put.io',
  'linksnappy.com',
  'megadebrid.eu',
  'simply-debrid.com',
  'rapidgator.net',
  'easydebrid.com',
];

// Headers that indicate authentication is required
const AUTH_HEADERS = [
  'authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'bearer',
];

/**
 * Check if a URL is from a known debrid service.
 */
export function isDebridUrl(url: string): boolean {
  try {
    const urlLower = url.toLowerCase();
    return DEBRID_DOMAINS.some(domain => urlLower.includes(domain));
  } catch {
    return false;
  }
}

/**
 * Check if headers contain authentication tokens.
 */
export function hasAuthHeaders(headers?: Record<string, string>): boolean {
  if (!headers) return false;

  const headerKeys = Object.keys(headers).map(k => k.toLowerCase());
  return AUTH_HEADERS.some(auth => headerKeys.includes(auth));
}

/**
 * Determine if a stream URL needs to be proxied for Chromecast.
 *
 * Returns true if:
 * - Stream has isDebrid=true flag
 * - URL contains known debrid domains
 * - Headers contain authentication tokens
 *
 * @param url - The stream URL
 * @param headers - Optional headers for the stream
 * @param isDebrid - Optional explicit debrid flag from stream data
 */
export function needsProxying(
  url: string,
  headers?: Record<string, string>,
  isDebrid?: boolean
): boolean {
  // Explicit debrid flag takes priority
  if (isDebrid === true) {
    return true;
  }

  // Check if URL is from a debrid service
  if (isDebridUrl(url)) {
    return true;
  }

  // Check if headers contain auth tokens
  if (hasAuthHeaders(headers)) {
    return true;
  }

  return false;
}

/**
 * Get a sanitized URL for logging (removes auth tokens from query string).
 */
export function sanitizeUrlForLogging(url: string): string {
  try {
    const urlObj = new URL(url);
    const sensitiveParams = ['token', 'key', 'apikey', 'api_key', 'auth', 'secret'];

    for (const param of sensitiveParams) {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '***');
      }
    }

    return urlObj.toString();
  } catch {
    // If URL parsing fails, just truncate
    return url.substring(0, 100) + (url.length > 100 ? '...' : '');
  }
}
