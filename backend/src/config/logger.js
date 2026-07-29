'use strict';

const fs = require('node:fs');
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { config } = require('./environment');

const { combine, timestamp, errors, json, colorize, printf } = format;

const developmentFormat = combine(
  colorize(),
  timestamp(),
  errors({ stack: true }),
  printf(({ timestamp: loggedAt, level, message, stack, ...metadata }) => {
    const extra = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : '';
    return `${loggedAt} ${level}: ${stack || message}${extra}`;
  }),
);

const activeTransports = [
  new transports.Console({
    format: config.isProduction ? combine(timestamp(), errors({ stack: true }), json()) : developmentFormat,
  }),
];

if (config.logging.fileEnabled) {
  fs.mkdirSync(config.logging.directory, { recursive: true });
  activeTransports.push(
    new DailyRotateFile({
      dirname: config.logging.directory,
      filename: 'ems-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: combine(timestamp(), errors({ stack: true }), json()),
    }),
  );
}

const logger = createLogger({
  level: config.logging.level,
  defaultMeta: {
    service: 'zero-export-modbus-core',
    environment: config.environment,
  },
  transports: activeTransports,
  exitOnError: false,
});

module.exports = logger;
