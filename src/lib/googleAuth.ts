import { initializeApp, getApps } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: {
    prompt?: '' | 'none' | 'consent' | 'select_account';
    hint?: string;
  }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            prompt?: '' | 'none' | 'consent' | 'select_account';
            callback: (response: GisTokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => GisTokenClient;
        };
      };
    };
  }
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);

// Explicitly persist Firebase Auth session across refreshes
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {
  // Ignore if browser environment restricts storage
});

export const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  CALENDAR_READ_SCOPE,
  CALENDAR_WRITE_SCOPE,
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

let calendarWriteScopeEnabled = false;
let cachedTokenHasCalendarWrite = false;

export function setCalendarWriteAccessScopeEnabled(enabled: boolean): void {
  calendarWriteScopeEnabled = enabled;
  if (enabled && cachedAccessToken && !cachedTokenHasCalendarWrite) {
    cachedAccessToken = null;
    cachedTokenExpiresAt = 0;
  }
}

export function getActiveWorkspaceScopes(includeCalendarWrite = calendarWriteScopeEnabled): string[] {
  return WORKSPACE_SCOPES.filter((scope) =>
    includeCalendarWrite ? true : scope !== CALENDAR_WRITE_SCOPE
  );
}

function createWorkspaceProvider(
  loginHint?: string | null,
  forceConsent = false,
  includeCalendarWrite = calendarWriteScopeEnabled
): GoogleAuthProvider {
  const p = new GoogleAuthProvider();
  for (const scope of getActiveWorkspaceScopes(includeCalendarWrite)) {
    p.addScope(scope);
  }
  const customParams: Record<string, string> = {};
  if (loginHint) {
    customParams.login_hint = loginHint;
  }
  if (forceConsent) {
    customParams.prompt = 'consent';
  }
  if (Object.keys(customParams).length > 0) {
    p.setCustomParameters(customParams);
  }
  return p;
}

let isSigningIn = false;
// Access token is cached strictly in memory (never in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;
let inflightTokenPromise: Promise<string | null> | null = null;

type TokenListener = (token: string | null) => void;
const tokenListeners = new Set<TokenListener>();

function updateInMemoryToken(
  token: string | null,
  expiresInSeconds = 3300,
  hasCalendarWrite = false
) {
  cachedAccessToken = token;
  cachedTokenExpiresAt = token ? Date.now() + Math.max(300, expiresInSeconds - 180) * 1000 : 0;
  cachedTokenHasCalendarWrite = Boolean(token && hasCalendarWrite);
  for (const listener of tokenListeners) {
    listener(cachedAccessToken);
  }
}

export function onWorkspaceTokenUpdate(listener: TokenListener): () => void {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

export function clearExpiredWorkspaceToken() {
  updateInMemoryToken(null);
}

function requestGisToken(
  emailHint?: string | null,
  prompt: '' | 'consent' | 'select_account' = '',
  includeCalendarWrite = calendarWriteScopeEnabled
): Promise<string | null> {
  const oauth2 = typeof window !== 'undefined' ? window.google?.accounts?.oauth2 : undefined;
  const clientId = firebaseConfig.oAuthClientId;
  if (!oauth2 || !clientId) {
    return Promise.resolve(null);
  }

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      resolve(token);
    };

    const timer = window.setTimeout(() => finish(null), 15000);

    try {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: getActiveWorkspaceScopes(includeCalendarWrite).join(' '),
        ...(emailHint ? { hint: emailHint } : {}),
        prompt,
        callback: (resp: GisTokenResponse) => {
          window.clearTimeout(timer);
          if (resp && resp.access_token && !resp.error) {
            updateInMemoryToken(resp.access_token, resp.expires_in ?? 3599, includeCalendarWrite);
            finish(resp.access_token);
          } else {
            finish(null);
          }
        },
        error_callback: () => {
          window.clearTimeout(timer);
          finish(null);
        },
      });
      client.requestAccessToken({
        prompt,
        ...(emailHint ? { hint: emailHint } : {}),
      });
    } catch {
      window.clearTimeout(timer);
      finish(null);
    }
  });
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void,
  onSessionRestored?: (user: User) => void
) => {
  let active = true;
  let unsub: (() => void) | null = null;

  void persistenceReady.then(() => {
    if (!active) return;
    unsub = onAuthStateChanged(auth, (user: User | null) => {
      if (user) {
        if (cachedAccessToken && Date.now() < cachedTokenExpiresAt) {
          onAuthSuccess?.(user, cachedAccessToken);
        } else if (!isSigningIn) {
          onSessionRestored?.(user);
        }
      } else {
        updateInMemoryToken(null);
        onAuthFailure?.();
      }
    });
  });

  return () => {
    active = false;
    unsub?.();
  };
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  await persistenceReady;
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, createWorkspaceProvider(auth.currentUser?.email));
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google sign-in.');
    }
    updateInMemoryToken(credential.accessToken, 3500, calendarWriteScopeEnabled);
    return { user: result.user, accessToken: credential.accessToken };
  } finally {
    isSigningIn = false;
  }
};

