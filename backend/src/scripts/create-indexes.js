'use strict';

const { disconnectDatabase, connectDatabase } = require('../config/database');
const logger = require('../config/logger');
const Device = require('../models/device.model');
const { LatestValue } = require('../models/latest-value.model');
const { CommunicationLog } = require('../models/communication-log.model');
const RegisterProfile = require('../models/register-profile.model');

async function createIndexes() {
  await connectDatabase();

  const models = [Device, RegisterProfile, LatestValue, CommunicationLog];
  const created = await Promise.all(
    models.map(async (model) => ({
      model: model.modelName,
      indexes: await model.createIndexes(),
    })),
  );

  logger.info('MongoDB indexes ensured', { models: created });
}

createIndexes()
  .then(async () => {
    await disconnectDatabase();
    logger.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('Unable to create MongoDB indexes', { error: error.stack || error.message });
    await disconnectDatabase().catch(() => undefined);
    logger.close();
    process.exit(1);
  });
