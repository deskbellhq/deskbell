import openapi from "@/public/openapi.json";

/**
 * Renders one endpoint from public/openapi.json, which scripts/gen-openapi.ts
 * generates from the zod schemas the server validates with. The prose on the
 * HTTP API page stays hand-written; the field tables and status codes come
 * from here, so they cannot drift from the contract.
 */

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  items?: Schema;
  additionalProperties?: boolean | Schema;
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
};

type Operation = {
  summary?: string;
  description?: string;
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: Schema;
  }[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: Schema }> }>;
};

type Paths = Record<string, Record<string, Operation>>;

const paths = openapi.paths as unknown as Paths;

/** A short type label: `string`, `"up" | "down" | null`, `object`, `Citation[]`. */
function typeLabel(schema: Schema): string {
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const union = schema.anyOf ?? schema.oneOf;
  if (union) return union.map(typeLabel).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (schema.type === "array") return `${schema.items ? typeLabel(schema.items) : "unknown"}[]`;
  if (schema.type === "object") return "object";
  if (schema.type === "string" && schema.format === "uri") return "url";
  return schema.type ?? "unknown";
}

/** The size constraints in one phrase, or nothing. */
function limits(schema: Schema): string {
  const parts: string[] = [];
  const s = schema.anyOf?.find((s) => s.type !== "null") ?? schema;
  if (s.minLength !== undefined && s.maxLength !== undefined)
    parts.push(`${s.minLength} to ${s.maxLength} chars`);
  else if (s.maxLength !== undefined) parts.push(`up to ${s.maxLength} chars`);
  if (s.minimum !== undefined && s.maximum !== undefined)
    parts.push(`${s.minimum} to ${s.maximum}`);
  return parts.join(", ");
}

/** Backtick spans in a description render as code. */
function Description({ text }: { text?: string }) {
  if (!text) return null;
  // Keys carry the segment's offset, which is stable for a fixed string.
  let offset = 0;
  const parts = text.split("`").map((part, i) => {
    const key = `${offset}`;
    offset += part.length + 1;
    return i % 2 === 1 ? <code key={key}>{part}</code> : <span key={key}>{part}</span>;
  });
  return <>{parts}</>;
}

function FieldTable({ schema }: { schema: Schema }) {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return (
    <table>
      <thead>
        <tr>
          <th>Field</th>
          <th>Type</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(props).map(([name, field]) => {
          const extra = limits(field);
          return (
            <tr key={name}>
              <td>
                <code>{name}</code>
                {required.has(name) ? null : <span className="db-api-optional"> optional</span>}
              </td>
              <td>
                <code>{typeLabel(field)}</code>
              </td>
              <td>
                <Description text={field.description} />
                {extra ? <span className="db-api-limits"> {extra}.</span> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ApiEndpoint({ path, method = "post" }: { path: string; method?: "get" | "post" }) {
  const op = paths[path]?.[method];
  if (!op) throw new Error(`No ${method.toUpperCase()} ${path} in public/openapi.json`);

  const body = op.requestBody?.content["application/json"]?.schema;
  const ok = op.responses["200"] ?? op.responses["204"];
  const okType = ok?.content ? Object.keys(ok.content)[0] : undefined;
  const okSchema = okType ? ok?.content?.[okType]?.schema : undefined;
  const errors = Object.entries(op.responses).filter(([code]) => code !== "200" && code !== "204");

  return (
    <div className="db-api">
      <p className="db-api-signature">
        <code>
          <span className="db-api-method">{method.toUpperCase()}</span> {path}
        </code>
      </p>
      {op.parameters?.length ? (
        <>
          <p className="db-api-heading">Query</p>
          <FieldTable
            schema={{
              type: "object",
              properties: Object.fromEntries(
                op.parameters.map((p) => [
                  p.name,
                  { ...(p.schema ?? {}), description: p.description },
                ]),
              ),
              required: op.parameters.filter((p) => p.required).map((p) => p.name),
            }}
          />
        </>
      ) : null}
      {body ? (
        <>
          <p className="db-api-heading">Request body</p>
          <FieldTable schema={body} />
        </>
      ) : null}
      {ok ? (
        <>
          <p className="db-api-heading">
            Response <code>{op.responses["200"] ? 200 : 204}</code>
            {okType ? <span className="db-api-limits"> {okType}</span> : null}
          </p>
          {okSchema?.properties ? <FieldTable schema={okSchema} /> : <p>{ok.description}</p>}
        </>
      ) : null}
      <p className="db-api-heading">Errors</p>
      <ul>
        {errors.map(([code, r]) => (
          <li key={code}>
            <code>{code}</code> <Description text={r.description} />
          </li>
        ))}
      </ul>
    </div>
  );
}
