/**
 * CSV Export V1 - lazy reusable Worker client owner (Stage 4E).
 *
 * Construction performs no Worker work. The first explicit get-or-create call
 * creates one transport/client pair; successful and cancelled exports reuse it.
 * Worker/protocol failure invalidation drops that pair so a later export may
 * create a fresh Worker. Destroy is terminal and never creates resources.
 */

import {
  CsvExportWorkerClient,
  type CsvExportWorkerTransport,
} from "./csvExportWorkerClient";
import { createCsvExportWorkerTransport } from "./csvExportWorkerTransport";

export type CsvExportWorkerTransportFactory = () => CsvExportWorkerTransport;

export class CsvExportWorkerClientOwner {
  private client: CsvExportWorkerClient | null = null;
  private destroyed = false;

  constructor(
    private readonly createTransport: CsvExportWorkerTransportFactory =
      createCsvExportWorkerTransport,
  ) {}

  getWorkerClientIfCreated(): CsvExportWorkerClient | null {
    return this.client;
  }

  getOrCreateWorkerClient(): CsvExportWorkerClient {
    if (this.destroyed) {
      throw new Error("CSV Worker client owner destroyed");
    }
    if (this.client !== null) return this.client;

    const transport = this.createTransport();
    let client: CsvExportWorkerClient;
    try {
      client = new CsvExportWorkerClient(transport);
    } catch (error) {
      try {
        transport.terminate?.();
      } catch {
        // Client construction error remains primary; no partial pair is cached.
      }
      throw error;
    }
    this.client = client;
    return client;
  }

  invalidateWorkerClient(): void {
    const client = this.client;
    this.client = null;
    client?.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.invalidateWorkerClient();
  }
}
