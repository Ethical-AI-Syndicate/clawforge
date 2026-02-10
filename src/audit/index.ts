export { canonicalJson } from "./canonical.js";

export {
  sha256,
  sha256Bytes,
  computeEventHash,
  verifyChain,
  type ChainFailure,
  type ChainVerificationResult,
} from "./hashing.js";

export {
  EventStore,
  StoreIntegrityError,
  type StoreErrorCode,
  type EventDraft,
  type StoredEvent,
  type RunInfo,
} from "./store.js";
