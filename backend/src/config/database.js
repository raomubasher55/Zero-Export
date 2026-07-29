'use strict';

const mongoose = require('mongoose');
const { config, requireDatabaseUri } = require('./environment');
const logger = require('./logger');

let connectionPromise;

const DATABASE_STATES = Object.freeze({
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
});

mongoose.set('strictQuery', true);
mongoose.set('strict', 'throw');

mongoose.connection.on('connected', () => {
  logger.info('MongoDB connection established');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB connection closed');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB connection re-established');
});

mongoose.connection.on('error', (error) => {
  logger.error('MongoDB connection error', { error });
});

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = mongoose
    .connect(requireDatabaseUri(), {
      dbName: config.database.dbName,
      serverSelectionTimeoutMS: config.database.serverSelectionTimeoutMs,
      socketTimeoutMS: config.database.socketTimeoutMs,
      maxPoolSize: config.database.maxPoolSize,
      minPoolSize: config.database.minPoolSize,
      autoIndex: !config.isProduction,
    })
    .then((mongooseInstance) => mongooseInstance.connection)
    .finally(() => {
      connectionPromise = undefined;
    });

  return connectionPromise;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
}

function getDatabaseStatus() {
  const readyState = mongoose.connection.readyState;

  return {
    state: DATABASE_STATES[readyState] || 'unknown',
    readyState,
    connected: readyState === 1,
  };
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
};
