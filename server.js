import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import Stripe from 'stripe';
import { requireAuth } from './lib/auth.js';
import { upsertUser, getUser, updateUser, updateUserByEmail } from './lib/db.js';
import { PROMPT } from './lib/prompt.js';

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

// Stripe webhook needs raw body — must come before express.json()
app.use('/billing/webhook', express.raw({ type: 'application/json' }));

app.use(cors({ origin: process.env.APP_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '20mb' }));

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── AUTH ─────────────────────────────────────

app.get('/auth/me', requireAuth, async (req, res) => {
  // upsertUser creates the record on first Google sign-in, no-ops on subsequent calls
  const user = await upsertUser(req.user.userId, req.user.email);
  return res.json({
    email: user.email,
    subscriptionStatus: user.subscription_status,
    freeScansUsed: user.free_scans_used,
  });
});

// ── BILLING ──────────────────────────────────

app.post('/billing/checkout', requireAuth, async (req, res) => {
  const user = await getUser(req.user.userId);
  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await updateUser(user.id, { stripe_customer_id: customerId });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${appUrl}?payment=success`,
    cancel_url: `${appUrl}`,
  });

  return res.json({ url: session.url });
});

app.post('/billing/portal', requireAuth, async (req, res) => {
  const user = await getUser(req.user.userId);
  if (!user.stripe_customer_id) {
    return res.status(400).json({ error: 'No subscription found' });
  }

  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: appUrl,
  });

  return res.json({ url: session.url });
});

app.post('/billing/webhook', async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const customerEmail = async (customerId) => {
    const c = await stripe.customers.retrieve(customerId);
    return c.email;
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      if (s.mode === 'subscription') {
        const email = await customerEmail(s.customer);
        await updateUserByEmail(email, {
          subscription_status: 'active',
          subscription_id: s.subscription,
          stripe_customer_id: s.customer,
        });
      }
      break;
    }
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused': {
      const email = await customerEmail(event.data.object.customer);
      await updateUserByEmail(email, { subscription_status: 'inactive' });
      break;
    }
    case 'invoice.payment_failed': {
      const email = await customerEmail(event.data.object.customer);
      await updateUserByEmail(email, { subscription_status: 'past_due' });
      break;
    }
  }

  return res.json({ received: true });
});

// ── ANALYZE ──────────────────────────────────

app.post('/analyze', requireAuth, async (req, res) => {
  const { base64, mimeType } = req.body;
  if (!base64 || !mimeType) return res.status(400).json({ error: 'Missing image data' });

  const user = await getUser(req.user.userId);
  const isSubscribed = user.subscription_status === 'active';

  if (!isSubscribed && user.free_scans_used >= 3) {
    return res.status(402).json({ error: 'Free scan limit reached', paymentRequired: true });
  }

  if (!isSubscribed) {
    await updateUser(user.id, { free_scans_used: user.free_scans_used + 1 });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });

    const text = response.choices[0].message.content.trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Unexpected AI response format');

    return res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('[analyze error]', err.message);
    return res.status(500).json({ error: err.message || 'Identification failed' });
  }
});

// Only start listening when running directly (not imported by Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`✦ HallmarkIQ server → http://localhost:${PORT}`));
}

export default app;
