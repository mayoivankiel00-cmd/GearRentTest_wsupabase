# GearRent — connected to Supabase

This project now talks to a real Postgres database via [Supabase](https://supabase.com) instead of `localStorage`. Setup:

1. **Create the schema.** In your Supabase project's SQL Editor, run these two files in order (from the chat where this project was generated):
   - `gearrent_supabase_schema.sql` — tables, RLS policies, auth trigger
   - `gearrent_supabase_schema_part2_seed.sql` — fixes id column types to match the app's slug-style ids, adds profile columns (`email`, `phone`, `address`, ...), adds the `credit_user_balance` RPC, and seeds categories/products/membership tiers from the original `mockData.js`
2. **Copy `.env.example` to `.env`** and fill in `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from Project Settings → API.
3. **Run `gearrent_supabase_storage_setup.sql`** to create the `gear-images` Storage bucket and its RLS policies — this is required for the drag & drop photo uploader in Admin → Add Equipment and Provider Gear to work.
4. **Turn off "Confirm email"** in Authentication → Settings (or leave it on and handle the "check your email" step — the app already shows a message for this, but sign-up won't auto-log-in until the email is confirmed).
5. `npm install && npm run dev`.

### What changed
- `AuthContext`, `CartContext`, `ProviderContext`, `NotificationContext` now read/write Supabase instead of `localStorage`/`sessionStorage`. Their exposed function names are unchanged, but mutating calls (`authenticate`, `createAccount`, `addItem`, `returnRental`, etc.) are now `async` — callers that branch on the return value use `await`; the rest fire-and-forget, same as before.
- Passwords are handled entirely by Supabase Auth now — nothing is stored or compared in plaintext.
- `src/mockData.js` is still imported for `categories`, `membershipTiers`, and `calculateSecurityDeposit` (pure helper) — the actual product and category *rows* now come from the database, seeded from this same file.

### Known limitations (carried over from the migration report)
- Checkout pricing (`rentalAmount`, `securityDeposit`, refund math) is still computed client-side and trusted on insert. For production, move this into a `security definer` Postgres function so a modified client can't submit an arbitrary price.
- The admin dashboard has no real admin login — any signed-in user can reach `/admin/*` routes, same as before. Admin notifications, however, now require `profiles.role = 'admin'` under RLS; set that manually on your own account in the Supabase table editor to see them.
- ~~Provider-uploaded photos are stored as base64 data URLs~~ — fixed. Both Admin → Add Equipment and Provider Gear now use a shared drag & drop uploader (`src/components/ImageDropzone.jsx`) that uploads files straight to the `gear-images` Supabase Storage bucket and stores the resulting public URLs in the `images` column. Run `gearrent_supabase_storage_setup.sql` to create the bucket before using these forms.

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
