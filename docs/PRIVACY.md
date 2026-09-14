# Privacy Policy — Promptary

**Last updated: 2026-09-14**

Promptary is a Chrome extension that reverse-engineers images into AI art prompts and helps you organise them. This policy explains exactly what happens to your data.

The short version: **we do not collect, transmit, or store any of your data on any server we control.** There is no Promptary account, no analytics, and no telemetry.

---

## 1. What we do not collect

Promptary has no backend server. We do not operate any service that receives your data. Specifically, we do not collect:

- Personal information (name, email, address, phone number)
- Account credentials (there are no accounts)
- Browsing history
- The images you analyse
- The prompts you save
- Usage statistics, crash reports, or analytics events

There is no tracking of any kind.

## 2. What is stored, and where

Everything Promptary saves stays on your own computer:

| Data | Where it is stored | Notes |
| --- | --- | --- |
| Saved images, prompts, tags, categories | Your browser's local IndexedDB | Never uploaded anywhere |
| Your API key and model settings | `chrome.storage.local` | Stored separately from your library |
| Interface preferences | `chrome.storage.local` | Theme, language, etc. |

**Your API key is never included in exported backups**, because settings and library data are stored separately by design.

Deleting items moves them to an in-extension Trash; emptying the Trash permanently removes them. Uninstalling the extension deletes all of the above, since it all lives inside the extension's own storage.

## 3. When data leaves your device

There is exactly one situation in which data leaves your computer, and **you initiate it every time**:

> **When you ask Promptary to analyse an image**, that image is sent to the AI model service that *you* configured in Settings.

Promptary supports any OpenAI-compatible API. You supply the endpoint (`baseUrl`), the API key, and the model name. Common choices include DeepSeek, OpenAI, OpenRouter, or a self-hosted service.

This means:

- The image goes **directly from your browser to the service you chose**. It does not pass through us — we have no server to pass it through.
- **That provider's privacy policy governs what happens to the image.** If you point Promptary at a third-party API, review that provider's terms.
- If you point Promptary at a service you run yourself, no third party is involved at all.
- The prompt text returned by the model is stored locally, as described above.

By default, Promptary first gives the model service the image's public URL, letting the service fetch it directly. If that fails (for example, the site blocks hotlinking), Promptary downloads the image locally and uploads it as base64 instead. You can force either behaviour in Settings.

The extension makes no network requests of its own. It only contacts the endpoint you configure.

## 4. Permissions, and why each is needed

Chrome shows you a permission warning for this extension. Here is what each one is actually for:

| Permission | Why Promptary needs it |
| --- | --- |
| `contextMenus` | Adds the right-click menu items ("Reverse-engineer this image", "Save this image", and so on). This is the main way you use the extension. |
| `storage` | Saves your settings and API key locally. |
| `sidePanel` | Hosts the main interface in the browser's side panel. |
| `activeTab` | Reads the current tab's URL and title when you trigger an action, so saved items can record where they came from. Only used at your request. |
| `scripting` | If you trigger reverse-engineering from the right-click menu on a page that was already open before the extension was installed, the content script is not yet present. This permission lets Promptary inject it once so the action still works. |
| `<all_urls>` | **See below.** |

### Why `<all_urls>` is required

Promptary works on any website, because you might find a useful reference image anywhere — an art site, a social feed, a blog, a shop.

Concretely, this permission allows Promptary to:

- read the image you right-clicked on, so it can be analysed
- read the list of images on the current page, so you can pick one
- write text into an input box on the page, when you click "Insert into page" to send a prompt to a generation tool
- show the hover button on images

It does **not** allow Promptary to do anything in the background. Promptary never reads pages you have not explicitly acted on, and never sends page content anywhere on its own. All of the above happens only in direct response to your clicks, and the only outbound destination is the API endpoint you configured yourself.

## 5. Third-party services

Promptary itself integrates with no third-party analytics, advertising, or tracking services.

The AI model service you configure is a third party of your own choosing. It is not a sub-processor of ours — we have no relationship with it and receive nothing from it. Please review that provider's privacy policy separately.

## 6. Data sharing and sale

We do not share, sell, rent, or trade your data, because we never receive it in the first place.

## 7. Your control over your data

- **Export**: Settings → Data & storage lets you export everything as a JSON file, or into a folder with images as separate files. The export excludes your API key.
- **Import**: You can import a backup; existing items with the same ID are skipped rather than overwritten.
- **Delete**: Deleting an item moves it to Trash. Emptying Trash permanently removes it. Uninstalling the extension removes everything.

## 8. Children's privacy

Promptary is not directed at children and collects no personal information from anyone, including children under 13.

## 9. Changes to this policy

If this policy changes, the "Last updated" date above will change, and the revision will be visible in the project's public repository.

## 10. Contact

Promptary is an open-source project. Its source code is public, so every claim in this document can be verified directly.

- Repository: https://github.com/dingge001/promptary
- Questions or issues: https://github.com/dingge001/promptary/issues
