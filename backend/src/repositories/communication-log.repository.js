'use strict';

const { CommunicationLog } = require('../models/communication-log.model');
const BaseRepository = require('./base.repository');

class CommunicationLogRepository extends BaseRepository {
  constructor() {
    super(CommunicationLog);
  }

  async listByDevice(deviceId, { page, limit, outcome, operation, source }) {
    const filter = { device: deviceId };
    if (outcome) {
      filter.outcome = outcome;
    }
    if (operation) {
      filter.operation = operation;
    }
    if (source) {
      filter.source = source;
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }
}

module.exports = CommunicationLogRepository;
