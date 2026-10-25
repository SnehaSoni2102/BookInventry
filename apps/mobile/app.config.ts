import type { ExpoConfig } from 'expo/config';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://books.example.org/api/v1';
const APP_URL = process.env.EXPO_PUBLIC_APP_URL ?? 'https://books.example.org';
const host = new URL(APP_URL).host;
const isDev = process.env.APP_VARIANT === 'development';

const config: ExpoConfig = {
  name: isDev ? 'Bookstall (dev)' : 'Bookstall',
  slug: 'bookstall',
  scheme: 'bookstall',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  // Android only (decision D12): iPhone users use the installable web app instead.
  platforms: ['android'],
  android: {
    package: process.env.ANDROID_PACKAGE ?? 'org.ngo.bookstall',
    versionCode: 1,
    permissions: ['CAMERA', 'VIBRATE'],
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#ffffff' },
    // Scanning a sticker with the phone's own camera opens the app (App Links, verified via /.well-known/assetlinks.json).
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host, pathPrefix: '/b/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-camera', { cameraPermission: 'Used to scan book QR codes and ISBN barcodes' }],
    ['expo-image-picker', { photosPermission: 'Used to attach a cover photo to a book', cameraPermission: 'Used to take a photo of a book cover' }],
    // Plain-HTTP traffic (a LAN API) is only allowed in development builds.
    ['expo-build-properties', { android: { usesCleartextTraffic: isDev } }],
  ],
  experiments: { typedRoutes: false },
  runtimeVersion: { policy: 'appVersion' },
  extra: { apiUrl: API_URL, appUrl: APP_URL },
};

export default config;
