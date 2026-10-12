/* Account sign-in settings.
   Create a free project at https://supabase.com, then copy two values from
   Project Settings -> API. Both are safe to publish: the "publishable" (or "anon") key
   is the public browser key. Never put a "secret" or "service_role" key here. */
window.GOALCAST_CONFIG = {
  supabaseUrl: 'https://rutiffsubtqqgrotwava.supabase.co',
  supabaseAnonKey: 'sb_publishable_KCqkjXTta39rfMKgfsUoUg_Ey5bXFtE',
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
