# Dual domain + peachyhabanero mail

GitHub Pages has **one** custom domain: `peachyhabanero.com` (`CNAME` in
the repo). Do not add `jakevestal.com` there. Cloudflare aliases it.

```
jakevestal.com  ── Worker ──┐
www.jakevestal.com ─────────┤
                            ├── https://peachyhabanero.com/{path}
peachyhabanero.com ─ DNS ───┤
www.peachyhabanero.com ─────┘
                            GitHub Pages
```

`/{whatever}.html` is the same file on both hosts. The address bar
keeps whichever host the reader typed.

## 1. peachyhabanero.com (already live — only check)

Zone: **peachyhabanero.com**. Proxy **orange**. SSL/TLS: **Full (strict)**.

Typical GitHub Pages records (leave as they are if HTTPS already works):

| Type  | Name | Content                                      |
|-------|------|----------------------------------------------|
| A     | `@`  | `185.199.108.153` (and .109 / .110 / .111)   |
| AAAA  | `@`  | `2606:50c0:8000::153` (and 8001–8003)        |
| CNAME | `www`| `jakevestal.github.io`                       |

Also: `www.peachyhabanero.com` → apex, if you want that redirect
(Redirect Rule, 301).

## 2. jakevestal.com alias (Worker)

Zone: **jakevestal.com**.

### DNS (placeholder IPs; the Worker is the origin)

| Type  | Name | Content     | Proxy        |
|-------|------|-------------|--------------|
| A     | `@`  | `192.0.2.1` | Proxied (orange) |
| A     | `www`| `192.0.2.1` | Proxied (orange) |

`192.0.2.1` is documentation-only. Orange cloud means Cloudflare
terminates TLS and the Worker runs. Do **not** CNAME this zone at
`peachyhabanero.com` (Error 1014 if both are Cloudflare).

### Worker

1. Workers & Pages → Create → **alias-peachyhabanero**
2. Paste `alias-worker.js`
3. Deploy
4. Settings → Domains & Routes → Add route:
   - `jakevestal.com/*`  (zone jakevestal.com)
   - `www.jakevestal.com/*`
5. SSL/TLS on **jakevestal.com**: Full (strict) is fine; the Worker
   fetches `https://peachyhabanero.com`.

Check:

- `https://peachyhabanero.com/sustainability.html`
- `https://jakevestal.com/sustainability.html`
- same for `www.`

Both should 200 with the same HTML. Address bar stays on the host
you typed.

## 3. peachyhabanero.com email (Email Routing)

Use a mailbox you will not lose (personal Gmail/iCloud — **not** Duke,
unless you like forwarding later).

On the **peachyhabanero.com** zone:

1. Email → Email Routing → **Get started**
2. Destination address: your personal inbox. Confirm the email CF sends.
3. Custom addresses (start with one):
   - `hello@peachyhabanero.com` → that destination
   - later: `jake@peachyhabanero.com` if you want it
4. Cloudflare will add MX + TXT. Do not point MX anywhere else.
5. Send a test from a third account. Reply goes from Gmail unless you
   later set up a send-as (Google “Send mail as” + CF SPF/DKIM, or
   Cloudflare + a sending provider). **Receiving** is enough for a
   byline. Sending as `@peachyhabanero.com` is a second sitting.

Optional, same pattern on **jakevestal.com**:
`hello@jakevestal.com` → same destination. Two brands, one inbox.

SPF (Email Routing usually writes this):

```
v=spf1 include:_spf.mx.cloudflare.net ~all
```

## 4. What not to do

- Do not put two names in the repo `CNAME`. GitHub will 301 everything
  to the last one.
- Do not CNAME jakevestal.com → peachyhabanero.com while both are
  orange-clouded (1014).
- Do not change GitHub Pages custom domain to jakevestal.com unless
  you want peachyhabanero.com to *stop* being the origin.

## 5. Canonical (later, when the article ships)

One public URL for search engines. Suggested: keep
`https://peachyhabanero.com/...` as canonical on the notebook (it is
the origin). jakevestal.com is the professional alias. A
`<link rel="canonical">` per page can wait until the House article
is out of draft.
