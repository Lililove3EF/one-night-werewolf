// 참고용. 이미 만든 firebase.js는 그대로 사용해도 됩니다.
// game.js는 auth, db, ensureLogin 3개 export를 기대합니다.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js';
const firebaseConfig={
  apiKey:'YOUR_API_KEY',authDomain:'YOUR_PROJECT.firebaseapp.com',
  databaseURL:'https://YOUR_PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:'YOUR_PROJECT',storageBucket:'YOUR_PROJECT.firebasestorage.app',
  messagingSenderId:'YOUR_SENDER_ID',appId:'YOUR_APP_ID'
};
const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getDatabase(app);
export async function ensureLogin(){
  if(auth.currentUser)return auth.currentUser;
  await signInAnonymously(auth);
  return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Firebase 익명 로그인 시간 초과')),10000);
    const off=onAuthStateChanged(auth,u=>{if(u){clearTimeout(timer);off();resolve(u);}},e=>{clearTimeout(timer);off();reject(e);});
  });
}
