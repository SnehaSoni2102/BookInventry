import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

const brand = { primary: '#B8763F', secondary: '#12b886' };
export const lightTheme = { ...MD3LightTheme, colors: { ...MD3LightTheme.colors, ...brand } };
export const darkTheme = { ...MD3DarkTheme, colors: { ...MD3DarkTheme.colors, ...brand } };
