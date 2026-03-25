import { useCallback, useRef, useEffect, useState } from 'react';
import { useCast, CastState } from '../../../hooks/useCast';
import { CastMediaRequest } from '../../../contexts/CastContext';
import { toastService } from '../../../services/toastService';
import { logger } from '../../../utils/logger';

interface UseCastPlaybackOptions {
  uri: string;
  title: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  type?: 'movie' | 'series';
  imageUrl?: string;
  headers?: Record<string, string>;
  currentTime: number;
  duration: number;
  paused: boolean;
  onCastStart?: () => void;
  onCastEnd?: (position: number) => void;
}

interface UseCastPlaybackReturn {
  // Cast state
  isCastAvailable: boolean;
  isCastConnected: boolean;
  isCasting: boolean;
  castDeviceName: string | null;

  // Actions
  onCastPress: () => Promise<void>;
  startCasting: () => Promise<boolean>;
  stopCasting: () => Promise<void>;

  // Remote controls (for overlay)
  castPlay: () => Promise<void>;
  castPause: () => Promise<void>;
  castSeek: (position: number) => Promise<void>;
  castTogglePlayback: () => Promise<void>;

  // Playback state
  castPosition: number;
  castDuration: number;
  castIsPaused: boolean;
  castIsBuffering: boolean;

  // Header warning
  hasHeaderWarning: boolean;
}

/**
 * Hook for managing Chromecast playback from the video player.
 * Handles starting/stopping cast sessions and syncing playback state.
 */