export const refreshWorkspaceAccess = async (): Promise<{ user: User; accessToken: string } | null> => {
  await persistenceReady;
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return googleSignIn();
  }
  try {
    isSigningIn = true;
    const gisToken = await requestGisToken(currentUser.email, '', calendarWriteScopeEnabled);
    if (gisToken) {
      return { user: currentUser, accessToken: gisToken };
    }
    const provider = createWorkspaceProvider(currentUser.email);
    const result = await reauthenticateWithPopup(currentUser, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to refresh Google Workspace access token.');
    }
    updateInMemoryToken(credential.accessToken, 3500, calendarWriteScopeEnabled);
    return { user: result.user, accessToken: credential.accessToken };
  } catch {
    const result = await signInWithPopup(auth, createWorkspaceProvider(currentUser.email));
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to refresh Google Workspace access token.');
    }
    updateInMemoryToken(credential.accessToken, 3500, calendarWriteScopeEnabled);
    return { user: result.user, accessToken: credential.accessToken };
  } finally {
    isSigningIn = false;
  }
};

/**
 * Automatically ensures a valid in-memory OAuth2 access token is available
 * for the signed-in Google Workspace user, renewing silently via GIS when needed.
 */
export const ensureWorkspaceToken = async (): Promise<string | null> => {
  if (cachedAccessToken && Date.now() < cachedTokenExpiresAt) {
    return cachedAccessToken;
  }
  await persistenceReady;
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return null;
  }
  if (inflightTokenPromise) {
    return inflightTokenPromise;
  }

  inflightTokenPromise = (async () => {
    try {
      const gisToken = await requestGisToken(currentUser.email, '');
      if (gisToken) {
        return gisToken;
      }
      const refreshed = await refreshWorkspaceAccess();
      return refreshed?.accessToken ?? null;
    } catch {
      return null;
    } finally {
      inflightTokenPromise = null;
    }
  })();

  return inflightTokenPromise;
};

export const requestWorkspaceConsent = async (options?: {
  includeCalendarWrite?: boolean;
}): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  await persistenceReady;
  const currentUser = auth.currentUser;
  const includeCalendarWrite = options?.includeCalendarWrite ?? calendarWriteScopeEnabled;
  try {
    isSigningIn = true;
    if (currentUser) {
      const gisToken = await requestGisToken(currentUser.email, 'consent', includeCalendarWrite);
      if (gisToken) {
        return { user: currentUser, accessToken: gisToken };
      }
      const result = await reauthenticateWithPopup(
        currentUser,
        createWorkspaceProvider(currentUser.email, true, includeCalendarWrite)
      );
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        updateInMemoryToken(credential.accessToken, 3500, includeCalendarWrite);
        return { user: result.user, accessToken: credential.accessToken };
      }
    }
    const result = await signInWithPopup(
      auth,
      createWorkspaceProvider(currentUser?.email, true, includeCalendarWrite)
    );
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Workspace consent token.');
    }
    updateInMemoryToken(credential.accessToken, 3500, includeCalendarWrite);
    return { user: result.user, accessToken: credential.accessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => {
  if (cachedAccessToken && Date.now() < cachedTokenExpiresAt) {
    return cachedAccessToken;
  }
  return null;
};

export const hasWorkspaceToken = (): boolean => Boolean(getAccessToken());

export const logoutGoogle = async () => {
  await auth.signOut();
  updateInMemoryToken(null);
};
