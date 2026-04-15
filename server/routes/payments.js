const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

router.post('/create-checkout-session', async (req, res) => {
  const { user_id, email } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price_data: { currency: 'usd', product_data: { name: 'SantaBoot Premium', description: 'PCs ilimitados' }, unit_amount: 299, recurring: { interval: 'month' } }, quantity: 1 }],
      success_url: `${process.env.SITE_URL}/dashboard.html?success=true`,
      cancel_url: `${process.env.SITE_URL}/dashboard.html?canceled=true`,
      metadata: { user_id }
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
      await supabase.from('profiles').update({ plan: 'premium' }).eq('id', event.data.object.metadata.user_id);
    }
    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

module.exports = router;