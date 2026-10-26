# Saving links from iPhone (Apple Shortcut)

On iPhone and iPad, an Apple Shortcut in the share sheet saves the current page to Stash. It sends
one `POST /links` request to the api with the device's API token, then shows a notification with
the result. This page covers the device token, building the shortcut step by step, and what to
check when a save fails.

The api origin is written as:

```text
https://<your-api>.workers.dev
```

`<your-api>.workers.dev` stands for the host of the `Api` Worker. `alchemy deploy` prints it as
`url` (see [alchemy.md](alchemy.md)). The api serves its routes at the root, so the save endpoint
is `https://<your-api>.workers.dev/links`.

## The request

The shortcut sends exactly what the `links.save` endpoint in `packages/contracts/api`
(`links-group.ts`) expects. The body is `SaveLinkInput` from `packages/contracts/domain`
(`link.ts`).

```http
POST /links HTTP/1.1
Host: <your-api>.workers.dev
Authorization: Bearer <token>
Content-Type: application/json

{"url": "https://example.com/some/article"}
```

| Field | Required | Rule |
|---|---|---|
| `url` | yes | An absolute `http` or `https` URL with no whitespace |
| `title` | no | 1 to 1000 characters. Leave the key out rather than send an empty string |
| `tags` | no | An array of tag names: lowercase, trimmed, 1 to 64 characters each |

Leave out `title` and `tags` unless you want to set them. Enrichment adds the title, type, summary
and tags in the background. The source device is not part of the body: the api takes it from the
token.

| Status | Body | Meaning |
|---|---|---|
| `201` | the saved `Link` (`id`, `url`, `title`, `status`, ...) | Saved. A URL whose canonical form is already stored returns the existing link, also `201` |
| `400` | an error object | The body failed validation, usually a URL that is not `http(s)` |
| `401` | `{"_tag": "Unauthorized", "message": "..."}` | The token is missing, wrong or revoked |
| `429` | `{"_tag": "RateLimited", "retryAfterSeconds": <n>}` | Too many saves from this device in the current window |

A successful response always has an `id`, and an error response never does. The shortcut uses
that to tell the two apart.

## 1. Create a device token

Each device has its own API token. Only the token's hash is stored, and you can revoke it on its
own.

1. Open the web app and sign in.
2. Go to **Settings**. Add a device named, for example, `iPhone`, with kind `ios`.
3. Create a token for that device. The plaintext token (it starts with `stash_`) is shown **once**.
   Copy it now. If you lose it, revoke it and create a new one.

The Settings page calls two endpoints of `packages/contracts/api`, which you can also call yourself
while signed in: `POST /devices` with `{"name": "iPhone", "kind": "ios"}` (the `devices` group),
then `POST /tokens` with `{"deviceId": "<id from the first call>"}` (the `tokens` group). The
`token` field of the second response is the plaintext token.

The token is a secret. Paste it only into the shortcut, and don't send it to anyone.

## 2. Build the shortcut

Open the **Shortcuts** app and tap **+** to create a new shortcut. Name it `Save to Stash`.

### Share sheet input

1. Tap the **ⓘ** (Details) button and turn on **Show in Share Sheet**.
2. Back in the editor, the first block reads **Receive _Any_ input from _Share Sheet_**. Tap
   **Any** and select only **URLs** and **Safari web pages**.
3. Tap **If there's no input** and choose **Stop and Respond**, so running it outside the share
   sheet does nothing.

### Actions

Add these actions in order. Search for each by the name in bold.

1. **Get URLs from Input**. Set its input to **Shortcut Input**. A Safari web page becomes its URL.
2. **Get Item from List**. Set it to **First Item** of **URLs**, so one share saves one link.
3. **Text**. Type `Bearer `, with one space after it, then paste the token from step 1. The result
   is `Bearer stash_...`. Keeping it in its own action keeps it out of sight in the next one.
4. **Get Contents of URL**. Set the URL to `https://<your-api>.workers.dev/links` (your host, with
   the `/links` path). Tap **Show More** and set:
   - **Method**: `POST`.
   - **Headers**: add one header. Key `Authorization`, value the **Text** variable from action 3.
   - **Request Body**: `JSON`. Add one field of type **Text**, key `url`, value the **Item from
     List** variable from action 2.

   With a JSON body, Shortcuts sends `Content-Type: application/json` itself.
5. **Get Dictionary Value**. Get **Value** for key `id` in **Contents of URL**.
6. **If**. Condition: **Dictionary Value** **has any value**.
7. Inside the **If** branch, **Show Notification** with the text `Saved to Stash` and, on a new
   line, the **Item from List** variable.
8. Inside the **Otherwise** branch, **Show Notification** with the text `Stash: save failed` and,
   on a new line, the **Contents of URL** variable. This shows the error object, for example
   `{"_tag": "Unauthorized", ...}`.

Shortcuts does not stop on an error status: **Get Contents of URL** returns the response body for
a `401` or `429` too. That is why the result is checked by the `id` key and not by the status.

### Optional: send the page title

The api fills in the title during enrichment, so this is rarely needed. To send the title Safari
already knows:

1. After action 2, add **Get Details of Safari Web Page**, set to **Name** of **Shortcut Input**.
2. In **Get Contents of URL**, add a second **Text** field, key `title`, value **Name**.

Only do this if you always share from Safari. Some apps share a bare URL with no name, and an empty
`title` fails validation with `400`.

## 3. Use it

In Safari (or any app that shares a link), tap **Share** and choose **Save to Stash**. The first
time it runs, Shortcuts asks to allow access to `<your-api>.workers.dev`. Choose **Always Allow**.
A notification confirms the save.

To see it in more places, edit the share sheet's action list (**Edit Actions...** at the bottom of
the sheet) and add **Save to Stash** to the favorites.

## Keep the token safe

- The token is stored in the shortcut in plain text. Don't share the shortcut through an iCloud
  link or AirDrop, because the copy carries the token. Build it again on each device instead, each
  with its own token.
- If a phone is lost or the token leaked, revoke that device's token in **Settings** (or with
  `DELETE /tokens/<id>`). Revoked tokens get `401` at once. Other devices are not affected.
- To replace a token, create a new one, paste it into the **Text** action, and revoke the old one.

## Troubleshooting

| Notification shows | Likely cause | Check or fix |
|---|---|---|
| `"_tag": "Unauthorized"` | The token is wrong, revoked, or the header is not `Bearer <token>` | Check the **Text** action: `Bearer`, one space, the token, no line break. Create a new token if it was revoked |
| `"_tag": "RateLimited"` | This device saved too often in the current window | Wait `retryAfterSeconds` and share again |
| A `400` error object | The shared item is not an `http(s)` URL, or `title` was sent empty | Share from Safari, or remove the optional `title` field |
| Nothing useful, or an HTML page | The URL in **Get Contents of URL** is wrong (other host, missing `/links`) | Use `https://<your-api>.workers.dev/links`. `https://<your-api>.workers.dev/health` must answer `{"status":"ok"}` |
| The shortcut is missing from the share sheet | **Show in Share Sheet** is off, or the input types exclude what the app shares | Turn it on in **ⓘ** and accept **URLs** and **Safari web pages** |
| The link is saved but untitled at first | Normal: enrichment runs after the save | Wait a moment, then reload the web app |
