# Architecture: ClawForge + mcpcodex-v2

## Two-Layer Design

This document explains the relationship between ClawForge (audit infrastructure) and mcpcodex-v2 (governance validation).

---

## Layer 1: Audit Infrastructure (ClawForge)

**Purpose:** Record tamper-proof audit trails

**Responsibilities:**
- Event recording (2,500/sec)
- Artifact storage (content-addressable)
- Session sealing (cryptographic)
- Hash chain integrity

**Technology:** TypeScript, SQLite, SHA-256

---

## Layer 2: Governance Validation (mcpcodex-v2)

**Purpose:** Validate workflows against policies

**Responsibilities:**
- Pack validation (550/sec)
- Policy enforcement
- Compliance checking
- Workflow verification

**Technology:** Python, Zod, CNF canonicalization

---

## Relationship

```
┌──────────────────────────────────────────────────────────────┐
│                         Your System                          │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     ClawForge (Layer 1)                      │
│                                                              │
│  • Records events                                            │
│  • Stores artifacts (content-addressable)                    │
│  • Seals sessions (SHA-256 hash chain)                      │
│  • Exports evidence bundles                                  │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                   mcpcodex-v2 (Layer 2)                     │
│                                                              │
│  • Validates sealed packages                                 │
│  • Enforces governance packs                                │
│  • Checks CNF canonicalization                             │
│  • Verifies cross-language equivalence                       │
└──────────────────────────────────────────────────────────────┘
```

---

## Can I Use Just One?

### ClawForge Alone ✅

Use ClawForge by itself for:
- Basic audit trails
- Evidence collection
- Tamper detection
- Session sealing

You don't need mcpcodex-v2 if you just want a secure audit log.

### mcpcodex-v2 Alone ❌

mcpcodex-v2 **requires** audit input. It validates sealed change packages that come from ClawForge (or compatible audit systems).

---

## Integration

### Step 1: Install ClawForge

```bash
npm install clawforge
clawctl init
```

### Step 2: Record Events

```bash
clawctl new-run --run my-session
clawctl append-event --run my-session --event event.json
clawctl seal --run my-session
```

### Step 3: Validate (Optional)

```bash
# Install mcpcodex-v2 validator
pip install -e ./backend/governance/validator

# Validate the sealed package
python -m governance.validator.cli validate --input sealed-change-package.json

# Validate against governance pack
python -m governance.validator.cli validate-pack \
  --input sealed-change-package.json \
  --pack change-shipping
```

---

## Use Cases

| Use Case | ClawForge Only | ClawForge + mcpcodex-v2 |
|----------|----------------|-------------------------|
| Basic audit trail | ✅ | ✅ |
| Tamper detection | ✅ | ✅ |
| Governance packs | ❌ | ✅ |
| Policy enforcement | ❌ | ✅ |
| Compliance validation | ❌ | ✅ |
| Cross-language equivalence | ❌ | ✅ |

---

## Performance

| Layer | Metric | Value |
|-------|--------|-------|
| ClawForge | Events/sec | 2,500 |
| ClawForge | Reads/sec | 70,000 |
| mcpcodex-v2 | Validations/sec | 550 |

---

## Which Should I Start With?

**Start with ClawForge** if:
- You just need audit trails
- You want the simplest setup
- Governance validation isn't required yet

**Add mcpcodex-v2** when:
- You need governance pack validation
- You want policy enforcement
- Compliance is required
- You need cross-language equivalence verification

---

## Summary

| Layer | Repo | What It Does |
|-------|------|--------------|
| 1 | ClawForge | Audit trail (events, artifacts, sealing) |
| 2 | mcpcodex-v2 | Governance validation (policies, compliance) |

**Best of both worlds:** Start simple with ClawForge, add mcpcodex-v2 when you need governance.
