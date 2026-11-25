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
- **Food search:** about 3,000 foods with official data (HPB's SG FoodID for hawker and everyday food, McDonald's Singapore, Ya Kun drinks), packaged products from Open Food Facts, and labelled estimates for chains that publish nothing. Understands local names ("cai fan", "kopi siew dai", "CKT") and small typos.
- **Faster logging:** quick add (just calories), portion sizes (small / regular / large / grams), favourites, recent foods, "same as yesterday's lunch", and copying a whole day
- **Edit entries:** tap any logged food to change its numbers, servings or meal
- **Picks:** local dishes and low-sugar drinks that fit the calories left today
- **History:** search past foods (e.g. "bubble tea") over 7 days, 30 days, this month, this year or all time, or see daily totals and the most-eaten foods
- **Profile:** edit daily goals; change username (instant) or email (confirmed by a link sent to the new address); reset password; sign out
- **Notifications** (optional, per person): every 1–4 hours within chosen hours, meal reminders if a meal isn't logged by a set time, and an end-of-day reminder if nothing was logged. Sent hourly by a free GitHub Actions job.
- **Your data:** download the log as a spreadsheet (CSV), download a full backup, restore from a backup
- **Delete account:** confirmed through a link emailed to the account's address; erases the login and all data

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

### 3. Turn on email links (needed for "Delete my account")
Authentication > **Sign-in method** > click **Email/Password** > switch on **Email link (passwordless sign-in)** > Save.

### 4. Set up notifications (optional; needed for reminders)
1. **Web Push key:** Project settings > **Cloud Messaging** tab > *Web configuration* > **Web Push certificates** > **Generate key pair**. Copy the key pair (a long string starting with `B`) into `FIREBASE_VAPID_KEY` in [`firebase-config.js`](firebase-config.js). This key is public.
2. **Service account key:** Project settings > **Service accounts** tab > **Generate new private key** > Generate key. A `.json` file downloads. **This one is secret:** never commit it, send it to anyone, or paste it into chat.
3. **Give it to GitHub:** repo **Settings** > **Secrets and variables** > **Actions** > **New repository secret**. Name: `FIREBASE_SERVICE_ACCOUNT`. Secret: open the `.json` file in a text editor and paste all of it. Click **Add secret**, then delete the downloaded file.
4. **Test it:** repo **Actions** tab > **Calorie tracker reminders** > **Run workflow**. A green tick means it worked. After that it runs every hour by itself.

### 5. Create the accounts and install on phones
1. Open the link and tap **Create an account**. Each person makes their own, with a password of at least 6 characters.
2. **iPhone:** open the link in Safari > Share > **Add to Home Screen**. **Android:** open it in Chrome > ⋮ menu > **Add to Home screen** (or **Install app**).
3. On a new phone, open the link and sign in. Everything is still there.

## Notifications: how they work
- Each person turns them on in **Profile > Notification settings**. Their phone is registered with Firebase Cloud Messaging (free) and the settings are saved in their profile.
- `.github/workflows/notify.yml` runs every hour (free on public repos). It runs `scripts/notify/notify.mjs`, which checks each person's settings and today's log in their time zone, and sends any reminder that's due. The rules are in `scripts/notify/reminders.mjs`, with tests in `reminders.test.mjs`.
- Each kind of reminder is sent at most once per time slot. Meal and end-of-day reminders are skipped if food was already logged.
- **Limits:** GitHub can start the hourly job late when it's busy, so reminders may arrive up to about an hour after the chosen time. iPhones need iOS 16.4+ and the app added to the Home Screen from Safari. GitHub pauses scheduled jobs after 60 days without repo activity; the job re-enables itself each run, but if reminders ever stop, check the **Actions** tab and click **Enable workflow**.

## Where the nutrition numbers come from
Every food carries a tag shown in the app:

| Tag | Source | Refreshed |
|---|---|---|
| **Official** | HPB [SG FoodID](https://pphtpc.hpb.gov.sg/web/sgfoodid) (lab-analysed and label data for local food), [McDonald's Singapore](https://www.mcdonalds.com.sg/nutrition-calculator), [Ya Kun](https://app.yakun.com/nutritional-information) drinks | By running `scripts/foods/build.py` after updating the snapshots in `scripts/foods/sources/` |
| **Label** | [Open Food Facts](https://world.openfoodfacts.org) products sold in Singapore (nutrition labels typed in by volunteers) | Weekly, automatically (`.github/workflows/packaged-foods.yml` → `data/packaged.json`) |
| **Estimate** | Chains with no published Singapore data (KFC, Jollibee, Burger King, Texas Chicken, Old Chang Kee, Starbucks, bubble tea, Stuff'd, Potato Corner…) | Edit `scripts/foods/sources/estimates.json` |
| **Yours** | Manual entries, quick adds and anything you edit | — |

Licences: SG FoodID data is used under [HPB's licence](https://file.go.gov.sg/termsofuse-hpbsgfoodid.pdf), which requires the credit shown in the app under Profile → "Where the nutrition numbers come from". Open Food Facts data is under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

To add a food permanently for everyone, add it to `scripts/foods/sources/estimates.json` (or a new source file) and run `python3 scripts/foods/build.py`.

## How the data is stored

| What | Where |
|---|---|
| Logins (email and password) | Firebase Authentication. Passwords are stored by Google in hashed form; nobody can read them, including you |
| Profile (username, goals, saved foods, notification settings and device tokens) | Firestore `users/{userId}` |
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
- **Don't delete the Firebase project.** That deletes every account and log. Firestore's automatic backups are a paid feature, so use **Profile > Download a full backup** now and then.
- **Keep the service account key secret.** It can read and change all data. If it ever leaks: Google Cloud console > IAM & Admin > Service accounts > the firebase-adminsdk account > Keys > delete it, then generate a new one and update the GitHub secret.
- **Usernames reveal emails:** looking up a username returns its email address, which is how username sign-in works without a paid server. Anyone who knows a username could find its email.
- **Firebase emails** (password reset, email change, delete links) come from `noreply@<project>.firebaseapp.com` and may land in spam.
- **Open Food Facts** is run by volunteers. Some Singapore products are missing or have wrong values; enter those manually once.
- **The camera needs HTTPS** (GitHub Pages provides it) and permission in the browser. If it's blocked, use "Take a photo instead" or type the barcode number.
- **Dates follow each phone's clock and time zone.**
- **Two phones editing the same day at the same moment:** the last save wins.
- **Nutrition values are a guide.** Official values are for standard portions; hawker portions vary by stall, and estimates are only typical values.
- **Weekly packaged-food refresh** commits to `main` from GitHub Actions. Pull before pushing your own changes (`git pull`).

## Files
- `index.html`: layout and styles
- `app.js`: app logic (login, sync, scanner, picks, history)
- `data/foods.json`: the main food list (built by `scripts/foods/build.py` from `scripts/foods/sources/`)
- `data/packaged.json`: packaged products (built weekly by `scripts/packaged/build.mjs`)
- `firebase-config.js`: your Firebase project settings
- `firestore.rules`: database security rules, pasted into the Firebase console
- `manifest.json`, `sw.js`, `icons/`: home-screen app and offline support
- `vendor/zxing-browser.js`: barcode reader (`@zxing/browser` 0.1.5, bundled)
- `scripts/notify/`: hourly reminder job (`firebase-admin`), run by `.github/workflows/notify.yml`
