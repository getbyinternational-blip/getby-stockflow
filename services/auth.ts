import { auth, db } from './firebase';
import {
  createUserWithEmailAndPassword,
  getIdTokenResult,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { clearAccessSession } from '../src/auth/simplePermissions';

const GENERIC_AUTH_ERROR =
  'Unable to complete the request. Please check your credentials and try again.';

const GENERIC_RESET_RESPONSE =
  'If the email exists, a password reset link has been sent.';

const VERIFICATION_SENT_RESPONSE =
  'If the email address is valid, a verification link has been sent.';

type AuthResult = {
  success: boolean;
  message?: string;
};

type LoginResult = AuthResult & {
  requiresVerification?: boolean;
};

const safeSignOut = async (): Promise<void> => {
  if (!auth) return;

  try {
    await signOut(auth);
  } catch {
    // Do not replace the original operation result with a sign-out error.
  }
};

const hasVerifiedEmailToken = async (user: User): Promise<boolean> => {
  await reload(user);

  const tokenResult = await getIdTokenResult(user, true);

  return (
    user.emailVerified === true &&
    tokenResult.claims.email_verified === true
  );
};

export const getCurrentUser = (): string | null => {
  return auth?.currentUser?.email || null;
};

if (auth) {
  onAuthStateChanged(auth, () => {
    // Intentionally no business/session local persistence.
  });
}

export const login = async (
  email: string,
  password: string,
): Promise<LoginResult> => {
  if (!auth) {
    return {
      success: false,
      message: 'Firebase not configured.',
    };
  }

  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password,
    );

    const user = userCredential.user;
    const verifiedForFirestore = await hasVerifiedEmailToken(user);

    if (!verifiedForFirestore) {
      await safeSignOut();

      return {
        success: false,
        requiresVerification: true,
        message:
          'Your email address is not verified. Please verify your email before logging in.',
      };
    }

    if (db) {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          uid: user.uid,
          email: user.email || email,
          name: user.displayName || email.split('@')[0],
          createdAt: new Date().toISOString(),
        });
      }
    }

    return { success: true };
  } catch {
    await safeSignOut();

    return {
      success: false,
      message: GENERIC_AUTH_ERROR,
    };
  }
};

export const register = async (
  email: string,
  password: string,
  name: string,
): Promise<AuthResult> => {
  if (!auth) {
    return {
      success: false,
      message: 'Firebase not configured.',
    };
  }

  let createdUser = false;

  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );

    createdUser = true;
    const user = userCredential.user;

    if (db) {
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        name: name.trim(),
        email: user.email || email,
        createdAt: new Date().toISOString(),
      });
    }

    await sendEmailVerification(user);

    return { success: true };
  } catch (error: unknown) {
    const errorCode =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : '';

    if (errorCode === 'auth/email-already-in-use') {
      return {
        success: false,
        message:
          'Unable to complete the request. Please use a different email or log in.',
      };
    }

    return {
      success: false,
      message: GENERIC_AUTH_ERROR,
    };
  } finally {
    // Firebase signs a newly registered user in automatically.
    // Sign out before the app can treat the unverified account as an active session.
    if (createdUser) {
      await safeSignOut();
    }
  }
};

export const resetPassword = async (
  email: string,
): Promise<AuthResult> => {
  if (!auth) {
    return {
      success: false,
      message: 'Firebase not configured.',
    };
  }

  try {
    await sendPasswordResetEmail(auth, email);
  } catch {
    // Keep the response generic to avoid revealing whether the email exists.
  }

  return {
    success: true,
    message: GENERIC_RESET_RESPONSE,
  };
};

export const resendVerificationEmail = async (
  email: string,
  password: string,
): Promise<AuthResult> => {
  if (!auth) {
    return {
      success: false,
      message: 'Firebase not configured.',
    };
  }

  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password,
    );

    const user = userCredential.user;
    await reload(user);

    if (!user.emailVerified) {
      await sendEmailVerification(user);
    }
  } catch {
    // Keep the response generic to avoid exposing account state.
  } finally {
    await safeSignOut();
  }

  return {
    success: true,
    message: VERIFICATION_SENT_RESPONSE,
  };
};

export const logout = async (): Promise<void> => {
  clearAccessSession();
  await safeSignOut();
  window.location.reload();
};