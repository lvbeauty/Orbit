import axios from "axios";
import FormData from "form-data";
import { config } from "../config.js";

const IDENTITY_DOCUMENT_SCHEMA = {
  type: "object",
  properties: {
    documentType: { type: "string", description: "e.g. PASSPORT, VISA, DRIVER_LICENSE" },
    fullName: { type: "string", description: "Full name as printed on the document" },
    passportNumber: { type: "string", description: "Passport or document number" },
    nationality: { type: "string", description: "Nationality / issuing country code" },
    dateOfBirth: { type: "string", description: "Date of birth, YYYY-MM-DD" },
    expirationDate: { type: "string", description: "Document expiration date, YYYY-MM-DD" },
    issuingCountry: { type: "string", description: "Country that issued the document" },
  },
};

function authHeaders() {
  return { Authorization: `Bearer ${config.landingAi.apiKey}` };
}

/** Parse a document (PDF/image) at a public URL into Markdown via LandingAI ADE. */
export async function parseDocument(documentUrl: string): Promise<{ markdown: string; raw: any }> {
  const form = new FormData();
  form.append("document_url", documentUrl);

  const res = await axios.post(`${config.landingAi.apiUrl}/v2/parse`, form, {
    headers: { ...authHeaders(), ...form.getHeaders() },
    timeout: 60_000,
  });

  return { markdown: res.data?.markdown ?? "", raw: res.data };
}

/** Extract structured fields from Markdown using a JSON schema via LandingAI ADE. */
export async function extractFields(markdown: string, schema: object): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append("markdown", markdown);
  form.append("schema", JSON.stringify(schema));

  const res = await axios.post(`${config.landingAi.apiUrl}/v2/extract`, form, {
    headers: { ...authHeaders(), ...form.getHeaders() },
    timeout: 60_000,
  });

  return res.data?.extracted ?? res.data?.values ?? res.data;
}

/** Parse + extract in one step, using our built-in identity-document schema. */
export async function extractIdentityDocument(documentUrl: string) {
  const { markdown } = await parseDocument(documentUrl);
  return extractFields(markdown, IDENTITY_DOCUMENT_SCHEMA);
}
