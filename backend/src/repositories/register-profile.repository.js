'use strict';

const RegisterProfile = require('../models/register-profile.model');
const BaseRepository = require('./base.repository');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class RegisterProfileRepository extends BaseRepository {
  constructor() {
    super(RegisterProfile);
  }

  async list({ page, limit, search, active, manufacturer, sortBy, sortOrder }) {
    const filter = {};

    if (search) {
      const expression = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: expression }, { identifier: expression }, { manufacturer: expression }];
    }
    if (active !== undefined) {
      filter.isActive = active;
    }
    if (manufacturer) {
      filter.manufacturer = new RegExp(`^${escapeRegex(manufacturer)}$`, 'i');
    }

    const direction = sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortBy]: direction, _id: direction };
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.model.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }
}

module.exports = RegisterProfileRepository;
