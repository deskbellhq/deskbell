"use client";

import {
  DEFAULT_SLACK_TEMPLATES,
  NOTIFICATION_EVENT_META,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_PLACEHOLDERS,
  type NotificationEventType,
} from "@deskbell/shared";
import { Button } from "@deskbell/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deskbell/ui/components/card";
import { Checkbox } from "@deskbell/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@deskbell/ui/components/field";
import { Input } from "@deskbell/ui/components/input";
import { Label } from "@deskbell/ui/components/label";
import { Switch } from "@deskbell/ui/components/switch";
import { Textarea } from "@deskbell/ui/components/textarea";
import { useActionState, useState, useTransition } from "react";

import type { ChannelView, NotificationsView } from "@/lib/notifications/settings";
import { rotateSigningSecret, saveNotifications } from "./actions";

/**
 * The notifications form (spec: project-notifications): one card per
 * channel, saved whole. A target shows masked with a field to replace it
 * and a box to remove it; a fresh signing secret is shown once, in the
 * response, and never again.
 */
export function NotificationsForm({
  view,
  canEdit,
}: {
  view: NotificationsView;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveNotifications, undefined);
  const [rotated, setRotated] = useState<{ secret?: string; error?: string } | null>(null);
  const [rotating, startRotate] = useTransition();
  const revealed = rotated?.secret ?? state?.revealedSecret;

  return (
    <form action={action} className="flex flex-col gap-6">
      <ChannelCard
        id="slack"
        title="Slack"
        description="An incoming webhook for a channel. Slack › Apps › Incoming Webhooks gives you the URL."
        urlLabel="Webhook URL"
        placeholder="https://hooks.slack.com/services/…"
        channel={view.slack}
        canEdit={canEdit}
      >
        {NOTIFICATION_EVENT_TYPES.map((type) => (
          <SlackTemplateField
            key={type}
            type={type}
            value={view.slack.templates[type] ?? ""}
            canEdit={canEdit}
          />
        ))}
      </ChannelCard>
      <ChannelCard
        id="webhook"
        title="Webhook"
        description="Your own endpoint receives each event as JSON, signed with a secret you verify."
        urlLabel="Endpoint URL"
        placeholder="https://example.com/deskbell/events"
        channel={view.webhook}
        canEdit={canEdit}
      >
        {view.webhook.configured ? (
          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel htmlFor="signingSecret">Signing secret</FieldLabel>
              <FieldDescription>
                Verifies the <code>x-deskbell-signature</code> header. Rotating it invalidates the
                old one at once.
              </FieldDescription>
            </FieldContent>
            <div className="flex items-center gap-2">
              <code id="signingSecret" className="rounded bg-muted px-2 py-1 text-xs">
                {view.webhook.secretMasked}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEdit || rotating}
                onClick={() => startRotate(async () => setRotated(await rotateSigningSecret()))}
              >
                {rotating ? "Rotating…" : "Rotate"}
              </Button>
            </div>
            {rotated?.error ? <p className="text-sm text-destructive">{rotated.error}</p> : null}
          </Field>
        ) : null}
      </ChannelCard>

      {revealed ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
        >
          <p className="font-medium">
            Your signing secret — copy it now. It will not be shown again.
          </p>
          <code className="mt-2 block break-all rounded bg-background px-2 py-1 text-xs">
            {revealed}
          </code>
        </div>
      ) : null}

      <FieldGroup>
        <Field orientation="vertical">
          <FieldContent>
            <FieldLabel htmlFor="conversationLinkTemplate">Conversation link</FieldLabel>
            <FieldDescription>
              Optional. Where the "Open conversation" link goes when your product has its own view.
              Placeholders: <code>{"{conversationId}"}</code>, <code>{"{context.<key>.id}"}</code>,{" "}
              <code>{"{context.<key>.name}"}</code>. Empty means this dashboard.
            </FieldDescription>
          </FieldContent>
          <Input
            id="conversationLinkTemplate"
            name="conversationLinkTemplate"
            defaultValue={view.conversationLinkTemplate}
            placeholder="https://app.example.com/sites/{context.site.id}/chats/{conversationId}"
            disabled={!canEdit}
          />
        </Field>
      </FieldGroup>

      {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.saved && !state.error ? (
        <p className="text-sm text-muted-foreground">
          Saved. The next event goes to these channels.
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only admins can change notification settings.
        </p>
      )}
    </form>
  );
}

