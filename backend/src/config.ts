import "dotenv/config";

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.warn(`[config] Missing env var ${name} — related calls will fail until it's set.`);
    return "";
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:8080",

  sabre: {
    restEndpoint: process.env.SABRE_REST_ENDPOINT ?? "https://api.cert.platform.sabre.com",
    soapEndpoint: process.env.SABRE_SOAP_ENDPOINT ?? "https://webservices.cert.platform.sabre.com",
    apiToken: required("SABRE_API_TOKEN", process.env.SABRE_API_TOKEN),
    authHeaderStyle: (process.env.SABRE_AUTH_HEADER_STYLE ?? "bearer") as "bearer" | "raw",
    pcc: process.env.SABRE_PCC ?? "S5OM",
  },

  vocalBridge: {
    apiKey: required("VOCAL_BRIDGE_API_KEY", process.env.VOCAL_BRIDGE_API_KEY),
    apiUrl: process.env.VOCAL_BRIDGE_API_URL ?? "https://vocalbridgeai.com",
    agentId: process.env.VOCAL_BRIDGE_AGENT_ID,
  },

  landingAi: {
    apiKey: required("LANDINGAI_API_KEY", process.env.LANDINGAI_API_KEY),
    apiUrl: process.env.LANDINGAI_API_URL ?? "https://api.ade.landing.ai",
  },
};
