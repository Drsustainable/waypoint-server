const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const DATA_FILE = path.join(__dirname, 'data', 'trips.json');

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Data storage (simple JSON file) ──────────────────────────────────────────
function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

function readTrips() {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeTrips(trips) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(trips, null, 2));
}

// ── Claude parser ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a travel booking parser. Given text from booking confirmations (emails, PDFs, or any format), extract all travel segments and return ONLY valid JSON — no markdown, no preamble.

Return:
{
  "tripName": "short name from destinations e.g. 'Newcastle / Seville'",
  "segments": [
    {
      "id": "seg-<unique number>",
      "type": "flight|train|hotel|car_hire|ferry|taxi|meeting|activity|bus",
      "title": "short label e.g. 'NCL → AMS'",
      "confirmationRef": "booking reference or null",
      "provider": "airline/hotel/operator or null",
      "startDateTime": "ISO 8601 datetime",
      "endDateTime": "ISO 8601 datetime or null",
      "fromLocation": "departure for transport or null",
      "toLocation": "arrival for transport or null",
      "location": "address/city for hotel/meeting or null",
      "notes": "seat, class, baggage, special instructions"
    }
  ]
}

Rules:
- Create one segment per flight leg, hotel stay, car hire period
- Use year 2026 if no year mentioned
- Never invent information not in the text`;

async function parseWithClaude(text) {
  const apiKey = CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set on server');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Parse this booking:\n\n${text}` }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Claude API error ${response.status}: ${err.error?.message || 'unknown'}`);
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text || '';
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  parsed.segments = (parsed.segments || []).map((s, i) => ({
    ...s,
    id: s.id || `seg-${Date.now()}-${i}`,
  }));
  return parsed;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, trips: readTrips().length, time: new Date().toISOString() });
});

// GET all trips
app.get('/trips', (req, res) => {
  res.json(readTrips());
});

// GET single trip
app.get('/trips/:id', (req, res) => {
  const trip = readTrips().find(t => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: 'Not found' });
  res.json(trip);
});

// POST create trip
app.post('/trips', (req, res) => {
  const trips = readTrips();
  const trip = {
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    ...req.body,
  };
  trips.push(trip);
  writeTrips(trips);
  res.status(201).json(trip);
});

// PUT update trip
app.put('/trips/:id', (req, res) => {
  const trips = readTrips();
  const idx = trips.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  trips[idx] = { ...trips[idx], ...req.body, id: req.params.id };
  writeTrips(trips);
  res.json(trips[idx]);
});

// DELETE trip
app.delete('/trips/:id', (req, res) => {
  const trips = readTrips();
  const filtered = trips.filter(t => t.id !== req.params.id);
  if (filtered.length === trips.length) return res.status(404).json({ error: 'Not found' });
  writeTrips(filtered);
  res.json({ ok: true });
});

// POST add segments to existing trip
app.post('/trips/:id/segments', (req, res) => {
  const trips = readTrips();
  const idx = trips.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  trips[idx].segments = [...(trips[idx].segments || []), ...req.body.segments];
  writeTrips(trips);
  res.json(trips[idx]);
});

// DELETE segment from trip
app.delete('/trips/:id/segments/:segId', (req, res) => {
  const trips = readTrips();
  const idx = trips.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  trips[idx].segments = trips[idx].segments.filter(s => s.id !== req.params.segId);
  writeTrips(trips);
  res.json(trips[idx]);
});

// POST parse text with Claude
app.post('/parse', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  try {
    const result = await parseWithClaude(text);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST parse base64 PDF with Claude
app.post('/parse-pdf', async (req, res) => {
  const { base64, filename } = req.body;
  if (!base64) return res.status(400).json({ error: 'No PDF data provided' });

  try {
    // Use Claude's document understanding directly
    const apiKey = CLAUDE_API_KEY;
    if (!apiKey) throw new Error('CLAUDE_API_KEY not set on server');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            { type: 'text', text: 'Parse all travel bookings from this document.' },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Claude API error ${response.status}: ${err.error?.message || 'unknown'}`);
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    parsed.segments = (parsed.segments || []).map((s, i) => ({
      ...s,
      id: s.id || `seg-${Date.now()}-${i}`,
    }));
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Waypoint server running on port ${PORT}`);
  console.log(`CLAUDE_API_KEY: ${CLAUDE_API_KEY ? 'set ✓' : 'MISSING ✗'}`);
});
