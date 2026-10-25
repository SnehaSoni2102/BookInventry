// Expo configures Metro for pnpm/npm workspaces automatically (the root .npmrc sets node-linker=hoisted).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
