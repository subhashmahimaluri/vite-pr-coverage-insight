import { z } from 'zod';

export const thresholdsSchema = z
  .object({
    lines: z.number().min(0).max(100).optional(),
    branches: z.number().min(0).max(100).optional(),
    functions: z.number().min(0).max(100).optional(),
    statements: z.number().min(0).max(100).optional(),
  })
  .strict();

export const projectSchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1),
    coverage: z.string().min(1),
    thresholds: thresholdsSchema.optional(),
  })
  .strict();

export const configSchema = z
  .object({
    thresholds: thresholdsSchema.optional(),
    overrides: z
      .array(
        z
          .object({
            path: z.string().min(1),
            thresholds: thresholdsSchema,
          })
          .strict()
      )
      .optional(),
    ratchet: z.boolean().default(false),
    /** max allowed decrease in pct before ratchet fails, in percentage points */
    ratchetTolerance: z.number().min(0).max(100).default(0.1),
    ai: z.enum(['off', 'comment', 'review']).default('off'),
    aiCanBlock: z.boolean().default(false),
    reporters: z.array(z.string()).default(['markdown', 'json']),
    /** use unicode sparklines instead of SVG image links (private repos) */
    unicodeSparklines: z.boolean().default(true),
    projects: z.array(projectSchema).optional(),
  })
  .strict();

export type Thresholds = z.infer<typeof thresholdsSchema>;
export type ProjectConfig = z.infer<typeof projectSchema>;
export type Config = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: Config = configSchema.parse({});
