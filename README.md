# berri (work in progress)

Static site files for berri. The app and its bundled scripts, styles, fonts, and images are in `b/`.

## Open the site

Run the site directly from jsDelivr using the SVG entry point:

https://cdn.jsdelivr.net/gh/BombedByXander/svg@latest/index.svg

The SVG entry starts the signed loader and app. The app uses external network services for some features.

## Supabase accounts

Run [`supabase/berri-accounts.sql`](supabase/berri-accounts.sql) in the new project SQL Editor. Keep the Email provider enabled and turn **Confirm email** off so username/password registration can create a session without sending mail. The account UI maps usernames to private synthetic Auth emails; an optional real email is stored privately as the recovery contact.


GitHub pushes to main automatically sync the `latest` branch, publish the next patch tag, and retry jsDelivr alias purges if they are rate-limited. Use the stable `@latest` link above; it keeps the same URL after updates.
