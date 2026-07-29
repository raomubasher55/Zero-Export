'use strict';

const { modbusTrafficAnalyzer } = require('../gateway/modbus-traffic-analyzer');
const { interpretRegisterWords } = require('../gateway/modbus-value-interpreter');
const { sendSuccess } = require('../utils/api-response');

class GatewayTrafficController {
  constructor(analyzer = modbusTrafficAnalyzer) {
    this.analyzer = analyzer;
    this.list = this.list.bind(this);
    this.analysis = this.analysis.bind(this);
    this.updateSettings = this.updateSettings.bind(this);
    this.clear = this.clear.bind(this);
    this.interpret = this.interpret.bind(this);
    this.export = this.export.bind(this);
  }

  list(req, res) {
    return sendSuccess(res, {
      data: {
        ...this.analyzer.list(req.validated.query),
        analysis: this.analyzer.analyze(),
      },
    });
  }

  analysis(_req, res) {
    return sendSuccess(res, { data: this.analyzer.analyze() });
  }

  updateSettings(req, res) {
    return sendSuccess(res, { data: this.analyzer.updateSettings(req.validated.body) });
  }

  clear(_req, res) {
    return sendSuccess(res, { data: this.analyzer.clear() });
  }

  interpret(req, res) {
    const { rawValues, ...options } = req.validated.body;
    return sendSuccess(res, { data: interpretRegisterWords(rawValues, options) });
  }

  export(req, res) {
    const { format } = req.validated.query;
    const extension = format === 'csv' ? 'csv' : 'json';
    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="modbus-traffic-${new Date().toISOString().replaceAll(':', '-')}.${extension}"`,
    );
    return res.status(200).send(this.analyzer.export(format));
  }
}

module.exports = GatewayTrafficController;
