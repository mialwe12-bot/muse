export default (error?: string | Error): string => {
  let str = 'unbekannter Fehler';

  if (error) {
    if (typeof error === 'string') {
      str = `🚫 Fehler: ${error}`;
    } else if (error instanceof Error) {
      str = `🚫 Fehler: ${error.message}`;
    }
  }

  return str;
};
