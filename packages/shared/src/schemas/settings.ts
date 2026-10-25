import { z } from 'zod';
import { BookCondition } from '../enums';
import { LabelTemplate } from './labels';

export const PUBLIC_FIELDS = ['cover', 'title', 'authors', 'genre', 'condition', 'sellingPrice', 'originalPrice', 'summary', 'availability'] as const;

const validTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** One zod schema per setting key. Unknown keys are rejected. */
export const SETTING_SCHEMAS = {
  'org.name': z.string().trim().min(1).max(100),
  'org.currency': z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
  'org.locale': z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Use a locale like en-IN'),
  'org.timezone': z.string().refine(validTimezone, 'Unknown time zone'),
  /** Changing the prefix only affects copies created from now on. */
  'copy.codePrefix': z.string().regex(/^[A-Z]{2,4}$/, '2–4 capital letters'),
  'label.defaultTemplate': z.enum(LabelTemplate),
  'pricing.conditionPercent': z.object(
    Object.fromEntries(BookCondition.values.map((c) => [c, z.number().int().min(0).max(100)])) as Record<(typeof BookCondition.values)[number], z.ZodNumber>,
  ),
  'pricing.roundToMinor': z.number().int().min(1).max(100_000),
  'sales.managerSeesWholeStall': z.boolean(),
  'public.enabled': z.boolean(),
  'public.fields': z.array(z.enum(PUBLIC_FIELDS)).max(PUBLIC_FIELDS.length),
  'stall.deactivateManagersOnClose': z.boolean(),
  'session.autoLockMinutes': z.number().int().min(0).max(1440),
  'shelf.lowSpaceThresholdPercent': z.number().int().min(1).max(100),
} as const;
export type SettingKey = keyof typeof SETTING_SCHEMAS;

export const updateSettingsBodySchema = z
  .record(z.string(), z.unknown())
  .superRefine((body, ctx) => {
    if (!Object.keys(body).length) ctx.addIssue({ code: 'custom', message: 'Nothing to update' });
    for (const [key, value] of Object.entries(body)) {
      const schema = SETTING_SCHEMAS[key as SettingKey];
      if (!schema) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Unknown setting' });
        continue;
      }
      const r = schema.safeParse(value);
      if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: 'custom', path: [key, ...i.path], message: i.message });
    }
  });
export type UpdateSettingsBody = Partial<{ [K in SettingKey]: z.infer<(typeof SETTING_SCHEMAS)[K]> }>;
