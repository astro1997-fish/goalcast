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
