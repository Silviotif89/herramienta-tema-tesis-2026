// Firebase Web config is public by design. Access is protected by firestore.rules.
export const firebaseConfig = {
  apiKey: "REPLACE_WITH_FIREBASE_WEB_API_KEY",
  authDomain: "REPLACE_WITH_PROJECT_ID.firebaseapp.com",
  projectId: "REPLACE_WITH_PROJECT_ID",
  appId: "REPLACE_WITH_FIREBASE_WEB_APP_ID"
};

// The verified Firebase Auth UID is granted the tutor role in firestore.rules.
export const tutorUid = "REPLACE_WITH_TUTOR_UID";

