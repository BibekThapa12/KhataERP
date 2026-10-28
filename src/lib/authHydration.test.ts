import { describe, expect, it } from 'vitest'
import { shouldHydrateOnSignIn } from './authHydration'

describe('shouldHydrateOnSignIn', () => {
  it('ignores the SIGNED_IN Supabase re-emits when a tab becomes visible again', () => {
    expect(shouldHydrateOnSignIn({ event: 'SIGNED_IN', userId: 'u1', previousUserId: 'u1', dataReady: true, pathname: '/pos' })).toBe(false)
  })

  it('hydrates a real sign-in from the login page', () => {
    expect(shouldHydrateOnSignIn({ event: 'SIGNED_IN', userId: 'u1', previousUserId: null, dataReady: false, pathname: '/login' })).toBe(true)
  })

  it('hydrates when a different user signs in', () => {
    expect(shouldHydrateOnSignIn({ event: 'SIGNED_IN', userId: 'u2', previousUserId: 'u1', dataReady: true, pathname: '/' })).toBe(true)
  })

  it('retries hydration for the same user when nothing is loaded yet', () => {
    expect(shouldHydrateOnSignIn({ event: 'SIGNED_IN', userId: 'u1', previousUserId: 'u1', dataReady: false, pathname: '/' })).toBe(true)
  })

  it('never hydrates for token refreshes, sign-out or password reset', () => {
    expect(shouldHydrateOnSignIn({ event: 'TOKEN_REFRESHED', userId: 'u1', previousUserId: null, dataReady: false, pathname: '/' })).toBe(false)
    expect(shouldHydrateOnSignIn({ event: 'SIGNED_IN', userId: null, previousUserId: 'u1', dataReady: true, pathname: '/' })).toBe(false)
    expect(shouldHydrateOnSignIn({ event: 'SIGNED_IN', userId: 'u1', previousUserId: null, dataReady: false, pathname: '/reset-password' })).toBe(false)
  })
})
