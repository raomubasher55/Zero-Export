'use strict';

const { LatestValue } = require('../models/latest-value.model');
const BaseRepository = require('./base.repository');

class LatestValueRepository extends BaseRepository {
  constructor() {
    super(LatestValue);
  }

  async bulkUpsert(device, registerProfile, values, sampledAt = new Date()) {
    if (values.length === 0) {
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }

    const operations = values.map((value) => ({
      updateOne: {
        filter: {
          device: device._id,
          registerKey: value.registerKey,
        },
        update: {
          $set: {
            device: device._id,
            registerProfile: registerProfile._id,
            registerKey: value.registerKey,
            registerName: value.registerName,
            registerType: value.registerType,
            address: value.address,
            dataType: value.dataType,
            group: value.group,
            unit: value.unit,
            value: value.value,
            rawValue: value.rawValue,
            rawValues: value.rawValues,
            quality: value.quality,
            sampledAt,
          },
        },
        upsert: true,
      },
    }));

    return this.model.bulkWrite(operations, { ordered: false });
  }

  async listByDevice(deviceId, { page, limit, group, quality, registerKey }) {
    const filter = { device: deviceId };
    if (group) {
      filter.group = group;
    }
    if (quality) {
      filter.quality = quality;
    }
    if (registerKey) {
      filter.registerKey = registerKey;
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ group: 1, registerKey: 1 }).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }

  async findByDeviceAndKey(deviceId, registerKey) {
    return this.model.findOne({ device: deviceId, registerKey }).lean().exec();
  }

  async findForSources(sources) {
    if (sources.length === 0) {
      return [];
    }

    return this.model
      .find({
        $or: sources.map((source) => ({
          device: source.deviceId,
          registerKey: source.registerKey,
        })),
      })
      .lean()
      .exec();
  }
}

module.exports = LatestValueRepository;
