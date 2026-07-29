'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('node:v8');

const EXCLUDED_FILESYSTEMS = new Set([
  'proc',
  'sysfs',
  'devtmpfs',
  'devpts',
  'securityfs',
  'cgroup',
  'cgroup2',
  'pstore',
  'debugfs',
  'tracefs',
  'configfs',
  'fusectl',
  'mqueue',
  'hugetlbfs',
  'rpc_pipefs',
  'autofs',
]);

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function percentage(used, total) {
  return total > 0 ? round((used / total) * 100) : null;
}

function cpuTimes(cpu) {
  const times = cpu.times;
  const total = times.user + times.nice + times.sys + times.idle + times.irq;
  return { idle: times.idle, total };
}

function decodeMountValue(value) {
  return value
    .replaceAll('\\040', ' ')
    .replaceAll('\\011', '\t')
    .replaceAll('\\134', '\\');
}

class SystemMonitoringService {
  constructor(options = {}) {
    this.os = options.os || os;
    this.fs = options.fs || fs;
    this.process = options.process || process;
    this.now = options.now || (() => Date.now());
    this.previousCpu = null;
    this.previousNetwork = new Map();
    this.previousNetworkAt = null;
    this.previousProcessCpu = null;
    this.previousProcessAt = null;
    this.staticInfoPromise = null;
  }

  async getSnapshot() {
    const sampledAt = new Date(this.now());
    const [identity, memory, thermal, frequencies, filesystems, network] = await Promise.all([
      this.getStaticInfo(),
      this.getMemory(),
      this.getThermal(),
      this.getFrequencies(),
      this.getFilesystems(),
      this.getNetwork(),
    ]);
    const cpu = this.getCpu();
    const processUsage = this.getProcessUsage();
    const warnings = this.buildWarnings({ cpu, memory, thermal, filesystems, network, processUsage });

    return {
      sampledAt: sampledAt.toISOString(),
      live: true,
      persistence: 'NONE',
      identity,
      uptime: {
        seconds: this.os.uptime(),
        bootedAt: new Date(sampledAt.getTime() - this.os.uptime() * 1000).toISOString(),
      },
      cpu: {
        ...cpu,
        frequencies,
      },
      memory,
      thermal,
      filesystems,
      network,
      process: processUsage,
      warnings,
      status: warnings.some((warning) => warning.severity === 'CRITICAL')
        ? 'CRITICAL'
        : warnings.length > 0
          ? 'WARNING'
          : 'HEALTHY',
    };
  }

  async getStaticInfo() {
    if (!this.staticInfoPromise) {
      this.staticInfoPromise = this.readStaticInfo();
    }
    return this.staticInfoPromise;
  }

  async readStaticInfo() {
    const [osReleaseText, boardModelText, cpuInfoText] = await Promise.all([
      this.readFile('/etc/os-release'),
      this.readFile('/proc/device-tree/model'),
      this.readFile('/proc/cpuinfo'),
    ]);
    const osRelease = this.parseOsRelease(osReleaseText);
    const cpuInfo = this.parseCpuInfo(cpuInfoText);
    const cpus = this.os.cpus();

    return {
      hostname: this.os.hostname(),
      boardModel: boardModelText?.replaceAll('\0', '').trim() || cpuInfo.model || null,
      operatingSystem: osRelease.PRETTY_NAME || this.os.type(),
      distribution: osRelease.NAME || null,
      distributionVersion: osRelease.VERSION_ID || null,
      platform: this.os.platform(),
      architecture: this.os.arch(),
      kernelRelease: this.os.release(),
      kernelType: this.os.type(),
      processorModel: cpus[0]?.model || cpuInfo.model || null,
      logicalCores: cpus.length,
      hardware: cpuInfo.hardware || null,
      revision: cpuInfo.revision || null,
      nodeVersion: this.process.version,
    };
  }

