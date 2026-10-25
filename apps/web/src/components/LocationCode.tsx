import { Code, Tooltip } from '@mantine/core';

/** "FIC-A03-017" in bold monospace, with a plain-English tooltip. */
export function LocationCode({ code, size = 'sm' }: { code: string | null | undefined; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  if (!code) return <Code color="red">UNSHELVED</Code>;
  const m = /^([A-Z]+)-([A-Z]+)(\d{2})-(\d{3})$/.exec(code);
  const hint = m ? `${m[1]} · Rack ${m[2]} · Row ${Number(m[3])} · Slot ${Number(m[4])}` : code;
  const fz = { sm: 13, md: 16, lg: 24, xl: 40 }[size];
  return (
    <Tooltip label={hint} withArrow>
      <Code fw={700} style={{ fontSize: fz, letterSpacing: 0.5 }}>{code}</Code>
    </Tooltip>
  );
}
