# ZollTool Print Planner — Photoshop panel

A Photoshop (UXP) panel that tells you **how many of each art print you still
need to make** for an upcoming event.

You assign stock to an event in ZollTool (`broughtQty`), but you rarely have that
many physically printed yet. This panel pulls the assigned amounts from the
ZollTool sync server, subtracts what you already have on hand, and shows the
difference — then opens the matching print file so you can print it.

## How it computes

For the event you're planning:

```
to print = assigned (broughtQty)  −  on hand
```

**On hand** is pre-filled from the *leftovers of a previous event* you choose
(`brought − sold`, never below zero), and every row is editable — so you can
correct the count by hand before printing. Pick "Nothing" as the source to start
every design from zero and just type your real counts.

## One-time setup

1. **Mint a read token.** In ZollTool → **Admin → API access**, create a token
   with **Read** access. Copy the `zt_…` value (shown once).
2. **Install the panel** with Adobe's [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/devtool/):
   - *Add Plugin…* → select this folder's `manifest.json`.
   - *Load* (with Photoshop 2021 or newer running).
   - The panel appears under **Plugins → ZollTool Print Planner**.
3. In the panel's **Connection** section, enter your sync **Server URL**
   (the same URL the ZollTool app syncs to) and paste the **token**, then **Save**.

## Using it

1. Pick the **event to plan for**.
2. Pick **count leftovers from** — usually your most recent event (top of the
   list). Or "Nothing" to start from zero.
3. **Compute print list.** Each design shows `need N · have [x]` and a big number
   = how many to print. Adjust *have* if your real count differs; the number and
   the total update live. Rows that need nothing dim out.
4. **Prints folder…** — point it at the folder holding your print files. Each row
   then gets an **Open** button that opens the matching file(s) in Photoshop.

### File matching

A row matches a file when the file's name contains the product/variant **SKU**
(preferred) or, failing that, the **title** — punctuation and case are ignored.
Matched types: `psd psb tif tiff png jpg jpeg pdf`. Sub-folders are scanned a few
levels deep. If a design has no SKU, or files aren't named after it, the row says
*no matching file* — rename the file to include the SKU for a reliable match.

## Notes

- The panel only ever **reads** from ZollTool (a `data:read` token). It never
  writes back and never changes your catalog.
- The server URL and token are stored in the plugin's private data folder on this
  machine; the prints-folder grant is stored as a UXP persistent token.
- Requires the sync server to expose `GET /api/data/events/:id/stock` (added
  alongside this plugin).
