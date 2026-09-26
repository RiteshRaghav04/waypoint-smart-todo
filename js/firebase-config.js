/* ==========================================================
   FIREBASE CONFIG — paste your own project's keys here.

   How to get these (all free):
   1. Go to https://console.firebase.google.com and create a project.
   2. In the project, click the "</>" (web app) icon to register a web app.
   3. Firebase shows you a config object exactly like the one below —
      copy YOUR values into FIREBASE_CONFIG here.
   4. In the Firebase console sidebar: Build → Authentication → Get started →
      enable "Email/Password".
   5. In the Firebase console sidebar: Build → Firestore Database → Create
      database → start in "test mode" (fine for a personal showcase; see
      README for a safer production ruleset).

   Full step-by-step deploy instructions are in README.md.
   ========================================================== */

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// Leave this as-is — app.js checks this to know whether you've filled in
// real keys yet, and falls back to local-only mode if not.
const FIREBASE_CONFIGURED = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
