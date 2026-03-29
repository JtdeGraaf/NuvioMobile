import { Platform } from 'react-native';
import * as Network from 'expo-network';
import { logger } from '../../utils/logger';
import { tokenManager } from './TokenManager';
import { sanitizeUrlForLogging } from './proxyUtils';

// Define the HTTP bridge interface based on the library's API
interface HttpBridgeAPI {
  start: (
    port: number,
    serviceName: string,
    callback: (request: {
      requestId: string;
      postData?: object;
      type: string;
      url: string;
    }) => void
  ) => void;
  stop: () => void;
  respond: (requestId: string, code: number, type: string, body: string) => void;
}

// Conditionally import HTTP bridge only on native platforms
let httpBridge: HttpBridgeAPI | null = null;

if (Platform.OS !== 'web') {
  try {
    httpBridge = require('react-native-http-bridge-refurbished');
  } catch (e) {
    logger.warn('[ProxyServer] Could not load react-native-http-bridge-refurbished');
  }
}

const DEFAULT_PORT = 8765;

// CORS headers required for Chromecast
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

interface HttpRequest {
  requestId: string;
  type: string;
  url: string;
  postData?: object;
}

/**
 * Local HTTP proxy server for streaming debrid content to Chromecast.
 *
 * Debrid services generate IP-locked URLs. When casting, the Chromecast
 * makes requests from its own IP, which gets rejected. This proxy runs
 * on the phone and forwards requests using the authorized IP.
 */
class ProxyServerService {
  private static instance: ProxyServerService;
  private isServerRunning = false;
  private localIp: string | null = null;
  private port = DEFAULT_PORT;
  private activeTokens: Set<string> = new Set();

  private constructor() {}

  static getInstance(): ProxyServerService {
    if (!ProxyServerService.instance) {
      ProxyServerService.instance = new ProxyServerService();
    }
    return ProxyServerService.instance;
  }

  /**
   * Start the proxy server.
   */
  async start(): Promise<boolean> {
    if (this.isServerRunning) {
      logger.debug('[ProxyServer] Server already running');
      return true;
    }

    if (!httpBridge) {
      logger.error('[ProxyServer] HTTP bridge not available');
      return false;
    }

    try {
      // Get local IP address
      const networkState = await Network.getNetworkStateAsync();

      if (!networkState.isConnected) {
        logger.error('[ProxyServer] No network connection');
        return false;
      }

      // Get the device's local IP
      const ip = await Network.getIpAddressAsync();
      if (!ip || ip === '0.0.0.0') {
        logger.error('[ProxyServer] Could not determine local IP address');
        return false;
      }

      this.localIp = ip;

      // Start the HTTP server
      httpBridge.start(this.port, 'http', (request: HttpRequest) => {
        this.handleRequest(request);
      });

      this.isServerRunning = true;
      logger.info(`[ProxyServer] Started on http://${this.localIp}:${this.port}`);
      return true;
    } catch (error) {
      logger.error('[ProxyServer] Failed to start:', error);
      return false;
    }
  }

  /**
   * Stop the proxy server.
   */
  async stop(): Promise<void> {
    if (!this.isServerRunning) {
      return;
    }

    try {
      if (httpBridge) {
        httpBridge.stop();
      }

      // Revoke all tokens
      for (const token of this.activeTokens) {
        tokenManager.revokeToken(token);
      }
      this.activeTokens.clear();

      this.isServerRunning = false;
      logger.info('[ProxyServer] Stopped');
    } catch (error) {
      logger.error('[ProxyServer] Failed to stop:', error);
    }
  }

  /**
   * Check if the server is running.
   */
  isRunning(): boolean {
    return this.isServerRunning;
  }

  /**
   * Get the server's base URL.
   */
  getBaseUrl(): string | null {
    if (!this.localIp) return null;
    return `http://${this.localIp}:${this.port}`;
  }

  /**
   * Generate a proxy URL for a target stream.
   */
  async generateProxyUrl(
    targetUrl: string,
    headers: Record<string, string> = {}
  ): Promise<string | null> {
    if (!this.isServerRunning) {
      const started = await this.start();
      if (!started) {
        return null;
      }
    }

    if (!this.localIp) {
      logger.error('[ProxyServer] No local IP address');
      return null;
    }

    // Generate a secure token for this URL
    const token = tokenManager.generateToken(targetUrl, headers);
    this.activeTokens.add(token);

    const proxyUrl = `http://${this.localIp}:${this.port}/proxy?token=${token}`;
    logger.info(
      `[ProxyServer] Generated proxy URL for: ${sanitizeUrlForLogging(targetUrl)}`
    );

    return proxyUrl;
  }

