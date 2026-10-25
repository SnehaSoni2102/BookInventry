import { ActionIcon, AppShell, Burger, Group, Menu, NavLink, Text, TextInput, Tooltip, UnstyledButton, Avatar, Stack, ScrollArea } from '@mantine/core';
import { useDisclosure, useHotkeys, useMediaQuery } from '@mantine/hooks';
import { IconCamera, IconKey, IconLogout, IconScan } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink as RouterNavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { CartButton } from '../components/CartDrawer';
import { CartProvider } from '../lib/cart';
import { ScannerProvider, useScanner } from '../lib/scanner';
import { useAuth } from './auth';
import { visibleNav } from './nav';
import { AppSpotlight } from './AppSpotlight';
import { ConnectionIndicator, RealtimeBridge } from './RealtimeBridge';

/** Always-visible scan input: type or scan (with a USB/Bluetooth scanner focused here) and press Enter. */
function ScanBox() {
  const { dispatch, openCamera } = useScanner();
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useHotkeys([['/', (e) => { e.preventDefault(); ref.current?.focus(); }]]);
  return (
    <Group gap={6} wrap="nowrap" style={{ flex: 1, maxWidth: 520 }}>
      <TextInput
        ref={ref}
        flex={1}
        placeholder="Scan or type a book code / ISBN  ( / )"
        aria-label="Scan or type a code"
        leftSection={<IconScan size={16} />}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            dispatch(value, 'box');
            setValue('');
          }
        }}
        data-testid="scan-box"
      />
      <Tooltip label="Scan with the camera"><ActionIcon variant="default" size="lg" aria-label="Scan with camera" onClick={() => openCamera()}><IconCamera size={18} /></ActionIcon></Tooltip>
    </Group>
  );
}

function Shell() {
  const { t } = useTranslation();
  const { me, can, logout } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [opened, { toggle, close }] = useDisclosure();
  const mobile = useMediaQuery('(max-width: 48em)');
  const items = visibleNav(can);
  const tabs = items.filter((i) => i.tab).slice(0, 5);
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));
  const canSell = can('sale.create.central') || can('sale.create.stall');

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: 'md', collapsed: { mobile: !opened } }}
      footer={mobile ? { height: 60 } : undefined}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" wrap="nowrap">
          <Burger opened={opened} onClick={toggle} hiddenFrom="md" size="sm" aria-label="Menu" />
          <RouterNavLink to="/" aria-label={me?.settings.orgName ?? 'Goonj'} style={{ display: 'flex', flexShrink: 0 }}>
            <img src="/goonj-logo.png" alt={me?.settings.orgName ?? 'Goonj'} height={44} style={{ height: 44, width: 'auto' }} />
          </RouterNavLink>
          <ScanBox />
          <Group gap="sm" ml="auto" wrap="nowrap">
            <ConnectionIndicator />
            {canSell && <CartButton />}
            <Menu position="bottom-end" width={220}>
              <Menu.Target>
                <UnstyledButton aria-label="Account menu" data-testid="user-menu">
                  <Group gap={8} wrap="nowrap">
                    <Avatar radius="xl" size={32} color="goonj">{me?.user.displayName.slice(0, 1).toUpperCase()}</Avatar>
                    <Stack gap={0} visibleFrom="sm"><Text size="sm" fw={600} lh={1.1}>{me?.user.displayName}</Text><Text size="xs" c="dimmed" lh={1.1}>{me?.user.role.replace('_', ' ').toLowerCase()}</Text></Stack>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me?.user.username}</Menu.Label>
                <Menu.Item leftSection={<IconKey size={16} />} onClick={() => navigate('/change-password')}>Change password</Menu.Item>
                <Menu.Item leftSection={<IconLogout size={16} />} color="red" onClick={() => void logout()} data-testid="logout">Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <ScrollArea>
          {items.map((n) => (
            <NavLink key={n.to + n.labelKey} component={RouterNavLink} to={n.to} label={t(n.labelKey)} leftSection={n.icon} active={isActive(n.to)} onClick={close} data-testid={`nav-${n.to}`} />
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
        <AppSpotlight />
      </AppShell.Main>

      {mobile && (
        <AppShell.Footer>
          <Group h="100%" justify="space-around" wrap="nowrap" px="xs">
            {tabs.map((n) => (
              <UnstyledButton key={n.to + n.labelKey} component={RouterNavLink} to={n.to} aria-label={t(n.labelKey)} style={{ flex: 1, textAlign: 'center', color: isActive(n.to) ? 'var(--mantine-color-goonj-6)' : 'inherit', padding: 6 }}>
                <Stack gap={0} align="center">{n.icon}<Text size="10px">{t(n.labelKey)}</Text></Stack>
              </UnstyledButton>
            ))}
          </Group>
        </AppShell.Footer>
      )}
    </AppShell>
  );
}

/** Everything that needs the router + a signed-in user: realtime socket, cart, scanner. */
export function Layout() {
  return (
    <RealtimeBridge>
      <CartProvider>
        <ScannerProvider>
          <Shell />
        </ScannerProvider>
      </CartProvider>
    </RealtimeBridge>
  );
}
