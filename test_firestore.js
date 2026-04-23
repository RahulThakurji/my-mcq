import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const docRef = doc(db, 'test', 'merge_test');
  
  // Set initial data
  await setDoc(docRef, { drawings: { 1: "a", 2: "b" } });
  
  // Try to delete field 1 by omitting it with merge: true
  await setDoc(docRef, { drawings: { 2: "b" } }, { merge: true });
  
  let snap = await getDoc(docRef);
  console.log("After omitting 1:", snap.data());
  
  // Try to clear map entirely
  await setDoc(docRef, { drawings: {} }, { merge: true });
  
  snap = await getDoc(docRef);
  console.log("After empty object:", snap.data());
}

run().catch(console.error);
