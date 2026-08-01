'use strict';

const logger = require('../config/logger');
const { EM500_PROFILE } = require('./em500.profile');
const RegisterProfileRepository = require('../repositories/register-profile.repository');

/**
 * Built-in register profiles shipped with the application.
 *
 * Profiles are created once when missing (matched by identifier) so operator
 * edits are never overwritten. Removing a built-in profile intentionally is
 * respected until the database is recreated; it is re-seeded only when the
 * identifier no longer exists.
 */
const BUILTIN_PROFILES = Object.freeze([EM500_PROFILE]);

async function seedBuiltinProfiles(repository = new RegisterProfileRepository()) {
  const results = [];

  for (const profile of BUILTIN_PROFILES) {
    const existing = await repository.findByIdentifier(profile.identifier);
    if (existing) {
      results.push({ identifier: profile.identifier, action: 'SKIPPED' });
      continue;
    }

    await repository.create({ ...profile, builtIn: true });
    results.push({ identifier: profile.identifier, action: 'CREATED' });
  }

  return results;
}

async function ensureBuiltinProfiles(repository) {
  try {
    const results = await seedBuiltinProfiles(repository);
    results.forEach((result) => {
      if (result.action === 'CREATED') {
        logger.info('Built-in register profile seeded', {
          identifier: result.identifier,
        });
      }
    });
    return results;
  } catch (error) {
    logger.error('Unable to seed built-in register profiles', {
      error: error.stack || error.message,
    });
    return [];
  }
}

module.exports = {
  BUILTIN_PROFILES,
  ensureBuiltinProfiles,
  seedBuiltinProfiles,
};
