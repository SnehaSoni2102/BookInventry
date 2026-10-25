import type { Permission } from '@bookstall/shared';
import { IconBooks, IconBuildingStore, IconCash, IconChartBar, IconFileImport, IconHistory, IconLayoutGrid, IconLibraryPlus, IconPrinter, IconScan, IconSettings, IconTags, IconUsers } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: ReactNode;
  /** visible when the user has ANY of these */
  any: Permission[];
  /** ...and ALL of these */
  all?: Permission[];
  /** ...and NONE of these (lets "My stall" hide for staff, who get the full Inventory page) */
  unless?: Permission[];
  /** shown in the mobile bottom bar */
  tab?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: <IconChartBar size={20} />, any: [], tab: true },
  { to: '/scan', labelKey: 'nav.scan', icon: <IconScan size={20} />, any: [], tab: true },
  { to: '/books/new', labelKey: 'nav.addBooks', icon: <IconLibraryPlus size={20} />, any: ['copy.create'], tab: true },
  { to: '/inventory', labelKey: 'nav.inventory', icon: <IconBooks size={20} />, any: ['inventory.read'], tab: true },
  { to: '/my-stall', labelKey: 'nav.myStall', icon: <IconBooks size={20} />, any: ['inventory.read.stall'], unless: ['inventory.read'], tab: true },
  { to: '/stalls', labelKey: 'nav.stalls', icon: <IconBuildingStore size={20} />, any: ['stall.manage', 'stall.checkout', 'stall.checkin'] },
  { to: '/sales', labelKey: 'nav.sales', icon: <IconCash size={20} />, any: ['sale.read.all'] },
  { to: '/sales', labelKey: 'nav.mySales', icon: <IconCash size={20} />, any: ['sale.read.own'], unless: ['sale.read.all'], tab: true },
  { to: '/labels', labelKey: 'nav.labels', icon: <IconPrinter size={20} />, any: ['label.print'], all: ['inventory.read'] },
  { to: '/imports', labelKey: 'nav.import', icon: <IconFileImport size={20} />, any: ['import.manage'] },
  { to: '/shelves', labelKey: 'nav.shelves', icon: <IconLayoutGrid size={20} />, any: ['shelf.manage', 'inventory.read'] },
  { to: '/genres', labelKey: 'nav.genres', icon: <IconTags size={20} />, any: ['genre.manage'] },
  { to: '/users', labelKey: 'nav.users', icon: <IconUsers size={20} />, any: ['user.manage'] },
  { to: '/settings', labelKey: 'nav.settings', icon: <IconSettings size={20} />, any: ['settings.manage'] },
  { to: '/audit', labelKey: 'nav.audit', icon: <IconHistory size={20} />, any: ['audit.read'] },
];

export function visibleNav(can: (p: Permission) => boolean): NavItem[] {
  return NAV.filter((n) => (n.any.length === 0 || n.any.some(can)) && (n.all ?? []).every(can) && !(n.unless ?? []).some(can));
}
