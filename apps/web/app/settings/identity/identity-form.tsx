"use client";

import type { ProjectIdentity } from "@deskbell/shared";
import { Button } from "@deskbell/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import { Switch } from "@deskbell/ui/components/switch";
import { useActionState, useState, useTransition } from "react";

import { discoverJwksUrl, saveIdentity } from "./actions";

/**
 * The identity settings form (spec: end-user-identity). One form, saved
 * whole; the Discover button is the one convenience, filling the key-set URL
 * from the issuer's OpenID configuration through a server action.
 */
export function IdentityForm({
  identity,
  canEdit,
}: {
  identity: Partial<ProjectIdentity>;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveIdentity, undefined);
  const [issuer, setIssuer] = useState(identity.issuer ?? "");
  const [jwksUrl, setJwksUrl] = useState(identity.jwksUrl ?? "");
  const [required, setRequired] = useState(identity.required ?? false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discovering, startDiscover] = useTransition();

  const discover = () => {
    setDiscoverError(null);
    startDiscover(async () => {
      const result = await discoverJwksUrl(issuer);
      if (result.jwksUrl) setJwksUrl(result.jwksUrl);
      else setDiscoverError(result.error ?? "Discovery failed.");
    });
  };

  return (
    <form action={action} className="flex flex-col gap-6">
      <FieldGroup>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="issuer">Issuer</FieldLabel>
            <FieldDescription>
              The OpenID issuer whose tokens the widget sends, exactly as it appears in the token's{" "}
              <code>iss</code> claim. Empty means anonymous sessions only.
            </FieldDescription>
          </FieldContent>
          <Input
            id="issuer"
            name="issuer"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            placeholder="https://id.example.com/realms/app"
            disabled={!canEdit}
          />
        </Field>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="jwksUrl">Key set URL</FieldLabel>
            <FieldDescription>
              Where the issuer publishes its signing keys. Discover reads it from the issuer's
              OpenID configuration.
            </FieldDescription>
          </FieldContent>
          <div className="flex gap-2">
            <Input
              id="jwksUrl"
              name="jwksUrl"
              value={jwksUrl}
              onChange={(e) => setJwksUrl(e.target.value)}
              placeholder="https://id.example.com/realms/app/protocol/openid-connect/certs"
              disabled={!canEdit}
            />
            <Button
              type="button"
              variant="outline"
              onClick={discover}
              disabled={!canEdit || !issuer || discovering}
            >
              {discovering ? "Discovering…" : "Discover"}
            </Button>
          </div>
          {discoverError ? <p className="text-sm text-destructive">{discoverError}</p> : null}
        </Field>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="jwks">Inline key set</FieldLabel>
            <FieldDescription>
              A JWKS document pasted here is used instead of the URL. For installs that cannot reach
              the issuer, and for tests.
            </FieldDescription>
          </FieldContent>
          <textarea
            id="jwks"
            name="jwks"
            defaultValue={identity.jwks ? JSON.stringify(identity.jwks, null, 2) : ""}
            rows={4}
            spellCheck={false}
            disabled={!canEdit}
            className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </Field>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="audience">Audience</FieldLabel>
            <FieldDescription>
              Optional. When set, tokens must carry it in <code>aud</code>.
            </FieldDescription>
          </FieldContent>
          <Input
            id="audience"
            name="audience"
            defaultValue={identity.audience ?? ""}
            placeholder="widget"
            disabled={!canEdit}
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="required">Require sign-in</FieldLabel>
            <FieldDescription>
              Refuse requests without a valid token. Off, anonymous visitors keep session-based
              history and signed-in visitors get their own.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="required"
            name="required"
            checked={required}
            onCheckedChange={setRequired}
            disabled={!canEdit}
          />
        </Field>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="staffClaimPath">Staff claim</FieldLabel>
            <FieldDescription>
              Optional. A claim path and value that marks support staff, e.g.{" "}
              <code>realm_access.roles</code> and <code>support</code>. Reserved for staff-only
              features; it grants nothing today.
            </FieldDescription>
          </FieldContent>
          <div className="flex gap-2">
            <Input
              id="staffClaimPath"
              name="staffClaimPath"
              defaultValue={identity.staffClaim?.path ?? ""}
              placeholder="realm_access.roles"
              disabled={!canEdit}
            />
            <Input
              name="staffClaimValue"
              aria-label="Staff claim value"
              defaultValue={identity.staffClaim?.value ?? ""}
              placeholder="support"
              disabled={!canEdit}
            />
          </div>
        </Field>
      </FieldGroup>
      {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.saved && !state.error ? (
        <p className="text-sm text-muted-foreground">
          Saved. New requests are verified from now on.
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only admins can change identity settings.</p>
      )}
    </form>
  );
}
