# Writing for the site

Everything in this folder is published automatically a few minutes after you
save it on GitHub. No coding needed.

## Write a blog post

1. On GitHub, open `content/blog` and choose **Add file → Create new file**.
2. Name it with lowercase words and dashes, ending in `.md`, for example
   `arsenal-v-leeds-preview.md`. The name becomes the article's address.
3. Copy the contents of `_template.md`, change the settings at the top, and
   write your article underneath.
4. Press **Commit changes**. The article appears on the Blog page within about
   five minutes.

Settings at the top of each post:

| Setting | What it does |
| --- | --- |
| `title` | The headline (required) |
| `date` | Publication date, like `2026-10-09` (required). A future date keeps the post hidden until that day |
| `summary` | Short description shown in the article list |
| `author` | Name shown under the headline |
| `tags` | Topics, separated by commas |
| `image` | Optional cover picture, for example `assets/blog/cover.jpg` |
| `draft` | `true` hides the post; remove the line or set `false` to publish |

To edit a post, open its file on GitHub and press the pencil icon. To remove
one, delete the file.

### Linking to pages on the site

Write the link text in square brackets and a shortcut in round brackets.

| To link to | Write | Options |
| --- | --- | --- |
| A league page | `[Premier League](league:E0)` | `E0` Premier League, `E1` Championship, `E2` League One, `E3` League Two, `SC0` Scottish Premiership, `D1` Bundesliga, `D2` 2. Bundesliga, `I1` Serie A, `I2` Serie B, `SP1` La Liga, `SP2` La Liga 2, `F1` Ligue 1, `F2` Ligue 2, `N1` Eredivisie, `B1` Belgian Pro League, `P1` Primeira Liga, `T1` Süper Lig, `G1` Greek Super League |
| A market page | `[BTTS tips](market:btts)` | `1x2`, `double-chance`, `over-1-5`, `over-2-5`, `under-3-5`, `btts`, `correct-score` |
| A main page | `[our results](page:results)` | `home`, `safe`, `value`, `results`, `model`, `leagues`, `premium`, `blog` |
| Another article | `[read this](post:how-to-read-a-prediction)` | the other article's file name without `.md` |

A mistyped shortcut is left as plain text and listed as a warning in the
build log (GitHub → Actions).

### Pictures

Upload pictures to `site/assets/blog/` and refer to them as
`![description](assets/blog/file-name.jpg)`.

## Premium members

Plans and prices are set in `site/config.js` under `GOALCAST_PLANS`.

### Prices and taking payments

Plan prices are in `site/config.js` under `GOALCAST_PLANS`, as `amounts`: `NGN` is shown to members in Nigeria and
`USD` to everyone else. Members choose their country when they sign up and can change it in the payment window.

Ways to pay are under `GOALCAST_PAYMENTS`:

- **Paystack (Nigeria):** create a payment page for each plan at the Naira amount and paste the three links into the
  `naira` method's `links`.
- **International card:** create a payment link for each plan at the dollar amount and paste them into the `card`
  method's `links`.
- **Crypto (everyone):** paste your USDT wallet address on the Tron (TRC20) network into the `crypto` method's
  `address`. Members are shown the dollar amount in USDT.

A method appears in the payment window as soon as it is filled in. Set each payment link to send people back to
`https://astro1997-fish.github.io/goalcast/premium/?paid=1` after paying.

### Automatic Paystack payments

Members pay in a Paystack window on the site, and Premium switches on by itself when Paystack confirms the payment.

1. **Back end (once):** in Supabase open **Edge Functions**, create a function named `paystack-webhook`, paste the
   contents of `supabase/functions/paystack-webhook/index.ts` and deploy it. In the function's settings turn **Verify
   JWT** off. Under **Edge Functions -> Secrets** add `PAYSTACK_SECRET_KEY` with your Paystack **secret** key.
2. **Paystack:** under **Settings -> API Keys & Webhooks**, set the webhook URL to
   `https://szoowwutahefnjnsevkc.supabase.co/functions/v1/paystack-webhook`.
3. **Site:** put your Paystack **public** key in `site/config.js` under `GOALCAST_PAYSTACK.publicKey`.

Do it all with Paystack's test keys first (`pk_test_` / `sk_test_`), pay with a Paystack test card, and check Premium
switches on. Then swap both keys for the live ones. If you change a price, change it in `site/config.js` and in
the `PLANS` list at the top of the function: a payment that does not match the function's price is ignored.

### One-time setup for special picks (Neon database)

Special picks are kept in a Neon database table that only paying members can read. Sign-in stays with Supabase;
Neon is told to trust those sign-ins.

1. In the Neon console, create a project, then open **Data API** and enable it.
   - Authentication provider: **Other provider**
   - JWKS URL: `https://szoowwutahefnjnsevkc.supabase.co/auth/v1/.well-known/jwks.json`
   - JWT audience: `authenticated`
2. Copy the Data API address it shows and put it in `site/config.js` as `neonDataApi`.
3. In the Neon console, press **Connect** and copy the connection string. In GitHub, open the repository's
   **Settings -> Secrets and variables -> Actions**, press **New repository secret**, name it `DATABASE_URL` and paste
   the connection string. It contains the database password: never put it anywhere else.

The automatic update creates the table and its access rule by itself on its next run.

### Switching a member's plan on

When someone has paid, switch Premium on for their account in Supabase:

1. Open your Supabase project and go to **SQL Editor**.
2. Paste the line below, change the email, the plan (`weekly`, `monthly` or `yearly`) and the last day of access, then press **Run**.

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"plan": "monthly", "plan_until": "2026-11-13"}'
where email = 'member@example.com';
```

The member then signs out and in again, or presses **Refresh my access** on the Premium page. Access ends by itself
after the `plan_until` date. To end it early, run the same line with `"plan": ""`.

## Terms, privacy and other pages

The terms of use, privacy policy and responsible gambling page are in `content/pages`, written the same way as blog
posts. Edit a file on GitHub to change its wording and update the `updated` date at the top.

## Site address

`content/site.json` holds the site's public address. It is used for the sitemap and for the links search engines and
social networks see. Change it when the site moves to its own domain.

## Sponsors and adverts

Edit `content/sponsors.json`. Each sponsor is one block:

```json
{
  "name": "Sponsor name",
  "active": true,
  "url": "https://sponsor.example/?utm_source=goalcast",
  "headline": "The bold line of the advert",
  "text": "One short supporting line.",
  "cta": "Button text",
  "image": "assets/sponsors/banner.png",
  "placements": ["banner", "feed", "article"],
  "start": "2026-10-09",
  "end": "2026-11-09"
}
```

| Setting | What it does |
| --- | --- |
| `active` | `false` switches the advert off without deleting it |
| `url` | Where a click goes. Must start with `https://`. Add `?utm_source=goalcast` so the sponsor can count clicks |
| `image` | Optional. Upload it to `site/assets/sponsors/`. Leave empty for a text advert |
| `placements` | Where it shows: `banner` (top of every page), `feed` (among the match cards), `article` (end of blog posts) |
| `start`, `end` | Optional. The advert runs only between these dates, inclusive |

Separate several sponsors with commas; when more than one is booked for the
same place they take turns. Every advert is labelled "Sponsored".

Set `advertise.email` to your contact address to show an "Advertise here"
notice in any place that has no sponsor booked. Leave it empty to show nothing.
