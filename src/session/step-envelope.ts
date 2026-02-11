/**
 * StepEnvelope schema — declares the boundary of a single execution step.
 *
 * Defines allowed files, referenced DoD items, capabilities, and the
 * reviewer sequence that must validate the step's patch.
 * No execution. Structural validation only.
 */

import { z } from "zod";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

export const StepEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
    sessionId: uuidV4,
    stepId: z.string().min(1).max(200),
    goalExcerpt: z.string().min(1),
    allowedFiles: z
      .object({
        create: z.array(z.string().min(1)).default([]),
        modify: z.array(z.string().min(1)).default([]),
        delete: z.array(z.string().min(1)).default([]),
      })
      .passthrough(),
    referencedDoDItems: z.array(z.string().min(1)).min(1),
    allowedCapabilities: z.array(z.string().min(1)).default([]),
    reviewerSequence: z.array(z.string().min(1)).min(3),
  })
  .passthrough()
  .refine(
    (env) => {
      const c = new Set(env.allowedFiles.create);
      const m = new Set(env.allowedFiles.modify);
      const d = new Set(env.allowedFiles.delete);
      for (const p of c) {
        if (m.has(p) || d.has(p)) return false;
      }
      for (const p of m) {
        if (d.has(p)) return false;
      }
      return true;
    },
    "allowedFiles arrays must be disjoint (no path in more than one array)",
  );

export type StepEnvelope = z.infer<typeof StepEnvelopeSchema>;