  getCpu() {
    const cpus = this.os.cpus();
    const current = cpus.map(cpuTimes);
    let cores = cpus.map((cpu, index) => ({
      index,
      model: cpu.model,
      reportedSpeedMHz: cpu.speed,
      utilizationPercent: null,
    }));

    if (this.previousCpu?.length === current.length) {
      cores = cores.map((core, index) => {
        const totalDelta = current[index].total - this.previousCpu[index].total;
        const idleDelta = current[index].idle - this.previousCpu[index].idle;
        return {
          ...core,
          utilizationPercent:
            totalDelta > 0 ? round(((totalDelta - idleDelta) / totalDelta) * 100) : null,
        };
      });
    }
    this.previousCpu = current;

    const measured = cores.filter((core) => core.utilizationPercent !== null);
    const loadAverage = this.os.loadavg();
    return {
      utilizationPercent:
        measured.length > 0
          ? round(measured.reduce((sum, core) => sum + core.utilizationPercent, 0) / measured.length)
          : null,
      cores,
      logicalCoreCount: cpus.length,
      loadAverage: {
        oneMinute: round(loadAverage[0]),
        fiveMinutes: round(loadAverage[1]),
        fifteenMinutes: round(loadAverage[2]),
        oneMinutePerCore: cpus.length ? round(loadAverage[0] / cpus.length) : null,
      },
    };
  }

  async getMemory() {
    const text = await this.readFile('/proc/meminfo');
    const values = {};
    for (const line of text?.split('\n') || []) {
      const match = line.match(/^([^:]+):\s+(\d+)\s+kB$/);
      if (match) values[match[1]] = Number(match[2]) * 1024;
    }

    const totalBytes = values.MemTotal || this.os.totalmem();
    const availableBytes = values.MemAvailable ?? this.os.freemem();
    const freeBytes = values.MemFree ?? this.os.freemem();
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    const swapTotalBytes = values.SwapTotal || 0;
    const swapFreeBytes = values.SwapFree || 0;
    const swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);

