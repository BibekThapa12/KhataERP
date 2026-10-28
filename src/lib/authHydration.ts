/**
 * Supabase auth-js re-emits SIGNED_IN for the existing session every time a tab becomes
 * visible again. Only a sign-in that changes the user, or one with no company data loaded
 * yet, should reload the company; otherwise open screens (POS cart, forms) would unmount.
 */
export function shouldHydrateOnSignIn(input: { event: string; userId: string | null; previousUserId: string | null; dataReady: boolean; pathname: string }) {
  if (input.event !== 'SIGNED_IN' || !input.userId || input.pathname === '/reset-password') return false
  return input.userId !== input.previousUserId || !input.dataReady
}
