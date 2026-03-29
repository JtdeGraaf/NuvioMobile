import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FastImage from '@d11/react-native-fast-image';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../contexts/ThemeContext';
import { colors } from '../../../styles/colors';

interface CastOverlayProps {
  visible: boolean;
  deviceName: string | null;
  title: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  imageUrl?: string;
  currentTime: number;
  duration: number;
  isPaused: boolean;
  isBuffering: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (position: number) => void;
  onStop: () => void;
  formatTime: (seconds: number) => string;
}

const CastOverlay: React.FC<CastOverlayProps> = ({
  visible,
  deviceName,
  title,
  episodeTitle,
  season,
  episode,
  imageUrl,
  currentTime,
  duration,
  isPaused,
  isBuffering,
  onPlay,
  onPause,
  onSeek,
  onStop,
  formatTime,
}) => {
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  const handlePlayPause = () => {
    if (isPaused) {
      onPlay();
    } else {
      onPause();
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[colors.background, colors.background]}
        style={styles.gradient}
      >
        {/* Casting indicator */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.castingIndicator}>
            <Ionicons name="tv" size={20} color={currentTheme.colors.primary} />
            <Text style={[styles.castingText, { color: currentTheme.colors.primary }]}>
              Casting to {deviceName || 'Chromecast'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.stopButton}
            onPress={onStop}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.stopText}>Stop Casting</Text>
          </TouchableOpacity>
        </View>

        {/* Media info */}
        <View style={styles.mediaInfo}>
          {imageUrl && (
            <FastImage
              source={{ uri: imageUrl }}
              style={styles.thumbnail}
              resizeMode={FastImage.resizeMode.cover}
            />
          )}
          <View style={styles.titleContainer}>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            {(season && episode) && (
              <Text style={styles.episodeInfo}>
                Season {season}, Episode {episode}
                {episodeTitle ? ` - ${episodeTitle}` : ''}
              </Text>
            )}
          </View>
        </View>

        {/* Playback controls */}
        <View style={styles.controls}>
          {/* Seek backward */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => onSeek(Math.max(0, currentTime - 10))}
          >
            <View style={styles.seekButton}>
              <Ionicons name="play-back" size={28} color={colors.white} />
              <Text style={styles.seekText}>10</Text>
            </View>
          </TouchableOpacity>

          {/* Play/Pause */}
          <TouchableOpacity
            style={[styles.playButton, { backgroundColor: currentTheme.colors.primary }]}
            onPress={handlePlayPause}
            disabled={isBuffering}
          >
            {isBuffering ? (
              <ActivityIndicator size="large" color={colors.white} />
            ) : (
              <Ionicons
                name={isPaused ? 'play' : 'pause'}
                size={40}
                color={colors.white}
              />
            )}
          </TouchableOpacity>

          {/* Seek forward */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => onSeek(Math.min(duration, currentTime + 10))}
          >
            <View style={styles.seekButton}>
              <Ionicons name="play-forward" size={28} color={colors.white} />
              <Text style={styles.seekText}>10</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        <View style={[styles.progressContainer, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={duration || 1}
            value={currentTime}
            onSlidingComplete={onSeek}
            minimumTrackTintColor={currentTheme.colors.primary}
            maximumTrackTintColor={colors.mediumGray}
            thumbTintColor={currentTheme.colors.primary}
          />
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>

        {/* Status indicator */}
        <View style={styles.statusContainer}>
          {isBuffering && (
            <Text style={styles.statusText}>Buffering...</Text>
          )}
        </View>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  gradient: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  castingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  castingText: {
    fontSize: 16,
    fontWeight: '600',
  },
  stopButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.cardHighlight,
    borderRadius: 20,
  },
  stopText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  mediaInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 40,
    maxWidth: 500,
  },
  thumbnail: {
    width: 120,
    height: 180,
    borderRadius: 8,
    marginRight: 20,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  episodeInfo: {
    color: colors.textMuted,
    fontSize: 16,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
    marginBottom: 30,
  },
  controlButton: {
    padding: 12,
  },
  seekButton: {
    alignItems: 'center',
  },
  seekText: {
    color: colors.text,
    fontSize: 12,
    marginTop: 2,
  },
  playButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  slider: {
    flex: 1,
    height: 40,
    marginHorizontal: 12,
  },
  timeText: {
    color: colors.textMuted,
    fontSize: 14,
    minWidth: 50,
    textAlign: 'center',
  },
  statusContainer: {
    position: 'absolute',
    bottom: 80,
    alignItems: 'center',
  },
  statusText: {
    color: colors.mediumGray,
    fontSize: 14,
  },
});

export default CastOverlay;
