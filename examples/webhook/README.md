# ClawForge Webhook Integration

Receive events from external systems (webhooks) and record them to ClawForge.

## Overview

```
External System (CI/CD, Monitoring, etc.)
         ↓
HTTP Webhook
         ↓
ClawForge Session
         ↓
Events recorded (hash-chained)
```

## Quick Start

### 1. Install Dependencies

```bash
npm install express clawforge
# or
pnpm add express clawforge
```

### 2. Create the Server

```typescript
// webhook-server.ts
import express from "express";
import { ClawForge } from "clawforge";

const app = express();
app.use(express.json());

const cf = new ClawForge({
  dbPath: "./data/clawforge.db",
  artifactRoot: "./data/artifacts",
});

// Create or get session from webhook
app.post("/webhook/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { eventType, payload } = req.body;

  try {
    // Ensure session exists
    await cf.session.create(sessionId, {
      actor: payload.actor || "webhook",
      metadata: payload.metadata || {},
    });

    // Record the event
    await cf.event.append(sessionId, {
      eventType,
      payload,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, sessionId, eventType });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Verify session integrity
app.get("/verify/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const result = await cf.session.verify(sessionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Export evidence bundle
app.get("/evidence/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const bundlePath = await cf.session.exportEvidence(sessionId);
    res.json({ success: true, bundlePath });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.listen(3000, () => {
  console.log("ClawForge webhook server running on port 3000");
});
```

### 3. Run the Server

```bash
npx ts-node webhook-server.ts
```

## Usage Examples

### GitHub Webhook

```bash
# Record a GitHub deployment event
curl -X POST http://localhost:3000/webhook/deploy-prod-001 \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "DeploymentEvent",
    "payload": {
      "environment": "production",
      "actor": "github-actions[bot]",
      "version": "v1.2.3",
      "repository": "acme/app",
      "status": "success"
    }
  }'
```

### Prometheus/Alertmanager

```bash
# Record an alert
curl -X POST http://localhost:3000/webhook/alert-001 \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "AlertFired",
    "payload": {
      "alertname": "HighCPUUsage",
      "severity": "warning",
      "instance": "prod-api-01",
      "firedAt": "2024-01-15T10:30:00Z"
    }
  }'
```

### Generic Audit

```bash
# Record any audit event
curl -X POST http://localhost:3000/webhook/audit-001 \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "UserAction",
    "payload": {
      "action": "user.login",
      "actor": "user@example.com",
      "ip": "192.168.1.1",
      "result": "success"
    }
  }'
```

## Verification

```bash
# Verify session integrity
curl http://localhost:3000/verify/deploy-prod-001

# Export evidence bundle
curl http://localhost:3000/evidence/deploy-prod-001 \
  -o deploy-evidence.zip
```

## Docker Deployment

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

EXPOSE 3000
CMD ["node", "webhook-server.ts"]
```

```bash
docker build -t clawforge-webhook .
docker run -p 3000:3000 -v $(pwd)/data:/app/data clawforge-webhook
```

## Security

For production:

1. **Add authentication**:
   ```typescript
   app.post("/webhook/:sessionId", (req, res, next) => {
     const token = req.headers.authorization;
     if (token !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
       return res.status(401).json({ error: "Unauthorized" });
     }
     next();
   }, async (req, res) => {
     // ... handler
   });
   ```

2. **Use HTTPS** in production (reverse proxy with TLS)

3. **Rate limiting** to prevent abuse

4. **Input validation** with Zod:
   ```typescript
   import { z } from "zod";
   
   const EventSchema = z.object({
     eventType: z.string(),
     payload: z.record(z.any()),
   });
   ```
