// Local automation bridge. Binds to 127.0.0.1 ONLY — it is never exposed to the
// network and is meant to be reached solely by the frontend running on your own
// machine. It triggers the Playwright sign-in/scrape and returns the result.
//
// Run: npm run server   (then click "Sync Now" in the local frontend)

import express from 'express';
import cors from 'cors';
import { scrapePrivateApplications } from './scripts/patent-center.js';
import { searchTrademarks } from './scripts/trademark-search.js';

const PORT = process.env.PORT || 8787;
const app = express();

app.use(express.json());
// Allow the local Vite dev server (localhost:5173) to call us.
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ],
  })
);

let running = false;

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/sync', async (_req, res) => {
  if (running)
    return res.status(409).json({ error: 'A sync is already in progress.' });
  running = true;
  try {
    const patents = await scrapePrivateApplications({
      onStatus: (m) => console.log('[sync]', m),
    });
    res.json({ patents });
  } catch (e) {
    console.error('[sync] failed:', e);
    res.status(500).json({ error: e.message });
  } finally {
    running = false;
  }
});

app.get('/trademarks', async (req, res) => {
  const owner = (req.query.owner || '').toString().trim();
  if (!owner) return res.status(400).json({ error: 'owner query parameter is required.' });
  if (running) return res.status(409).json({ error: 'A browser task is already in progress.' });
  running = true;
  try {
    const trademarks = await searchTrademarks({
      owner,
      onStatus: (m) => console.log('[trademarks]', m),
    });
    res.json({ trademarks });
  } catch (e) {
    console.error('[trademarks] failed:', e);
    res.status(500).json({ error: e.message });
  } finally {
    running = false;
  }
});

app.listen(PORT, '127.0.0.1', () =>
  console.log(`USPTO local bridge listening on http://127.0.0.1:${PORT}`)
);
