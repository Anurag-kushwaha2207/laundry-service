// Firebase Config Setup
// Ye values aapko Firebase Console > Project Settings > General > "Your apps" section se milengi
// Agar pehle se koi firebaseConfig object aapke purane script.js ya index.html me hai,
// wahi actual values yaha paste karna — naya project mat banana.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAa4yo1eTO13cl0ARtmR7o3jcaBOMDCFB8",
  authDomain: "laundryservices-b99f1.firebaseapp.com",
  projectId: "laundryservices-b99f1",
  storageBucket: "laundryservices-b99f1.firebasestorage.app",
  messagingSenderId: "894893398993",
  appId: "1:894893398993:web:3d0a5cc37c86e330941ef0",
  measurementId: "G-9S0XTW0W1J"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

export { db, auth, storage };
