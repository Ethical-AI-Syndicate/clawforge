/**
 * Step Packet Schema — least-privilege work packet per execution step.
 *
 * Phase O: Defines the structure for scoped step packets that contain
 * only the minimum required context for each execution plan step.
 * Packets are hash-bound to approved artifacts and structurally linted.
 */

import { z } from "zod";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";
import { canonicalJson } from "../audit/canonical.js";
import { sha256Hex } from "./crypto.js";
import { SessionError } from "./errors.js";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const iso8601Utc = z
  .string()
  .regex(ISO8601_RE, "Must be ISO 8601 UTC datetime")
  .refine((s) => !isNaN(Date.parse(s)), "Must be parseable datetime");

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const sha256HexString = z
  .string()
  .regex(SHA256_HEX_RE, "Must be 64-char lowercase hex SHA-256");

// Path validation: no "..", no absolute paths, no backslashes
const repoRelativePath = z
  .string()
  .min(1)
  .max(1000)
  .refine((p) => !p.includes(".."), "Path must not contain '..'")
  .refine((p) => !p.startsWith("/"), "Path must not be absolute")
  .refine((p) => !p.includes("\\"), "Path must not contain backslashes");

const schemaVersion = z
  .string()
  .refine(
    (v) => v === SESSION_SCHEMA_VERSION,
    `schemaVersion must be exactly "${SESSION_SCHEMA_VERSION}"`,
  );

// ---------------------------------------------------------------------------
// File Digest Schema
// ---------------------------------------------------------------------------

export const FileDigestSchema = z
  .object({
    path: repoRelativePath,
    sha256: sha256HexString,
  })
  .passthrough();

export type FileDigest = z.infer<typeof FileDigestSchema>;

// ---------------------------------------------------------------------------
// Excerpt Schema
// ---------------------------------------------------------------------------

export const ExcerptSchema = z
  .object({
    path: repoRelativePath,
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    text: z.string().max(2000), // Max 2000 chars per excerpt
  })
  .refine((e) => e.startLine <= e.endLine, "startLine must be <= endLine")
  .passthrough();

export type Excerpt = z.infer<typeof ExcerptSchema>;

// ---------------------------------------------------------------------------
// Packet Context Schema
// ---------------------------------------------------------------------------

export const PacketContextSchema = z
  .object({
    fileDigests: z.array(FileDigestSchema).optional(),
    excerpts: z.array(ExcerptSchema).optional(),
  })
  .passthrough();

export type PacketContext = z.infer<typeof PacketContextSchema>;

// ---------------------------------------------------------------------------
// Step Packet Schema
// ---------------------------------------------------------------------------

export const StepPacketSchema = z
  .object({
    schemaVersion,
    sessionId: uuidV4,
    lockId: uuidV4,
    stepId: z.string().min(1).max(200),
    planHash: sha256HexString,
    capsuleHash: sha256HexString,
    snapshotHash: sha256HexString,
    goalReference: z.string().min(1).max(5000), // MUST include exact Decision Lock goal
    dodId: uuidV4,
    dodItemRefs: z.array(z.string().min(1).max(100)).min(0),
    allowedFiles: z.array(repoRelativePath).min(0).max(200),
    allowedSymbols: z.array(z.string().min(1).max(500)).min(0).max(500),
    requiredCapabilities: z.array(z.string().min(1).max(100)).optional(),
    reviewerSequence: z.array(z.string().min(1).max(100)).min(3),
    context: PacketContextSchema,
    packetHash: sha256HexString,
    createdAt: iso8601Utc,
  })
  .passthrough()
  .refine(
    (packet) => {
      const computed = computeStepPacketHash(packet);
      return packet.packetHash === computed;
    },
    {
      message: "packetHash must equal computed hash",
      path: ["packetHash"],
    },
  )
  .refine(
    (packet) => {
      const json = canonicalJson(packet);
      const sizeKB = Buffer.byteLength(json, "utf8") / 1024;
      return sizeKB <= 200;
    },
    {
      message: "Packet size must not exceed 200KB",
      path: [],
    },
  )
  .refine(
    (packet) => {
      // Check for forbidden field names in serialized JSON
      const json = JSON.stringify(packet);
      const forbiddenPattern = /"(cmd|command|shell|exec|curl|http|https|spawn|write|delete)":/i;
      return !forbiddenPattern.test(json);
    },
    {
      message: "Packet must not contain forbidden field names (cmd, command, shell, exec, curl, http, https, spawn, write, delete)",
      path: [],
    },
  );

