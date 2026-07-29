'use strict';

/**
 * Shared persistence primitives. Domain repositories own filters, population,
 * and indexes; services never issue Mongoose queries directly.
 */
class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  applyPopulate(query, populate) {
    if (!populate) {
      return query;
    }

    const definitions = Array.isArray(populate) ? populate : [populate];
    definitions.forEach((definition) => query.populate(definition));
    return query;
  }

  async findById(id, { populate } = {}) {
    const query = this.applyPopulate(this.model.findById(id), populate);
    return query.lean().exec();
  }

  async findOne(filter, { populate } = {}) {
    const query = this.applyPopulate(this.model.findOne(filter), populate);
    return query.lean().exec();
  }

  async create(payload, { populate } = {}) {
    const document = await this.model.create(payload);

    if (populate) {
      await document.populate(populate);
    }

    return document.toJSON();
  }

  async updateById(id, payload, { populate } = {}) {
    const document = await this.model.findById(id).exec();
    if (!document) {
      return null;
    }

    document.set(payload);
    await document.save();

    if (populate) {
      await document.populate(populate);
    }

    return document.toJSON();
  }

  async deleteById(id) {
    const document = await this.model.findByIdAndDelete(id).exec();
    return document ? document.toJSON() : null;
  }

  async countDocuments(filter = {}) {
    return this.model.countDocuments(filter).exec();
  }
}

module.exports = BaseRepository;
