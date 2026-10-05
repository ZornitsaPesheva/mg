// Firebase web configuration is public by design. Access is protected by Authentication and Firestore Security Rules.
// Copy the values from Firebase Console > Project settings > Your apps.
export const firebaseConfig = {
  apiKey: "AIzaSyBdVaLQN94pUS5sEzwEds4GHGBChOhQmlw",
  authDomain: "mg4-urban-order-tracker.firebaseapp.com",
  projectId: "mg4-urban-order-tracker",
  storageBucket: "mg4-urban-order-tracker.firebasestorage.app",
  messagingSenderId: "1081308535598",
  appId: "1:1081308535598:web:02b5c29f43df7d317378bf"
};

// Replace this with the UID of the administrator created in Firebase Authentication.
export const ADMIN_UID = "Bsrl0QKJl8OGpJBDJzrN4jIC3ay2";

// All visitors share a common default timeline start. It can be changed in this file or per browser in the UI.
export const TIMELINE_DEFAULT_START = "2026-02-01";