export type StepPacket = z.infer<typeof StepPacketSchema>;

// ---------------------------------------------------------------------------
// Packet Receipt Schema (optional)
// ---------------------------------------------------------------------------

export const PacketReceiptSchema = z
  .object({
    schemaVersion,
    sessionId: uuidV4,
    stepId: z.string().min(1).max(200),
    packetHash: sha256HexString,
    runnerIdentityHash: sha256HexString.optional(),
    attestationHash: sha256HexString.optional(),
    timestamp: iso8601Utc,
    nonce: uuidV4,
    producedArtifacts: z.array(
      z.object({
        type: z.string().min(1).max(100),
        path: z.string().min(1).max(1000),
        hash: sha256HexString,
      }).passthrough(),
    ).min(0),
  })
  .passthrough();

export type PacketReceipt = z.infer<typeof PacketReceiptSchema>;

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute step packet hash from normalized packet (excluding packetHash field).
 *
 * @param packet - Step packet to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeStepPacketHash(packet: StepPacket): string {
  const normalized = normalizeStepPacket(packet);
  const canonical = canonicalJson(normalized);
  return sha256Hex(canonical);
}

/**
 * Normalize step packet for hashing (excludes packetHash field).
 */
function normalizeStepPacket(
  packet: StepPacket,
): Record<string, unknown> {
  // Sort arrays for determinism
  const normalized: Record<string, unknown> = {
    schemaVersion: packet.schemaVersion,
    sessionId: packet.sessionId,
    lockId: packet.lockId,
    stepId: packet.stepId,
    planHash: packet.planHash,
    capsuleHash: packet.capsuleHash,
    snapshotHash: packet.snapshotHash,
    goalReference: packet.goalReference,
    dodId: packet.dodId,
    dodItemRefs: [...packet.dodItemRefs].sort(),
    allowedFiles: [...packet.allowedFiles].sort(),
    allowedSymbols: [...packet.allowedSymbols].sort(),
    reviewerSequence: [...packet.reviewerSequence],
    context: {
      fileDigests: packet.context.fileDigests
        ? [...packet.context.fileDigests].sort((a, b) => a.path.localeCompare(b.path))
        : undefined,
      excerpts: packet.context.excerpts
        ? [...packet.context.excerpts].sort((a, b) => {
            const pathCmp = a.path.localeCompare(b.path);
            return pathCmp !== 0 ? pathCmp : a.startLine - b.startLine;
          })
        : undefined,
    },
    // createdAt is included in normalized data for hash computation
    createdAt: packet.createdAt,
  };

  // Include optional fields if present
  if (packet.requiredCapabilities) {
    normalized.requiredCapabilities = [...packet.requiredCapabilities].sort();
  }

  // Include passthrough fields but exclude packetHash
  const allKeys = Object.keys(packet).sort();
  for (const key of allKeys) {
    if (
      key === "schemaVersion" ||
      key === "sessionId" ||
      key === "lockId" ||
      key === "stepId" ||
      key === "planHash" ||
      key === "capsuleHash" ||
      key === "snapshotHash" ||
      key === "goalReference" ||
      key === "dodId" ||
      key === "dodItemRefs" ||
      key === "allowedFiles" ||
      key === "allowedSymbols" ||
      key === "requiredCapabilities" ||
      key === "reviewerSequence" ||
      key === "context" ||
      key === "createdAt" ||
      key === "packetHash" // Exclude packetHash
    ) {
      continue;
    }
    normalized[key] = packet[key as keyof StepPacket];
  }

  return normalized;
}
