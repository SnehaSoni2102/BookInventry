/** Small deny-list of the most common passwords (lower-case). Not a substitute for length rules. */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'iloveyou', 'admin123', 'administrator', 'welcome1',
  'welcome123', 'letmein1', 'abc12345', 'abcd1234', '11111111', '00000000', 'changeme', 'changeme123',
  'changeme123!', 'bookstall', 'bookstall1', 'books123', 'india123', 'monkey123', 'dragon123',
  'football1', 'sunshine1', 'princess1', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'master123', 'login123',
]);
