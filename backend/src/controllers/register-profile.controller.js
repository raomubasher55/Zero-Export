'use strict';

const HTTP_STATUS = require('../constants/http-status');
const RegisterProfileService = require('../services/register-profile.service');
const { sendNoContent, sendSuccess } = require('../utils/api-response');

class RegisterProfileController {
  constructor(registerProfileService = new RegisterProfileService()) {
    this.registerProfileService = registerProfileService;

    this.list = this.list.bind(this);
    this.getById = this.getById.bind(this);
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.delete = this.delete.bind(this);
  }

  async list(req, res) {
    const result = await this.registerProfileService.list(req.validated.query);
    return sendSuccess(res, {
      data: result.items,
      meta: { pagination: result.pagination },
    });
  }

  async getById(req, res) {
    const profile = await this.registerProfileService.getById(req.validated.params.registerProfileId);
    return sendSuccess(res, { data: profile });
  }

  async create(req, res) {
    const profile = await this.registerProfileService.create(req.validated.body);
    return sendSuccess(res, {
      statusCode: HTTP_STATUS.CREATED,
      data: profile,
    });
  }

  async update(req, res) {
    const profile = await this.registerProfileService.update(
      req.validated.params.registerProfileId,
      req.validated.body,
    );
    return sendSuccess(res, { data: profile });
  }

  async delete(req, res) {
    await this.registerProfileService.delete(req.validated.params.registerProfileId);
    return sendNoContent(res);
  }
}

module.exports = RegisterProfileController;
