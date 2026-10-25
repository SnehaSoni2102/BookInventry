import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Goonj brand: #B8763F is the main shade (index 6)
const goonj: MantineColorsTuple = ['#FAF5F2', '#F4E9E0', '#EBD9C9', '#E1C5AE', '#D4AD8C', '#C58F62', '#B8763F', '#9E6536', '#84552D', '#6B4425'];

export const theme = createTheme({
  colors: { goonj },
  primaryColor: 'goonj',
  primaryShade: 6,
  defaultRadius: 'md',
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif',
  headings: { fontWeight: '650' },
  components: {
    // 44 px touch targets on controls that are tapped a lot
    Button: { defaultProps: { size: 'sm' } },
    ActionIcon: { defaultProps: { size: 'lg' } },
  },
});
