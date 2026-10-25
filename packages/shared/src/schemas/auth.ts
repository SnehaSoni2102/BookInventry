import { z } from 'zod';
import { COMMON_PASSWORDS } from '../common-passwords';
import { Role, StallStatus } from '../enums';
import type { Permission } from '../permissions';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'This password is too common');

export const loginBodySchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(128),
  client: z.enum(['web', 'mobile']).default('web'),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const refreshBodySchema = z.object({ refreshToken: z.string().min(1).optional() });

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface ClientSettings {
  orgName: string;
  currency: string;
  locale: string;
  timezone: string;
  codePrefix: string;
  defaultLabelTemplate: string;
  autoLockMinutes: number;
  publicBaseUrl: string;
}

export interface LoginResponse {
  accessToken: string;
  /** Only returned for `client: 'mobile'`; web gets an httpOnly cookie. */
  refreshToken?: string;
  user: SessionUser;
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: SessionUser;
  permissions: Permission[];
  activeStall: { id: string; name: string; status: StallStatus } | null;
  settings: ClientSettings;
}
