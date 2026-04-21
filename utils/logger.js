import winston from 'winston';

const { combine, timestamp, printf, colorize, json } = winston.format;
const IS_PROD = process.env.NODE_ENV === 'production';

const devFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp, ...meta }) => {
    return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
  })
);

const prodFormat = combine(
  timestamp(),
  json()
);

const logger = winston.createLogger({
  level: IS_PROD ? 'info' : 'debug',
  format: IS_PROD ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console()
  ],
});

export default logger;
