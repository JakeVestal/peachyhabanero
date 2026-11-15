// Firebase Realtime Database wrapper. Both pages import the database
// functions from here, so the SDK version and the config live in one place.
import { firebaseConfig } from "./overnight-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, get, set, update, push, remove,
  runTransaction, onDisconnect, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const cfgText = JSON.stringify(firebaseConfig || {});
let _err = null, _db = null;
if (!firebaseConfig || /PASTE/.test(cfgText)) {
  _err = "Firebase is not configured yet. Open overnight-config.js and paste your project's config (see SETUP.md).";
} else if (!firebaseConfig.databaseURL) {
  _err = "overnight-config.js has no databaseURL. Create the Realtime Database first, then copy the config again (see SETUP.md).";
} else {
  try { _db = getDatabase(initializeApp(firebaseConfig)); }
  catch (e) { _err = "Firebase config problem: " + e.message; }
}
export const configError = _err;
export const db = _db;

export { ref, onValue, get, set, update, push, remove, runTransaction, onDisconnect, serverTimestamp };

// Turn Firebase's terse errors into something an instructor can act on.
export function explainError(err) {
  const msg = String((err && (err.code || err.message)) || err);
  if (/permission[_ ]denied/i.test(msg)) {
    return "Firebase refused the write (PERMISSION_DENIED). The Realtime Database rules don't allow this path. Paste database.rules.json into Firebase console → Realtime Database → Rules → Publish (see SETUP.md).";
  }
  return msg;
}
