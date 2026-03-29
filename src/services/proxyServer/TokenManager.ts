import { logger } from '../../utils/logger';

interface TokenEntry {
  url: string;
  headers: Record<string, string>;
  createdAt: number;
  expiresAt: number;
}

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Token-based URL mapping for secure proxy URLs.
 * Keeps sensitive headers out of proxy URLs and manages token lifecycle.
 */
class TokenManager {
  private tokens: Map<string, TokenEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  /**
   * Generate a random token for a URL and headers.
   */
  generateToken(url: string, headers: Record<string, string>): string {
    const token = this.createRandomToken();
    const now = Date.now();

    this.tokens.set(token, {
      url,
      headers,
      createdAt: now,
      expiresAt: now + TOKEN_EXPIRY_MS,
    });

    logger.debug(`[TokenManager] Generated token for URL: ${url.substring(0, 50)}...`);
    return token;
  }

  /**
   * Retrieve URL and headers for a token.
   */
  getEntry(token: string): { url: string; headers: Record<string, string> } | null {
    const entry = this.tokens.get(token);

    if (!entry) {
      logger.warn(`[TokenManager] Token not found: ${token.substring(0, 10)}...`);
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      logger.warn(`[TokenManager] Token expired: ${token.substring(0, 10)}...`);
      this.tokens.delete(token);
      return null;
    }

    return {
      url: entry.url,
      headers: entry.headers,
    };
  }

  /**
   * Revoke a specific token.
   */
  revokeToken(token: string): boolean {
    const existed = this.tokens.has(token);
    this.tokens.delete(token);

    if (existed) {
      logger.debug(`[TokenManager] Token revoked: ${token.substring(0, 10)}...`);
    }

    return existed;
  }

  /**
   * Revoke all tokens (e.g., when casting stops).
   */
  revokeAll(): void {
    const count = this.tokens.size;
    this.tokens.clear();
    logger.info(`[TokenManager] Revoked all ${count} tokens`);
  }

  /**
   * Get the number of active tokens.
   */
  getActiveTokenCount(): number {
    return this.tokens.size;
  }

  /**
   * Clean up expired tokens.
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [token, entry] of this.tokens.entries()) {
      if (now > entry.expiresAt) {
        this.tokens.delete(token);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`[TokenManager] Cleaned up ${cleaned} expired tokens`);
    }
  }

  /**
   * Start the periodic cleanup interval.
   */
  private startCleanupInterval(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the cleanup interval.
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Generate a cryptographically random token.
   */
  private createRandomToken(): string {
    // Use crypto-safe random if available, otherwise fallback to Math.random
    const bytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      // Fallback for environments without crypto
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    // Convert to hex string
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Cleanup on destroy.
   */
  destroy(): void {
    this.stopCleanup();
    this.revokeAll();
  }
}

export const tokenManager = new TokenManager();
export default tokenManager;
