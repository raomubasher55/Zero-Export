'use strict';

const logger = require('../config/logger');
const { EM500_PROFILE } = require('./em500.profile');
const RegisterProfileRepository = require('../repositories/register-profile.repository');

/**
 * Built-in register profiles shipped with the application.
 *
 * Creation: profiles are created once when missing (matched by identifier).
 * Upgrade: an existing profile is replaced ONLY when it is flagged builtIn
 * and the shipped definition carries a higher metadata.profileVersion.
 * Operator-created profiles and built-in profiles at the current version are
 * never touched, so local edits are preserved between releases.
 */
const BUILTIN_PROFILES = Object.freeze([EM500_PROFILE]);

function profileVersionOf(profile) {
  return profile?.metadata?.profileVersion ?? 0;
}

async function seedBuiltinProfiles(repository = new RegisterProfileRepository()) {
  const results = [];

  for (const profile of BUILTIN_PROFILES) {
    const existing = await repository.findByIdentifier(profile.identifier);
    if (!existing) {
      await repository.create({ ...profile, builtIn: true });
      results.push({ identifier: profile.identifier, action: 'CREATED' });
      continue;
    }

    if (existing.builtIn === true && profileVersionOf(profile) > profileVersionOf(existing)) {
      await repository.updateById(existing._id, { ...profile, builtIn: true });
      results.push({ identifier: profile.identifier, action: 'UPDATED' });
      continue;
    }

    results.push({ identifier: profile.identifier, action: 'SKIPPED' });
  }

  return results;
}

async function ensureBuiltinProfiles(repository) {
  try {
    const results = await seedBuiltinProfiles(repository);
    results.forEach((result) => {
      if (result.action === 'CREATED' || result.action === 'UPDATED') {
        logger.info('Built-in register profile seeded', {
          identifier: result.identifier,
          action: result.action,
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
