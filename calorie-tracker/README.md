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

## Running and maintaining it

### Where things live
| What | Where |
|---|---|
| App code (`index.html`, `app.js`, `foods.js`) | This repo, and published to the artifact URL above |
| Everyone's food logs, accounts, goals, saved foods | The artifact's database, hosted by Claude. Not in this repo |
| Which account a phone last used | That browser only (a convenience; nothing breaks if it's cleared) |

### Making changes
1. Edit the files in `calorie-tracker/` (e.g. add foods to `foods.js`).
2. Ask Claude to republish them **to the same artifact URL**. In a new conversation, give Claude the URL; without it Claude creates a separate copy with an empty database.
3. Republishing keeps all saved data. Open pages update by themselves.

### Things to watch
- **Never delete the artifact.** Deleting it erases the database and all history. There is no automatic backup.
- **Sharing level:** people need **Editor** access to save. With view-only access, nothing they log is saved.
- **Claude usage:** the assistant and photo scan run on the viewer's own Claude plan. If their usage limit runs out, those features pause; manual logging keeps working.
- **Storage limits:** up to 25,000 database documents in total (about 120 per account for 10 years), 256 KB per document (one month of heavy logging is about 100 KB), 300 saved custom foods per account.
- **Two devices editing the same day at the same moment:** the last save wins, so one of the two changes can be lost. This is rare in normal use.
- **Signed out or opened outside Claude:** the page saves on that device only and shows a banner saying so. Those entries don't sync.
- **Dates follow each device's clock and time zone.**
- **Privacy:** everyone the tracker is shared with can open every account. There is no login yet.
- **Nutrition values are estimates.** Correct them in `foods.js`, or save a corrected version under "My foods".
