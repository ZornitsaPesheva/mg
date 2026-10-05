// Firebase web configuration is public by design. Access is protected by Authentication and Firestore Security Rules.
// Copy the values from Firebase Console > Project settings > Your apps.
export const firebaseConfig = {
  apiKey: "PASTE_FIREBASE_WEB_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_MESSAGING_SENDER_ID",
  appId: "PASTE_FIREBASE_APP_ID",
};

// Replace this with the UID of the administrator created in Firebase Authentication.
export const ADMIN_UID = "REPLACE_WITH_ADMIN_UID";

// All visitors share a common default timeline start. It can be changed in this file or per browser in the UI.
export const TIMELINE_DEFAULT_START = "2026-02-01";
