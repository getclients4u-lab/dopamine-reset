// Vercel serverless webhook for Stripe payment events (dopamine-reset)
// ESM only. bodyParser:false REQUIRED (Vercel's JSON parsing breaks Stripe HMAC).
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const WH_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_OWNER = process.env.GH_OWNER || 'getclients4u-lab';
const GH_REPO = process.env.GH_REPO || 'dopamine-reset';
const MAIL_FROM = process.env.DOPAMINE_MAIL_FROM || 'gentledesk632@agentmail.to';
const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY || '';

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function ghGet(path) {
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/${path}`, {
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github+json' }
  });
  if (!r.ok) return null;
  return r.json();
}

async function ghPut(path, body, sha) {
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `buyer: ${body.customer_email || 'unknown'}`, content: Buffer.from(JSON.stringify(body.data, null, 2)).toString('base64'), sha })
  });
  return r.ok;
}

async function sendConfirmation(email, name) {
  if (!AGENTMAIL_KEY) return { ok: false, why: 'no agentmail key' };
  // ensure allow-listed first
  try {
    await fetch('https://api.agentmail.to/v0/lists/send/allow', {
      method: 'POST',
      headers: { Authorization: `Bearer ${AGENTMAIL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: email })
    });
  } catch (e) {}
  const body = {
    to: email,
    from: MAIL_FROM,
    subject: 'Your 7-Day Dopamine Reset — access inside ✅',
    text: `Hi ${name || 'there'},

Thank you! Your order for The 7-Day Dopamine Reset is confirmed.

DOWNLOAD YOUR RESET:
→ https://dopamine-reset-theta.vercel.app/download

WHAT'S INSIDE:
• The 7-Day Reset Guide (STOP Framework)
• The App Graveyard Setup
• The Trigger Map worksheet
• Replacement Loop Library (25 swaps)
• Focus Block Planner
• 7 Daily Audio Cues

START TODAY:
1. Build your App Graveyard tonight (Day 1)
2. Print your Trigger Map
3. Day 2: map your hijackers

30-day money-back guarantee — if it doesn't work, full refund, keep the guides.

Your brain will thank you in 7 days.
— The Dopamine Reset Team`
  };
  const r = await fetch('https://api.agentmail.to/v0/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${AGENTMAIL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { ok: r.ok, status: r.status };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const raw = await readRaw(req);
  const sig = req.headers['stripe-signature'] || '';
  let event;
  try {
    event = JSON.parse(raw);
  } catch (e) {
    return res.status(400).json({ error: 'bad json' });
  }
  // HMAC verify (Stripe v2 style timestamped)
  try {
    const parts = sig.split(',');
    const tsPart = parts.find(p => p.startsWith('t='));
    const v1Part = parts.find(p => p.startsWith('v1='));
    if (!tsPart || !v1Part) throw new Error('bad sig format');
    const t = tsPart.slice(2);
    const expected = crypto.createHmac('sha256', WH_SECRET).update(`${t}.${raw}`).digest('hex');
    if (expected !== v1Part.slice(3)) throw new Error('sig mismatch');
  } catch (e) {
    return res.status(400).json({ error: 'invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const email = s.customer_details?.email || s.customer_email || '';
    const name = s.customer_details?.name || '';
    const amount = (s.amount_total || 0) / 100;
    const buyer = {
      id: s.id, email, name, amount, currency: s.currency || 'usd',
      product: 'dopamine-reset', ts: new Date().toISOString()
    };
    // store to buyers.json (append)
    let data = { buyers: [] };
    const existing = await ghGet('buyers.json');
    if (existing) {
      try { data = JSON.parse(Buffer.from(existing.content, 'base64').toString()); } catch (e) {}
    }
    if (!Array.isArray(data.buyers)) data.buyers = [];
    data.buyers.push(buyer);
    const saved = await ghPut('buyers.json', { data, customer_email: email }, existing?.sha);
    const mail = await sendConfirmation(email, name);
    return res.status(200).json({ received: true, stored: saved ? 1 : 0, emailed: mail.ok });
  }
  return res.status(200).json({ received: true, ignored: event.type });
}
