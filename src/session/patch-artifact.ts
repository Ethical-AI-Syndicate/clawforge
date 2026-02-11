/**
 * PatchArtifact schema — describes the output of a single execution step.
 *
 * Lists files changed, imports declared, and new dependencies.
 * No execution. Structural validation only.
 */

import { z } from "zod";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

export const FileChangeSchema = z
  .object({
    path: z.string().min(1),
    changeType: z.enum(["create", "modify", "delete"]),
    diff: z.string(),
  })
  .passthrough();

export const PatchArtifactSchema = z
  .object({
    schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
    sessionId: uuidV4,
    stepId: z.string().min(1).max(200),
    patchId: uuidV4,
    filesChanged: z.array(FileChangeSchema).min(1),
    declaredImports: z.array(z.string()),
    declaredNewDependencies: z.array(z.string()).default([]),
  })
  .passthrough()
  .refine(
    (patch) => {
      const paths = patch.filesChanged.map((f) => f.path);
      return new Set(paths).size === paths.length;
    },
    "filesChanged paths must be unique",
  );

export type PatchArtifact = z.infer<typeof PatchArtifactSchema>;
