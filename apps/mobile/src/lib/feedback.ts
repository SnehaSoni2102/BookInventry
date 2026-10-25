import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

let ok: AudioPlayer | undefined;
let bad: AudioPlayer | undefined;

function play(p: AudioPlayer | undefined) {
  try {
    void p?.seekTo(0);
    p?.play();
  } catch {
    /* sound is a nicety */
  }
}

/** Haptic + beep on a good scan, haptic + buzz on a bad one. */
export const feedback = {
  success() {
    try {
      ok ??= createAudioPlayer(require('../../assets/sounds/success.wav'));
    } catch {
      /* audio unavailable */
    }
    play(ok);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  error() {
    try {
      bad ??= createAudioPlayer(require('../../assets/sounds/error.wav'));
    } catch {
      /* audio unavailable */
    }
    play(bad);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  },
};
