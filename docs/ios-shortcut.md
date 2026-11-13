# Saving links from iPhone (Apple Shortcut)

Open the web app's **Connect** page and pick **iPhone / iPad**. The guide there creates the
device, prefills every value from your deploy and turns to **Connected ✓** when the first link
arrives. This page is the reference behind it.

## The two-action Shortcut (no token)

1. In **Shortcuts**, create a shortcut and turn on **Show in Share Sheet** (in **ⓘ**). Accept
   **URLs** and **Safari web pages**.
2. **Receive URLs from Share Sheet** (the first block).
3. **Open URL** with `https://<stash>/save?device=<device id>&url=` followed by the **Shortcut
   Input** variable.

Sharing a page opens `/save` in Safari. Safari is signed in to Stash, so the page saves the link
with that session and shows **Saved ✓ <title>** with a **Back** button. If Safari is signed out,
`/save` goes through the login page and comes back. `device` attributes the save to this iPhone,
which is how the Connect page sees it arrive.

`/save` takes `url` as the last parameter and reads the rest of the address as the link, so a raw,
unencoded URL (what Shortcuts inserts) stays whole, `?` and `&` included. A percent-encoded `url`
works too. Optional parameters go before it: `title=<title>` and `device=<id>`.

## Bookmarklet (any browser)

The guide also offers the same `/save` link as a bookmarklet:

```js
javascript:(()=>{location.href="https://<stash>/save?title="+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)})()
```

## Advanced: save without opening Safari

The guide's **Advanced** disclosure creates a device token and prefills the values. The Shortcut
posts to the api directly:

1. **Get URLs from Input** (Shortcut Input), then **Get Item from List** (First Item).
2. **Text**: `Bearer <token>`.
3. **Get Contents of URL**: `https://<stash>/api/links`, method `POST`, header
   `Authorization` = the **Text** variable, request body `JSON` with a **Text** field `url` = the
   item from step 1.
4. **Get Dictionary Value** `id` of **Contents of URL**, then **If** it has any value, **Show
   Notification** `Saved to Stash`. Otherwise show **Contents of URL**, which is the error.

The api is same-origin under `/api` of the web app. `POST /api/links` takes `SaveLinkInput`
(`packages/contracts/domain/src/link.ts`) and answers `201` with the link, `401` for a missing or
revoked token, `429` when rate limited, and `400` for a URL that isn't http(s).

The token is stored in the shortcut in plain text. Don't share the shortcut, and revoke the
device's token in **Settings → API tokens** if the phone is lost.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/save` says **Nothing to save** | The Open URL action must end in `url=` followed by **Shortcut Input** |
| `/save` asks to sign in every time | Safari blocks the cookie, for example in Private Browsing. Sign in in a normal tab |
| **Too many saves** | Wait a minute and share again |
| Advanced: `"_tag": "Unauthorized"` | The **Text** action must be `Bearer`, one space, the token. Create a new token if it was revoked |