export const useCastPlayback = (options: UseCastPlaybackOptions): UseCastPlaybackReturn => {
  const {
    uri,
    title,
    episodeTitle,
    season,
    episode,
    type,
    imageUrl,
    headers,
    currentTime,
    duration,
    paused,
    onCastStart,
    onCastEnd,
  } = options;

  const cast = useCast();

  // Track casting state
  const lastLocalPositionRef = useRef(currentTime);
  const [hasShownHeaderWarning, setHasShownHeaderWarning] = useState(false);
  const [userStoppedCasting, setUserStoppedCasting] = useState(false);
  const hasAutoStartedRef = useRef(false);
  const startCastingRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));

  // Update last known position
  useEffect(() => {
    if (!cast.isCasting) {
      lastLocalPositionRef.current = currentTime;
    }
  }, [currentTime, cast.isCasting]);

  // Check if cast is available - show button even when no devices found
  // so users can open the picker (it will show "no devices" message)
  // Only hide if castState is null (cast SDK not initialized)
  const isCastAvailable = cast.castState !== null;


  // Handle when cast session ends (disconnected) - resume local playback
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (cast.isConnected) {
      wasConnectedRef.current = true;
    } else if (wasConnectedRef.current && !cast.isConnected && !cast.isConnecting) {
      // Was connected, now disconnected
      logger.info('[useCastPlayback] Cast session ended, returning to local playback');
      wasConnectedRef.current = false;

      if (onCastEnd) {
        // Return the last known cast position for resume
        onCastEnd(cast.currentPosition || lastLocalPositionRef.current);
      }
    }
  }, [cast.isConnected, cast.isConnecting, cast.currentPosition, onCastEnd]);

  // Check if stream has headers that may cause issues
  const hasHeaderWarning = cast.hasHeadersWarning(headers);

  // Handle cast button press
  const onCastPress = useCallback(async (): Promise<void> => {
    logger.info('[useCastPlayback] Cast button pressed, isConnected:', cast.isConnected);

    // Reset user stopped flag when they press cast button
    setUserStoppedCasting(false);
    hasAutoStartedRef.current = false;

    // Show device picker
    await cast.showCastPicker();
  }, [cast]);

  // Start casting current media
  const startCasting = useCallback(async (): Promise<boolean> => {
    logger.info('[useCastPlayback] startCasting called');

    if (!cast.isConnected) {
      logger.warn('[useCastPlayback] Cannot start casting: not connected');
      return false;
    }

    // Show warning toast for streams with auth headers
    if (hasHeaderWarning && !hasShownHeaderWarning) {
      toastService.warning(
        'Casting may not work',
        'This stream requires authentication. Try a different source if playback fails.'
      );
      setHasShownHeaderWarning(true);
    }

    const request: CastMediaRequest = {
      uri,
      title,
      subtitle: episodeTitle,
      season,
      episode,
      type,
      imageUrl,
      headers,
      startPosition: lastLocalPositionRef.current || 0,
    };

    logger.info('[useCastPlayback] Loading media with request:', {
      uri: uri.substring(0, 80) + '...',
      title,
      startPosition: request.startPosition,
    });

    const success = await cast.loadMedia(request);

    if (success) {
      logger.info('[useCastPlayback] Media loaded successfully, calling onCastStart');
      onCastStart?.();
    } else {
      logger.error('[useCastPlayback] Failed to load media');
      toastService.error('Failed to cast', 'Unable to start casting to device');
    }

    return success;
  }, [
    cast,
    uri,
    title,
    episodeTitle,
    season,
    episode,
    type,
    imageUrl,
    headers,
    hasHeaderWarning,
    hasShownHeaderWarning,
    onCastStart,
  ]);

  // Keep ref updated for use in effects (avoids dependency issues)
  useEffect(() => {
    startCastingRef.current = startCasting;
  }, [startCasting]);

  // Stop casting and return to local playback
  const stopCasting = useCallback(async (): Promise<void> => {
    const currentCastPosition = cast.currentPosition;

    // Mark that user intentionally stopped - prevents auto-restart
    setUserStoppedCasting(true);

    await cast.stop();

    logger.info(`[useCastPlayback] Stopped casting at position ${currentCastPosition}`);

    if (onCastEnd) {
      onCastEnd(currentCastPosition);
    }
  }, [cast, onCastEnd]);

  // Remote playback controls
  const castPlay = useCallback(async (): Promise<void> => {
    await cast.play();
  }, [cast]);

  const castPause = useCallback(async (): Promise<void> => {
    await cast.pause();
  }, [cast]);

  const castSeek = useCallback(async (position: number): Promise<void> => {
    await cast.seek(position);
  }, [cast]);

  const castTogglePlayback = useCallback(async (): Promise<void> => {
    if (cast.isPaused) {
      await cast.play();
    } else {
      await cast.pause();
    }
  }, [cast]);

  // Reset userStoppedCasting when disconnected
  useEffect(() => {
    if (!cast.isConnected) {
      setUserStoppedCasting(false);
      hasAutoStartedRef.current = false;
    }
  }, [cast.isConnected]);

  // Auto-start casting when connected - only once per connection session
  useEffect(() => {
    // Skip if user manually stopped, already auto-started, or already casting
    if (userStoppedCasting || hasAutoStartedRef.current || cast.isCasting || !cast.isConnected) {
      return;
    }

    logger.info('[useCastPlayback] Connected, auto-starting cast...');
    hasAutoStartedRef.current = true;

    // Delay to ensure client is fully ready after connection
    const timeout = setTimeout(async () => {
      logger.info('[useCastPlayback] Executing auto-start...');
      const success = await startCastingRef.current();
      logger.info('[useCastPlayback] Auto-start result:', success);

      // If failed, retry once after another delay (client might not be ready)
      if (!success) {
        logger.info('[useCastPlayback] First attempt failed, retrying...');
        setTimeout(async () => {
          const retrySuccess = await startCastingRef.current();
          logger.info('[useCastPlayback] Retry result:', retrySuccess);
        }, 1000);
      }
    }, 1000);

    return () => clearTimeout(timeout);
  }, [cast.isConnected, cast.isCasting, userStoppedCasting]);

  return {
    // Cast state
    isCastAvailable,
    isCastConnected: cast.isConnected,
    isCasting: cast.isCasting,
    castDeviceName: cast.deviceName,

    // Actions
    onCastPress,
    startCasting,
    stopCasting,

    // Remote controls
    castPlay,
    castPause,
    castSeek,
    castTogglePlayback,

    // Playback state
    castPosition: cast.currentPosition,
    castDuration: cast.duration || duration,
    castIsPaused: cast.isPaused,
    castIsBuffering: cast.isBuffering,

    // Header warning
    hasHeaderWarning,
  };
};

export default useCastPlayback;
