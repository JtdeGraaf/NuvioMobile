import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import GoogleCast, {
  CastState,
  CastButton,
  useCastState,
  useCastDevice,
  useRemoteMediaClient,
  useMediaStatus,
  MediaInfo,
  MediaLoadRequest,
  MediaStreamType,
} from 'react-native-google-cast';
import type { MediaMetadata } from 'react-native-google-cast';
import { logger } from '../utils/logger';

// Cast media request interface for our app
export interface CastMediaRequest {
  uri: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  contentType?: string;
  headers?: Record<string, string>;
  startPosition?: number;
  type?: 'movie' | 'series';
  season?: number;
  episode?: number;
}

// Cast context state interface
interface CastContextState {
  // State
  castState: CastState | null;
  isConnected: boolean;
  isConnecting: boolean;
  deviceName: string | null;
  isCasting: boolean;
  currentPosition: number;
  duration: number;
  isPaused: boolean;
  isBuffering: boolean;

  // Methods
  showCastPicker: () => Promise<boolean>;
  loadMedia: (request: CastMediaRequest) => Promise<boolean>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (position: number) => Promise<void>;
  stop: () => Promise<void>;
  disconnect: () => Promise<void>;

  // Utility
  hasHeadersWarning: (headers?: Record<string, string>) => boolean;
}

const CastContext = createContext<CastContextState | undefined>(undefined);

interface CastProviderProps {
  children: ReactNode;
}

