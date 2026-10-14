/* Account sign-in settings.
   Create a free project at https://supabase.com, then copy two values from
   Project Settings -> API. Both are safe to publish: the "publishable" (or "anon") key
   is the public browser key. Never put a "secret" or "service_role" key here. */
window.GOALCAST_CONFIG = {
  supabaseUrl: 'https://rutiffsubtqqgrotwava.supabase.co',
  supabaseAnonKey: 'sb_publishable_KCqkjXTta39rfMKgfsUoUg_Ey5bXFtE',
  /* Neon Data API address for members-only content (Neon console -> Data API). Safe to publish:
     the database only answers accounts with an active plan. */
  neonDataApi: 'https://ep-fancy-snow-b9vpwv3d.apirest.c-7.eu-central-1.aws.neon.tech/neondb/rest/v1',
};

/* Social and support links shown in the footer.
   Fill in a username, a phone number or a full link; anything left empty shows as "coming soon".
     x:               your X handle, e.g. 'goalcast' (or a full https://x.com/... link)
     telegramChannel: your Telegram channel, e.g. 'goalcast_tips'
     whatsapp:        support phone number with country code, digits only, e.g. '2348012345678'
     telegramSupport: the Telegram account that answers support messages, e.g. 'goalcast_help' */
window.GOALCAST_LINKS = {
  x: 'ferry5689',
  telegramChannel: 'https://t.me/+8mYGBw3OhN5hZGY0',
  whatsapp: '19715162270',
  telegramSupport: 'Goal_castpredict',
};

/* Visitor counting with Cloudflare Web Analytics (free, no cookies).
   Paste the token from Cloudflare -> Web Analytics -> your site -> "Manage site" -> JS snippet.
   Leave empty to switch counting off. */
window.GOALCAST_ANALYTICS = {
  cloudflareToken: '33500c2d87a04aaa8e8c79ed8da33c0e',
};

/* Home page banner picture (optional).
   Leave empty to show the built-in graphic. To use your own picture, upload it to site/assets/
   and put its path here, e.g. 'assets/hero.jpg'. Only use pictures you have the rights to:
   photos of real players and club badges need a licence. */
window.GOALCAST_HOME = {
  heroImage: 'assets/hero.webp',
};

/* Premium plans shown on the Premium page. Change a price or note here and it updates everywhere.
   "id" is what you type when switching a member's plan on (see content/README.md). */
window.GOALCAST_PLANS = [
  { id: 'weekly', name: 'Weekly', price: '£9.99', per: 'week', note: 'Short-term access, no commitment.' },
  { id: 'monthly', name: 'Monthly', price: '£29.99', per: 'month', note: 'Works out at £6.92 a week.', badge: '⭐ Most popular' },
  { id: 'yearly', name: 'Yearly', price: '£249.99', per: 'year', note: 'Works out at £20.83 a month. Save 30%.', badge: '🔥 Best value' },
];

/* Ways to pay. Each one appears in the payment window as soon as it is filled in:
     - card and bank methods need a payment link per plan in "links" (from Paystack, Flutterwave, etc.)
     - crypto needs a wallet "address"
   "prices" is what that method charges for each plan, in its own currency; leave a price empty to show
   the plan's main price. While nothing is filled in, members are asked to message you instead.
   If only one card method is filled in, choosing a plan goes straight to its payment page. */
window.GOALCAST_PAYMENTS = [
  { id: 'naira', icon: '₦', label: 'Pay in Naira', sub: 'Card, bank transfer or USSD, through Paystack',
    prices: { weekly: '', monthly: '', yearly: '' }, links: { weekly: '', monthly: '', yearly: '' } },
  { id: 'card', icon: '💳', label: 'Pay by card', sub: 'Visa or Mastercard, from any country',
    prices: { weekly: '', monthly: '', yearly: '' }, links: { weekly: '', monthly: '', yearly: '' } },
  { id: 'crypto', icon: '🪙', label: 'Pay with crypto', sub: 'USDT on the Tron network (TRC20)', asset: 'USDT', network: 'Tron (TRC20)',
    address: '', prices: { weekly: '', monthly: '', yearly: '' } },
];
