import { useCastContext, CastState } from '../contexts/CastContext';

/**
 * Hook to access Chromecast functionality.
 * Provides cast state, device info, and playback controls.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isConnected, deviceName, showCastPicker, loadMedia } = useCast();
 *
 *   if (isConnected) {
 *     console.log(`Connected to ${deviceName}`);
 *   }
 * }
 * ```
 */
export const useCast = () => {
  return useCastContext();
};

export { CastState };
export default useCast;
