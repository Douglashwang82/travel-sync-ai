export interface TransportMonitorCheckResult {
  monitorId: string;
  changed: boolean;
  status: string;
  detectedAt: string;
  alertMessage: string | null;
}

export async function checkTransportMonitors(): Promise<TransportMonitorCheckResult[]> {
  return [];
}
