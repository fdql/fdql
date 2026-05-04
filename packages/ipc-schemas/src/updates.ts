import { z } from 'zod';

const UpdateCheckBaseSchema = z.object({
  checkedAt: z.string(),
  currentVersion: z.string(),
  latestVersion: z.string(),
  releaseUrl: z.string().url(),
});

export const UpdateCheckRequestSchema = z.object({
  force: z.boolean().optional(),
});

export const UpdateCheckResultSchema = z.discriminatedUnion('status', [
  UpdateCheckBaseSchema.extend({ status: z.literal('available') }),
  UpdateCheckBaseSchema.extend({ status: z.literal('current') }),
  z.object({
    checkedAt: z.string(),
    message: z.string(),
    status: z.literal('failed'),
  }),
]);

export const OpenExternalUrlRequestSchema = z.object({
  url: z.string().url(),
});
