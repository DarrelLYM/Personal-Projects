# Food Log: Singapore calorie tracker

A phone web app for logging what you eat in Singapore. Data stays on your device.

## Features
- **Progress bar row** at the top for Calories, Protein, Carbs, Fat and Sugar against your daily goals. A bar turns red when you go over.
- **Week date strip** to switch days.
- **4 optional meals**: Breakfast, Lunch, Dinner, Supper. The meal for the current time is tagged "now".
- **Photo scan**:
  - Barcode in the photo: the product is looked up on Open Food Facts. No key needed.
  - Plated food (e.g. chicken rice): Claude AI recognises it and estimates the nutrition. This needs your own Anthropic API key, set in Settings.
- **Manual**: search 380 built-in Singapore foods (hawker, kopitiam, fast food, bubble tea, supermarket brands, fruit), search packaged products online, or type in your own values.
- Day summary with sodium, recent foods, saved custom foods, JSON backup/restore, and offline support.

## Run it
Any static web host works. For example, GitHub Pages (Settings → Pages → deploy from branch, folder `/`), then open
`https://<user>.github.io/Personal-Projects/calorie-tracker/` on your phone and choose **Add to Home Screen**.

To run it locally: `cd calorie-tracker && python3 -m http.server 8000`, then open http://localhost:8000.
The camera needs HTTPS or localhost.

## Notes
- Nutrition values are approximate. They come from HPB composition data, brand labels and outlet nutrition info, and hawker portions vary by stall.
- Edit `foods.js` to add or adjust foods.
- `vendor/` holds bundled copies of `@anthropic-ai/sdk@1.7.0` and `@zxing/library@0.21.3`, so the app doesn't depend on a CDN.
