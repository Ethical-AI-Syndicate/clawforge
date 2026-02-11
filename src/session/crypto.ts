/**
 * Cryptographic utilities — SHA-256 hashing only.
 *
 * Uses node:crypto for deterministic hashing.
 * No execution surfaces, no network, no process spawning.
 */

import { createHash } from "node:crypto";

/**
 * Compute SHA-256 hash of input string and return as lowercase hex.
 *
 * @param input - String to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
