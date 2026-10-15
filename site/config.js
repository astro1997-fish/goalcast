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

/* Premium plans shown on the Premium page. Change an amount here and it updates everywhere.
   "id" is what you type when switching a member's plan on (see content/README.md).
   "amounts" are the prices: NGN is shown to members in Nigeria, USD to everyone else. */
window.GOALCAST_PLANS = [
  { id: 'weekly', name: 'Weekly', per: 'week', amounts: { USD: 4.99, NGN: 2500 }, note: 'Short-term access, no commitment.' },
  { id: 'monthly', name: 'Monthly', per: 'month', amounts: { USD: 14.99, NGN: 7500 }, badge: '⭐ Most popular' },
  { id: 'yearly', name: 'Yearly', per: 'year', amounts: { USD: 119.99, NGN: 60000 }, badge: '🔥 Best value' },
];

/* Ways to pay. Each one appears in the payment window as soon as it is filled in:
     - card and bank methods need a payment link per plan in "links" (from Paystack, Flutterwave, etc.)
     - crypto needs a wallet "address"
   "only" / "except" choose the countries a method is offered in (two-letter country codes), and "currency"
   is what it charges in, using the plan amounts above. While nothing is filled in for a member's country,
   they are asked to message you instead. */
window.GOALCAST_PAYMENTS = [
  { id: 'naira', icon: '₦', label: 'Pay in Naira', sub: 'Card, bank transfer or USSD, through Paystack', currency: 'NGN', only: ['NG'],
    links: { weekly: '', monthly: '', yearly: '' } },
  { id: 'card', icon: '💳', label: 'Pay by card', sub: 'Visa or Mastercard, charged in US dollars', currency: 'USD', except: ['NG'],
    links: { weekly: '', monthly: '', yearly: '' } },
  { id: 'crypto', icon: '🪙', label: 'Pay with crypto', sub: 'USDT on the Tron network (TRC20)', currency: 'USDT', network: 'Tron (TRC20)',
    address: 'TSj8RfoFZsz5oj3kjnwGW62HeXXfVL6i83' },
];
