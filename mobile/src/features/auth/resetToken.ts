// The token that proves the reset code was right. It lives in memory only: not in a route param (a web URL ends up in
// history) and not on disk. Leaving the New password screen (or killing the app) drops it.
let token: string | null = null;

export const resetToken = {
  set: (t: string) => void (token = t),
  get: () => token,
  clear: () => void (token = null),
};
