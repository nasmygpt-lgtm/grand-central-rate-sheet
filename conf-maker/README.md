# 🏨 Grand Central Hotel — Confirmation Builder

A simple static web page. Fill in the booking details → click **Generate** → get a confirmation
email in the hotel's exact format. Copy, download, or print it.

**No API key. No login. No cost.** Just HTML, CSS, and JavaScript — perfect for GitHub Pages.

## How to use
1. Open `index.html` in a browser.
2. Enter the confirmation number, company name, and room details.
3. For more rooms, click **+ Add Room**.
4. Click **Generate Confirmation**.
5. **Copy (Email)**, **Copy (Plain Text)**, **Download**, or **Print**.

Built-in rules:
- Company & guest names shown in ALL-CAPS
- Multiple rooms → one table per room + Grand Total
- Extra bed → `base + extra X nights = AED subtotal`
- Non-Refundable checkbox → removes Cancellation / Early Departure / Payment notes
- TD = Direct payment

## Deploy to GitHub Pages
```bash
git init
git add .
git commit -m "Confirmation builder"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
Then: **Settings → Pages → Source: main / root → Save**.

## Files
| File | Purpose |
|---|---|
| `index.html` | Form + output |
| `style.css` | Styling |
| `app.js` | Generates the confirmation |
