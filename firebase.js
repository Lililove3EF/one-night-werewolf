import { initializeApp }
from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously
}
from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  getDatabase
}
from "https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js";


const firebaseConfig = {
  apiKey: "네 API KEY",

  authDomain:
    "onenitewolf.firebaseapp.com",

  // ★ Firebase Console의 Realtime Database 주소
  databaseURL:
    "여기에 네 Realtime Database URL",

  projectId:
    "onenitewolf",

  storageBucket:
    "onenitewolf.firebasestorage.app",

  messagingSenderId:
    "242458898688",

  appId:
    "1:242458898688:web:626c8dae7dd647255e83e5",

  measurementId:
    "G-1V027VHK9W"
};


const app =
  initializeApp(firebaseConfig);


export const auth =
  getAuth(app);


export const db =
  getDatabase(app);


export async function ensureLogin() {

  if (auth.currentUser) {
    return auth.currentUser;
  }

  const credential =
    await signInAnonymously(auth);

  return credential.user;
}