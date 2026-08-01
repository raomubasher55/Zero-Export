'use strict';

const HTTP_STATUS = require('../constants/http-status');
const RegisterProfileService = require('../services/register-profile.service');
const { sendNoContent, sendSuccess } = require('../utils/api-response');

class RegisterProfileController {
  constructor(registerProfileService = new RegisterProfileService()) {
    this.registerProfileService = registerProfileService;

    this.list = this.list.bind(this);
    this.getById = this.getById.bind(this);
    this.exportAll = this.exportAll.bind(this);
    this.exportById = this.exportById.bind(this);
    this.importFile = this.importFile.bind(this);
    this.restoreBuiltIns = this.restoreBuiltIns.bind(this);
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

  async exportAll(_req, res) {
    const document = await this.registerProfileService.exportAll();
    return this.sendExport(res, document, 'register-profiles.json');
  }

  async exportById(req, res) {
    const document = await this.registerProfileService.exportById(
      req.validated.params.registerProfileId,
    );
    const identifier = document.profiles[0].identifier.replace(/[^a-z0-9._-]/gi, '_');
    return this.sendExport(res, document, `register-profile-${identifier}.json`);
  }

  async importFile(req, res) {
    const result = await this.registerProfileService.importFile(req.validated.body);
    return sendSuccess(res, { data: result });
  }

  async restoreBuiltIns(_req, res) {
    const result = await this.registerProfileService.restoreBuiltIns();
    return sendSuccess(res, { data: result });
  }

  sendExport(res, document, filename) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(HTTP_STATUS.OK).send(JSON.stringify(document, null, 2));
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
