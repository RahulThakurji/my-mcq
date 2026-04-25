// Import Firebase
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage"; 


// Your config (already correct)
const firebaseConfig = {
  apiKey: "AIzaSyACbquAidIpUUbQlTPSrE97Mkwu9R4Z4Sc",
  authDomain: "quizmasterpro-2086d.firebaseapp.com",
  projectId: "quizmasterpro-2086d",
  storageBucket: "quizmasterpro-2086d.firebasestorage.app",
  messagingSenderId: "348273443316",
  appId: "1:348273443316:web:0378903160beb78866b9a1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Storage
export const storage = getStorage(app);