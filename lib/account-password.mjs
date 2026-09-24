export function loginEmail(identifier) {
  const value = identifier.trim().toLowerCase();
  return value === 'admin' ? 'decoracaoeestilo@hotmail.com' : value;
}

export async function changePassword(auth, { currentPassword, password, confirmation, recovery = false }) {
  if (password.length < 8 || password.length > 128) throw new Error('Use uma senha de 8 a 128 caracteres.');
  if (password !== confirmation) throw new Error('A confirmação não corresponde à nova senha.');
  const account = await auth.getUser();
  if (account.error || !account.data?.user?.email) throw new Error('Sua sessão expirou. Entre novamente ou solicite outro link de recuperação.');
  if (!recovery) {
    if (!currentPassword) throw new Error('Informe sua senha atual.');
    const verified = await auth.signInWithPassword({ email: account.data.user.email, password: currentPassword });
    if (verified.error) throw new Error('A senha atual não confere.');
    if (verified.data?.user?.id !== account.data.user.id) throw new Error('A conta mudou. Entre novamente antes de alterar a senha.');
  }
  const result = await auth.updateUser({ password });
  if (result.error) {
    if (result.error.code === 'same_password') throw new Error('Escolha uma senha diferente da atual.');
    if (result.error.code === 'weak_password') throw new Error('Escolha uma senha mais forte, combinando letras, números e símbolos.');
    throw new Error('Não foi possível alterar a senha. Entre novamente ou solicite outro link e tente de novo.');
  }
}
