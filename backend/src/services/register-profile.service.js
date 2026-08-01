'use strict';

const HTTP_STATUS = require('../constants/http-status');
const ERROR_CODES = require('../constants/error-codes');
const DeviceRepository = require('../repositories/device.repository');
const RegisterProfileRepository = require('../repositories/register-profile.repository');
const {
  BUILTIN_PROFILES,
  seedBuiltinProfiles,
} = require('../seed/builtin-profiles');
const AppError = require('../utils/app-error');
const { buildPaginationMeta } = require('../utils/pagination');

function notFound(message) {
  return new AppError(message, {
    statusCode: HTTP_STATUS.NOT_FOUND,
    code: ERROR_CODES.NOT_FOUND,
  });
}

function portableRegister(register) {
  return {
    key: register.key,
    name: register.name,
    description: register.description ?? null,
    registerType: register.registerType,
    address: register.address,
    dataType: register.dataType,
    length: register.length,
    byteOrder: register.byteOrder,
    wordOrder: register.wordOrder,
    bitIndex: register.bitIndex ?? 0,
    scaleFactor: register.scaleFactor ?? 1,
    offset: register.offset ?? 0,
    unit: register.unit ?? null,
    group: register.group ?? null,
    writable: register.writable ?? false,
    enabled: register.enabled ?? true,
    sortOrder: register.sortOrder ?? 0,
  };
}

function portableProfile(profile) {
  return {
    identifier: profile.identifier,
    name: profile.name,
    description: profile.description ?? null,
    manufacturer: profile.manufacturer ?? null,
    model: profile.model ?? null,
    registers: (profile.registers || []).map(portableRegister),
    isActive: profile.isActive ?? true,
    tags: profile.tags || [],
    metadata: profile.metadata ?? null,
  };
}

function exportDocument(profiles) {
  return {
    format: 'zero-export-register-profiles',
    version: 1,
    exportedAt: new Date().toISOString(),
    profileCount: profiles.length,
    profiles: profiles.map(portableProfile),
  };
}

class RegisterProfileService {
  constructor({ registerProfileRepository, deviceRepository } = {}) {
    this.registerProfileRepository = registerProfileRepository || new RegisterProfileRepository();
    this.deviceRepository = deviceRepository || new DeviceRepository();
  }

  async list(query) {
    const { items, total } = await this.registerProfileRepository.list(query);

    return {
      items,
      pagination: buildPaginationMeta({
        page: query.page,
        limit: query.limit,
        total,
      }),
    };
  }

  async getById(registerProfileId) {
    const profile = await this.registerProfileRepository.findById(registerProfileId);
    if (!profile) {
      throw notFound('Register profile was not found.');
    }

    return profile;
  }

  async exportAll() {
    const profiles = await this.registerProfileRepository.findAllForExport();
    return exportDocument(profiles);
  }

  async exportById(registerProfileId) {
    const profile = await this.registerProfileRepository.findById(registerProfileId);
    if (!profile) {
      throw notFound('Register profile was not found.');
    }
    return exportDocument([profile]);
  }

  async importFile({ profiles, conflictStrategy }) {
    const existingProfiles = await Promise.all(
      profiles.map((profile) => this.registerProfileRepository.findByIdentifier(profile.identifier)),
    );

    if (conflictStrategy === 'ERROR') {
      const conflicts = profiles
        .map((profile, index) => (existingProfiles[index] ? profile.identifier : null))
        .filter(Boolean);
      if (conflicts.length > 0) {
        throw new AppError('Import contains identifiers that already exist.', {
          statusCode: HTTP_STATUS.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          details: conflicts.map((identifier) => ({
            field: 'profiles.identifier',
            message: `Profile "${identifier}" already exists.`,
            code: 'PROFILE_IMPORT_CONFLICT',
          })),
        });
      }
    }

    const results = [];
    for (const [index, profile] of profiles.entries()) {
      const existing = existingProfiles[index];
      if (existing && conflictStrategy === 'SKIP') {
        results.push({ identifier: profile.identifier, action: 'SKIPPED', profileId: String(existing._id) });
      } else if (existing) {
        const updated = await this.registerProfileRepository.updateById(existing._id, profile);
        results.push({ identifier: profile.identifier, action: 'UPDATED', profileId: String(updated._id) });
      } else {
        const created = await this.registerProfileRepository.create(profile);
        results.push({ identifier: profile.identifier, action: 'CREATED', profileId: String(created._id) });
      }
    }

    return {
      format: 'zero-export-register-profiles',
      version: 1,
      conflictStrategy,
      total: profiles.length,
      created: results.filter((result) => result.action === 'CREATED').length,
      updated: results.filter((result) => result.action === 'UPDATED').length,
      skipped: results.filter((result) => result.action === 'SKIPPED').length,
      results,
    };
  }

  async create(input) {
    return this.registerProfileRepository.create(input);
  }

  /**
   * Re-create any built-in profiles (e.g. Eastron EM500) whose identifier was
   * deleted. Profiles that still exist are reported as already present and
   * are never overwritten.
   */
  async restoreBuiltIns() {
    const results = await seedBuiltinProfiles(this.registerProfileRepository);
    return {
      total: BUILTIN_PROFILES.length,
      restored: results
        .filter((result) => result.action === 'CREATED')
        .map((result) => result.identifier),
      alreadyPresent: results
        .filter((result) => result.action === 'SKIPPED')
        .map((result) => result.identifier),
    };
  }

  async update(registerProfileId, input) {
    const updatedProfile = await this.registerProfileRepository.updateById(registerProfileId, input);
    if (!updatedProfile) {
      throw notFound('Register profile was not found.');
    }

    return updatedProfile;
  }

  async delete(registerProfileId) {
    const assignedDeviceCount = await this.deviceRepository.countByRegisterProfile(registerProfileId);
    if (assignedDeviceCount > 0) {
      throw new AppError('Register profile cannot be deleted while devices are assigned to it.', {
        statusCode: HTTP_STATUS.CONFLICT,
        code: ERROR_CODES.CONFLICT,
        details: [
          {
            field: 'registerProfileId',
            message: `${assignedDeviceCount} device(s) still reference this profile. Reassign or remove them first.`,
            code: 'PROFILE_IN_USE',
          },
        ],
      });
    }

    const deletedProfile = await this.registerProfileRepository.deleteById(registerProfileId);
    if (!deletedProfile) {
      throw notFound('Register profile was not found.');
    }

    return deletedProfile;
  }
}

module.exports = RegisterProfileService;
