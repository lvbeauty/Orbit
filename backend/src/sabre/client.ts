import axios, { type AxiosInstance } from "axios";
import { config } from "../config.js";

function authHeaderValue(): string {
  const token = config.sabre.apiToken;
  return config.sabre.authHeaderStyle === "raw" ? token : `Bearer ${token}`;
}

/** REST client for the api.cert.platform.sabre.com surface (flightShop/Check, hotel/car avail, trip/orders/*). */
export function sabreRest(): AxiosInstance {
  return axios.create({
    baseURL: config.sabre.restEndpoint,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeaderValue(),
      "X-Sabre-Group": config.sabre.pcc,
    },
    timeout: 30_000,
  });
}

export class SabreApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "SabreApiError";
  }
}

export async function sabrePost<T = unknown>(path: string, body: unknown): Promise<T> {
  try {
    const res = await sabreRest().post<T>(path, body);
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      throw new SabreApiError(
        `Sabre POST ${path} failed: ${err.response?.status ?? "network error"}`,
        err.response?.status,
        err.response?.data,
      );
    }
    throw err;
  }
}
