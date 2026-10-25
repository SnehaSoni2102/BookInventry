import { Box, Image, Text } from '@mantine/core';

interface Props {
  url?: string | null;
  title: string;
  color?: string;
  width?: number;
  height?: number;
}

/** Cover thumbnail, or genre-coloured initials when there is no cover. */
export function BookCover({ url, title, color = '#868e96', width = 56, height }: Props) {
  const h = height ?? Math.round(width * 1.45);
  if (url) return <Image src={url} alt={`Cover of ${title}`} w={width} h={h} fit="cover" radius="sm" loading="lazy" fallbackSrc={undefined} />;
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
  return (
    <Box w={width} h={h} style={{ background: color, borderRadius: 4, display: 'grid', placeItems: 'center', flex: 'none' }} aria-label={`No cover for ${title}`}>
      <Text c="white" fw={700} size={width > 80 ? 'xl' : 'sm'}>{initials || '?'}</Text>
    </Box>
  );
}
