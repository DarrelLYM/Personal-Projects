// Sends due reminders. Run hourly by .github/workflows/notify.yml.
// Needs the FIREBASE_SERVICE_ACCOUNT secret (the JSON key from Firebase > Project settings > Service accounts).
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { decide, localParts } from "./reminders.mjs";

const APP_URL = process.env.APP_URL || "https://darrellym.github.io/Personal-Projects/calorie-tracker/";
const DRY_RUN = process.env.DRY_RUN === "1";
const BAD_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log("FIREBASE_SERVICE_ACCOUNT is not set; nothing to do."); process.exit(0); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const messaging = getMessaging();

const now = new Date();
const users = await db.collection("users").where("notify.enabled", "==", true).get();
let sentCount = 0, checked = 0;

for (const doc of users.docs) {
  checked++;
  const data = doc.data();
  const n = data.notify || {};
  const tokens = Array.isArray(n.tokens) ? n.tokens : [];
  if (!tokens.length) continue;
  const local = localParts(now, n.tz);
  const month = await db.doc(`users/${doc.id}/months/${local.date.slice(0, 7)}`).get();
  const day = month.exists ? month.get("days")?.[local.date] : undefined;
  const { message, state, changed } = decide(n, day, local, now, data.goals?.kcal);

  const update = {};
  if (changed) update["notify.state"] = state;
  if (message) {
    if (DRY_RUN) {
      console.log(`[dry run] would send "${message.title}" to ${tokens.length} device(s)`);
    } else {
      const res = await messaging.sendEachForMulticast({
        tokens,
        data: { title: message.title, body: message.body, tag: message.tag, url: APP_URL },
        webpush: { headers: { Urgency: "high", TTL: "3600" } },
      });
      sentCount += res.successCount;
      const keep = tokens.filter((_, i) => !(res.responses[i].error && BAD_TOKEN.has(res.responses[i].error.code)));
      if (keep.length !== tokens.length) update["notify.tokens"] = keep;
      res.responses.forEach((r) => { if (r.error && !BAD_TOKEN.has(r.error.code)) console.warn("send failed:", r.error.code); });
    }
  }
  if (Object.keys(update).length && !DRY_RUN) await doc.ref.update(update);
}
console.log(`Checked ${checked} account(s) with reminders on; delivered ${sentCount} notification(s).`);
