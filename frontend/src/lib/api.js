const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
const HEALTH_URL = (
  import.meta.env.VITE_HEALTH_URL ||
  `${API_BASE_URL.replace(/\/api\/v1$/, '')}/health`
).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status, code, details, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

function toQueryString(query = {}) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });

  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    signal,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const error = payload?.error;
    throw new ApiError(error?.message || `Request failed with status ${response.status}.`, {
      status: response.status,
      code: error?.code,
      details: error?.details,
      requestId: error?.requestId || response.headers.get('x-request-id'),
    });
  }

  return payload;
}

export const api = {
  getHealth: async () => {
    const response = await fetch(HEALTH_URL);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      throw new ApiError('Backend health endpoint is unavailable.', { status: response.status });
    }
    return payload.data;
  },

  getApiInfo: () => request('/'),
  getPollingStatus: () => request('/polling/status'),

  getGateway: () => request('/gateway'),
  updateGateway: (payload) => request('/gateway', { method: 'PUT', body: payload }),
  startGateway: () => request('/gateway/start', { method: 'POST' }),
  stopGateway: () => request('/gateway/stop', { method: 'POST' }),
  listGatewayTraffic: (query) => request(`/gateway/traffic${toQueryString(query)}`),
  getGatewayTrafficAnalysis: () => request('/gateway/traffic/analysis'),
  updateGatewayTrafficSettings: (payload) =>
    request('/gateway/traffic/settings', { method: 'PATCH', body: payload }),
  clearGatewayTraffic: () => request('/gateway/traffic', { method: 'DELETE' }),
  interpretGatewayTraffic: (payload) =>
    request('/gateway/traffic/interpret', { method: 'POST', body: payload }),
  exportGatewayTraffic: async (format = 'json') => {
    const response = await fetch(
      `${API_BASE_URL}/gateway/traffic/export${toQueryString({ format })}`,
    );
    if (!response.ok) {
      throw new ApiError(`Traffic export failed with status ${response.status}.`, {
        status: response.status,
      });
    }
    return response.blob();
  },

  listDevices: (query) => request(`/devices${toQueryString(query)}`),
  getDevice: (deviceId) => request(`/devices/${deviceId}`),
  createDevice: (payload) => request('/devices', { method: 'POST', body: payload }),
  updateDevice: (deviceId, payload) => request(`/devices/${deviceId}`, { method: 'PATCH', body: payload }),
  deleteDevice: (deviceId) => request(`/devices/${deviceId}`, { method: 'DELETE' }),

  listRegisterProfiles: (query) => request(`/register-profiles${toQueryString(query)}`),
  getRegisterProfile: (profileId) => request(`/register-profiles/${profileId}`),
  createRegisterProfile: (payload) => request('/register-profiles', { method: 'POST', body: payload }),
  updateRegisterProfile: (profileId, payload) => request(`/register-profiles/${profileId}`, { method: 'PATCH', body: payload }),
  deleteRegisterProfile: (profileId) => request(`/register-profiles/${profileId}`, { method: 'DELETE' }),

  getConnection: (deviceId) => request(`/devices/${deviceId}/connection`),
  connectDevice: (deviceId) => request(`/devices/${deviceId}/connection`, { method: 'POST' }),
  disconnectDevice: (deviceId) => request(`/devices/${deviceId}/connection`, { method: 'DELETE' }),
  rawRead: (deviceId, payload) => request(`/devices/${deviceId}/modbus/read`, { method: 'POST', body: payload }),
  rawWrite: (deviceId, payload) => request(`/devices/${deviceId}/modbus/write`, { method: 'POST', body: payload }),

  pollDevice: (deviceId) => request(`/devices/${deviceId}/poll`, { method: 'POST' }),
  listLatestValues: (deviceId, query) => request(`/devices/${deviceId}/values${toQueryString(query)}`),
  getLatestValue: (deviceId, registerKey) => request(`/devices/${deviceId}/values/${registerKey}`),
  listCommunicationLogs: (deviceId, query) => request(`/devices/${deviceId}/communication-logs${toQueryString(query)}`),
};
