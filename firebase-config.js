// 🔥 REPLACE THESE VALUES WITH YOUR OWN FROM FIREBASE CONSOLE
// Get these at: https://console.firebase.google.com/project/_/settings/general/
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// NOTE: Leave this file as-is if you don't want to use Firebase yet.
// The app works perfectly with just localStorage (all data stays in your browser).
// To enable Firebase sync later:
// 1. Create a Firebase project at firebase.google.com
// 2. Get your config object from Project Settings > General
// 3. Paste the values above
// 4. Uncomment the Firebase init block in the <script> tag of index.html