export const CastProvider: React.FC<CastProviderProps> = ({ children }) => {
  // Use react-native-google-cast hooks
  const castState = useCastState();
  const castDevice = useCastDevice();
  const client = useRemoteMediaClient();
  const mediaStatus = useMediaStatus();

  // Local state
  const [isCasting, setIsCasting] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  // Progress update subscription ref
  const progressSubscriptionRef = useRef<{ remove: () => void } | null>(null);

  // Derived state
  const isConnected = castState === CastState.CONNECTED;
  const isConnecting = castState === CastState.CONNECTING;
  const deviceName = castDevice?.friendlyName || null;

  // Update casting state based on media status
  useEffect(() => {
    if (mediaStatus) {
      // Only consider actively casting if playerState is playing, paused, or buffering
      // 'idle' means stopped or finished, so we shouldn't show as casting
      const isActivelyPlaying = mediaStatus.playerState === 'playing' ||
                                mediaStatus.playerState === 'paused' ||
                                mediaStatus.playerState === 'buffering' ||
                                mediaStatus.playerState === 'loading';

      setIsCasting(isActivelyPlaying);
      setIsPaused(mediaStatus.playerState === 'paused');
      setIsBuffering(mediaStatus.playerState === 'buffering' || mediaStatus.playerState === 'loading');

      if (mediaStatus.mediaInfo?.streamDuration) {
        setDuration(mediaStatus.mediaInfo.streamDuration);
      }

      logger.debug(`[CastContext] Media status update - playerState: ${mediaStatus.playerState}, isCasting: ${isActivelyPlaying}`);
    } else {
      setIsCasting(false);
      setIsPaused(false);
      setIsBuffering(false);
    }
  }, [mediaStatus]);

  // Subscribe to progress updates when casting
  useEffect(() => {
    if (client && isCasting) {
      // Clean up any existing subscription
      if (progressSubscriptionRef.current) {
        progressSubscriptionRef.current.remove();
      }

      // Subscribe to progress updates
      progressSubscriptionRef.current = client.onMediaProgressUpdated(
        (progress, dur) => {
          setCurrentPosition(progress);
          if (dur > 0) {
            setDuration(dur);
          }
        },
        1 // Update interval in seconds
      );

      logger.debug('[CastContext] Subscribed to progress updates');
    }

    return () => {
      if (progressSubscriptionRef.current) {
        progressSubscriptionRef.current.remove();
        progressSubscriptionRef.current = null;
      }
    };
  }, [client, isCasting]);

  // Log cast state changes
  useEffect(() => {
    logger.info(`[CastContext] Cast state: ${castState}, device: ${deviceName}, isConnected: ${isConnected}`);
  }, [castState, deviceName, isConnected]);

  // Log on mount
  useEffect(() => {
    logger.info('[CastContext] Provider mounted, initializing cast discovery...');
  }, []);

  // Show the cast device picker dialog
  const showCastPicker = useCallback(async (): Promise<boolean> => {
    try {
      const shown = await GoogleCast.showCastDialog();
      logger.debug(`[CastContext] Cast dialog shown: ${shown}`);
      return shown;
    } catch (error) {
      logger.error('[CastContext] Error showing cast dialog:', error);
      return false;
    }
  }, []);

  // Check if stream has headers that may not work with default receiver
  const hasHeadersWarning = useCallback((headers?: Record<string, string>): boolean => {
    if (!headers) return false;

    // Check for common auth headers
    const authHeaders = ['authorization', 'cookie', 'x-api-key', 'api-key'];
    const headerKeys = Object.keys(headers).map(k => k.toLowerCase());

    return authHeaders.some(auth => headerKeys.includes(auth));
  }, []);

  // Load media to Chromecast
  const loadMedia = useCallback(async (request: CastMediaRequest): Promise<boolean> => {
    logger.info('[CastContext] loadMedia called, client available:', !!client);

    if (!client) {
      logger.warn('[CastContext] Cannot load media: no remote media client');
      return false;
    }

    try {
      // Build metadata based on content type
      let metadata: MediaMetadata.Movie | MediaMetadata.TvShow;

      if (request.type === 'series' && request.season && request.episode) {
        metadata = {
          type: 'tvShow',
          seriesTitle: request.title,
          title: request.subtitle || `S${request.season}E${request.episode}`,
          seasonNumber: request.season,
          episodeNumber: request.episode,
          images: request.imageUrl ? [{ url: request.imageUrl }] : undefined,
        };
      } else {
        metadata = {
          type: 'movie',
          title: request.title,
          subtitle: request.subtitle,
          images: request.imageUrl ? [{ url: request.imageUrl }] : undefined,
        };
      }

      // Determine content type - better detection for various stream types
      let contentType = request.contentType;
      const uriLower = request.uri.toLowerCase();

      if (!contentType) {
        if (uriLower.includes('.m3u8') || uriLower.includes('m3u8') || uriLower.includes('hls')) {
          contentType = 'application/x-mpegURL';
        } else if (uriLower.includes('.mp4')) {
          contentType = 'video/mp4';
        } else if (uriLower.includes('.mkv')) {
          contentType = 'video/x-matroska';
        } else if (uriLower.includes('.webm')) {
          contentType = 'video/webm';
        } else {
          // For redirect URLs without clear extension, try video/mp4 as most compatible
          contentType = 'video/mp4';
        }
      }

      // Determine stream type - use BUFFERED for most content (more reliable)
      // LIVE is only needed for actual live streams
      const isLiveStream = uriLower.includes('.m3u8') && uriLower.includes('live');
      const streamType = isLiveStream ? MediaStreamType.LIVE : MediaStreamType.BUFFERED;

      const mediaInfo: MediaInfo = {
        contentUrl: request.uri,
        contentType,
        metadata,
        streamType,
      };

      const loadRequest: MediaLoadRequest = {
        mediaInfo,
        autoplay: true,
        startTime: request.startPosition || 0,
      };

      logger.info('[CastContext] Loading media:', {
        url: request.uri.substring(0, 100) + '...',
        contentType,
        streamType: mediaInfo.streamType,
        title: request.title,
        startPosition: request.startPosition,
        hasHeaders: !!request.headers,
      });

      logger.info('[CastContext] Calling client.loadMedia...');
      await client.loadMedia(loadRequest);

      logger.info('[CastContext] client.loadMedia completed successfully');
      return true;
    } catch (error: any) {
      logger.error('[CastContext] Error loading media:', error?.message || error);
      logger.error('[CastContext] Full error:', JSON.stringify(error, null, 2));
      return false;
    }
  }, [client]);

  // Playback controls
  const play = useCallback(async (): Promise<void> => {
    if (!client) return;

    try {
      await client.play();
      setIsPaused(false);
      logger.debug('[CastContext] Play');
    } catch (error) {
      logger.error('[CastContext] Error playing:', error);
    }
  }, [client]);

  const pause = useCallback(async (): Promise<void> => {
    if (!client) return;

    try {
      await client.pause();
      setIsPaused(true);
      logger.debug('[CastContext] Pause');
    } catch (error) {
      logger.error('[CastContext] Error pausing:', error);
    }
  }, [client]);

  const seek = useCallback(async (position: number): Promise<void> => {
    if (!client) return;

    try {
      await client.seek({ position });
      setCurrentPosition(position);
      logger.debug(`[CastContext] Seek to ${position}`);
    } catch (error) {
      logger.error('[CastContext] Error seeking:', error);
    }
  }, [client]);

  const stop = useCallback(async (): Promise<void> => {
    if (!client) return;

    try {
      await client.stop();
      setIsCasting(false);
      setCurrentPosition(0);
      logger.debug('[CastContext] Stop');
    } catch (error) {
      logger.error('[CastContext] Error stopping:', error);
    }
  }, [client]);

  // Disconnect from cast session
  const disconnect = useCallback(async (): Promise<void> => {
    try {
      const sessionManager = GoogleCast.getSessionManager();
      await sessionManager.endCurrentSession(true);
      setIsCasting(false);
      setCurrentPosition(0);
      logger.info('[CastContext] Disconnected from cast session');
    } catch (error) {
      logger.error('[CastContext] Error disconnecting:', error);
    }
  }, []);

  const contextValue: CastContextState = {
    // State
    castState: castState ?? null,
    isConnected,
    isConnecting,
    deviceName,
    isCasting,
    currentPosition,
    duration,
    isPaused,
    isBuffering,

    // Methods
    showCastPicker,
    loadMedia,
    play,
    pause,
    seek,
    stop,
    disconnect,

    // Utility
    hasHeadersWarning,
  };

  return (
    <CastContext.Provider value={contextValue}>
      {children}
      {/* Hidden CastButton required for Android to enable showCastDialog() */}
      {Platform.OS === 'android' && (
        <View style={castStyles.hiddenCastButton}>
          <CastButton style={castStyles.castButton} />
        </View>
      )}
    </CastContext.Provider>
  );
};

const castStyles = StyleSheet.create({
  hiddenCastButton: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
  castButton: {
    width: 24,
    height: 24,
    tintColor: 'white',
  },
});

// Hook to access cast context
export const useCastContext = (): CastContextState => {
  const context = useContext(CastContext);
  if (context === undefined) {
    throw new Error('useCastContext must be used within a CastProvider');
  }
  return context;
};

export { CastState };
