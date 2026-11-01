import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEMO_LOGIN, DEMO_PASSWORD } from '@/api/demo';
import { Field, Message, PrimaryButton } from '@/components/ui';
import { useSession } from '@/state/session';
import { userMessage } from '@/state/use-stock-data';
import { space, type, usePalette } from '@/theme';

export default function LoginScreen() {
  const { api, problem, session, ready } = useSession();
  const c = usePalette();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ready && session) return <Redirect href="/" />;

  async function handleSubmit() {
    if (!api) return;
    if (!login.trim() || !password) {
      setError('Введите логин и пароль');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.signIn(login, password);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
        <View style={styles.form}>
          <Text accessibilityRole="header" style={[type.largeTitle, { color: c.text }]}>Мой склад</Text>
          <Text style={[type.body, styles.subtitle, { color: c.secondary }]}>Войдите, чтобы продолжить</Text>
          {problem ? <Message tone="error" text={problem} /> : null}
          {api?.isDemo ? <Message tone="info" text={`Демо-режим, вымышленные данные: ${DEMO_LOGIN} / ${DEMO_PASSWORD}`} /> : null}
          <View style={styles.fields}>
            <Field value={login} onChangeText={setLogin} placeholder="Email или телефон" autoCapitalize="none"
              autoComplete="username" textContentType="username" keyboardType="email-address" accessibilityLabel="Логин" />
            <Field value={password} onChangeText={setPassword} placeholder="Пароль" secureTextEntry autoComplete="password"
              textContentType="password" accessibilityLabel="Пароль" onSubmitEditing={handleSubmit} />
          </View>
          {error ? <Message tone="error" text={error} /> : null}
          <PrimaryButton title="Войти" onPress={handleSubmit} busy={busy} disabled={!api} />
          <Text style={[type.footnote, styles.hint, { color: c.secondary }]}>Нет доступа? Попросите владельца компании пригласить вас.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: space.l },
  form: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  subtitle: { marginTop: space.xs, marginBottom: space.l },
  fields: { marginTop: space.l },
  hint: { marginTop: space.l, textAlign: 'center' },
});
