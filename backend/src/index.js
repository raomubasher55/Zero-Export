'use strict';

const http = require('node:http');
const app = require('./app');
const { config } = require('./config/environment');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const logger = require('./config/logger');
const { modbusGatewayRuntime } = require('./gateway/modbus-gateway-runtime');
const { modbusConnectionManager } = require('./modbus/connection-manager');
const { pollingScheduler } = require('./jobs/polling-scheduler');
const { gatewayService } = require('./services/gateway.service');
const { ensureBuiltinProfiles } = require('./seed/builtin-profiles');
const { meterSimulator } = require('./simulator/meter-simulator');

let server;
let shuttingDown = false;

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info('Graceful shutdown started', { reason });

  const forceShutdownTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing process exit');
    server?.closeAllConnections?.();
    process.exit(1);
  }, config.server.gracefulShutdownTimeoutMs);
  forceShutdownTimer.unref();

  const finish = async (serverError) => {
    clearTimeout(forceShutdownTimer);

    try {
      await pollingScheduler.stop();
      await meterSimulator.stop();
      await modbusGatewayRuntime.stop();
      await modbusConnectionManager.shutdown();
      await disconnectDatabase();
      logger.info('Graceful shutdown completed', { reason });
      logger.close();
      process.exit(serverError ? 1 : exitCode);
    } catch (error) {
      logger.error('Error while disconnecting MongoDB during shutdown', {
        error: error.stack || error.message,
      });
      logger.close();
      process.exit(1);
    }
  };

  if (server) {
    server.close(finish);
  } else {
    await finish();
  }
}

async function bootstrap() {
  await connectDatabase();

  if (config.seeding.builtinProfiles) {
    await ensureBuiltinProfiles();
  }

  await gatewayService.initialize().catch((error) => {
    logger.error('Unable to initialize the Modbus forwarding gateway', {
      error: error.stack || error.message,
    });
  });

  server = http.createServer(app);
  server.listen(config.server.port, config.server.host, () => {
    logger.info('HTTP server is listening', {
      host: config.server.host,
      port: config.server.port,
      environment: config.environment,
    });
  });

  server.on('error', (error) => {
    logger.error('HTTP server error', { error: error.stack || error.message });
    shutdown('server error', 1);
  });

  pollingScheduler.start();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('Unhandled promise rejection', { error: error.stack || error.message });
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.stack || error.message });
  shutdown('uncaughtException', 1);
});

bootstrap().catch(async (error) => {
  logger.error('Application startup failed', { error: error.stack || error.message });
  await disconnectDatabase().catch(() => undefined);
  logger.close();
  process.exit(1);
});
