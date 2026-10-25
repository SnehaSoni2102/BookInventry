import { z } from 'zod';
import { Role } from '../enums';
import { booleanQuery, paginationQuerySchema } from './common';
import { passwordSchema } from './auth';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'Use 3–32 characters: a–z, 0–9, dot, dash, underscore');

export const createUserBodySchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(100),
  role: Role.schema,
  password: passwordSchema.optional(),
});
export type CreateUserBody = z.infer<typeof createUserBodySchema>;

export const updateUserBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    role: Role.schema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: Role.schema.optional(),
  q: z.string().trim().max(100).optional(),
  active: booleanQuery.optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export interface UserDto {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  activeStall?: { id: string; name: string } | null;
}

export interface CreateUserResponse {
  user: UserDto;
  /** Present only when the server generated the password. Shown once. */
  initialPassword?: string;
  /** One-time token for `GET /users/:id/credential-slip.pdf`; present when `initialPassword` is. */
  slipToken?: string;
}

export interface ResetPasswordResponse {
  user: UserDto;
  temporaryPassword: string;
  slipToken: string;
}

export const credentialSlipQuerySchema = z.object({ token: z.string().min(16).max(200) });
