export function newPasswordValidationError(password: string, confirmation: string) {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Use at least 8 characters including a letter and a number.'
  }
  if (password !== confirmation) return 'The passwords do not match.'
  return null
}