  /**
   * Handle incoming HTTP requests.
   */
  private async handleRequest(request: HttpRequest): Promise<void> {
    const { requestId, type, url } = request;

    logger.debug(`[ProxyServer] ${type} ${url}`);

    // Handle CORS preflight
    if (type === 'OPTIONS') {
      this.respond(requestId, 204, CORS_HEADERS, '');
      return;
    }

    // Parse the URL to get the token
    const parsedUrl = this.parseUrl(url);
    const token = parsedUrl.searchParams.get('token');

    if (!token) {
      logger.warn('[ProxyServer] Request missing token');
      this.respond(requestId, 400, CORS_HEADERS, 'Missing token parameter');
      return;
    }

    // Look up the token
    const entry = tokenManager.getEntry(token);
    if (!entry) {
      logger.warn('[ProxyServer] Invalid or expired token');
      this.respond(requestId, 403, CORS_HEADERS, 'Invalid or expired token');
      return;
    }

    try {
      // Build headers for the upstream request
      const upstreamHeaders: Record<string, string> = {
        ...entry.headers,
      };

      // Note: react-native-http-bridge-refurbished doesn't expose request headers
      // For Range support, the Chromecast should include it in the URL or we implement
      // a streaming approach. For now, we fetch the full content.

      // Fetch from the target URL
      const response = await fetch(entry.url, {
        method: type === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
      });

      // Build response headers
      const responseHeaders: Record<string, string> = {
        ...CORS_HEADERS,
      };

      // Forward important headers from upstream
      const headersToForward = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'content-disposition',
      ];

      for (const header of headersToForward) {
        const value = response.headers.get(header);
        if (value) {
          responseHeaders[header] = value;
        }
      }

      // Determine status code (206 for partial content)
      const statusCode = response.status;

      // Handle HEAD requests
      if (type === 'HEAD') {
        this.respond(requestId, statusCode, responseHeaders, '');
        return;
      }

      // Stream the response body
      const body = await response.arrayBuffer();
      const bodyBase64 = this.arrayBufferToBase64(body);

      this.respondWithData(requestId, statusCode, responseHeaders, bodyBase64);
    } catch (error: any) {
      logger.error('[ProxyServer] Proxy error:', error?.message || error);
      this.respond(
        requestId,
        502,
        CORS_HEADERS,
        `Proxy error: ${error?.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Send a text response.
   */
  private respond(
    requestId: string,
    statusCode: number,
    headers: Record<string, string>,
    body: string
  ): void {
    if (!httpBridge) return;

    try {
      httpBridge.respond(
        requestId,
        statusCode,
        headers['content-type'] || 'text/plain',
        body
      );
    } catch (error) {
      logger.error('[ProxyServer] Failed to respond:', error);
    }
  }

  /**
   * Send a binary response (base64 encoded).
   */
  private respondWithData(
    requestId: string,
    statusCode: number,
    headers: Record<string, string>,
    base64Data: string
  ): void {
    if (!httpBridge) return;

    try {
      // The HTTP bridge respond method takes: requestId, code, type, body
      // For binary data, we send base64 which the bridge may decode
      const contentType = headers['content-type'] || 'application/octet-stream';
      httpBridge.respond(requestId, statusCode, contentType, base64Data);
    } catch (error) {
      logger.error('[ProxyServer] Failed to respond with data:', error);
    }
  }

  /**
   * Parse a URL string, handling potential issues.
   */
  private parseUrl(url: string): URL {
    // The URL from the request might be just the path
    if (url.startsWith('/')) {
      return new URL(url, `http://localhost:${this.port}`);
    }
    return new URL(url);
  }

  /**
   * Convert ArrayBuffer to base64 string.
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Revoke a specific token (e.g., when playback ends).
   */
  revokeToken(token: string): void {
    this.activeTokens.delete(token);
    tokenManager.revokeToken(token);
  }

  /**
   * Revoke all active tokens.
   */
  revokeAllTokens(): void {
    for (const token of this.activeTokens) {
      tokenManager.revokeToken(token);
    }
    this.activeTokens.clear();
  }
}

export const proxyServerService = ProxyServerService.getInstance();
export default proxyServerService;
