// Firebase settings for this app (project: grace-calorie-tracker).
// Loaded as a plain script so both the app and its service worker can read it.
// From: Firebase console > Project settings > General > Your apps > Web app > Config.
// These values are safe to publish: they only identify the project. Who can read or write data
// is controlled by the security rules in firestore.rules.
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDF8JumiUYXnjg8mUBErJbSKAwsbwgPLIo",
  authDomain: "grace-calorie-tracker.firebaseapp.com",
  projectId: "grace-calorie-tracker",
  storageBucket: "grace-calorie-tracker.firebasestorage.app",
  messagingSenderId: "702682995845",
  appId: "1:702682995845:web:ea4a615f38c3aa2d239dec",
};

// Web Push public key for notifications (safe to publish).
// From: Firebase console > Project settings > Cloud Messaging > Web configuration > Web Push certificates > Key pair.
self.FIREBASE_VAPID_KEY = "BHe4i77F_viXyrH67h7oqaw0iAdvP9stlg5bFCMdCRpoljYCtPWDWeR5HIhpRI26Mwic3AzScwWc1geHlxkmDo4";
