// Turns server error codes into short Russian messages for the user. No imports (unit-tested in Node).

const BY_CODE: Record<string, string> = {
  // PostgreSQL SQLSTATE raised by the stock functions
  '42501': 'Недостаточно прав для этого действия',
  P0002: 'Не найдено — возможно, запись удалили',
  '22023': 'Проверьте введённые данные',
  '55000': 'Операция уже выполнена или недоступна',
  // Supabase Auth
  invalid_credentials: 'Неверный логин или пароль',
  over_request_rate_limit: 'Слишком много попыток. Попробуйте через несколько минут',
  over_email_send_rate_limit: 'Слишком много писем. Попробуйте позже',
  user_banned: 'Доступ заблокирован. Обратитесь к владельцу компании',
  weak_password: 'Пароль слишком простой — нужно не меньше 10 символов',
};

export const NETWORK_MESSAGE = 'Не удалось связаться с сервером. Проверьте интернет и попробуйте снова';

export function messageForCode(code: string | null | undefined): string {
  return (code && BY_CODE[code]) || NETWORK_MESSAGE;
}
