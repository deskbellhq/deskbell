"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deskbell/ui/components/select";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { ServerView } from "@/lib/actions/settings";
import { copyLabel, useCopy } from "@/lib/use-copy";

/**
 * The fields that describe a server's connection (spec: actions-settings-ui),
 * shared by the attach dialog and the server page's form. The dialog folds
 * the id, transport and identity mode behind "Advanced" — a first attach
 * needs a name, a URL and a credential, and the defaults are right for most
 * servers — while the form shows everything, because that is where the
 * operator comes back to change it.
 */
export function ConnectionFields({
  server,
  canEdit,
  idPrefix,
  jwksUrl,
  collapsible = false,
}: {
  server: ServerView | null;
  canEdit: boolean;
  idPrefix: string;
  jwksUrl: string;
  collapsible?: boolean;
}) {
  const [authKind, setAuthKind] = useState<ServerView["authKind"]>(server?.authKind ?? "none");
  const [identity, setIdentity] = useState<ServerView["identity"]>(server?.identity ?? "none");
  const [advanced, setAdvanced] = useState(!collapsible);
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <FieldGroup className="gap-5">
      <Field orientation="vertical">
        <FieldLabel htmlFor={id("name")}>Name</FieldLabel>
        <Input
          id={id("name")}
          name="name"
          defaultValue={server?.name ?? ""}
          placeholder="Shop API"
          required
          maxLength={60}
          autoComplete="off"
          disabled={!canEdit}
        />
      </Field>
      <Field orientation="vertical">
        <FieldContent>
          <FieldLabel htmlFor={id("url")}>URL</FieldLabel>
          <FieldDescription>
            The server's MCP endpoint. HTTPS, except on localhost.
          </FieldDescription>
        </FieldContent>
        <Input
          id={id("url")}
          name="url"
          type="url"
          inputMode="url"
          defaultValue={server?.url ?? ""}
          placeholder="https://mcp.example.com/mcp"
          required
          autoComplete="off"
          spellCheck={false}
          disabled={!canEdit}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field orientation="vertical">
          <FieldLabel htmlFor={id("authKind")}>Credential</FieldLabel>
          <Select
            name="authKind"
            value={authKind}
            onValueChange={(v) => setAuthKind(v as ServerView["authKind"])}
            disabled={!canEdit}
          >
            <SelectTrigger id={id("authKind")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="bearer">Bearer token</SelectItem>
              <SelectItem value="header">Custom header</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {authKind === "header" ? (
          <Field orientation="vertical">
            <FieldLabel htmlFor={id("authHeaderName")}>Header name</FieldLabel>
            <Input
              id={id("authHeaderName")}
              name="authHeaderName"
              defaultValue={server?.authHeaderName ?? ""}
              placeholder="X-Api-Key"
              required
              autoComplete="off"
              spellCheck={false}
              disabled={!canEdit}
            />
          </Field>
        ) : null}
      </div>
      {authKind !== "none" ? (
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor={id("authSecret")}>
              {authKind === "bearer" ? "Token" : "Header value"}
            </FieldLabel>
            {server?.secretMasked ? (
              <FieldDescription>
                Currently{" "}
                <code data-testid={`${idPrefix}-secret-masked`}>{server.secretMasked}</code>. Paste
                a new value to replace it, or leave empty to keep it.
              </FieldDescription>
            ) : (
              <FieldDescription>
                Sent on every request. Stored on this instance and never shown again in full.
              </FieldDescription>
            )}
          </FieldContent>
          <Input
            id={id("authSecret")}
            name="authSecret"
            type="password"
            autoComplete="off"
            required={!server?.secretMasked}
            disabled={!canEdit}
          />
        </Field>
      ) : null}

      {collapsible ? (
        <button
          type="button"
          className="flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-expanded={advanced}
          aria-controls={id("advanced")}
          onClick={() => setAdvanced((v) => !v)}
        >
          <ChevronDown
            className={`size-4 transition-transform ${advanced ? "rotate-180" : ""}`}
            aria-hidden
          />
          Advanced
        </button>
      ) : null}

      {advanced ? (
        <div id={id("advanced")} className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel htmlFor={id("slug")}>Id</FieldLabel>
                <FieldDescription>
                  Prefixes the tool names the model sees and is the identity token's audience.
                  {server ? " Fixed once attached." : " Empty derives it from the name."}
                </FieldDescription>
              </FieldContent>
              <Input
                id={id("slug")}
                name="slug"
                defaultValue={server?.slug ?? ""}
                placeholder="shop"
                maxLength={40}
                autoComplete="off"
                spellCheck={false}
                disabled={!canEdit || Boolean(server)}
              />
            </Field>
            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel htmlFor={id("transport")}>Transport</FieldLabel>
                <FieldDescription>
                  Streamable HTTP is current; SSE is for older servers.
                </FieldDescription>
              </FieldContent>
              <Select
                name="transport"
                defaultValue={server?.transport ?? "http"}
                disabled={!canEdit}
              >
                <SelectTrigger id={id("transport")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">Streamable HTTP</SelectItem>
                  <SelectItem value="sse">SSE (legacy)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel htmlFor={id("identity")}>Visitor identity</FieldLabel>
              <FieldDescription>{IDENTITY_HELP[identity]}</FieldDescription>
            </FieldContent>
            <Select
              name="identity"
              value={identity}
              onValueChange={(v) => setIdentity(v as ServerView["identity"])}
              disabled={!canEdit}
            >
              <SelectTrigger id={id("identity")} className="w-full sm:w-1/2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not sent</SelectItem>
                <SelectItem value="signed">Signed token</SelectItem>
                <SelectItem value="visitor">Visitor's own token</SelectItem>
              </SelectContent>
            </Select>
            {identity === "signed" ? <JwksHint jwksUrl={jwksUrl} /> : null}
          </Field>
          {identity === "visitor" ? (
            <ExchangeFields server={server} canEdit={canEdit} id={id} attaching={collapsible} />
          ) : null}
        </div>
      ) : null}
    </FieldGroup>
  );
}

const IDENTITY_HELP: Record<ServerView["identity"], string> = {
  none: "The server learns nothing about who is asking.",
  signed:
    "Every call carries a signed token naming the visitor; anonymous visitors get none of this server's tools.",
  visitor:
    "Every call carries the visitor's own token from your identity provider as its bearer; anonymous visitors get none of this server's tools.",
};

/**
 * The exchange client for the visitor's-token mode (spec:
 * visitor-token-actions). Without a client id the visitor's token is sent
 * as it was received; with one, Deskbell exchanges it at the identity
 * provider for a token addressed to this server. The attach dialog also
 * takes a one-time token, because such a server will not list its tools to
 * the instance alone.
 */
function ExchangeFields({
  server,
  canEdit,
  id,
  attaching,
}: {
  server: ServerView | null;
  canEdit: boolean;
  id: (name: string) => string;
  attaching: boolean;
}) {
  const [clientId, setClientId] = useState(server?.exchangeClientId ?? "");
  return (
    <div className="flex flex-col gap-5 rounded-md border p-4">
      <div>
        <p className="text-sm font-medium">Token exchange</p>
        <p className="text-sm text-muted-foreground">
          Leave the client id empty to forward the visitor's token unchanged; the server must then
          accept the same audience as your product. Fill it in to exchange the token at your
          identity provider for one addressed to this server.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field orientation="vertical">
          <FieldLabel htmlFor={id("exchangeClientId")}>Client id</FieldLabel>
          <Input
            id={id("exchangeClientId")}
            name="exchangeClientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="deskbell"
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            disabled={!canEdit}
          />
        </Field>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor={id("exchangeClientSecret")}>Client secret</FieldLabel>
            {server?.exchangeSecretMasked ? (
              <FieldDescription>
                Currently <code>{server.exchangeSecretMasked}</code>. Empty keeps it.
              </FieldDescription>
            ) : null}
          </FieldContent>
          <Input
            id={id("exchangeClientSecret")}
            name="exchangeClientSecret"
            type="password"
            autoComplete="off"
            required={Boolean(clientId.trim()) && !server?.exchangeSecretMasked}
            disabled={!canEdit || !clientId.trim()}
          />
        </Field>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor={id("exchangeAudience")}>Audience</FieldLabel>
            <FieldDescription>The server's client or resource at the provider.</FieldDescription>
          </FieldContent>
          <Input
            id={id("exchangeAudience")}
            name="exchangeAudience"
            defaultValue={server?.exchangeAudience ?? ""}
            placeholder="shop-mcp"
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            disabled={!canEdit || !clientId.trim()}
          />
        </Field>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor={id("exchangeScope")}>Scopes</FieldLabel>
            <FieldDescription>Space-separated, as the server lists them.</FieldDescription>
          </FieldContent>
          <Input
            id={id("exchangeScope")}
            name="exchangeScope"
            defaultValue={server?.exchangeScope ?? ""}
            placeholder="orders:read"
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            disabled={!canEdit || !clientId.trim()}
          />
        </Field>
      </div>
      {attaching ? (
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor={id("discoveryToken")}>Token for listing tools</FieldLabel>
            <FieldDescription>
              A server like this answers only to a visitor's token, so the instance cannot list its
              tools by itself. Paste a token it accepts; it is used once for the listing and not
              kept. You can also do this later with Refresh tools.
            </FieldDescription>
          </FieldContent>
          <Input
            id={id("discoveryToken")}
            name="discoveryToken"
            type="password"
            autoComplete="off"
            disabled={!canEdit}
          />
        </Field>
      ) : null}
    </div>
  );
}

function JwksHint({ jwksUrl }: { jwksUrl: string }) {
  const { state, copy } = useCopy();
  return (
    <p className="text-xs text-muted-foreground">
      The server verifies <code>X-Deskbell-Identity</code> against{" "}
      <code className="break-all">{jwksUrl}</code>{" "}
      <button
        type="button"
        className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={() => copy(jwksUrl)}
      >
        {copyLabel(state, "Copy URL")}
      </button>
    </p>
  );
}
