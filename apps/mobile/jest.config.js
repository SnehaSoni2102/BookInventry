module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // pnpm keeps packages under node_modules/.pnpm/<name>@<ver>/node_modules/<name>, hence the optional ".pnpm/" below.
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-paper|react-native-vector-icons|@bookstall/.*))',
  ],
};
