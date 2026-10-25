import type { Role } from './enums';

export const PERMISSIONS = [
  'inventory.read',
  'inventory.read.stall',
  'title.write',
  'copy.create',
  'copy.update',
  'copy.price.update',
  'copy.writeoff',
  'label.print',
  'stall.manage',
  'stall.checkout',
  'stall.checkin',
  'sale.create.central',
  'sale.create.stall',
  'sale.read.all',
  'sale.read.own',
  'sale.void',
  'import.manage',
  'shelf.manage',
  'genre.manage',
  'user.manage',
  'settings.manage',
  'audit.read',
  'report.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF: Permission[] = [
  'inventory.read',
  'title.write',
  'copy.create',
  'copy.update',
  'copy.price.update',
  'label.print',
  'stall.checkout',
  'stall.checkin',
];

const MANAGER: Permission[] = [
  'inventory.read.stall',
  'label.print',
  'sale.create.stall',
  'sale.read.own',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  INVENTORY_STAFF: STAFF,
  STALL_MANAGER: MANAGER,
};

export function can(user: { role: Role } | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