function ChannelCard({
  id,
  title,
  description,
  urlLabel,
  placeholder,
  channel,
  canEdit,
  children,
}: {
  id: "slack" | "webhook";
  title: string;
  description: string;
  urlLabel: string;
  placeholder: string;
  channel: ChannelView;
  canEdit: boolean;
  children?: React.ReactNode;
}) {
  const [remove, setRemove] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel htmlFor={`${id}Url`}>{urlLabel}</FieldLabel>
              {channel.configured ? (
                <FieldDescription>
                  Currently <code data-testid={`${id}-masked`}>{channel.masked}</code>. Paste a new
                  URL to replace it, or leave empty to keep it.
                </FieldDescription>
              ) : null}
            </FieldContent>
            <Input
              id={`${id}Url`}
              name={`${id}Url`}
              type="url"
              placeholder={placeholder}
              disabled={!canEdit || remove}
              autoComplete="off"
            />
            {channel.configured ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}Remove`}
                  name={`${id}Remove`}
                  checked={remove}
                  onCheckedChange={(v) => setRemove(v === true)}
                  disabled={!canEdit}
                />
                <Label htmlFor={`${id}Remove`} className="text-sm text-muted-foreground">
                  Remove this channel
                </Label>
              </div>
            ) : null}
          </Field>
          {NOTIFICATION_EVENT_TYPES.map((type) => (
            <Field key={type} orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={`${id}.${type}`}>
                  {NOTIFICATION_EVENT_META[type].label}
                </FieldLabel>
                <FieldDescription>{NOTIFICATION_EVENT_META[type].description}</FieldDescription>
              </FieldContent>
              <Switch
                id={`${id}.${type}`}
                name={`${id}.${type}`}
                defaultChecked={channel.events[type]}
                disabled={!canEdit || remove}
              />
            </Field>
          ))}
          {children}
          {channel.lastDelivery ? (
            <p className="text-xs text-muted-foreground" data-testid={`${id}-status`}>
              {channel.lastDelivery.status === "delivered" ? "Delivered" : "Failed"}{" "}
              {new Date(channel.lastDelivery.at).toLocaleString()}
              {channel.lastDelivery.error ? ` — ${channel.lastDelivery.error}` : ""}
            </p>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

/**
 * One message template per event. Empty means the built-in layout; "Start
 * from the default" fills the box with a text version of it to edit.
 */
function SlackTemplateField({
  type,
  value,
  canEdit,
}: {
  type: NotificationEventType;
  value: string;
  canEdit: boolean;
}) {
  const [text, setText] = useState(value);
  const id = `slack.template.${type}`;
  return (
    <Field orientation="vertical">
      <FieldContent>
        <FieldLabel htmlFor={id}>
          Message for {NOTIFICATION_EVENT_META[type].label.toLowerCase()}
        </FieldLabel>
        <FieldDescription>
          Optional. Slack mrkdwn with placeholders; empty uses the built-in layout. The Open
          conversation button is always added. Placeholders:{" "}
          {NOTIFICATION_PLACEHOLDERS[type].map((p, i) => (
            <span key={p}>
              {i > 0 ? ", " : ""}
              <code>{`{${p}}`}</code>
            </span>
          ))}
          , <code>{"{context.<key>.id}"}</code>, <code>{"{context.<key>.name}"}</code>.
        </FieldDescription>
      </FieldContent>
      <Textarea
        id={id}
        name={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        spellCheck={false}
        disabled={!canEdit}
        className="font-mono text-xs"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canEdit}
          onClick={() => setText(DEFAULT_SLACK_TEMPLATES[type])}
        >
          Start from the default
        </Button>
        {text ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canEdit}
            onClick={() => setText("")}
          >
            Use the built-in layout
          </Button>
        ) : null}
      </div>
    </Field>
  );
}
