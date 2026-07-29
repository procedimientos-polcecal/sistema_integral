// Exporta el documento orgs/{uid} de Firestore (proyecto remisgest) a un .json local.
// Usa el mismo SDK web que ya usa remisgest — no requiere service account ni gcloud.
// Uso: node export.mjs   (te va a pedir email y contraseña de forma interactiva)

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Config pública del proyecto remisgest (tal cual está en remisgest/index.html).
// No es secreta: el acceso real lo controlan las reglas de seguridad de Firestore.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDEv6YW_iTL_X4Vdsk0rdHSpBhoLUMKcC0',
  authDomain: 'remisgest.firebaseapp.com',
  projectId: 'remisgest',
  storageBucket: 'remisgest.firebasestorage.app',
  messagingSenderId: '398145762684',
  appId: '1:398145762684:web:8b0b9566e163319e2ee0f9',
};

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      rl._writeToOutput = (s) => rl.output.write(rl.stdoutMuted ? '' : s);
      rl.stdoutMuted = true;
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) console.log('');
      resolve(answer.trim());
    });
  });
}

async function main() {
  const email = await prompt('Email (el que usás para entrar a remisgest): ');
  const password = await prompt('Contraseña: ', { hidden: true });

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  console.log(`Logueada OK. UID: ${uid}`);

  const snap = await getDoc(doc(db, 'orgs', uid));
  if (!snap.exists()) {
    console.error(`No existe el documento orgs/${uid} para este usuario.`);
    process.exit(1);
  }

  const outPath = join(__dirname, `orgs_${uid}.json`);
  writeFileSync(outPath, JSON.stringify(snap.data(), null, 2), 'utf-8');
  console.log('Guardado en: ' + outPath);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
