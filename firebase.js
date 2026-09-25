// 1. console.firebase.google.com -> Add project (Spark/free plan is fine)
// 2. Build > Authentication > Get started > Sign-in method > enable "Email/Password"
// 3. Build > Firestore Database > Create database (start in production mode)
// 4. Project settings (gear icon) > General > "Your apps" > Web (</>) > register app
// 5. Paste the config object Firebase shows you below, replacing the placeholders.
// 6. Once deployed, upload firestore.rules in the Firestore "Rules" tab.

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
