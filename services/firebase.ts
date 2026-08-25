
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, initializeAuth, browserSessionPersistence } from 'firebase/auth';

const getEnv = (key: string) => {
    // @ts-ignore
    return (typeof process !== 'undefined' ? process.env[key] : null) || (import.meta && (import.meta as any).env ? (import.meta as any).env[key] : null);
};

const firebaseConfig = {
    apiKey: getEnv('VITE_FIREBASE_API_KEY'),
    authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
    messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: getEnv('VITE_FIREBASE_APP_ID')
};

let app: any = null;
let db: any = null;
let auth: any = null;

const hasFirebaseConfig = Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId &&
    firebaseConfig.apiKey !== "your_api_key"
);

if (hasFirebaseConfig) {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        try {
            auth = initializeAuth(app, {
                persistence: browserSessionPersistence,
            });
        } catch (authInitError) {
            auth = getAuth(app);
        }
    } catch (e) {
    }
} else {
}

export { app, db, auth };
