import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { Preferences } from '@capacitor/preferences';
import { ScreenOrientation } from '@capacitor/screen-orientation';

const RECORD_KEY = 'hoprise-best-altitude';
const SCORE_KEY = 'hoprise-best-score';
const COINS_KEY = 'hoprise-lifetime-coins';
type HapticEvent = 'landing' | 'coin' | 'powerup' | 'stomp' | 'hit' | 'record';
const hapticCooldown: Partial<Record<HapticEvent, number>> = {};

async function loadStoredNumber(key: string): Promise<number> {
  try {
    if (Capacitor.isNativePlatform()) {
      const stored = await Preferences.get({ key });
      const value = Number(stored.value);
      if (Number.isFinite(value) && value >= 0) return value;
    }
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}

async function saveStoredNumber(key: string, value: number): Promise<void> {
  try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ }
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key, value: String(value) }).catch(() => undefined);
  }
}

export async function initializeMobile(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => undefined);
    return;
  }
  const browserOrientation = screen.orientation as ScreenOrientation & { lock?: (orientation: 'portrait') => Promise<void> };
  if (window.matchMedia('(pointer: coarse)').matches && browserOrientation?.lock) {
    await browserOrientation.lock('portrait').catch(() => undefined);
  }
}

export async function loadBestAltitude(): Promise<number> {
  return loadStoredNumber(RECORD_KEY);
}

export async function saveBestAltitude(value: number): Promise<void> {
  await saveStoredNumber(RECORD_KEY, value);
}

export async function loadBestScore(): Promise<number> {
  return loadStoredNumber(SCORE_KEY);
}

export async function saveBestScore(value: number): Promise<void> {
  await saveStoredNumber(SCORE_KEY, value);
}

export async function loadLifetimeCoins(): Promise<number> {
  return loadStoredNumber(COINS_KEY);
}

export async function saveLifetimeCoins(value: number): Promise<void> {
  await saveStoredNumber(COINS_KEY, value);
}

export async function setGameAwake(awake: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (awake) await KeepAwake.keepAwake();
    else await KeepAwake.allowSleep();
  } catch { /* device does not support this native feature */ }
}

export async function gameplayHaptic(event: HapticEvent): Promise<void> {
  const now = Date.now();
  const minimumInterval = event === 'coin' ? 130 : 75;
  if (now - (hapticCooldown[event] ?? 0) < minimumInterval) return;
  hapticCooldown[event] = now;

  const vibrationMs: Record<HapticEvent, number> = {
    landing: 18, coin: 16, powerup: 42, stomp: 34, hit: 65, record: 50,
  };
  try {
    if (event === 'record') {
      await Haptics.notification({ type: NotificationType.Success });
    } else {
      const style = event === 'hit' ? ImpactStyle.Heavy : event === 'powerup' || event === 'stomp' ? ImpactStyle.Medium : ImpactStyle.Light;
      await Haptics.impact({ style });
    }
  } catch {
    try { navigator.vibrate?.(vibrationMs[event]); } catch { /* vibration is optional on this device */ }
  }
}

export async function landingFeedback(): Promise<void> {
  await gameplayHaptic('landing');
}

type PermissionDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

export async function requestTiltPermission(): Promise<boolean> {
  const orientationEvent = window.DeviceOrientationEvent as PermissionDeviceOrientationEvent | undefined;
  if (!orientationEvent) return false;
  if (orientationEvent.requestPermission) {
    try { return await orientationEvent.requestPermission() === 'granted'; }
    catch { return false; }
  }
  return true;
}
