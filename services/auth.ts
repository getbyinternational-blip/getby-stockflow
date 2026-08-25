import { auth, db } from './firebase';
import {
  createUserWithEmailAndPassword,
  getIdTokenResult,
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

const AUTH_REQUEST_TIMEOUT_MS = 12000;

const AUTH_TIMEOUT_MESSAGE =
  'Login timed out. Please check your internet connection and try again.';

const VERIFICATION_SENT_RESPONSE =
  'If the email address is valid, a verification link has been sent.';

type AuthResult = {
  success: boolean;
  message?: string;
};

type LoginResult = AuthResult & {
  requiresVerification?: boolean;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      window.clearTimeout(timer);
    }
  }
};


/**
 * Safely signs out Firebase without replacing the original
 * operation result with a secondary sign-out error.
 */
const safeSignOut = async (): Promise<void> => {
  if (!auth) return;

  try {
    await signOut(auth);
  } catch {
    // Intentionally ignored.
  }
};

/**
 * Firestore security rules use the Firebase ID token.
 *
 * user.emailVerified alone is not enough because it may be stale
 * after the user verifies their email in another tab/browser.
 *
 * Reload the Firebase user and force-refresh the ID token before
 * allowing the application to proceed to owner-only Firestore data.
 */
const hasVerifiedEmailToken = async (
  user: User,
): Promise<boolean> => {
  await withTimeout(
    reload(user),
    AUTH_REQUEST_TIMEOUT_MS,
    AUTH_TIMEOUT_MESSAGE,
  );

  if (!user.emailVerified) {
    return false;
  }

  const tokenResult = await withTimeout(
    getIdTokenResult(user, true),
    AUTH_REQUEST_TIMEOUT_MS,
    AUTH_TIMEOUT_MESSAGE,
  );

  return (
    user.emailVerified === true &&
    tokenResult.claims.email_verified === true
  );
};

export const getCurrentUser = (): string | null => {
  return auth?.currentUser?.email || null;
};

/**
 * Firebase account login.
 *
 * This authenticates the real Firebase user.
 * ERP/Admin/Staff OTP access is handled separately by RoleLoginModal.
 */
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
    const userCredential =
      await withTimeout(
        signInWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        ),
        AUTH_REQUEST_TIMEOUT_MS,
        AUTH_TIMEOUT_MESSAGE,
      );

    const user = userCredential.user;

    /*
     * IMPORTANT:
     *
     * Firestore rules check:
     *
     * request.auth.token.email_verified == true
     *
     * Therefore we force-refresh the Firebase user and ID token
     * before allowing the login to complete.
     */
    const verifiedForFirestore =
      await hasVerifiedEmailToken(user);

    if (!verifiedForFirestore) {
      await safeSignOut();

      return {
        success: false,
        requiresVerification: true,
        message:
          'Your email address is not verified. Please verify your email before logging in.',
      };
    }

    /*
     * Ensure /users/{uid} exists.
     *
     * This document is separate from /stores/{uid}.
     * storage.ts will initialize /stores/{uid} after the verified
     * Firebase session is ready.
     */
    if (db) {
      const userDocRef = doc(
        db,
        'users',
        user.uid,
      );

      const userDoc =
        await getDoc(userDocRef);

      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          uid: user.uid,
          email:
            user.email ||
            email.trim(),
          name:
            user.displayName ||
            email.trim().split('@')[0],
          createdAt:
            new Date().toISOString(),
        });
      }
    }

    return {
      success: true,
    };
  } catch (error: unknown) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null;

    if (error instanceof Error && error.message === AUTH_TIMEOUT_MESSAGE) {
      await safeSignOut();

      return {
        success: false,
        message: AUTH_TIMEOUT_MESSAGE,
      };
    }

    await safeSignOut();

    return {
      success: false,
      message: code ? `Login failed (${code}). Please try again.` : GENERIC_AUTH_ERROR,
    };
  }
};

/**
 * Register a new Firebase account.
 *
 * Firebase automatically signs a newly-created account in.
 * The user is NOT verified yet, so we intentionally sign them
 * back out after sending the verification email.
 *
 * storage.ts must also ignore this temporary unverified session.
 */
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
    const normalizedEmail =
      email.trim();

    const userCredential =
      await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        password,
      );

    createdUser = true;

    const user =
      userCredential.user;

    /*
     * /users/{uid} is allowed before email verification
     * by your Firestore rules.
     *
     * Do NOT create /stores/{uid} here because store access
     * requires a verified Firebase ID token.
     */
    if (db) {
      await setDoc(
        doc(
          db,
          'users',
          user.uid,
        ),
        {
          uid: user.uid,
          name: name.trim(),
          email:
            user.email ||
            normalizedEmail,
          createdAt:
            new Date().toISOString(),
        },
      );
    }

    await sendEmailVerification(
      user,
    );

    return {
      success: true,
    };
  } catch (error: unknown) {
    const errorCode =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (
        error as {
          code?: unknown;
        }
      ).code === 'string'
        ? (
            error as {
              code: string;
            }
          ).code
        : '';

    if (
      errorCode ===
      'auth/email-already-in-use'
    ) {
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
    /*
     * Firebase signs a newly registered user in automatically.
     *
     * Do not leave that unverified Firebase session alive because
     * stores/{uid} requires email_verified == true.
     */
    if (createdUser) {
      await safeSignOut();
    }
  }
};

/**
 * Password reset deliberately uses a generic response so the
 * application does not reveal whether an email account exists.
 */
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
    await sendPasswordResetEmail(
      auth,
      email.trim(),
    );
  } catch {
    // Intentionally keep response generic.
  }

  return {
    success: true,
    message: GENERIC_RESET_RESPONSE,
  };
};

/**
 * Resends the Firebase verification email.
 *
 * We temporarily authenticate the account, send the email when
 * required, then always sign out again.
 */
export const resendVerificationEmail =
  async (
    email: string,
    password: string,
  ): Promise<AuthResult> => {
    if (!auth) {
      return {
        success: false,
        message:
          'Firebase not configured.',
      };
    }

    try {
      const userCredential =
        await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );

      const user =
        userCredential.user;

      await reload(user);

      if (!user.emailVerified) {
        await sendEmailVerification(
          user,
        );
      }
    } catch {
      /*
       * Generic response prevents exposing whether an account
       * exists or whether it is already verified.
       */
    } finally {
      await safeSignOut();
    }

    return {
      success: true,
      message:
        VERIFICATION_SENT_RESPONSE,
    };
  };

/**
 * Full Firebase logout.
 */
export const logout =
  async (): Promise<void> => {
    clearAccessSession();

    await safeSignOut();

    window.location.reload();
  };