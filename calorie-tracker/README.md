# Grace's Calorie Tracker

A free calorie tracker for food eaten in Singapore. It runs in any phone browser and can be added to the home screen like an app.

- **Hosting:** GitHub Pages (free) at `https://darrellym.github.io/Personal-Projects/calorie-tracker/`
- **Login and database:** Google Firebase, free Spark plan
- **Packaged food lookup:** Open Food Facts (free)
- No Claude account, subscription or paid API is needed.

## Features
- Sign in with a username or email, plus a "Forgot password?" email link
- Progress bars for Calories, Protein, Carbs, Fat and Sugar; week date strip; jump to any date in the last 10 years
- 4 optional meals: Breakfast, Lunch, Dinner, Supper
- **Scan:** live barcode scanning on the phone. The camera image is never saved or uploaded; only the barcode number is looked up. Unknown products can be entered once and are recognised on the next scan.
- **Manual:** search 380 Singapore foods, search packaged products online, or type in your own values
- **Picks:** local dishes and low-sugar drinks that fit the calories left today
- **History:** search past foods (e.g. "bubble tea") over 7 days, 30 days, this month, this year or all time, or see daily totals and the most-eaten foods
- **Profile:** edit your own daily goals, reset your password, sign out

## One-time setup (about 10 minutes)

### 1. Create the Firebase project
1. Go to https://console.firebase.google.com and sign in with a Google account.
2. **Create a project.** Name it e.g. `graces-calorie-tracker`. Google Analytics isn't needed.
3. **Turn on login:** Build > **Authentication** > Get started > Sign-in method > **Email/Password** > Enable > Save.
4. **Allow the website:** Authentication > Settings > **Authorized domains** > Add domain > `darrellym.github.io`.
5. **Create the database:** Build > **Firestore Database** > Create database > choose location **asia-southeast1 (Singapore)** > Start in **production mode** > Create. The location can't be changed later.
6. **Add the security rules:** Firestore Database > **Rules** tab > replace everything with the contents of [`firestore.rules`](firestore.rules) > **Publish**.
7. **Get the settings:** Project settings (gear icon) > General > Your apps > **Web** (`</>`) > give it a nickname > Register app. Copy the `firebaseConfig` values into [`firebase-config.js`](firebase-config.js). They're safe to publish; the rules in step 6 are what protect the data.

### 2. Publish the website
1. On GitHub: repo **Settings** > General > Danger Zone > **Change visibility** > Public. Free GitHub Pages only works for public repos. Only the code becomes public; the food logs stay in Firebase.
2. Repo **Settings** > **Pages** > Source: Deploy from a branch > Branch: `main`, folder `/ (root)` > Save.
3. After a minute or two the app is live at `https://darrellym.github.io/Personal-Projects/calorie-tracker/`.

### 3. Create the accounts and install on phones
1. Open the link and tap **Create an account**. Each person makes their own, with a password of at least 6 characters.
2. **iPhone:** open the link in Safari > Share > **Add to Home Screen**. **Android:** open it in Chrome > ⋮ menu > **Add to Home screen** (or **Install app**).
3. On a new phone, open the link and sign in. Everything is still there.

## How the data is stored

| What | Where |
|---|---|
| Logins (email and password) | Firebase Authentication. Passwords are stored by Google in hashed form; nobody can read them, including you |
| Profile (username, goals, saved foods) | Firestore `users/{userId}` |
| Food log | Firestore `users/{userId}/months/{YYYY-MM}`: one document per month, so 10 years is about 120 per person |
| Username lookup | Firestore `usernames/{name}`, which maps a username to its email so people can sign in with either |
| App code | This repo, served by GitHub Pages |

The security rules let each signed-in person read and write **only their own** profile and log.

## Maintaining it
- **Changing the app:** edit the files and push to `main`. GitHub Pages updates in a minute or two, and phones pick up the new version the next time the app is opened.
- **Adding foods:** add rows to `foods.js` (the format is described at the top of the file).
- **Seeing or fixing data:** Firebase console > Firestore Database > Data.
- **Seeing or removing users:** Firebase console > Authentication > Users. From here you can also send a password reset or disable an account.
- **Customising the reset email:** Authentication > Templates > Password reset (sender name, subject).

## Things to watch
- **Free plan limits** (Firestore Spark): 1 GiB stored, 50,000 reads and 20,000 writes a day. A couple of people logging daily use well under 1% of this. If a limit is hit, saving pauses until the next day. Nothing is charged unless you upgrade the plan yourself.
- **Don't delete the Firebase project.** That deletes every account and log. Firestore has no free automatic backup; export from the console if you want one.
- **Usernames reveal emails:** looking up a username returns its email address, which is how username sign-in works without a paid server. Anyone who knows a username could find its email.
- **Reset emails** come from `noreply@<project>.firebaseapp.com` and may land in spam.
- **Open Food Facts** is run by volunteers. Some Singapore products are missing or have wrong values; enter those manually once.
- **The camera needs HTTPS** (GitHub Pages provides it) and permission in the browser. If it's blocked, use "Take a photo instead" or type the barcode number.
- **Dates follow each phone's clock and time zone.**
- **Two phones editing the same day at the same moment:** the last save wins.
- **Nutrition values are estimates** based on HPB data and brand labels; hawker portions vary by stall.

## Files
- `index.html`: layout and styles
- `app.js`: app logic (login, sync, scanner, picks, history)
- `foods.js`: Singapore food list
- `firebase-config.js`: your Firebase project settings
- `firestore.rules`: database security rules, pasted into the Firebase console
- `manifest.json`, `sw.js`, `icons/`: home-screen app and offline support
- `vendor/zxing-browser.js`: barcode reader (`@zxing/browser` 0.1.5, bundled)
