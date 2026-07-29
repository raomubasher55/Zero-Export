'use strict';

const HTTP_STATUS = require('../constants/http-status');
const ERROR_CODES = require('../constants/error-codes');
const DeviceRepository = require('../repositories/device.repository');
const RegisterProfileRepository = require('../repositories/register-profile.repository');
const AppError = require('../utils/app-error');
const { buildPaginationMeta } = require('../utils/pagination');

function notFound(message) {
  return new AppError(message, {
    statusCode: HTTP_STATUS.NOT_FOUND,
    code: ERROR_CODES.NOT_FOUND,
  });
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

  async create(input) {
    return this.registerProfileRepository.create(input);
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
