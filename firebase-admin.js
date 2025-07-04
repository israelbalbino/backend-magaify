// firebase.js
// backend/firebase-admin.js
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json"); // baixe do console do Firebase

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "chamados-34ff3.appspot.com" // ex: mangaselfie.appspot.com
});

const db = admin.firestore();




const bucket = admin.storage().bucket();

module.exports = { admin, db, bucket };