    return {
      totalBytes,
      usedBytes,
      availableBytes,
      freeBytes,
      usedPercent: percentage(usedBytes, totalBytes),
      buffersBytes: values.Buffers || 0,
      cachedBytes: (values.Cached || 0) + (values.SReclaimable || 0),
      swap: {
        totalBytes: swapTotalBytes,
        usedBytes: swapUsedBytes,
        freeBytes: swapFreeBytes,
        usedPercent: percentage(swapUsedBytes, swapTotalBytes),
      },
    };
  }

  async getThermal() {
    const root = '/sys/class/thermal';
    const entries = await this.readDirectory(root);
    const zones = [];

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('thermal_zone'))
        .map(async (entry) => {
          const zonePath = path.join(root, entry.name);
          const [type, rawTemperature] = await Promise.all([
            this.readFile(path.join(zonePath, 'type')),
            this.readFile(path.join(zonePath, 'temp')),
          ]);
          const numeric = Number(rawTemperature?.trim());
          if (!Number.isFinite(numeric)) return;
          zones.push({
            zone: entry.name,
            type: type?.trim() || entry.name,
            temperatureCelsius: round(Math.abs(numeric) > 1000 ? numeric / 1000 : numeric, 1),
          });
        }),
    );
    zones.sort((left, right) => left.zone.localeCompare(right.zone));

    return {
      available: zones.length > 0,
      zones,
      maximumCelsius:
        zones.length > 0 ? Math.max(...zones.map((zone) => zone.temperatureCelsius)) : null,
    };
  }

  async getFrequencies() {
    const cpuRoot = '/sys/devices/system/cpu';
    const entries = await this.readDirectory(cpuRoot);
    const cores = [];

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && /^cpu\d+$/.test(entry.name))
        .map(async (entry) => {
          const frequencyRoot = path.join(cpuRoot, entry.name, 'cpufreq');
          const [current, minimum, maximum, governor] = await Promise.all([
            this.readFile(path.join(frequencyRoot, 'scaling_cur_freq')),
            this.readFile(path.join(frequencyRoot, 'scaling_min_freq')),
            this.readFile(path.join(frequencyRoot, 'scaling_max_freq')),
            this.readFile(path.join(frequencyRoot, 'scaling_governor')),
          ]);
          const currentKHz = Number(current?.trim());
          if (!Number.isFinite(currentKHz)) return;
          cores.push({
            core: Number(entry.name.slice(3)),
            currentMHz: round(currentKHz / 1000),
            minimumMHz: Number.isFinite(Number(minimum?.trim()))
              ? round(Number(minimum.trim()) / 1000)
              : null,
            maximumMHz: Number.isFinite(Number(maximum?.trim()))
              ? round(Number(maximum.trim()) / 1000)
              : null,
            governor: governor?.trim() || null,
          });
        }),
    );
    cores.sort((left, right) => left.core - right.core);

    return {
      available: cores.length > 0,
      cores,
      averageCurrentMHz:
        cores.length > 0
          ? round(cores.reduce((sum, core) => sum + core.currentMHz, 0) / cores.length)
          : null,
    };
  }

  async getFilesystems() {
    const mountsText = await this.readFile('/proc/mounts');
    const mounts = [];
    const seen = new Set();

    for (const line of mountsText?.split('\n') || []) {
      const [device, rawMountPoint, type] = line.split(' ');
      if (!device || !rawMountPoint || !type || EXCLUDED_FILESYSTEMS.has(type)) continue;
      const mountPoint = decodeMountValue(rawMountPoint);
      const shouldInclude =
        mountPoint === '/' ||
        mountPoint.startsWith('/boot') ||
        mountPoint.startsWith('/mnt') ||
        mountPoint.startsWith('/media');
      if (!shouldInclude || seen.has(mountPoint)) continue;
      seen.add(mountPoint);
      mounts.push({ device: decodeMountValue(device), mountPoint, type });
    }
    if (!seen.has('/')) mounts.unshift({ device: null, mountPoint: '/', type: null });

    const filesystems = (
      await Promise.all(
        mounts.map(async (mount) => {
          const statistics = await this.statFilesystem(mount.mountPoint);
          if (!statistics) return null;
          const totalBytes = Number(statistics.blocks) * Number(statistics.bsize);
          const availableBytes = Number(statistics.bavail) * Number(statistics.bsize);
          const freeBytes = Number(statistics.bfree) * Number(statistics.bsize);
          const usedBytes = Math.max(0, totalBytes - freeBytes);
          return {
            ...mount,
            totalBytes,
            usedBytes,
            availableBytes,
            freeBytes,
            usedPercent: percentage(usedBytes, totalBytes),
          };
        }),
      )
    ).filter(Boolean);

    return filesystems.sort((left, right) => left.mountPoint.localeCompare(right.mountPoint));
  }

  async getNetwork() {
    const now = this.now();
    const interfaces = this.os.networkInterfaces();
    const names = Object.keys(interfaces).sort();
    const elapsedSeconds =
      this.previousNetworkAt === null ? null : Math.max(0.001, (now - this.previousNetworkAt) / 1000);
    const result = [];

    await Promise.all(
      names.map(async (name) => {
        const safeName = path.basename(name);
        if (safeName !== name) return;
        const root = path.join('/sys/class/net', safeName);
        const [rxText, txText, stateText, speedText] = await Promise.all([
          this.readFile(path.join(root, 'statistics/rx_bytes')),
          this.readFile(path.join(root, 'statistics/tx_bytes')),
          this.readFile(path.join(root, 'operstate')),
          this.readFile(path.join(root, 'speed')),
        ]);
        const receivedBytes = Number(rxText?.trim());
        const transmittedBytes = Number(txText?.trim());
        const previous = this.previousNetwork.get(name);
        const addresses = (interfaces[name] || []).map((address) => ({
          address: address.address,
          family: address.family,
          netmask: address.netmask,
          cidr: address.cidr,
          mac: address.mac,
          internal: address.internal,
        }));

        result.push({
          name,
          state: stateText?.trim() || (addresses.length > 0 ? 'unknown' : 'down'),
          speedMbps:
            Number.isFinite(Number(speedText?.trim())) && Number(speedText.trim()) > 0
              ? Number(speedText.trim())
              : null,
          addresses,
          receivedBytes: Number.isFinite(receivedBytes) ? receivedBytes : null,
          transmittedBytes: Number.isFinite(transmittedBytes) ? transmittedBytes : null,
          receiveBytesPerSecond:
            elapsedSeconds && previous && Number.isFinite(receivedBytes)
              ? Math.max(0, round((receivedBytes - previous.receivedBytes) / elapsedSeconds))
              : null,
          transmitBytesPerSecond:
            elapsedSeconds && previous && Number.isFinite(transmittedBytes)
              ? Math.max(0, round((transmittedBytes - previous.transmittedBytes) / elapsedSeconds))
              : null,
        });

        if (Number.isFinite(receivedBytes) && Number.isFinite(transmittedBytes)) {
          this.previousNetwork.set(name, { receivedBytes, transmittedBytes });
        }
      }),
    );
    this.previousNetworkAt = now;
    return result.sort((left, right) => left.name.localeCompare(right.name));
  }

  getProcessUsage() {
    const now = this.now();
    const memory = this.process.memoryUsage();
    const heapLimitBytes = v8.getHeapStatistics().heap_size_limit;
    let cpuPercent = null;
    const currentCpu = this.process.cpuUsage();

    if (this.previousProcessCpu && this.previousProcessAt !== null) {
      const elapsedMicroseconds = Math.max(1, (now - this.previousProcessAt) * 1000);
      const userDelta = Math.max(0, currentCpu.user - this.previousProcessCpu.user);
      const systemDelta = Math.max(0, currentCpu.system - this.previousProcessCpu.system);
      cpuPercent = round(((userDelta + systemDelta) / elapsedMicroseconds) * 100);
    }
    this.previousProcessCpu = currentCpu;
    this.previousProcessAt = now;

    return {
      pid: this.process.pid,
      uptimeSeconds: this.process.uptime(),
      nodeVersion: this.process.version,
      environment: this.process.env.NODE_ENV || 'development',
      cpuPercent,
      residentSetBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      heapLimitBytes,
      heapLimitUsedPercent: percentage(memory.heapUsed, heapLimitBytes),
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
    };
  }

  buildWarnings({ cpu, memory, thermal, filesystems, network, processUsage }) {
    const warnings = [];
    const add = (severity, code, message) => warnings.push({ severity, code, message });

    if (cpu.utilizationPercent !== null && cpu.utilizationPercent >= 90) {
      add('WARNING', 'CPU_HIGH', `CPU utilization is ${cpu.utilizationPercent}%.`);
    }
    if (cpu.loadAverage.oneMinutePerCore !== null && cpu.loadAverage.oneMinutePerCore >= 1) {
      add('WARNING', 'LOAD_HIGH', 'The one-minute load average is at or above logical CPU capacity.');
    }
    if (memory.usedPercent >= 90) {
      add('CRITICAL', 'MEMORY_CRITICAL', `Memory usage is ${memory.usedPercent}%.`);
    } else if (memory.usedPercent >= 80) {
      add('WARNING', 'MEMORY_HIGH', `Memory usage is ${memory.usedPercent}%.`);
    }
    if (thermal.maximumCelsius !== null && thermal.maximumCelsius >= 85) {
      add('CRITICAL', 'TEMPERATURE_CRITICAL', `Maximum board temperature is ${thermal.maximumCelsius} °C.`);
    } else if (thermal.maximumCelsius !== null && thermal.maximumCelsius >= 75) {
      add('WARNING', 'TEMPERATURE_HIGH', `Maximum board temperature is ${thermal.maximumCelsius} °C.`);
    }
    for (const filesystem of filesystems) {
      if (filesystem.usedPercent >= 95) {
        add('CRITICAL', 'DISK_CRITICAL', `${filesystem.mountPoint} is ${filesystem.usedPercent}% full.`);
      } else if (filesystem.usedPercent >= 85) {
        add('WARNING', 'DISK_HIGH', `${filesystem.mountPoint} is ${filesystem.usedPercent}% full.`);
      }
    }
    for (const item of network) {
      if (item.state === 'down' && item.addresses.some((address) => !address.internal)) {
        add('WARNING', 'NETWORK_DOWN', `${item.name} has addresses configured but reports link down.`);
      }
    }
    if (processUsage.heapLimitUsedPercent >= 85) {
      add('WARNING', 'PROCESS_HEAP_HIGH', `Backend V8 heap is ${processUsage.heapLimitUsedPercent}% of its limit.`);
    }

    return warnings;
  }

  parseOsRelease(text) {
    const values = {};
    for (const line of text?.split('\n') || []) {
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator);
      let value = line.slice(separator + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      values[key] = value.replaceAll('\\"', '"');
    }
    return values;
  }

  parseCpuInfo(text) {
    const values = {};
    for (const line of text?.split('\n') || []) {
      const [rawKey, ...parts] = line.split(':');
      const key = rawKey?.trim().toLowerCase();
      const value = parts.join(':').trim();
      if (!key || !value) continue;
      if (key === 'model name' || key === 'model') values.model = value;
      if (key === 'processor' && !/^\d+$/.test(value)) values.model ||= value;
      if (key === 'hardware') values.hardware = value;
      if (key === 'revision') values.revision = value;
    }
    return values;
  }

  async readFile(filePath) {
    try {
      return await this.fs.promises.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  async readDirectory(directoryPath) {
    try {
      return await this.fs.promises.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  async statFilesystem(mountPoint) {
    try {
      return await this.fs.promises.statfs(mountPoint);
    } catch {
      return null;
    }
  }
}

const systemMonitoringService = new SystemMonitoringService();

module.exports = {
  EXCLUDED_FILESYSTEMS,
  SystemMonitoringService,
  systemMonitoringService,
};
