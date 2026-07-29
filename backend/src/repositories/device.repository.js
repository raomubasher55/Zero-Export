'use strict';

const Device = require('../models/device.model');
const { DEVICE_STATUSES } = require('../constants/modbus');
const BaseRepository = require('./base.repository');

const REGISTER_PROFILE_SUMMARY = Object.freeze({
  path: 'registerProfile',
  select: 'identifier name manufacturer model isActive updatedAt',
});

const REGISTER_PROFILE_FOR_POLLING = Object.freeze({
  path: 'registerProfile',
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class DeviceRepository extends BaseRepository {
  constructor() {
    super(Device);
  }

  async findByIdWithProfile(id) {
    return this.findById(id, { populate: REGISTER_PROFILE_SUMMARY });
  }

  async createWithProfile(payload) {
    return this.create(payload, { populate: REGISTER_PROFILE_SUMMARY });
  }

  async updateByIdWithProfile(id, payload) {
    return this.updateById(id, payload, { populate: REGISTER_PROFILE_SUMMARY });
  }

  async list({
    page,
    limit,
    search,
    protocol,
    status,
    enabled,
    registerProfileId,
    sortBy,
    sortOrder,
  }) {
    const filter = {};

    if (search) {
      const expression = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: expression }, { identifier: expression }, { site: expression }];
    }
    if (protocol) {
      filter['connection.protocol'] = protocol;
    }
    if (status) {
      filter.status = status;
    }
    if (enabled !== undefined) {
      filter.isEnabled = enabled;
    }
    if (registerProfileId) {
      filter.registerProfile = registerProfileId;
    }

    const direction = sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortBy]: direction, _id: direction };
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate(REGISTER_PROFILE_SUMMARY)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }

  async countByRegisterProfile(registerProfileId) {
    return this.countDocuments({ registerProfile: registerProfileId });
  }

  async findByIdForPolling(deviceId) {
    return this.findById(deviceId, { populate: REGISTER_PROFILE_FOR_POLLING });
  }

  async claimNextDueForPolling({ now, leaseId, leaseMs }) {
    const filter = this.buildDuePollFilter(now);
    const leaseUntil = new Date(now.getTime() + leaseMs);

    return this.model
      .findOneAndUpdate(
        filter,
        {
          $set: {
            pollLeaseId: leaseId,
            pollLeaseUntil: leaseUntil,
          },
        },
        {
          new: true,
          sort: { nextPollAt: 1, _id: 1 },
        },
      )
      .populate(REGISTER_PROFILE_FOR_POLLING)
      .lean()
      .exec();
  }

  async claimDeviceForPolling(deviceId, { now, leaseId, leaseMs }) {
    const filter = {
      _id: deviceId,
      ...this.buildDuePollFilter(now, { allowFutureDue: true }),
    };
    const leaseUntil = new Date(now.getTime() + leaseMs);

    return this.model
      .findOneAndUpdate(
        filter,
        {
          $set: {
            pollLeaseId: leaseId,
            pollLeaseUntil: leaseUntil,
          },
        },
        { new: true },
      )
      .populate(REGISTER_PROFILE_FOR_POLLING)
      .lean()
      .exec();
  }

  buildDuePollFilter(now, { allowFutureDue = false } = {}) {
    const dueFilter = allowFutureDue
      ? {}
      : {
          $or: [{ nextPollAt: { $lte: now } }, { nextPollAt: null }],
        };
    const availableLeaseFilter = {
      $or: [{ pollLeaseUntil: { $lte: now } }, { pollLeaseUntil: null }],
    };

    return {
      isEnabled: true,
      'polling.enabled': true,
      registerProfile: { $ne: null },
      $and: [dueFilter, availableLeaseFilter],
    };
  }

  async recordPollSuccess(deviceId, leaseId, { durationMs, nextPollAt, polledAt = new Date() }) {
    return this.model
      .findOneAndUpdate(
        { _id: deviceId, pollLeaseId: leaseId },
        {
          $set: {
            status: DEVICE_STATUSES.ONLINE,
            statusChangedAt: polledAt,
            lastSeenAt: polledAt,
            lastCommunicationAt: polledAt,
            lastPollAt: polledAt,
            nextPollAt,
            'statistics.consecutiveFailures': 0,
            'statistics.lastDurationMs': durationMs,
          },
          $inc: {
            'statistics.successfulPolls': 1,
          },
          $unset: {
            lastError: 1,
            pollLeaseId: 1,
            pollLeaseUntil: 1,
          },
        },
        { new: true },
      )
      .lean()
      .exec();
  }

  async recordPollFailure(deviceId, leaseId, { status, error, durationMs, nextPollAt, polledAt = new Date() }) {
    return this.model
      .findOneAndUpdate(
        { _id: deviceId, pollLeaseId: leaseId },
        {
          $set: {
            status,
            statusChangedAt: polledAt,
            lastPollAt: polledAt,
            nextPollAt,
            lastError: {
              code: error.code,
              message: error.message,
              occurredAt: polledAt,
            },
            'statistics.lastDurationMs': durationMs,
          },
          $inc: {
            'statistics.failedPolls': 1,
            'statistics.consecutiveFailures': 1,
          },
          $unset: {
            pollLeaseId: 1,
            pollLeaseUntil: 1,
          },
        },
        { new: true },
      )
      .lean()
      .exec();
  }

  async releasePollLease(deviceId, leaseId, { nextPollAt } = {}) {
    const update = {
      $unset: {
        pollLeaseId: 1,
        pollLeaseUntil: 1,
      },
    };
    if (nextPollAt) {
      update.$set = { nextPollAt };
    }

    return this.model.findOneAndUpdate({ _id: deviceId, pollLeaseId: leaseId }, update, { new: true }).lean().exec();
  }

  async updateRuntimeState(deviceId, runtimeState) {
    const update = this.buildRuntimeUpdate(runtimeState);
    return this.model.findByIdAndUpdate(deviceId, update, { new: true }).lean().exec();
  }

  async updateRuntimeStateForMany(deviceIds, runtimeState) {
    if (deviceIds.length === 0) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const update = this.buildRuntimeUpdate(runtimeState);
    return this.model.updateMany({ _id: { $in: deviceIds } }, update).exec();
  }

  buildRuntimeUpdate(runtimeState) {
    const now = runtimeState.at || new Date();
    const set = {
      status: runtimeState.status,
      statusChangedAt: now,
    };

    if (runtimeState.touchCommunication) {
      set.lastSeenAt = now;
      set.lastCommunicationAt = now;
    }
    if (runtimeState.error) {
      set.lastError = {
        message: runtimeState.error.message,
        code: runtimeState.error.code,
        occurredAt: now,
      };
    }

    const update = { $set: set };
    if (runtimeState.clearError) {
      update.$unset = { lastError: 1 };
    }

    return update;
  }
}

module.exports = DeviceRepository;
