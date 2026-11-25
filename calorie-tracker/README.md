# Grace's Calorie Tracker

A Singapore calorie tracker that runs as a Claude artifact:
https://claude.ai/artifact/RJRhLmp7fFCpmnd5PA8N3x

## Features
- **Progress bar row** for Calories, Protein, Carbs, Fat and Sugar against your goals. A bar turns red when you go over.
- **Week date strip**, plus a calendar button to jump to any date in the last 10 years.
- **4 optional meals**: Breakfast, Lunch, Dinner, Supper.
- **Photo scan**: Claude recognises the dish in a photo, or reads a nutrition label, and estimates the nutrition.
- **Manual**: search 380 built-in Singapore foods, or type in your own values (saved to "My foods").
- **Picks for your next meal**: local dishes and low-sugar drinks that fit the calories you have left today, ranked by protein.
- **Assistant**: a chat that looks through your history ("How many bubble teas this month?", "What did I eat last week?") and suggests food.
- **Accounts**: anyone the tracker is shared with can create their own account, with no login page. Tick "This is me" and the account opens automatically on any phone or computer signed in to that Claude account.

## How data is stored
The artifact's shared database holds one document per account (`accounts/{id}`) and one per account per month
(`accounts/{id}/months/YYYY-MM`). Ten years is about 120 documents per account, well inside the database's limit of
25,000 documents. Opened outside Claude, the page falls back to storing data on that device only.

## Files
- `index.html`: page layout and styles
- `app.js`: app logic (storage, recommendations, assistant, photo scan)
- `foods.js`: Singapore food database. Values are approximate, based on HPB composition data and brand labels.
